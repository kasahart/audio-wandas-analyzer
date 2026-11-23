from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from services.analysis_engine import AnalysisEngine
from services.analysis_service import AnalysisService
from services.recipe_builder import entry_scan_recipe
from services.recipe_presets import PRESETS, TS_TARGET, presets, typescript
from services.stage_combine import STORE
from transport.command_dispatch import dispatch, validate_request
from transport.protocol_schema import DEFINITIONS, first_violation

#: What each preset's last step shows on the comparison: the Frame, its picture and its unit.
EXPECTED = {
    "spectrum": ("SpectralFrame", "line", "level", None),
    "octave": ("NOctFrame", "bar", "level", None),
    "spectrogram": ("SpectrogramFrame", "heatmap", "level", None),
    # rms_trend in dB is a level (its own dB values): compared with the audible floor, drawn on the level axis.
    "level": ("ChannelFrame", "line", "level", "dB re 1 FS"),
    "loudness": ("ChannelFrame", "line", "value", "sone"),
    "roughness": ("ChannelFrame", "line", "value", "asper"),
}


def test_the_generated_presets_are_these_recipes() -> None:
    # Regenerate with `python -m services.recipe_presets --write` in python-backend/.
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
    request = validate_request(
        {"cmd": "scan", "requestId": "r", "filePath": path, "recipe": recipe, "stage": recipe["output"], **payload}
    )
    result = dispatch(request, service)
    assert first_violation(DEFINITIONS["ScanResult"], result) is None
    return result


@pytest.mark.parametrize("rate", [16000, 48000])
@pytest.mark.parametrize("preset_id", list(EXPECTED))
def test_every_preset_runs_and_its_last_step_is_described_with_a_unit(
    tmp_path: Path, preset_id: str, rate: int
) -> None:
    # Longer than 2048 loudness samples (500 Hz), so a metric series is not mistaken for a sound's level.
    seconds = 5.0
    noise = np.random.default_rng(3).normal(0.0, 0.05, int(seconds * rate))
    path = str(tmp_path / "noise.wav")
    sf.write(path, noise, rate, subtype="FLOAT")
    recipe = PRESETS[preset_id]()
    service = AnalysisService(AnalysisEngine())

    result = _scan(service, path, recipe)
    view = _scan(service, path, recipe, region={"start": 0.5, "end": 4.5})["stage"]

    assert result["ok"] is True, result
    frame, kind, quantity, unit = EXPECTED[preset_id]
    assert (view["frame"], view["kind"], view["quantity"]) == (frame, kind, quantity)
    if unit is not None:
        assert view["unit"] == unit
    kept = STORE.get(view["data"])
    assert kept is not None and kept.values.size and bool(np.all(np.isfinite(kept.values)))
    if kind == "line" and view["x"] == "time":
        assert kept.mode == "series" and kept.xs[0] >= 0.5 and kept.xs[-1] <= 4.5
