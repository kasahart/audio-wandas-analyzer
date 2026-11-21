"""A trigger's events on the NEW path (仕様 5): each event is an answer named as any other (the
trigger step's key, ``#event:``, the event's number) and drawn as a time signal over the time from its trigger, by
the band lane's own rules (figures/: nothing is added there for events). The old path's recorded answers
(tests/fixtures/figure_bench_cases.json, step ``events``) are replayed against it.

What is not the old path's, on purpose: no line of the events' mean is drawn, and the events are
drawn in the order they are declared (their numbers), not the quietest on top (仕様 1, 5).
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pytest

from frames import stage_view as sv
from services.stage_combine import STORE, StageData, stage_data
from test_figure_bench_cases import FIXTURE, _data, scene_recording
from transport.command_dispatch import dispatch, validate_request
from transport.figure_answers import (
    EVENT_MARK,
    EVENT_MEAN,
    EVENTS_MARK,
    FIGURES,
    StoreAnswers,
    event_answer_of,
    event_key,
)
from transport.protocol_schema import result_violation

TABLE = json.loads(FIXTURE.read_text(encoding="utf-8"))


def _events(name: str) -> StageData:
    data = _data(TABLE["scenes"], {"scene": "group", "step": "events"}, name)
    assert data is not None and data.mode == "events"
    return data


def _ask(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = validate_request({"cmd": command, "requestId": "r", **payload})
    result = dict(dispatch(request, None))  # type: ignore[arg-type]
    assert result_violation(command, result) is None, (command, result_violation(command, result))
    return result


def test_an_event_is_the_recorded_row_at_the_recorded_times_from_its_trigger() -> None:
    """The old read of one event's own line (``events_one_event``): every sample of the window, at its time from the
    trigger. The event's answer holds the same samples at the same times (sample n at ``start + n / rate``)."""
    case = next(case for case in TABLE["read"] if case["id"] == "events_one_event")
    data = _events(case["input"]["base"][0])
    answer = event_answer_of(event_key("step", 0), data, case["input"]["read"]["event"], "step")
    assert answer is not None and answer.key == f"step{EVENT_MARK}0" and answer.version == "step"
    for x, value in zip(case["expected"]["xs"], case["expected"]["values"], strict=True):
        index = round((x - answer.start) * answer.rate)
        assert answer.start + index / answer.rate == pytest.approx(x, abs=1e-12)
        assert float(answer.values[index]) == value
    # Every event of the step is on one axis: they are drawn over one another.
    others = [event_answer_of(event_key("step", event), data, event, "step") for event in data.event_ids]
    assert len(others) > 1 and {other.axis for other in others if other is not None} == {answer.axis}
    assert event_answer_of(event_key("step", 99), data, 99, "step") is None


def test_an_event_key_is_answered_from_the_trigger_steps_kept_values_only() -> None:
    data = _events("base1")
    STORE.put("ev-step", data)
    source = StoreAnswers()
    first = source.answer(event_key("ev-step", data.event_ids[0]))
    assert first is not None and first.values is not None and len(first.values) == data.rows.shape[1]  # type: ignore[union-attr]
    # No such event, no such step, or a step that is not a trigger's: no answer (counted evicted by 計算ア).
    assert source.answer(event_key("ev-step", 99)) is None
    assert source.answer(event_key("ev-none", 0)) is None
    STORE.put("ev-line", _data(TABLE["scenes"], {"scene": "group", "step": "rms"}, "base1"))  # type: ignore[arg-type]
    assert source.answer(event_key("ev-line", 0)) is None


def test_the_events_of_two_recordings_are_lines_of_one_band_lane_in_declared_order() -> None:
    """The comparison's declaration: the base's events by number, then the compared recording's, a line each, in a
    band lane. Drawn in that order over the time from the trigger (from ``-pre`` to the last sample), each read as
    its own sample; no median, no Δ, and the count is of the events drawn."""
    base, compare = _events("base1"), _events("compare")
    STORE.put("ev-base", base)
    STORE.put("ev-compare", compare)
    lines = [
        {"id": f"{role}-{event}", "role": role, "of": {"key": event_key(key, event)}}
        for key, role, data in (("ev-base", "base", base), ("ev-compare", "compare1", compare))
        for event in data.event_ids
    ]
    # An event's key carries the version of its step's answer.
    keys = [line["of"]["key"] for line in lines]
    spec = {
        "lanes": [{"id": "events", "kind": "band", "lines": lines}],
        "keys": [{"key": key, "state": "usable", "version": key.rpartition(EVENT_MARK)[0]} for key in keys],
    }
    request = {"figureId": "ev-fig", "generation": 0, "requestNumber": 0, "spec": spec, "width": 800, "height": 300}
    picture = _ask("figure-draw", {**request, "view": None, "selection": None})
    assert picture["status"] == "picture"
    (lane,) = picture["lanes"]
    assert [line["id"] for line in lane["lines"]] == [line["id"] for line in lines]
    assert lane["range"]["x"] == [base.event_start, base.event_start + (base.rows.shape[1] - 1) / base.event_rate]  # type: ignore[union-attr]
    assert picture["members"]["shown"]["n"] == len(lines)
    # A read on the base's first event's highest sample: that event's own sample, unrounded.
    row = base.rows[0]  # type: ignore[index]
    at = int(row.argmax())
    x = base.event_start + at / base.event_rate
    pointer = {"lane": "events", "x": x, "y": float(row[at]), "scale": [8000, 300]}
    read = _ask(
        "figure-read", {"figureId": "ev-fig", "pictureId": picture["pictureId"], "requestNumber": 1, "pointer": pointer}
    )
    assert read["status"] == "point"
    assert read["point"]["x"] == pytest.approx(x, abs=1e-12) and read["point"]["xStep"] == pytest.approx(1 / 8000)
    owner = next(line for line in lines if line["id"] == read["line"])
    kept = base if owner["role"] == "base" else compare
    event = int(owner["of"]["key"].rpartition(EVENT_MARK)[2])
    assert read["point"]["value"] == float(kept.rows[kept.event_ids.index(event)][read["point"]["index"]])  # type: ignore[index]


