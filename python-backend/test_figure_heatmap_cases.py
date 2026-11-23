"""The spectrogram's shared test data: tests/fixtures/figure_heatmap_cases.json, recorded from the old path before it
was removed. The figure service's tests replay it (test_figures_heatmap.py,
test_figures_images.py, src/test/figureHeatmapCases.test.ts). This file holds the scene the cases are of, the
fixture's number format, and checks the file's shape; the power mean of levels (stage_view.power_mean_db, which every
reading still uses) is replayed here. The old path is gone, so the file can no longer be recorded again: a
case changes only by hand, on purpose, and is named in the stage's list of changed tests.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import wandas as wd

from frames import stage_view as sv

FIXTURE = Path(__file__).parent / "tests" / "fixtures" / "figure_heatmap_cases.json"
NON_FINITE = {"nan": math.nan, "inf": math.inf, "-inf": -math.inf}
#: Sections whose answers are the backend's (the rest are the webview's).
PY_SECTIONS = ("time_blocks", "power_mean", "log_bands", "view", "read_cells", "real_read")
#: The one section replayed here: its functions are the readings' own (stage_view.power_mean_db, floored_db).
REPLAYED = ("power_mean",)

FIX = (
    "stage_view.power_mean_db or floored_db no longer answers this recorded case of "
    "python-backend/tests/fixtures/figure_heatmap_cases.json. Every level a reading holds is made with them (R1): "
    "fix the function. Change the case only on purpose, named in the stage's list of changed tests."
)


def numbers(value: Any) -> Any:
    """A JSON value with its non-finite words as floats."""
    if isinstance(value, list):
        return [numbers(item) for item in value]
    if isinstance(value, dict):
        return {key: numbers(item) for key, item in value.items()}
    return NON_FINITE.get(value, value) if isinstance(value, str) else value


def as_json(value: Any) -> Any:
    """An answer as the fixture holds it: non-finite floats as words, numpy numbers as Python's."""
    if isinstance(value, dict):
        return {key: as_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [as_json(item) for item in value]
    if isinstance(value, np.ndarray):
        return as_json(value.tolist())
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        number = float(value)
        if math.isnan(number):
            return "nan"
        if math.isinf(number):
            return "inf" if number > 0 else "-inf"
        return number + 0.0
    return value


def scene_frame(scene: dict[str, Any]) -> tuple[Any, float]:
    """The scene's STFT (a SpectrogramFrame) and the length of the signal it was taken of: two channels of tones, a
    silent start and a short click, made without randomness."""
    rate, seconds = int(scene["rate"]), float(scene["seconds"])
    t = np.arange(int(rate * seconds)) / rate
    first = np.zeros_like(t)
    for tone in scene["tones"]:
        first += float(tone["amplitude"]) * np.sin(2 * np.pi * float(tone["hz"]) * t)
    first[: int(float(scene["silent_s"]) * rate)] = 0.0
    click = scene["click"]
    start = int(float(click["at_s"]) * rate)
    first[start : start + int(click["samples"])] = float(click["amplitude"])
    second = float(scene["second"]["gain"]) * first + float(scene["second"]["amplitude"]) * np.sin(
        2 * np.pi * float(scene["second"]["hz"]) * t
    )
    signal = wd.from_numpy(np.stack([first, second]), sampling_rate=rate)
    return signal.stft(n_fft=int(scene["n_fft"]), hop_length=int(scene["hop"])), seconds


def power_mean_answer(case_input: dict[str, Any]) -> Any:
    """The power mean of a ``power_mean`` case's levels, and it floored."""
    given = numbers(case_input)
    levels = np.asarray(given["levels"], dtype=np.float64)
    mean = sv.power_mean_db(levels, axis=int(given["axis"]))
    return {"mean": mean, "floored": sv.floored_db(mean)}


def _cases() -> list[tuple[str, dict[str, Any]]]:
    if not FIXTURE.exists():
        return []
    table = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return [(section, case) for section in REPLAYED for case in table[section]]


def _close(got: Any, expected: Any, where: str) -> None:
    """``got`` is ``expected`` (numbers to 1e-9, or to 1e-9 of their size): the answers are float64 arithmetic of
    numpy and an FFT, whose last bits may differ between platforms."""
    if isinstance(expected, dict):
        assert isinstance(got, dict) and got.keys() == expected.keys(), f"{where}: keys {got} != {expected}"
        for key in expected:
            _close(got[key], expected[key], f"{where}.{key}")
    elif isinstance(expected, list):
        assert isinstance(got, list) and len(got) == len(expected), f"{where}: length"
        for index, item in enumerate(expected):
            _close(got[index], item, f"{where}[{index}]")
    elif isinstance(expected, float) and isinstance(got, (int, float)) and not isinstance(got, bool):
        assert got == pytest.approx(expected, rel=1e-9, abs=1e-9), f"{where}: {got} != {expected}"
    else:
        assert got == expected, f"{where}: {got!r} != {expected!r}"


def test_every_python_section_of_the_heatmaps_recorded_cases_is_there() -> None:
    table = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for section in PY_SECTIONS:
        cases = table[section]
        assert cases, f"{section}: no case"
        for case in cases:
            assert case["id"] and case["description"] and "input" in case and "expected" in case
            assert case["source"].startswith("old path: "), f"{section}: {case['id']} names no old-path source"
        assert len({case["id"] for case in cases}) == len(cases), f"{section}: ids repeat"


@pytest.mark.parametrize(("section", "case"), _cases(), ids=lambda item: item["id"] if isinstance(item, dict) else item)
def test_the_power_mean_of_levels_answers_its_recorded_case(section: str, case: dict[str, Any]) -> None:
    got = as_json(power_mean_answer(case["input"]))
    try:
        _close(got, case["expected"], case["id"])
    except AssertionError as error:
        raise AssertionError(f"{case['id']}: {case['description']} {error} {FIX}") from error
