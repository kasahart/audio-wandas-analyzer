from __future__ import annotations

import json
import math
import wave
from pathlib import Path

import numpy as np
import pytest

from recipe_runner import RecipeError, _eval_expr, run_recipe


def _write_sine_wav(path: Path, freq_hz: float = 440.0, seconds: float = 0.25, sr: int = 16000) -> None:
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * freq_hz * t) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())


# ---- AST whitelist --------------------------------------------------------


def test_eval_simple_literal() -> None:
    assert _eval_expr("1 + 2", {}) == 3
    assert _eval_expr("-3.5", {}) == -3.5


def test_eval_method_chain() -> None:
    class Stub:
        def add(self, n: int) -> Stub:
            return Stub()

        def total(self) -> int:
            return 42

    assert _eval_expr("x.add(1).add(2).total()", {"x": Stub()}) == 42


def test_eval_rejects_unknown_name() -> None:
    with pytest.raises(RecipeError):
        _eval_expr("os.system('echo hi')", {})


def test_eval_rejects_subscript() -> None:
    with pytest.raises(RecipeError):
        _eval_expr("x[0]", {"x": [1, 2, 3]})


def test_eval_rejects_dunder_attribute() -> None:
    with pytest.raises(RecipeError):
        _eval_expr("x.__class__", {"x": object()})


def test_eval_rejects_import() -> None:
    with pytest.raises(RecipeError):
        _eval_expr("__import__('os')", {})


def test_eval_rejects_double_star_kwargs() -> None:
    with pytest.raises(RecipeError):
        _eval_expr("f(**d)", {"f": lambda **kw: kw, "d": {}})


def test_eval_allows_list_arg() -> None:
    class F:
        def take(self, xs: list[int]) -> int:
            return sum(xs)

    assert _eval_expr("x.take([1, 2, 3])", {"x": F()}) == 6


# ---- end-to-end recipe execution -----------------------------------------


def test_run_recipe_welch(tmp_path: Path) -> None:
    wav = tmp_path / "a.wav"
    _write_sine_wav(wav)
    recipe = {
        "inputs": [{"name": "sig", "file": str(wav)}],
        "steps": [{"as": "w", "expr": "sig.welch()"}],
        "display": [{"name": "w", "title": "PSD"}],
    }
    charts = run_recipe(recipe, base_dir=tmp_path)
    assert len(charts) == 1
    assert charts[0]["kind"] == "line"
    assert charts[0]["title"] == "PSD"


def test_run_recipe_chain(tmp_path: Path) -> None:
    wav = tmp_path / "a.wav"
    _write_sine_wav(wav)
    recipe = {
        "inputs": [{"name": "sig", "file": str(wav)}],
        "steps": [
            {"as": "filt", "expr": "sig.band_pass_filter(low_cutoff=100, high_cutoff=2000)"},
            {"as": "w", "expr": "filt.welch()"},
        ],
        "display": ["w"],
    }
    charts = run_recipe(recipe, base_dir=tmp_path)
    assert charts[0]["kind"] == "line"
    assert len(charts[0]["series"]) == 1


def test_run_recipe_missing_display(tmp_path: Path) -> None:
    wav = tmp_path / "a.wav"
    _write_sine_wav(wav)
    recipe = {
        "inputs": [{"name": "sig", "file": str(wav)}],
        "steps": [],
        "display": ["never_defined"],
    }
    with pytest.raises(RecipeError):
        run_recipe(recipe, base_dir=tmp_path)


def test_run_recipe_resolves_relative_paths(tmp_path: Path) -> None:
    wav = tmp_path / "a.wav"
    _write_sine_wav(wav)
    recipe = {
        "inputs": [{"name": "sig", "file": "a.wav"}],
        "steps": [{"as": "w", "expr": "sig.welch()"}],
        "display": ["w"],
    }
    charts = run_recipe(recipe, base_dir=tmp_path)
    assert charts[0]["kind"] == "line"


def test_chart_spec_schema_validates_against_kind() -> None:
    # The runner should not invent unknown kinds.
    from chart_spec import dump_schema

    schema = dump_schema()
    kinds = {opt["properties"]["kind"]["const"] for opt in schema["oneOf"]}
    assert kinds == {"line", "heatmap", "bar", "scalar"}


def test_run_recipe_emits_json_on_main(tmp_path: Path) -> None:
    import subprocess
    import sys

    wav = tmp_path / "a.wav"
    _write_sine_wav(wav)
    recipe_path = tmp_path / "r.json"
    recipe_path.write_text(
        json.dumps(
            {
                "inputs": [{"name": "sig", "file": str(wav)}],
                "steps": [{"as": "w", "expr": "sig.welch()"}],
                "display": ["w"],
            }
        )
    )
    proc = subprocess.run(
        [sys.executable, "recipe_runner.py", "--recipe", str(recipe_path)],
        cwd=Path(__file__).parent,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["charts"][0]["kind"] == "line"
