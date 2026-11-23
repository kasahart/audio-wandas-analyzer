"""The operations across recordings (services/combine_ops.py) keep float64 whatever the recordings' precision.

The figure service's medians and differences are made of these (transport/figure_answers.py). The rule is 第 1 節
「答えを作る順序」 of docs/figure-design.md: every operation computes in float64.
"""

from __future__ import annotations

import numpy as np

from services.combine_ops import difference, level_delta, median

STEP = 2.0**-24


def test_a_median_of_float32_recordings_is_taken_in_float64() -> None:
    """Of 0.5 and 0.5 + 2⁻²⁴ (a float32 step apart) the median is 0.5 + 2⁻²⁵, which float32 rounds to one of them."""
    low, high = np.full(8, 0.5, dtype=np.float32), np.full(8, 0.5 + STEP, dtype=np.float32)
    assert float(np.float32(0.5 + STEP / 2)) != 0.5 + STEP / 2, "float32 holds the median, or this test shows nothing"
    found = median([low, high])
    assert found.dtype == np.float64 and found.tolist() == [0.5 + STEP / 2] * 8


def test_a_difference_from_that_median_is_not_zero() -> None:
    """The Δ of 0.5 + 2⁻²⁴ from the median 0.5 + 2⁻²⁵ is 2⁻²⁵, never 0: of plain values and of levels alike."""
    low, high = np.full(8, 0.5, dtype=np.float32), np.full(8, 0.5 + STEP, dtype=np.float32)
    middle = median([low, high])
    for delta in (difference, level_delta):
        found = delta(high, middle)
        assert found.dtype == np.float64 and found.tolist() == [STEP / 2] * 8, delta.__name__
