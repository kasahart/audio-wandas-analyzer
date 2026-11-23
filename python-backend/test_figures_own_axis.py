"""A lines lane on a value axis of its own (the spec's ``"axis": "own"``, figures/spec.py): 計算ア matches its lines
among its own keys (figures/members.py), so one Figure draws a gain above a phase above a coherence, or a lane a unit
and reference, over one axis across (設計書 第 4 節「段」: the value axis is the lane's; lanes may differ in unit).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from figures.answers import Answer, LevelIdentity
from figures.members import members
from figures.spec import SpecError, parse_spec

XS = np.linspace(20.0, 8000.0, 64)
PA: LevelIdentity = ("Pa", 2e-5, "dB SPL")
ACCELERATION: LevelIdentity = ("m/s^2", 1.0, "dB re 1 m/s^2")


def _answer(key: str, identity: LevelIdentity, quantity: str = "level") -> Answer:
    return Answer(key, key, XS, np.full(XS.size, -40.0), identity, f"ax-{quantity}", quantity, "log", (20.0, 8000.0), 1)


def _lane(name: str, keys: list[str], **more: Any) -> dict[str, Any]:
    return {"id": name, "kind": "lines", "lines": [{"id": key, "of": {"key": key}} for key in keys], **more}


def _spec(lanes: list[dict[str, Any]], calibrated: dict[str, bool] | None = None) -> Any:
    keys = [line["of"]["key"] for lane in lanes for line in lane["lines"]]
    said = calibrated or {}
    return parse_spec(
        {
            "lanes": lanes,
            "keys": [
                {"key": key, "state": "usable", "version": key, **({"calibrated": said[key]} if key in said else {})}
                for key in dict.fromkeys(keys)
            ],
        }
    )


ANSWERS = {
    "p1": _answer("p1", PA),
    "p2": _answer("p2", PA),
    "a1": _answer("a1", ACCELERATION),
}


def test_on_one_axis_a_recording_of_another_reference_is_left_out_as_before() -> None:
    found = members(_spec([_lane("all", ["p1", "p2", "a1"])]), ANSWERS)
    assert found.target == PA
    assert found.shown.used == ("p1", "p2")
    assert [(item.key, item.reason) for item in found.shown.excluded] == [("a1", "other-reference")]
    assert found.own == {}


def test_a_lane_a_reference_draws_every_recording_on_its_own_axis() -> None:
    spec = _spec(
        [_lane("pa", ["p1", "p2"], axis="own"), _lane("acceleration", ["a1"], axis="own")],
        {"p1": True, "p2": True, "a1": False},
    )
    found = members(spec, ANSWERS)
    assert found.shown.used == ("p1", "p2", "a1") and found.shown.excluded == ()
    assert all(found.lines[key].drawn for key in ("p1", "p2", "a1"))
    assert (found.own["pa"].target, found.own["acceleration"].target) == (PA, ACCELERATION)
    # Each axis says its own lines' calibration.
    assert (found.calibration_of("pa"), found.calibration_of("acceleration")) == ("calibrated", "uncalibrated")
    # No lane is on the figure's axis: the figure has no target of its own.
    assert found.target is None and found.calibration == "unknown"


def test_inside_a_lane_of_its_own_a_recording_of_another_reference_is_still_left_out() -> None:
    found = members(_spec([_lane("mixed", ["p1", "a1"], axis="own"), _lane("other", ["p2"], axis="own")]), ANSWERS)
    assert found.lines["p1"].drawn and not found.lines["a1"].drawn
    assert [(item.key, item.reason) for item in found.shown.excluded] == [("a1", "other-reference")]


def test_lanes_on_the_figure_s_axis_and_a_lane_of_its_own_are_matched_apart() -> None:
    found = members(_spec([_lane("shared", ["p1", "p2"]), _lane("apart", ["a1"], axis="own")]), ANSWERS)
    assert found.target == PA and found.own["apart"].target == ACCELERATION
    assert found.shown.used == ("p1", "p2", "a1")


def test_a_key_of_a_lane_of_its_own_is_named_by_no_other_lane() -> None:
    with pytest.raises(SpecError, match="named elsewhere"):
        _spec(
            [
                _lane("one", ["p1"], axis="own"),
                {**_lane("two", ["p2"]), "lines": [{"id": "again", "of": {"key": "p1"}}]},
            ]
        )


def test_only_a_lines_lane_is_on_an_axis_of_its_own() -> None:
    with pytest.raises(SpecError, match="only a lines lane"):
        _spec([{"id": "image", "kind": "image", "lines": [{"id": "p1", "of": {"key": "p1"}}], "axis": "own"}])
    with pytest.raises(SpecError, match="only a lines lane"):
        _spec([_lane("one", ["p1"], axis="shared")])
