"""The comparison's other lines on the figure service: a metric and a level over time, a cepstrum, a
cross-correlation and the three figures of a channel pair (coherence, transfer function, cross spectrum), replayed
from the old path's recorded cases (tests/fixtures/figure_bench_cases.json).

Each recorded case is asked of the new path (the kept step through transport/figure_answers.py's ``answer_of``, the
figure service's draw, export and read) and what layer 2 owns is compared with what the old path answered:

- ``view`` (a recording's whole picture): the axes' ends across, the value axis's automatic range (the old webview
  rule of the recorded value range, figures/ranges.py) and what the axes are named of;
- ``combine``: the Δ's headline point (the recorded peak) and, of the whole picture, the Δ axis's automatic range;
- ``read``: every full-resolution point the old path read is the new path's answer at that place (the export's
  columns: the recording, the base's median, the Δ), and an arrow key's next point is the read's step.

``NOT_REPLAYED`` lists the cases whose answer the new path gives by another rule on purpose, each with the rule.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import pytest

from figures.ranges import nice_range
from figures.service import FigureService
from test_figure_bench_cases import FIXTURE, _data
from test_figure_heatmap_cases import numbers
from transport.figure_answers import CombineOps, answer_of

#: The steps drawn as lines over one axis (transport/figure_answers.py LINE_MODES), by the fixture's names.
LINE_STEPS = ("rms", "rms_db", "cepstrum", "correlation", "coherence", "transfer", "csd", "bands")
DB_STEPS = ("rms_db", "transfer", "csd", "bands")

WHOLE_AXIS = (
    "the value axis's automatic range is of the whole axis, whatever part across is on screen "
    "(figures/ranges.py: the old overlay ranged its value axis by its whole pictures); the points drawn are 計算ウ's "
    "(test_figures_thinning.py)"
)
#: The line kinds' recorded cases not compared, and why (the rule the new path follows instead).
NOT_REPLAYED = {("view", f"{step}_zoomed"): WHOLE_AXIS for step in LINE_STEPS}

FIX = (
    "The figure service no longer answers this recorded case of tests/fixtures/figure_bench_cases.json as the old "
    "path did. The rules are figures/ranges.py (計算イ), figures/headline.py (計算オ) and "
    "services/combine_ops.py (the median, the Δ, the common length); the hand-off is transport/figure_answers.py. "
    "If the change is meant, list the case in NOT_REPLAYED with the rule that replaces it."
)

TABLE = json.loads(FIXTURE.read_text(encoding="utf-8"))


class _Source:
    def __init__(self, answers: dict[str, Any]) -> None:
        self.answers = answers

    def answer(self, key: str) -> Any:
        return self.answers.get(key)


def _cases(section: str) -> list[dict[str, Any]]:
    return [
        case
        for case in TABLE[section]
        if case["input"]["step"] in LINE_STEPS and (section, case["id"]) not in NOT_REPLAYED
    ]


def _service(given: dict[str, Any], names: list[str]) -> FigureService:
    answers = {}
    for name in names:
        data = _data(TABLE["scenes"], given, name)
        assert data is not None
        answers[name] = answer_of(name, data)
    return FigureService(_Source(answers), CombineOps())


def _spec(base: list[str], compare: str | None) -> dict[str, Any]:
    """The comparison's spec: the base (its median, or the one recording), the compared recording and its Δ."""
    lines: list[dict[str, Any]] = [{"id": "base", "of": {"median": base}, "role": "base"}]
    lanes: list[dict[str, Any]] = [{"id": "overlay", "kind": "lines", "lines": lines}]
    if compare is not None:
        lines.append({"id": "compare", "of": {"key": compare}, "role": "compare1"})
        delta = {"id": "delta1", "of": {"delta": {"compare": compare, "base": base}}}
        lanes.append({"id": "delta", "kind": "lines", "lines": [delta]})
    keys = [*dict.fromkeys([*base, *([compare] if compare else [])])]
    return {"lanes": lanes, "keys": [{"key": key, "state": "usable", "version": key} for key in keys]}


def _drawn(given: dict[str, Any], base: list[str], compare: str | None, x: list[float] | None = None) -> Any:
    service = _service(given, [*base, *([compare] if compare else [])])
    request = {"figureId": "f", "generation": 1, "requestNumber": 1, "width": 600, "height": 200}
    spec = _spec(base, compare)
    view = {"x": x} if x is not None else None
    picture = service.draw({**request, "spec": spec, "view": view})
    assert picture["status"] == "picture"
    return service, spec, view, picture


