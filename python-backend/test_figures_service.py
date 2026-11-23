"""The figure service (figures/service.py) on known answers: the picture, the read values, the confirmed range, the
counts, the holdings and the ids (docs/figure-design.md 第 5, 6, 9 節). The answers are synthetic
(``Answer`` arrays whose median and Δ are known by hand); the last tests go through the real path: wandas spectra kept
in stage_combine.STORE, the transport adapter and command_dispatch, each reply checked against protocol_schema.py.
"""

from __future__ import annotations

import itertools
from typing import Any

import numpy as np
import pytest
import wandas as wd

from conftest import assert_not_drawn
from figures.answers import Answer
from figures.members import members
from figures.service import FigureRequestError, FigureService
from figures.spec import parse_spec
from frames.stage_view import stage_view
from services.stage_combine import STORE, stage_data
from transport.command_dispatch import dispatch, validate_request
from transport.figure_answers import CombineOps, StoreAnswers
from transport.protocol_schema import result_violation

FS: tuple[str, float, str] = ("FS", 1.0, "dBFS")
SPL: tuple[str, float, str] = ("Pa", 2e-5, "dB SPL re 20 µPa")
XS = np.linspace(0.0, 8000.0, 1025)  # 0 Hz to Nyquist (16 kHz), 7.8125 Hz apart
PEAK = 400  # 3125 Hz


def _answer(key: str, values: np.ndarray, identity: tuple[str, float, str] = FS, axis: str = "ax", xs=XS) -> Answer:
    values = np.asarray(values, dtype=np.float64)
    return Answer(key, f"v-{key}", xs, values, identity, axis, "level", "log", (20.0, 8000.0), values.nbytes * 2)


def _flat(level: float) -> np.ndarray:
    return np.full(XS.size, float(level))


class Source:
    """An AnswerSource of fixed answers; ``during`` runs on every lookup (a release arriving mid-draw)."""

    def __init__(self, answers: dict[str, Answer]) -> None:
        self.answers = answers
        self.during: Any = None

    def answer(self, key: str) -> Answer | None:
        if self.during is not None:
            self.during()
        return self.answers.get(key)


def _spec(base: list[str], compares: list[str], states: dict[str, str] | None = None, **extra: Any) -> dict[str, Any]:
    """The comparison overlay's spec (仕様 1: the median, then compare 1, 2, ...) and its Δ lane."""
    states = states or {}
    lines = [{"id": "base", "of": {"median": base}, "role": "base"}]
    lines += [{"id": f"{key}.wav", "of": {"key": key}, "role": f"compare{at + 1}"} for at, key in enumerate(compares)]
    keys = [*dict.fromkeys([*base, *compares])]
    return {
        "lanes": [
            {"id": "overlay", "kind": "lines", "lines": lines},
            {
                "id": "delta",
                "kind": "lines",
                "lines": [{"id": "delta1", "of": {"delta": {"compare": compares[0], "base": base}}}],
            },
        ],
        "keys": [
            {"key": key, "state": states.get(key, "usable"), "version": f"v-{key}", **extra.get(key, {})}
            for key in keys
        ],
    }


def _draw(service: FigureService, spec: dict[str, Any], figure: str = "f", generation: int = 1, **more: Any) -> dict:
    return service.draw(
        {
            "figureId": figure,
            "generation": generation,
            "requestNumber": generation,
            "spec": spec,
            "width": 600,
            "height": 200,
            **more,
        }
    )


def _line(picture: dict, lane: str, line: str) -> dict | None:
    found = next(item for item in picture["lanes"] if item["id"] == lane)
    return next((item for item in found["lines"] if item["id"] == line), None)


def _known() -> dict[str, Answer]:
    """Three base recordings flat at −40, −50, −45 dB (median −45) and a compared one flat at −30 dB with a peak
    of −10 dB at 3125 Hz: Δ = 15 dB everywhere but 35 dB there."""
    compare = _flat(-30.0)
    compare[PEAK] = -10.0
    return {
        "a": _answer("a", _flat(-40)),
        "b": _answer("b", _flat(-50)),
        "c": _answer("c", _flat(-45)),
        "d": _answer("d", compare),
    }


# --- The picture of known answers --------------------------------------------------------------------------------


