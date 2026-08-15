from __future__ import annotations

import base64
import io
import time
from collections.abc import Mapping
from pathlib import Path
from typing import TypedDict

import numpy as np
import soundfile as sf

from analysis_engine import AnalysisEngine
from analyzer import (
    SPECTROGRAM_FREQUENCY_BIN_LIMIT,
    StftOptions,
    analyze_from_frame,
    build_waveform_envelope,
    channels_first,
    level_scale_metadata,
    resample_frequency_bins,
    resolve_stft_params,
)


class TrackDetailResult(TypedDict):
    trackIndex: int
    analysisId: str | None
    settingsSignature: str | None
    filePath: str
    channels: list[dict[str, object]]
    calibrationSignature: str
    analysisRevision: int


class SpectrumSliceResult(TypedDict):
    trackIndex: int
    analysisId: str | None
    settingsSignature: str | None
    filePath: str
    channels: list[dict[str, object]]
    frequencyBins: int
    maxFrequencyHz: float
    computeMs: float
    calibrationSignature: str
    analysisRevision: int


class WaveformRangeResult(TypedDict):
    startNorm: float
    endNorm: float
    channels: list[dict[str, object]]
    calibrationSignature: str
    analysisRevision: int


class WavLoopExportResult(TypedDict):
    wavBase64: str
    sampleRate: int


def _optional_text(value: object) -> str | None:
    return None if value is None else str(value)


def _analysis_revision(value: object) -> int:
    if isinstance(value, bool):
        raise TypeError("analysisRevision must be an integer")
    return int(value)


