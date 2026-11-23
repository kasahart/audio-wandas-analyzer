"""The spectrogram on the NEW path (the figure service's image lane): the recorded cases of
tests/fixtures/figure_heatmap_cases.json (the old path's answers, test_figure_heatmap_cases.py) replayed against the
five calculations and the service.

What is the same as the old path, case by case: the column blocks (one per two pixels: 200 at 400 px), the zoomed
picture's cells (0.1 dB; a block of one column and a row as it is), the colour range (100 dB under the rounded top),
the cell a place is in (an edge is the lower cell's) and the unrounded answer read there.

What is not, on purpose:

- ``power_mean`` and ``log_bands``: a block's and a band's drawn level is the
  LOUDEST of its answer cells, not their power mean, so a short event is drawn at its own level and the brightest
  drawn cell is the answer's highest level (the colour range's top). The recorded inputs are replayed against that
  rule; the recorded means stay the old path's (test_figure_heatmap_cases.py).
- ``view/whole``: the old whole picture was always 128 log bands; the new one has one rule at every zoom (every row,
  or as many log bands as two pixels each allow). Drawn cells only: its columns and its colour range are the same.
- ``cell_index/linear_axis_closed``: the old read cut a block around the pointer and took a place past the block as
  its end cell; the new read is of the whole answer, so a place past its outer edge is outside.
- ``view/zoomed_narrow``: the old picture had the cells whose centre is inside the range and left a cell the range's
  end cuts black, while the pointer read it. The new one draws, reads and takes the colour range of every cell any
  part of which is on screen (thinning.cells_on_screen): one rule.
- ``read_cells``: the old read sent the cells around the pointer and the screen chose one; the new read answers the
  one cell (the cell the screen chose: a place half way between two rows of a log axis is the higher row's).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from figures.answers import ImageAnswer
from figures.levels import FLOOR_DB
from figures.pick import CellNameAsk, CellPointerAsk, CellStepAsk, cell_index, pick_cell
from figures.ranges import Ends, colour_range, image_range
from figures.thinning import _band_levels, _loudest, cell_edges, drawn_image, image_blocks
from frames import stage_view as sv
from services.stage_combine import STORE, stage_data
from test_figure_heatmap_cases import numbers, scene_frame
from transport.command_dispatch import dispatch, validate_request
from transport.figure_answers import image_answer_of
from transport.protocol_schema import result_violation

TABLE = json.loads((Path(__file__).parent / "tests" / "fixtures" / "figure_heatmap_cases.json").read_text("utf-8"))
#: The frame the recorded zoomed pictures are replayed in: 400 px wide (the recorded 200 blocks), tall enough for every
#: row there.
WIDTH, HEIGHT = 400.0, 512.0


def _cases(section: str) -> list[Any]:
    return [pytest.param(case, id=case["id"]) for case in TABLE[section]]


def _answer(scene: str = "tones") -> ImageAnswer:
    frame, seconds = scene_frame(TABLE["scenes"][scene])
    data = stage_data(frame, dict(sv.stage_view(frame, seconds)), seconds)
    assert data is not None
    answer = image_answer_of("spectrogram", data)
    assert answer is not None
    return answer


@pytest.mark.parametrize("case", _cases("time_blocks"))
def test_the_column_blocks_are_the_recorded_ones_at_two_pixels_each(case: dict[str, Any]) -> None:
    edges = image_blocks(int(case["input"]["frames"]), WIDTH)
    kept = [int(edge) for at, edge in enumerate(edges) if at == 0 or edge > edges[at - 1]]
    assert kept == case["expected"]["edges"]


@pytest.mark.parametrize("case", _cases("power_mean"))
def test_a_blocks_level_is_the_loudest_of_its_cells_not_their_mean(case: dict[str, Any]) -> None:
    """DIFFERENT on purpose (最大でまとめる): the recorded blocks, pooled by the highest level in each (floored)."""
    given = numbers(case["input"])
    levels, axis = np.asarray(given["levels"], dtype=np.float64), int(given["axis"])
    got = _loudest(levels, axis=axis)
    highest = np.max(np.where(np.isfinite(levels), levels, FLOOR_DB), axis=axis)
    assert got.tolist() == np.maximum(highest, FLOOR_DB).tolist()
    # Never under the old path's power mean (the loudest cell is at least the mean).
    assert np.all(got >= np.asarray(numbers(case["expected"]["floored"]), dtype=np.float64) - 1e-9)


@pytest.mark.parametrize("case", _cases("log_bands"))
def test_a_bands_level_is_the_loudest_of_its_bins(case: dict[str, Any]) -> None:
    """DIFFERENT on purpose (最大でまとめる): the recorded bands' centres are the same; a band holding bins is its
    loudest bin, a band holding none is the one answer cell its centre lies in (the old path drew a level between
    its two neighbours there: a level of no cell). Every drawn level is one of the answer's own."""
    given = case["input"]
    levels = np.asarray(given["levels"], dtype=np.float64)  # columns × bins
    freqs = np.asarray(given["freqs"], dtype=np.float64)
    edges = np.geomspace(20.0, float(given["nyquist"]), int(given["points"]) + 1)
    got = _band_levels(levels.T, freqs, edges).T
    assert np.sqrt(edges[:-1] * edges[1:]).tolist() == pytest.approx(case["expected"]["centres"], rel=1e-12)
    recorded = np.asarray(case["expected"]["values"], dtype=np.float64)
    for band in range(edges.size - 1):
        top = freqs <= edges[band + 1] if band == edges.size - 2 else freqs < edges[band + 1]
        inside = (freqs >= edges[band]) & top
        if inside.any():
            assert got[:, band].tolist() == np.maximum(levels[:, inside].max(axis=1), FLOOR_DB).tolist()
        else:
            centre = float(np.sqrt(edges[band] * edges[band + 1]))
            row = int(np.searchsorted(cell_edges(freqs, True)[1:-1], centre, side="right"))
            assert got[:, band].tolist() == np.maximum(levels[:, row], FLOOR_DB).tolist()
            # Between the old path's two neighbours (it interpolated), never outside them.
            near = np.maximum(levels[:, max(row - 1, 0) : row + 2], FLOOR_DB)
            assert np.all(
                (recorded[:, band] >= near.min(axis=1) - 1e-9) & (recorded[:, band] <= near.max(axis=1) + 1e-9)
            )
    assert np.isin(got, np.maximum(levels, FLOOR_DB)).all()