def test_a_known_overlay_draws_the_median_compare_and_delta_with_its_range_headline_and_counts() -> None:
    service = FigureService(Source(_known()), CombineOps())
    picture = _draw(service, _spec(["a", "b", "c"], ["d"]))
    assert picture["status"] == "picture"
    assert (picture["figureId"], picture["generation"], picture["requestNumber"]) == ("f", 1, 1)
    overlay = next(lane for lane in picture["lanes"] if lane["id"] == "overlay")
    # Only the median and the compared line, in declared order (仕様 1).
    assert [line["id"] for line in overlay["lines"]] == ["base", "d.wav"]
    base, delta = _line(picture, "overlay", "base"), _line(picture, "delta", "delta1")
    assert base is not None and delta is not None
    assert set(base["values"]) == {-45.0}
    assert max(delta["values"]) == 35.0 and min(delta["values"]) == 15.0
    # Drawn across 20 Hz to Nyquist, thinned (one bucket per two px); past it only the nearest answer point outside
    # each end, so the line reaches the frame's edges (class 3: the old overlay drew it to the edge too).
    outside = [x for x in base["xs"] if not 20.0 <= x <= 8000.0]
    assert outside == [float(XS[XS < 20.0][-1])] + ([float(XS[XS > 8000.0][0])] if (XS > 8000.0).any() else [])
    assert len(base["xs"]) < XS.size
    # 計算イ: −45…−10 dB rounded out to 10 dB steps (5 dB would be 7 > 6 steps: figures/ranges.py); the Δ ±35 to
    # ±40 (stageDiffRange).
    assert overlay["range"] == {"x": [20.0, 8000.0], "y": [-50.0, -10.0]}
    assert next(lane for lane in picture["lanes"] if lane["id"] == "delta")["range"]["y"] == [-40.0, 40.0]
    # 計算オ: the Δ's largest magnitude, unrounded, with its step of the data.
    assert picture["headlines"] == [
        {"lane": "delta", "line": "delta1", "index": PEAK, "x": XS[PEAK], "xStep": 7.8125, "value": 35.0}
    ]
    # 計算ア: four shown, four combined, n = 3 for the median.
    members = picture["members"]
    assert members["shown"]["n"] == 4 and members["combined"]["n"] == 4
    lines = {line["line"]: line for line in members["lines"]}
    assert lines["base"]["used"] == ["a", "b", "c"] and lines["delta1"]["used"] == ["d", "a", "b", "c"]


def test_a_read_reads_the_answer_at_the_point_never_the_drawn_points_and_names_it() -> None:
    service = FigureService(Source(_known()), CombineOps())
    picture = _draw(service, _spec(["a", "b", "c"], ["d"]))
    scale = (600 / np.log(8000 / 20), 200 / 35)
    ask = {"figureId": "f", "pictureId": picture["pictureId"], "requestNumber": 7}
    # 2 px left of the peak, 3 px under its top: within 20 px, the peak.
    x = XS[PEAK] * np.exp(-2 / scale[0])
    got = service.read({**ask, "pointer": {"lane": "overlay", "x": x, "y": -10.0 - 3 / scale[1], "scale": list(scale)}})
    assert got["status"] == "point" and got["requestNumber"] == 7
    assert (got["line"], got["role"], got["point"]["index"], got["point"]["value"]) == (
        "d.wav",
        "compare1",
        PEAK,
        -10.0,
    )
    assert got["point"]["key"] == "d" and got["point"]["xStep"] == 7.8125
    # The one point read, with its line's answer version (a step names it); no list of its neighbours.
    assert "before" not in got and "after" not in got and isinstance(got["version"], str)
    # The Δ lane reads the Δ, plain (no silent floor).
    got = service.read({**ask, "pointer": {"lane": "delta", "x": XS[100], "y": 15.0, "scale": [scale[0], 2.5]}})
    assert (got["line"], got["point"]["index"], got["point"]["value"]) == ("delta1", 100, 15.0)
    # (c): by its name only; (b): on from it.
    named = service.read({**ask, "name": {"lane": "overlay", "line": "base", "x": XS[300]}})
    assert (named["point"]["index"], named["point"]["value"]) == (300, -45.0)
    assert (
        service.read({**ask, "name": {"lane": "overlay", "line": "base", "x": XS[300] + 0.1}})["status"] == "no-point"
    )
    held = {"dataId": picture["dataId"], "generation": picture["generation"]}
    step = {"lane": "overlay", "line": "base", "version": named["version"], "index": 300, "steps": -1}
    stepped = service.read({**ask, **held, "step": step})
    assert stepped["point"]["index"] == 299


def test_the_specified_ends_are_used_exactly_and_the_unspecified_one_by_the_rule() -> None:
    service = FigureService(Source(_known()), CombineOps())
    view = {
        "x": [123.456, None],
        "lanes": [{"lane": "overlay", "y": [-61.37, -12.5]}, {"lane": "delta", "y": [None, 17.25]}],
    }
    picture = _draw(service, _spec(["a", "b", "c"], ["d"]), view=view)
    ranges = {lane["id"]: lane["range"] for lane in picture["lanes"]}
    assert ranges["overlay"] == {"x": [123.456, 8000.0], "y": [-61.37, -12.5]}
    assert ranges["delta"] == {"x": [123.456, 8000.0], "y": [-40.0, 17.25]}
    # A level axis with its top specified only: the bottom at most 100 dB under it (figureModel.levelLineRange).
    top = _draw(service, _spec(["a", "b", "c"], ["d"]), view={"lanes": [{"lane": "overlay", "y": [None, 0.0]}]})
    assert next(lane for lane in top["lanes"] if lane["id"] == "overlay")["range"]["y"] == [-50.0, 0.0]


