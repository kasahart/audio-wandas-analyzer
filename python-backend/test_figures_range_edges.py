"""A line crossing a range across narrower than one bin, or holding one bin, is drawn to the frame's edges as the old
overlay drew it (its strokes, recorded in tests/fixtures/figure_overlay_cases.json ``range_edges``); a read reads only
a point inside the confirmed range across, and with none there reads nothing (the old path read the bin outside; that
is changed on purpose).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from figures.pick import PickLine, PointerAsk, pick
from figures.thinning import drawn_line

FIXTURE = json.loads((Path(__file__).parent / "tests" / "fixtures" / "figure_overlay_cases.json").read_text())
SCENE = FIXTURE["scenes"]["spectrum"]
CASES = FIXTURE["range_edges"]
NON_FINITE = {"nan": math.nan, "inf": math.inf, "-inf": -math.inf}


def _line(line: str) -> tuple[np.ndarray, np.ndarray]:
    spec = SCENE["lines"][line]
    return np.asarray(spec["xs"], dtype=np.float64), np.asarray(
        [NON_FINITE[v] if isinstance(v, str) else float(v) for v in spec["values"]], dtype=np.float64
    )


def _px(view: dict[str, Any], xs: np.ndarray, values: np.ndarray) -> list[tuple[float, float] | None]:
    """The places (px from the frame's top left) of drawn points on the old pane's axes; a gap as None."""
    (x0, x1), (y0, y1), box = view["x"], view["y"], view["box"]
    out: list[tuple[float, float] | None] = []
    for x, value in zip(xs.tolist(), values.tolist(), strict=True):
        if not math.isfinite(value):
            out.append(None)
            continue
        out.append(
            (box["width"] * math.log(x / x0) / math.log(x1 / x0), box["height"] * (1 - (value - y0) / (y1 - y0)))
        )
    return out


def _y_at(points: list[tuple[float, float] | None], x: float) -> float | None:
    """The drawn line's height at ``x`` px (the straight segment between two drawn points there), or None."""
    for a, b in zip(points, points[1:], strict=False):
        if a is not None and b is not None and min(a[0], b[0]) <= x <= max(a[0], b[0]) and a[0] != b[0]:
            return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
    return None


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_a_line_across_a_range_narrower_than_a_bin_is_drawn_to_the_frame_edges_as_the_old_overlay_drew_it(
    case: dict[str, Any],
) -> None:
    for pane, view in case["expected"].items():
        for line, strokes in view["drawn"].items():
            xs, values = _line(line)
            drawn = drawn_line(xs, values, tuple(view["x"]), view["box"]["width"], True, line != "delta")
            wire_xs, wire_values = drawn.wire_points()  # type: ignore[attr-defined]
            got_xs = np.asarray(wire_xs, dtype=np.float64)
            got_values = np.asarray([math.nan if v is None else v for v in wire_values], dtype=np.float64)
            points = _px(view, got_xs, got_values)
            assert strokes, f"{case['id']} {pane} {line}: the old overlay drew the line"
            for stroke in strokes:
                for vertex in stroke:
                    if vertex["index"] is not None:
                        # An answer point the old overlay drew is drawn.
                        assert float(xs[vertex["index"]]) in got_xs.tolist(), (case["id"], line, vertex)
                    else:
                        # Where the old overlay cut the line at the frame, the line drawn now passes within 0.5 px.
                        y = _y_at(points, vertex["x_px"])
                        assert y is not None and abs(y - vertex["y_px"]) < 0.5, (case["id"], line, vertex, y)


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_a_read_in_such_a_range_reads_only_a_point_inside_it_and_with_none_there_nothing(case: dict[str, Any]) -> None:
    view = case["expected"]["overlay"]
    (x0, x1), (y0, y1), box = view["x"], view["y"], view["box"]
    lines = [PickLine(line, *_line(line), silent_floor=True) for line in ("median", "compare", "other")]
    scale = (box["width"] / math.log(x1 / x0), box["height"] / (y1 - y0))
    middle = PointerAsk(math.sqrt(x0 * x1), (y0 + y1) / 2, *scale)
    got = pick(lines, middle, (x0, x1), (y0, y1), True)
    old = view["read"]
    if old is not None and not x0 <= old["at"] <= x1:
        # The old path read a bin outside the range, its mark held at the edge: a point not inside what is shown.
        assert got.status == "outside" and got.point is None
    elif old is None:
        assert got.point is None
    else:
        # Inside the range, the old read stands.
        assert got.point is not None and (got.point.line, got.point.index) == (old["line"], old["index"])


def test_a_range_specified_at_one_end_is_never_inverted_when_the_answers_move_past_it() -> None:
    """The automatic other end widened from the specified end by the rule in ranges.py, one place."""
    from figures.ranges import Ends, confirmed_range

    xs = np.geomspace(20, 8000, 64)
    loud = [(xs, np.full(xs.size, -32.0))]
    # Automatic (−35, −30); the top typed at −60 dB: the bottom is not −35 (above the top), it is under −60.
    level = confirmed_range(loud, "level", False, (20.0, 8000.0), Ends(None, None), Ends(None, -60.0))
    assert level.y[1] == -60.0 and level.y[0] < level.y[1]
    # The bottom typed above the answers' top: the top is above it.
    level = confirmed_range(loud, "level", False, (20.0, 8000.0), Ends(None, None), Ends(-20.0, None))
    assert level.y[0] == -20.0 and level.y[1] > level.y[0]
    # A Δ's one typed end past the automatic other one, and the axis across's low end past the limits' top.
    delta = confirmed_range(
        [(xs, np.full(xs.size, 3.0))], "level", True, (20.0, 8000.0), Ends(None, None), Ends(7.0, None)
    )
    assert delta.y[0] == 7.0 and delta.y[1] > 7.0
    across = confirmed_range(loud, "level", False, (20.0, 8000.0), Ends(9000.0, None), Ends(None, None))
    assert across.x[0] == 9000.0 and across.x[1] > 9000.0
    # Away from the crossing, the rule is today's: the bottom at most 100 dB under a typed top.
    assert confirmed_range(loud, "level", False, (20.0, 8000.0), Ends(None, None), Ends(None, -10.0)).y == (
        -35.0,
        -10.0,
    )


@pytest.mark.parametrize(
    ("values", "broken_at"),
    [
        ([-40.0, -300.0, -40.0, -40.0], 200.0),  # silence between the outside neighbour (100 Hz) and the range
        ([-40.0, -40.0, -300.0, -40.0], 300.0),  # mirrored: between the range and the neighbour past it (400 Hz)
        ([-40.0, math.nan, -40.0, -40.0], 200.0),  # a missing value there
    ],
)
def test_a_silent_or_missing_point_between_an_outside_neighbour_and_the_range_breaks_the_line(
    values: list[float], broken_at: float
) -> None:
    """The neighbour outside each end is added before the gap rule, so no line is drawn over silence."""
    xs = np.asarray([100.0, 200.0, 300.0, 400.0])
    wire_xs, wire_values = drawn_line(xs, np.asarray(values), (150.0, 350.0), 600.0, True, True).wire_points()  # type: ignore[attr-defined]
    at = wire_xs.index(broken_at)
    assert wire_values[at] is None, (wire_xs, wire_values)
    # Drawn either side of it: never a segment across it.
    assert all(
        not (a < broken_at < b)
        for a, b, va, vb in zip(wire_xs, wire_xs[1:], wire_values, wire_values[1:], strict=False)
        if va is not None and vb is not None
    )
