"""The images that are not a spectrogram on the NEW path: a roughness (values over Bark bands) and a
cepstrogram (signed coefficients over quefrency) as image lanes of the figure service, and the images of one figure
looked at together (their lanes show the same part and share a colour range).

The recorded cases of tests/fixtures/figure_bench_cases.json (the old path's answers, test_figure_bench_cases.py) are
replayed where the new path answers the same: the extent a colour range is decided from (``valueRange``: lowest,
highest, a cepstrogram's 99th percentile of magnitudes) of the whole picture and of a zoomed part, and the answer
cell read under the pointer.

What is not the same, on purpose (熱図は最大でまとめる): the drawn cells. The old
path drew a roughness by the mean of each block and a cepstrogram by the mean over time; the new path draws the
highest value of a block (a roughness) and the value of largest magnitude with its sign (a cepstrogram), so a drawn
cell is one of its answer cells' own values. Drawn cells are never read nor ranged over: the answers above are the
same.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from figures.answers import AnyAnswer, ImageAnswer
from figures.pick import CellPointerAsk, pick_cell
from figures.ranges import Ends, image_axes, image_colour, image_extent, nice_range
from figures.service import FigureService
from figures.thinning import _farthest, _highest, cell_edges, drawn_image
from test_figure_bench_cases import RECORDED_REL, _data
from transport.figure_answers import CombineOps, image_answer_of
from transport.protocol_schema import result_violation

TABLE = json.loads((Path(__file__).parent / "tests" / "fixtures" / "figure_bench_cases.json").read_text("utf-8"))
IMAGE_STEPS = ("cepstrogram", "roughness")


class _Source:
    def __init__(self, answers: Mapping[str, AnyAnswer]) -> None:
        self._answers = answers

    def answer(self, key: str) -> AnyAnswer | None:
        return self._answers.get(key)


def _answer(step: str, name: str) -> ImageAnswer:
    data = _data(TABLE["scenes"], {"scene": "group", "step": step}, name)
    assert data is not None
    answer = image_answer_of(f"{step}-{name}", data)
    assert answer is not None
    return answer


def _cases(section: str) -> list[Any]:
    return [pytest.param(case, id=case["id"]) for case in TABLE[section] if case["input"]["step"] in IMAGE_STEPS]


# --- The recorded answers, replayed -----------------------------------------------------------------------------------


@pytest.mark.parametrize("case", _cases("view"))
def test_the_extent_a_colour_range_is_decided_from_is_the_recorded_one(case: dict[str, Any]) -> None:
    given, expected = case["input"], case["expected"]["valueRange"]
    answer = _answer(given["step"], given["recording"])
    detail = given.get("detail") or {}
    x, y = image_axes(
        answer.x_limits,
        answer.y_limits,
        Ends(*detail["x"]) if "x" in detail else Ends(None, None),
        Ends(*detail["y"]) if "y" in detail else Ends(None, None),
        answer.y_log,
    )
    extent = image_extent(
        answer.xs,
        answer.ys,
        answer.values,
        x,
        y,
        quantity=answer.quantity,
        log=answer.y_log,
        positive=answer.y_positive,
    )
    assert extent is not None
    assert (extent.low, extent.high) == pytest.approx((expected["min"], expected["max"]), rel=RECORDED_REL, abs=1e-15)
    if "robust" in expected:
        assert extent.robust == pytest.approx(expected["robust"], rel=RECORDED_REL)
    else:
        assert extent.robust is None


@pytest.mark.parametrize("case", [case for case in _cases("read") if "of" not in case.values[0]["input"]["read"]])
def test_the_cell_under_the_pointer_is_the_recorded_answer_cell(case: dict[str, Any]) -> None:
    given, expected = case["input"], case["expected"]
    answer = _answer(given["step"], given["base"][0])
    x, y = given["read"]["x"][0], given["read"]["y"][0]
    got = pick_cell(
        answer.xs,
        answer.ys,
        answer.values,
        CellPointerAsk(x, y),
        answer.x_limits,
        answer.y_limits,
        answer.y_log,
        answer.y_positive,
    )
    assert got.status == "point" and got.cell is not None
    # The old read sent the cells around the pointer (two each way); the new one answers the one cell in the middle.
    middle = len(expected["xs"]) // 2
    assert (got.cell.x, got.cell.y) == pytest.approx((expected["xs"][middle], expected["ys"][middle]), rel=1e-12)
    assert got.cell.value == pytest.approx(expected["matrix"][middle][middle], rel=RECORDED_REL)


# --- The rules -------------------------------------------------------------------------------------------------------


def test_signed_cells_are_pooled_by_the_value_of_largest_magnitude_with_its_sign() -> None:
    nan = float("nan")
    values = np.array([[1.0, -5.0, 3.0], [2.0, -2.0, nan], [nan, nan, nan], [-0.5, 0.25, 0.0]])
    assert _farthest(values, axis=1).tolist()[:2] == [-5.0, 2.0]
    assert np.isnan(_farthest(values, axis=1)[2]) and _farthest(values, axis=1)[3] == -0.5
    assert _highest(values, axis=1).tolist()[:2] == [3.0, 2.0] and np.isnan(_highest(values, axis=1)[2])


def test_rows_on_a_linear_axis_are_pooled_in_blocks_of_neighbouring_rows_with_their_own_edges() -> None:
    """Eight rows a quarter apart and four columns in a frame with room for two columns and four rows: each drawn
    cell is the value of largest magnitude of its two rows × two columns (its sign kept), and the drawn rows' edges
    are the answer rows' own."""
    ys = 0.25 * np.arange(1, 9)
    xs = np.arange(4.0)
    values = np.zeros((8, 4))
    values[0, 0], values[1, 1] = 0.5, -2.0  # one drawn cell: −2 is farther from 0 than 0.5
    values[6, 3], values[7, 2] = 1.5, -1.0
    column_edges, row_edges, cells = drawn_image(
        xs, ys, values, (0.0, 3.0), (0.25, 2.0), 4, 8, log=False, positive=False, pooling="signed"
    ).wire_points()
    assert column_edges == [-0.5, 1.5, 3.5]
    assert row_edges == [float(edge) for edge in cell_edges(ys, False)[::2]]
    assert cells == [[-2.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 1.5]]
    # With room for every row, each is drawn as it is.
    _, own, every = drawn_image(
        xs, ys, values, (0.0, 3.0), (0.25, 2.0), 8, 64, log=False, positive=False, pooling="signed"
    ).wire_points()
    assert own == cell_edges(ys, False).tolist() and every == values.tolist()


