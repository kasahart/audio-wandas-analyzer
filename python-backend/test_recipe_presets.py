from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from command_dispatch import dispatch, validate_request
from protocol_schema import DEFINITIONS, first_violation
from recipe_builder import entry_scan_recipe
from recipe_presets import PRESETS, TS_TARGET, presets, typescript

#: What each preset's last step shows on the comparison: the Frame, its picture and its unit.
EXPECTED = {
    "spectrum": ("SpectralFrame", "line", "level", None),
    "octave": ("NOctFrame", "bar", "level", None),
    "spectrogram": ("SpectrogramFrame", "heatmap", "level", None),
    "level": ("ChannelFrame", "line", "value", "dB re 1 FS"),
    "loudness": ("ChannelFrame", "line", "value", "sone"),
    "roughness": ("ChannelFrame", "line", "value", "asper"),
}


def test_the_generated_presets_are_these_recipes() -> None:
    # Regenerate with `python python-backend/recipe_presets.py --write`.
    assert TS_TARGET.read_text(encoding="utf-8") == typescript(presets())


def test_the_first_preset_is_the_entry_recipe_and_every_preset_slices_before_it_converts() -> None:
    assert list(PRESETS) == list(EXPECTED)
    assert PRESETS["spectrum"]() == entry_scan_recipe()
    for item in presets():
        recipe = item["recipe"]
        operations = [node["operation"] for node in recipe["nodes"]]
        assert [i["name"] for i in recipe["inputs"]] == ["signal"]
        assert operations.count("wandas.frame.time_slice") == 1, item["id"]
        # The region is the sound's: only filters come before the slice.
        assert all(op.endswith("_filter") for op in operations[: operations.index("wandas.frame.time_slice")])


def _scan(service: AnalysisService, path: str, recipe: dict, **payload: object) -> dict:
    request = validate_request({"cmd": "scan", "requestId": "r", "filePath": path, "recipe": recipe, **payload})
    result = dispatch(request, service)
    assert first_violation(DEFINITIONS["ScanResult"], result) is None
    return result


@pytest.mark.parametrize("rate", [16000, 48000])
@pytest.mark.parametrize("preset_id", list(EXPECTED))
def test_every_preset_runs_and_its_last_step_is_drawn_with_a_unit(tmp_path: Path, preset_id: str, rate: int) -> None:
    # Longer than 2048 loudness samples (500 Hz), so a metric series is not mistaken for a sound's level.
    seconds = 5.0
    noise = np.random.default_rng(3).normal(0.0, 0.05, int(seconds * rate))
    path = str(tmp_path / "noise.wav")
    sf.write(path, noise, rate, subtype="FLOAT")
    recipe = PRESETS[preset_id]()
    service = AnalysisService(AnalysisEngine())

    result = _scan(service, path, recipe)
    view = _scan(service, path, recipe, stage=recipe["output"], region={"start": 0.5, "end": 4.5})["stage"]

    assert result["ok"] is True, result
    frame, kind, quantity, unit = EXPECTED[preset_id]
    assert (view["frame"], view["kind"], view["quantity"]) == (frame, kind, quantity)
    if unit is not None:
        assert view["unit"] == unit
    values = [v for v in (view.get("values") or sum(view.get("matrix", []), [])) if v is not None]
    assert values and all(np.isfinite(values))
    if kind == "line" and view["x"] == "time":
        assert view["xs"][0] >= 0.5 and view["xs"][-1] <= 4.5


def test_an_a_weighting_step_in_the_chain_is_not_applied_twice_to_leq(tmp_path: Path) -> None:
    rate = 16000
    tone = 0.5 * np.sin(2 * np.pi * 100 * np.arange(2 * rate) / rate)
    path = str(tmp_path / "tone.wav")
    sf.write(path, tone, rate, subtype="FLOAT")
    service = AnalysisService(AnalysisEngine())

    plain = _scan(service, path, entry_scan_recipe())["leqDbA"][0]
    weighted = _scan(service, path, PRESETS["octave"]())["leqDbA"][0]

    # A-weighting is about -19 dB at 100 Hz: the chain's own a_weighting gives the same Leq(A), not -38 dB.
    assert weighted == pytest.approx(plain, abs=0.3)
    assert plain == pytest.approx(20 * np.log10(0.5 / np.sqrt(2)) - 19.1, abs=0.5)
