"""計算ア's calibration words (figures/members.py): each level line's, and the level axis's (R4: the axis is named
uncalibrated only when none of its lines is calibrated; a line uncalibrated on an axis named calibrated says so itself;
a median of recordings mixed is uncalibrated, 仕様 2). The Figure only writes the words it is given.
"""

from __future__ import annotations

import numpy as np

from figures.answers import Answer
from figures.members import members
from figures.spec import parse_spec

XS = np.linspace(20.0, 8000.0, 64)
FS = ("FS", 1.0, "dBFS")


def _answer(key: str) -> Answer:
    return Answer(key, key, XS, np.full(XS.size, -40.0), FS, "ax", "level", "log", (20.0, 8000.0), 1024)


def _members(calibrated: dict[str, bool | None]):
    spec = parse_spec(
        {
            "lanes": [
                {
                    "id": "overlay",
                    "kind": "lines",
                    "lines": [
                        {"id": "base", "of": {"median": ["b1", "b2"]}, "role": "base"},
                        {"id": "compare1", "of": {"key": "c"}, "role": "compare1"},
                    ],
                },
                {
                    "id": "delta",
                    "kind": "lines",
                    "lines": [
                        {"id": "delta", "of": {"delta": {"compare": "c", "base": ["b1", "b2"]}}, "role": "compare1"}
                    ],
                },
            ],
            "keys": [
                {"key": key, "state": "usable", "version": key, **({} if said is None else {"calibrated": said})}
                for key, said in calibrated.items()
            ],
        }
    )
    return members(spec, {key: _answer(key) for key in calibrated})


def test_a_line_uncalibrated_on_an_axis_named_calibrated_says_so_and_a_mixed_median_is_uncalibrated() -> None:
    found = _members({"b1": True, "b2": False, "c": True})
    assert found.calibration == "calibrated", "the axis is calibrated: a line on it is"
    assert found.lines["base"].calibration == "uncalibrated", "a median of recordings mixed is uncalibrated"
    assert found.lines["compare1"].calibration == "calibrated"
    assert found.lines["delta"].calibration is None, "a Δ has no calibration word"


def test_the_axis_is_named_uncalibrated_only_when_no_line_on_it_is_calibrated() -> None:
    assert _members({"b1": False, "b2": False, "c": False}).calibration == "uncalibrated"
    assert _members({"b1": False, "b2": True, "c": False}).calibration == "uncalibrated", (
        "the median is mixed, so none is"
    )
    assert _members({"b1": None, "b2": None, "c": None}).calibration == "unknown"
    assert _members({"b1": True, "b2": True, "c": False}).calibration == "calibrated"
