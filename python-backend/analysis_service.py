from __future__ import annotations

import base64
import io
from collections.abc import Mapping
from pathlib import Path
from typing import TypedDict

import numpy as np
import soundfile as sf

from analysis_engine import AnalysisEngine
from analyzer import (
    DB_UNIT,
    SPECTROGRAM_FREQUENCY_BIN_LIMIT,
    SPECTRUM_LEVEL_AXIS_LABEL,
    StftOptions,
    analyze_from_frame,
    build_waveform_envelope,
    channels_first,
    resample_frequency_bins,
    resolve_stft_params,
)


class TrackDetailResult(TypedDict):
    trackIndex: int
    analysisId: str | None
    settingsSignature: str | None
    filePath: str
    channels: list[dict[str, object]]


class SpectrumSliceResult(TypedDict):
    trackIndex: int
    channelIndex: int
    analysisId: str | None
    settingsSignature: str | None
    filePath: str
    values: list[float]
    frequencyBins: int
    maxFrequencyHz: float
    minDb: float
    maxDb: float
    unit: str
    axisLabel: str


class WaveformRangeResult(TypedDict):
    startNorm: float
    endNorm: float
    channels: list[dict[str, object]]


class WavLoopExportResult(TypedDict):
    wavBase64: str
    sampleRate: int


def _optional_text(value: object) -> str | None:
    return None if value is None else str(value)


class AnalysisService:
    def __init__(self, engine: AnalysisEngine) -> None:
        self.engine = engine

    def analyze(
        self,
        file_path: str | Path,
        *,
        peak_count: int = 5,
        stft_options: Mapping[str, object] | None = None,
    ) -> dict[str, object]:
        cached = self.engine.get_file(file_path)
        return analyze_from_frame(
            cached.frame,
            cached.path,
            peak_count=peak_count,
            stft_options=stft_options,
            include_spectrogram=False,
        )

    def track_detail(
        self,
        file_path: str | Path,
        *,
        track_index: int = -1,
        analysis_id: object = None,
        settings_signature: object = None,
        peak_count: int = 5,
        stft_options: Mapping[str, object] | None = None,
    ) -> TrackDetailResult:
        cached = self.engine.get_file(file_path)
        n_fft, hop_length, window = resolve_stft_params(cached.frame.n_samples, stft_options)
        spectrogram = self.engine.get_spectrogram(cached.path, n_fft, hop_length, window)
        result = analyze_from_frame(
            cached.frame,
            cached.path,
            peak_count=peak_count,
            stft_options=stft_options,
            spectrogram_frame=spectrogram,
            include_spectrogram=True,
        )
        return {
            "trackIndex": track_index,
            "analysisId": _optional_text(analysis_id),
            "settingsSignature": _optional_text(settings_signature),
            "filePath": str(cached.path),
            "channels": result["channels"],
        }

    def spectrum_slice(
        self,
        file_path: str | Path,
        *,
        cursor_norm: float,
        track_index: int = -1,
        channel_index: int = 0,
        analysis_id: object = None,
        settings_signature: object = None,
        stft_options: Mapping[str, object] | None = None,
    ) -> SpectrumSliceResult:
        cached = self.engine.get_file(file_path)
        window_size, hop_size, window_name = resolve_stft_params(cached.frame.n_samples, stft_options)
        clipped_norm = max(0.0, min(1.0, cursor_norm))
        if channel_index < 0 or channel_index >= cached.frame.n_channels:
            raise ValueError(f"channelIndex out of range: {channel_index}")

        spectrogram = self.engine.get_cached_spectrogram(cached.path, window_size, hop_size, window_name)
        if spectrogram is not None:
            time_bins = int(spectrogram.n_frames)
            if time_bins <= 0:
                raise ValueError("no spectrogram available for spectrum slice")
            time_index = min(int(np.floor(clipped_norm * time_bins)), time_bins - 1)
            spectrum = spectrogram.get_frame_at(time_index)
            max_frequency_hz = float(spectrogram.freqs[-1])
        else:
            center_sample = min(int(clipped_norm * cached.frame.n_samples), cached.frame.n_samples - 1)
            start_sample = max(0, center_sample - window_size // 2)
            end_sample = min(cached.frame.n_samples, start_sample + window_size)
            start_sample = max(0, end_sample - window_size)
            spectrum = cached.frame[:, start_sample:end_sample].fft(n_fft=window_size, window=window_name)
            max_frequency_hz = float(spectrum.freqs[-1])

        values = np.asarray(spectrum.dB, dtype=np.float64)
        if values.ndim == 2:
            values = values[channel_index]
        row = resample_frequency_bins(values.reshape(1, -1), SPECTROGRAM_FREQUENCY_BIN_LIMIT)[0]
        return {
            "trackIndex": track_index,
            "channelIndex": channel_index,
            "analysisId": _optional_text(analysis_id),
            "settingsSignature": _optional_text(settings_signature),
            "filePath": str(cached.path),
            "values": row.tolist(),
            "frequencyBins": int(row.shape[0]),
            "maxFrequencyHz": max_frequency_hz,
            "minDb": float(np.min(row)),
            "maxDb": float(np.max(row)),
            "unit": DB_UNIT,
            "axisLabel": SPECTRUM_LEVEL_AXIS_LABEL,
        }

    def waveform_range(
        self,
        file_path: str | Path,
        *,
        start_norm: float,
        end_norm: float,
        point_count: int = 2000,
    ) -> WaveformRangeResult:
        cached = self.engine.get_file(file_path)
        sample_count = cached.frame.n_samples
        start_idx = max(0, int(start_norm * sample_count))
        end_idx = min(sample_count, int(end_norm * sample_count))

        channels: list[dict[str, object]] = []
        if end_idx > start_idx:
            range_frame = cached.frame[:, start_idx:end_idx]
            data = channels_first(range_frame.data, cached.frame.n_channels, end_idx - start_idx)
            for channel_index in range(cached.frame.n_channels):
                channels.append(
                    build_waveform_envelope(
                        data[channel_index],
                        point_count,
                        start_sample=start_idx,
                        total_samples=sample_count,
                    )
                )

        return {"startNorm": start_norm, "endNorm": end_norm, "channels": channels}

    def export_wav_loop(
        self,
        file_path: str | Path,
        *,
        start_norm: float,
        end_norm: float,
    ) -> WavLoopExportResult:
        cached = self.engine.get_file(file_path)
        sample_rate = int(cached.frame.sampling_rate)
        start_sample = max(0, int(start_norm * cached.frame.n_samples))
        end_sample = min(cached.frame.n_samples, int(end_norm * cached.frame.n_samples))
        frame_count = end_sample - start_sample

        if frame_count <= 0:
            raise ValueError(
                f"Loop region produces 0 frames (startNorm={start_norm}, endNorm={end_norm}, "
                f"total_frames={cached.frame.n_samples}). Ensure startNorm < endNorm and the file is not empty."
            )

        range_frame = cached.frame[:, start_sample:end_sample]
        data = channels_first(range_frame.data, cached.frame.n_channels, frame_count).T
        buffer = io.BytesIO()
        sf.write(buffer, data, sample_rate, format="WAV", subtype="PCM_16")
        return {
            "wavBase64": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "sampleRate": sample_rate,
        }

    def release_track_detail(self, file_path: str | Path) -> dict[str, object]:
        self.engine.discard_spectrograms(file_path)
        return {}


__all__ = [
    "AnalysisService",
    "SpectrumSliceResult",
    "StftOptions",
    "TrackDetailResult",
    "WaveformRangeResult",
    "WavLoopExportResult",
]
