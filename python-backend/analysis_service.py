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
import wandas as wd

from analysis_engine import AnalysisEngine, CachedAnalysis
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


class PairSpectrumResponse(TypedDict):
    filePath: str
    channelIndex: int
    status: str
    startSeconds: float
    endSeconds: float
    averages: int
    resampled: bool
    gainDb: list[float | None]
    phaseRad: list[float | None]
    coherence: list[float | None]
    unit: str
    axisLabel: str
    referenceValue: NotRequired[float]
    referenceUnit: NotRequired[str]
    levelReferenceLabel: NotRequired[str]
    calibrationSignature: str
    analysisRevision: int


class PairSpectrumResult(TypedDict):
    analysisId: str | None
    settingsSignature: str | None
    filePath: str
    channelIndex: int
    frequencyBins: int
    maxFrequencyHz: float
    nFft: int
    hopLength: int
    window: str
    computeMs: float
    calibrationSignature: str
    analysisRevision: int
    responses: list[PairSpectrumResponse]


# Bounds the Web Worker's memory; longer averaging ranges use their first ten minutes.
MAX_PAIR_SECONDS = 600.0


class _PairSource(NamedTuple):
    cached: CachedAnalysis
    frame: wd.ChannelFrame
    signature: str
    channel: int
    offset: float
    revision: int


class _PairSpectrum(NamedTuple):
    status: str
    start: float
    end: float
    averages: int
    resampled: bool
    rows: np.ndarray
    level: Mapping[str, object]


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


class RecipeBuildResult(TypedDict):
    name: str
    recipe: dict[str, object]


# IEC 61260-1 nominal mid-band frequencies, which wandas (MoSQITo) uses to label its bands.
_NOMINAL_BAND_CENTERS_HZ: dict[int, tuple[float, ...]] = {
    1: (31.5, 63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0),
    3: (
        20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0, 200.0,
        250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0, 2000.0,
        2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 16000.0, 20000.0,
    ),
}  # fmt: skip


# SciPy's zero-phase decimator inside MoSQITo rejects inputs of 27 samples or fewer, so shorter
# clips are zero padded (like fft() pads to n_fft); their band levels are mostly filter transient.
_MIN_BAND_SLICE_SAMPLES = 64


class OctaveBands(NamedTuple):
    bands_per_octave: int
    centers_hz: tuple[float, ...]
    # Edges of the whole nominal range, so every file shares one axis whatever its sample rate.
    min_frequency_hz: float
    max_frequency_hz: float
    # The band filters restart on every slice, so the slice must be long enough for the lowest
    # band's start-up transient to stay small next to its steady level.
    min_duration_s: float


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
    # MoSQITo rejects centres above 0.88 * Nyquist, and scipy's band-pass design needs the upper edge below Nyquist.
    usable = tuple(c for c in nominal if exact(c) * half_band < nyquist and exact(c) <= 0.88 * nyquist)
    if not usable:
        raise InputError(f"No {bands_per_octave}-band octave filter fits below {nyquist:g} Hz")
    lowest_bandwidth_hz = exact(usable[0]) * (half_band - 1 / half_band)
    return OctaveBands(
        bands_per_octave,
        usable,
        exact(nominal[0]) / half_band,
        exact(nominal[-1]) * half_band,
        # Ten reciprocal bandwidths keep a steady tone in the lowest band within about 0.5 dB.
        10.0 / lowest_bandwidth_hz,
    )


def _optional_text(value: object) -> str | None:
    return None if value is None else str(value)


def _analysis_revision(value: object) -> int:
    if isinstance(value, bool) or not (isinstance(value, int) or (isinstance(value, float) and value.is_integer())):
        raise InputError("analysisRevision must be an integer")
    return int(value)