def test_a_colour_range_is_decided_by_what_the_cells_measure() -> None:
    nothing = Ends(None, None)
    from figures.ranges import ImageExtent

    # Signed coefficients: symmetric, to the largest 99th percentile of the images together, at a round end.
    signed = image_colour("cepstrum", [ImageExtent(-0.6, 3.1, 0.69), ImageExtent(-0.2, 0.4, 0.21), None], nothing)
    assert signed == (-nice_range(-0.69, 0.69)[1], nice_range(-0.69, 0.69)[1]) and signed[0] == -signed[1]
    # Any other value: the extent of the images together, padded by a twentieth, at round ends.
    plain = image_colour("roughness", [ImageExtent(0.0, 0.84), ImageExtent(0.1, 0.5)], nothing)
    assert plain == nice_range(-0.042, 0.882)
    # Nothing to range over: a range all the same; a specified end is the request's own.
    assert image_colour("cepstrum", [None], nothing) == (-1.0, 1.0)
    assert image_colour("roughness", [None], nothing) == (0.0, 1.0)
    assert image_colour("roughness", [ImageExtent(0.0, 0.84)], Ends(0.0, 0.5)) == (0.0, 0.5)


# --- Through the service: lanes of images looked at together ------------------------------------------------------


def _spec(keys: list[str], versions: Mapping[str, str]) -> dict[str, Any]:
    # As the screen declares them: the base's image first (a line of its key: no median is taken of images), then
    # the compared recordings'.
    roles = ["base", *(f"compare{at}" for at in range(1, len(keys)))]
    return {
        "lanes": [
            {"id": f"lane-{key}", "kind": "image", "lines": [{"id": f"line-{key}", "of": {"key": key}, "role": role}]}
            for key, role in zip(keys, roles, strict=True)
        ],
        "keys": [{"key": key, "state": "usable", "version": versions[key]} for key in keys],
    }


def _draw(answers: Mapping[str, ImageAnswer], view: dict[str, Any] | None = None) -> tuple[FigureService, Any]:
    service = FigureService(_Source(answers), CombineOps())
    request = {"figureId": "f", "generation": 1, "requestNumber": 1, "width": 400, "height": 96 * len(answers)}
    versions = {key: answer.version for key, answer in answers.items()}
    picture = service.draw({**request, "spec": _spec(list(answers), versions), "view": view})
    assert picture["status"] == "picture"
    assert result_violation("figure-draw", picture) is None, result_violation("figure-draw", picture)
    return service, picture


