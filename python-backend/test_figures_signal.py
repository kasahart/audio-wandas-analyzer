"""The time signal on the NEW path (the figure service's band lane): the recorded cases of
tests/fixtures/figure_signal_cases.json (the old path's answers, test_figure_signal_cases.py) replayed against the
five calculations and the service, and the process's one budget with its reservation (figures/budget.py).

What is the same as the old path, case by case: the buckets (as np.array_split cuts them), each bucket's lowest and
highest sample (the first of equal ones; a sample with no value breaks the band), the whole picture's and a zoomed
part's band (each extreme at its own sample's time), every sample drawn as itself where there are fewer than two a
bucket, the sample's time (``start + n * (1 / rate)``), the amplitude axis's rounding, and the sample a pointer, an
arrow key and a name read (unrounded).

What is not, on purpose:

- ``view``: the old picture carried a band (min/max per bucket) and a thinned line beside it; the new one carries the
  band's samples only, in time order (the Figure draws them as one line), with the sample past each end of the range.
- ``read``: the old read sent the samples around the pointer (or, where they are dense, a few per pixel column) and
  the screen chose one; the new read answers the one sample, chosen of every sample there: never further from the
  pointer than the one the screen chose.
- ``read/region_peak``: a region's level is an answer (layer 1), not a read of the figure: not on the new path yet.
"""

from __future__ import annotations

import json
import math
import threading
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from figures import pick as pick_module
from figures import thinning
from figures.answers import SignalAnswer
from figures.budget import Budget
from figures.pick import NameAsk, PickLine, PickSignal, PointerAsk, StepAsk, pick, pick_sample
from figures.ranges import Ends, amplitude_range, band_range, sample_span
from figures.service import FigureService
from figures.thinning import BAND_BUCKETS_PER_PX, _bucket_edges, band_extremes, drawn_band
from frames import stage_view as sv
from services.stage_combine import STORE, StageData, stage_data
from test_figure_bench_cases import RECORDED_REL
from test_figure_signal_cases import scene_signal
from transport.command_dispatch import dispatch, validate_request
from transport.figure_answers import BUDGET, CombineOps, signal_answer_of
from transport.protocol_schema import result_violation

TABLE = json.loads((Path(__file__).parent / "tests" / "fixtures" / "figure_signal_cases.json").read_text("utf-8"))


def _cases(section: str) -> list[Any]:
    return [pytest.param(case, id=case["id"]) for case in TABLE[section]]


def _case(section: str, case_id: str) -> dict[str, Any]:
    return next(case for case in TABLE[section] if case["id"] == case_id)


def _data(scene: str = "tones") -> StageData:
    frame = scene_signal(TABLE["scenes"][scene])
    data = stage_data(frame, dict(sv.stage_view(frame)))
    assert data is not None
    return data


def _answer(key: str = "signal") -> SignalAnswer:
    answer = signal_answer_of(key, _data())
    assert answer is not None
    return answer


ANSWER = _answer()
SIGNAL = PickSignal("sound", ANSWER.start, ANSWER.rate, ANSWER.values)


def _points(drawn: thinning.Drawn) -> tuple[list[float], list[float | None]]:
    return drawn.wire_points()


# --- 計算ウ: the band ------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("case", _cases("buckets"))
def test_the_buckets_are_the_recorded_ones(case: dict[str, Any]) -> None:
    edges = _bucket_edges(int(case["input"]["samples"]), int(case["input"]["count"]))
    assert edges.tolist() == case["expected"]["edges"]


@pytest.mark.parametrize("case", _cases("extremes"))
def test_a_buckets_lowest_and_highest_sample_are_the_recorded_ones(case: dict[str, Any]) -> None:
    samples = np.array([float(value) for value in case["input"]["samples"]])
    lowest, highest = band_extremes(samples, int(case["input"]["points"]))
    assert lowest.tolist() == case["expected"]["lowest"]
    assert highest.tolist() == case["expected"]["highest"]