def test_a_click_one_frame_long_in_half_an_hour_is_drawn_at_its_own_level() -> None:
    """Half an hour of quiet (−80 dB) with one frame at −6 dB in one row: at 400 px each drawn column pools about
    280 frames, and the click's column is drawn at −6 dB (a power mean would draw it near −30 dB)."""
    frames = 56_250  # 30 min at 31.25 frames a second
    xs = np.arange(frames) * (1800.0 / frames)
    ys = np.array([100.0, 200.0, 400.0, 800.0])
    values = np.full((ys.size, frames), -80.0)
    values[2, 31_417] = -6.0
    column_edges, _, cells = drawn_image(xs, ys, values, (0.0, 1800.0), (100.0, 800.0), WIDTH, HEIGHT).wire_points()
    assert len(cells[0]) == 200
    at = int(np.searchsorted(np.asarray(column_edges), xs[31_417], side="right")) - 1
    assert cells[2][at] == -6.0
    assert sorted({value for row in cells for value in row}) == [-80.0, -6.0]
    assert sum(value == -6.0 for row in cells for value in row) == 1


@pytest.mark.parametrize("size", [(WIDTH, HEIGHT), (120.0, 40.0), (37.0, 9.0)], ids=["roomy", "small", "tiny"])
def test_the_brightest_drawn_cell_is_the_answers_highest_level_on_screen(size: tuple[float, float]) -> None:
    """Whatever the frame's size, the brightest cell drawn is the highest level of the answer there (0.1 dB): what
    the colour range's top is rounded up from, so the colour band's top is always reached by a drawn cell's level."""
    answer = _answer()
    nothing = Ends(None, None)
    ranged = image_range(
        answer.xs, answer.ys, answer.values, answer.x_limits, answer.y_limits, nothing, nothing, nothing
    )
    _, _, cells = drawn_image(answer.xs, answer.ys, answer.values, ranged.x, ranged.y, *size).wire_points()
    positive = np.asarray(answer.ys) > 0
    highest = float(np.max(np.asarray(answer.values)[positive]))
    assert max(value for row in cells for value in row if value is not None) == round(highest, 1)
    assert ranged.colour[1] >= highest


