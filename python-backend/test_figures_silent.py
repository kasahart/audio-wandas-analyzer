"""The silent floor the new overlay draws, held to what the old overlay drew.

Old path: stagePanes.ts ``silent`` (a level at or below −250 dB lifts the pen: a gap, never joined across; a Δ has
no floor and is drawn) over the backend's thinned line; the old path's own test of the Δ went with its ``combine``.
"""

from __future__ import annotations

import numpy as np

from figures.levels import SILENT_DB
from figures.thinning import drawn_line


def _points(drawn: object) -> tuple[np.ndarray, np.ndarray]:
    """What the picture sends (Drawn.wire_points): a gap as None, here NaN."""
    xs, values = drawn.wire_points()  # type: ignore[attr-defined]
    return np.asarray(xs), np.array([np.nan if v is None else v for v in values], dtype=np.float64)


def _xs() -> np.ndarray:
    return np.linspace(20.0, 20000.0, 400)


def test_a_levels_silent_stretch_is_drawn_as_a_gap_never_joined_across() -> None:
    values = np.full(400, -40.0)
    values[150:200] = -300.0  # the backend's floor (floored_db) for silence
    drawn = drawn_line(_xs(), values, (20.0, 20000.0), 900.0, True, silent_floor=True)
    xs, ys = _points(drawn)
    silent_xs = _xs()[150:200]
    inside = (xs >= silent_xs[0]) & (xs <= silent_xs[-1])
    assert inside.any() and np.isnan(ys[inside]).all()
    assert not (ys[np.isfinite(ys)] <= SILENT_DB).any()
    assert np.isfinite(ys[xs < silent_xs[0]]).all() and np.isfinite(ys[xs > silent_xs[-1]]).all()


def test_a_level_exactly_at_the_floor_is_silent_and_just_above_it_is_drawn() -> None:
    values = np.full(400, -40.0)
    values[100] = SILENT_DB
    values[300] = SILENT_DB + 0.5
    drawn = drawn_line(_xs(), values, (20.0, 20000.0), 2000.0, False, silent_floor=True)
    xs, ys = _points(drawn)
    assert np.isnan(ys[xs == _xs()[100]]).all()
    assert (ys[xs == _xs()[300]] == SILENT_DB + 0.5).all()


def test_a_delta_has_no_floor_its_minus_260_db_is_drawn() -> None:
    values = np.zeros(400)
    values[150:200] = -260.0
    drawn = drawn_line(_xs(), values, (20.0, 20000.0), 900.0, True, silent_floor=False)
    _, ys = _points(drawn)
    assert np.isfinite(ys).all() and (ys == -260.0).any()
