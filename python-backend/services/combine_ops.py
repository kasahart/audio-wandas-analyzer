"""Layer 1 operations across recordings that wandas 0.13 lacks: the point-wise median, the level Δ and the quartiles.

The one entry point for them; they were checked against the values the old code gave before it went. Whether they
go into wandas-extras is decided apart; until then every caller takes them from here, so the swap is one import.

The rules are 第 1 節「答えを作る順序」 of the design:

- every operation computes in float64, whatever the input's precision;
- the median is taken point by point; a point where any recording has no value (NaN) has none; an even count takes
  the mean of the two middle values; one recording is its own values (no median is taken);
- the quartiles are linear (position = (count − 1) × p), none for fewer than three recordings, none where any lacks;
- a level Δ is the difference of the dB values, compare − base (never a Frame subtraction, which is of amplitudes);
- a Δ of plain values (an RMS over time, a coherence, a cepstrum, a correlation) is compare − base of the values;
- over time, recordings of other lengths are combined over the part every one of them has, from their first point
  (``common_length``); on any other axis they are combined only on the same points (the 2 層目 sees to that);
- −300 dB replaces a level's NaN and −inf, +300 dB its +inf (``floored_db``, as stage_view.floored_db): applied to
  each recording's dB values and after a power mean, never to a series already in dB, never to a Δ.

These functions take arrays of answers and return answers. They know nothing of a figure (the 2 層目 decides which
recordings they are given: figures/members.py).
"""

from __future__ import annotations

import warnings
from collections.abc import Sequence

import numpy as np

#: The design's level floor (第 1 節: NaN and −inf → −300 dB, +inf → +300 dB). The same value as
#: analysis_spec.MIN_LEVEL_DB, which stage_view.floored_db uses when it reads a Frame.
FLOOR_DB = -300.0


def floored_db(levels: np.ndarray) -> np.ndarray:
    """``levels`` (dB) with NaN and −inf at −300 dB and +inf at +300 dB, nothing below −300 dB; float64."""
    values = np.asarray(levels, dtype=np.float64)
    replaced = np.nan_to_num(values, nan=FLOOR_DB, neginf=FLOOR_DB, posinf=-FLOOR_DB)
    return np.maximum(replaced, FLOOR_DB)


def median(rows: Sequence[np.ndarray]) -> np.ndarray:
    """The recordings' point-by-point median (each row one recording, all of one length), float64.

    NaN where any recording has no value; with an even count, the mean of the two middle values; one recording: a
    copy of its own values. The result does not depend on the order of ``rows``."""
    if not rows:
        raise ValueError("a median of no recordings")
    stacked = np.stack([np.asarray(row, dtype=np.float64) for row in rows])
    if stacked.shape[0] == 1:
        return stacked[0].copy()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        out = np.median(stacked, axis=0)
    out[np.isnan(stacked).any(axis=0)] = np.nan
    return out


def level_delta(compare: np.ndarray, base: np.ndarray) -> np.ndarray:
    """The level Δ in dB, compare − base, point by point (NaN where either has none), float64. Not floored."""
    return np.asarray(compare, dtype=np.float64) - np.asarray(base, dtype=np.float64)


def difference(compare: np.ndarray, base: np.ndarray) -> np.ndarray:
    """The Δ of plain values, compare − base, point by point (NaN where either has none), float64. The arithmetic
    is ``level_delta``'s; the name says what is subtracted (values, not levels)."""
    return np.asarray(compare, dtype=np.float64) - np.asarray(base, dtype=np.float64)


def signal_difference(compare: np.ndarray, base: np.ndarray) -> np.ndarray:
    """The Δ of two time signals, compare − base, sample by sample over the samples both have, in the samples' own
    type (never the whole recording as float64; the old ``combine``'s ``compare.values - base.values``). The caller
    has said they are sample for sample (the same rate, starts within half a sample, one unit and reference)."""
    count = min(len(compare), len(base))
    return np.asarray(compare)[:count] - np.asarray(base)[:count]


def common_length(rows: Sequence[np.ndarray]) -> list[np.ndarray]:
    """Each recording's values over the part every one of them has: their first points, as many as the shortest
    has (no copy). Recordings over time of other lengths are combined over it."""
    count = min((len(row) for row in rows), default=0)
    return [row[:count] for row in rows]


def quartiles(rows: Sequence[np.ndarray]) -> np.ndarray | None:
    """(lower, upper) quartile per point, linear; None for fewer than three recordings; NaN where any lacks."""
    stacked = np.stack([np.asarray(row, dtype=np.float64) for row in rows])
    if stacked.shape[0] < 3:
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        out = np.quantile(stacked, [0.25, 0.75], axis=0, method="linear")
    out[:, np.isnan(stacked).any(axis=0)] = np.nan
    return out
