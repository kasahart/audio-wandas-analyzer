"""The picture (絵) of one draw request, assembled: no arithmetic, only putting results in their places.

This is the only file that receives a ``Drawn`` (rule B): it asks figures/thinning.py for each line's drawn points
(計算ウ) and writes them out with ``Drawn.wire_points``. Everything else it is given is already decided: the lanes'
axes and confirmed ranges (計算イ), the headline (計算オ), the sets and counts (計算ア), the ids.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from figures.answers import Answer, ImageAnswer, LevelIdentity, SignalAnswer, Values
from figures.headline import Headline
from figures.members import Excluded, Members, MemberSet
from figures.ranges import ConfirmedRange, ImageRange
from figures.thinning import Drawn, dot_places, drawn_band, drawn_bars, drawn_image, drawn_line


@dataclass(frozen=True)
class LinePlan:
    """One line drawn, in declared order: its answer (layer 1's result) and what it is."""

    id: str
    role: str | None
    #: The recording a line of one key is of (None for a median or a Δ).
    key: str | None
    xs: Values
    values: Values
    silent_floor: bool


@dataclass(frozen=True)
class LanePlan:
    id: str
    #: "delta" for a Δ lane; else "level" for lines in dB (a level, a gain), "value" for lines of plain numbers.
    quantity: Literal["level", "delta", "value"]
    identity: LevelIdentity | None
    x_scale: Literal["log", "linear"]
    range: ConfirmedRange | None
    lines: tuple[LinePlan, ...]
    #: 目安の線 (guide lines): (axis, place) of lines drawn at a place of one axis and never read (a trigger's firing
    #: times and threshold). The spectrum overlay has none.
    guides: tuple[tuple[Literal["x", "y"], float], ...] = ()
    #: The confirmed range with nothing specified (the whole axes of these answers): what the Figure takes a range
    #: typed or a zoom as a part of. Always this picture's own, so a picture of new answers never keeps an old one.
    whole: ConfirmedRange | None = None
    #: The answer the lane's axes are named of (the compared recording's, 計算ア's target): what is across, what the
    #: values measure, their unit, measure and pair go into the picture as it says them. None: nothing to draw.
    named: Answer | None = None


@dataclass(frozen=True)
class ImagePlan:
    """An image lane (a spectrogram): the one recording's answer it draws, and its confirmed ranges."""

    id: str
    line: str
    role: str | None
    key: str
    answer: ImageAnswer
    range: ImageRange
    #: The confirmed range with nothing specified (the whole axes and the whole image's colour range).
    whole: ImageRange


@dataclass(frozen=True)
class BandLine:
    """One recording's time signal on a band lane, in declared order."""

    id: str
    role: str | None
    #: The recording it is of; None for a Δ (``answer`` is then the Δ's own samples, compare − base).
    key: str | None
    answer: SignalAnswer


@dataclass(frozen=True)
class Guide:
    """One guide line (目安の線): at a place of one axis, drawn and never read. ``id`` names it for the screen (a
    trigger's level: ``threshold``; an event's firing: ``event:<number>``); ``out``: its event is left out."""

    axis: Literal["x", "y"]
    at: float
    id: str
    out: bool = False


@dataclass(frozen=True)
class BandPlan:
    """A band lane (time signals): its recordings' signals and its confirmed ranges (across: time; up: the value)."""

    id: str
    lines: tuple[BandLine, ...]
    range: ConfirmedRange
    #: The confirmed range with nothing specified (the signals' whole length and their largest magnitude).
    whole: ConfirmedRange
    #: A Δ lane (its lines are differences of two recordings' signals).
    delta: bool = False
    #: 目安の線 of a lane that shows a recording as a trigger takes it: the level it fires at, each event's firing
    #: time (its number; whether the user left it out) and the stretch each event used was cut over.
    guides: tuple[Guide, ...] = ()
    spans: tuple[tuple[float, float], ...] = ()
    #: How many of the trigger's events are used, of how many (None: the lane declares no trigger).
    events: tuple[int, int] | None = None
    #: Why no events' answer is held (its key's state, or ``evicted``); None: one is, and ``events`` counts it.
    events_missing: str | None = None


@dataclass(frozen=True)
class BinsMark:
    """A row holding a role on a bins lane: a line at its value, read as that row."""

    id: str
    role: str | None
    key: str
    value: float


@dataclass(frozen=True)
class BinsPlan:
    """A bins lane (one group of a distribution): the rows it shows (計算ア), their placement (配置: the bins'
    edges, the dots' levels), the counts (計算ア) and its confirmed ranges (計算イ: across the value axis, up
    the count axis). Nothing of it is thinned: a bar is a count, a row one point."""

    id: str
    #: The column's key, and the ids its bars and its rows are read by.
    column: str
    bars: str
    rows: str
    #: The bins' edges over the whole value axis (one more than there are bins), and how wide a bin is.
    edges: Values
    step: float
    #: The rows shown, by value then key, with their values; and how many rows of the group have no number.
    keys: tuple[str, ...]
    values: Values
    blank: int
    #: Rows per bin (None: so few rows that each is drawn as a dot), and of them those a selected range takes
    #: (None: no range is selected).
    counts: Values | None
    counts_picked: Values | None
    #: Per row: whether the selected range takes it (None: no range is selected).
    picked: Values | None
    #: Per row drawn as a dot: the level it is stacked on.
    levels: Values | None
    marks: tuple[BinsMark, ...]
    range: ConfirmedRange
    whole: ConfirmedRange


#: A lane as planned: of lines, an image, a band, or bins. A lane with nothing to draw is a LanePlan with no
#: range.
AnyPlan = LanePlan | ImagePlan | BandPlan | BinsPlan


def member_set(found: MemberSet) -> dict[str, Any]:
    return {"used": list(found.used), "n": found.n, "excluded": excluded(found.excluded)}


def excluded(items: Sequence[Excluded]) -> list[dict[str, str]]:
    return [{"key": item.key, "reason": item.reason} for item in items]


def members_json(found: Members) -> dict[str, Any]:
    """The sets and counts as the picture, the export and the count request carry them (one shape)."""
    return {
        "shown": member_set(found.shown),
        "combined": member_set(found.combined),
        "calibration": found.calibration,
        "lines": [
            {
                "line": line.line,
                "drawn": line.drawn,
                "used": list(line.used),
                "excluded": excluded(line.excluded),
                **({"calibration": line.calibration} if line.calibration is not None else {}),
            }
            for line in found.lines.values()
        ],
    }


def axis_json(lane: LanePlan, calibration: str) -> dict[str, Any]:
    """A line lane's axes: what layer 3 names them of (第 4 節: the words are the Figure's, what they name is the
    picture's). ``x`` and ``of`` say what is across and what the values measure (of a Δ lane: what the Δ is of)."""
    unit, reference, label = lane.identity if lane.identity is not None else ("", 1.0, "")
    named = lane.named
    return {
        "quantity": lane.quantity,
        "unit": unit,
        "reference": reference,
        "referenceLabel": label,
        "calibration": calibration,
        "xScale": lane.x_scale,
        "yScale": "linear",
        **(
            {
                "x": named.x_kind,
                "of": named.quantity,
                **({"valueUnit": named.unit} if named.unit is not None else {}),
                **({"measure": named.measure} if named.measure is not None else {}),
                **({"measureExponent": named.measure_exponent} if named.measure_exponent is not None else {}),
                **({"pair": dict(named.pair)} if named.pair is not None else {}),
            }
            if named is not None
            else {}
        ),
    }


def headline_json(lane: str, headline: Headline) -> dict[str, Any]:
    return {
        "lane": lane,
        "line": headline.line,
        "index": headline.index,
        "x": headline.x,
        **({"xStep": headline.x_step} if headline.x_step is not None else {}),
        "value": headline.value,
    }


def _ends_json(ends: tuple[float, float]) -> list[float]:
    return [float(ends[0]), float(ends[1])]


def image_axis_json(lane: ImagePlan, calibration: str) -> dict[str, Any]:
    answer = lane.answer
    unit, reference, label = answer.identity
    in_db = answer.pooling == "level"
    return {
        # The colour axis: a level in dB against its reference, or a value named of what it measures (``of``).
        "quantity": "level" if in_db else "value",
        "unit": unit,
        "reference": reference,
        "referenceLabel": label,
        "calibration": calibration,
        "xScale": "linear",
        "yScale": "log" if answer.y_log else "linear",
        "y": answer.y_kind,
        **({} if in_db else {"of": answer.quantity, **({"valueUnit": answer.unit} if answer.unit else {})}),
    }


def drawn_across(x_range: tuple[float, float], width: float, ahead: float) -> tuple[tuple[float, float], float]:
    """The stretch across a time lane's points are drawn over, and the width it takes at the frame's density: the
    confirmed range and ``ahead`` of its length more at each end, so the screen has the picture to show at once when
    the range is moved (the confirmed range, and so every read, is not changed by it)."""
    low, high = min(x_range), max(x_range)
    more = max(0.0, ahead) * (high - low)
    return (low - more, high + more), width * (1.0 + 2.0 * max(0.0, ahead))


def _image_lane(lane: ImagePlan, calibration: str, width: float, height: float, ahead: float = 0.0) -> dict[str, Any]:
    """An image lane of the picture: its axes, its confirmed ranges (across, up, colour) and the cells to draw with
    their edges (配置)."""
    answer = lane.answer
    across, drawn_width = drawn_across(lane.range.x, width, ahead)
    column_edges, row_edges, cells = drawn_image(
        answer.xs,
        answer.ys,
        answer.values,
        across,
        lane.range.y,
        drawn_width,
        height,
        log=answer.y_log,
        positive=answer.y_positive,
        pooling=answer.pooling,
        cell_px=answer.cell_px,
    ).wire_points()
    return {
        "id": lane.id,
        "kind": "image",
        "axis": image_axis_json(lane, calibration),
        "lines": [],
        "guides": [],
        "image": {
            "line": lane.line,
            **({"role": lane.role} if lane.role is not None else {}),
            "key": lane.key,
            "columnEdges": column_edges,
            "rowEdges": row_edges,
            "cells": cells,
        },
        "range": {
            "x": _ends_json(lane.range.x),
            "y": _ends_json(lane.range.y),
            "colour": _ends_json(lane.range.colour),
        },
        "whole": {
            "x": _ends_json(lane.whole.x),
            "y": _ends_json(lane.whole.y),
            "colour": _ends_json(lane.whole.colour),
        },
    }


def band_axis_json(lane: BandPlan, calibration: str) -> dict[str, Any]:
    first = lane.lines[0].answer
    _, reference, label = first.identity
    return {
        "quantity": "delta" if lane.delta else first.quantity,
        "unit": first.unit,
        "reference": reference,
        "referenceLabel": label,
        "calibration": calibration,
        "xScale": "linear",
        "yScale": "linear",
        # Said only where it is not the file's own time (a trigger's events: the time from their trigger).
        **({"x": first.x_kind} if first.x_kind != "time" else {}),
    }


def _band_lane(lane: BandPlan, calibration: str, width: float, ahead: float = 0.0) -> dict[str, Any]:
    """A band lane of the picture: its axes, its confirmed ranges and each signal's drawn points (each bucket's
    lowest and highest sample at its own time, in time order: the Figure draws them as one line)."""
    lines: list[dict[str, Any]] = []
    across, drawn_width = drawn_across(lane.range.x, width, ahead)
    for line in lane.lines:
        answer = line.answer
        drawn: Drawn = drawn_band(answer.start, answer.rate, answer.values, across, drawn_width)
        xs, values = drawn.wire_points()
        lines.append(
            {
                "id": line.id,
                **({"role": line.role} if line.role is not None else {}),
                **({"key": line.key} if line.key is not None else {}),
                "xs": xs,
                "values": values,
            }
        )
    return {
        "id": lane.id,
        "kind": "band",
        "axis": band_axis_json(lane, calibration),
        "lines": lines,
        "guides": [
            {"axis": guide.axis, "at": guide.at, "id": guide.id, **({"out": True} if guide.out else {})}
            for guide in lane.guides
        ],
        **({"spans": [{"start": start, "end": end} for start, end in lane.spans]} if lane.events is not None else {}),
        **(
            {
                "events": {
                    "used": lane.events[0],
                    "total": lane.events[1],
                    **({"missing": lane.events_missing} if lane.events_missing else {}),
                }
            }
            if lane.events is not None
            else {}
        ),
        "range": {"x": _ends_json(lane.range.x), "y": _ends_json(lane.range.y)},
        "whole": {"x": _ends_json(lane.whole.x), "y": _ends_json(lane.whole.y)},
    }


def _bins_lane(lane: BinsPlan) -> dict[str, Any]:
    """A bins lane of the picture: its count axis, its confirmed ranges, its placement (the bins' edges, each
    dot's level) and its counts. A count is no answer and no drawn point: it is written as it was counted."""
    places = dot_places(lane.levels).tolist() if lane.levels is not None else None
    rows: list[dict[str, Any]] = [
        {
            "key": key,
            "value": float(lane.values[index]),
            **({"at": float(places[index])} if places is not None else {}),
            **({"picked": bool(lane.picked[index])} if lane.picked is not None else {}),
        }
        for index, key in enumerate(lane.keys)
    ]
    return {
        "id": lane.id,
        "kind": "bins",
        "axis": {
            "quantity": "count",
            "unit": "",
            "reference": 1.0,
            "referenceLabel": "",
            "calibration": "unknown",
            "xScale": "linear",
            "yScale": "linear",
        },
        "lines": [],
        "guides": [],
        "bins": {
            "column": lane.column,
            "bars": lane.bars,
            "rows": lane.rows,
            "edges": [float(edge) for edge in lane.edges.tolist()],
            "step": lane.step,
            **({"counts": [int(count) for count in lane.counts.tolist()]} if lane.counts is not None else {}),
            **(
                {"countsPicked": [int(count) for count in lane.counts_picked.tolist()]}
                if lane.counts_picked is not None
                else {}
            ),
            "members": rows,
            # The group's rows with a number (its n) and, with a range selected, those the range takes: counted here,
            # written by the screen as they are.
            "n": len(lane.keys),
            **({"nPicked": sum(1 for picked in lane.picked.tolist() if picked)} if lane.picked is not None else {}),
            "blank": lane.blank,
            "marks": [
                {
                    "id": mark.id,
                    **({"role": mark.role} if mark.role is not None else {}),
                    "key": mark.key,
                    "value": mark.value,
                }
                for mark in lane.marks
            ],
        },
        "range": {"x": _ends_json(lane.range.x), "y": _ends_json(lane.range.y)},
        "whole": {"x": _ends_json(lane.whole.x), "y": _ends_json(lane.whole.y)},
    }


def _drawn(line: LinePlan, lane: LanePlan, width: float) -> Drawn:
    assert lane.range is not None
    return drawn_line(line.xs, line.values, lane.range.x, width, lane.x_scale == "log", line.silent_floor)


def assemble(
    *,
    figure_id: str,
    generation: int,
    request_number: int,
    picture_id: str,
    data_id: str,
    lanes: Sequence[AnyPlan],
    headlines: Mapping[str, Headline],
    found: Members,
    width: float,
    heights: Mapping[str, float],
    ahead: float = 0.0,
) -> dict[str, Any]:
    """The draw request's answer: the picture. ``heights``: each lane's frame height (CSS px), for the lanes whose
    drawn points depend on it (an image's rows). ``ahead``: how much of the range's length a time lane (a band, an
    image) is drawn past each end (``drawn_across``)."""
    out_lanes: list[dict[str, Any]] = []
    for lane in lanes:
        if isinstance(lane, ImagePlan):
            out_lanes.append(_image_lane(lane, found.calibration, width, heights[lane.id], ahead))
            continue
        if isinstance(lane, BandPlan):
            out_lanes.append(_band_lane(lane, found.calibration, width, ahead))
            continue
        if isinstance(lane, BinsPlan):
            out_lanes.append(_bins_lane(lane))
            continue
        lines: list[dict[str, Any]] = []
        for line in lane.lines:
            if lane.range is None:
                break
            edges: list[float] | None = None
            if lane.named is not None and lane.named.x_kind == "band":
                # Bands are bars: every one, between its band's edges.
                bars, edges = drawn_bars(line.xs, line.values, lane.x_scale == "log", line.silent_floor)
                xs, values = bars.wire_points()
            else:
                xs, values = _drawn(line, lane, width).wire_points()
            lines.append(
                {
                    "id": line.id,
                    **({"role": line.role} if line.role is not None else {}),
                    **({"key": line.key} if line.key is not None else {}),
                    "xs": xs,
                    "values": values,
                    **({"edges": edges} if edges is not None else {}),
                }
            )
        out: dict[str, Any] = {
            "id": lane.id,
            "axis": axis_json(lane, found.calibration_of(lane.id)),
            "lines": lines,
            "guides": [{"axis": axis, "at": float(at)} for axis, at in lane.guides],
        }
        if lane.range is not None:
            out["range"] = {
                "x": [float(lane.range.x[0]), float(lane.range.x[1])],
                "y": [float(lane.range.y[0]), float(lane.range.y[1])],
            }
        if lane.whole is not None:
            out["whole"] = {
                "x": [float(lane.whole.x[0]), float(lane.whole.x[1])],
                "y": [float(lane.whole.y[0]), float(lane.whole.y[1])],
            }
        out_lanes.append(out)
    return {
        "status": "picture",
        "figureId": figure_id,
        "generation": generation,
        "requestNumber": request_number,
        "pictureId": picture_id,
        "dataId": data_id,
        "lanes": out_lanes,
        "headlines": [headline_json(lane, headline) for lane, headline in headlines.items()],
        "members": members_json(found),
    }
