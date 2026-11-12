import numpy as np
import pytest

from conftest import assert_not_drawn
from decimator import decimated_waveform


def test_empty_returns_empty():
    result = decimated_waveform(np.array([]), 100, 0, 1)
    assert result["min"] == []
    assert result["max"] == []
    assert result["minT"] == []
    assert result["maxT"] == []
    assert result["absolutePeak"] == 0.0


def test_fewer_samples_than_buckets_returns_all():
    samples = np.array([0.1, -0.5, 0.3], dtype=np.float64)
    result = decimated_waveform(samples, 100, 0, 3)
    assert len(result["min"]) == 3
    assert len(result["max"]) == 3


def test_min_max_values_are_correct():
    samples = np.array([0.1, 0.9, -0.8, 0.2, 0.3, -0.1, 0.5, -0.4], dtype=np.float64)
    result = decimated_waveform(samples, 2, 0, 8)
    assert result["max"][0] == pytest.approx(0.9)
    assert result["min"][0] == pytest.approx(-0.8)
    assert result["max"][1] == pytest.approx(0.5)
    assert result["min"][1] == pytest.approx(-0.4)


def test_minT_maxT_are_normalized_to_full_file():
    samples = np.array([0.1, -0.9, 0.3, 0.7], dtype=np.float64)
    result = decimated_waveform(samples, 1, start_sample=100, total_samples=200)
    # Sample i of n is at i / n of the file: times its duration n / fs, i / fs (wandas' frame.time).
    assert result["minT"][0] == pytest.approx(101 / 200)
    assert result["maxT"][0] == pytest.approx(103 / 200)


def test_minT_within_0_1():
    samples = np.random.default_rng(42).uniform(-1, 1, 1000)
    result = decimated_waveform(samples, 50, 0, 1000)
    assert all(0.0 <= t <= 1.0 for t in result["minT"])
    assert all(0.0 <= t <= 1.0 for t in result["maxT"])


def test_absolute_peak():
    samples = np.array([0.3, -0.9, 0.5], dtype=np.float64)
    result = decimated_waveform(samples, 3, 0, 3)
    assert result["absolutePeak"] == pytest.approx(0.9)


def test_absolute_peak_is_every_samples_not_a_line_thinned_by_averaging():
    # One sample far above a quiet tone, thinned to 50 points: the peak is that sample's.
    samples = 0.1 * np.sin(np.arange(5000) * 0.3)
    samples[3210] = -0.95
    result = decimated_waveform(samples, 50, 0, 5000)
    assert len(result["max"]) < samples.size
    assert result["absolutePeak"] == pytest.approx(0.95)
    averaged = np.abs(samples.reshape(50, -1).mean(axis=1))
    assert_not_drawn(result["absolutePeak"], float(averaged.max()))


def test_point_limit_zero_returns_empty():
    result = decimated_waveform(np.array([1.0, 2.0, 3.0]), 0, 0, 3)
    assert result["min"] == []
    assert result["maxT"] == []


def test_minT_within_0_1_with_offset():
    rng = np.random.default_rng(0)
    samples = rng.uniform(-1, 1, 500)
    result = decimated_waveform(samples, 50, start_sample=500, total_samples=1000)
    assert all(0.0 <= t <= 1.0 for t in result["minT"])
    assert all(0.0 <= t <= 1.0 for t in result["maxT"])