@pytest.mark.parametrize("case", [case for case in _cases("view") if "detail" in case.values[0]["input"]])
def test_a_zoomed_picture_has_the_recorded_cells_and_colour_range(case: dict[str, Any]) -> None:
    answer = _answer(case["input"]["scene"])
    detail, expected = case["input"]["detail"], case["expected"]
    ranged = image_range(
        answer.xs,
        answer.ys,
        answer.values,
        answer.x_limits,
        answer.y_limits,
        Ends(*detail["x"]),
        Ends(*detail["y"]),
        Ends(None, None),
    )
    assert ranged.x == tuple(detail["x"]) and ranged.y == tuple(detail["y"])
    column_edges, row_edges, cells = drawn_image(
        answer.xs, answer.ys, answer.values, ranged.x, ranged.y, WIDTH, HEIGHT
    ).wire_points()
    rows, columns = expected["shape"]
    # DIFFERENT on purpose (the cells on screen): the old picture had the cells whose centre is inside the range, so
    # a cell the range's end cuts was left black, and yet read under the pointer. The new one draws every cell any
    # part of which is on screen: the recorded cells, and at most one more at each side, cut by the range's end.
    below = int(np.searchsorted(np.asarray(row_edges[1:]), expected["ys"][0]))
    left = int(np.searchsorted(np.asarray(column_edges[1:]), expected["xs"][0]))
    above, right = len(cells) - rows - below, len(cells[0]) - columns - left
    assert (below, above, left, right) == EDGE_CELLS[case["id"]]
    if below:
        assert row_edges[0] < ranged.y[0] < row_edges[1]
    if above:
        assert row_edges[-2] < ranged.y[1] < row_edges[-1]
    inner = [row[left : left + columns] for row in cells[below : below + rows]]
    assert (len(row_edges), len(column_edges)) == (len(cells) + 1, len(cells[0]) + 1)
    every = int(case["input"]["every"])
    assert [row[::every] for row in inner[::every]] == [pytest.approx(row, abs=1e-9) for row in expected["cells"]]
    # 配置: each recorded column and row is inside its cell's edges, which are the answer cells' own.
    for at, x in enumerate(expected["xs"]):
        assert column_edges[left + at] < x < column_edges[left + at + 1]
    for at, y in enumerate(expected["ys"]):
        assert row_edges[below + at] < y < row_edges[below + at + 1]
    first = int(np.searchsorted(answer.xs, expected["xs"][0])) - left
    assert column_edges == pytest.approx(cell_edges(answer.xs, False)[first : first + len(cells[0]) + 1].tolist())
    # The colour range is of the cells on screen: the recorded one where they are the recorded cells; with a cut
    # cell more, of those too (never of fewer cells than are drawn).
    recorded = colour_range(expected["valueRange"]["min"], expected["valueRange"]["max"])
    if (below, above, left, right) == (0, 0, 0, 0):
        assert ranged.colour == recorded
    else:
        row0 = int(np.searchsorted(answer.ys, expected["ys"][0])) - below
        on_screen = answer.values[row0 : row0 + len(cells), first : first + len(cells[0])]
        assert ranged.colour == colour_range(float(on_screen.min()), float(on_screen.max()))
        assert ranged.colour[0] <= recorded[0]


#: The cells a range's end cuts, each recorded zoom: (below, above, left, right). ``zoomed_narrow`` (950 to 1050 Hz)
#: cuts the rows at 937.5 Hz (up to 953 Hz) and 1062.5 Hz (from 1047 Hz).
EDGE_CELLS = {"zoomed": (0, 0, 0, 0), "zoomed_narrow": (1, 1, 0, 0)}


