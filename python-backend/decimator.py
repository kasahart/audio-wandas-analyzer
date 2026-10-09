from __future__ import annotations

import numpy as np

MAX_WAVEFORM_POINTS = 8192


def decimated_waveform(
    samples: np.ndarray,
    point_limit: int,
    start_sample: int,
    total_samples: int,
) -> dict[str, object]:
    """バケット毎に argmin/argmax の値と正規化時刻を返す。

    minT/maxT は total_samples 全体における正規化位置 (0–1)。
    """
    if point_limit > MAX_WAVEFORM_POINTS:
        raise ValueError(f"point_limit must not exceed {MAX_WAVEFORM_POINTS}")
    n = len(samples)
    if n == 0:
        return {"min": [], "max": [], "minT": [], "maxT": [], "samples": [], "absolutePeak": 0.0}

    point_count = min(point_limit, n)
    if point_count <= 0:
        return {
            "min": [],
            "max": [],
            "minT": [],
            "maxT": [],
            "samples": [],
            "absolutePeak": float(np.max(np.abs(samples))),
        }
    denom = max(1, total_samples - 1)
    width, remainder = divmod(n, point_count)
    sizes = np.full(point_count, width)
    sizes[:remainder] += 1
    starts = np.concatenate(([0], np.cumsum(sizes[:-1])))
    indices = np.arange(n)
    minima = np.minimum.reduceat(samples, starts)
    maxima = np.maximum.reduceat(samples, starts)
    minimum_matches = samples == np.repeat(minima, sizes)
    maximum_matches = samples == np.repeat(maxima, sizes)
    minimum_matches |= np.isnan(samples)
    maximum_matches |= np.isnan(samples)
    minimum_indices = np.minimum.reduceat(np.where(minimum_matches, indices, n), starts)
    maximum_indices = np.minimum.reduceat(np.where(maximum_matches, indices, n), starts)
    min_values = samples[minimum_indices].astype(float).tolist()
    max_values = samples[maximum_indices].astype(float).tolist()
    min_t = np.minimum(1.0, (start_sample + minimum_indices) / denom).tolist()
    max_t = np.minimum(1.0, (start_sample + maximum_indices) / denom).tolist()
    sample_values = samples[starts + sizes // 2].astype(float).tolist()

    return {
        "min": min_values,
        "max": max_values,
        "minT": min_t,
        "maxT": max_t,
        "samples": sample_values,
        "absolutePeak": float(np.max(np.abs(samples))),
    }