def test_a_base_groups_line_is_the_median_of_its_recordings_event_means() -> None:
    """A base group of a trigger's events is one line: the median, sample by sample, of each recording's events'
    mean (第 1 節の表「トリガーのイベント」: 録音をまたぐ中央値は、その平均どうしで).
    The means are layer 1's (the step's
    own values); the mean is no line of its own. A median of recordings' sounds is refused."""
    names = ["base1", "base2", "base3"]
    kept = {name: _events(name) for name in names}
    for name, data in kept.items():
        STORE.put(f"evm-{name}", data)
    compare = _events("compare")
    STORE.put("evm-compare", compare)
    means = [event_key(f"evm-{name}", EVENT_MEAN) for name in names]
    events = [event_key("evm-compare", event) for event in compare.event_ids]
    lines = [
        {"id": "base", "role": "base", "of": {"median": means}},
        *({"id": f"compare1-{at}", "role": "compare1", "of": {"key": key}} for at, key in enumerate(events)),
    ]
    spec = {
        "lanes": [{"id": "events", "kind": "band", "lines": lines}],
        "keys": [
            {"key": key, "state": "usable", "version": key.rpartition(EVENT_MARK)[0]} for key in [*means, *events]
        ],
    }
    request = {"figureId": "evm-fig", "generation": 0, "requestNumber": 0, "spec": spec, "width": 4000, "height": 300}
    picture = _ask("figure-draw", {**request, "view": None, "selection": None})
    assert picture["status"] == "picture"
    (lane,) = picture["lanes"]
    assert lane["axis"]["x"] == "triggerTime" and lane["axis"]["quantity"] == "value"
    base = lane["lines"][0]
    assert base["id"] == "base" and "key" not in base
    used = next(item for item in picture["members"]["lines"] if item["line"] == "base")["used"]
    assert used == means
    # Wide enough that every sample is drawn as itself: the line is the median of the three means.
    expected = np.median(np.stack([kept[name].values for name in names]), axis=0)
    assert len(base["values"]) == expected.size
    assert base["values"] == pytest.approx(expected.tolist(), abs=1e-12)
    # The draw reserves what the median takes before computing it: the means stacked whole as float64, the copy
    # np.median works on, and the median it holds (a large group of long events is refused, never over the budget).
    stack = 8 * expected.size * len(names)
    assert FIGURES._estimate(spec) >= 2 * stack + 8 * expected.size  # noqa: SLF001

    # Recordings' sounds have no median: the same declaration of plain signals is refused.
    for name in ("base1", "base2"):
        sound = scene_recording(TABLE["scenes"]["group"], name)
        STORE.put(f"evm-sound-{name}", stage_data(sound, dict(sv.stage_view(sound))))  # type: ignore[arg-type]
    sounds = ["evm-sound-base1", "evm-sound-base2"]
    spec = {
        "lanes": [{"id": "s", "kind": "band", "lines": [{"id": "base", "role": "base", "of": {"median": sounds}}]}],
        "keys": [{"key": key, "state": "usable", "version": key} for key in sounds],
    }
    refused = validate_request({"cmd": "figure-draw", "requestId": "r", **request, "figureId": "evm-s", "spec": spec})
    with pytest.raises(Exception, match="median only of a trigger's events' means"):
        dispatch(refused, None)  # type: ignore[arg-type]