def test_the_whole_picture_keeps_the_columns_and_the_colour_range_and_every_row_it_has_room_for() -> None:
    """The one deviation of the drawn cells: the old whole picture's 128 log bands are not made. At 256 px the 128
    bins from 31.25 Hz are drawn as they are; at 100 px, 50 log bands."""
    answer, expected = _answer(), next(case for case in TABLE["view"] if case["id"] == "whole")["expected"]
    nothing = Ends(None, None)
    ranged = image_range(
        answer.xs, answer.ys, answer.values, answer.x_limits, answer.y_limits, nothing, nothing, nothing
    )
    assert ranged.y == tuple(expected["yLimits"])
    assert ranged.colour == colour_range(expected["valueRange"]["min"], expected["valueRange"]["max"])
    column_edges, row_edges, cells = drawn_image(
        answer.xs, answer.ys, answer.values, ranged.x, ranged.y, WIDTH, 256.0
    ).wire_points()
    assert len(cells[0]) == expected["shape"][1] == 200 and len(cells) == 128
    for at, x in enumerate(expected["xs"]):
        assert column_edges[at] < x < column_edges[at + 1]
    _, band_edges, bands = drawn_image(
        answer.xs, answer.ys, answer.values, ranged.x, ranged.y, WIDTH, 100.0
    ).wire_points()
    assert len(bands) == 50 and band_edges[-1] == pytest.approx(4000.0)
    assert band_edges[0] == pytest.approx(max(20.0, row_edges[0]))


@pytest.mark.parametrize("case", _cases("colour_range"))
def test_the_colour_range_is_the_recorded_one(case: dict[str, Any]) -> None:
    low, high = colour_range(float(case["input"]["low"]), float(case["input"]["high"]))
    assert {"min": low, "max": high} == case["expected"]


@pytest.mark.parametrize("case", [case for case in _cases("cell_index") if case.values[0]["input"]["open"]["low"]])
def test_the_cell_a_place_is_in_is_the_recorded_one(case: dict[str, Any]) -> None:
    given = case["input"]
    axis = np.asarray(given["axis"], dtype=np.float64)
    assert [cell_index(axis, float(value), bool(given["log"])) for value in given["values"]] == case["expected"][
        "cells"
    ]
    assert cell_edges(axis, bool(given["log"])).tolist() == pytest.approx(case["expected"]["edges"], rel=1e-12)


@pytest.mark.parametrize("case", _cases("read_cells"))
def test_a_pointer_reads_one_answer_cell_of_those_the_old_read_sent(case: dict[str, Any]) -> None:
    given, expected = case["input"], case["expected"]
    xs, ys = np.asarray(given["xs"], dtype=np.float64), np.asarray(given["ys"], dtype=np.float64)
    matrix = np.asarray(given["matrix"], dtype=np.float64)
    x, y = float(given["read"]["x"][0]), float(given["read"]["y"][0])
    got = pick_cell(xs, ys, matrix, CellPointerAsk(x, y), (0.0, 1.0), (1.0, 1000.0), True)
    inside = cell_edges(xs, False)[0] <= x <= cell_edges(xs, False)[-1] and cell_edges(ys, True)[0] <= y
    if not inside:
        # The old read took a place past the data's end as the end cell; the new one says it is outside.
        assert got.status == "outside"
        return
    assert got.cell is not None
    assert got.cell.x in expected["xs"] and got.cell.y in expected["ys"]
    at = expected["ys"].index(got.cell.y), expected["xs"].index(got.cell.x)
    assert got.cell.value == expected["matrix"][at[0]][at[1]]
    # The cell whose edges hold the place: an edge is the lower cell's (fullRead.ts cellIndex).
    assert got.cell.column == cell_index(xs, x, False) and got.cell.row == cell_index(ys, y, True)


