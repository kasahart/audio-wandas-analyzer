"""What the figure service shows and counts is the set answers/ calls usable, on the real path (docs/
figure-design.md 第 5 節: the states are answers/'s, the counting is the figure service's).

Real wandas spectra are kept in stage_combine.STORE as a scan keeps them; the requests go through command_dispatch and
transport/figure_answers.py, each reply checked against protocol_schema.py. The spec's keys carry the states answers/
gives them (src/webview/answers/figureKeys.ts keyState: the answer store's ready, stale, pending, failed and missing
are usable, stale, pending, failed and evicted; src/test/figureRequests.test.ts holds that mapping). Mixed in: a
pending, a stale, a failed key, a key the store let go over its budget (evicted by the store itself, though the
webview still calls it usable), and the usable ones. The recordings drawn and n are exactly the usable ones the
service holds; a stale answer is never counted, nor in the median, even though the store still keeps its values.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
import wandas as wd

from frames.stage_view import stage_view
from services.stage_combine import STAGE_DATA_BUDGET_BYTES, STORE, stage_data
from transport.command_dispatch import dispatch, validate_request
from transport.protocol_schema import result_violation

RATE = 16000


def _spectrum(level: float, seed: int) -> wd.SpectralFrame:
    noise = 10 ** (level / 20) * np.random.default_rng(seed).standard_normal(RATE)
    return wd.from_numpy(noise[np.newaxis], sampling_rate=RATE).welch(n_fft=1024)


def _ask(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = validate_request({"cmd": command, "requestId": "r", **payload})
    result = dict(dispatch(request, None))  # type: ignore[arg-type]
    assert result_violation(command, result) is None, (command, result_violation(command, result))
    return result


def _spec(base: list[str], compare: str, states: dict[str, str]) -> dict[str, Any]:
    keys = [*base, compare]
    return {
        "lanes": [
            {
                "id": "overlay",
                "kind": "lines",
                "lines": [
                    {"id": "base", "of": {"median": base}, "role": "base"},
                    {"id": "cmp", "of": {"key": compare}, "role": "compare1"},
                ],
            },
            {
                "id": "delta",
                "kind": "lines",
                "lines": [{"id": "delta1", "of": {"delta": {"compare": compare, "base": base}}}],
            },
        ],
        # A key's version is the key itself (transport/figure_answers.py: a scan's data key never changes its answer).
        "keys": [{"key": key, "state": states.get(key, "usable"), "version": key} for key in keys],
    }


def _draw(spec: dict[str, Any], figure: str) -> dict[str, Any]:
    return _ask(
        "figure-draw",
        {
            "figureId": figure,
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
def kept() -> Any:
    """The store holding u1, u2, u3, cmp and the stale one's old values, having let ``ev`` go over its budget."""
    STORE.clear()
    levels = {"ev": -20.0, "u1": -40.0, "u2": -50.0, "u3": -45.0, "cmp": -30.0, "st": -10.0, "pe": -35.0}
    data = {}
    for seed, (key, level) in enumerate(levels.items()):
        frame = _spectrum(level, seed)
        made = stage_data(frame, dict(stage_view(frame)))
        assert made is not None
        data[key] = made
    STORE.put("ev", data["ev"])  # the least recently used: the first the store lets go
    for key in ("u1", "u2", "u3", "cmp", "st", "pe"):
        STORE.put(key, data[key])
    STORE.resize(sum(data[key].nbytes for key in ("u1", "u2", "u3", "cmp", "st", "pe")))
    assert not STORE.has("ev") and STORE.has("st"), "the store let ev go and still keeps the stale answer's old values"
    try:
        yield data
    finally:
        STORE.resize(STAGE_DATA_BUDGET_BYTES)
        STORE.clear()


def test_the_drawn_recordings_and_n_are_the_usable_set_and_stale_failed_evicted_are_counted_out(kept: Any) -> None:
    states = {"st": "stale", "fl": "failed"}
    spec = _spec(["u1", "u2", "u3", "st", "fl", "ev"], "cmp", states)
    picture = _draw(spec, "members-real")
    usable = ["u1", "u2", "u3", "cmp"]
    shown = picture["members"]["shown"]
    assert shown["used"] == usable and shown["n"] == len(usable)
    assert {item["key"]: item["reason"] for item in shown["excluded"]} == {
        "st": "stale",
        "fl": "failed",
        "ev": "evicted",
    }
    combined = picture["members"]["combined"]
    assert combined["used"] == usable and combined["n"] == len(usable)
    base = next(line for line in picture["members"]["lines"] if line["line"] == "base")
    assert base["drawn"] is True and base["used"] == ["u1", "u2", "u3"]
    # The median drawn and read is of the usable base only: the stale one's kept values (−10 dB) are not in it.
    median = np.median(np.stack([kept[key].values for key in ("u1", "u2", "u3")]), axis=0)
    xs = kept["u1"].xs
    read = _ask(
        "figure-read",
        {
            "figureId": "members-real",
            "pictureId": picture["pictureId"],
            "requestNumber": 1,
            "name": {"line": "base", "x": float(xs[64])},
        },
    )
    assert read["point"]["value"] == pytest.approx(float(median[64]), abs=1e-12)
    exported = _ask("figure-export", {"spec": spec, "dataId": picture["dataId"]})
    column = next(item for item in exported["columns"] if item["line"] == "base")
    assert column["values"] == pytest.approx([float(value) for value in median], abs=1e-12)
    # The table's count is the picture's (count goes through the same 計算ア).
    assert _ask("figure-count", {"spec": spec})["members"] == picture["members"]
    _ask("figure-release", {"figureId": "members-real"})


def test_a_pending_base_recording_holds_the_median_and_is_counted_pending_never_usable(kept: Any) -> None:
    spec = _spec(["u1", "u2", "u3", "pe", "st"], "cmp", {"pe": "pending", "st": "stale"})
    picture = _draw(spec, "members-real-pending")
    shown = picture["members"]["shown"]
    assert shown["used"] == ["u1", "u2", "u3", "cmp"] and shown["n"] == 4
    assert {item["key"]: item["reason"] for item in shown["excluded"]} == {"pe": "pending", "st": "stale"}
    base = next(line for line in picture["members"]["lines"] if line["line"] == "base")
    assert base["drawn"] is False and base["used"] == ["u1", "u2", "u3"]
    drawn = [line["id"] for lane in picture["lanes"] for line in lane["lines"]]
    assert drawn == ["cmp"], "the compared recording is drawn; the median and its Δ wait for the pending one"
    _ask("figure-release", {"figureId": "members-real-pending"})