# (The recorded cases are of 1200 and 600 buckets: the widths that give them at BAND_BUCKETS_PER_PX buckets a pixel.)
@pytest.mark.parametrize(
    ("case_id", "width"), [("whole", 1200.0 / BAND_BUCKETS_PER_PX), ("zoomed", 600.0 / BAND_BUCKETS_PER_PX)]
)
def test_the_band_is_the_recorded_one_each_extreme_at_its_own_samples_time(case_id: str, width: float) -> None:
    case = _case("view", case_id)
    expected, every = case["expected"]["band"], int(case["input"]["every"])
    source = case["expected"]["xSource"]
    x_range = tuple(case["input"].get("detail", {}).get("x", (source["first"], source["last"])))
    first, after = sample_span(ANSWER.start, ANSWER.rate, len(ANSWER.values), x_range)
    part = ANSWER.values[first:after]
    lowest, highest = band_extremes(part, int(math.ceil(width * BAND_BUCKETS_PER_PX)))
    assert lowest.size == expected["buckets"]
    step = 1.0 / ANSWER.rate
    assert (ANSWER.start + (first + lowest[::every]) * step).tolist() == expected["minT"]
    assert (ANSWER.start + (first + highest[::every]) * step).tolist() == expected["maxT"]
    assert part[lowest[::every]].tolist() == pytest.approx(expected["min"], rel=RECORDED_REL, abs=1e-12)
    assert part[highest[::every]].tolist() == pytest.approx(expected["max"], rel=RECORDED_REL, abs=1e-12)
    # What is drawn is those samples, in time order, with the sample past each end of the range (none past the whole).
    xs, values = _points(drawn_band(ANSWER.start, ANSWER.rate, ANSWER.values, x_range, width))
    assert xs == sorted(xs) and len(set(xs)) == len(xs)
    assert set(expected["minT"]) | set(expected["maxT"]) <= set(xs)
    inside = [x for x in xs if x_range[0] <= x <= x_range[1]]
    assert len(inside) == np.union1d(lowest, highest).size <= 2 * expected["buckets"]
    assert len(xs) - len(inside) == (2 if case_id == "zoomed" else 0)
    assert max(v for v in values if v is not None) == case["expected"]["valueRange"]["max"]


def test_zoomed_to_fewer_samples_than_two_a_bucket_every_sample_is_drawn_as_itself() -> None:
    case = _case("view", "zoomed_to_samples")
    xs, values = _points(
        drawn_band(ANSWER.start, ANSWER.rate, ANSWER.values, tuple(case["input"]["detail"]["x"]), 1200)
    )
    # The 17 samples there (both ends in), and the one past each end (the line reaches the frame's edges).
    assert xs[1:-1] == case["expected"]["xs"] and values[1:-1] == case["expected"]["values"]
    assert (xs[0], xs[-1]) == (ANSWER.start + 7999 * (1 / 8000), ANSWER.start + 8017 * (1 / 8000))


def test_a_band_is_made_of_the_samples_where_they_lie_never_of_a_copy() -> None:
    # Of a signal that cannot be written to and is not laid out in one piece (every other sample of another): the
    # same extremes as of its copy, and the samples are untouched.
    source = np.round(np.sin(np.arange(20001) * 0.37), 3)
    source.setflags(write=False)
    apart = source[::2]
    lowest, highest = band_extremes(apart, 97)
    again_lowest, again_highest = band_extremes(apart.copy(), 97)
    assert lowest.tolist() == again_lowest.tolist() and highest.tolist() == again_highest.tolist()
    edges = _bucket_edges(apart.size, 97)
    for at in (0, 13, 96):
        bucket = apart[edges[at] : edges[at + 1]]
        assert lowest[at] == edges[at] + int(np.argmin(bucket)) and highest[at] == edges[at] + int(np.argmax(bucket))


def test_float32_samples_are_drawn_and_read_as_they_are() -> None:
    values = ANSWER.values.astype(np.float32)
    xs, drawn = _points(drawn_band(0.0, 8000.0, values, (0.0, 4.0), 900))
    assert max(v for v in drawn if v is not None) == float(values.max())
    got = pick_sample([PickSignal("s", 0.0, 8000.0, values)], NameAsk("s", 1.0), (0.0, 4.0), (-1.0, 1.0))
    assert got.point is not None and got.point.value == float(values[8000])


# --- 計算イ: the confirmed range -------------------------------------------------------------------------------------


@pytest.mark.parametrize("case", _cases("amplitude_range"))
def test_the_amplitude_axis_is_the_recorded_one(case: dict[str, Any]) -> None:
    low, high = amplitude_range(max(case["input"]["peaks"], default=0.0))
    assert (low, high) == (case["expected"]["min"], case["expected"]["max"])


def test_the_confirmed_range_is_the_signals_whole_length_and_the_largest_magnitude_of_every_sample() -> None:
    source = _case("view", "whole")["expected"]["xSource"]
    signals = [(ANSWER.start, ANSWER.rate, ANSWER.values)]
    nothing = Ends(None, None)
    whole = band_range(signals, nothing, nothing)
    assert whole.x == (source["first"], source["last"])
    # The click's 0.72: ± it with a little room, rounded outward (the recorded amplitude_0p72).
    assert whole.y == (-0.8, 0.8)
    # Scrolled to where the click is not on screen, the axis up stays the whole signal's (the old path's recorded
    # zoomed case keeps the whole valueRange too).
    quiet = band_range(signals, Ends(2.0, 3.0), nothing)
    assert quiet.x == (2.0, 3.0)
    assert quiet.y == whole.y, (
        "R16: a waveform's automatic range up is of every sample of the recording, never of the part on screen, so "
        f"scrolling or zooming the time does not move it (whole {whole.y}, scrolled to 2-3 s {quiet.y}). "
        "Fix figures/ranges.py whole_band / band_range."
    )
    # A specified end is used exactly; a second, quieter signal does not narrow the axis.
    both = band_range([*signals, (0.5, 4000.0, np.zeros(100))], Ends(None, 3.5), Ends(-0.5, None))
    assert both.x == (0.0, 3.5) and both.y == (-0.5, 0.8)
    assert band_range([], nothing, nothing) == band_range([(0.0, 8000.0, np.zeros(0))], nothing, nothing)


