from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from backend_errors import InputError
from command_dispatch import dispatch, validate_request
from recipe_runner import load_plan

STFT = {"nFft": 1024, "overlapPercent": 75, "window": "hamming"}


def _write(path: Path, channels: list[np.ndarray], sr: int) -> str:
    sf.write(path, np.stack(channels, axis=1), sr, subtype="FLOAT")
    return str(path)


def _tone(amplitude: float, sr: int, seconds: float = 1.0) -> np.ndarray:
    t = np.arange(int(sr * seconds)) / sr
    rng = np.random.default_rng(0)
    # Broadband noise keeps every bin's cross spectrum defined; the tone marks the gain to read.
    return amplitude * (0.3 * np.sin(2 * np.pi * 1000 * t) + 0.05 * rng.standard_normal(t.size))


def _operations(recipe: dict) -> list[tuple[str, dict]]:
    return [(node["operation"], dict(node["params"]["entries"])) for node in recipe["nodes"]]


def test_spectrum_recipe_keeps_the_panel_stft_settings_and_replays_on_the_file(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "a.wav", [_tone(1.0, 16000), _tone(0.5, 16000)], 16000)

    built = dispatch(
        validate_request({"cmd": "build-recipe", "requestId": "r", "filePath": path, "stftOptions": STFT}), service
    )

    assert built["name"] == "spectrum"
    assert _operations(built["recipe"]) == [
        ("wandas.audio.welch", {"n_fft": 1024, "hop_length": 256, "window": "hamming"})
    ]
    charts = service.run_recipe(built["recipe"], inputs={"signal": path})["charts"]
    assert [len(chart["series"]) for chart in charts] == [2]


def test_octave_recipe_uses_the_bands_the_panel_shows(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "a.wav", [_tone(1.0, 16000)], 16000)

    built = service.build_recipe(path, bands_per_octave=3)

    assert built["name"] == "octave-3"
    [(operation, params)] = _operations(built["recipe"])
    assert operation == "wandas.audio.noct_spectrum"
    assert params["n"] == 3
    # 16 kHz files stop at the 6.3 kHz band, as in the panel.
    assert service.spectrum_slice(path, cursor_norm=0.5, bands_per_octave=3)["bandCentersHz"][-1] == 6300.0
    assert service.run_recipe(built["recipe"], inputs={"signal": path})["charts"][0]["kind"] == "bar"


def test_transfer_recipe_names_one_input_per_file_and_replays_every_shown_pair(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    reference = _write(tmp_path / "ref.wav", [_tone(3.0, 16000), _tone(1.0, 16000)], 16000)
    response = _write(tmp_path / "resp.wav", [_tone(2.0, 8000)], 8000)

    built = service.build_recipe(
        reference,
        stft_options=STFT,
        reference_channel=1,
        responses=[{"filePath": reference, "channelIndex": 0}, {"filePath": response, "channelIndex": 0}],
    )

    assert built["name"] == "transfer-function"
    plan = load_plan(built["recipe"])
    assert [item.name for item in plan.inputs] == ["reference", "response"]
    assert "wandas.audio.resampling" in [operation for operation, _ in _operations(built["recipe"])]
    charts = service.run_recipe(built["recipe"], inputs={"reference": reference, "response": response})["charts"]
    gain, _phase = charts
    frequencies = np.asarray(gain["xs"])
    at_tone = int(np.argmin(np.abs(frequencies - 1000)))
    levels = [series["ys"][at_tone] for series in gain["series"]]
    assert levels == pytest.approx([20 * np.log10(3), 20 * np.log10(2)], abs=0.2)


def test_transfer_recipe_needs_a_response_and_valid_channels(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "a.wav", [_tone(1.0, 16000)], 16000)
    with pytest.raises(InputError, match="at least one response"):
        service.build_recipe(path, reference_channel=0)
    with pytest.raises(InputError, match="channelIndex 1 is out of range"):
        service.build_recipe(path, reference_channel=1, responses=[{"filePath": path, "channelIndex": 0}])
    with pytest.raises(InputError, match="invalid request field"):
        validate_request({"cmd": "build-recipe", "requestId": "r", "filePath": path, "offsetSeconds": 0})
