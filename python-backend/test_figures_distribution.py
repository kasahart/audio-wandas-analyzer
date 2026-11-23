"""The distribution on the NEW path (the figure service's bins lanes): the recorded cases of
tests/fixtures/figure_distribution_cases.json (the old path's answers, src/test/figureDistributionCases.test.ts)
replayed through the protocol against the five calculations.

What is the same as the old path, case by case: the value axis (padded, round ends), the 48 bins and the rows each
bar counts (a value on an edge in the bin above it), the rows by value then key, the ticks under the bars, the dots
of a group of few and the level each is stacked on, the count axis, the lines of the rows holding a role, and what a
pointer reads and a click acts on (a bar, a row's tick or dot, a role's line, the bin under a pointer that reads no
point).

What is not, on purpose (DIFFERENT below names each case):

- the selected range is half-open, as a bin is: from its low end up to, not including, its high end (closed only at
  the axis's top). The old filter was closed at both ends, so a row on a bin's high edge was counted in the next bar
  yet kept by the picked bin. Now a picked bin takes exactly the rows its bar counts;
- no line of the base group's median (仕様 7: a distribution draws the table's values as they are and makes no new
  answer). A base that is one recording is still drawn as that row's line;
- a group's rows with no number are counted (``blank``); the old picture left them out without a count.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from figures.members import bin_counts, rows_picked
from figures.pick import bin_under
from figures.ranges import value_axis
from figures.thinning import BINS, bin_edges, bin_of
from transport.command_dispatch import dispatch, validate_request
from transport.figure_answers import COLUMNS
from transport.protocol_schema import result_violation

TABLE = json.loads((Path(__file__).parent / "tests" / "fixtures" / "figure_distribution_cases.json").read_text("utf-8"))
COLUMN = "column:value"
ROLES = ["base", "compare1", "compare2", "compare3"]


@pytest.fixture(autouse=True)
def _no_column_left() -> Any:
    """The columns are the process's: none is left for the next test (they count in the one budget)."""
    yield
    COLUMNS.clear()


def _cases(section: str) -> list[Any]:
    return [pytest.param(case, id=case["id"]) for case in TABLE[section]]


