from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf


WAVEFORM_POINT_LIMIT = 2000


def _build_waveform_envelope(samples: np.ndarray, point_limit: int = WAVEFORM_POINT_LIMIT) -> dict[str, object]:
    if samples.size == 0:
        return {"min": [], "max": [], "samples": [], "absolutePeak": 0.0}

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


def analyze_range(
    file_path: str | Path,
    start_norm: float,
    end_norm: float,
    point_count: int = WAVEFORM_POINT_LIMIT,
) -> dict[str, object]:
    data, _sr = sf.read(str(file_path), always_2d=True)  # (samples, channels)
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
