from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import NotRequired, TypedDict

import numpy as np
import wandas as wd

from backend_errors import InputError
from calibration_profile import (
    CalibrationSource,
    CalibrationStatus,
    ResolvedCalibrationProfile,
    ResolvedChannelCalibration,
)
from decimator import WaveformEnvelope, decimated_waveform
from perf import perf_log
from stage_view import power_mean_db

WAVEFORM_POINT_LIMIT = 1200
SPECTROGRAM_TIME_BIN_LIMIT = 720
SPECTROGRAM_FREQUENCY_BIN_LIMIT = 192
DB_UNIT = "dB"
SPECTRUM_LEVEL_AXIS_LABEL = "Spectrum amplitude level [dB]"
# Raw full-scale peak at or above which a channel is reported as clipped.
CLIPPING_FULL_SCALE_THRESHOLD = 0.99


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


class SpectrogramPayload(LevelScaleMetadata):
    values: list[list[float]]
    timeBins: int
    frequencyBins: int
    windowSize: int
    hopSize: int
    maxFrequencyHz: float
    minDb: float
    maxDb: float
    # Seconds from the file start to each time bin's centre: its STFT window centre,
    # or the mean centre of the frames merged into it.
    timeCentersSec: NotRequired[list[float]]


class ChannelSummary(TypedDict):
    label: str
    unit: str
    measurement: MeasurementMetadata
    peakAbsolute: float
    peakLevelDb: float
    rawPeakFullScale: float
    clipped: bool
    waveform: WaveformEnvelope
    spectrogram: SpectrogramPayload | None


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


def build_waveform_envelope(
    samples: np.ndarray,
    point_limit: int = WAVEFORM_POINT_LIMIT,
    start_sample: int = 0,
    total_samples: int | None = None,
) -> WaveformEnvelope:
    if total_samples is None:
        total_samples = len(samples)
    return decimated_waveform(samples, point_limit, start_sample, total_samples)


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


_MEAN_POWER_FLOOR_DB = -120.0


def _mean_power_db(values_db: np.ndarray, axis: int) -> np.ndarray:
    # The display payload floors a bin's mean power at 1e-12 (-120 dB); the comparison floors at MIN_LEVEL_DB.
    return np.maximum(power_mean_db(values_db, axis), _MEAN_POWER_FLOOR_DB)


def resample_frequency_bins(spectrogram: np.ndarray, target_bin_count: int) -> np.ndarray:
    if spectrogram.shape[1] <= target_bin_count:
        return spectrogram

    if target_bin_count == 1:
        return _mean_power_db(spectrogram, axis=1)[:, None]

    # UI/CSV coordinates include DC and Nyquist; assign each FFT bin to its nearest display coordinate.
    centers = np.linspace(0, spectrogram.shape[1] - 1, target_bin_count)
    boundaries = np.ceil((centers[:-1] + centers[1:]) / 2).astype(int)
    reduced = np.empty((spectrogram.shape[0], target_bin_count), dtype=np.float64)
    for index, band in enumerate(np.split(spectrogram, boundaries, axis=1)):
        reduced[:, index] = _mean_power_db(band, axis=1)

    return reduced


def _time_bin_boundaries(frame_count: int, target_bin_count: int) -> np.ndarray:
    # Spread the larger groups evenly; np.array_split front-loads them, which drifts display bins off their frame times.
    return (np.arange(1, target_bin_count) * frame_count) // target_bin_count


def _resample_time_bins(spectrogram: np.ndarray, target_bin_count: int) -> np.ndarray:
    if spectrogram.shape[0] <= target_bin_count:
        return spectrogram

    boundaries = _time_bin_boundaries(spectrogram.shape[0], target_bin_count)
    reduced = np.empty((target_bin_count, spectrogram.shape[1]), dtype=np.float64)
    for index, frame_group in enumerate(np.split(spectrogram, boundaries, axis=0)):
        reduced[index] = _mean_power_db(frame_group, axis=0)

    return reduced


def _resample_time_centers(centers: np.ndarray, target_bin_count: int) -> np.ndarray:
    if centers.shape[0] <= target_bin_count:
        return centers
    groups = np.split(centers, _time_bin_boundaries(centers.shape[0], target_bin_count))
    return np.array([np.mean(group) for group in groups])


def spectrogram_frame_centers(spectrogram_frame: wd.SpectrogramFrame) -> np.ndarray | None:
    """Seconds from the input start to each STFT frame's window centre; None when the frame does not know them.

    A sparse display spectrogram reports its own hop here, so its centres follow the frames actually computed.
    """
    origin = spectrogram_frame.frame_time_origin
    if origin is None:
        return None
    hop_seconds = spectrogram_frame.hop_length / spectrogram_frame.sampling_rate
    return float(origin) + np.arange(spectrogram_frame.n_frames) * hop_seconds


