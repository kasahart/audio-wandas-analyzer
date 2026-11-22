"""Display rules R2 and R3 on the figure service's lines (figures/thinning.py ``drawn_line``, 計算ウ).

A line with more points than the screen has pixels keeps each bucket's lowest and highest point, each at its own x;
a point with no value is a break, never joined across; a zoom is made of the answer's own points in the range on
screen. These are the cases the old path's thinning was held to (the same expected bins and levels), asked of the
one place that thins a line now.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest
import wandas as wd

from figures.thinning import LINE_BUCKETS_PER_PX, POOLS, _min_max_indices, _pooled_columns, drawn_line
from frames.stage_view import read_frame

RATE = 16000
CASES = json.loads((Path(__file__).parent / "tests/fixtures/line_thinning_cases.json").read_text(encoding="utf-8"))

_GAP_FIX = (
    "R2 (docs/display-rules.md) broke: a value that is not finite is a gap, and a line is never joined across it. "
    "figures/thinning.py keeps, between two drawn points with a gap between them, the gap's first point as a break "
    "(sent as null)."
)


def _points(xs: np.ndarray, values: np.ndarray, across: tuple[float, float], width: float, log: bool) -> tuple:
    """The points drawn of a line as the picture sends them: xs, and values with a gap as None."""
    return drawn_line(xs, values, across, width, log, silent_floor=False).wire_points()  # type: ignore[attr-defined]


def _joins_across(xs: list[float], values: list[float | None], gap: tuple[float, float]) -> list[tuple[float, float]]:
    """The drawn segments between two drawn points with a value whose span reaches into the gap ``gap`` (xs)."""
    joined = []
    for (x0, v0), (x1, v1) in zip(zip(xs, values, strict=True), zip(xs[1:], values[1:], strict=True), strict=False):
        if v0 is not None and v1 is not None and x0 < gap[1] and x1 > gap[0]:
            joined.append((x0, x1))
    return joined


@pytest.fixture(scope="module")
def spectrum() -> tuple[np.ndarray, np.ndarray]:
    """A whole-file FFT of a 1 kHz tone with noise: far more bins (16,001) than a screen has pixels."""
    rng = np.random.default_rng(3)
    tone = 0.5 * np.sin(2 * np.pi * 1000 * np.arange(RATE * 2) / RATE) + 0.05 * rng.standard_normal(RATE * 2)
    fft = wd.from_numpy(tone[np.newaxis], sampling_rate=RATE).fft()
    return np.asarray(fft.freqs, dtype=np.float64), np.asarray(fft.dB, dtype=np.float64).reshape(-1)


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda case: case["name"])
def test_a_spectrums_buckets_keep_the_recorded_bins(case: dict) -> None:
    # The bins a spectrum keeps in log buckets between the ends of its range: each bucket's lowest and highest, and
    # the first bin of a gap between two kept bins.
    freqs = np.arange(case["bins"]) * case["binHz"]
    values = np.array([np.nan if value is None else value for value in case["values"]], dtype=np.float64)
    low, high = case["span"]
    inside = np.flatnonzero((freqs > 0) & (freqs >= low) & (freqs <= high))
    kept = inside[_min_max_indices(freqs[inside], values[inside], case["buckets"], True, (low, high))]
    assert kept.tolist() == case["expectedBins"]


def test_more_bins_than_the_screen_shows_keep_each_buckets_lowest_and_highest_bin_at_every_zoom(
    spectrum: tuple[np.ndarray, np.ndarray],
) -> None:
    # Each pixel keeps its lowest and highest bin, before a zoom and after it, so a peak keeps its height. A bucket
    # per pixel, never per two: a spectrum's noise floor drawn with a stroke a pixel showed the background between
    # the strokes, unlike every bin drawn. If this fails after LINE_BUCKETS_PER_PX changed, compare on the screen
    # with every bin drawn before moving the bound (docs/display-rules.md R2).
    freqs, levels = spectrum
    width = 800.0
    xs, values = _points(freqs, levels, (20.0, RATE / 2), width, True)
    assert LINE_BUCKETS_PER_PX == 1
    assert 2 * math.ceil(width / 2) < len(xs) <= 2 * math.ceil(width) + 2
    inside = (freqs >= 20.0) & (freqs <= RATE / 2)
    assert max(values) == levels[inside].max() and min(values) == levels[inside].min()
    closer_xs, closer = _points(freqs, levels, (900.0, 1100.0), 300.0, True)
    assert len(closer_xs) <= 2 * 300 + 2 and max(closer) == max(values)
    # Each value is a bin's own level, at that bin's frequency.
    own = dict(zip(freqs.tolist(), levels.tolist(), strict=True))
    assert all(own[x] == value for x, value in zip(closer_xs, closer, strict=True))


def test_a_zoomed_spectrum_is_its_own_bins_in_the_range_on_screen(spectrum: tuple[np.ndarray, np.ndarray]) -> None:
    # With room for every bin on screen, every bin between the ends is drawn (R3), and the nearest one outside each
    # end (the line reaches the frame's edges).
    freqs, levels = spectrum
    xs, values = _points(freqs, levels, (990.0, 1010.0), 800.0, True)
    inside = np.flatnonzero((freqs >= 990.0) & (freqs <= 1010.0))
    assert xs == freqs[inside[0] - 1 : inside[-1] + 2].tolist()
    assert xs[values.index(max(values))] == 1000.0


def test_a_zoomed_spectrums_buckets_are_laid_across_the_view_not_its_bins() -> None:
    # A 16 kHz recording zoomed to the range of a 48 kHz one has bins over only part of the view: its buckets keep
    # the view's width each, as the other recording's do, instead of packing all of them into its own bins.
    freqs = np.arange(1, 8001, dtype=np.float64)
    levels = np.random.default_rng(3).normal(-80, 5, freqs.size)
    xs, _ = _points(freqs, levels, (20.0, 24000.0), 200.0, True)
    edges = np.geomspace(20.0, 24000.0, 201)
    assert len(xs) <= 2 * int(np.sum(edges[:-1] < 8000)) + 1


def test_a_long_cross_correlations_peak_is_drawn_at_its_own_lag() -> None:
    # 96,001 lags over ±3 s are drawn as each bucket's lowest and highest lag, each at its own lag (R2): a 1 ms and
    # a 2 ms delay peak at 1 ms and 2 ms, not at their buckets' centres.
    signal = np.random.default_rng(1).standard_normal(64000)
    for delay in (16, 32):
        frame = wd.from_numpy(np.vstack([signal, np.roll(signal, delay)]), sampling_rate=RATE)
        reading = read_frame(frame.cross_correlation(max_lag=3.0))
        assert reading is not None and reading.xs.size == 96001
        xs, drawn = _points(reading.xs, reading.values, (-3.0, 3.0), 1200.0, False)
        assert len(xs) <= 2 * 1200
        assert xs[drawn.index(max(drawn))] == pytest.approx(delay / RATE)


@pytest.mark.parametrize("zoom", [(0.0, 6.0), (1.0, 5.0), (2.4, 2.6), (3.2, 3.3), (2.45, 3.3)])
def test_a_line_with_a_stretch_of_no_values_is_drawn_with_a_break_there_at_every_zoom(
    zoom: tuple[float, float],
) -> None:
    # A line of 6 s with no value (NaN) from 2.5 s to 3.25 s: drawn whole and zoomed, it breaks over the gap.
    rate = 8000
    times = np.arange(6 * rate) / rate
    samples = np.sin(np.arange(6 * rate) / 10.0)
    samples[int(2.5 * rate) : int(3.25 * rate)] = np.nan
    gap = (2.5 - 1 / rate, 3.25)
    xs, values = _points(times, samples, zoom, 600.0, False)
    assert not _joins_across(xs, values, gap), f"{_GAP_FIX} Joined: {_joins_across(xs, values, gap)[:3]}"
    over = [value for x, value in zip(xs, values, strict=True) if gap[0] < x < gap[1]]
    assert all(value is None for value in over), f"{_GAP_FIX} Over the gap: {over[:5]}"
    if zoom[0] < gap[0] and zoom[1] > gap[1]:
        assert any(x < gap[0] for x in xs) and any(x > gap[1] for x in xs), "the line is drawn on both sides of the gap"
        assert over, f"{_GAP_FIX} No break is drawn over the gap"


@pytest.mark.parametrize("buckets", [4, 16, 64, 400])
@pytest.mark.parametrize("log", [False, True])
def test_a_thinned_line_keeps_a_break_at_each_gap_in_either_scale_and_buckets_stay_where_they_are(
    buckets: int, log: bool
) -> None:
    # Two gaps (NaN, then +inf) in a line of 2000 points: in buckets of a linear or a log axis, at every bucket count,
    # the drawn line breaks at each gap (its first point kept as null) and no two drawn points are joined across one.
    xs = np.arange(1, 2001, dtype=np.float64)
    values = np.cos(xs / 7.0)
    values[400:700] = np.nan
    values[1500:1503] = np.inf
    kept = _min_max_indices(xs, values, buckets, log, (1.0, 2000.0))
    drawn_x = xs[kept].tolist()
    sent = [float(value) if np.isfinite(value) else None for value in values[kept]]
    for low, high in [(400, 700), (1500, 1503)]:
        gap = (float(xs[low - 1]), float(xs[high]))
        assert not _joins_across(drawn_x, sent, gap), f"{_GAP_FIX} Joined across {gap}"
        both_sides = any(x < gap[0] for x in drawn_x) and any(x > gap[1] for x in drawn_x)
        assert not both_sides or (float(xs[low]) in drawn_x and sent[drawn_x.index(float(xs[low]))] is None), (
            f"{_GAP_FIX} The gap from x {xs[low]}, with the line drawn on both sides of it, has no break drawn"
        )
    if not log and buckets < 1000:
        # On a linear axis the buckets are over every point (equal in count, so equally wide here): a gap does not
        # move the buckets after it. The bucket of x 1800 holds the same points with and without the gaps.
        whole = xs[_min_max_indices(xs, np.cos(xs / 7.0), buckets, False, (1.0, 2000.0))].tolist()
        assert [x for x in whole if x > 1600] == [x for x in drawn_x if x > 1600], "a gap moved the linear buckets"


@pytest.mark.parametrize("pooling", ["level", "value", "signed"])
def test_an_images_columns_pooled_in_one_pass_are_each_blocks_own_pool(pooling: str) -> None:
    """A picture's column blocks are pooled in one pass over the part of the answer on screen (a scroll step asks a
    picture of thousands of columns). Each drawn cell is what the pool of its block alone gives (POOLS): one of the
    answer's own cells, a block of no value the floor (a level) or no value, as float64 whatever the answer is kept
    as."""
    rng = np.random.default_rng(7)
    plane = (rng.standard_normal((9, 40)) * 30 - 40).astype(np.float32)
    plane[2, 5:9] = np.nan  # a whole block of no value on one row
    plane[4, 11] = np.nan
    plane[6, 20] = -np.inf
    plane[7, 21] = np.inf
    blocks = [(0, 5), (5, 9), (9, 10), (10, 23), (23, 37)]
    pooled = _pooled_columns(plane, blocks, pooling)
    each = np.stack([POOLS[pooling](plane[:, a:b].astype(np.float64), axis=1) for a, b in blocks], axis=1)
    assert pooled.dtype == np.float64
    assert pooled.shape == (9, len(blocks))
    np.testing.assert_array_equal(pooled, each)