class AnalysisService:
    def __init__(self, engine: AnalysisEngine) -> None:
        self.engine = engine

    def analyze(
        self,
        file_path: str | Path,
        *,
        stft_options: Mapping[str, object] | None = None,
        calibration_profile: object = None,
        analysis_revision: object = 0,
    ) -> dict[str, object]:
        cached, analysis_frame, resolved = self.engine.get_analysis(file_path, calibration_profile)
        result = analyze_from_frame(
            analysis_frame,
            cached.path,
            raw_frame=cached.frame,
            calibration_profile=resolved,
            stft_options=stft_options,
            include_spectrogram=False,
        )
        result["analysisRevision"] = _analysis_revision(analysis_revision)
        return result

    def track_detail(
        self,
        file_path: str | Path,
        *,
        track_index: int = -1,
        analysis_id: object = None,
        settings_signature: object = None,
        stft_options: Mapping[str, object] | None = None,
        calibration_profile: object = None,
        analysis_revision: object = 0,
    ) -> TrackDetailResult:
        cached, analysis_frame, resolved = self.engine.get_analysis(file_path, calibration_profile)
        n_fft, hop_length, window = resolve_stft_params(analysis_frame.n_samples, stft_options)
        spectrogram = self.engine.get_spectrogram(
            cached.path,
            n_fft,
            hop_length,
            window,
            calibration_profile,
        )
        result = analyze_from_frame(
            analysis_frame,
            cached.path,
            raw_frame=cached.frame,
            calibration_profile=resolved,
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
            "calibrationSignature": resolved.signature,
            "analysisRevision": _analysis_revision(analysis_revision),
        }

    def spectrum_slice(
        self,
        file_path: str | Path,
        *,
        cursor_norm: float,
        track_index: int = -1,
        analysis_id: object = None,
        settings_signature: object = None,
        stft_options: Mapping[str, object] | None = None,
        calibration_profile: object = None,
        analysis_revision: object = 0,
    ) -> SpectrumSliceResult:
        compute_started = time.perf_counter()
        cached, analysis_frame, resolved = self.engine.get_analysis(file_path, calibration_profile)
        window_size, hop_size, window_name = resolve_stft_params(analysis_frame.n_samples, stft_options)
        clipped_norm = max(0.0, min(1.0, cursor_norm))
        revision = _analysis_revision(analysis_revision)

        spectrogram = self.engine.get_cached_spectrogram(
            cached.path,
            window_size,
            hop_size,
            window_name,
            calibration_profile,
        )
        if spectrogram is not None:
            time_bins = int(spectrogram.n_frames)
            if time_bins <= 0:
                raise ValueError("no spectrogram available for spectrum slice")
            time_index = min(int(np.floor(clipped_norm * time_bins)), time_bins - 1)
            spectrum = spectrogram.get_frame_at(time_index)
            max_frequency_hz = float(spectrogram.freqs[-1])
            values = np.asarray(spectrum.dB, dtype=np.float64)
            rows = resample_frequency_bins(
                values.reshape(analysis_frame.n_channels, -1),
                SPECTROGRAM_FREQUENCY_BIN_LIMIT,
            )
        else:
            center_sample = min(int(clipped_norm * analysis_frame.n_samples), analysis_frame.n_samples - 1)
            live_quantum = max(1, int(round(float(analysis_frame.sampling_rate) / 30.0)))
            quantized_center = min(
                analysis_frame.n_samples - 1,
                int(round(center_sample / live_quantum)) * live_quantum,
            )
            slice_key = (resolved.signature, window_size, window_name, revision, quantized_center)
            cached_slice = self.engine.get_spectrum_slice(cached, slice_key)
            if cached_slice is not None:
                rows, max_frequency_hz = cached_slice
                spectrum = None
            else:
                center_sample = quantized_center
                start_sample = max(0, center_sample - window_size // 2)
                end_sample = min(analysis_frame.n_samples, start_sample + window_size)
                start_sample = max(0, end_sample - window_size)
                spectrum = analysis_frame[:, start_sample:end_sample].fft(n_fft=window_size, window=window_name)
                max_frequency_hz = float(spectrum.freqs[-1])
                values = np.asarray(spectrum.dB, dtype=np.float64)
                rows = resample_frequency_bins(
                    values.reshape(analysis_frame.n_channels, -1),
                    SPECTROGRAM_FREQUENCY_BIN_LIMIT,
                ).astype(np.float32, copy=False)
                self.engine.put_spectrum_slice(cached, slice_key, rows, max_frequency_hz)
        channels: list[dict[str, object]] = []
        for channel_index, row in enumerate(rows):
            reference = analysis_frame.channels[channel_index].level_reference
            channels.append(
                {
                    "channelIndex": channel_index,
                    "values": row.tolist(),
                    "minDb": float(np.min(row)),
                    "maxDb": float(np.max(row)),
                    **level_scale_metadata(reference, "Spectrum amplitude level"),
                }
            )
        return {
            "trackIndex": track_index,
            "analysisId": _optional_text(analysis_id),
            "settingsSignature": _optional_text(settings_signature),
            "filePath": str(cached.path),
            "channels": channels,
            "frequencyBins": int(rows.shape[1]),
            "maxFrequencyHz": max_frequency_hz,
            "computeMs": (time.perf_counter() - compute_started) * 1000.0,
            "calibrationSignature": resolved.signature,
            "analysisRevision": revision,
        }

    def waveform_range(
        self,
        file_path: str | Path,
        *,
        start_norm: float,
        end_norm: float,
        point_count: int = 2000,
        calibration_profile: object = None,
        analysis_revision: object = 0,
    ) -> WaveformRangeResult:
        cached, analysis_frame, resolved = self.engine.get_analysis(file_path, calibration_profile)
        sample_count = analysis_frame.n_samples
        start_idx = max(0, int(start_norm * sample_count))
        end_idx = min(sample_count, int(end_norm * sample_count))

        channels: list[dict[str, object]] = []
        if end_idx > start_idx:
            range_frame = analysis_frame[:, start_idx:end_idx]
            data = channels_first(range_frame.data, analysis_frame.n_channels, end_idx - start_idx)
            for channel_index in range(analysis_frame.n_channels):
                channels.append(
                    build_waveform_envelope(
                        data[channel_index],
                        point_count,
                        start_sample=start_idx,
                        total_samples=sample_count,
                    )
                )

        return {
            "startNorm": start_norm,
            "endNorm": end_norm,
            "channels": channels,
            "calibrationSignature": resolved.signature,
            "analysisRevision": _analysis_revision(analysis_revision),
        }

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
        return {}


__all__ = [
    "AnalysisService",
    "SpectrumSliceResult",
    "StftOptions",
    "TrackDetailResult",
    "WaveformRangeResult",
    "WavLoopExportResult",
]