def _lane(picture: dict[str, Any], lane: str) -> dict[str, Any]:
    return next(item for item in picture["lanes"] if item["id"] == lane)


def _symmetric(found: dict[str, float]) -> list[float]:
    reach = max(abs(found["min"]), abs(found["max"])) * 1.05
    return list(nice_range(-reach, reach))


def test_every_recorded_case_of_a_line_kind_is_replayed_or_listed_with_its_rule() -> None:
    for (section, case_id), why in NOT_REPLAYED.items():
        assert why and any(case["id"] == case_id for case in TABLE[section]), f"{section}: no case {case_id}"
    for section in ("view", "combine", "read"):
        assert {case["input"]["step"] for case in _cases(section)} == set(LINE_STEPS), f"{section}: a kind is missing"


@pytest.mark.parametrize("case", _cases("view"), ids=lambda case: case["id"])
def test_a_recordings_line_has_the_old_axes_and_the_old_automatic_range(case: dict[str, Any]) -> None:
    given, old = numbers(case["input"]), numbers(case["expected"])
    _, _, _, picture = _drawn(given, [given["recording"]], None)
    lane = _lane(picture, "overlay")
    axis, found, step = lane["axis"], old["valueRange"], given["step"]
    try:
        # Across: a spectrum's 20 Hz to Nyquist, any other line's first to last point.
        source = old["xSource"]
        assert lane["range"]["x"] == pytest.approx(old.get("xLimits", [source["first"], source["last"]]))
        assert axis["xScale"] == old["xScale"] and axis["x"] == old["x"] and axis["of"] == old["quantity"]
        assert axis["quantity"] == ("level" if step in DB_STEPS else "value")
        for name, sent in (("valueUnit", "unit"), ("measure", "measure"), ("pair", "pair")):
            assert axis.get(name) == old.get(sent), name
        low, high = lane["range"]["y"]
        if step in DB_STEPS:
            # The dB rule (ranges._level_auto): round ends holding every value, less than a step (25 dB at most) out.
            assert low <= found["min"] and high >= found["max"]
            assert high - found["max"] < 25 and (found["min"] - low < 25 or high - low == 100)
        elif step == "coherence":
            assert [low, high] == [0.0, 1.0]
        elif step == "correlation":
            assert [low, high] == [-1.0, 1.0]
        elif step == "cepstrum":
            assert [low, high] == pytest.approx(_symmetric(found))
        else:
            pad = (found["max"] - found["min"]) * 0.05
            assert [low, high] == pytest.approx(list(nice_range(found["min"] - pad, found["max"] + pad)))
        # A recording alone is drawn of its own answer: nothing is left out, nothing combined.
        assert picture["members"]["shown"]["n"] == 1 and len(lane["lines"]) == 1
    except AssertionError as error:
        raise AssertionError(f"{case['id']}: {case['description']} {error} {FIX}") from error


@pytest.mark.parametrize("case", _cases("combine"), ids=lambda case: case["id"])
def test_the_delta_headline_and_range_are_the_old_ones(case: dict[str, Any]) -> None:
    given, old = numbers(case["input"]), numbers(case["expected"])
    detail = given.get("detail")
    _, _, _, picture = _drawn(given, given["base"], given["compare"], detail["x"] if detail else None)
    lane, diff = _lane(picture, "delta"), old["diff"]
    try:
        assert lane["axis"]["quantity"] == "delta" and lane["axis"]["of"] == diff["quantity"]
        (headline,) = picture["headlines"]
        peak = diff["peak"]
        assert (headline["lane"], headline["line"]) == ("delta", "delta1")
        assert headline["x"] == pytest.approx(peak["x"], abs=1e-12)
        assert headline["value"] == pytest.approx(peak["value"], rel=1e-9, abs=1e-12)
        assert headline["xStep"] == pytest.approx(peak["xStep"], rel=1e-6)
        if detail is None:
            found = diff["valueRange"]
            low, high = lane["range"]["y"]
            if given["step"] in DB_STEPS:
                # A Δ in dB: symmetric, at least ±6 dB, on a 4, 8 or 20 dB step, less than a step past the largest.
                reach = max(abs(found["min"]), abs(found["max"]), 6.0)
                assert low == -high and reach <= high < reach + 20 and high % 4 == 0
            else:
                assert [low, high] == pytest.approx(_symmetric(found))
        # The median is drawn of a group only: a base of one recording is that recording's own line.
        base = next(line for line in _lane(picture, "overlay")["lines"] if line["id"] == "base")
        assert ("key" in base) == (len(given["base"]) == 1)
    except AssertionError as error:
        raise AssertionError(f"{case['id']}: {case['description']} {error} {FIX}") from error