def test_half_way_between_two_rows_of_a_log_axis_is_the_higher_row() -> None:
    """250 Hz between rows at 200 and 300 Hz: they meet at 244.9 Hz (their geometric mean), so 250 is the 300 Hz
    row's; half way between two columns (a linear axis) is the lower column's."""
    case = next(case for case in TABLE["read_cells"] if case["id"] == "between_columns")["input"]
    xs, ys = np.asarray(case["xs"], dtype=np.float64), np.asarray(case["ys"], dtype=np.float64)
    got = pick_cell(xs, ys, np.asarray(case["matrix"]), CellPointerAsk(0.25, 250.0), (0.0, 1.0), (1.0, 1000.0), True)
    assert got.cell is not None and (got.cell.x, got.cell.y) == (0.2, 300.0)


def test_the_real_frames_cell_is_read_unrounded_and_stepped_from() -> None:
    case = TABLE["real_read"][0]
    expected = case["expected"]
    answer = _answer(case["input"]["scene"])
    ranges = ((0.0, 2.0), (20.0, 4000.0))
    got = pick_cell(answer.xs, answer.ys, answer.values, CellPointerAsk(1.0, 1000.0), *ranges, True)
    assert got.cell is not None
    assert (got.cell.x, got.cell.y) == (expected["xs"][1], expected["ys"][1])
    assert got.cell.value == pytest.approx(expected["matrix"][1][1], abs=1e-12)
    assert got.cell.x_step == pytest.approx(0.004) and got.cell.y_step == pytest.approx(31.25)
    for columns, rows in ((-1, 0), (1, 0), (0, -1), (0, 1), (1, 1)):
        step = CellStepAsk(got.cell.column, got.cell.row, columns, rows)
        moved = pick_cell(answer.xs, answer.ys, answer.values, step, *ranges, True)
        assert moved.cell is not None
        assert moved.cell.value == pytest.approx(expected["matrix"][1 + rows][1 + columns], abs=1e-12)
    named = pick_cell(answer.xs, answer.ys, answer.values, CellNameAsk(got.cell.x, got.cell.y), *ranges, True)
    assert named.cell == got.cell
    other = pick_cell(answer.xs, answer.ys, answer.values, CellNameAsk(1.0001, 1000.0), *ranges, True)
    assert other.status == "no-point"
    # A step past the confirmed range is outside, never the nearest cell inside.
    narrow = ((0.9, 1.0), (500.0, 1000.0))
    for columns, rows in ((1, 0), (0, 1)):
        step = CellStepAsk(got.cell.column, got.cell.row, columns, rows)
        assert pick_cell(answer.xs, answer.ys, answer.values, step, *narrow, True).status == "outside"


# --- Through the protocol: draw, read and count of an image lane -----------------------------------------------------