def _ask(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = validate_request({"cmd": command, "requestId": "r", **payload})
    result = dict(dispatch(request, None))  # type: ignore[arg-type]
    assert result_violation(command, result) is None, (command, result_violation(command, result))
    return result


def _column(scene: dict[str, Any], version: str = "v1") -> dict[str, Any]:
    """The scene's value column as answers/ hands it: a value per table row, null where the CSV leaves it blank."""
    rows = scene["rows"]
    return {
        "key": COLUMN,
        "version": version,
        "rows": [row["path"] for row in rows],
        "values": [float(row["value"]) if row["value"] != "" else None for row in rows],
    }


def _spec(scene: dict[str, Any], version: str = "v1") -> dict[str, Any]:
    """The figure spec of a scene: a bins lane per group (in the groups' order), the group's rows in the table's
    order, and the slots' recordings as the lines of the lane they are rows of."""
    groups = sorted({row["group"] for row in scene["rows"]})
    group_of = {row["path"]: row["group"] for row in scene["rows"]}
    lanes = []
    for group in groups:
        lines = [
            {"id": f"slot{slot}", "role": ROLES[slot], "of": {"key": key}}
            for slot, key in enumerate(scene["slots"])
            if key is not None and group_of[key] == group
        ]
        lanes.append(
            {
                "id": group,
                "kind": "bins",
                "column": COLUMN,
                "rows": [row["path"] for row in scene["rows"] if row["group"] == group],
                "lines": lines,
            }
        )
    return {"lanes": lanes, "keys": [{"key": COLUMN, "state": "usable", "version": version}]}


def _draw(scene_name: str, figure: str = "dist", generation: int = 1, **more: Any) -> dict[str, Any]:
    scene = TABLE["scenes"][scene_name]
    selection = [scene["range"]["low"], scene["range"]["high"]] if scene["range"] else None
    # A recorded range was picked on the old figure, which took the values on both its ends: closed where it reaches
    # the top of the axis, as the Figure says a picked range is.
    if selection is not None and "selectionClosed" not in more:
        numbers = [value for value in _column(scene)["values"] if value is not None]
        more = {**more, "selectionClosed": selection[1] >= value_axis([np.array(numbers, dtype=np.float64)])[1]}
    payload = {
        "figureId": figure,
        "generation": generation,
        "requestNumber": 1,
        "spec": _spec(scene),
        "columns": [_column(scene)],
        "selection": selection,
        "width": scene["width"],
        "height": 100 * 3,
        **more,
    }
    return _ask("figure-draw", payload)


def _lanes(picture: dict[str, Any]) -> dict[str, dict[str, Any]]:
    assert picture["status"] == "picture", picture
    return {lane["id"]: lane for lane in picture["lanes"]}


def _layer(row: dict[str, Any], kind: str, marks: str | None) -> dict[str, Any] | None:
    return next((layer for layer in row["layers"] if layer["kind"] == kind and layer["marks"] == marks), None)


@pytest.mark.parametrize("case", _cases("layout"))
def test_the_axis_the_rows_the_counts_and_the_placement_are_the_old_pictures(case: dict[str, Any]) -> None:
    expected = case["expected"]
    scene = TABLE["scenes"][case["input"]["scene"]]
    lanes = _lanes(_draw(case["input"]["scene"], figure=case["id"]))
    assert [row["group"] for row in expected["rows"]] == list(lanes)
    for row, group in zip(expected["rows"], expected["groups"], strict=True):
        lane = lanes[row["group"]]
        bins = lane["bins"]
        # The value axis, shared by the lanes, and the count axis.
        assert lane["whole"]["x"] == [expected["low"], expected["high"]] == lane["range"]["x"]
        assert lane["range"]["y"] == pytest.approx(row["countRange"], abs=1e-12)
        assert lane["axis"]["quantity"] == "count"
        # The rows: every member of the group with a number, by value then key.
        by_value = sorted((member["value"], member["key"]) for member in group["members"])
        assert [(member["value"], member["key"]) for member in bins["members"]] == by_value
        assert len(bins["edges"]) == BINS + 1 and bins["edges"][0] == expected["low"]
        assert bins["edges"][-1] == expected["high"]
        bars = _layer(row, "bar", None)
        if bars is not None:
            # Bars: the same rows in every bin, and each row's tick under them.
            assert bins["counts"] == [count or 0 for count in bars["values"]]
            rug = _layer(row, "line", "rug")
            assert rug is not None and [member["value"] for member in bins["members"]] == rug["xs"]
            assert [member["key"] for member in bins["members"]] == rug["identity"]
            assert all("at" not in member for member in bins["members"])
        else:
            assert "counts" not in bins
            # (A dot's place up the count axis is the picture's: the middle of the level it is stacked on.)
            dots = [(member["key"], member["value"], member["at"]) for member in bins["members"]]
            assert dots == [(dot["key"], dot["value"], dot["level"] + 0.5) for dot in row["dots"]]
        assert bins["n"] == len(bins["members"])
        # The rows holding a role: a line each, on the lane their row is in. The base group's median has none (仕様 7).
        ticks = [
            layer for layer in row["layers"] if layer["kind"] == "line" and layer["marks"] is None and not layer["dash"]
        ]
        assert [(mark["key"], mark["value"]) for mark in bins["marks"]] == [
            (tick["label"], tick["xs"][0]) for tick in ticks
        ]
        assert [mark["role"] for mark in bins["marks"]] == [ROLES[slot] for slot in row["slots"]]
    # A row left blank in the CSV is counted on its group's lane, and not drawn.
    blank = {group: sum(1 for row in scene["rows"] if row["group"] == group and row["value"] == "") for group in lanes}
    assert {group: lane["bins"]["blank"] for group, lane in lanes.items()} == blank == {"A": 1, "B": 0, "C": 0}


def test_a_picked_bin_takes_the_rows_its_bar_counts_where_the_old_range_took_its_high_edge_too() -> None:
    """DIFFERENT (the bin-boundary rule): with bin 11 picked (22.9… to 25), the old path lit two of bin 12's three
    rows (the two at exactly 25: in the closed range, counted in the next bar). The new range is half-open as a bin
    is, so it takes the rows of bin 11 (none) and no row of bin 12."""
    case = next(case for case in TABLE["layout"] if case["id"] == "layout_picked")
    old = _layer(case["expected"]["rows"][0], "bar", None)
    assert old is not None and old["share"][12] == 2 and old["values"][12] == 3 and old["values"][11] is None
    bins = _lanes(_draw("picked", figure="picked"))["A"]["bins"]
    assert bins["counts"][11] == 0 and bins["counts"][12] == 3
    assert bins["countsPicked"] == [0] * BINS
    assert [member["picked"] for member in bins["members"]] == [False] * len(bins["members"])
    # Picking bin 12 itself takes its three rows, and only them.
    scene = TABLE["scenes"]["picked"]
    edges = bins["edges"]
    picture = _ask(
        "figure-draw",
        {
            "figureId": "picked",
            "generation": 2,
            "requestNumber": 2,
            "spec": _spec(scene),
            "selection": [edges[12], edges[13]],
            "width": 480,
            "height": 300,
        },
    )
    bins = _lanes(picture)["A"]["bins"]
    assert bins["countsPicked"][12] == 3 and sum(bins["countsPicked"]) == 3
    assert [member["key"] for member in bins["members"] if member["picked"]] == [
        "/d/a03.wav",
        "/d/a04.wav",
        "/d/a05.wav",
    ]


def _text(value: float) -> str:
    """A number as the recorded readouts write it (JavaScript's String(number))."""
    return str(int(value)) if float(value).is_integer() else repr(float(value))


def _read(scene: str, read_input: dict[str, Any], scale: list[float]) -> tuple[str, list[dict[str, Any]]]:
    """What a pointer reads at a place of a scene and what a click there acts on, written as the recorded cases
    write them (the Figure's words are its own; the point, the counts and the bin are the service's)."""
    picture = _draw(scene, figure=f"read-{scene}")
    lane = _lanes(picture)[read_input["group"]]
    bins = lane["bins"]
    got = _ask(
        "figure-read",
        {
            "figureId": f"read-{scene}",
            "pictureId": picture["pictureId"],
            "requestNumber": 2,
            "pointer": {"lane": lane["id"], "x": read_input["value"], "y": read_input["count"], "scale": scale},
        },
    )
    if got["status"] != "point":
        assert got["status"] == "outside"
        click = [{"pick": {"low": got["bin"]["low"], "high": got["bin"]["high"]}}] if "bin" in got else []
        return f"value / {_text(read_input['value'])}", click
    point = got["point"]
    if got["line"] == bins["bars"]:
        low, high = bins["edges"][point["index"]], bins["edges"][point["index"] + 1]
        assert point["value"] == bins["counts"][point["index"]]
        picked = f"{bins['countsPicked'][point['index']]} / " if "countsPicked" in bins else ""
        text = f"{lane['id']} / {_text(low)}–{_text(high)} / {picked}{_text(point['value'])} recordings"
        return text, [{"pick": {"low": low, "high": high}}]
    if got["line"] == bins["rows"]:
        member = bins["members"][point["index"]]
        assert (member["key"], member["value"]) == (point["key"], point["x"])
        return f"{lane['id']} / {point['key']} / {_text(point['x'])}", [{"row": point["key"]}]
    mark = next(mark for mark in bins["marks"] if mark["id"] == got["line"])
    assert mark["key"] == point["key"] and got["role"] == mark["role"]
    return f"{point['key']} / {_text(point['x'])}", [{"row": point["key"]}]


#: The read cases the new path answers otherwise, on purpose, and what it answers.
DIFFERENT_READS: dict[str, tuple[str, list[dict[str, Any]]]] = {
    # 仕様 7: no line of the base group's median, so the bar under the pointer is read there.
    "base_line": (
        "A / 50–52.083333333333336 / 3 recordings",
        [{"pick": {"low": 50.0, "high": 52.083333333333336}}],
    ),
    # The bin-boundary rule: the picked bin 11 takes none of bin 12's rows (the old range took the two at 25).
    "picked_bar": ("A / 25–27.083333333333336 / 0 / 3 recordings", []),
}


@pytest.mark.parametrize("case", _cases("read"))
def test_a_pointer_reads_and_a_click_acts_on_what_the_old_pane_did(case: dict[str, Any]) -> None:
    read_input, expected = case["input"], case["expected"]
    text, click = _read(read_input["scene"], read_input, expected["scale"])
    if case["id"] in DIFFERENT_READS:
        assert (text, click if read_input.get("click") else []) == DIFFERENT_READS[case["id"]]
        assert text != expected["readout"]
        return
    assert text == expected["readout"]
    if read_input.get("click"):
        assert click == expected["click"]


#: The drag cases whose kept rows differ, on purpose (the bin-boundary rule), and the rows the new range keeps.
DIFFERENT_DRAGS: dict[str, list[str]] = {
    # A press at 24 picks bin 11 (22.9… to 25): the two rows at exactly 25 are bin 12's, and no longer kept.
    "press_inside": [],
    # A drag from 60 back to 20: the row at exactly 60 (the range's high end) is no longer kept.
    "drag": [
        "/d/a03.wav",
        "/d/a04.wav",
        "/d/a05.wav",
        "/d/a06.wav",
        "/d/a07.wav",
        "/d/a08.wav",
        "/d/a09.wav",
        "/d/b0.wav",
        "/d/b1.wav",
        "/d/b2.wav",
        "/d/b3.wav",
        "/d/c0.wav",
    ],
}


@pytest.mark.parametrize("case", _cases("drag"))
def test_the_range_a_press_or_a_drag_picks_and_the_rows_it_takes(case: dict[str, Any]) -> None:
    """The range's ends are the old ones (a press: the bin under it, by the bins' own edges; a drag: its two ends,
    clipped to the axis by the screen). The rows it takes are the rule's (members.rows_picked)."""
    scene = TABLE["scenes"][case["input"]["scene"]]
    press, expected = case["input"], case["expected"]
    column = _column(scene)
    values = np.array([np.nan if value is None else value for value in column["values"]])
    low, high = value_axis([values[np.isfinite(values)]])
    edges = bin_edges(low, high)
    if not press["moved"]:
        under = bin_under(edges, press["from"])
        assert under is not None
        picked = (float(edges[under]), float(edges[under + 1]))
    elif expected["range"] is None:
        assert min(press["from"], press["to"]) > high
        return
    else:
        picked = (max(low, min(press["from"], press["to"])), min(high, max(press["from"], press["to"])))
    assert picked == (expected["range"]["low"], expected["range"]["high"])
    kept = [
        row
        for row, value in zip(column["rows"], values, strict=True)
        # (Closed as the Figure says a picked range is: it reaches the top of the axis.)
        if rows_picked(np.array([value]), (*picked, picked[1] >= high))[0]
    ]
    if case["id"] in DIFFERENT_DRAGS:
        assert kept == DIFFERENT_DRAGS[case["id"]] != expected["kept"]
    else:
        assert kept == expected["kept"]


def test_any_picked_bin_takes_exactly_the_rows_its_bar_counts() -> None:
    """The rule the edges are shared for: whatever the values (on edges, at the axis's ends, in awkward floating
    point), the range of bin b takes the rows counted in bin b and no other."""
    random = np.random.default_rng(7)
    for trial in range(200):
        values = np.round(
            random.normal(random.uniform(-50, 50), random.uniform(0.01, 30), 300), int(random.integers(0, 4))
        )
        low, high = value_axis([values])
        edges = bin_edges(low, high)
        # Rows exactly on edges too (every edge but the last is a value of the data).
        values = np.concatenate([values, edges[:-1], [high]])
        bins = bin_of(edges, values)
        counts, _ = bin_counts(bins, BINS, None)
        assert int(counts.sum()) == values.size
        for b in range(BINS):
            taken = rows_picked(values, (float(edges[b]), float(edges[b + 1]), float(edges[b + 1]) >= high))
            assert np.array_equal(taken, bins == b), (trial, b)


def test_a_zoom_keeps_the_bins_and_reads_only_what_is_on_screen() -> None:
    whole = _lanes(_draw("plain", figure="zoom"))["A"]
    picture = _draw("plain", figure="zoom", generation=2, view={"x": [20, 60]})
    lane = _lanes(picture)["A"]
    assert lane["range"]["x"] == [20, 60] and lane["whole"]["x"] == [0, 100]
    assert lane["bins"]["edges"] == whole["bins"]["edges"] and lane["bins"]["counts"] == whole["bins"]["counts"]
    # The tick of the row at 92 is off screen: the pointer there reads nothing of it.
    got = _ask(
        "figure-read",
        {
            "figureId": "zoom",
            "pictureId": picture["pictureId"],
            "requestNumber": 3,
            "pointer": {"lane": "A", "x": 92, "y": 0, "scale": [12, 30.86]},
        },
    )
    assert got["status"] in ("outside", "no-value")


def test_a_bar_a_zoom_cuts_is_read_where_it_is_drawn() -> None:
    """Zoomed inside one bin, its bar fills the lane and its own middle may be off screen: the pointer at its top
    still reads the bar (its count, its bin's own ends), not a row's tick under it."""
    whole = _lanes(_draw("plain", figure="cut-bar"))["A"]["bins"]
    assert whole["counts"] is not None
    index = max(range(len(whole["counts"])), key=lambda at: whole["counts"][at])
    low, high = whole["edges"][index], whole["edges"][index + 1]
    # The upper 40% of the bin: its middle is left of the range.
    view = {"x": [low + 0.6 * (high - low), high - 0.01 * (high - low)]}
    picture = _draw("plain", figure="cut-bar", generation=2, view=view)
    lane = _lanes(picture)["A"]
    count = whole["counts"][index]
    x = sum(view["x"]) / 2
    read = _ask(
        "figure-read",
        {
            "figureId": "cut-bar",
            "pictureId": picture["pictureId"],
            "requestNumber": 2,
            "pointer": {"lane": "A", "x": x, "y": count, "scale": [400 / (view["x"][1] - view["x"][0]), 5.0]},
        },
    )
    assert read["status"] == "point" and read["line"] == lane["bins"]["bars"]
    assert (read["point"]["index"], read["point"]["value"]) == (index, count)
    assert view["x"][0] < read["point"]["x"] < view["x"][1]


def test_a_row_named_after_a_zoom_left_it_off_screen_is_not_read() -> None:
    """A row the keys chose is read again by its name after a redraw. Zoomed off the lane's range, it is answered as
    outside, as a pointer there is: the selection, and what Enter acts on, do not stay on a row no longer drawn."""
    whole = _draw("plain", figure="named-zoom")
    bins = _lanes(whole)["A"]["bins"]
    row = max(bins["members"], key=lambda member: member["value"])
    name = {"lane": "A", "line": bins["rows"], "key": row["key"], "x": row["value"]}
    base = {"figureId": "named-zoom", "requestNumber": 2}
    assert _ask("figure-read", {**base, "pictureId": whole["pictureId"], "name": name})["status"] == "point"
    zoomed = _draw("plain", figure="named-zoom", generation=2, view={"x": [20, 60]})
    assert row["value"] > 60
    assert _ask("figure-read", {**base, "pictureId": zoomed["pictureId"], "name": name})["status"] == "outside"


def test_the_arrow_keys_pass_rows_of_one_value_one_by_one_and_a_row_is_named_by_its_key() -> None:
    picture = _draw("plain", figure="keys")
    bins = _lanes(picture)["A"]["bins"]
    base = {"figureId": "keys", "pictureId": picture["pictureId"], "requestNumber": 2}
    version = _ask("figure-read", {**base, "name": {"lane": "A", "line": bins["rows"], "key": "/d/a03.wav", "x": 25}})
    assert version["status"] == "point" and version["point"]["key"] == "/d/a03.wav"
    # Named by its key, never by its place alone: the second row at 25 is itself.
    second = _ask("figure-read", {**base, "name": {"lane": "A", "line": bins["rows"], "key": "/d/a04.wav", "x": 25}})
    assert (second["point"]["key"], second["point"]["index"]) == ("/d/a04.wav", version["point"]["index"] + 1)
    step = {
        "lane": "A",
        "line": bins["rows"],
        "key": "/d/a03.wav",
        "version": version["version"],
        "index": version["point"]["index"],
        "steps": 1,
    }
    more = {"dataId": picture["dataId"], "generation": 1}
    onward = _ask("figure-read", {**base, **more, "step": step})
    assert onward["point"]["key"] == "/d/a04.wav" and onward["point"]["x"] == 25
    twice = _ask("figure-read", {**base, **more, "step": {**step, "steps": 2}})
    assert twice["point"]["key"] == "/d/a05.wav" and twice["point"]["x"] == 27
    # A row that is not on the lane (another group's) is no point of it.
    other = _ask("figure-read", {**base, "name": {"lane": "A", "line": bins["rows"], "key": "/d/b0.wav", "x": 20}})
    assert other["status"] == "no-point"
    # A bar: the keys pass the bars that hold a row.
    bar = _ask("figure-read", {**base, "pointer": {"lane": "A", "x": 26, "y": 3, "scale": [4.8, 30.86]}})
    assert (bar["line"], bar["point"]["index"]) == (bins["bars"], 12)
    step = {"lane": "A", "line": bins["bars"], "version": bar["version"], "index": 12, "steps": 1}
    onward = _ask("figure-read", {**base, **more, "step": step})
    assert onward["point"]["index"] == 18 and onward["point"]["value"] == 1


def test_a_column_is_handed_once_by_key_and_one_not_kept_is_counted_and_not_drawn() -> None:
    scene = TABLE["scenes"]["plain"]
    COLUMNS.keep([{**_column(scene), "key": "column:other"}])
    payload = {"figureId": "once", "generation": 1, "requestNumber": 1, "width": 480, "height": 300}
    spec = _spec(scene)
    for lane in spec["lanes"]:
        lane["column"] = "column:never"
    spec["keys"] = [{"key": "column:never", "state": "usable", "version": "v1"}]
    # A column never handed: nothing is drawn of it, and the picture says why.
    picture = _ask("figure-draw", {**payload, "spec": spec})
    assert all("bins" not in lane and "range" not in lane for lane in picture["lanes"])
    assert picture["members"]["shown"]["excluded"] == [{"key": "column:never", "reason": "evicted"}]
    # Handed with a request, it is drawn; the next request names it by key alone.
    handed = {**_column(scene), "key": "column:never"}
    assert "bins" in _lanes(_ask("figure-draw", {**payload, "generation": 2, "spec": spec, "columns": [handed]}))["A"]
    again = _ask("figure-draw", {**payload, "generation": 3, "spec": spec})
    assert again["members"]["shown"]["used"] == ["column:never"] and "bins" in _lanes(again)["A"]
    # The table changed (another version of the column than the one kept): counted, not drawn of the old values.
    spec["keys"][0]["version"] = "v2"
    stale = _ask("figure-draw", {**payload, "generation": 4, "spec": spec})
    assert stale["members"]["shown"]["excluded"] == [{"key": "column:never", "reason": "version"}]
    counted = _ask("figure-count", {"spec": spec, "columns": [{**handed, "version": "v2"}]})
    assert counted["members"]["shown"]["used"] == ["column:never"]


def test_a_figure_of_bins_lanes_has_no_other_kind_of_lane_and_no_median_line() -> None:
    scene = TABLE["scenes"]["plain"]
    payload = {"figureId": "refused", "generation": 1, "requestNumber": 1, "width": 480, "height": 300}
    mixed = _spec(scene)
    mixed["lanes"].append({"id": "sound", "kind": "band", "lines": [{"id": "s", "of": {"key": COLUMN}}]})
    with pytest.raises(Exception, match="no other kind of lane"):
        _ask("figure-draw", {**payload, "spec": mixed})
    median = _spec(scene)
    median["lanes"][0]["lines"] = [{"id": "base", "role": "base", "of": {"median": ["/d/a00.wav", "/d/a01.wav"]}}]
    with pytest.raises(Exception, match="rows holding a role"):
        _ask("figure-draw", {**payload, "spec": median})


def test_a_selected_range_takes_its_high_end_only_when_it_says_it_is_closed() -> None:
    """The one rule of a selected range (the table narrows by the same: datasetTable.ts inValueRange): from its low
    end up to, not including, its high end; closed, the values on its high end too. Nothing else decides it: not
    where the axis ends now."""
    values = np.array([1.0, 2.0, 3.0, 4.0])
    assert rows_picked(values, (2.0, 4.0, False)).tolist() == [False, True, True, False]
    assert rows_picked(values, (2.0, 4.0, True)).tolist() == [False, True, True, True]
    assert rows_picked(values, (2.0, 3.0, True)).tolist() == [False, True, True, False]
    # Through the service: the rows a bar counts as picked follow the request's ``selectionClosed``.
    scene = TABLE["scenes"]["plain"]
    numbers = np.array([value for value in _column(scene)["values"] if value is not None], dtype=np.float64)
    low, high = value_axis([numbers])
    top = int(np.count_nonzero(numbers == numbers.max()))
    counted = {}
    for closed in (False, True):
        picture = _draw(
            "plain", figure=f"closed-{closed}", selection=[low, float(numbers.max())], selectionClosed=closed
        )
        lanes = _lanes(picture)
        counted[closed] = sum(
            sum(lane["bins"]["countsPicked"] or [])
            if lane["bins"].get("countsPicked") is not None
            else sum(1 for member in lane["bins"]["members"] if member.get("picked"))
            for lane in lanes.values()
        )
    assert counted[True] - counted[False] == top > 0
    assert high >= numbers.max()
