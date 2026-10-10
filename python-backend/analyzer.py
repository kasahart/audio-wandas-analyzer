from __future__ import annotations

import time
from collections.abc import Mapping
from pathlib import Path
from typing import TypedDict

import numpy as np
import wandas as wd

from calibration_profile import (
    ResolvedCalibrationProfile,
    ResolvedChannelCalibration,
)
from decimator import decimated_waveform
from perf import _perf

WAVEFORM_POINT_LIMIT = 1200
SPECTROGRAM_TIME_BIN_LIMIT = 720
SPECTROGRAM_FREQUENCY_BIN_LIMIT = 192
DB_UNIT = "dB"
SPECTRUM_LEVEL_AXIS_LABEL = "Spectrum amplitude level [dB]"


def sample_range(start_norm: float, end_norm: float, sample_count: int) -> tuple[int, int]:
    """Map a normalized [start, end) selection onto clamped sample indices."""
    return max(0, int(start_norm * sample_count)), min(sample_count, int(end_norm * sample_count))


def measurement_metadata(
    channel: ResolvedChannelCalibration,
    reference: wd.LevelReference,
) -> dict[str, object]:
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


def level_scale_metadata(reference: wd.LevelReference, quantity_label: str) -> dict[str, object]:
    return {
        "unit": reference.unit,
        "axisLabel": f"{quantity_label} [{reference.label}]",
        "referenceValue": reference.reference_value,
        "referenceUnit": reference.reference_unit,
        "levelReferenceLabel": reference.label,
    }


def _analysis_units_metadata(references: list[wd.LevelReference]) -> dict[str, object] | None:
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
) -> dict[str, object]:
    if total_samples is None:
        total_samples = len(samples)
    return decimated_waveform(samples, point_limit, start_sample, total_samples)


def _pick_window_size(sample_count: int) -> int:
    if sample_count <= 512:
        return max(32, sample_count)

    target = min(2048, sample_count)
    window_size = 256
    while window_size * 2 <= target:
        window_size *= 2

    return window_size


def _mean_power_db(values_db: np.ndarray, axis: int) -> np.ndarray:
    powers = np.power(10.0, values_db / 10.0)
    mean_power = np.maximum(np.mean(powers, axis=axis), 1e-12)
    return 10.0 * np.log10(mean_power)


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


def _resample_time_bins(spectrogram: np.ndarray, target_bin_count: int) -> np.ndarray:
    if spectrogram.shape[0] <= target_bin_count:
        return spectrogram

    reduced = np.empty((target_bin_count, spectrogram.shape[1]), dtype=np.float64)
    for index, frame_group in enumerate(np.array_split(spectrogram, target_bin_count, axis=0)):
        reduced[index] = _mean_power_db(frame_group, axis=0)

    return reduced


def _build_spectrogram(
    spectrogram_db: np.ndarray,
    sample_rate_hz: int,
    window_size: int,
    hop_size: int,
    scale_metadata: dict[str, object] | None = None,
    time_bin_limit: int = SPECTROGRAM_TIME_BIN_LIMIT,
    frequency_bin_limit: int = SPECTROGRAM_FREQUENCY_BIN_LIMIT,
) -> dict[str, object]:
    scale = scale_metadata or {
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

    return {
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


_ALLOWED_WINDOWS = {"hann", "hamming", "blackman", "boxcar"}


class StftOptions(TypedDict):
    n_fft: int
    hop_size: int
    window: str


def normalize_stft_options(stft_options: Mapping[str, object] | None) -> StftOptions | None:
    if not stft_options:
        return None

    n_fft = int(stft_options.get("n_fft", stft_options.get("nFft", 0)))
    hop_size = int(stft_options.get("hop_size", stft_options.get("hopSize", 0)))
    window = str(stft_options.get("window", "hann"))
    if n_fft < 64 or n_fft > 16384:
        raise ValueError(f"n_fft must be in [64, 16384], got {n_fft}")
    if n_fft % 2:
        raise ValueError(f"n_fft must be even, got {n_fft}")
    if hop_size < 1 or hop_size > n_fft:
        raise ValueError(f"hop_size must be in [1, n_fft], got {hop_size}")
    if window not in _ALLOWED_WINDOWS:
        raise ValueError(f"window must be one of {sorted(_ALLOWED_WINDOWS)}, got {window!r}")
    return {"n_fft": n_fft, "hop_size": hop_size, "window": window}


def resolve_stft_params(
    sample_count: int,
    stft_options: Mapping[str, object] | None,
) -> tuple[int, int, str]:
    normalized = normalize_stft_options(stft_options)
    if normalized is None:
        window_size = max(64, _pick_window_size(sample_count))
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
) -> dict[str, object]:
    """Build the AnalysisResult JSON payload from a ChannelFrame."""
    target = Path(file_path)
    t_frame = time.perf_counter()
    channel_count = int(frame.n_channels)
    sample_count = int(frame.n_samples)
    sample_rate_hz = int(frame.sampling_rate)
    labels = list(frame.labels)
    resolved = calibration_profile
    references = [frame.channels[index].level_reference for index in range(channel_count)]
    measurements = [measurement_metadata(channel, references[index]) for index, channel in enumerate(resolved.channels)]
    data = channels_first(np.asarray(frame.data), channel_count, sample_count)
    raw_source = raw_frame or frame
    raw_data = channels_first(np.asarray(raw_source.data), channel_count, sample_count)
    if raw_frame is None and not resolved.is_identity:
        for index, channel in enumerate(resolved.channels):
            raw_data[index] = raw_data[index] / channel.factor
    _perf("read_frame", t_frame, channels=channel_count, samples=sample_count, sr=sample_rate_hz)

    window_size, hop_size, window_name = resolve_stft_params(sample_count, stft_options)
    stft_db: np.ndarray | None = None
    if include_spectrogram:
        if spectrogram_frame is None:
            raise ValueError("spectrogram_frame is required when include_spectrogram is true")
        stft_db = np.asarray(spectrogram_frame.dB, dtype=np.float64)
        if stft_db.ndim == 2:
            stft_db = stft_db[np.newaxis, :, :]
        elif stft_db.ndim != 3:
            raise ValueError(f"Expected 2D or 3D spectrogram data, got shape {stft_db.shape}")

    t_channels = time.perf_counter()
    channels: list[dict[str, object]] = []
    for index in range(channel_count):
        samples = data[index]
        measurement = measurements[index]
        peak = float(np.max(np.abs(samples)))
        raw_peak = float(np.max(np.abs(raw_data[index])))
        spectrogram = None
        if stft_db is not None:
            spectrogram_db = np.transpose(stft_db[index], (1, 0))
            spectrogram = _build_spectrogram(
                spectrogram_db,
                sample_rate_hz,
                window_size,
                hop_size,
                level_scale_metadata(references[index], "STFT amplitude level"),
            )
        channels.append(
            {
                "label": labels[index] if index < len(labels) else f"Channel {index + 1}",
                "unit": measurement["linearUnit"],
                "measurement": measurement,
                "peakAbsolute": peak,
                "peakLevelDb": references[index].to_level(peak),
                "rawPeakFullScale": raw_peak,
                "clipped": raw_peak >= 0.99,
                "waveform": build_waveform_envelope(
                    samples,
                    WAVEFORM_POINT_LIMIT,
                    start_sample=0,
                    total_samples=sample_count,
                ),
                "spectrogram": spectrogram,
            }
        )

    _perf("channels_build", t_channels, count=channel_count)

    result: dict[str, object] = {
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
