from __future__ import annotations
import numpy as np


def decimated_waveform(
    samples: np.ndarray,
    point_limit: int,
    start_sample: int,
    total_samples: int,
) -> dict[str, object]:
    """バケット毎に argmin/argmax の値と正規化時刻を返す。

    minT/maxT は total_samples 全体における正規化位置 (0–1)。
    """
    n = len(samples)
    if n == 0:
        return {"min": [], "max": [], "minT": [], "maxT": [],
                "samples": [], "absolutePeak": 0.0}

    point_count = min(point_limit, n)
    denom = max(1, total_samples - 1)
    indices = np.arange(n)
    buckets = np.array_split(indices, point_count)

    min_values: list[float] = []
    max_values: list[float] = []
    min_t: list[float] = []
    max_t: list[float] = []
    sample_values: list[float] = []

    for bucket in buckets:
        if len(bucket) == 0:
            continue
        data = samples[bucket]
        local_min = int(np.argmin(data))
        local_max = int(np.argmax(data))

        min_values.append(float(data[local_min]))
        max_values.append(float(data[local_max]))
        min_t.append(float((start_sample + int(bucket[local_min])) / denom))
        max_t.append(float((start_sample + int(bucket[local_max])) / denom))
        sample_values.append(float(data[len(data) // 2]))

    return {
        "min": min_values,
        "max": max_values,
        "minT": min_t,
        "maxT": max_t,
        "samples": sample_values,
        "absolutePeak": float(np.max(np.abs(samples))),
    }