# --- 計算エ: the sample read -----------------------------------------------------------------------------------------

WHOLE = ((0.0, 4.0), (-1.0, 1.0))


def test_a_samples_time_and_value_are_the_recorded_ones() -> None:
    expected = _case("read", "sparse_window")["expected"]
    for x, value, step in zip(expected["xs"], expected["values"], expected["steps"], strict=True):
        got = pick_sample([SIGNAL], NameAsk("sound", x), *WHOLE)
        assert got.point is not None, x
        assert (got.point.x, got.point.value) == (x, value)
        assert got.point.x_step == pytest.approx(step, abs=1e-12)
    assert pick_sample([SIGNAL], NameAsk("sound", 1.00001), *WHOLE).status == "no-point"
    assert pick_sample([SIGNAL], NameAsk("other", 1.0), *WHOLE).status == "no-point"


def _nearest(case: dict[str, Any]) -> tuple[float, tuple[float, float]]:
    """Of the samples the old read sent, the one nearest the pointer on screen: its distance (px) and itself."""
    read, expected = case["input"]["read"], case["expected"]
    scale_x, scale_y = read["pixels"]
    best = (math.inf, (math.nan, math.nan))
    for x, value in zip(expected["xs"], expected["values"], strict=True):
        if not (read["x"][0] <= x <= read["x"][1]):
            continue
        away = math.hypot((x - read["at"]) * scale_x, (value - read["near"]) * scale_y)
        best = min(best, (away, (x, value)))
    return best


