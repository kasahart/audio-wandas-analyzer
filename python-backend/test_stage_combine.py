from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from frames.stage_view import stage_view
from services.analysis_engine import AnalysisEngine
from services.analysis_service import AnalysisService
from services.stage_combine import STORE, _Store, stage_data
from transport.command_dispatch import dispatch, validate_request

RATE = 16000
ENTRY_RECIPE = json.loads((Path(__file__).parent / "recipes" / "entry-scan.recipe.json").read_text())


@pytest.fixture(scope="module")
def signal() -> wd.ChannelFrame:
    rng = np.random.default_rng(7)
    tone = 0.5 * np.sin(2 * np.pi * 1000 * np.arange(RATE * 2) / RATE) + 0.01 * rng.standard_normal(RATE * 2)
    return wd.from_numpy(tone[np.newaxis], sampling_rate=RATE)


@pytest.mark.parametrize("samples", [16, 2048, 2049])
def test_a_short_time_signal_is_a_signal_whatever_its_length(signal: wd.ChannelFrame, samples: int) -> None:
    # A signal is told from a metric by the operation that made it, never by how many samples it has: a short
    # recording is said to be the sound itself and kept as its own samples.
    short = wd.from_numpy(signal.data[np.newaxis, :samples], sampling_rate=RATE)
    view = dict(stage_view(short))
    assert view["signal"] is True
    item = stage_data(short, view)
    assert item is not None and item.mode == "signal" and item.values.size == samples


def test_the_store_drops_the_least_recently_used_beyond_its_budget(signal: wd.ChannelFrame) -> None:
    data = stage_data(signal.fft(), dict(stage_view(signal.fft())))
    assert data is not None
    store = _Store(int(data.nbytes * 2.5))
    store.put("a", data)
    store.put("b", data)
    assert store.get("a") is data
    store.put("c", data)
    assert (store.has("a"), store.has("b"), store.has("c")) == (True, False, True)


def _scan(service: AnalysisService, path: str, **payload: object) -> dict:
    request = validate_request({"cmd": "scan", "requestId": "r", "filePath": path, "recipe": ENTRY_RECIPE, **payload})
    return dispatch(request, service)


def test_a_scans_step_keeps_its_values_under_the_key_its_description_names(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    paths = []
    for index, amplitude in enumerate((0.1, 0.2, 0.4)):
        path = tmp_path / f"{index}.wav"
        sf.write(path, amplitude * np.sin(2 * np.pi * 1000 * np.arange(RATE * 2) / RATE), RATE, subtype="FLOAT")
        paths.append(str(path))
    views = [_scan(service, path, stage="node-2")["stage"] for path in paths]
    keys = [view["data"] for view in views]
    assert len(set(keys)) == 3
    assert all(STORE.has(key) for key in keys)
    # The same step asked again names the same values.
    assert _scan(service, paths[0], stage="node-2")["stage"]["data"] == keys[0]
    # Every bin of the step: the 1 kHz tone of 0.4 is 12 dB above that of 0.1.
    low, high = STORE.get(keys[0]), STORE.get(keys[2])
    assert low is not None and high is not None
    at = int(np.argmin(np.abs(low.xs - 1000)))
    assert high.values[at] - low.values[at] == pytest.approx(20 * np.log10(4), abs=0.01)
    STORE.clear()
    assert not any(STORE.has(key) for key in keys)


def test_every_full_resolution_picture_is_kept_in_float64(signal: wd.ChannelFrame) -> None:
    """The kept values (stage_data) are float64 whatever the Frame's dtype: a signal's channel mean, a spectrogram's
    power-averaged plane, a cepstrogram's and a roughness plane alike."""
    for frame in (signal, signal.stft(n_fft=512, hop_length=256)):
        data = stage_data(frame, dict(stage_view(frame)))
        assert data is not None and data.values.dtype == np.float64, type(frame).__name__