@pytest.mark.parametrize("case", _cases("read"), ids=lambda case: case["id"])
def test_the_points_the_old_path_read_are_the_new_paths_answers(case: dict[str, Any]) -> None:
    given, old = numbers(case["input"]), numbers(case["expected"])
    read = given["read"]
    of = read.get("of")
    service, spec, view, picture = _drawn(given, given["base"], given.get("compare"))
    line = {"base": "base", "diff": "delta1"}.get(of, "base")
    lane = "delta" if of == "diff" else "overlay"
    try:
        rows = service.export({"spec": spec, "view": view, "dataId": picture["dataId"]})
        assert rows["status"] == "rows"
        column = next(item for item in rows["columns"] if item["line"] == line)
        xs = np.asarray(column["xs"], dtype=np.float64)
        if "seek" in read:
            # An arrow key: from the point at the place read, the next point with a value onward.
            (start, onward), (_, value) = old["xs"], old["values"]
            ask = {"figureId": "f", "pictureId": picture["pictureId"], "requestNumber": 2}
            key = given["base"][0]
            named = service.read({**ask, "name": {"lane": lane, "line": line, "key": key, "x": start}})
            assert named["status"] == "point"
            step = {
                "lane": lane,
                "line": line,
                "key": key,
                "version": named["version"],
                "index": named["point"]["index"],
                "steps": int(read["seek"]),
            }
            stepped = service.read({**ask, "dataId": picture["dataId"], "generation": 1, "step": step})
            assert stepped["point"]["x"] == pytest.approx(onward, abs=1e-12)
            assert stepped["point"]["value"] == pytest.approx(value, rel=1e-9, abs=1e-12)
            return
        assert old["xs"], "the recorded read has no point"
        for x, value in zip(old["xs"], old["values"], strict=True):
            at = int(np.argmin(np.abs(xs - x)))
            assert xs[at] == pytest.approx(x, abs=1e-12)
            got = column["values"][at]
            if value is None or (isinstance(value, float) and not math.isfinite(value)):
                assert got is None
            else:
                assert got == pytest.approx(value, rel=1e-9, abs=1e-12), f"at {x}"
    except AssertionError as error:
        raise AssertionError(f"{case['id']}: {case['description']} {error} {FIX}") from error


# --- Recordings over time of other lengths -----------------------------------------------------------------------


def _series(key: str, count: int, level: float, start: float = 0.0, step: float = 0.01) -> Any:
    from figures.answers import Answer

    xs = start + step * np.arange(count)
    values = np.full(count, float(level))
    axis = f"series|line|time|linear|value||from|{start:.9g}|{step:.9g}"
    return Answer(
        key, key, xs, values, ("", 1.0, ""), axis, "value", "linear", (float(xs[0]), float(xs[-1])), 0, x_kind="time"
    )


def test_recordings_over_time_of_other_lengths_are_combined_over_the_part_they_all_have() -> None:
    """The old ``_aligned``: over time, a median and a Δ are taken over the common length (from the same start, at
    the same step); each recording's own line is drawn as long as it is."""
    answers = {"a": _series("a", 100, 1.0), "b": _series("b", 80, 3.0), "c": _series("c", 120, 2.0)}
    answers["d"] = _series("d", 60, 5.0)
    service = FigureService(_Source(answers), CombineOps())
    spec = _spec(["a", "b", "c"], "d")
    picture = service.draw(
        {"figureId": "f", "generation": 1, "requestNumber": 1, "width": 600, "height": 200, **{"spec": spec}}
    )
    assert picture["members"]["combined"]["n"] == 4
    rows = service.export({"spec": spec, "dataId": picture["dataId"]})
    columns = {item["line"]: item for item in rows["columns"]}
    # The median over the 80 points the three base recordings have; the Δ over the 60 the compared one has too.
    assert len(columns["base"]["xs"]) == 80 and set(columns["base"]["values"]) == {2.0}
    assert len(columns["delta1"]["xs"]) == 60 and set(columns["delta1"]["values"]) == {3.0}
    assert len(columns["compare"]["xs"]) == 60
    # Across: from the first to the last point of any line drawn; the Δ lane shows the same part as the lines it is
    # of (one width, the ticks under the last lane), empty past its last point.
    assert _lane(picture, "overlay")["range"]["x"] == pytest.approx([0.0, 0.79])
    assert _lane(picture, "delta")["range"]["x"] == _lane(picture, "overlay")["range"]["x"]
    assert max(_lane(picture, "delta")["lines"][0]["xs"]) == pytest.approx(0.59)


