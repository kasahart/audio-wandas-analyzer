"""計算エ (figures/pick.py) against the shared tables: every case of tests/fixtures/pick_cases.json and every R7 case of
tests/fixtures/figure_overlay_cases.json (the old overlay's behaviour, recorded before it went), replayed through the
one function ``pick`` with all the lane's lines judged at once.

The new contract changes two things, both listed here case by case (every changed test stays
listed, one by one):

- 仕様 1: a tie goes to the line declared first (median, compare 1, compare 2, ...), never to the draw order. The cases
  of figure_overlay_cases.json marked ``changes_with: "spec1"`` expected the compared line (drawn first in the old R6
  order); they now read the median (``SPEC1_NOW``).
- The pick radius and the plot's side are now the figure service's (they were the webview's alone): pick_cases.json's
  rows the backend could not express (``not_on.py``) are run too, and answer as the table says (``NOW_EXPRESSED``).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from figures.pick import NameAsk, Pick, PickLine, PointerAsk, StepAsk, pick

FIXTURES = Path(__file__).parent / "tests" / "fixtures"
PICK = json.loads((FIXTURES / "pick_cases.json").read_text(encoding="utf-8"))
OVERLAY = json.loads((FIXTURES / "figure_overlay_cases.json").read_text(encoding="utf-8"))
NON_FINITE = {"nan": math.nan, "inf": math.inf, "-inf": -math.inf}

#: pick_cases.json rows the old backend could not express (``not_on.py``) and the figure service now answers, by the
#: reason the table gave: the radius and the plot's side are the service's now, and a step goes by index.
NOW_EXPRESSED = {"radius", "no-from", "no-view", "no-click"}

#: figure_overlay_cases.json R7 cases that 仕様 1 changes: the old answer, and what the service reads now.
SPEC1_NOW = {
    "r7-tie-two-lines": {"old": ("compare", 7), "now": ("median", 7)},
    "r7-tie-under-pointer": {"old": ("compare", 15), "now": ("median", 15)},
}


def _number(value: Any) -> float:
    return math.nan if value is None else float(NON_FINITE.get(value, value))


def _scale(view: dict[str, Any]) -> tuple[float, float]:
    x0, x1 = (float(value) for value in view["x"])
    y0, y1 = (float(value) for value in view["y"])
    span = math.log(x1 / x0) if view["xScale"] == "log" else x1 - x0
    return float(view["box"]["width"]) / span, float(view["box"]["height"]) / (y1 - y0)


def _x_at(view: dict[str, Any], scale_x: float, pixel: float) -> float:
    x0 = float(view["x"][0])
    return x0 * math.exp(pixel / scale_x) if view["xScale"] == "log" else x0 + pixel / scale_x


def _ranges(view: dict[str, Any]) -> tuple[tuple[float, float], tuple[float, float]]:
    return (float(view["x"][0]), float(view["x"][1])), (float(view["y"][0]), float(view["y"][1]))


# --- pick_cases.json ---------------------------------------------------------------------------------------------


def _pick_case(case: dict[str, Any]) -> Pick:
    view = case["view"]
    xs = np.asarray([float(point[0]) for point in case["points"]])
    values = np.asarray([_number(point[1]) for point in case["points"]])
    line = PickLine("line", xs, values, silent_floor=not case["plain"])
    x_range, y_range = _ranges(view)
    log = view["xScale"] == "log"
    if case["mode"] in ("step+", "step-"):
        return pick(
            [line], StepAsk("line", int(case["from"]), 1 if case["mode"] == "step+" else -1), x_range, y_range, log
        )
    scale_x, scale_y = _scale(view)
    pointer = case["pointer"]
    ask = PointerAsk(
        _x_at(view, scale_x, float(pointer["x"])), float(view["y"][1]) - float(pointer["y"]) / scale_y, scale_x, scale_y
    )
    return pick([line], ask, x_range, y_range, log)


@pytest.mark.parametrize("case", PICK["cases"], ids=[case["name"] for case in PICK["cases"]])
def test_every_pick_case_is_read_by_the_figure_service_as_the_table_says(case: dict[str, Any]) -> None:
    cannot = case.get("not_on", {}).get("py")
    assert cannot is None or cannot in NOW_EXPRESSED, f"{case['name']}: a new reason the backend cannot express it"
    got = _pick_case(case)
    expect = case["expect"]
    mode = case["mode"]
    if mode == "nearest":
        # The point within the radius, or (expect null) none within it.
        if expect is None:
            assert got.by != "near", f"{case['name']}: read {got.point} within the radius, the table says none"
        else:
            assert got.by == "near" and got.point is not None and got.point.index == expect, (case["name"], got)
        return
    index = got.point.index if got.point is not None else None
    assert index == expect, f"{case['name']}: the service reads {index} ({got.status}), the table says {expect}"
    if mode == "under" and expect is not None:
        assert got.by == "under", case["name"]
    if expect is None and mode in ("under", "click"):
        # A gap longer than the window answers "no value here" (empty); past the line's ends, outside.
        assert got.status == ("no-value" if case.get("empty") else "outside"), (case["name"], got.status)


# --- figure_overlay_cases.json R7 --------------------------------------------------------------------------------

#: The lines of each pane, in their declared order (仕様 1: base median, compare 1, compare 2).
PANE_LINES = {"overlay": ["median", "compare", "other"], "diff": ["delta"]}


def _overlay_lines(scene: dict[str, Any], pane: str) -> list[PickLine]:
    lines = []
    for name in PANE_LINES[pane]:
        spec = scene["lines"][name]
        xs = np.asarray(spec["xs"], dtype=np.float64)
        values = np.asarray([_number(value) for value in spec["values"]], dtype=np.float64)
        lines.append(PickLine(name, xs, values, silent_floor=pane == "overlay"))
    return lines


def _named(got: Pick) -> tuple[str, int] | str | None:
    if got.point is not None:
        return got.point.line, got.point.index
    return "empty" if got.status == "no-value" else None


def _expected(read: dict[str, Any] | None) -> tuple[str, int] | str | None:
    if read is None:
        return None
    return "empty" if read.get("empty") else (read["line"], int(read["index"]))


OVERLAY_R7 = OVERLAY["r7"]


@pytest.mark.parametrize("case", OVERLAY_R7, ids=[case["id"] for case in OVERLAY_R7])
def test_every_recorded_overlay_read_is_the_figure_services_with_the_tie_to_the_line_declared_first(
    case: dict[str, Any],
) -> None:
    given = case["input"]
    view = given["view"]
    lines = _overlay_lines(OVERLAY["scenes"][given["scene"]], given["pane"])
    x_range, y_range = (float(view["x"][0]), float(view["x"][1])), (float(view["y"][0]), float(view["y"][1]))
    scale_x, scale_y = float(view["scale"]["x"]), float(view["scale"]["y"])
    pointer = given["pointer"]
    ask = PointerAsk(
        _x_at(view, scale_x, float(pointer["x"])), float(view["y"][1]) - float(pointer["y"]) / scale_y, scale_x, scale_y
    )
    log = view["xScale"] == "log"
    got = pick(lines, ask, x_range, y_range, log)
    old = _expected(case["expected"]["ts"]["read"])
    if case.get("changes_with") == "spec1":
        assert case["id"] in SPEC1_NOW, f"{case['id']}: a spec 1 case not listed with its new answer"
        assert old == SPEC1_NOW[case["id"]]["old"], case["id"]
        assert _named(got) == SPEC1_NOW[case["id"]]["now"], (case["id"], got)
    else:
        assert case["id"] not in SPEC1_NOW
        assert _named(got) == old, f"{case['id']}: the service reads {_named(got)}, the old path read {old}"
    # The arrow keys from the point read (the recorded start), one step (b) at a time.
    steps = case["expected"]["ts"].get("steps")
    if steps is None:
        return
    at = old if isinstance(old, tuple) else None
    for step, expect in zip(given["steps"], steps, strict=True):
        assert at is not None
        moved = pick(lines, StepAsk(at[0], at[1], 1 if step > 0 else -1), x_range, y_range, log)
        assert _named(moved) == _expected(expect), (case["id"], step, moved)
        at = _named(moved) if isinstance(_named(moved), tuple) else None  # type: ignore[assignment]


def test_the_spec1_list_is_every_recorded_case_spec1_changes() -> None:
    assert sorted(case["id"] for case in OVERLAY_R7 if case.get("changes_with") == "spec1") == sorted(SPEC1_NOW)


# --- A read's one point, a step of a count of points, and a read by name ------------------------------------------


def _long_line(count: int = 1000) -> PickLine:
    xs = np.geomspace(20, 20000, count)
    values = -40 + 5 * np.sin(np.arange(count) / 7)
    values[500:510] = np.nan
    return PickLine("compare", xs, values, silent_floor=True)


def test_a_read_returns_its_one_point_and_a_step_moves_a_signed_count_of_points_with_a_value_inside_the_range() -> None:
    line = _long_line()
    got = pick([line], NameAsk("compare", float(line.xs[700])), (20.0, 20000.0), (-60.0, 0.0), True)
    assert got.status == "point" and got.point is not None and got.point.index == 700
    # No list of neighbours: the arrow keys ask a step (b) each time.
    assert not hasattr(got, "before") and not hasattr(got, "after")
    # A step of 256 points on, and 3 back across the gap (500-509 have no value): the count is of points with a value.
    assert pick([line], StepAsk("compare", 700, 256), (20.0, 20000.0), (-60.0, 0.0), True).point.index == 956  # type: ignore[union-attr]
    back = pick([line], StepAsk("compare", 512, -3), (20.0, 20000.0), (-60.0, 0.0), True)
    assert back.point is not None and back.point.index == 499
    # Inside a narrower range, a step past the plot's side reads nothing ("outside"), however few points short.
    narrow = (float(line.xs[690]), float(line.xs[710]))
    assert pick([line], StepAsk("compare", 700, 10), narrow, (-60.0, 0.0), True).point.index == 710  # type: ignore[union-attr]
    assert pick([line], StepAsk("compare", 700, 11), narrow, (-60.0, 0.0), True).status == "outside"
    assert pick([line], StepAsk("compare", 710, 1), narrow, (-60.0, 0.0), True).status == "outside"


def test_a_read_by_name_finds_only_the_point_of_that_place_never_the_nearest() -> None:
    line = _long_line()
    assert pick([line], NameAsk("compare", float(line.xs[700]) * 1.0001), (20.0, 20000.0), (-60, 0), True).status == (
        "no-point"
    )
    assert pick([line], NameAsk("other", float(line.xs[700])), (20.0, 20000.0), (-60, 0), True).status == "no-point"
    # A point with no value has no name to find.
    assert pick([line], NameAsk("compare", float(line.xs[505])), (20.0, 20000.0), (-60, 0), True).status == "no-point"


def test_the_lines_are_judged_together_and_a_tie_goes_to_the_line_declared_first_whatever_the_order_drawn() -> None:
    xs = np.array([100.0, 200.0, 400.0])
    quiet = PickLine("median", xs, np.array([-50.0, -50.0, -50.0]), True)
    loud = PickLine("compare", xs, np.array([-40.0, -40.0, -40.0]), True)
    scale = (100.0, 2.0)  # 10 dB apart is 20 px: the pointer half way is 10 px from each
    ask = PointerAsk(200.0, -45.0, *scale)
    assert _named(pick([quiet, loud], ask, (20.0, 20000.0), (-100.0, 0.0), True)) == ("median", 1)
    assert _named(pick([loud, quiet], ask, (20.0, 20000.0), (-100.0, 0.0), True)) == ("compare", 1)
    # Judged at once: the nearer point of either line wins, not the first line's nearest.
    near_loud = PointerAsk(200.0, -42.0, *scale)
    assert _named(pick([quiet, loud], near_loud, (20.0, 20000.0), (-100.0, 0.0), True)) == ("compare", 1)