@pytest.mark.parametrize("length,points", [(1, 1), (7, 3), (10, 6), (31, 8), (53, 100)])
def test_vectorized_buckets_preserve_extrema_positions_and_midpoints(length, points):
    samples = np.random.default_rng(7).integers(-2, 3, length).astype(float)
    result = decimated_waveform(samples, points, 23, 150)
    buckets = np.array_split(np.arange(length), min(length, points))
    np.testing.assert_equal(result["min"], [samples[b].min() for b in buckets])
    np.testing.assert_equal(result["max"], [samples[b].max() for b in buckets])
    np.testing.assert_equal(result["minT"], [(23 + b[samples[b].argmin()]) / 150 for b in buckets])
    np.testing.assert_equal(result["maxT"], [(23 + b[samples[b].argmax()]) / 150 for b in buckets])
    np.testing.assert_equal(result["samples"], [samples[b[len(b) // 2]] for b in buckets])


def test_decimation_point_limit_bounds_work_and_accepts_the_boundary():
    samples = np.ones(33000)
    assert len(decimated_waveform(samples, 32768, 0, len(samples))["min"]) == 32768
    with pytest.raises(ValueError, match="32768"):
        decimated_waveform(samples, 32769, 0, len(samples))


def test_vectorized_extrema_keep_first_nan_positions():
    samples = np.array([1.0, np.nan, np.nan, -1.0])
    result = decimated_waveform(samples, 1, 0, 4)
    assert np.isnan(result["min"][0])
    assert np.isnan(result["max"][0])
    assert result["minT"] == result["maxT"] == [1 / 4]


@pytest.mark.parametrize("first", [0.0, -0.0])
def test_equal_extrema_preserve_the_first_signed_zero(first):
    samples = np.array([first, -first])
    result = decimated_waveform(samples, 1, 0, 2)
    assert np.signbit(result["min"][0]) == np.signbit(first)
    assert np.signbit(result["max"][0]) == np.signbit(first)
    assert result["minT"] == result["maxT"] == [0.0]


@pytest.mark.parametrize("points", [1, 3, 8192])
def test_long_waveforms_keep_bounded_scratch_and_cross_block_extrema(monkeypatch, points):
    samples = np.random.default_rng(3).integers(-3, 4, 200003).astype(float)
    samples[65535:65538] = [10, -10, np.nan]
    samples[131072] = np.nan
    original_arange = np.arange
    original_repeat = np.repeat

    def bounded_arange(start, stop=None, *args, **kwargs):
        length = start if stop is None else stop - start
        assert length <= 65536
        return (
            original_arange(start, stop, *args, **kwargs)
            if stop is not None
            else original_arange(start, *args, **kwargs)
        )

    def bounded_repeat(values, repeats, *args, **kwargs):
        assert np.sum(repeats) <= 65536
        return original_repeat(values, repeats, *args, **kwargs)

    monkeypatch.setattr(np, "arange", bounded_arange)
    monkeypatch.setattr(np, "repeat", bounded_repeat)
    result = decimated_waveform(samples, points, 17, 300000)
    buckets = np.array_split(original_arange(len(samples)), points)
    minimum_indices = [b[np.argmin(samples[b])] for b in buckets]
    maximum_indices = [b[np.argmax(samples[b])] for b in buckets]
    np.testing.assert_equal(result["min"], samples[minimum_indices])
    np.testing.assert_equal(result["max"], samples[maximum_indices])
    np.testing.assert_equal(result["minT"], (17 + np.array(minimum_indices)) / 300000)
    np.testing.assert_equal(result["maxT"], (17 + np.array(maximum_indices)) / 300000)
    np.testing.assert_equal(result["samples"], [samples[b[len(b) // 2]] for b in buckets])
    # The peak is of the samples with a value: a NaN is a gap (R2), no peak (and no NaN the wire could not carry).
    assert result["absolutePeak"] == 10.0


def test_all_zero_signal_reports_positive_zero_peak():
    import math

    result = decimated_waveform(np.zeros(100), 10, 0, 100)
    assert result["absolutePeak"] == 0.0
    assert math.copysign(1.0, result["absolutePeak"]) == 1.0


@pytest.mark.parametrize("n,count", [(1, 1), (7, 3), (10, 6), (31, 8), (1000, 7), (48000, 1024)])
def test_bucket_starts_follow_array_split(n, count):
    from decimator import bucket_starts

    expected = [part[0] for part in np.array_split(np.arange(n), count)]
    np.testing.assert_equal(bucket_starts(n, count), expected)


@pytest.mark.parametrize("n,points", [(7, 4), (31, 8), (1001, 64), (48000, 1024)])
def test_every_time_decimation_shares_the_bucket_rule(n, points):
    """The lanes' waveform (decimated_waveform) and the comparison's lines (stage_view._envelope) put the same
    samples in a bucket and keep the same points: each bucket's lowest and highest sample, each at its own place."""
    from stage_view import _envelope

    xs = np.arange(n, dtype=float)
    values = np.random.default_rng(n).normal(size=n)
    count = points // 2
    parts = np.array_split(values, count)
    waveform = decimated_waveform(values, count, 0, n)
    np.testing.assert_allclose(waveform["min"], [part.min() for part in parts])
    np.testing.assert_allclose(waveform["max"], [part.max() for part in parts])
    at = np.round(np.concatenate([waveform["minT"], waveform["maxT"]]) * n).astype(int)
    line_xs, line_values = _envelope(xs, values, points)
    np.testing.assert_equal(line_xs, np.unique(at))
    np.testing.assert_equal(line_values, values[np.unique(at)])


@pytest.mark.parametrize("n,buckets", [(100, 30), (1001, 64), (2000, 1024)])
def test_a_difference_line_on_a_time_axis_buckets_as_the_lines_it_compares(n, buckets):
    """Compare's Δ of a level series or cepstrum (difference_line → min_max_indices, linear axis) splits the samples
    at the same places as each recording's own line (_envelope)."""
    from decimator import bucket_edges, bucket_starts
    from stage_view import min_max_indices

    xs = np.arange(n, dtype=float)
    values = np.random.default_rng(n).normal(size=n)
    picked = min_max_indices(xs, values, buckets, False)
    edges = bucket_edges(n, buckets)
    np.testing.assert_equal(edges[:-1], bucket_starts(n, buckets))
    owner = np.searchsorted(edges, picked, side="right") - 1
    for bucket, (start, end) in enumerate(zip(edges[:-1], edges[1:], strict=True)):
        mine = picked[owner == bucket]
        part = values[start:end]
        assert values[mine].min() == part.min() and values[mine].max() == part.max()


def test_bucket_edges_cover_every_sample_once():
    from decimator import bucket_edges

    assert bucket_edges(0, 5).tolist() == [0]
    assert bucket_edges(10, 0).tolist() == [0]
    assert bucket_edges(3, 10).tolist() == [0, 1, 2, 3]
    assert bucket_edges(10, 3).tolist() == [0, 4, 7, 10]


@pytest.mark.parametrize("frames,columns", [(7, 4), (31, 8), (1001, 64), (48000, 1024)])
def test_a_lanes_spectrogram_columns_share_the_bucket_rule(frames, columns):
    """The track lanes' spectrogram puts the same STFT frames in a column as every other time axis puts samples in
    a bucket (decimator.bucket_starts, np.array_split's), and each column's time is its frames' mean centre."""
    from analyzer import _mean_power_db, _resample_time_bins, _resample_time_centers

    levels = np.random.default_rng(frames).normal(-40, 10, size=(frames, 3))
    centres = np.arange(frames) * 0.01 + 0.005
    groups = np.array_split(np.arange(frames), columns)
    np.testing.assert_allclose(
        _resample_time_bins(levels, columns), [_mean_power_db(levels[group], axis=0) for group in groups]
    )
    np.testing.assert_allclose(_resample_time_centers(centres, columns), [centres[group].mean() for group in groups])