@pytest.mark.parametrize("order", list(itertools.permutations(["a", "b", "c", "e"])))
def test_the_median_and_delta_do_not_depend_on_the_order_of_the_base(order: tuple[str, ...]) -> None:
    rng = np.random.default_rng(3)
    answers = {key: _answer(key, -50 + 10 * rng.standard_normal(XS.size)) for key in "abce"}
    answers["d"] = _answer("d", _flat(-30))
    service = FigureService(Source(answers), CombineOps())
    picture = _draw(service, _spec(list(order), ["d"]))
    stacked = np.stack([answers[key].values for key in "abce"])
    expected = (np.sort(stacked, axis=0)[1] + np.sort(stacked, axis=0)[2]) / 2  # even count: the middle two's mean
    exported = service.export({"spec": _spec(list(order), ["d"]), "dataId": picture["dataId"]})
    columns = {column["line"]: column for column in exported["columns"]}
    np.testing.assert_array_equal(np.asarray(columns["base"]["values"]), expected)
    np.testing.assert_array_equal(np.asarray(columns["delta1"]["values"]), -30 - expected)
    assert picture["headlines"][0]["value"] == pytest.approx(
        float((-30 - expected)[XS >= 20][np.argmax(np.abs(-30 - expected)[XS >= 20])])
    )


def test_a_base_of_one_is_its_own_values_and_a_missing_value_leaves_the_median_without_one() -> None:
    hole = _flat(-40)
    hole[200] = np.nan
    answers = {
        "a": _answer("a", hole),
        "b": _answer("b", _flat(-50)),
        "c": _answer("c", _flat(-60)),
        "d": _answer("d", _flat(-30)),
    }
    service = FigureService(Source(answers), CombineOps())
    one = service.export({"spec": _spec(["b"], ["d"]), "dataId": _draw(service, _spec(["b"], ["d"]))["dataId"]})
    assert {column["line"]: column for column in one["columns"]}["base"]["values"] == [-50.0] * XS.size
    three = service.export(
        {"spec": _spec(["a", "b", "c"], ["d"]), "dataId": _draw(service, _spec(["a", "b", "c"], ["d"]))["dataId"]}
    )
    values = {column["line"]: column for column in three["columns"]}["base"]["values"]
    assert values[200] is None and values[199] == -50.0


# --- 計算ア: what is shown and counted -----------------------------------------------------------------------------


def test_a_recording_of_another_reference_is_not_drawn_nor_in_the_median_and_is_counted_with_why() -> None:
    answers = _known()
    answers["s"] = _answer("s", _flat(60), identity=SPL)  # calibrated in Pa: another reference
    answers["t"] = _answer("t", _flat(55), identity=SPL)
    service = FigureService(Source(answers), CombineOps())
    picture = _draw(service, _spec(["a", "s", "b", "c"], ["d", "t"]))
    # 仕様 2: the median of the matching ones (the old path made none), compare 2 not drawn, no second axis.
    assert set(_line(picture, "overlay", "base")["values"]) == {-45.0}  # type: ignore[index]
    assert _line(picture, "overlay", "t.wav") is None
    members = picture["members"]
    assert {item["key"]: item["reason"] for item in members["shown"]["excluded"]} == {
        "s": "other-reference",
        "t": "other-reference",
    }
    assert members["shown"]["n"] == 4
    lines = {line["line"]: line for line in members["lines"]}
    assert lines["t.wav"] == {
        "line": "t.wav",
        "drawn": False,
        "used": [],
        "excluded": [{"key": "t", "reason": "other-reference"}],
    }
    assert lines["base"]["excluded"] == [{"key": "s", "reason": "other-reference"}]
    lane = next(item for item in picture["lanes"] if item["id"] == "overlay")
    assert lane["axis"]["referenceLabel"] == "dBFS" and lane["axis"]["unit"] == "FS"


def test_the_target_is_the_compared_recordings_identity_never_the_first_members() -> None:
    answers = _known()
    answers["s"] = _answer("s", _flat(60), identity=SPL)
    answers["d"] = _answer("d", _flat(50), identity=SPL)
    service = FigureService(Source(answers), CombineOps())
    picture = _draw(service, _spec(["a", "s", "b"], ["d"]))
    lines = {line["line"]: line for line in picture["members"]["lines"]}
    assert lines["base"]["used"] == ["s"]
    assert {item["key"] for item in lines["base"]["excluded"]} == {"a", "b"}


