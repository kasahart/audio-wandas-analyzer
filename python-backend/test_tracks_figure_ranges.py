"""The Tracks screen's two bottom figures as the figure service draws their kept lines (tracks_answers.py): what the
axes are named of and where they end with nothing specified. Each test keeps lines of known values and draws them
through the backend's own command.

- A gain between two units is a transfer level: its axis says the units' ratio.
- Recordings of different sample rates on one lane: the axis across reaches the highest Nyquist frequency.
- 1/N-octave bands: the axis across reaches the outer edges of the first and last band, so every bar is whole.
- A spectrum on a linear axis is drawn from 0 Hz, so its 0 Hz bin counts in the automatic range up.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from frames.level_identity import level_identity
from services.answer_store import STORE
from services.tracks_answers import LineData, keep_pair_lines
from transport.command_dispatch import dispatch, validate_request

FS = level_identity("FS", 1.0, "dBFS")


def _ask(command: str, **payload: Any) -> dict[str, Any]:
    return dict(dispatch(validate_request({"cmd": command, "requestId": "r", **payload}), None))  # type: ignore[arg-type]


_drawn = iter(range(1_000_000))


def _draw(name: str, lanes: list[dict[str, Any]]) -> dict[str, Any]:
    # A figure id is drawn once: a released figure's id is not taken again.
    figure = f"{name}-{next(_drawn)}"
    keys = [line["of"]["key"] for lane in lanes for line in lane["lines"]]
    try:
        picture = _ask(
            "figure-draw",
            figureId=figure,
            generation=1,
            requestNumber=1,
            spec={"lanes": lanes, "keys": [{"key": key, "state": "usable", "version": key} for key in keys]},
            width=900,
            height=240,
            view=None,
            selection=None,
        )
    finally:
        _ask("figure-release", figureId=figure)
    assert picture["status"] == "picture", picture
    return picture


def _lane(name: str, keys: list[str], **more: Any) -> dict[str, Any]:
    return {"id": name, "kind": "lines", "lines": [{"id": key, "of": {"key": key}} for key in keys], **more}


def _keep(key: str, line: LineData) -> str:
    STORE.put(key, line)
    assert STORE.has(key)
    return key


def _spectrum(key: str, rate: float, values: np.ndarray, scale: str = "log") -> str:
    xs = np.fft.rfftfreq(2 * (values.size - 1), 1.0 / rate)
    limits = (20.0 if scale == "log" else 0.0, rate / 2)
    return _keep(key, LineData(xs, values, FS, "level", None, "frequency", scale, limits))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("identity", "unit"),
    [(level_identity("Pa*s^2/m", 1.0, ""), "Pa*s^2/m"), (level_identity("1", 1.0, ""), None)],
)
def test_a_gain_between_two_units_is_drawn_as_a_transfer_level_of_their_ratio(identity: Any, unit: str | None) -> None:
    rows = np.vstack([np.linspace(-20.0, 0.0, 129), np.zeros(129), np.ones(129)])
    keys = keep_pair_lines({"test": f"transfer-unit-{unit}"}, rows, identity, 8000.0, 256, "log")
    assert keys is not None
    picture = _draw("tracks-ranges-gain", [_lane("gain", [keys["gain"]], axis="own")])
    axis = picture["lanes"][0]["axis"]
    assert axis["of"] == "gain"
    # The page names the axis 伝達レベル [unit] where the picture says a unit, 利得 [dB] where it says none
    # (src/webview/figure/axisNames.ts).
    assert axis.get("valueUnit") == unit


@pytest.mark.parametrize("order", [("low", "high"), ("high", "low")])
def test_recordings_of_two_sample_rates_are_drawn_to_the_higher_nyquist_frequency(order: tuple[str, str]) -> None:
    keys = {
        "low": _spectrum("tracks-ranges-8k", 8000.0, np.full(129, -40.0)),
        "high": _spectrum("tracks-ranges-48k", 48000.0, np.full(129, -30.0)),
    }
    picture = _draw("tracks-ranges-rates", [_lane("spectrum", [keys[name] for name in order])])
    assert len(picture["lanes"][0]["lines"]) == 2
    assert picture["lanes"][0]["range"]["x"] == [20.0, 24000.0]


def test_octave_bands_are_drawn_to_the_outer_edges_of_the_first_and_last_band() -> None:
    centres = np.array([125.0, 250.0, 500.0, 1000.0, 2000.0])
    edges = (125.0 / 2**0.5, 2000.0 * 2**0.5)
    key = _keep(
        "tracks-ranges-bands",
        LineData(centres, np.array([-30.0, -20.0, -10.0, -20.0, -30.0]), FS, "level", None, "band", "log", edges),
    )
    picture = _draw("tracks-ranges-bands", [_lane("spectrum", [key])])
    assert picture["lanes"][0]["range"]["x"] == pytest.approx(list(edges))


def test_a_linear_spectrum_counts_its_0_hz_bin_in_the_range_up_and_a_log_one_does_not() -> None:
    values = np.full(129, -80.0)
    values[0] = -10.0  # a DC offset far above everything else
    linear = _draw(
        "tracks-ranges-dc", [_lane("spectrum", [_spectrum("tracks-ranges-dc-linear", 8000.0, values, "linear")])]
    )
    assert linear["lanes"][0]["range"]["x"][0] == 0.0
    assert linear["lanes"][0]["range"]["y"][1] >= -10.0
    # On a log axis 0 Hz is not on the axis: it is neither drawn nor counted.
    log = _draw("tracks-ranges-dc", [_lane("spectrum", [_spectrum("tracks-ranges-dc-log", 8000.0, values, "log")])])
    assert log["lanes"][0]["range"]["y"][1] < -10.0
