from __future__ import annotations

import math
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import NotRequired, TypedDict

import numpy as np
import wandas as wd

from services.analysis_engine import compute_spectrogram
from services.backend_errors import InputError
from services.calibration_profile import (
    CalibrationSource,
    CalibrationStatus,
    ResolvedCalibrationProfile,
    ResolvedChannelCalibration,
)
from services.perf import perf_log

SPECTROGRAM_TIME_BIN_LIMIT = 720
# Cursor-spectrum display budget per channel: a row of up to this many FFT bins (n_fft <= 2048, the auto
# window's largest) is sent whole; a longer one (n_fft 4096..16384) is cut to at most this many log-spaced points.
# Raw full-scale peak at or above which a channel is reported as clipped.
CLIPPING_FULL_SCALE_THRESHOLD = 0.99
# wandas' unit for samples read relative to the file's full scale (audio); a CSV's physical values have none ("").
FULL_SCALE_UNIT = "FS"


def absolute_peak(samples: np.ndarray) -> float:
    """The largest |sample| of those with a value: a sample that is not finite is a gap (display rules R2), no peak;
    0 with none."""
    if not samples.size:
        return 0.0
    # Adding 0.0 turns the -0.0 that an all-zero signal yields into 0.0.
    peak = float(np.maximum(np.max(samples), -np.min(samples))) + 0.0
    if math.isfinite(peak):
        return peak
    finite = samples[np.isfinite(samples)]
    return float(np.max(np.abs(finite))) + 0.0 if finite.size else 0.0


def has_full_scale(source: wd.ChannelFrame, index: int) -> bool:
    """Whether a channel of the source as read (before calibration) is relative to a full scale, as wandas says."""
    return source.channels[index].unit == FULL_SCALE_UNIT


class MeasurementMetadata(TypedDict):
    calibrationStatus: CalibrationStatus
    calibrationSource: CalibrationSource
    factor: float
    linearUnit: str
    referenceValue: float
    referenceUnit: str
    levelUnit: str
    levelReferenceLabel: str


class LevelScaleMetadata(TypedDict):
    unit: str
    axisLabel: str
    referenceValue: float
    referenceUnit: str
    levelReferenceLabel: str


class AnalysisUnits(TypedDict):
    amplitudeLevel: LevelScaleMetadata
    spectrumLevel: LevelScaleMetadata
    spectrogramLevel: LevelScaleMetadata


class ChannelSummary(TypedDict):
    label: str
    unit: str
    measurement: MeasurementMetadata
    peakAbsolute: float
    peakLevelDb: float
    rawPeakFullScale: float
    # False: the source's values are raw input units, so its uncalibrated levels are dB re 1 input unit, not dBFS.
    fullScale: bool
    # wandas' unit and level label for the source as read, before calibration ("FS" / "dBFS" for audio).
    sourceUnit: str
    sourceLevelReferenceLabel: str
    # None: the source has no full scale to clip against.
    clipped: bool | None


class AnalysisResult(TypedDict):
    filePath: str
    fileName: str
    sampleRateHz: float
    durationSeconds: float
    channelCount: int
    sampleCount: int
    schemaVersion: int
    calibrationSignature: str
    calibrationProfile: dict[str, object]
    channels: list[ChannelSummary]
    units: NotRequired[AnalysisUnits]
    analysisRevision: NotRequired[int]
    sourceVersion: NotRequired[str]
    stftSignature: NotRequired[str]


def sample_range(start_norm: float, end_norm: float, sample_count: int) -> tuple[int, int]:
    """Map a normalized [start, end) selection onto clamped sample indices."""
    return max(0, int(start_norm * sample_count)), min(sample_count, int(end_norm * sample_count))


def measurement_metadata(
    channel: ResolvedChannelCalibration,
    reference: wd.LevelReference,
) -> MeasurementMetadata:
    return {
        "calibrationStatus": channel.status,
        "calibrationSource": channel.source,
        "factor": channel.factor,
        "linearUnit": reference.reference_unit,
        "referenceValue": reference.reference_value,
        "referenceUnit": reference.reference_unit,
        "levelUnit": reference.unit,
        "levelReferenceLabel": reference.label,
    }


def level_scale_metadata(reference: wd.LevelReference, quantity_label: str) -> LevelScaleMetadata:
    return {
        "unit": reference.unit,
        "axisLabel": f"{quantity_label} [{reference.label}]",
        "referenceValue": reference.reference_value,
        "referenceUnit": reference.reference_unit,
        "levelReferenceLabel": reference.label,
    }


def _analysis_units_metadata(references: list[wd.LevelReference]) -> AnalysisUnits | None:
    if not references:
        return None
    first = references[0]
    if any(reference != first for reference in references[1:]):
        return None
    return {
        "amplitudeLevel": level_scale_metadata(first, "Amplitude level"),
        "spectrumLevel": level_scale_metadata(first, "Spectrum amplitude level"),
        "spectrogramLevel": level_scale_metadata(first, "STFT amplitude level"),
    }


