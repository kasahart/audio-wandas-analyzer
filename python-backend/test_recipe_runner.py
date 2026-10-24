from __future__ import annotations

import json
import math
import wave
from pathlib import Path

import numpy as np
import pytest
import wandas as wd

from recipe_runner import RecipeError, evaluate_recipe, frame_input_names, load_plan, recipe_title
from wandas_to_chart import adapt

RECIPES = Path(__file__).parent / "recipes"


def _write_sine_wav(path: Path, freq_hz: float = 440.0, seconds: float = 1.0, sr: int = 48000) -> None:
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * freq_hz * t) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())


def _run(recipe: dict, frames: dict, title: str = "result") -> list:
    return evaluate_recipe(load_plan(recipe), frames, title=title)


@pytest.mark.parametrize("recipe_path", sorted(RECIPES.glob("*.recipe.json")), ids=lambda p: p.name)
def test_bundled_recipes_replay_on_calibrated_selections_of_different_lengths(
    recipe_path: Path, tmp_path: Path
) -> None:
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    names = frame_input_names(load_plan(recipe))
    frames = {}
    for index, name in enumerate(names):
        wav = tmp_path / f"{name}.wav"
        _write_sine_wav(wav, freq_hz=440.0 * (index + 1), seconds=1.0 + 0.5 * index)
        frames[name] = wd.read(wav).with_calibration({0: wd.ChannelCalibration(factor=1.0, unit="Pa", ref=2e-5)})

    charts = _run(recipe, frames, title=recipe_title(str(recipe_path)))

    assert charts[0]["title"] == recipe_path.name.removesuffix(".recipe.json")
    assert all(chart["kind"] in {"line", "heatmap", "bar", "scalar"} for chart in charts)
    assert all(len(chart.get("series", [None])) == 1 for chart in charts if chart["kind"] == "line")


def test_transfer_function_recipe_shows_gain_and_phase(tmp_path: Path) -> None:
    recipe = json.loads((RECIPES / "transfer-function.recipe.json").read_text(encoding="utf-8"))
    frames = {}
    for name, freq in (("reference", 440.0), ("response", 880.0)):
        _write_sine_wav(tmp_path / f"{name}.wav", freq_hz=freq)
        frames[name] = wd.read(tmp_path / f"{name}.wav")

    charts = _run(recipe, frames, title="transfer-function")

    assert [chart["title"] for chart in charts] == ["transfer-function", "transfer-function (phase)"]
    assert charts[0]["yLabel"] != charts[1]["yLabel"]


def test_recipe_replays_what_a_notebook_saved(tmp_path: Path) -> None:
    wav = tmp_path / "a.wav"
    _write_sine_wav(wav)
    signal = wd.read(wav)
    processed = signal.low_pass_filter(cutoff=2000).welch(n_fft=1024)
    path = wd.pipeline.RecipePlan.from_frame(processed, input_names=("signal",)).save(tmp_path / "notebook")

    (chart,) = _run(json.loads(path.read_text(encoding="utf-8")), {"signal": signal})

    assert chart == adapt(processed, title="result")


@pytest.mark.parametrize(
    "recipe",
    [
        {"inputs": [{"name": "sig", "file": "a.wav"}], "steps": [], "display": []},
        {"schema": "wandas.recipe", "version": 3, "inputs": [], "nodes": [], "output": "missing"},
    ],
)
def test_documents_that_are_not_wandas_recipes_are_rejected(recipe: dict) -> None:
    with pytest.raises(RecipeError):
        load_plan(recipe)


def test_array_inputs_are_rejected_because_the_panel_supplies_frames() -> None:
    signal = wd.from_numpy(np.zeros((1, 16)), sampling_rate=16000)
    recipe = wd.pipeline.RecipePlan.from_frame(signal + np.ones((1, 16)), input_names=("signal", "offset")).to_dict()
    plan = load_plan(recipe)
    with pytest.raises(RecipeError, match="'offset' needs an array"):
        frame_input_names(plan)


def test_outputs_without_a_chart_are_rejected_instead_of_shown_as_repr(tmp_path: Path) -> None:
    wav = tmp_path / "a.wav"
    _write_sine_wav(wav)
    signal = wd.read(wav)
    recipe = wd.pipeline.RecipePlan.from_frame(signal.cepstrum(), input_names=("signal",)).to_dict()

    with pytest.raises(RecipeError, match="cannot chart a CepstralFrame output"):
        _run(recipe, {"signal": signal})


def test_replay_failures_become_recipe_errors(tmp_path: Path) -> None:
    wav = tmp_path / "a.wav"
    _write_sine_wav(wav)
    recipe = json.loads((RECIPES / "octave.recipe.json").read_text(encoding="utf-8"))
    with pytest.raises(RecipeError):
        _run(recipe, {"other": wd.read(wav)})


@pytest.mark.parametrize(
    ("path", "title"),
    [
        (None, "Recipe"),
        ("./recipes/octave.recipe.json", "octave"),
        ("C:\\recipes\\custom.json", "custom"),
        ("/tmp/plain", "plain"),
    ],
)
def test_recipe_title_is_the_file_name_without_its_extension(path: str | None, title: str) -> None:
    assert recipe_title(path) == title


def test_chart_spec_schema_validates_against_kind() -> None:
    from chart_spec import dump_schema

    schema = dump_schema()
    kinds = {opt["properties"]["kind"]["const"] for opt in schema["oneOf"]}
    assert kinds == {"line", "heatmap", "bar", "scalar"}


def test_chart_spec_typed_dicts_match_schema() -> None:
    from typing import get_args, get_type_hints

    from chart_spec import ChartSpec, dump_schema

    def check(typed_dict: type, schema: dict) -> None:
        assert typed_dict.__required_keys__ == set(schema["required"]), typed_dict.__name__
        assert typed_dict.__required_keys__ | typed_dict.__optional_keys__ == set(schema["properties"])
        for key, hint in get_type_hints(typed_dict).items():
            items = schema["properties"][key].get("items", {})
            if items.get("type") == "object":
                (item_dict,) = get_args(hint)
                check(item_dict, items)

    for typed_dict, schema in zip(get_args(ChartSpec), dump_schema()["oneOf"], strict=True):
        check(typed_dict, schema)