def _ask(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = validate_request({"cmd": command, "requestId": "r", **payload})
    result = dict(dispatch(request, None))  # type: ignore[arg-type]
    assert result_violation(command, result) is None, (command, result_violation(command, result))
    return result


def _spec(key: str) -> dict[str, Any]:
    return {
        "lanes": [{"id": "image", "kind": "image", "lines": [{"id": "sound", "of": {"key": key}}]}],
        "keys": [{"key": key, "state": "usable", "version": key}],
    }


def _keep(key: str) -> ImageAnswer:
    frame, seconds = scene_frame(TABLE["scenes"]["tones"])
    data = stage_data(frame, dict(sv.stage_view(frame, seconds)), seconds)
    assert data is not None
    STORE.put(key, data)
    answer = image_answer_of(key, data)
    assert answer is not None
    return answer


def _draw(key: str, figure: str, view: dict[str, Any] | None = None, generation: int = 0) -> dict[str, Any]:
    return _ask(
        "figure-draw",
        {
            "figureId": figure,
            "generation": generation,
            "requestNumber": generation,
            "spec": _spec(key),
            "width": WIDTH,
            "height": 256,
            "laneHeights": [{"lane": "image", "height": 256}],
            "view": view,
            "selection": None,
        },
    )


def test_an_image_lane_is_drawn_read_and_counted_through_the_protocol() -> None:
    answer = _keep("heat-1")
    picture = _draw("heat-1", "heat-fig")
    assert picture["status"] == "picture"
    (lane,) = picture["lanes"]
    assert lane["kind"] == "image" and lane["lines"] == []
    assert lane["axis"]["quantity"] == "level" and lane["axis"]["yScale"] == "log"
    assert lane["range"]["y"] == [20.0, 4000.0] and lane["range"] == lane["whole"]
    assert lane["range"]["x"] == [float(answer.xs[0]), float(answer.xs[-1])]
    low, high = lane["range"]["colour"]
    assert high - low <= 100 and high >= float(answer.values.max())
    image = lane["image"]
    assert image["key"] == "heat-1" and image["line"] == "sound"
    assert len(image["cells"]) == len(image["rowEdges"]) - 1 == 128
    assert len(image["cells"][0]) == len(image["columnEdges"]) - 1 == 200
    assert picture["members"]["shown"]["n"] == 1

    read = _ask(
        "figure-read",
        {
            "figureId": "heat-fig",
            "pictureId": picture["pictureId"],
            "requestNumber": 1,
            "pointer": {"lane": "image", "x": 1.0, "y": 1000.0, "scale": [1, 1]},
        },
    )
    assert read["status"] == "point" and read["line"] == "sound"
    point = read["point"]
    column, row = int(np.flatnonzero(answer.xs == 1.0)[0]), int(np.flatnonzero(answer.ys == 1000.0)[0])
    assert (point["index"], point["row"], point["x"], point["y"]) == (column, row, 1.0, 1000.0)
    assert point["value"] == float(answer.values[row, column]) and point["key"] == "heat-1"
    assert point["xStep"] == pytest.approx(0.004) and point["yStep"] == pytest.approx(31.25)

    step = {"lane": "image", "line": "sound", "key": "heat-1", "version": read["version"]}
    moved = _ask(
        "figure-read",
        {
            "figureId": "heat-fig",
            "pictureId": picture["pictureId"],
            "requestNumber": 2,
            "dataId": picture["dataId"],
            "generation": 0,
            "step": {**step, "index": column, "row": row, "steps": 0, "rows": 1},
        },
    )
    assert moved["point"]["value"] == float(answer.values[row + 1, column])
    stale = _ask(
        "figure-read",
        {
            "figureId": "heat-fig",
            "pictureId": picture["pictureId"],
            "requestNumber": 3,
            "dataId": "another",
            "generation": 0,
            "step": {**step, "index": column, "row": row, "steps": 1, "rows": 0},
        },
    )
    assert stale["status"] == "no-point"
    off = _ask(
        "figure-read",
        {
            "figureId": "heat-fig",
            "pictureId": picture["pictureId"],
            "requestNumber": 4,
            "pointer": {"lane": "image", "x": 1.0, "y": 5000.0, "scale": [1, 1]},
        },
    )
    assert off["status"] == "outside"

    # Zoomed: the same answer cell is read (never a drawn one), the colour range is of the cells on screen, and the
    # selected cell is named again after the redraw.
    view = {"x": [0.9, 1.1], "lanes": [{"lane": "image", "y": [500, 2000], "colour": [None, None]}]}
    zoomed = _draw("heat-1", "heat-fig", view, generation=1)
    assert zoomed["dataId"] != picture["dataId"]
    (lane,) = zoomed["lanes"]
    assert lane["range"]["x"] == [0.9, 1.1] and lane["range"]["y"] == [500.0, 2000.0]
    assert lane["whole"]["y"] == [20.0, 4000.0]
    assert (len(lane["image"]["cells"]), len(lane["image"]["cells"][0])) == (49, 51)
    again = _ask(
        "figure-read",
        {
            "figureId": "heat-fig",
            "pictureId": zoomed["pictureId"],
            "requestNumber": 5,
            "name": {"line": "sound", "key": "heat-1", "x": 1.0, "y": 1000.0},
        },
    )
    assert again["point"]["value"] == point["value"]
    typed = {"x": [0.9, 1.1], "lanes": [{"lane": "image", "y": [500, 2000], "colour": [-80, -20]}]}
    assert _draw("heat-1", "heat-fig", typed, generation=2)["lanes"][0]["range"]["colour"] == [-80.0, -20.0]

    count = _ask("figure-count", {"spec": _spec("heat-1")})
    assert count["members"]["shown"]["n"] == 1
    _ask("figure-release", {"figureId": "heat-fig"})


def test_an_image_lane_whose_recording_is_no_longer_kept_draws_nothing_and_says_why() -> None:
    picture = _draw("heat-gone", "heat-fig-2")
    assert picture["status"] == "picture"
    (lane,) = picture["lanes"]
    assert "image" not in lane and "range" not in lane
    assert picture["members"]["shown"]["excluded"] == [{"key": "heat-gone", "reason": "evicted"}]
    _ask("figure-release", {"figureId": "heat-fig-2"})


def test_a_spec_whose_image_lane_is_not_one_recording_is_refused() -> None:
    spec = _spec("heat-1")
    spec["lanes"][0]["lines"].append({"id": "more", "of": {"key": "heat-1"}})
    with pytest.raises(Exception, match="one recording's image"):
        _ask(
            "figure-draw",
            {"figureId": "x", "generation": 0, "requestNumber": 0, "spec": spec, "width": 10, "height": 10},
        )


def test_a_zoom_between_two_cells_centres_draws_the_cells_it_reads() -> None:
    """The cells on screen are one rule for the picture, the pointer and the colour range (thinning.cells_on_screen).
    A range between two columns' centres (4 ms apart) and inside one row holds no cell's centre: the two columns it
    cuts and the row are drawn, and the pointer anywhere in it reads one of the cells drawn (the old rule drew none
    and read one all the same)."""
    answer = _keep("heat-cut")
    column = int(np.flatnonzero(answer.xs == 1.0)[0])
    row = int(np.flatnonzero(answer.ys == 1000.0)[0])
    view = {"x": [1.0005, 1.0035], "lanes": [{"lane": "image", "y": [995.0, 1005.0]}]}
    picture = _draw("heat-cut", "heat-cut-fig", view=view, generation=1)
    (lane,) = picture["lanes"]
    image = lane["image"]
    assert (len(image["cells"]), len(image["cells"][0])) == (1, 2)
    assert image["columnEdges"] == pytest.approx([0.998, 1.002, 1.006])
    cut = [float(answer.values[row, column]), float(answer.values[row, column + 1])]
    assert image["cells"][0] == pytest.approx(cut, abs=0.051)
    shown = answer.values[row, column : column + 2]
    assert lane["range"]["colour"] == list(colour_range(float(shown.min()), float(shown.max())))
    for number, (x, expected) in enumerate([(1.001, column), (1.003, column + 1)]):
        read = _ask(
            "figure-read",
            {
                "figureId": "heat-cut-fig",
                "pictureId": picture["pictureId"],
                "requestNumber": 1 + number,
                "pointer": {"lane": "image", "x": x, "y": 1000.0, "scale": [1, 1]},
            },
        )
        assert read["status"] == "point" and (read["point"]["index"], read["point"]["row"]) == (expected, row)
        assert image["columnEdges"][expected - column] <= x <= image["columnEdges"][expected - column + 1]


def test_a_row_the_range_cuts_is_in_a_band_where_the_rows_are_drawn_as_bands() -> None:
    """Rows at 100, 200, 300 and 400 Hz over 120 to 400 Hz with room for two bands: the 100 Hz row is on screen up
    to 141 Hz (read there, and in the colour range), so it is in the first band drawn, not left out for its centre
    being under the range's low end."""
    ys = np.array([100.0, 200.0, 300.0, 400.0])
    xs = np.array([0.0, 1.0])
    values = np.array([[0.0, 0.0], [-60.0, -60.0], [-60.0, -60.0], [-60.0, -60.0]])
    _, row_edges, cells = drawn_image(xs, ys, values, (0.0, 1.0), (120.0, 400.0), 4, 4).wire_points()
    assert len(cells) == 2 and row_edges[0] == pytest.approx(100.0)
    # The loud row is the first band's level (the loudest of 0 dB and −60 dB), and not in the second.
    assert cells[0][0] == 0.0 and cells[1][0] == -60.0
