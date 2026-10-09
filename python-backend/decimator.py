from __future__ import annotations

import numpy as np

MAX_WAVEFORM_POINTS = 8192
_DECIMATION_BLOCK_SAMPLES = 65536


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
            "absolutePeak": float(np.maximum(np.max(samples), -np.min(samples))),
        }
    denom = max(1, total_samples - 1)
    width, remainder = divmod(n, point_count)
    sizes = np.full(point_count, width)
    sizes[:remainder] += 1
    starts = np.concatenate(([0], np.cumsum(sizes[:-1])))
    minimum_indices = np.full(point_count, n)
    maximum_indices = np.full(point_count, n)
    minima = np.full(point_count, np.inf)
    maxima = np.full(point_count, -np.inf)
    for block_start in range(0, n, _DECIMATION_BLOCK_SAMPLES):
        block_end = min(n, block_start + _DECIMATION_BLOCK_SAMPLES)
        block = samples[block_start:block_end]
        first = np.searchsorted(starts, block_start, side="right") - 1
        last = np.searchsorted(starts, block_end - 1, side="right") - 1
        segment_starts = np.concatenate(([0], starts[first + 1 : last + 1] - block_start))
        segment_sizes = np.diff(np.concatenate((segment_starts, [len(block)])))
        indices = np.arange(block_start, block_end)
        block_minima = np.minimum.reduceat(block, segment_starts)
        block_maxima = np.maximum.reduceat(block, segment_starts)
        minimum_matches = (block == np.repeat(block_minima, segment_sizes)) | np.isnan(block)
        maximum_matches = (block == np.repeat(block_maxima, segment_sizes)) | np.isnan(block)
        block_minimum_indices = np.minimum.reduceat(np.where(minimum_matches, indices, n), segment_starts)
        block_maximum_indices = np.minimum.reduceat(np.where(maximum_matches, indices, n), segment_starts)
        target = slice(first, last + 1)
        replace_minimum = (minimum_indices[target] == n) | (
            ~np.isnan(minima[target]) & (np.isnan(block_minima) | (block_minima < minima[target]))
        )
        replace_maximum = (maximum_indices[target] == n) | (
            ~np.isnan(maxima[target]) & (np.isnan(block_maxima) | (block_maxima > maxima[target]))
        )
        minima[target] = np.where(replace_minimum, block_minima, minima[target])
        maxima[target] = np.where(replace_maximum, block_maxima, maxima[target])
        minimum_indices[target] = np.where(replace_minimum, block_minimum_indices, minimum_indices[target])
        maximum_indices[target] = np.where(replace_maximum, block_maximum_indices, maximum_indices[target])
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
        "absolutePeak": float(np.maximum(np.max(samples), -np.min(samples))),
    }
