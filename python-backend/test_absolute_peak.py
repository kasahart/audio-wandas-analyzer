import numpy as np
import pytest

from conftest import assert_not_drawn
from services.analyzer import absolute_peak


def test_absolute_peak():
    samples = np.array([0.3, -0.9, 0.5], dtype=np.float64)
    assert absolute_peak(samples) == pytest.approx(0.9)


def test_absolute_peak_is_every_samples_not_a_line_thinned_by_averaging():
    # One sample far above a quiet tone: the peak is that sample's, not what 50 averaged points would show.
    samples = 0.1 * np.sin(np.arange(5000) * 0.3)
    samples[3210] = -0.95
    peak = absolute_peak(samples)
    assert peak == pytest.approx(0.95)
    averaged = np.abs(samples.reshape(50, -1).mean(axis=1))
    assert_not_drawn(peak, float(averaged.max()))


def test_all_zero_signal_reports_positive_zero_peak():
    import math

    peak = absolute_peak(np.zeros(100))
    assert peak == 0.0
    assert math.copysign(1.0, peak) == 1.0