@pytest.mark.parametrize("case_id", ["pick_window_on_the_click", "dense_window_pointer"])
def test_a_pointer_reads_the_sample_nearest_it_on_screen_of_every_sample_there(
    case_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _case("read", case_id)
    read = case["input"]["read"]
    ask = PointerAsk(read["at"], read["near"], *read["pixels"])
    got = pick_sample([SIGNAL], ask, tuple(read["x"]), tuple(read["shown"]))
    assert got.point is not None and got.by == "near"
    away = math.hypot((got.point.x - ask.x) * ask.scale_x, (got.point.value - ask.y) * ask.scale_y)
    old_away, old_point = _nearest(case)
    if case_id == "pick_window_on_the_click":
        # The old read sent every sample of the pick window: the same sample.
        assert (got.point.x, got.point.value) == old_point
    # Where the old read sent a few samples per pixel column, the screen chose of those: the new read is of every
    # sample, so never further from the pointer.
    assert away <= old_away + 1e-9
    # Looked at in rings outward from the pointer: the same sample whatever the ring's size.
    for ring in (1, 7, 1 << 20):
        monkeypatch.setattr(pick_module, "_RING", ring)
        assert pick_sample([SIGNAL], ask, tuple(read["x"]), tuple(read["shown"])) == got
    assert got.point.value == float(ANSWER.values[got.point.index])
    assert got.point.x == ANSWER.start + got.point.index * (1.0 / ANSWER.rate)


def test_a_pointers_read_of_samples_is_the_read_of_a_line_of_the_same_points(monkeypatch: pytest.MonkeyPatch) -> None:
    # The one rule of every read (pick): a signal's samples read where they lie answer as the same points given as
    # a line with their times, wherever the pointer, at any zoom, with gaps, for two signals.
    monkeypatch.setattr(pick_module, "_RING", 16)
    rng = np.random.default_rng(7)
    first = np.round(rng.normal(scale=0.3, size=600), 2)
    first[rng.integers(0, 600, size=30)] = np.nan
    second = np.round(rng.normal(scale=0.3, size=250), 2)
    signals = [PickSignal("a", 0.25, 100.0, first), PickSignal("b", 1.0, 50.0, second)]
    lines = [
        PickLine(signal.id, signal.start + np.arange(len(signal.values)) * (1.0 / signal.rate), signal.values, False)
        for signal in signals
    ]
    for _ in range(400):
        scale_x = float(rng.choice([3.0, 40.0, 900.0, 5000.0]))
        ask = PointerAsk(float(rng.uniform(0.0, 7.0)), float(rng.uniform(-1.2, 1.2)), scale_x, 150.0)
        low = float(rng.uniform(0.0, 3.0))
        ranges = ((low, low + float(rng.uniform(0.5, 4.0))), (-0.8, 0.8))
        got, expected = pick_sample(signals, ask, *ranges), pick(lines, ask, *ranges, False)
        assert (got.status, got.by) == (expected.status, expected.by), (ask, ranges)
        if expected.point is not None and got.point is not None:
            assert (got.point.line, got.point.index, got.point.value) == (
                expected.point.line,
                expected.point.index,
                expected.point.value,
            ), (ask, ranges)


def test_with_no_sample_within_the_radius_the_one_under_the_pointer_is_read() -> None:
    # 1500 px per second at 1.0002 s, the pointer far above the click: the sample nearest across (1.00025 s).
    got = pick_sample([SIGNAL], PointerAsk(1.0002, 0.95, 1500.0, 2000.0), (0.98, 1.02), (-1.0, 1.0))
    assert got.point is not None and got.by == "under" and got.point.index == 8002
    # Past the signal's end there is nothing; a pointer of another lane's place reads nothing either.
    assert pick_sample([SIGNAL], PointerAsk(4.5, 0.0, 100.0, 200.0), (0.0, 5.0), (-1.0, 1.0)).status == "outside"


def test_an_arrow_key_steps_a_sample_at_a_time_inside_the_range() -> None:
    onward = _case("read", "arrow_key_onward")["expected"]
    got = pick_sample([SIGNAL], StepAsk("sound", 8000, 1), *WHOLE)
    assert got.point is not None and (got.point.x, got.point.value) == (onward["xs"][1], onward["values"][1])
    assert pick_sample([SIGNAL], StepAsk("sound", 0, -1), *WHOLE).status == "outside"
    assert pick_sample([SIGNAL], StepAsk("sound", 8000, 1), (0.0, 1.0), (-1.0, 1.0)).status == "outside"
    back = pick_sample([SIGNAL], StepAsk("sound", 8000, -3), *WHOLE)
    assert back.point is not None and back.point.index == 7997


def test_a_sample_with_no_value_is_stepped_over_and_never_read() -> None:
    values = np.array([0.1, np.nan, 0.3, 0.2])
    signal = PickSignal("s", 0.0, 10.0, values)
    ranges = ((0.0, 0.3), (-1.0, 1.0))
    got = pick_sample([signal], StepAsk("s", 0, 1), *ranges)
    assert got.point is not None and got.point.index == 2
    assert pick_sample([signal], NameAsk("s", 0.1), *ranges).status == "no-point"


def test_of_two_signals_the_nearest_sample_on_screen_is_read_a_tie_to_the_one_declared_first() -> None:
    quiet = PickSignal("quiet", ANSWER.start, ANSWER.rate, ANSWER.values * 0.5)
    ask = PointerAsk(1.0002, 0.36, 1500.0, 200.0)
    got = pick_sample([SIGNAL, quiet], ask, (0.98, 1.02), (-1.0, 1.0))
    assert got.point is not None and got.point.line == "quiet" and got.point.value == 0.36
    same = pick_sample(
        [SIGNAL, PickSignal("twin", ANSWER.start, ANSWER.rate, ANSWER.values)], ask, (0.98, 1.02), (-1, 1)
    )
    assert same.point is not None and same.point.line == "sound"


# --- Through the protocol: draw, read and count of a band lane -------------------------------------------------------


def _ask(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = validate_request({"cmd": command, "requestId": "r", **payload})
    result = dict(dispatch(request, None))  # type: ignore[arg-type]
    assert result_violation(command, result) is None, (command, result_violation(command, result))
    return result


def _spec(*keys: str) -> dict[str, Any]:
    roles = ["compare1", "base", "base"]
    lines = [{"id": f"line-{key}", "role": roles[at], "of": {"key": key}} for at, key in enumerate(keys)]
    return {
        "lanes": [{"id": "sound", "kind": "band", "lines": lines}],
        "keys": [{"key": key, "state": "usable", "version": key} for key in keys],
    }


def _draw(spec: dict[str, Any], figure: str, view: dict[str, Any] | None = None, generation: int = 0) -> dict[str, Any]:
    return _ask(
        "figure-draw",
        {
            "figureId": figure,
            "generation": generation,
            "requestNumber": generation,
            "spec": spec,
            "width": 1200,
            "height": 300,
            "view": view,
            "selection": None,
        },
    )


def _read(figure: str, picture: dict[str, Any], number: int, **ask: Any) -> dict[str, Any]:
    return _ask(
        "figure-read",
        {"figureId": figure, "pictureId": picture["pictureId"], "requestNumber": number, **ask},
    )


def test_a_band_lane_is_drawn_read_and_counted_through_the_protocol() -> None:
    STORE.put("sig-1", _data())
    spec = _spec("sig-1")
    picture = _draw(spec, "sig-fig")
    assert picture["status"] == "picture"
    (lane,) = picture["lanes"]
    assert lane["kind"] == "band"
    assert lane["axis"] == {
        "quantity": "value",
        "unit": "",
        "reference": 1.0,
        "referenceLabel": lane["axis"]["referenceLabel"],
        "calibration": "unknown",
        "xScale": "linear",
        "yScale": "linear",
    }
    assert lane["range"] == lane["whole"] == {"x": [0.0, 3.9998750000000003], "y": [-0.8, 0.8]}
    (line,) = lane["lines"]
    assert (line["id"], line["key"], line["role"]) == ("line-sig-1", "sig-1", "compare1")
    # 2400 buckets at 1200 px (BAND_BUCKETS_PER_PX a pixel): at most two samples each, and the click is among them.
    buckets = 1200 * BAND_BUCKETS_PER_PX
    assert buckets <= len(line["xs"]) <= 2 * buckets + 2 and max(line["values"]) == 0.72
    assert picture["members"]["shown"]["n"] == 1

    read = _read("sig-fig", picture, 1, pointer={"lane": "sound", "x": 1.0002, "y": 0.7, "scale": [300, 180]})
    assert read["status"] == "point" and read["line"] == "line-sig-1" and read["role"] == "compare1"
    point = read["point"]
    assert point["key"] == "sig-1" and point["value"] == 0.72 and point["xStep"] == pytest.approx(1 / 8000)
    assert point["x"] == ANSWER.start + point["index"] * (1 / 8000)

    step = {"lane": "sound", "line": "line-sig-1", "key": "sig-1", "version": read["version"], "index": point["index"]}
    moved = _read("sig-fig", picture, 2, dataId=picture["dataId"], generation=0, step={**step, "steps": -1})
    assert moved["point"]["index"] == point["index"] - 1
    assert moved["point"]["value"] == float(ANSWER.values[point["index"] - 1])
    stale = _read("sig-fig", picture, 3, dataId="another", generation=0, step={**step, "steps": 1})
    assert stale["status"] == "no-point"

    # Zoomed: every sample there is drawn as itself; the value axis stays the whole signal's (R16); the selected sample
    # is named again after the redraw; the whole range is the picture's own.
    view = {"x": [2.0, 2.01], "lanes": [{"lane": "sound", "y": [None, None]}]}
    zoomed = _draw(spec, "sig-fig", view, generation=1)
    (lane,) = zoomed["lanes"]
    assert lane["range"]["x"] == [2.0, 2.01] and lane["whole"]["x"] == [0.0, 3.9998750000000003]
    assert lane["range"]["y"] == lane["whole"]["y"] == [-0.8, 0.8], "R16: zoomed, the range up is the whole signal's"
    assert len(lane["lines"][0]["xs"]) == 81 + 2
    assert _read("sig-fig", picture, 4, pointer={"lane": "sound", "x": 2.0, "y": 0, "scale": [1, 1]})["status"] == (
        "no-picture"
    )
    again = _read("sig-fig", zoomed, 5, name={"line": "line-sig-1", "key": "sig-1", "x": 2.005})
    assert again["point"]["value"] == float(ANSWER.values[16040])
    gone = _read("sig-fig", zoomed, 6, name={"line": "line-sig-1", "key": "sig-1", "x": 1.0})
    assert gone["status"] == "no-point"

    assert _ask("figure-count", {"spec": spec})["members"]["shown"]["n"] == 1
    _ask("figure-release", {"figureId": "sig-fig"})


def test_a_figure_holds_no_sample_of_a_signal_and_its_read_says_no_picture_once_the_answer_is_gone() -> None:
    STORE.put("sig-2", _data())
    picture = _draw(_spec("sig-2"), "sig-fig-2")
    assert picture["status"] == "picture"
    from transport.figure_answers import FIGURES

    assert FIGURES._holdings["sig-fig-2"].nbytes == 0  # noqa: SLF001
    assert STORE.make_room(1 << 40, frozenset()) > 0
    read = _read("sig-fig-2", picture, 1, pointer={"lane": "sound", "x": 1.0, "y": 0.0, "scale": [300, 180]})
    assert read["status"] == "no-picture"
    # The redraw says why nothing is drawn: the recording's answer is no longer kept.
    again = _draw(_spec("sig-2"), "sig-fig-2", generation=1)
    assert again["members"]["shown"]["excluded"] == [{"key": "sig-2", "reason": "evicted"}]
    assert "range" not in again["lanes"][0]
    _ask("figure-release", {"figureId": "sig-fig-2"})


def test_each_recordings_signal_is_its_own_line_and_one_of_another_unit_is_left_out_with_why() -> None:
    data = _data()
    STORE.put("sig-a", data)
    STORE.put("sig-b", data)
    spec = _spec("sig-a", "sig-b", "sig-c")
    spec["keys"][2]["level"] = {"unit": "Pa", "ref": 2e-5, "label": "20 µPa"}
    spec["keys"][2]["state"] = "pending"
    picture = _draw(spec, "sig-fig-3")
    (lane,) = picture["lanes"]
    assert [line["id"] for line in lane["lines"]] == ["line-sig-a", "line-sig-b"]
    assert [line["role"] for line in lane["lines"]] == ["compare1", "base"]
    assert picture["members"]["shown"]["excluded"] == [{"key": "sig-c", "reason": "other-reference"}]
    _ask("figure-release", {"figureId": "sig-fig-3"})


def test_a_band_lane_of_a_median_is_refused() -> None:
    # (Of recordings' sounds: a median of a trigger's events' means is drawn, test_figures_events.py. The refusal is
    # made once the answers are looked at, so the sound is kept here.)
    STORE.put("sig-1", _data())
    spec = _spec("sig-1")
    spec["lanes"][0]["lines"] = [{"id": "m", "role": "base", "of": {"median": ["sig-1"]}}]
    with pytest.raises(Exception, match="recordings' own signals"):
        _draw(spec, "x")


# --- A time signal's Δ: compare − base, sample by sample --------------------------------------------


def _delta_spec(compare: str, base: str) -> dict[str, Any]:
    spec = _spec(compare, base)
    spec["lanes"].append(
        {
            "id": "delta",
            "kind": "band",
            "lines": [{"id": "delta", "role": "delta", "of": {"delta": {"compare": compare, "base": [base]}}}],
        }
    )
    return spec


def _other(data: StageData, **changed: Any) -> StageData:
    from dataclasses import replace

    return replace(data, **changed)


def test_a_signals_delta_is_compare_minus_base_sample_by_sample_over_the_samples_both_have() -> None:
    """The Δ lane of two time signals (the old combine's ``compare.values - base.values``): of every sample both
    have, in the samples' own type; headed by its largest sample; read unrounded; held by the Figure and counted."""
    base = _data()
    # The compared recording: quieter, with one sample pushed far off, and 100 samples shorter.
    values = (np.asarray(base.values) * 0.5)[:-100].copy()
    at = values.size // 3
    values[at] += 0.75
    compare = _other(base, values=values)
    STORE.put("delta-compare", compare)
    STORE.put("delta-base", base)
    expected = values - np.asarray(base.values)[: values.size]
    assert CombineOps().signal_difference(values, base.values).dtype == expected.dtype
    picture = _draw(_delta_spec("delta-compare", "delta-base"), "delta-fig")
    assert picture["status"] == "picture"
    sound, delta = picture["lanes"]
    assert [lane["kind"] for lane in (sound, delta)] == ["band", "band"]
    assert delta["axis"]["quantity"] == "delta" and delta["axis"]["unit"] == sound["axis"]["unit"]
    (line,) = delta["lines"]
    assert line["id"] == "delta" and line["role"] == "delta" and "key" not in line
    # Every drawn point is a sample of the Δ itself, at its own time.
    step = 1.0 / compare.rate
    for x, value in zip(line["xs"], line["values"], strict=True):
        index = round((x - compare.start) / step)
        assert value == float(expected[index])
    # Its range: across, the same part as the sounds above it (one width, the ticks under the last lane: the Δ ends
    # with the shorter recording and is empty past it); up, ± its largest magnitude with a little room.
    assert delta["range"]["x"] == sound["range"]["x"]
    assert max(line["xs"]) <= compare.start + (values.size - 1) * step < sound["range"]["x"][1]
    assert delta["range"]["y"] == list(amplitude_range(float(np.abs(expected).max())))
    # The headline: the largest |Δ| of every sample (never of the drawn ones).
    (headline,) = picture["headlines"]
    largest = int(np.argmax(np.abs(expected)))
    assert headline["lane"] == "delta" and headline["line"] == "delta"
    assert headline["index"] == largest == at
    assert headline["value"] == float(expected[largest])
    assert headline["x"] == compare.start + largest * step
    # A read of the Δ lane is the Δ's own sample, unrounded.
    read = _read("delta-fig", picture, 1, pointer={"lane": "delta", "x": headline["x"], "y": 0.0, "scale": [300, 180]})
    assert read["status"] == "point", read
    assert read["line"] == "delta" and "key" not in read["point"]
    assert read["point"]["value"] == float(expected[read["point"]["index"]])
    # The Figure holds the Δ (a combined answer), and nothing of the recordings' own samples.
    from transport.figure_answers import FIGURES

    assert FIGURES._holdings["delta-fig"].nbytes == expected.nbytes  # noqa: SLF001
    _ask("figure-release", {"figureId": "delta-fig"})


@pytest.mark.parametrize(
    ("changed", "drawn"),
    [
        pytest.param({"rate": 16000.0}, False, id="another-rate"),
        pytest.param({"start": 0.01}, False, id="a-start-further-than-half-a-sample"),
        pytest.param({"start": 1e-6}, True, id="a-start-within-half-a-sample"),
    ],
)
def test_a_signals_delta_is_taken_only_of_recordings_sample_for_sample(changed: dict[str, Any], drawn: bool) -> None:
    """No Δ of signals at another sample rate, or whose samples are not at the same times (starts further apart than
    half a sample; the old ``_aligned``): both are drawn, the Δ is not, and the base is counted on another axis."""
    base = _data()
    assert base.start == 0.0
    # A key's answer never changes: each case has its own keys.
    case = "-".join(f"{name}-{value}" for name, value in changed.items())
    compare_key, base_key, figure = f"apart-compare-{case}", f"apart-base-{case}", f"apart-fig-{case}"
    STORE.put(compare_key, base)
    STORE.put(base_key, _other(base, **changed))
    picture = _draw(_delta_spec(compare_key, base_key), figure)
    sound, delta = picture["lanes"]
    assert [line["id"] for line in sound["lines"]] == [f"line-{compare_key}", f"line-{base_key}"]
    assert bool(delta["lines"]) is drawn
    apart = [item for item in picture["members"]["combined"]["excluded"] if item["key"] == base_key]
    assert apart == ([] if drawn else [{"key": base_key, "reason": "other-axis"}])
    _ask("figure-release", {"figureId": figure})


def test_a_signals_delta_headline_is_its_highest_sample_at_a_tie_with_its_lowest() -> None:
    """Of the highest and the lowest sample on screen (the first of each), the one of the larger magnitude, the
    highest at a tie (the old difference_peak for a signal); only the samples inside the range are looked at."""
    from figures.headline import signal_peak

    values = np.array([0.0, -0.5, 0.5, 0.5, -0.9, np.nan])
    peak = signal_peak("d", 10.0, 2.0, values, (10.0, 11.5))
    assert peak is not None and (peak.index, peak.x, peak.x_step, peak.value) == (2, 11.0, 0.5, 0.5)
    whole = signal_peak("d", 10.0, 2.0, values, (0.0, 100.0))
    assert whole is not None and (whole.index, whole.value) == (4, -0.9)
    assert signal_peak("d", 10.0, 2.0, values, (12.5, 12.5)) is None
    assert signal_peak("d", 10.0, 2.0, values, (50.0, 60.0)) is None


def test_a_signals_delta_against_more_than_one_recording_is_refused() -> None:
    spec = _delta_spec("sig-1", "sig-0")
    spec["lanes"][1]["lines"][0]["of"]["delta"]["base"] = ["sig-1", "sig-2"]
    spec["keys"].append({"key": "sig-2", "state": "usable", "version": "sig-2"})
    with pytest.raises(Exception, match="the Δ of two"):
        _draw(spec, "x")


def test_a_recording_declared_too_large_is_left_out_with_that_reason() -> None:
    """A step whose values are over what the answer store keeps is declared ``too-large`` (the scan said so): the
    service draws the others and counts it left out with that reason (the budget is a
    cap: what does not fit is refused with its reason)."""
    STORE.put("fits", _data())
    spec = _spec("fits", "huge")
    spec["keys"][1] = {"key": "huge", "state": "too-large", "version": "0"}
    picture = _draw(spec, "too-large-fig")
    (lane,) = picture["lanes"]
    assert [line["id"] for line in lane["lines"]] == ["line-fits"]
    assert picture["members"]["shown"]["excluded"] == [{"key": "huge", "reason": "too-large"}]
    _ask("figure-release", {"figureId": "too-large-fig"})


# --- The process's one budget and its reservation --------------------------------------------------------------------


def test_a_reservation_is_refused_too_large_alone_and_busy_beside_another_and_fits_once_that_ends() -> None:
    budget = Budget(100)
    nobody: frozenset[str] = frozenset()
    assert budget.reserve(101, 0, nobody) == "too-large"
    assert budget.reserve(60, 0, nobody) == "ok"
    assert budget.reserve(60, 0, nobody) == "busy"
    budget.release(60)
    assert budget.reserve(60, 0, nobody) == "ok"
    budget.release(60)
    # With nothing else running, what does not fit beside the Figures' holdings will not fit later either.
    assert budget.reserve(60, 50, nobody) == "too-large"
    assert budget.reserved() == 0


def test_room_is_made_of_the_answers_no_figure_uses_never_of_one_in_use() -> None:
    kept = {"old": 40, "shown": 40}

    def make_room(nbytes: int, in_use: frozenset[str]) -> int:
        freed = 0
        for key in [key for key in kept if key not in in_use]:
            if freed < nbytes:
                freed += kept.pop(key)
        return freed

    budget = Budget(100, lambda: sum(kept.values()), make_room)
    assert budget.reserve(50, 0, frozenset({"shown"})) == "ok"
    assert kept == {"shown": 40}
    budget.release(50)
    assert budget.reserve(70, 0, frozenset({"shown"})) == "too-large"
    assert kept == {"shown": 40}


def test_the_stores_room_is_made_least_recently_used_first() -> None:
    STORE.clear()
    data = _data()
    for key in ("r1", "r2", "r3"):
        STORE.put(key, data)
    assert STORE.nbytes() == 3 * data.nbytes
    assert STORE.get("r1") is not None
    assert STORE.make_room(1, frozenset({"r2"})) == data.nbytes
    assert STORE.has("r1") and STORE.has("r2") and not STORE.has("r3")
    assert BUDGET.limit > STORE.budget and BUDGET.kept() == 2 * data.nbytes
    STORE.clear()


class _Source:
    def __init__(self, answers: dict[str, SignalAnswer]) -> None:
        self.answers = answers

    def answer(self, key: str) -> SignalAnswer | None:
        return self.answers.get(key)


def _request(figure: str, key: str) -> dict[str, Any]:
    return {"figureId": figure, "generation": 0, "requestNumber": 0, "spec": _spec(key), "width": 600, "height": 200}


def test_a_draw_reserves_its_estimate_and_another_beside_it_is_busy_until_it_ends(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    answer = _answer("a")
    work = thinning.BAND_WORK_BYTES
    budget = Budget(work + work // 2)
    service = FigureService(_Source({"a": answer}), CombineOps(), budget)
    inside, go = threading.Event(), threading.Event()
    real = FigureService._draw  # noqa: SLF001

    def slow(self: FigureService, *args: Any) -> dict[str, Any]:
        inside.set()
        assert go.wait(10)
        return real(self, *args)

    monkeypatch.setattr(FigureService, "_draw", slow)
    results: list[dict[str, Any]] = []
    first = threading.Thread(target=lambda: results.append(service.draw(_request("one", "a"))))
    first.start()
    assert inside.wait(10)
    assert budget.reserved() == work
    monkeypatch.setattr(FigureService, "_draw", real)
    assert service.draw(_request("two", "a"))["status"] == "busy"
    go.set()
    first.join(10)
    assert results[0]["status"] == "picture" and budget.reserved() == 0
    assert service.draw(_request("two", "a"))["status"] == "picture"
    # Over the budget alone: refused before anything is computed, and nothing stays reserved.
    small = FigureService(_Source({"a": answer}), CombineOps(), work - 1)
    assert small.draw(_request("three", "a"))["status"] == "too-large"


def test_a_picture_drawn_ahead_holds_the_points_past_each_end_and_reads_only_the_range_itself() -> None:
    """``ahead``: a time lane is drawn that much of the range's length past each end, so a range moved across has
    its picture at once. The confirmed ranges, and so every read, are the same with it and without it."""
    STORE.put("sig-ahead", _data())
    spec = _spec("sig-ahead")
    view = {"x": [2.0, 2.01], "lanes": [{"lane": "sound", "y": [None, None]}]}

    def draw(generation: int, **more: Any) -> dict[str, Any]:
        return _ask(
            "figure-draw",
            {
                "figureId": "sig-ahead-fig",
                "generation": generation,
                "requestNumber": generation,
                "spec": spec,
                "width": 1200,
                "height": 300,
                "view": view,
                "selection": None,
                **more,
            },
        )

    plain = draw(0)
    ahead = draw(1, ahead=0.5)
    (lane,) = ahead["lanes"]
    assert lane["range"] == plain["lanes"][0]["range"] and lane["whole"] == plain["lanes"][0]["whole"]
    assert ahead["dataId"] == plain["dataId"] and ahead["pictureId"] != plain["pictureId"]
    xs = lane["lines"][0]["xs"]
    # 0.005 s more at each end: 40 samples each side of the 81 on screen, and the one outside each end.
    assert len(xs) == 81 + 2 * 40 + 2
    assert xs[1] == pytest.approx(1.995) and xs[-2] == pytest.approx(2.015)
    # A sample drawn ahead is not on screen: it is not read.
    outside = _read("sig-ahead-fig", ahead, 2, name={"line": "line-sig-ahead", "key": "sig-ahead", "x": 1.997})
    assert outside["status"] == "no-point"
    inside = _read("sig-ahead-fig", ahead, 3, name={"line": "line-sig-ahead", "key": "sig-ahead", "x": 2.005})
    assert inside["point"]["value"] == float(ANSWER.values[16040])
    # Never more than the service's most, and a number from 0.
    most = draw(4, ahead=50)
    assert len(most["lanes"][0]["lines"][0]["xs"]) == 81 + 2 * 80 + 2
    with pytest.raises(Exception, match="ahead"):
        draw(5, ahead=-1)
    _ask("figure-release", {"figureId": "sig-ahead-fig"})
