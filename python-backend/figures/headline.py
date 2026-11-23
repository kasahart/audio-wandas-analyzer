"""計算オ: the point a Δ lane's headline names (見出しに出す点を選ぶ). The one function is ``delta_peak``.

The rule for a line's Δ: of the Δ's answer before any thinning (rule B:
never drawn points), inside the confirmed range across, leaving out the points with no value and, where across is
a frequency or a quefrency, every point at or under 0 (0 Hz, a cepstrum's first coefficient), the point of the
largest |Δ|; a tie goes to the first point (第 1 節: 先の点). It returns the point's name; the picture carries the
point as a read does (line, index, place across, the step of the data there and its unrounded answer).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from figures.pick import data_step


@dataclass(frozen=True)
class Headline:
    line: str
    index: int
    x: float
    x_step: float | None
    value: float


def signal_peak(
    line: str, start: float, rate: float, values: np.ndarray, x_range: tuple[float, float]
) -> Headline | None:
    """The Δ headline's point of a time signal's Δ ``line`` (sample n at ``start + n / rate``) inside ``x_range``: of
    its highest and its lowest sample there (the first of each), the one of the larger magnitude, the highest at a
    tie. Only the samples in the range are looked at, where they lie.
    None with no value there."""
    count = int(len(values))
    if not count or not rate > 0:
        return None
    first = max(0, min(count, int(math.ceil((min(x_range) - start) * rate - 1e-9))))
    after = max(first, min(count, int(math.floor((max(x_range) - start) * rate + 1e-9)) + 1))
    part = np.asarray(values)[first:after]
    if not part.size:
        return None
    if np.isnan(part.max()):
        if np.all(np.isnan(part)):
            return None
        high, low = int(np.nanargmax(part)), int(np.nanargmin(part))
    else:
        high, low = int(part.argmax()), int(part.argmin())
    index = high if abs(float(part[high])) >= abs(float(part[low])) else low
    at = first + index
    return Headline(line, at, start + at * (1.0 / rate), 1.0 / rate, float(part[index]))


def delta_peak(
    line: str, xs: np.ndarray, values: np.ndarray, x_range: tuple[float, float], positive: bool
) -> Headline | None:
    """The Δ headline's point of the Δ ``line`` (its answer ``xs``, ``values``) inside ``x_range`` (計算オ); None
    with no value there. ``positive``: a point at or under 0 across is left out (a frequency, a quefrency)."""
    xs = np.asarray(xs, dtype=np.float64)
    values = np.asarray(values, dtype=np.float64)
    keep = (xs >= min(x_range)) & (xs <= max(x_range)) & np.isfinite(values)
    if positive:
        keep &= xs > 0
    at = np.flatnonzero(keep)
    if not at.size:
        return None
    index = int(at[int(np.argmax(np.abs(values[at])))])
    return Headline(line, index, float(xs[index]), data_step(xs, index), float(values[index]))
