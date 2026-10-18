from __future__ import annotations

import base64
import io
import math
import time
from collections.abc import Mapping
from pathlib import Path
from typing import NamedTuple, NotRequired, TypedDict

import numpy as np
import soundfile as sf

from analysis_engine import AnalysisEngine
from analyzer import (
    SPECTROGRAM_FREQUENCY_BIN_LIMIT,
    AnalysisResult,
    ChannelSummary,
    StftOptions,
    analyze_from_frame,
    build_waveform_envelope,
    channels_first,
    level_scale_metadata,
    resample_frequency_bins,
    resolve_stft_params,
    sample_range,
)
from backend_errors import InputError
from chart_spec import ChartSpec


class TrackDetailResult(TypedDict):
    trackIndex: int
    analysisId: str | None
    settingsSignature: str | None
    filePath: str
    channels: list[ChannelSummary]
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
    bandsPerOctave: NotRequired[int]
    bandCentersHz: NotRequired[list[float]]
    minFrequencyHz: NotRequired[float]
    windowStartNorm: float
    windowEndNorm: float
    window: str
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


class RecipeRunResult(TypedDict):
    charts: list[ChartSpec]


# IEC 61260-1 nominal mid-band frequencies, which wandas (MoSQITo) uses to label its bands.
_NOMINAL_BAND_CENTERS_HZ: dict[int, tuple[float, ...]] = {
    1: (31.5, 63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0),
    3: (
        25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0, 200.0,
        250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0, 2000.0,
        2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 16000.0, 20000.0,
    ),
}  # fmt: skip


class OctaveBands(NamedTuple):
    bands_per_octave: int
    centers_hz: tuple[float, ...]
    # Edges of the whole nominal range, so every file shares one axis whatever its sample rate.
    min_frequency_hz: float
    max_frequency_hz: float


def octave_bands(bands_per_octave: int, sampling_rate: float) -> OctaveBands:
    """The nominal bands whose MoSQITo filters can be designed at this sample rate."""
    nominal = _NOMINAL_BAND_CENTERS_HZ.get(bands_per_octave)
    if nominal is None:
        raise InputError("bandsPerOctave must be 1 or 3")
    ratio = 10 ** (3 / (10 * bands_per_octave))
    half_band = math.sqrt(ratio)

    def exact(center: float) -> float:
        return 1000.0 * ratio ** round(math.log(center / 1000.0, ratio))

    nyquist = sampling_rate / 2
    usable = tuple(c for c in nominal if exact(c) * half_band < nyquist and exact(c) <= 0.88 * nyquist)
    if not usable:
        raise InputError(f"No {bands_per_octave}-band octave filter fits below {nyquist:g} Hz")
    return OctaveBands(bands_per_octave, usable, exact(nominal[0]) / half_band, exact(nominal[-1]) * half_band)


def _optional_text(value: object) -> str | None:
    return None if value is None else str(value)


def _analysis_revision(value: object) -> int:
    if isinstance(value, bool) or not (isinstance(value, int) or (isinstance(value, float) and value.is_integer())):
        raise InputError("analysisRevision must be an integer")
    return int(value)


