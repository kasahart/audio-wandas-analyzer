"""The comparison's picture of every Frame kind a step from ＋ can give (R7).

``src/test/fixtures/stageViewKinds.json`` holds, per Frame kind, the StageView this backend makes of a short
recording's Frame of that kind. The UI test of the plot contract answers the comparison with each of them, so every
kind is drawn and given the same gestures as every plot; the node test holds the kinds to the operation catalogue's.
This test fails when a picture no longer is what the fixture says. Write it again with
``python python-backend/test_stage_view_kinds.py --write``.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
import wandas as wd

from protocol_schema import DEFINITIONS, first_violation
from stage_view import stage_view

FIXTURE = Path(__file__).resolve().parents[1] / "src/test/fixtures/stageViewKinds.json"
RATE = 16000


def _recording() -> wd.ChannelFrame:
    """Two channels of a 1 kHz tone in three bursts, the second channel with a little noise: enough for every kind."""
    rng = np.random.default_rng(3)
    t = np.arange(RATE // 2) / RATE
    gate = ((t > 0.02) & (((t - 0.02) % 0.15) < 0.05) & (t < 0.45)).astype(float)
    tone = 0.5 * np.sin(2 * np.pi * 1000 * t) * gate
    return wd.from_numpy(np.stack([tone, tone + 0.02 * rng.standard_normal(t.size)]), sampling_rate=RATE)


def _kinds(signal: wd.ChannelFrame) -> dict[str, Callable[[], object]]:
    stft = lambda: signal.stft(n_fft=512, hop_length=256)  # noqa: E731
    return {
        "ChannelFrame": lambda: signal,
        "SpectralFrame": lambda: signal.welch(),
        "NOctFrame": lambda: signal.noct_spectrum(fmin=50, fmax=5000, n=3),
        "SpectrogramFrame": stft,
        "CepstralFrame": lambda: signal.cepstrum(),
        "CepstrogramFrame": lambda: stft().cepstrum(),
        "CoherenceFrame": lambda: signal.coherence(),
        "CrossSpectralFrame": lambda: signal.csd(),
        "TransferFunctionFrame": lambda: signal.transfer_function(),
        "CrossCorrelationFrame": lambda: signal.cross_correlation(),
        "RoughnessFrame": lambda: signal.roughness_dw_spec(),
        "ChannelFrameSegments": lambda: signal.trigger(threshold=0.3, duration=0.04, pre=0.005),
    }


def views() -> dict[str, dict]:
    """Each kind's StageView, as the comparison is sent it."""
    out: dict[str, dict] = {}
    for kind, make in _kinds(_recording()).items():
        view = dict(stage_view(make()))
        out[kind] = json.loads(json.dumps(view))
    return out


def _shape(view: dict) -> dict:
    """What a picture is, not its numbers: its kind, axes and quantity, and how many points or cells it has."""
    keys = ("frame", "kind", "x", "xScale", "quantity", "yAxis", "unit")
    shape = {key: view.get(key) for key in keys}
    shape["points"] = len(view.get("xs") or [])
    shape["rows"] = len(view.get("ys") or [])
    shape["events"] = len(view.get("events") or [])
    return shape


@pytest.fixture(scope="module")
def made() -> dict[str, dict]:
    return views()


def test_every_frame_kinds_picture_is_a_stage_view_the_comparison_draws(made: dict[str, dict]) -> None:
    for kind, view in made.items():
        assert first_violation(DEFINITIONS["StageView"], view) is None, kind
        assert view["kind"] in ("line", "bar", "heatmap"), f"{kind} is drawn"
        assert view["frame"] == kind


def test_the_frame_kinds_fixture_is_what_the_backend_draws_now(made: dict[str, dict]) -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert sorted(fixture) == sorted(made), (
        "write the fixture again: python python-backend/test_stage_view_kinds.py --write"
    )
    for kind, view in made.items():
        assert _shape(fixture[kind]) == _shape(view), kind


if __name__ == "__main__":
    if "--write" not in sys.argv:
        raise SystemExit("usage: python python-backend/test_stage_view_kinds.py --write")
    FIXTURE.write_text(json.dumps(views(), separators=(",", ":")) + "\n", encoding="utf-8")