def test_every_state_and_a_version_answers_did_not_decide_of_is_counted_left_out_with_its_reason() -> None:
    answers = _known()
    for key in "pqrs":
        answers[key] = _answer(key, _flat(-44))
    states = {"p": "pending", "q": "stale", "r": "failed", "s": "evicted"}
    spec = _spec(["a", "b", "c", "p", "q", "r", "s", "gone", "old"], ["d"], states)
    answers["old"] = Answer("old", "v-older", XS, _flat(-41), FS, "ax", "level", "log", (20.0, 8000.0), 0)
    service = FigureService(Source(answers), CombineOps())
    picture = _draw(service, spec)
    reasons = {item["key"]: item["reason"] for item in picture["members"]["shown"]["excluded"]}
    # A usable key the service holds no answer of is evicted; one held at another version is left out (version).
    assert reasons == {"p": "pending", "q": "stale", "r": "failed", "s": "evicted", "gone": "evicted", "old": "version"}
    assert picture["members"]["shown"]["used"] == ["a", "b", "c", "d"]
    # "p" is still on its way: the median waits for it, counted pending meanwhile.
    assert _line(picture, "overlay", "base") is None
    assert service.count({"spec": spec}) == {"members": picture["members"]}


def test_a_median_and_its_delta_wait_while_a_base_recording_is_pending_and_leave_out_stale_failed_and_evicted() -> None:
    """計算ア (members.py): no median of part of a group while one of it is pending, as the comparison does today; the
    pending one counted as such. Stale, failed and evicted ones are left out and counted; the median is of the rest."""
    answers = _known()
    answers["p"] = _answer("p", _flat(-44))
    service = FigureService(Source(answers), CombineOps())
    waiting = _draw(service, _spec(["a", "b", "c", "p"], ["d"], {"p": "pending"}))
    lines = {line["line"]: line for line in waiting["members"]["lines"]}
    assert lines["base"]["drawn"] is False and lines["delta1"]["drawn"] is False
    assert {item["key"]: item["reason"] for item in lines["base"]["excluded"]} == {"p": "pending"}
    assert lines["base"]["used"] == ["a", "b", "c"], "the group's n as it is counted meanwhile"
    assert _line(waiting, "overlay", "base") is None and _line(waiting, "delta", "delta1") is None
    assert _line(waiting, "overlay", "d.wav") is not None, "the compared recording is drawn meanwhile"
    # In: the whole group's median (of −40, −50, −45 and −44: −44.5).
    done = _draw(service, _spec(["a", "b", "c", "p"], ["d"]), generation=2)
    assert set(_line(done, "overlay", "base")["values"]) == {-44.5}  # type: ignore[index]
    assert _line(done, "delta", "delta1") is not None
    # Stale, failed and evicted ones are left out, counted, and the median is of the rest at once.
    for state in ("stale", "failed", "evicted"):
        left = _draw(
            service,
            _spec(["a", "b", "c", "p"], ["d"], {"p": state}),
            generation={"stale": 3, "failed": 4, "evicted": 5}[state],
        )
        base = next(line for line in left["members"]["lines"] if line["line"] == "base")
        assert base["drawn"] is True and {item["key"]: item["reason"] for item in base["excluded"]} == {"p": state}
        assert set(_line(left, "overlay", "base")["values"]) == {-45.0}  # type: ignore[index]


def test_a_recording_known_to_be_of_another_reference_is_said_so_while_pending() -> None:
    spl = {"level": {"unit": "Pa", "ref": 2e-5, "label": "dB SPL re 20 µPa"}}
    spec = _spec(["a", "b", "p"], ["d"], {"p": "pending"}, p=spl)
    picture = _draw(FigureService(Source(_known()), CombineOps()), spec)
    assert {item["key"]: item["reason"] for item in picture["members"]["shown"]["excluded"]} == {"p": "other-reference"}


def test_a_recording_on_another_axis_is_drawn_but_not_in_the_median_or_delta() -> None:
    answers = _known()
    answers["x"] = _answer("x", np.full(513, -42.0), axis="other", xs=np.linspace(0, 8000, 513))
    service = FigureService(Source(answers), CombineOps())
    picture = _draw(service, _spec(["a", "b", "c"], ["d", "x"]))
    assert _line(picture, "overlay", "x.wav") is not None
    assert picture["members"]["combined"]["excluded"] == [{"key": "x", "reason": "other-axis"}]
    assert picture["members"]["shown"]["excluded"] == []