def _trigger_lanes(level: float, out: list[int]) -> tuple[dict[str, Any], dict[str, StageData]]:
    """The declaration of the lanes under a trigger's events: a band lane a recording, each the recording's sound (as
    the trigger takes it) with the trigger declared (its events' key, its level, pre, duration, the events out)."""
    fired = {name: _events(name) for name in ("base1", "compare")}
    lanes, keys = [], []
    for at, (name, events) in enumerate(fired.items()):
        sound = scene_recording(TABLE["scenes"]["group"], name)
        STORE.put(f"tl-sound-{name}", stage_data(sound, dict(sv.stage_view(sound))))  # type: ignore[arg-type]
        STORE.put(f"tl-step-{name}", events)
        role = "base" if at == 0 else "compare1"
        lanes.append(
            {
                "id": f"lane-{name}",
                "kind": "band",
                "lines": [{"id": f"line-{name}", "role": role, "of": {"key": f"tl-sound-{name}"}}],
                "trigger": {
                    "events": f"tl-step-{name}{EVENTS_MARK}",
                    "threshold": level,
                    "pre": 0.01,
                    "duration": 0.05,
                    "out": out if at == 0 else [],
                },
            }
        )
        keys.append({"key": f"tl-sound-{name}", "state": "usable", "version": f"tl-sound-{name}"})
        keys.append({"key": f"tl-step-{name}{EVENTS_MARK}", "state": "usable", "version": f"tl-step-{name}"})
    return {"lanes": lanes, "keys": keys}, fired


def test_the_lanes_under_a_triggers_events_carry_its_level_firings_and_cuts_as_guides() -> None:
    """Each recording as the trigger takes it is a band lane of its own; the figure service makes its guide lines
    (目安の線) of the trigger declared: the level up the lane, each event's firing time (layer 1's: the step's own
    cut) named by its number and marked when left out, the stretch each event used was cut over, and how many are
    used. The lanes are looked at together: the same seconds across, one range up that keeps the level in sight."""
    spec, fired = _trigger_lanes(level=0.2, out=[1])
    request = {"figureId": "tl-fig", "generation": 0, "requestNumber": 0, "spec": spec, "width": 800, "height": 400}
    picture = _ask("figure-draw", {**request, "view": None, "selection": None})
    assert picture["status"] == "picture"
    base, compare = picture["lanes"]
    assert [lane["kind"] for lane in picture["lanes"]] == ["band", "band"]
    assert base["axis"]["quantity"] == "value" and "x" not in base["axis"]
    for lane, name, out in ((base, "base1", {1}), (compare, "compare", set())):
        events = fired[name]
        assert lane["guides"][0] == {"axis": "y", "at": 0.2, "id": "threshold"}
        firings = lane["guides"][1:]
        assert [guide["id"] for guide in firings] == [f"event:{number}" for number in events.event_ids]
        assert [guide["at"] for guide in firings] == pytest.approx(list(events.event_times), abs=1e-12)
        assert [guide.get("out", False) for guide in firings] == [number in out for number in events.event_ids]
        used = [time for number, time in zip(events.event_ids, events.event_times, strict=True) if number not in out]
        assert [span["start"] for span in lane["spans"]] == pytest.approx([time - 0.01 for time in used], abs=1e-12)
        assert [span["end"] for span in lane["spans"]] == pytest.approx([time + 0.04 for time in used], abs=1e-12)
        assert lane["events"] == {"used": len(used), "total": len(events.event_ids)}
    # Together: the same seconds across, the same range up.
    assert base["range"] == compare["range"] and base["whole"] == compare["whole"]

    # A level above every sample stays in sight, with a little room.
    high, _ = _trigger_lanes(level=5.0, out=[])
    tall = _ask("figure-draw", {**request, "figureId": "tl-high", "spec": high, "view": None, "selection": None})
    for lane in tall["lanes"]:
        assert lane["range"]["y"][1] >= 5.0 * 1.05 and lane["range"]["y"][0] == -lane["range"]["y"][1]

    # The events no longer kept: the lane keeps its signal and its level, with no firing and no cut, and says that
    # no events' answer is held (let go: ``evicted``), never that the trigger fired 0 times of 0.
    lost = json.loads(json.dumps(spec).replace("tl-step-base1", "tl-step-lost"))
    gone = _ask("figure-draw", {**request, "figureId": "tl-gone", "spec": lost, "view": None, "selection": None})
    assert [guide["id"] for guide in gone["lanes"][0]["guides"]] == ["threshold"]
    assert gone["lanes"][0]["spans"] == []
    assert gone["lanes"][0]["events"] == {"used": 0, "total": 0, "missing": "evicted"}
    assert len(gone["lanes"][0]["lines"]) == 1
    assert "missing" not in gone["lanes"][1]["events"]
    # The events still on their way (their key says so): missing for that reason.
    coming = json.loads(json.dumps(lost))
    for entry in coming["keys"]:
        if entry["key"].startswith("tl-step-lost"):
            entry["state"] = "pending"
    waits = _ask("figure-draw", {**request, "figureId": "tl-waits", "spec": coming, "view": None, "selection": None})
    assert waits["lanes"][0]["events"] == {"used": 0, "total": 0, "missing": "pending"}

    # Only a band lane declares a trigger.
    wrong = {**spec, "lanes": [{**spec["lanes"][1], "kind": "lines"}]}
    refused = validate_request(
        {"cmd": "figure-draw", "requestId": "r", **request, "figureId": "tl-wrong", "spec": wrong}
    )
    with pytest.raises(Exception, match="only a band lane"):
        dispatch(refused, None)  # type: ignore[arg-type]
