"""The pick rule of docs/display-rules.md R7 on the backend's side: every case of tests/fixtures/pick_cases.json, the
one table the webview's implementation runs too (src/test/pickCases.test.ts), against full_read.pointer_picks (the
point nearest the pointer on screen, _nearest_on_screen, and the point under it, _nearest_along) and an arrow key's
seek (_seek_line). A case the backend cannot express says so in the table (``not_on.py``, with why) and is listed
here, never skipped unsaid; a case the code does not follow yet records what it does today (``today``) and which work
changes it, and fails here once the code follows the rule, so the record is taken off.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from full_read import StageRead, _readable, _seek_line, pointer_picks, sorted_axis

TABLE = json.loads((Path(__file__).parent / "tests" / "fixtures" / "pick_cases.json").read_text(encoding="utf-8"))
CASES: list[dict[str, Any]] = TABLE["cases"]
RADIUS = float(TABLE["radius"])
CANNOT: dict[str, str] = TABLE["cannot"]

FIX = (
    "R7 (docs/display-rules.md, the pick table) broke on the backend: full_read.pointer_picks / _seek_line no longer "
    "answers this case of python-backend/tests/fixtures/pick_cases.json as the table says. Change the rule only by "
    "changing the table, the webview's fullLineNear / stageStep and full_read.py together (src/test/pickCases.test.ts "
    "runs the same table)."
)

NON_FINITE = {"nan": math.nan, "inf": math.inf, "-inf": -math.inf}


def _values(case: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    xs = np.asarray([float(point[0]) for point in case["points"]], dtype=np.float64)
    raw = [point[1] for point in case["points"]]
    values = [math.nan if value is None else NON_FINITE.get(value, value) for value in raw]
    return xs, np.asarray(values, dtype=np.float64)


def _scale(view: dict[str, Any]) -> tuple[float, float]:
    """Pixels per axis unit (per natural-log unit on a log axis) and per value unit, from the case's view alone."""
    x0, x1 = (float(value) for value in view["x"])
    y0, y1 = (float(value) for value in view["y"])
    span = math.log(x1 / x0) if view["xScale"] == "log" else x1 - x0
    return float(view["box"]["width"]) / span, float(view["box"]["height"]) / (y1 - y0)


def _x_at_pixel(view: dict[str, Any], pixel: float) -> float:
    x0 = float(view["x"][0])
    across, _ = _scale(view)
    return x0 * math.exp(pixel / across) if view["xScale"] == "log" else x0 + pixel / across


def _hover_read(case: dict[str, Any]) -> StageRead:
    """The read the webview sends for the pointer of ``case`` (stagePanes.fullLineNear): its pick window, place,
    level, scale and the values shown."""
    view, pointer = case["view"], case["pointer"]
    _, up = _scale(view)
    level = float(view["y"][1]) - float(pointer["y"]) / up
    return {
        "x": [_x_at_pixel(view, pointer["x"] - RADIUS), _x_at_pixel(view, pointer["x"] + RADIUS)],
        "beyond": 1,
        "near": level,
        "log": view["xScale"] == "log",
        "at": _x_at_pixel(view, pointer["x"]),
        "pixels": list(_scale(view)),
        "shown": [float(view["y"][0]), float(view["y"][1])],
        "plain": bool(case["plain"]),
    }


def _answer(case: dict[str, Any]) -> int | None:
    """The index the backend reads for ``case``."""
    xs, values = _values(case)
    axis = sorted_axis(xs)
    mode = case["mode"]
    if mode in ("nearest", "under"):
        nearest, under = pointer_picks(axis, lambda a, b: values[a:b], _hover_read(case))
        return nearest if mode == "nearest" else under
    direction = 1 if mode == "step+" else -1
    start = int(case["from"])
    got = _seek_line(axis, lambda a, b: values[a:b], float(xs[start]), direction, 8, bool(case["plain"]))
    found = np.asarray(got["xs"], dtype=np.float64)
    sent = np.asarray([math.nan if value is None else value for value in got.get("values", [])], dtype=np.float64)
    readable = _readable(sent, bool(case["plain"]))
    past = found > xs[start] if direction > 0 else found < xs[start]
    hits = np.flatnonzero(readable & past)
    if not hits.size:
        return None
    x = found[hits[0] if direction > 0 else hits[-1]]
    return int(np.flatnonzero(xs == x)[0 if direction > 0 else -1])


def _ids() -> list[str]:
    return [case["name"] for case in CASES]


@pytest.mark.parametrize("case", CASES, ids=_ids())
def test_every_pick_case_of_the_table_is_read_by_the_backend_as_the_table_says(case: dict[str, Any]) -> None:
    cannot = case.get("not_on", {}).get("py")
    if cannot:
        # Not run: the table says why the backend cannot express it (listed in the test below).
        assert cannot in CANNOT, f"{case['name']}: a case left out names its reason, a key of `cannot`"
        return
    got = _answer(case)
    today = case.get("today")
    if today is not None and "py" in today:
        assert got == today["py"], (
            f"{case['name']}: the backend now reads {got}, not {today['py']} as recorded under `today`; "
            f"if it follows the rule ({case['expect']}), take `today.py` off the case. {today['handoff']}"
        )
        assert got != case["expect"], f"{case['name']}: follows the rule now: take `today.py` off the case"
        return
    assert got == case["expect"], f"{case['name']}: the backend reads {got}, the table says {case['expect']}. {FIX}"


def test_the_cases_the_backend_cannot_express_are_listed_with_why() -> None:
    names = {case["name"]: CANNOT[case["not_on"]["py"]] for case in CASES if case.get("not_on", {}).get("py")}
    # A new case left out of the backend's run is a finding: name it here, as the report of G3 lists them.
    assert sorted(names) == sorted(
        [
            "nearest: none within the radius",
            "step+: from the first of two points at one x, the second",
            "step-: from the second of two points at one x, the first",
            "step+: past the plot's side there is nothing to read",
        ]
        # A click is the webview's alone: it acts on the point its readout reads (no-click).
        + [case["name"] for case in CASES if case["mode"] == "click"]
    ), names
    assert all(case["not_on"]["py"] == "no-click" for case in CASES if case["mode"] == "click")
