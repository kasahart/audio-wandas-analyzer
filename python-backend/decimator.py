from __future__ import annotations

import math
from typing import TypedDict

import numpy as np

from backend_errors import InputError
from protocol_schema import MAX_WAVEFORM_POINTS

_DECIMATION_BLOCK_SAMPLES = 65536


class WaveformEnvelope(TypedDict):
    min: list[float]
    max: list[float]
    minT: list[float]
    maxT: list[float]
    samples: list[float]
    absolutePeak: float


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


def bucket_starts(n: int, count: int) -> np.ndarray:
    """Where each of `count` buckets over `n` samples starts: the one bucket rule of every time-axis decimation
    (this one and stage_view._envelope). As ``np.array_split``: the first ``n % count`` buckets are one sample
    longer. `count` is at most `n`, at least 1."""
    width, remainder = divmod(n, count)
    sizes = np.full(count, width)
    sizes[:remainder] += 1
    return np.concatenate(([0], np.cumsum(sizes[:-1]))).astype(int)


def bucket_edges(n: int, count: int) -> np.ndarray:
    """``bucket_starts`` with ``n`` appended: the edges of `count` buckets over `n` samples (``[0]`` without any)."""
    if n <= 0 or count <= 0:
        return np.array([0])
    return np.append(bucket_starts(n, min(count, n)), n)


def bucket_extremes(samples: np.ndarray, point_limit: int) -> tuple[np.ndarray, np.ndarray]:
    """Per bucket (``bucket_starts``) of at most ``point_limit`` buckets over ``samples``: the index of its lowest
    sample and the index of its highest one, as two arrays (the first of equal samples; a NaN counts as both).

    They are indices into ``samples``, never times. Whoever draws them asks the samples' own axis for the x of each
    index (stage_view.FrameReading.x_at, or sample / samples for the lanes below), so a drawn point is at the x of
    the sample it is (docs/display-rules.md R2)."""
    if point_limit > MAX_WAVEFORM_POINTS:
        raise InputError(f"point_limit must not exceed {MAX_WAVEFORM_POINTS}")
    n = len(samples)
    point_count = min(point_limit, n)
    if point_count <= 0:
        return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.int64)
    starts = bucket_starts(n, point_count)
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
    return minimum_indices, maximum_indices


def decimated_waveform(
    samples: np.ndarray,
    point_limit: int,
    start_sample: int,
    total_samples: int,
) -> WaveformEnvelope:
    """The track lanes' waveform: per bucket its lowest and highest sample (``bucket_extremes``), each with its
    place in the file.

    minT/maxT are places in the whole file as a fraction, 0 to 1: sample index / ``total_samples``. A sample's time
    is index / fs and the file lasts total_samples / fs, so the fraction times the duration is the sample's own
    time. They are fractions of the duration only: never multiply them by any other span (the time from the first
    sample to the last is one sample shorter). A picture on an axis in seconds takes ``bucket_extremes`` and its own
    axis instead (stage_view.samples_waveform).
    """
    minimum_indices, maximum_indices = bucket_extremes(samples, point_limit)
    n = len(samples)
    if n == 0:
        return {"min": [], "max": [], "minT": [], "maxT": [], "samples": [], "absolutePeak": 0.0}
    if minimum_indices.size == 0:
        return {
            "min": [],
            "max": [],
            "minT": [],
            "maxT": [],
            "samples": [],
            "absolutePeak": absolute_peak(samples),
        }
    # A sample's place in the file's 0..1 is sample / samples, as its time is i / fs of the duration n / fs (and as
    # analyzer.sample_range maps a 0..1 range back to samples).
    denom = max(1, total_samples)
    starts = bucket_starts(n, minimum_indices.size)
    sizes = np.diff(np.append(starts, n))
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
        "absolutePeak": absolute_peak(samples),
    }