def test_a_recording_over_time_from_another_start_or_step_is_not_combined() -> None:
    answers = {"a": _series("a", 100, 1.0), "b": _series("b", 100, 3.0, step=0.02), "d": _series("d", 100, 5.0)}
    service = FigureService(_Source(answers), CombineOps())
    count = service.count({"spec": _spec(["a", "b"], "d")})
    assert count["members"]["combined"]["used"] == ["a", "d"]
    assert {"key": "b", "reason": "other-axis"} in count["members"]["combined"]["excluded"]


# --- A level over time: the reference it is on -------------------------------------------------------------------


def test_a_level_over_time_is_on_the_reference_its_recording_is_on() -> None:
    """Values already in dB (rms_trend(dB=True)) are levels re the channel they were made from: their answer's
    identity is that channel's (dB SPL re 20 µPa), as the recording's spectrum's is, never the dB channel's own
    (wandas names it "dB re 1 dB SPL re 2e-05 Pa", which says nothing). So a level over time is named, shown and
    combined by the reference the comparison knows the recording by (the spec's ``level``)."""
    import wandas as wd

    from frames import stage_view as sv
    from services.stage_combine import stage_data

    t = np.arange(16000) / 16000
    frame = wd.from_numpy(0.1 * np.sin(2 * np.pi * 440 * t)[np.newaxis], sampling_rate=16000, ch_units="Pa")
    identities = {}
    for name, made in {
        "spectrum": frame.welch(),
        "level over time": frame.rms_trend(dB=True),
        "level over time, cut": frame.a_weighting().rms_trend(dB=True).trim(0.1, 0.5),
    }.items():
        data = stage_data(made, dict(sv.stage_view(made)))  # type: ignore[arg-type]
        assert data is not None
        answer = answer_of(name, data)
        assert answer is not None
        identities[name] = answer.identity
    assert set(identities.values()) == {("Pa", 2e-05, "dB SPL re 20 µPa")}, identities
    assert answer.quantity == "level" and answer.x_kind == "time" and str(answer.unit).startswith("dB")


# --- Bands (1/N-octave levels): bars, every one, between their bands' edges ----------------------------------------


@pytest.mark.parametrize("width", [600, 20])
def test_bands_are_drawn_as_every_bar_between_its_bands_edges_at_any_width(width: int) -> None:
    """A line of bands is never thinned (計算ウ: a few tens of bars are drawn as they are): the picture sends every
    band whatever the frame's width, zoomed or not, with the edges its bars are drawn between (neighbouring bands
    meet at their geometric mean on the log axis, one more edge than bars). A line of any other kind sends none."""
    given = next(case for case in TABLE["combine"] if case["id"] == "bands_group")["input"]
    service, spec, _, _ = _drawn(given, given["base"], given["compare"])
    request = {"figureId": "f", "generation": 2, "requestNumber": 2, "width": width, "height": 200}
    for view in (None, {"x": [180.0, 700.0]}):
        picture = service.draw({**request, "spec": spec, "view": view})
        assert _lane(picture, "overlay")["axis"]["x"] == "band"
        for lane in ("overlay", "delta"):
            for line in _lane(picture, lane)["lines"]:
                assert line["xs"][0] == 50.0 and line["xs"][-1] == 2500.0 and len(line["xs"]) == 18, (lane, view)
                assert len(line["edges"]) == 19
                assert line["edges"][1] == pytest.approx(math.sqrt(50.0 * 63.0))
                assert all(
                    low < x < high
                    for low, x, high in zip(line["edges"][:-1], line["xs"], line["edges"][1:], strict=True)
                )
    other = next(case for case in TABLE["combine"] if case["id"] == "rms_group")["input"]
    _, _, _, lines = _drawn(other, other["base"], other["compare"])
    assert all("edges" not in line for line in _lane(lines, "overlay")["lines"])