def channels_first(data: np.ndarray, channel_count: int, sample_count: int) -> np.ndarray:
    array = np.asarray(data)

    if array.ndim == 1:
        return array.reshape(1, -1)

    if array.ndim != 2:
        raise ValueError(f"Expected 1D or 2D audio data, got shape {array.shape}")

    if array.shape == (channel_count, sample_count):
        return array

    if array.shape == (sample_count, channel_count):
        return array.T

    if channel_count == 1:
        return array.reshape(1, -1)

    raise ValueError(
        "Could not infer channel orientation from audio data shape "
        f"{array.shape} with channel_count={channel_count} and sample_count={sample_count}"
    )


def _pick_window_size(sample_count: int) -> int:
    if sample_count <= 512:
        # Odd FFT sizes are rejected everywhere else, so a short file rounds down to an even size, and the
        # smallest window any STFT accepts is 64.
        return max(64, sample_count - sample_count % 2)

    target = min(2048, sample_count)
    window_size = 256
    while window_size * 2 <= target:
        window_size *= 2

    return window_size


def spectrogram_frame_centers(spectrogram_frame: wd.SpectrogramFrame) -> np.ndarray | None:
    """Seconds from the input start to each STFT frame's window centre; None when the frame does not know them.

    A sparse display spectrogram reports its own hop here, so its centres follow the frames actually computed.
    """
    origin = spectrogram_frame.frame_time_origin
    if origin is None:
        return None
    hop_seconds = spectrogram_frame.hop_length / spectrogram_frame.sampling_rate
    return float(origin) + np.arange(spectrogram_frame.n_frames) * hop_seconds


def spectrogram_window_frames(frame_centers_sec: np.ndarray, duration_sec: float, window: tuple[float, float]) -> slice:
    """The STFT frames a zoomed lane draws: those centred in ``window`` (fractions of the file), one more beside each
    end so the picture reaches the window's edges, and at least two (their centres place the cells)."""
    count = len(frame_centers_sec)
    start, end = sorted((float(window[0]), float(window[1])))
    first = int(np.searchsorted(frame_centers_sec, start * duration_sec, side="left")) - 1
    last = int(np.searchsorted(frame_centers_sec, end * duration_sec, side="right")) + 1
    first, last = max(0, first), min(count, last)
    if last - first < 2:
        last = min(count, max(last, first + 2))
        first = max(0, min(first, last - 2))
    return slice(first, last)


def zoom_window_spectrogram(
    frame: wd.ChannelFrame, n_fft: int, window: str, time_window: tuple[float, float]
) -> tuple[wd.SpectrogramFrame, np.ndarray, int]:
    """An STFT of a zoom window's samples alone, for the automatic settings (R3).

    The whole file's automatic hop spreads its frames over the file, so cutting them gives no more columns than the
    whole file had. A window instead gets its own hop, chosen for its length as the file's is for the file, with the
    file's window size so the frequency bins stay the same. The samples taken reach past the window by a window and a
    hop on each side, so the frames kept (in the window, and one beside each end) never see the cut's padding.
    Returns the STFT, its frame centres in seconds from the file start, and its hop.
    """
    sample_count = int(frame.n_samples)
    start = max(0, int(math.floor(min(time_window) * sample_count)))
    end = min(sample_count, int(math.ceil(max(time_window) * sample_count)))
    hop = max(1, int(np.ceil(max(1, end - start - n_fft) / max(1, SPECTROGRAM_TIME_BIN_LIMIT - 1))))
    margin = n_fft + hop
    first, last = max(0, start - margin), min(sample_count, end + margin)
    spectrogram = compute_spectrogram(frame[:, first:last], n_fft, hop, window)
    centers = spectrogram_frame_centers(spectrogram)
    if centers is None:
        raise ValueError("The zoom window's STFT has no frame times")
    return spectrogram, centers + first / float(frame.sampling_rate), hop


_ALLOWED_WINDOWS = {"hann", "hamming", "blackman", "boxcar"}


class StftOptions(TypedDict):
    n_fft: int
    hop_size: int
    window: str


def _option_number(options: Mapping[str, object], snake: str, camel: str, default: float) -> float:
    value = options.get(snake, options.get(camel, default))
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(f"{snake} must be a number, got {value!r}")
    return value