def test_with_the_compared_answer_not_usable_nothing_is_counted_and_nothing_drawn() -> None:
    picture = _draw(FigureService(Source(_known()), CombineOps()), _spec(["a", "b"], ["d"], {"d": "pending"}))
    reasons = {item["key"]: item["reason"] for item in picture["members"]["shown"]["excluded"]}
    assert reasons == {"a": "no-identity", "b": "no-identity", "d": "pending"}
    assert all(not lane["lines"] and "range" not in lane for lane in picture["lanes"])
    assert picture["headlines"] == []


# --- Holdings, generations and ids --------------------------------------------------------------------------------


def _read_at(service: FigureService, picture: dict, figure: str = "f") -> str:
    return service.read(
        {
            "figureId": figure,
            "pictureId": picture["pictureId"],
            "requestNumber": 1,
            "name": {"lane": "overlay", "line": "base", "x": XS[300]},
        }
    )["status"]


def test_a_figure_holds_its_newest_generation_only_and_nothing_once_released() -> None:
    service = FigureService(Source(_known()), CombineOps())
    spec = _spec(["a", "b", "c"], ["d"])
    first = _draw(service, spec, generation=1)
    assert _read_at(service, first) == "point"
    second = _draw(service, spec, generation=2, width=300)
    assert second["pictureId"] != first["pictureId"] and second["dataId"] == first["dataId"]
    assert _read_at(service, first) == "no-picture" and _read_at(service, second) == "point"
    # A draw of an older generation than one begun is not held.
    assert _draw(service, spec, generation=1)["status"] == "superseded"
    assert service.held() == {"f": (2, second["pictureId"])}
    service.release({"figureId": "f"})
    assert service.held() == {} and _read_at(service, second) == "no-picture"
    # Nor is a draw for a released Figure.
    assert _draw(service, spec, generation=3)["status"] == "superseded" and service.held() == {}


def test_a_read_with_no_holding_is_no_picture_and_two_figures_hold_apart() -> None:
    service = FigureService(Source(_known()), CombineOps())
    assert (
        service.read(
            {
                "figureId": "f",
                "pictureId": "p",
                "requestNumber": 1,
                "name": {"lane": "overlay", "line": "base", "x": 1.0},
            }
        )["status"]
        == "no-picture"
    )
    spec = _spec(["a", "b", "c"], ["d"])
    one, two = _draw(service, spec, figure="one"), _draw(service, spec, figure="two")
    assert one["pictureId"] == two["pictureId"]  # same conditions, same picture id; held per Figure id
    service.release({"figureId": "one"})
    assert _read_at(service, two, "two") == "point" and _read_at(service, one, "one") == "no-picture"


def test_a_draw_finished_after_its_figure_was_released_or_redrawn_is_not_held() -> None:
    source = Source(_known())
    service = FigureService(source, CombineOps())
    spec = _spec(["a", "b", "c"], ["d"])
    source.during = lambda: service.release({"figureId": "f"})
    assert _draw(service, spec)["status"] == "superseded"
    assert service.held() == {}
    source.during = None
    other = FigureService(Source(_known()), CombineOps())
    began = {"done": False}

    def newer() -> None:
        if not began["done"]:
            began["done"] = True
            assert other._begin("g", 5)  # a newer generation begins while this one computes

    other._source.during = newer  # type: ignore[attr-defined]
    assert _draw(other, spec, figure="g", generation=4)["status"] == "superseded"
    assert other.held() == {}


def test_a_draw_over_the_budget_is_refused_before_computing_and_the_least_recently_read_figure_goes_first() -> None:
    answers = _known()
    tiny = FigureService(Source(answers), CombineOps(), budget=1000)
    assert _draw(tiny, _spec(["a", "b", "c"], ["d"]))["status"] == "too-large"
    assert tiny.held() == {}
    # Room for the estimate of one draw, and for about one figure's holding.
    budget = 2 * sum(answer.nbytes for answer in answers.values()) + 3 * answers["a"].nbytes
    service = FigureService(Source(answers), CombineOps(), budget=budget)
    spec = _spec(["a", "b", "c"], ["d"])
    first = _draw(service, spec, figure="one")
    for figure in ("two", "three", "four"):
        _draw(service, spec, figure=figure)
    assert "one" not in service.held() and _read_at(service, first, "one") == "no-picture"