def _build_spectrogram(
    spectrogram_db: np.ndarray,
    sample_rate_hz: float,
    window_size: int,
    hop_size: int,
    scale_metadata: LevelScaleMetadata | None = None,
    time_bin_limit: int = SPECTROGRAM_TIME_BIN_LIMIT,
    frequency_bin_limit: int = SPECTROGRAM_FREQUENCY_BIN_LIMIT,
    frame_centers_sec: np.ndarray | None = None,
) -> SpectrogramPayload:
    scale: LevelScaleMetadata = scale_metadata or {
        "unit": DB_UNIT,
        "axisLabel": SPECTRUM_LEVEL_AXIS_LABEL,
        "referenceValue": 1.0,
        "referenceUnit": "FS",
        "levelReferenceLabel": DB_UNIT,
    }
    if spectrogram_db.size == 0:
        return {
            "values": [],
            "timeBins": 0,
            "frequencyBins": 0,
            "windowSize": 0,
            "hopSize": 0,
            "maxFrequencyHz": float(sample_rate_hz / 2),
            "minDb": 0.0,
            "maxDb": 0.0,
            **scale,
        }

    spectrogram = np.asarray(spectrogram_db, dtype=np.float64)
    if spectrogram.ndim != 2:
        raise ValueError(f"Expected 2D spectrogram data, got shape {spectrogram.shape}")

    spectrogram = _resample_time_bins(spectrogram, time_bin_limit)
    spectrogram = resample_frequency_bins(spectrogram, frequency_bin_limit)

    min_db = float(np.min(spectrogram))
    max_db = float(np.max(spectrogram))

    payload: SpectrogramPayload = {
        "values": spectrogram.tolist(),
        "timeBins": int(spectrogram.shape[0]),
        "frequencyBins": int(spectrogram.shape[1]),
        "windowSize": int(window_size),
        "hopSize": int(hop_size),
        "maxFrequencyHz": float(sample_rate_hz / 2),
        "minDb": min_db,
        "maxDb": max_db,
        **scale,
    }
    if frame_centers_sec is not None and len(frame_centers_sec) == spectrogram_db.shape[0]:
        centers = np.asarray(frame_centers_sec, dtype=np.float64)
        payload["timeCentersSec"] = _resample_time_centers(centers, time_bin_limit).tolist()
    return payload


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
    raw_frame: wd.ChannelFrame | None = None,
    calibration_profile: ResolvedCalibrationProfile,
    stft_options: Mapping[str, object] | None = None,
    spectrogram_frame: wd.SpectrogramFrame | None = None,
    include_spectrogram: bool = False,
    raw_peaks: Sequence[float] | None = None,
) -> AnalysisResult:
    """Build the AnalysisResult JSON payload from a ChannelFrame."""
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
        raw_source = raw_frame or frame
        raw_data = channels_first(np.asarray(raw_source.data), channel_count, sample_count)
        if raw_frame is None and not resolved.is_identity:
            for index, channel in enumerate(resolved.channels):
                raw_data[index] = raw_data[index] / channel.factor
        raw_peaks = [float(np.max(np.abs(raw_data[index]))) for index in range(channel_count)]
    perf_log("read_frame", t_frame, channels=channel_count, samples=sample_count, sr=sample_rate_hz)

    window_size, hop_size, window_name = resolve_stft_params(sample_count, stft_options)
    stft_db: np.ndarray | None = None
    frame_centers: np.ndarray | None = None
    if include_spectrogram:
        if spectrogram_frame is None:
            raise ValueError("spectrogram_frame is required when include_spectrogram is true")
        stft_db = np.asarray(spectrogram_frame.dB, dtype=np.float64)
        if stft_db.ndim == 2:
            stft_db = stft_db[np.newaxis, :, :]
        elif stft_db.ndim != 3:
            raise ValueError(f"Expected 2D or 3D spectrogram data, got shape {stft_db.shape}")
        frame_centers = spectrogram_frame_centers(spectrogram_frame)

    t_channels = time.perf_counter()
    channels: list[ChannelSummary] = []
    for index in range(channel_count):
        samples = data[index]
        measurement = measurements[index]
        # The envelope reads every sample once and keeps its largest magnitude: no separate pass for the peak.
        waveform = build_waveform_envelope(samples, WAVEFORM_POINT_LIMIT, start_sample=0, total_samples=sample_count)
        peak = float(waveform["absolutePeak"])
        raw_peak = float(raw_peaks[index])
        spectrogram = None
        if stft_db is not None:
            spectrogram_db = np.transpose(stft_db[index], (1, 0))
            spectrogram = _build_spectrogram(
                spectrogram_db,
                sample_rate_hz,
                window_size,
                hop_size,
                level_scale_metadata(references[index], "STFT amplitude level"),
                frame_centers_sec=frame_centers,
            )
        channels.append(
            {
                "label": labels[index] if index < len(labels) else f"Channel {index + 1}",
                "unit": measurement["linearUnit"],
                "measurement": measurement,
                "peakAbsolute": peak,
                "peakLevelDb": references[index].to_level(peak),
                "rawPeakFullScale": raw_peak,
                "clipped": raw_peak >= CLIPPING_FULL_SCALE_THRESHOLD,
                "waveform": waveform,
                "spectrogram": spectrogram,
            }
        )

    perf_log("channels_build", t_channels, count=channel_count)

    result: AnalysisResult = {
        "filePath": str(target),
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
