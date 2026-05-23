from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import numpy as np
import wandas as wd

from decimator import decimated_waveform

_PERF_ENABLED = os.environ.get("AWA_PERF_LOG", "0") == "1"


def _perf(phase: str, started: float, **extra: object) -> None:
    if not _PERF_ENABLED:
        return
    ms = (time.perf_counter() - started) * 1000.0
    parts = [f"phase={phase}", f"ms={ms:.2f}"]
    parts.extend(f"{k}={v}" for k, v in extra.items())
    print("[perf] " + " ".join(parts), file=sys.stderr, flush=True)


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


def _spectrum_peaks(
    magnitudes: np.ndarray,
    freqs: np.ndarray,
    peak_count: int,
) -> list[dict[str, float]]:
    """Return up to *peak_count* peaks as {freqHz, amplitudeDb} dicts.

    Uses scipy.signal.find_peaks for proper local-maxima detection, then
    converts magnitude (linear) to dB and returns the top-N by amplitude.
    """
    from scipy.signal import find_peaks  # lazy import — not all callers need this

    if magnitudes.size <= 2 or freqs.size != magnitudes.size:
        return []

    mag = np.asarray(magnitudes, dtype=np.float64).copy()
    fr = np.asarray(freqs, dtype=np.float64)
    mag[0] = 0.0  # suppress DC bin

    indices, _ = find_peaks(mag, height=0)
    if indices.size == 0:
        return []

    # Keep top-N by magnitude
    n = min(peak_count, indices.size)
    top_idx = indices[np.argsort(mag[indices])[::-1][:n]]

    eps = 1e-12
    result = []
    for idx in top_idx:
        amplitude_db = 20.0 * np.log10(float(mag[idx]) + eps)
        result.append({"freqHz": float(fr[idx]), "amplitudeDb": round(amplitude_db, 2)})
    return result


def _build_waveform_envelope(
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


_ALLOWED_WINDOWS = {"hann", "hamming", "blackman", "boxcar"}


def _resolve_stft_params(
    sample_count: int,
    stft_options: dict | None,
) -> tuple[int, int, str]:
    if stft_options is None:
        window_size = max(64, _pick_window_size(sample_count))
        hop_size = max(
            1,
            int(np.ceil(max(1, sample_count - window_size) / max(1, SPECTROGRAM_TIME_BIN_LIMIT - 1))),
        )
        return window_size, hop_size, "hann"

    n_fft = int(stft_options.get("n_fft", 0))
    hop = int(stft_options.get("hop_size", 0))
    window = str(stft_options.get("window", "hann"))
    if n_fft < 64 or n_fft > 16384:
        raise ValueError(f"n_fft must be in [64, 16384], got {n_fft}")
    if hop < 1 or hop > n_fft:
        raise ValueError(f"hop_size must be in [1, n_fft], got {hop}")
    if window not in _ALLOWED_WINDOWS:
        raise ValueError(f"window must be one of {sorted(_ALLOWED_WINDOWS)}, got {window!r}")
    return n_fft, hop, window


def analyze_from_frame(
    frame: wd.ChannelFrame,
    file_path: str | Path,
    peak_count: int = 5,
    *,
    stft_options: dict | None = None,
) -> dict[str, object]:
    """Build the AnalysisResult JSON payload from a (typically persisted) ChannelFrame."""
    peak_count = max(0, int(peak_count))  # guard against negative/zero from user config
    target = Path(file_path)
    t_frame = time.perf_counter()
    channel_count = int(frame.n_channels)
    sample_count = int(frame.n_samples)
    sample_rate_hz = int(frame.sampling_rate)
    labels = list(frame.labels)
    data = _channels_first(np.asarray(frame.data), channel_count, sample_count)
    rms_values = np.asarray(frame.rms, dtype=np.float64)
    _perf("read_frame", t_frame, channels=channel_count, samples=sample_count, sr=sample_rate_hz)

    t_fft = time.perf_counter()
    fft = frame.fft()
    fft_freqs = np.asarray(fft.freqs, dtype=np.float64)
    fft_magnitudes = _channels_first(np.asarray(fft.magnitude), channel_count, fft_freqs.size)
    _perf("fft", t_fft, bins=fft_freqs.size)

    window_size, hop_size, window_name = _resolve_stft_params(sample_count, stft_options)
    t_stft = time.perf_counter()
    stft = frame.stft(n_fft=window_size, hop_length=hop_size, window=window_name)
    stft_db = np.asarray(stft.dB, dtype=np.float64)
    _perf("stft", t_stft, n_fft=window_size, hop=hop_size, shape="x".join(str(s) for s in stft_db.shape))

    t_channels = time.perf_counter()
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
                "peaks": _spectrum_peaks(fft_magnitudes[index], fft_freqs, peak_count),
                "waveform": _build_waveform_envelope(
                    samples,
                    WAVEFORM_POINT_LIMIT,
                    start_sample=0,
                    total_samples=sample_count,
                ),
                "spectrogram": _build_spectrogram(spectrogram_db, sample_rate_hz, window_size, hop_size),
            }
        )

    _perf("channels_build", t_channels, count=channel_count)

    return {
        "filePath": str(target),
        "fileName": target.name,
        "sampleRateHz": sample_rate_hz,
        "durationSeconds": float(frame.duration),
        "channelCount": channel_count,
        "sampleCount": sample_count,
        "channels": channels,
    }


def analyze_audio(
    file_path: str | Path,
    peak_count: int = 5,
    *,
    stft_options: dict | None = None,
) -> dict[str, object]:
    target = Path(file_path).expanduser().resolve()
    if not target.exists():
        raise FileNotFoundError(f"Audio file not found: {target}")
    t0 = time.perf_counter()
    frame = wd.read_wav(str(target))
    _perf("read_wav", t0)
    return analyze_from_frame(frame, target, peak_count=peak_count, stft_options=stft_options)