def test_export_has_the_draws_data_id_and_every_point_unthinned_and_refuses_another_id() -> None:
    service = FigureService(Source(_known()), CombineOps())
    spec = _spec(["a", "b", "c"], ["d"])
    view = {"x": [100.0, 4000.0]}
    picture = _draw(service, spec, view=view)
    exported = service.export({"spec": spec, "view": view, "dataId": picture["dataId"], "requestNumber": 3})
    assert exported["status"] == "rows" and exported["dataId"] == picture["dataId"] and exported["requestNumber"] == 3
    columns = {column["line"]: column for column in exported["columns"]}
    assert len(columns["d.wav"]["values"]) == XS.size > len(_line(picture, "overlay", "d.wav")["values"])  # type: ignore[index]
    assert columns["d.wav"]["values"][PEAK] == -10.0
    # Its places are every bin's, not the drawn points' (thinned to the picture's width).
    assert columns["d.wav"]["xs"] == XS.tolist()
    assert_not_drawn(columns["d.wav"]["xs"], _line(picture, "overlay", "d.wav")["xs"])  # type: ignore[index]
    assert exported["headlines"] == picture["headlines"] and exported["members"] == picture["members"]
    assert service.export({"spec": spec, "dataId": picture["dataId"]})["status"] == "no-picture"  # another range


def test_a_request_the_service_cannot_take_is_an_error_not_a_picture() -> None:
    service = FigureService(Source(_known()), CombineOps())
    with pytest.raises(FigureRequestError):
        _draw(service, _spec(["a"], ["d"]), view={"x": [100.0, 50.0]})
    spec = _spec(["a"], ["d"])
    spec["keys"] = spec["keys"][:1]
    with pytest.raises(FigureRequestError):
        _draw(service, spec)


# --- The real path: wandas spectra in the store, the adapter, the protocol ----------------------------------------


RATE = 16000


def _spectrum(level: float, peak_at: float | None = None) -> wd.SpectralFrame:
    rng = np.random.default_rng(int(abs(level) * 10))
    noise = 10 ** (level / 20) * rng.standard_normal(RATE)
    if peak_at is not None:
        noise = noise + 0.5 * np.sin(2 * np.pi * peak_at * np.arange(RATE) / RATE)
    return wd.from_numpy(noise[np.newaxis], sampling_rate=RATE).welch(n_fft=1024)