def normalize_stft_options(stft_options: Mapping[str, object] | None) -> StftOptions | None:
    if not stft_options:
        return None

    n_fft = int(_option_number(stft_options, "n_fft", "nFft", 0))
    overlap_percent = float(_option_number(stft_options, "overlap_percent", "overlapPercent", -1))
    window = str(stft_options.get("window", "hann"))
    if n_fft < 64 or n_fft > 16384:
        raise InputError(f"n_fft must be in [64, 16384], got {n_fft}")
    if n_fft % 2:
        raise InputError(f"n_fft must be even, got {n_fft}")
    if not 0 <= overlap_percent < 100:
        raise InputError(f"overlap_percent must be in [0, 100), got {overlap_percent}")
    if window not in _ALLOWED_WINDOWS:
        raise InputError(f"window must be one of {sorted(_ALLOWED_WINDOWS)}, got {window!r}")
    hop_size = max(1, round(n_fft * (1 - overlap_percent / 100)))
    return {"n_fft": n_fft, "hop_size": hop_size, "window": window}


def stft_signature(sample_count: int, stft_options: Mapping[str, object] | None) -> str:
    """The STFT a file's spectrogram and spectra are taken with (window length, hop, window), as every answer of it
    names it (stftSignature): an answer of another STFT than the analysis drawn is not read over it. A zoom window's
    own answer names this too (the analysis it belongs to); its finer hop is its hopSize."""
    n_fft, hop, window = resolve_stft_params(sample_count, stft_options)
    return f"{n_fft}/{hop}/{window}"


def resolve_stft_params(
    sample_count: int,
    stft_options: Mapping[str, object] | None,
) -> tuple[int, int, str]:
    normalized = normalize_stft_options(stft_options)
    if normalized is None:
        window_size = _pick_window_size(sample_count)
        hop_size = max(1, int(np.ceil(max(1, sample_count - window_size) / max(1, SPECTROGRAM_TIME_BIN_LIMIT - 1))))
        return window_size, hop_size, "hann"

    return normalized["n_fft"], normalized["hop_size"], normalized["window"]


def analyze_from_frame(
    frame: wd.ChannelFrame,
    file_path: str | Path,
    *,
    raw_frame: wd.ChannelFrame,
    calibration_profile: ResolvedCalibrationProfile,
    raw_peaks: Sequence[float] | None = None,
) -> AnalysisResult:
    """Build the AnalysisResult JSON payload from a ChannelFrame: what the recording is and each channel's facts
    (its unit, calibration, peak and clipping). No picture is in it: a row's waveform and spectrogram are figures
    (figures/service.py), asked for the part on screen."""
    target = Path(file_path)
    t_frame = time.perf_counter()
    channel_count = int(frame.n_channels)
    sample_count = int(frame.n_samples)
    # CSV sources may have fractional rates.
    sample_rate_hz = float(frame.sampling_rate)
    labels = list(frame.labels)
    resolved = calibration_profile
    references = [frame.channels[index].level_reference for index in range(channel_count)]
    measurements = [measurement_metadata(channel, references[index]) for index, channel in enumerate(resolved.channels)]
    data = channels_first(np.asarray(frame.data), channel_count, sample_count)
    if raw_peaks is None or len(raw_peaks) != channel_count:
        raw_data = channels_first(np.asarray(raw_frame.data), channel_count, sample_count)
        raw_peaks = [float(np.max(np.abs(raw_data[index]))) for index in range(channel_count)]
    perf_log("read_frame", t_frame, channels=channel_count, samples=sample_count, sr=sample_rate_hz)

    t_channels = time.perf_counter()
    channels: list[ChannelSummary] = []
    for index in range(channel_count):
        measurement = measurements[index]
        peak = absolute_peak(data[index])
        raw_peak = float(raw_peaks[index])
        full_scale = has_full_scale(raw_frame, index)
        channels.append(
            {
                "label": labels[index] if index < len(labels) else f"Channel {index + 1}",
                "unit": measurement["linearUnit"],
                "measurement": measurement,
                "peakAbsolute": peak,
                "peakLevelDb": references[index].to_level(peak),
                "rawPeakFullScale": raw_peak,
                "fullScale": full_scale,
                "sourceUnit": raw_frame.channels[index].unit,
                "sourceLevelReferenceLabel": raw_frame.channels[index].level_reference.label,
                "clipped": raw_peak >= CLIPPING_FULL_SCALE_THRESHOLD if full_scale else None,
            }
        )

    perf_log("channels_build", t_channels, count=channel_count)

    result: AnalysisResult = {
        "filePath": str(file_path),
        "fileName": target.name,
        "sampleRateHz": sample_rate_hz,
        "durationSeconds": float(frame.duration),
        "channelCount": channel_count,
        "sampleCount": sample_count,
        "schemaVersion": 2,
        "calibrationSignature": resolved.signature,
        "calibrationProfile": resolved.to_dict(),
        "channels": channels,
    }
    units = _analysis_units_metadata(references)
    if units is not None:
        result["units"] = units
    return result
