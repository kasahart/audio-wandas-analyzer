from __future__ import annotations

from pathlib import Path

import numpy as np
import wandas as wd


WAVEFORM_POINT_LIMIT = 1200
SPECTROGRAM_TIME_BIN_LIMIT = 720
SPECTROGRAM_FREQUENCY_BIN_LIMIT = 192
SPECTROGRAM_DB_RANGE = 90.0


def _channels_first(data: np.ndarray, channel_count: int, sample_count: int) -> np.ndarray:
    array = np.asarray(data, dtype=np.float64)

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


def _dominant_frequencies(
    magnitudes: np.ndarray,
    freqs: np.ndarray,
    peak_count: int,
) -> list[dict[str, float]]:
    if magnitudes.size <= 1 or freqs.size != magnitudes.size:
        return []

    magnitudes = np.asarray(magnitudes, dtype=np.float64).copy()
    freqs = np.asarray(freqs, dtype=np.float64)
    magnitudes[0] = 0.0
    candidate_count = min(peak_count, magnitudes.size)
    top_indices = np.argpartition(magnitudes, -candidate_count)[-candidate_count:]
    sorted_indices = top_indices[np.argsort(magnitudes[top_indices])[::-1]]

    return [
        {
            "frequencyHz": float(freqs[index]),
            "magnitude": float(magnitudes[index]),
        }
        for index in sorted_indices
    ]


def _build_waveform_envelope(samples: np.ndarray, point_limit: int = WAVEFORM_POINT_LIMIT) -> dict[str, object]:
    if samples.size == 0:
        return {
            "min": [],
            "max": [],
            "samples": [],
            "absolutePeak": 0.0,
        }

    point_count = min(point_limit, samples.size)
    min_values: list[float] = []
    max_values: list[float] = []
    sample_values: list[float] = []

    for bucket in np.array_split(samples, point_count):
        min_values.append(float(np.min(bucket)))
        max_values.append(float(np.max(bucket)))
        sample_values.append(float(bucket[len(bucket) // 2]))

    return {
        "min": min_values,
        "max": max_values,
        "samples": sample_values,
        "absolutePeak": float(np.max(np.abs(samples))),
    }


def _pick_window_size(sample_count: int) -> int:
    if sample_count <= 512:
        return max(32, sample_count)

    target = min(2048, sample_count)
    window_size = 256
    while window_size * 2 <= target:
        window_size *= 2

    return window_size


def _resample_frequency_bins(spectrogram: np.ndarray, target_bin_count: int) -> np.ndarray:
    if spectrogram.shape[1] <= target_bin_count:
        return spectrogram

    reduced = np.empty((spectrogram.shape[0], target_bin_count), dtype=np.float64)
    for index, band in enumerate(np.array_split(spectrogram, target_bin_count, axis=1)):
        reduced[:, index] = np.mean(band, axis=1)

    return reduced


def _resample_time_bins(spectrogram: np.ndarray, target_bin_count: int) -> np.ndarray:
    if spectrogram.shape[0] <= target_bin_count:
        return spectrogram

    reduced = np.empty((target_bin_count, spectrogram.shape[1]), dtype=np.float64)
    for index, frame_group in enumerate(np.array_split(spectrogram, target_bin_count, axis=0)):
        reduced[index] = np.mean(frame_group, axis=0)

    return reduced


def _build_spectrogram(
    spectrogram_db: np.ndarray,
    sample_rate_hz: int,
    window_size: int,
    hop_size: int,
    time_bin_limit: int = SPECTROGRAM_TIME_BIN_LIMIT,
    frequency_bin_limit: int = SPECTROGRAM_FREQUENCY_BIN_LIMIT,
) -> dict[str, object]:
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
        }

    spectrogram = np.asarray(spectrogram_db, dtype=np.float64)
    if spectrogram.ndim != 2:
        raise ValueError(f"Expected 2D spectrogram data, got shape {spectrogram.shape}")

    spectrogram = _resample_time_bins(spectrogram, time_bin_limit)
    spectrogram = _resample_frequency_bins(spectrogram, frequency_bin_limit)

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
    }


def analyze_range(
    file_path: str | Path,
    start_norm: float,
    end_norm: float,
    point_count: int = 2000,
) -> dict[str, object]:
    """Return high-resolution waveform for a normalized time range using soundfile (fast path)."""
    import soundfile as sf  # noqa: PLC0415

    data, _sr = sf.read(str(file_path), always_2d=True)  # shape: (samples, channels)
    n_total = len(data)
    start_idx = max(0, int(start_norm * n_total))
    end_idx = min(n_total, int(end_norm * n_total))

    if end_idx <= start_idx:
        return {"startNorm": start_norm, "endNorm": end_norm, "channels": []}

    channels: list[dict[str, object]] = []
    for ch_idx in range(data.shape[1]):
        ch_slice = data[start_idx:end_idx, ch_idx].astype(np.float64)
        channels.append(_build_waveform_envelope(ch_slice, point_count))

    return {"startNorm": start_norm, "endNorm": end_norm, "channels": channels}


def analyze_audio(file_path: str | Path, peak_count: int = 5) -> dict[str, object]:
    target = Path(file_path).expanduser().resolve()
    if not target.exists():
        raise FileNotFoundError(f"Audio file not found: {target}")

    signal = wd.read_wav(str(target))
    channel_count = int(signal.n_channels)
    sample_count = int(signal.n_samples)
    sample_rate_hz = int(signal.sampling_rate)
    labels = list(signal.labels)
    data = _channels_first(np.asarray(signal.data), channel_count, sample_count)
    rms_values = np.asarray(signal.rms, dtype=np.float64)

    fft = signal.fft()
    fft_freqs = np.asarray(fft.freqs, dtype=np.float64)
    fft_magnitudes = _channels_first(np.asarray(fft.magnitude), channel_count, fft_freqs.size)

    window_size = max(64, _pick_window_size(sample_count))
    hop_size = max(1, int(np.ceil(max(1, sample_count - window_size) / max(1, SPECTROGRAM_TIME_BIN_LIMIT - 1))))
    stft = signal.stft(n_fft=window_size, hop_length=hop_size)
    stft_db = np.asarray(stft.dB, dtype=np.float64)

    channels: list[dict[str, object]] = []
    for index in range(channel_count):
        samples = data[index]
        spectrogram_db = np.transpose(stft_db[index], (1, 0))
        channels.append(
            {
                "label": labels[index] if index < len(labels) else f"Channel {index + 1}",
                "rms": float(rms_values[index]),
                "peakAbsolute": float(np.max(np.abs(samples))),
                "dominantFrequencies": _dominant_frequencies(fft_magnitudes[index], fft_freqs, peak_count),
                "waveform": _build_waveform_envelope(samples),
                "spectrogram": _build_spectrogram(spectrogram_db, sample_rate_hz, window_size, hop_size),
            }
        )

    return {
        "filePath": str(target),
        "fileName": target.name,
        "sampleRateHz": sample_rate_hz,
        "durationSeconds": float(signal.duration),
        "channelCount": channel_count,
        "sampleCount": sample_count,
        "channels": channels,
    }