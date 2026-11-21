"""計算ア counts a base group's recordings of another channel count, and those without the channel compared, itself
(the screen leaves none out before the figure service).

- ``other-channels``: a kept step's answer says how many channels its values combine (stage_combine.StageData
  ``channels``, the step's Frame's, passed on by transport/figure_answers.py). A recording of another count than the
  compared answer's is drawn where its line is its own, but is not in a median or a Δ, and is counted with why.
- ``no-channel``: a recording compared as a channel its file does not have has no answer of it. The spec's key says
  the channel it is compared as and its file's channel count; the service counts it ``no-channel``, whatever its
  state, and the median of the others is drawn.

Real wandas spectra kept in stage_combine.STORE as a scan keeps them; requests through command_dispatch, each reply
checked against protocol_schema.py (the reasons are the protocol's).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
import wandas as wd

from frames.stage_view import stage_view
from services.stage_combine import STORE, stage_data
from transport.command_dispatch import dispatch, validate_request
from transport.protocol_schema import result_violation

RATE = 16000


def _kept(key: str, level: float, channels: int, seed: int) -> None:
    noise = 10 ** (level / 20) * np.random.default_rng(seed).standard_normal((channels, RATE))
    frame = wd.from_numpy(noise, sampling_rate=RATE).welch(n_fft=1024)
    made = stage_data(frame, dict(stage_view(frame)))
    assert made is not None
    assert made.channels == channels, "the kept step says how many channels its values combine"
    STORE.put(key, made)


def _ask(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = validate_request({"cmd": command, "requestId": "r", **payload})
    result = dict(dispatch(request, None))  # type: ignore[arg-type]
    assert result_violation(command, result) is None, (command, result_violation(command, result))
    return result


def _draw(base: list[str], compare: str, keys: list[dict[str, Any]]) -> dict[str, Any]:
    spec = {
        "lanes": [
            {
                "id": "overlay",
                "kind": "lines",
                "lines": [
                    {"id": "base", "of": {"median": base}, "role": "base"},
                    {"id": "cmp", "of": {"key": compare}, "role": "compare1"},
                ],
            }
        ],
        "keys": keys,
    }
    return _ask(
        "figure-draw",
        {
            "figureId": "f",
            "generation": 1,
            "requestNumber": 1,
            "spec": spec,
            "width": 640,
            "height": 240,
            "view": None,
            "selection": None,
        },
    )


@pytest.fixture
def store() -> Any:
    STORE.clear()
    try:
        yield STORE
    finally:
        STORE.clear()


def _base_line(reply: dict[str, Any]) -> dict[str, Any]:
    return next(line for line in reply["members"]["lines"] if line["line"] == "base")


def test_a_base_recording_of_another_channel_count_is_left_out_of_the_median_with_why(store: Any) -> None:
    _kept("cmp", -30.0, 2, 1)
    _kept("s1", -40.0, 2, 2)
    _kept("s2", -42.0, 2, 3)
    _kept("mono", -10.0, 1, 4)
    keys = [{"key": key, "state": "usable", "version": key} for key in ("s1", "s2", "mono", "cmp")]
    reply = _draw(["s1", "s2", "mono"], "cmp", keys)
    assert reply["status"] == "picture"
    base = _base_line(reply)
    assert base["drawn"] is True
    assert base["used"] == ["s1", "s2"]
    assert base["excluded"] == [{"key": "mono", "reason": "other-channels"}]
    combined = reply["members"]["combined"]
    assert combined["n"] == 3 and {"key": "mono", "reason": "other-channels"} in combined["excluded"]


def test_a_base_recording_without_the_channel_compared_is_counted_no_channel_whatever_its_state(store: Any) -> None:
    _kept("cmp", -30.0, 1, 1)
    _kept("s1", -40.0, 1, 2)
    _kept("s2", -42.0, 1, 3)
    # Compared as channel 2: the members are of their second channel; "one" has a single channel, no answer of it.
    keys = [
        {"key": "s1", "state": "usable", "version": "s1", "channel": 2, "channels": 2},
        {"key": "s2", "state": "usable", "version": "s2", "channel": 2, "channels": 2},
        {"key": "failed|one", "state": "failed", "version": "0", "channel": 2, "channels": 1},
        {"key": "cmp", "state": "usable", "version": "cmp", "channel": 2, "channels": 2},
    ]
    reply = _draw(["s1", "s2", "failed|one"], "cmp", keys)
    base = _base_line(reply)
    assert base["drawn"] is True and base["used"] == ["s1", "s2"]
    assert base["excluded"] == [{"key": "failed|one", "reason": "no-channel"}]
    assert {"key": "failed|one", "reason": "no-channel"} in reply["members"]["shown"]["excluded"]
    # A recording that has the channel but whose file failed is failed, not no-channel.
    keys[2] = {"key": "failed|one", "state": "failed", "version": "0", "channel": 2, "channels": 2}
    assert _base_line(_draw(["s1", "s2", "failed|one"], "cmp", keys))["excluded"] == [
        {"key": "failed|one", "reason": "failed"}
    ]