def _ask(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = validate_request({"cmd": command, "requestId": "r", **payload})
    result = dict(dispatch(request, None))  # type: ignore[arg-type]
    assert result_violation(command, result) is None, (command, result_violation(command, result))
    return result


def test_the_five_requests_through_the_protocol_on_spectra_the_store_keeps() -> None:
    frames = {"k1": _spectrum(-40), "k2": _spectrum(-50), "k3": _spectrum(-45), "k4": _spectrum(-30, 1000.0)}
    kept = {}
    for key, frame in frames.items():
        data = stage_data(frame, dict(stage_view(frame)))
        assert data is not None
        STORE.put(key, data)
        kept[key] = data
    spec = _spec(["k1", "k2", "k3"], ["k4"])
    for entry in spec["keys"]:
        entry["version"] = entry["key"]
    picture = _ask(
        "figure-draw",
        {
            "figureId": "fig",
            "generation": 0,
            "requestNumber": 0,
            "spec": spec,
            "width": 640,
            "height": 240,
            "view": None,
            "selection": None,
        },
    )
    assert picture["status"] == "picture" and picture["members"]["combined"]["n"] == 4
    median = np.median(np.stack([kept[key].values for key in ("k1", "k2", "k3")]), axis=0)
    delta = kept["k4"].values - median
    head = picture["headlines"][0]
    xs = kept["k4"].xs
    assert head["x"] == pytest.approx(1000.0, abs=16) and head["value"] == pytest.approx(float(delta[head["index"]]))
    inside = (xs >= 20) & (xs <= 8000)
    assert abs(head["value"]) == pytest.approx(float(np.max(np.abs(delta[inside]))))
    read = _ask(
        "figure-read",
        {
            "figureId": "fig",
            "pictureId": picture["pictureId"],
            "requestNumber": 1,
            "name": {"lane": "overlay", "line": "base", "x": float(xs[64])},
        },
    )
    assert read["point"]["value"] == pytest.approx(float(median[64]), abs=1e-12)
    exported = _ask("figure-export", {"spec": spec, "dataId": picture["dataId"]})
    assert exported["dataId"] == picture["dataId"]
    counted = _ask("figure-count", {"spec": spec})
    assert counted["members"] == picture["members"]
    assert _ask("figure-release", {"figureId": "fig"}) == {}
    gone = _ask(
        "figure-read",
        {
            "figureId": "fig",
            "pictureId": picture["pictureId"],
            "requestNumber": 2,
            "name": {"lane": "overlay", "line": "base", "x": float(xs[64])},
        },
    )
    assert gone["status"] == "no-picture"
    # A key the store no longer keeps is counted evicted, as answers/ will be told to ask again.
    assert StoreAnswers().answer("not-kept") is None


# --- no-picture says why ---------------------------------------------------------------------------------------


def _read(service: FigureService, figure: str, picture: str) -> dict:
    return service.read(
        {
            "figureId": figure,
            "pictureId": picture,
            "requestNumber": 1,
            "pointer": {"lane": "overlay", "x": 1000.0, "y": -40.0, "scale": [100.0, 4.0]},
        }
    )


def test_every_no_picture_answer_logs_its_reason_on_stderr(capsys: pytest.CaptureFixture[str]) -> None:
    service = FigureService(Source(_known()), CombineOps())
    assert _read(service, "never", "p0")["status"] == "no-picture"
    first = _draw(service, _spec(["a", "b", "c"], ["d"]))
    _draw(service, _spec(["a", "b", "c"], ["d"]), generation=2, width=500)
    assert _read(service, "f", first["pictureId"])["status"] == "no-picture"
    service.release({"figureId": "f"})
    assert _read(service, "f", first["pictureId"])["status"] == "no-picture"
    spec = _spec(["a", "b", "c"], ["d"])
    assert service.export({"spec": spec, "dataId": "not-this-one", "requestNumber": 1})["status"] == "no-picture"
    # Over the budget the Figure read least recently loses its holding: its next read says so.
    answers = _known()
    budget = 2 * sum(answer.nbytes for answer in answers.values()) + 3 * answers["a"].nbytes
    small = FigureService(Source(answers), CombineOps(), budget=budget)
    one = _draw(small, spec, figure="one")
    for figure in ("two", "three", "four"):
        _draw(small, spec, figure=figure)
    assert _read(small, "one", one["pictureId"])["status"] == "no-picture"
    lines = [line for line in capsys.readouterr().err.splitlines() if line.startswith("[figure] no-picture:")]
    assert lines == [
        "[figure] no-picture: nothing is held for the Figure figure=never picture=p0",
        f"[figure] no-picture: the picture held is another (a newer draw) figure=f picture={first['pictureId']}",
        f"[figure] no-picture: the Figure was released figure=f picture={first['pictureId']}",
        f"[figure] no-picture: the data id changed (an answer's version) asked=not-this-one now={first['dataId']}",
        f"[figure] no-picture: its holding was let go over the budget figure=one picture={one['pictureId']}",
    ]


def test_the_headline_is_the_point_a_read_of_it_gives_in_the_reads_own_form() -> None:
    """計算オ's headline carries what a read of its point carries (the line, the point's index, its place, its data step
    and its unrounded answer): the Figure writes both the same way."""
    service = FigureService(Source(_known()), CombineOps())
    picture = _draw(service, _spec(["a", "b", "c"], ["d"]))
    (headline,) = picture["headlines"]
    read = service.read(
        {
            "figureId": "f",
            "pictureId": picture["pictureId"],
            "requestNumber": 1,
            "name": {"line": headline["line"], "x": headline["x"]},
        }
    )
    assert read["status"] == "point" and read["lane"] == headline["lane"] and read["line"] == headline["line"]
    point = {name: read["point"][name] for name in ("index", "x", "xStep", "value")}
    assert point == {name: headline[name] for name in ("index", "x", "xStep", "value")}
    assert headline["value"] == 35.0 and headline["x"] == XS[PEAK]


def test_a_lanes_guide_lines_are_carried_as_given_and_the_overlay_has_none() -> None:
    """目安の線: a lane's lines at a place of one axis, carried by the picture as they are (picture.py puts them in, no
    arithmetic); the spectrum overlay has none."""
    from figures.picture import LanePlan, assemble

    service = FigureService(Source(_known()), CombineOps())
    picture = _draw(service, _spec(["a", "b", "c"], ["d"]))
    assert [lane["guides"] for lane in picture["lanes"]] == [[], []]
    found = members(parse_spec(_spec(["a"], ["d"])), {})
    lane = LanePlan("overlay", "level", None, "log", None, (), (("x", 0.25), ("y", -3.0)))
    out = assemble(
        figure_id="f",
        generation=1,
        request_number=1,
        picture_id="p",
        data_id="d",
        lanes=[lane],
        headlines={},
        found=found,
        width=600,
        heights={"overlay": 300},
    )
    assert out["lanes"][0]["guides"] == [{"axis": "x", "at": 0.25}, {"axis": "y", "at": -3.0}]


def test_the_base_is_declared_as_its_set_and_members_decide_whether_its_line_is_one_recording_or_the_median() -> None:
    """One place for the base rule (計算ア): the screen declares the base's recordings with the base role; a line of one
    key for the base is refused, and members decide that a base of one recording is that recording's own line."""
    service = FigureService(Source(_known()), CombineOps())
    one = _draw(service, _spec(["a"], ["d"]))
    base = _line(one, "overlay", "base")
    assert base is not None and base["key"] == "a" and set(base["values"]) == {-40.0}
    group = _draw(service, _spec(["a", "b", "c"], ["d"]), generation=2)
    assert "key" not in _line(group, "overlay", "base") and set(_line(group, "overlay", "base")["values"]) == {-45.0}  # type: ignore[index, operator]
    wrong = _spec(["a"], ["d"])
    wrong["lanes"][0]["lines"][0]["of"] = {"key": "a"}
    with pytest.raises(FigureRequestError, match="the base is declared as its recordings' set"):
        _draw(service, wrong, generation=3)


def test_a_step_names_its_point_by_lane_line_recording_key_answer_version_data_id_and_generation() -> None:
    """Class 1: an arrow key is a read answered on the current picture from the selected point's
    name. A step from a point of another recording, another answer, another data or another generation is
    ``no-point`` (never moved on this picture's line); a name of another recording key is ``no-point`` too."""
    service = FigureService(Source(_known()), CombineOps())
    picture = _draw(service, _spec(["a", "b", "c"], ["d"]))
    ask = {"figureId": "f", "pictureId": picture["pictureId"], "requestNumber": 3}
    x = float(XS[300])
    named = service.read({**ask, "name": {"lane": "overlay", "line": "d.wav", "key": "d", "x": x}})
    assert named["status"] == "point" and named["point"]["key"] == "d"
    held = {"dataId": picture["dataId"], "generation": picture["generation"]}
    step = {"lane": "overlay", "line": "d.wav", "key": "d", "version": named["version"], "index": 300, "steps": 2}
    assert service.read({**ask, **held, "step": step})["point"]["index"] == 302
    for wrong in (
        {"step": {**step, "key": "e"}},
        {"step": {**step, "version": "another answer"}},
        {"step": {**step, "lane": "delta"}},
        {"step": step, "dataId": "another data"},
        {"step": step, "generation": picture["generation"] + 1},
        {"name": {"lane": "overlay", "line": "d.wav", "key": "e", "x": x}},
    ):
        got = service.read({**ask, **held, **wrong})
        assert got["status"] == "no-point", wrong


def test_lines_shown_a_lane_a_recording_are_looked_at_together_one_range_up_and_a_delta_lane_keeps_its_own() -> None:
    """「One lane per track」: each recording's own line in a lane of its own. The lanes show the
    same part across and share one range up (the widest of theirs: the lanes are compared at a glance), a lane
    whose range up is specified apart; a base recording's line is its own answer. The overlay's Δ lane beside its
    overlay lane is no recording's own, and keeps its range."""
    answers = {"a": _answer("a", _flat(-20.0)), "b": _answer("b", _flat(-60.0)), "c": _answer("c", _flat(-45.0))}
    service = FigureService(Source(answers), CombineOps())
    spec = {
        "lanes": [
            {"id": "own-base1", "kind": "lines", "lines": [{"id": "base1", "of": {"median": ["a"]}, "role": "base"}]},
            {
                "id": "own-compare1",
                "kind": "lines",
                "lines": [{"id": "compare1", "of": {"key": "b"}, "role": "compare1"}],
            },
            {"id": "own-other1", "kind": "lines", "lines": [{"id": "other1", "of": {"key": "c"}}]},
        ],
        "keys": [{"key": key, "state": "usable", "version": f"v-{key}"} for key in "abc"],
    }
    picture = _draw(service, spec)
    assert [[line["id"] for line in lane["lines"]] for lane in picture["lanes"]] == [
        ["base1"],
        ["compare1"],
        ["other1"],
    ]
    assert {(*lane["range"]["x"], *lane["range"]["y"]) for lane in picture["lanes"]} == {(20.0, 8000.0, -65.0, -20.0)}
    assert {(*lane["whole"]["x"], *lane["whole"]["y"]) for lane in picture["lanes"]} == {(20.0, 8000.0, -65.0, -20.0)}
    typed = _draw(service, spec, generation=2, view={"lanes": [{"lane": "own-compare1", "y": [-70, -50]}]})
    up = {lane["id"]: tuple(lane["range"]["y"]) for lane in typed["lanes"]}
    assert up["own-compare1"] == (-70.0, -50.0) and up["own-base1"] == up["own-other1"] == (-50.0, -20.0)
    assert {tuple(lane["whole"]["y"]) for lane in typed["lanes"]} == {(-65.0, -20.0)}
    overlay = _draw(FigureService(Source(answers), CombineOps()), _spec(["a"], ["b"]))
    ranges = {lane["id"]: tuple(lane["range"]["y"]) for lane in overlay["lanes"]}
    assert ranges["overlay"] == (-60.0, -20.0) and ranges["delta"] != ranges["overlay"]