def _snapped_window_center(cursor_sample: float, hop_size: int) -> int:
    """Centre of the cursor spectrum's window: the nearest STFT frame centre (a multiple of the hop), so the
    band and the spectrum match one spectrogram frame for the current n_fft and hop. Frames whose window
    passes a file end are kept so every sample stays reachable; the caller then pushes the window inside."""
    return round(cursor_sample / hop_size) * hop_size


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
        window_size, hop_size, window_name = resolve_stft_params(analysis_frame.n_samples, stft_options)
        clipped_norm = max(0.0, min(1.0, cursor_norm))
        revision = _analysis_revision(analysis_revision)
        bands = octave_bands(bands_per_octave, analysis_frame.sampling_rate) if bands_per_octave is not None else None
        if bands is not None:
            window_size = max(window_size, math.ceil(bands.min_duration_s * analysis_frame.sampling_rate))

        center_sample = _snapped_window_center(clipped_norm * analysis_frame.n_samples, hop_size)
        start_sample = max(0, center_sample - window_size // 2)
        end_sample = min(analysis_frame.n_samples, start_sample + window_size)
        start_sample = max(0, end_sample - window_size)
        window_start_sample = float(start_sample)
        slice_key = (resolved.signature, window_size, window_name, revision, start_sample, bands_per_octave)
        cached_slice = self.engine.get_spectrum_slice(cached, slice_key)
        if cached_slice is not None:
            rows, max_frequency_hz = cached_slice
        elif bands is not None:
            segment = analysis_frame[:, start_sample:end_sample]
            if end_sample - start_sample < _MIN_BAND_SLICE_SAMPLES:
                segment = segment.fix_length(length=_MIN_BAND_SLICE_SAMPLES)
            octave = segment.noct_spectrum(
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

    def pair_spectrum(
        self,
        reference: Mapping[str, object],
        responses: list[Mapping[str, object]],
        *,
        start_seconds: float | None = None,
        end_seconds: float | None = None,
        stft_options: Mapping[str, object] | None = None,
        analysis_id: object = None,
        settings_signature: object = None,
    ) -> PairSpectrumResult:
        compute_started = time.perf_counter()
        x = self._pair_source(reference)
        sources = [self._pair_source(response) for response in responses]
        n_fft, hop_length, window = pair_stft_params(x.frame.n_samples, stft_options)
        bins = _display_bins(n_fft // 2 + 1)
        replies: list[PairSpectrumResponse] = []
        for y in sources:
            key = (
                "pair",
                x.signature,
                x.channel,
                x.offset,
                y.cached.path,
                y.cached.identity,
                y.signature,
                y.channel,
                y.offset,
                start_seconds,
                end_seconds,
                n_fft,
                hop_length,
                window,
            )
            pair = self.engine.get_pair_spectrum(x.cached, key)
            if not isinstance(pair, _PairSpectrum):
                pair = _compute_pair(x, y, start_seconds, end_seconds, n_fft, hop_length, window, bins)
                self.engine.put_pair_spectrum(x.cached, key, pair)
            replies.append(
                {
                    "filePath": str(y.cached.path),
                    "channelIndex": y.channel,
                    "status": pair.status,
                    "startSeconds": pair.start,
                    "endSeconds": pair.end,
                    "averages": pair.averages,
                    "resampled": pair.resampled,
                    "gainDb": _finite_values(pair.rows[0]),
                    "phaseRad": _finite_values(pair.rows[1]),
                    "coherence": _finite_values(pair.rows[2]),
                    **pair.level,  # type: ignore[typeddict-item]
                    "calibrationSignature": y.signature,
                    "analysisRevision": y.revision,
                }
            )
        return {
            "analysisId": _optional_text(analysis_id),
            "settingsSignature": _optional_text(settings_signature),
            "filePath": str(x.cached.path),
            "channelIndex": x.channel,
            "frequencyBins": int(bins.size),
            "maxFrequencyHz": float(x.frame.sampling_rate) / 2.0,
            "nFft": n_fft,
            "hopLength": hop_length,
            "window": window,
            "computeMs": (time.perf_counter() - compute_started) * 1000.0,
            "calibrationSignature": x.signature,
            "analysisRevision": x.revision,
            "responses": replies,
        }

    def _pair_source(self, source: Mapping[str, object]) -> _PairSource:
        cached, frame, resolved = self.engine.get_analysis(str(source["filePath"]), source.get("calibrationProfile"))
        channel = int(source["channelIndex"])  # type: ignore[call-overload]
        if not 0 <= channel < frame.n_channels:
            raise InputError(f"channelIndex {channel} is out of range for {cached.path.name}")
        return _PairSource(
            cached,
            frame,
            resolved.signature,
            channel,
            float(source["offsetSeconds"]),  # type: ignore[arg-type]
            _analysis_revision(source.get("analysisRevision", 0)),
        )

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
        sample_rate = max(1, round(cached.frame.sampling_rate))
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
        inputs: Mapping[str, str],
        recipe_path: str | None = None,
        input_contexts: Mapping[str, object] | None = None,
    ) -> RecipeRunResult:
        from recipe_runner import RecipeError, evaluate_recipe, frame_input_names, load_plan, recipe_title

        try:
            plan = load_plan(recipe)
            names = frame_input_names(plan)
            missing = [name for name in names if name not in inputs]
            if missing:
                raise RecipeError(f"no file for recipe input {missing[0]!r}")
            frames = {}
            for name in names:
                context = (input_contexts or {}).get(name, {})
                _, frames[name], _ = self.engine.get_analysis(inputs[name], context.get("calibrationProfile"))
            charts = evaluate_recipe(plan, frames, title=recipe_title(recipe_path))
        except RecipeError as error:
            raise InputError(f"recipe error: {error}") from error
        return {"charts": charts}

    def build_recipe(
        self,
        file_path: str | Path,
        *,
        stft_options: Mapping[str, object] | None = None,
        bands_per_octave: int | None = None,
        reference_channel: int | None = None,
        responses: list[Mapping[str, object]] | None = None,
    ) -> RecipeBuildResult:
        from recipe_builder import RecipeSource, spectrum_recipe, transfer_recipe

        cached = self.engine.get_file(file_path)
        frame = cached.frame
        # The pair view's parameters: auto mode averages half-overlapping segments like Welch.
        n_fft, hop_length, window = pair_stft_params(frame.n_samples, stft_options)
        if reference_channel is None:
            source = RecipeSource(frame.n_channels, float(frame.sampling_rate))
            if bands_per_octave is None:
                recipe = spectrum_recipe(source, n_fft=n_fft, hop_length=hop_length, window=window)
                return {"name": "spectrum", "recipe": recipe}
            bands = octave_bands(bands_per_octave, frame.sampling_rate)
            recipe = spectrum_recipe(
                source,
                n_fft=n_fft,
                hop_length=hop_length,
                window=window,
                band_centers_hz=bands.centers_hz,
                bands_per_octave=bands_per_octave,
            )
            return {"name": f"octave-{bands_per_octave}", "recipe": recipe}
        if not responses:
            raise InputError("A transfer function Recipe needs at least one response channel")
        files: list[CachedAnalysis] = [cached]
        pairs: list[tuple[int, int]] = []
        for channel in [{"filePath": str(file_path), "channelIndex": reference_channel}, *responses]:
            response = self.engine.get_file(str(channel["filePath"]))
            index = next((i for i, known in enumerate(files) if known.path == response.path), None)
            if index is None:
                files.append(response)
                index = len(files) - 1
            channel_index = int(channel["channelIndex"])  # type: ignore[call-overload]
            if not 0 <= channel_index < response.frame.n_channels:
                raise InputError(f"channelIndex {channel_index} is out of range for {response.path.name}")
            pairs.append((index, channel_index))
        recipe = transfer_recipe(
            [RecipeSource(known.frame.n_channels, float(known.frame.sampling_rate)) for known in files],
            pairs[0][1],
            pairs[1:],
            n_fft=n_fft,
            hop_length=hop_length,
            window=window,
        )
        return {"name": "transfer-function", "recipe": recipe}

    def scan(
        self,
        file_path: str,
        *,
        recipe: Mapping[str, object],
        region: Mapping[str, float] | None = None,
        channels: list[int] | None = None,
        calibration_profile: object = None,
        stage: str | None = None,
        detail: Mapping[str, object] | None = None,
        reference: Mapping[str, object] | None = None,
    ) -> dict[str, object]:
        from scan_service import scan

        return dict(
            scan(
                self.engine,
                file_path,
                recipe=recipe,
                region=region,
                channels=channels,
                calibration_profile=calibration_profile,
                stage=stage,
                detail=detail,
                # Another recording a cross-channel step pairs this one with: its path, step and own Recipe.
                reference=(
                    (
                        str(reference["filePath"]),
                        {
                            "step": str(reference["step"]),
                            "recipe": reference["recipe"],
                            "calibration": reference.get("calibration"),
                        },  # type: ignore[typeddict-item]
                    )
                    if reference is not None
                    else None
                ),
            )
        )

    def release_track_detail(self, file_path: str | Path) -> dict[str, object]:
        return {}


def pair_stft_params(sample_count: int, stft_options: Mapping[str, object] | None) -> tuple[int, int, str]:
    n_fft, hop_length, window = resolve_stft_params(sample_count, stft_options)
    # Auto mode picks its hop for the spectrogram's time bins; Welch averaging wants the usual half overlap.
    return (n_fft, n_fft // 2, window) if stft_options is None else (n_fft, hop_length, window)


def _display_bins(bin_count: int) -> np.ndarray:
    # Pick representative bins instead of averaging so wrapped phase never averages across ±π.
    count = min(bin_count, SPECTROGRAM_FREQUENCY_BIN_LIMIT)
    return np.round(np.linspace(0, bin_count - 1, count)).astype(int)


def _finite_values(row: np.ndarray) -> list[float | None]:
    return [float(value) if math.isfinite(value) else None for value in row.tolist()]


def pair_overlap(
    x: _PairSource, y: _PairSource, start_seconds: float | None, end_seconds: float | None
) -> tuple[float, float]:
    """Global seconds both channels cover inside the requested range, capped at ``MAX_PAIR_SECONDS``."""
    start = max(x.offset, y.offset, -math.inf if start_seconds is None else start_seconds)
    end = min(
        x.offset + x.frame.n_samples / float(x.frame.sampling_rate),
        y.offset + y.frame.n_samples / float(y.frame.sampling_rate),
        math.inf if end_seconds is None else end_seconds,
    )
    return start, min(end, start + MAX_PAIR_SECONDS)


def _compute_pair(
    x: _PairSource,
    y: _PairSource,
    start_seconds: float | None,
    end_seconds: float | None,
    n_fft: int,
    hop_length: int,
    window: str,
    bins: np.ndarray,
) -> _PairSpectrum:
    rate = float(x.frame.sampling_rate)
    y_rate = float(y.frame.sampling_rate)
    start, end = pair_overlap(x, y, start_seconds, end_seconds)
    empty = np.empty((3, 0))
    level: dict[str, object] = {"unit": "dB", "axisLabel": "Gain [dB]"}
    if end <= start:
        return _PairSpectrum("no-overlap", start, max(start, end), 0, False, empty, level)
    length = int(math.floor((end - start) * rate))
    if length < n_fft:
        return _PairSpectrum("too-short", start, start + length / rate, 0, y_rate != rate, empty, level)
    x_start = min(int(round((start - x.offset) * rate)), x.frame.n_samples - length)
    y_start = int(round((start - y.offset) * y_rate))
    y_length = int(math.ceil((end - start) * y_rate))
    reference = x.frame.get_channel(x.channel)[:, x_start : x_start + length]
    response = y.frame.get_channel(y.channel)[:, y_start : y_start + y_length]
    resampled = y_rate != rate
    if resampled:
        response = response.resampling(target_sr=rate)
    response = response.fix_length(length=length)
    spectrogram = (
        reference.concat_frame(response, suffix_on_dup="_y")
        .stft(n_fft=n_fft, hop_length=hop_length, window=window, detrend="constant")
        .cache()
    )
    # The STFT pads the edges; averaging only frames inside the range matches Welch's segments.
    first_center = int(round(spectrogram.frame_time_origin * rate))
    frame_starts = np.arange(spectrogram.n_frames) * hop_length + first_center - n_fft // 2
    inside = np.flatnonzero((frame_starts >= 0) & (frame_starts + n_fft <= length))
    end = start + length / rate
    if inside.size == 0:
        return _PairSpectrum("too-short", start, end, 0, resampled, empty, level)
    csd = spectrogram[:, :, int(inside[0]) : int(inside[-1]) + 1].csd().cache()
    transfer = csd.transfer_function().select_pair(1, 0)
    coherence = csd.coherence().select_pair(1, 0)
    if transfer.pair_domains[0].unit == "1":
        gain = transfer.gain_db
    else:
        gain = transfer.transfer_level_db
        level = dict(level_scale_metadata(transfer.channels[0].level_reference, "Transfer level"))
    rows = np.vstack(
        [
            np.asarray(gain, dtype=np.float64).reshape(-1)[bins],
            np.asarray(transfer.phase, dtype=np.float64).reshape(-1)[bins],
            np.asarray(coherence.coherence, dtype=np.float64).reshape(-1)[bins],
        ]
    )
    return _PairSpectrum("ok", start, end, int(inside.size), resampled, rows, level)


__all__ = [
    "AnalysisService",
    "PairSpectrumResult",
    "pair_overlap",
    "pair_stft_params",
    "RecipeBuildResult",
    "RecipeRunResult",
    "SpectrumSliceResult",
    "StftOptions",
    "TrackDetailResult",
    "WaveformRangeResult",
    "WavLoopExportResult",
]
