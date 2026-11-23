"""The time signal's shared test data: tests/fixtures/figure_signal_cases.json, recorded from the old path before it
was removed. The figure service's tests replay it (test_figures_signal.py,
src/test/figureSignalCases.test.ts). This file holds the scene the cases are of and checks the file's shape. The old
path is gone, so the file can no longer be recorded again: a case changes only by hand, on purpose, and is
named in the stage's list of changed tests.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import wandas as wd

FIXTURE = Path(__file__).parent / "tests" / "fixtures" / "figure_signal_cases.json"
PY_SECTIONS = ("buckets", "extremes", "view", "read")


def scene_signal(scene: dict[str, Any]) -> wd.ChannelFrame:
    """The scene's recording: two channels of tones with a slow swell and a short click, made without randomness."""
    rate, seconds = int(scene["rate"]), float(scene["seconds"])
    t = np.arange(int(rate * seconds)) / rate
    first = np.zeros_like(t)
    for tone in scene["tones"]:
        first += float(tone["amplitude"]) * np.sin(2 * np.pi * float(tone["hz"]) * t)
    first *= 1.0 + float(scene["swell"]) * np.sin(2 * np.pi * t / seconds)
    click = scene["click"]
    start = int(float(click["at_s"]) * rate)
    first[start : start + int(click["samples"])] = float(click["amplitude"])
    second = float(scene["second_gain"]) * first
    return wd.from_numpy(np.stack([first, second]), sampling_rate=rate)


def test_every_python_section_of_the_time_signals_recorded_cases_is_there() -> None:
    table = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for section in PY_SECTIONS:
        cases = table[section]
        assert cases, f"{section}: no case"
        for case in cases:
            assert case["id"] and case["description"] and "input" in case and "expected" in case
            assert case["source"].startswith("old path: "), f"{section}: {case['id']} names no old-path source"
        assert len({case["id"] for case in cases}) == len(cases), f"{section}: ids repeat"
