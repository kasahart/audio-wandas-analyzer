import numpy as np
import pytest
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
    samples = np.array([0.1, 0.9, -0.8, 0.2,  0.3, -0.1, 0.5, -0.4], dtype=np.float64)
    result = decimated_waveform(samples, 2, 0, 8)
    assert result["max"][0] == pytest.approx(0.9)
    assert result["min"][0] == pytest.approx(-0.8)
    assert result["max"][1] == pytest.approx(0.5)
    assert result["min"][1] == pytest.approx(-0.4)


def test_minT_maxT_are_normalized_to_full_file():
    samples = np.array([0.1, -0.9, 0.3, 0.7], dtype=np.float64)
    result = decimated_waveform(samples, 1, start_sample=100, total_samples=200)
    assert result["minT"][0] == pytest.approx(101 / 199)
    assert result["maxT"][0] == pytest.approx(103 / 199)


def test_minT_within_0_1():
    samples = np.random.default_rng(42).uniform(-1, 1, 1000)
    result = decimated_waveform(samples, 50, 0, 1000)
    assert all(0.0 <= t <= 1.0 for t in result["minT"])
    assert all(0.0 <= t <= 1.0 for t in result["maxT"])


def test_absolute_peak():
    samples = np.array([0.3, -0.9, 0.5], dtype=np.float64)
    result = decimated_waveform(samples, 3, 0, 3)
    assert result["absolutePeak"] == pytest.approx(0.9)


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