def test_two_cepstrograms_are_lanes_of_one_figure_with_the_same_ranges() -> None:
    base, compare = _answer("cepstrogram", "base1"), _answer("cepstrogram", "compare")
    service, picture = _draw({"base": base, "compare": compare})
    first, second = picture["lanes"]
    for lane in (first, second):
        assert lane["kind"] == "image"
        axis = lane["axis"]
        assert (axis["quantity"], axis["of"], axis["y"], axis["yScale"]) == ("value", "cepstrum", "quefrency", "linear")
    assert first["range"] == second["range"] == first["whole"]
    # Up: the rows above 0, each cell whole. The colour: ± the largest 99th percentile of the two, at a round end.
    placed = base.ys[base.ys > 0]
    assert first["range"]["y"] == pytest.approx([placed[0] - 0.0000625, placed[-1] + 0.0000625])
    robust = max(float(np.quantile(np.abs(a.values[a.ys > 0]), 0.99, method="lower")) for a in (base, compare))
    top = nice_range(-robust, robust)[1]
    assert first["range"]["colour"] == [-top, top]
    # 96 px a lane: 48 drawn rows of the 255 placed, each the coefficient of largest magnitude there, its sign kept.
    image = first["image"]
    assert len(image["cells"]) == 48 and len(image["cells"][0]) == 200
    drawn = np.asarray(image["cells"], dtype=np.float64)
    assert drawn.min() < 0 < drawn.max()
    on = base.values[base.ys > 0]
    assert float(np.abs(drawn).max()) == pytest.approx(float(np.abs(on).max()), abs=1e-6)

    # A read answers the recording's own cell, unrounded.
    read = service.read(
        {
            "figureId": "f",
            "pictureId": picture["pictureId"],
            "requestNumber": 2,
            "pointer": {"lane": "lane-compare", "x": 1.008, "y": 0.012, "scale": [1, 1]},
        }
    )
    assert read["status"] == "point" and read["line"] == "line-compare"
    column, row = int(np.argmin(np.abs(compare.xs - 1.008))), int(np.argmin(np.abs(compare.ys - 0.012)))
    assert (read["point"]["index"], read["point"]["row"]) == (column, row)
    assert read["point"]["value"] == float(compare.values[row, column])


def test_two_roughness_images_share_their_colour_range_and_a_zoom_ranges_the_part_on_screen() -> None:
    base, compare = _answer("roughness", "base1"), _answer("roughness", "compare")
    _, picture = _draw({"base": base, "compare": compare})
    first, second = picture["lanes"]
    axis = first["axis"]
    assert (axis["quantity"], axis["of"], axis["valueUnit"], axis["y"], axis["yScale"]) == (
        "value",
        "roughness",
        "asper/Bark",
        "bark",
        "linear",
    )
    assert first["range"] == second["range"]
    assert first["range"]["y"] == [0.25, 23.75]
    low = min(float(a.values.min()) for a in (base, compare))
    high = max(float(a.values.max()) for a in (base, compare))
    pad = (high - low) * 0.05
    assert first["range"]["colour"] == list(nice_range(low - pad, high + pad))
    # Every row has room (47 rows in 96 px would not: 48 are allowed), so the brightest drawn cell is the answer's.
    for lane, answer in ((first, base), (second, compare)):
        cells = np.asarray(lane["image"]["cells"], dtype=np.float64)
        assert cells.shape == answer.values.shape
        assert float(cells.max()) == round(float(answer.values.max()), 6)

    # Zoomed (the recorded zoom): the same part in both lanes; the colour range is of the cells on screen there.
    lanes = [{"lane": f"lane-{key}", "y": [6.25, 12.0]} for key in ("base", "compare")]
    _, zoomed = _draw({"base": base, "compare": compare}, {"x": [0.6, 1.2], "lanes": lanes})
    one, other = zoomed["lanes"]
    assert one["range"] == other["range"] and one["range"]["x"] == [0.6, 1.2] and one["range"]["y"] == [6.25, 12.0]
    assert one["whole"] == first["range"]
    assert np.asarray(one["image"]["cells"]).shape == (12, 7)


def _level_image(key: str, seconds: float, top: float, label: str = "dBFS") -> ImageAnswer:
    xs = np.arange(0.0, seconds, 0.1)
    ys = np.array([0.0, 100.0, 200.0, 400.0, 800.0])
    values = np.full((ys.size, xs.size), top - 40.0)
    values[2, 1] = top
    return ImageAnswer(
        key=key,
        version=key,
        xs=xs,
        ys=ys,
        values=values,
        identity=("FS", 1.0, label),
        axis="spectrogram",
        quantity="level",
        x_limits=(float(xs[0]), float(xs[-1])),
        y_limits=(20.0, 1000.0),
        nbytes=int(values.nbytes),
    )


def test_images_of_one_figure_show_the_same_part_and_share_a_colour_range() -> None:
    """A short quiet recording, a long loud one and one against another reference: the two in dBFS are over the
    longer's time and share one colour range (the loud one's top, so the quiet one reads darker); the third is not
    drawn, and counted left out with why (仕様 2: a level against another reference is never laid on that scale)."""
    answers = {
        "quiet": _level_image("quiet", 1.0, -30.0),
        "loud": _level_image("loud", 2.0, -6.0),
        "other": _level_image("other", 1.5, 74.0, "dB SPL"),
    }
    _, picture = _draw(answers)
    quiet, loud, other = picture["lanes"]
    assert quiet["range"]["x"] == loud["range"]["x"] == pytest.approx([0.0, 1.9])
    assert quiet["range"]["y"] == loud["range"]["y"] == [20.0, 1000.0]
    assert quiet["range"]["colour"] == loud["range"]["colour"] == [-70.0, -5.0]
    assert "image" not in other and other["lines"] == []
    assert picture["members"]["shown"]["excluded"] == [{"key": "other", "reason": "other-reference"}]
    # The short recording's cells end where its answer does: nothing is drawn past it.
    assert quiet["image"]["columnEdges"][-1] == pytest.approx(0.95)