def recipe_inputs(recipe: Mapping[str, object]) -> list[Mapping[str, str]]:
    inputs = recipe.get("inputs")
    if inputs is None:
        return []
    if not isinstance(inputs, list):
        raise InputError("recipe error: inputs must be a list")
    for item in inputs:
        if not isinstance(item, Mapping) or not all(isinstance(item.get(key), str) for key in ("name", "file")):
            raise InputError("recipe error: each input needs string 'name' and 'file'")
    return inputs


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
    ) -> AnalysisResult:
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
        bands_per_octave: int | None = None,
    ) -> SpectrumSliceResult:
        compute_started = time.perf_counter()
        cached, analysis_frame, resolved = self.engine.get_analysis(file_path, calibration_profile)
        window_size, _hop_size, window_name = resolve_stft_params(analysis_frame.n_samples, stft_options)
        clipped_norm = max(0.0, min(1.0, cursor_norm))
        revision = _analysis_revision(analysis_revision)
        bands = octave_bands(bands_per_octave, analysis_frame.sampling_rate) if bands_per_octave is not None else None

        # Transform the window centred on the cursor itself rather than the nearest STFT frame, so the
        # spectrum (and the band drawn for it) follows the cursor without hop-sized jumps or gaps.
        center_sample = min(int(round(clipped_norm * analysis_frame.n_samples)), analysis_frame.n_samples - 1)
        start_sample = max(0, center_sample - window_size // 2)
        end_sample = min(analysis_frame.n_samples, start_sample + window_size)
        start_sample = max(0, end_sample - window_size)
        window_start_sample = float(start_sample)
        slice_key = (resolved.signature, window_size, window_name, revision, start_sample, bands_per_octave)
        cached_slice = self.engine.get_spectrum_slice(cached, slice_key)
        if cached_slice is not None:
            rows, max_frequency_hz = cached_slice
        elif bands is not None:
            octave = analysis_frame[:, start_sample:end_sample].noct_spectrum(
                fmin=bands.centers_hz[0], fmax=bands.centers_hz[-1], n=bands.bands_per_octave
            )
            rows = np.asarray(octave.dB, dtype=np.float64).reshape(analysis_frame.n_channels, -1).astype(np.float32)
            max_frequency_hz = bands.max_frequency_hz
            self.engine.put_spectrum_slice(cached, slice_key, rows, max_frequency_hz)
        else:
            spectrum = analysis_frame[:, start_sample:end_sample].fft(n_fft=window_size, window=window_name)
            max_frequency_hz = float(spectrum.freqs[-1])
            values = np.asarray(spectrum.dB, dtype=np.float64)
            rows = resample_frequency_bins(
                values.reshape(analysis_frame.n_channels, -1),
                SPECTROGRAM_FREQUENCY_BIN_LIMIT,
            ).astype(np.float32, copy=False)
            self.engine.put_spectrum_slice(cached, slice_key, rows, max_frequency_hz)
        quantity = "Band level" if bands is not None else "Spectrum amplitude level"
        channels: list[dict[str, object]] = []
        for channel_index, row in enumerate(rows):
            reference = analysis_frame.channels[channel_index].level_reference
            channels.append(
                {
                    "channelIndex": channel_index,
                    "values": row.tolist(),
                    "minDb": float(np.min(row)),
                    "maxDb": float(np.max(row)),
                    **level_scale_metadata(reference, quantity),
                }
            )
        result: SpectrumSliceResult = {
            "trackIndex": track_index,
            "analysisId": _optional_text(analysis_id),
            "settingsSignature": _optional_text(settings_signature),
            "filePath": str(cached.path),
            "channels": channels,
            "frequencyBins": int(rows.shape[1]),
            "maxFrequencyHz": max_frequency_hz,
            "windowStartNorm": window_start_sample / analysis_frame.n_samples,
            # fft() zero-pads short files to window_size before windowing, so the span may pass the file end.
            "windowEndNorm": (window_start_sample + window_size) / analysis_frame.n_samples,
            "window": window_name,
            "computeMs": (time.perf_counter() - compute_started) * 1000.0,
            "calibrationSignature": resolved.signature,
            "analysisRevision": revision,
        }
        if bands is not None:
            result.update(
                bandsPerOctave=bands.bands_per_octave,
                bandCentersHz=list(bands.centers_hz),
                minFrequencyHz=bands.min_frequency_hz,
                # The band filters see the samples as they are: no window and no zero padding.
                windowEndNorm=end_sample / analysis_frame.n_samples,
                window="boxcar",
            )
        return result

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
        start_idx, end_idx = sample_range(start_norm, end_norm, sample_count)

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
        start_sample, end_sample = sample_range(start_norm, end_norm, cached.frame.n_samples)
        frame_count = end_sample - start_sample

        if frame_count <= 0:
            raise InputError(
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

    def run_recipe(
        self,
        recipe: Mapping[str, object],
        *,
        recipe_path: str | None = None,
        input_contexts: Mapping[str, object] | None = None,
    ) -> RecipeRunResult:
        from recipe_runner import RecipeError, evaluate_recipe

        base_dir = Path(recipe_path).parent if recipe_path else Path.cwd()
        bindings = {}
        for item in recipe_inputs(recipe):
            file = Path(item["file"])
            if not file.is_absolute():
                file = base_dir / file
            context = (input_contexts or {}).get(item["name"], {})
            _, frame, _ = self.engine.get_analysis(str(file), context.get("calibrationProfile"))
            bindings[item["name"]] = frame
        try:
            charts = evaluate_recipe(dict(recipe), bindings)
        except RecipeError as error:
            raise InputError(f"recipe error: {error}") from error
        return {"charts": charts}

    def release_track_detail(self, file_path: str | Path) -> dict[str, object]:
        return {}


__all__ = [
    "AnalysisService",
    "RecipeRunResult",
    "recipe_inputs",
    "SpectrumSliceResult",
    "StftOptions",
    "TrackDetailResult",
    "WaveformRangeResult",
    "WavLoopExportResult",
]
