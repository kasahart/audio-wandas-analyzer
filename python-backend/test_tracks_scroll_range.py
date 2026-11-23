"""R16 (docs/display-rules.md): a waveform's automatic range up is of the whole recording. Scrolling or zooming the
time (a range specified across) never moves it; only a range specified up does. Each test keeps a recording of
known samples and draws it through the backend's own command, as a Tracks row and as a lane of the compare overlay.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from frames.level_identity import level_identity
from services.tracks_answers import keep_track_signal
from transport.command_dispatch import dispatch, validate_request

FS = level_identity("FS", 1.0, "dBFS")
RATE = 8000.0
RULE = "R16: a waveform's automatic range up is of every sample of the recording, never of the part on screen"


def _ask(command: str, **payload: Any) -> dict[str, Any]:
    return dict(dispatch(validate_request({"cmd": command, "requestId": "r", **payload}), None))  # type: ignore[arg-type]


_drawn = iter(range(1_000_000))


def _draw(key: str, view: dict[str, Any] | None) -> dict[str, Any]:
    figure = f"scroll-{next(_drawn)}"
    lane = {"id": "lane", "kind": "band", "lines": [{"id": "line", "of": {"key": key}}]}
    try:
        picture = _ask(
            "figure-draw",
            figureId=figure,
            generation=1,
            requestNumber=1,
            spec={"lanes": [lane], "keys": [{"key": key, "state": "usable", "version": key}]},
            width=600,
            height=200,
            view=view,
            selection=None,
        )
    finally:
        _ask("figure-release", figureId=figure)
    assert picture["status"] == "picture", picture
    return picture["lanes"][0]


def _recording(key: str) -> str:
    # Four seconds of a quiet hum (0.01) with one loud knock (0.8) at 3 s: most screens of it do not hold the knock.
    times = np.arange(int(RATE * 4)) / RATE
    values = (0.01 * np.sin(2 * np.pi * 50 * times)).astype(np.float32)
    values[int(RATE * 3)] = 0.8
    assert keep_track_signal(key, RATE, values, FS, "")
    return key


@pytest.mark.parametrize(
    "across",
    [[0.0, 1.0], [1.0, 2.0], [2.5, 3.5], [0.5, 0.501], [None, 2.0], [1.5, None]],
    ids=["first-second", "scrolled", "with-the-knock", "zoomed-in-far", "left-end-only", "right-end-only"],
)
def test_scrolling_or_zooming_the_time_keeps_the_rows_range_up(across: list[float | None]) -> None:
    key = _recording("scroll-row")
    whole = _draw(key, None)["range"]["y"]
    assert whole == [-0.9, 0.9]
    shown = _draw(key, {"x": across})
    assert shown["range"]["y"] == whole, (
        f"{RULE}: with the time {across} on screen the range up became {shown['range']['y']}, the whole "
        f"recording's is {whole}. Fix python-backend/figures/ranges.py (whole_band / band_range) or the band plan in "
        "figures/service.py, not the screen."
    )


def test_a_range_specified_up_is_still_the_requests_while_scrolled() -> None:
    key = _recording("scroll-typed")
    typed = {"x": [1.0, 2.0], "lanes": [{"lane": "lane", "y": [-0.05, 0.05]}]}
    assert _draw(key, typed)["range"]["y"] == [-0.05, 0.05], f"{RULE}; a range typed up is used as typed"
    one_end = {"x": [1.0, 2.0], "lanes": [{"lane": "lane", "y": [None, 0.5]}]}
    assert _draw(key, one_end)["range"]["y"] == [-0.9, 0.5], f"{RULE}; the end not typed is the whole recording's"
