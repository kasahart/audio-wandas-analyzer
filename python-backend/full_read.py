"""The values a plot reads under the pointer and steps through with the arrow keys, from the data before it was
thinned to be drawn (docs/display-rules.md R7).

A plot draws a line thinned to the screen (each bucket's lowest and highest point, R2) and an image in cells of
several frames or bins. Every number it shows comes from here instead: the points of the full-resolution data
around the pointer, or the next ones along for a key. A read is small whatever the data: the points inside the
pick window when there are few enough of them (and ``beyond`` more past each end, for the nearest point beside an
empty window and for the next steps), else, per pixel column across the window, that column's lowest, highest and
the point nearest the level under the pointer (``near``), with the point nearest the pointer on screen and the
point under it along the axis (``under``), each a real point at its own x.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Literal, NotRequired, TypedDict

import numpy as np

#: At most this many points of the pick window are sent whole; a denser window is read per pixel column.
READ_POINT_LIMIT = 4096
#: At most this many points past each end of the window.
READ_BEYOND_LIMIT = 4096
#: At most this many pixel columns across a dense window.
READ_COLUMN_LIMIT = 512
#: At most this many rows either side of an image's row read.
READ_ROW_LIMIT = 64


class StageRead(TypedDict):
    """What a plot asks to read: ``x`` its window ([x0, x1], or [x] for one place) in the axis's own units, ``y``
    an image's row place; ``beyond`` points (an image's columns) past each end; for a window too dense to send
    whole, ``columns`` pixel columns across it (log-spaced on a ``log`` axis) and the level ``near`` the pointer."""

    x: list[float]
    y: NotRequired[list[float]]
    beyond: NotRequired[int]
    #: An image's rows either side of the one at ``y`` (two unless asked).
    rows: NotRequired[int]
    near: NotRequired[float]
    columns: NotRequired[int]
    log: NotRequired[bool]
    #: The pointer's place on the axis (with ``near``, its level) and the screen's scale there: pixels per axis unit
    #: (per natural-log unit on a ``log`` axis) and per value unit, so a dense window also sends the one point
    #: nearest the pointer on screen, by its true distance there.
    at: NotRequired[float]
    pixels: NotRequired[list[float]]
    #: The values the plot shows ([low, high], its level or amplitude axis zoomed): a dense window's point nearest the
    #: pointer is one of the points on screen. The point under the pointer (``under``) is not held to it (display
    #: rules R7: it is the line's point at the pointer's place, whatever its value).
    shown: NotRequired[list[float]]
    #: An arrow key's read (with ``x`` = [x]): the first point with a value to read strictly past x, toward larger
    #: (1) or smaller (-1) x, however far (a long silence is crossed in one read), with ``beyond`` past it.
    seek: NotRequired[Literal[-1, 1]]
    #: A line of plain values (a signal, a metric over time, their difference): SILENT_DB and below is a value to
    #: read, not the silent floor, for the seek and a dense window's nearest point alike (the webview's ``floorless``).
    plain: NotRequired[bool]
    #: A trigger's event (its id): that event's own line.
    event: NotRequired[int]
    #: Which combined picture: the base (its median, or a recording's own) or the difference.
    of: NotRequired[Literal["base", "diff"]]
    #: A track lane's channel (from 0).
    channel: NotRequired[int]
    #: Instead of points: the power of every value in the window ``x`` (both ends in), for the order of overlaid
    #: lines (R6): a level's 10^(dB/10) (``"db"``, silence counted as none) or a signal's square (``"square"``).
    level: NotRequired[Literal["db", "square"]]


class StageLevel(TypedDict):
    """The mean ``power`` of the ``count`` finite values in a window (read_level). Of a signal (a "square" read),
    also its ``peak``: the largest |sample| of those values (0 with none), where a new trigger's level starts."""

    power: float
    count: int
    peak: NotRequired[float]


class StagePoints(TypedDict):
    """Real points of the full-resolution data. A line: ``values`` over ``xs``. An image: ``matrix`` rows over
    ``ys``, columns over ``xs``. ``complete``: every point with ``start <= x <= end`` is here (null: the data's own
    end); otherwise these are per pixel column the points a pointer can read."""

    xs: list[float]
    values: NotRequired[list[float | None]]
    ys: NotRequired[list[float]]
    matrix: NotRequired[list[list[float | None]]]
    start: float | None
    end: float | None
    complete: bool
    #: A level read's answer (StageRead ``level``), with no points.
    level: NotRequired[StageLevel]
    #: Of a window too dense to send whole, read with the pointer's place (``at``): the index in ``xs`` of the point
    #: with a value nearest the pointer along the axis, the one under it, which the plot reads when no point is near
    #: the pointer on screen. On screen or past the value axis alike (display rules R7).
    under: NotRequired[int]
    #: A line's points only: for each of ``xs``, how far it is from its nearer neighbour in the source data (null for
    #: a line of one point). The digits a readout writes come of this, never of the gaps between the points sent,
    #: which in a dense window are only the few picked for each pixel column.
    steps: NotRequired[list[float | None]]


#: A level at or below this is silence (the webview's `silent`): no power.
SILENT_DB = -250.0


IndexOf = Callable[[float, Literal["left", "right"]], int]
XAt = Callable[[np.ndarray], np.ndarray]


def json_values(values: np.ndarray) -> list[float | None]:
    return [float(value) if np.isfinite(value) else None for value in np.asarray(values, dtype=np.float64).tolist()]


def sorted_axis(xs: np.ndarray) -> tuple[int, XAt, IndexOf]:
    """An ascending axis of its own values: its length, its values at indices and the index of a value."""
    axis = np.asarray(xs, dtype=np.float64)
    return axis.size, lambda index: axis[index], lambda value, side: int(np.searchsorted(axis, value, side=side))


def uniform_axis(count: int, start: float, step: float) -> tuple[int, XAt, IndexOf]:
    """Evenly spaced points (samples): ``start + n * step``, with no array of their places made."""

    def index_of(value: float, side: Literal["left", "right"]) -> int:
        place = (value - start) / step if step > 0 else 0.0
        index = int(np.ceil(place - 1e-9)) if side == "left" else int(np.floor(place + 1e-9)) + 1
        return max(0, min(count, index))

    return count, lambda index: start + np.asarray(index, dtype=np.float64) * step, index_of


def source_steps(axis: tuple[int, XAt, IndexOf], picked: np.ndarray) -> list[float | None]:
    """For each index of ``picked``: the distance from that point to its nearer neighbour on ``axis``, the source
    data's own (StagePoints ``steps``); None where it has no neighbour."""
    count, x_at, _index_of = axis
    index = np.asarray(picked, dtype=np.int64)
    if not index.size:
        return []
    here = np.asarray(x_at(index), dtype=np.float64)
    before = np.abs(here - np.asarray(x_at(np.maximum(index - 1, 0)), dtype=np.float64))
    after = np.abs(np.asarray(x_at(np.minimum(index + 1, count - 1)), dtype=np.float64) - here)
    # A point at the data's end has one neighbour only: the gap to itself (0) is no step.
    gaps = np.minimum(np.where(index > 0, before, np.inf), np.where(index < count - 1, after, np.inf))
    return [float(gap) if math.isfinite(gap) and gap > 0 else None for gap in gaps.tolist()]


def _limited(read: StageRead, key: Literal["beyond", "columns", "rows"], default: int, limit: int) -> int:
    return max(0, min(limit, int(read.get(key, default))))


def read_line(
    axis: tuple[int, XAt, IndexOf],
    values_in: Callable[[int, int], np.ndarray],
    read: StageRead,
) -> StagePoints:
    """A line's points for ``read`` (see the module): ``values_in(a, b)`` gives the values at indices [a, b),
    unrounded. The points are picked, a level taken and the values sent from those as they are: a read carries no
    rounding, so the webview picks the nearest point, tells silence and steps the arrow keys on the values
    themselves, and only the text it writes rounds them (plotText)."""
    count, x_at, index_of = axis
    bounds = [float(value) for value in read["x"]]
    x0, x1 = min(bounds), max(bounds)
    low, high = index_of(x0, "left"), index_of(x1, "right")
    if "level" in read:
        return {
            "xs": [],
            "start": None,
            "end": None,
            "complete": False,
            "level": read_level(values_in(low, max(low, high)), read["level"]),
        }
    beyond = _limited(read, "beyond", 1, READ_BEYOND_LIMIT)
    under: int | None = None
    seek = read.get("seek")
    plain = bool(read.get("plain"))
    if seek in (-1, 1):
        return _seek_line(axis, values_in, x0, int(seek), beyond, plain)
    first, after = max(0, low - beyond), min(count, max(high, low) + beyond)
    if high - low <= READ_POINT_LIMIT or "near" not in read:
        # Few enough to send whole (a read with no level asked for is a step's, which never spans a window).
        high = min(high, low + READ_POINT_LIMIT)
        after = min(count, max(high, low) + beyond)
        picked = np.arange(first, after)
        picked_values = values_in(first, after)
        complete = True
    else:
        columns = max(1, _limited(read, "columns", 41, READ_COLUMN_LIMIT))
        near = float(read["near"])
        log = bool(read.get("log")) and x0 > 0
        edges = np.geomspace(x0, x1, columns + 1) if log else np.linspace(x0, x1, columns + 1)
        cuts = [index_of(float(edge), "left") for edge in edges[1:-1]]
        starts = [low, *cuts]
        ends = [*cuts, high]
        window = np.asarray(values_in(low, high), dtype=np.float64)
        chosen: list[int] = []
        for start, end in zip(starts, ends, strict=True):
            if end <= start:
                continue
            block = window[start - low : end - low]
            finite = np.isfinite(block)
            if not finite.any():
                continue
            masked = np.where(finite, block, np.nan)
            chosen.extend(
                start + int(index)
                for index in (np.nanargmin(masked), np.nanargmax(masked), np.nanargmin(np.abs(masked - near)))
            )
        nearest, across = pointer_picks(axis, values_in, read, window)
        if nearest is not None:
            chosen.append(nearest)
        if across is not None and low <= across < high:
            chosen.append(across)
        inside = np.unique(np.asarray(chosen, dtype=np.int64))
        picked = np.concatenate([np.arange(first, low), inside, np.arange(high, after)]).astype(np.int64)
        picked_values = np.concatenate([values_in(first, low), window[inside - low], values_in(high, after)])
        complete = False
        if across is not None:
            under = int(np.flatnonzero(picked == across)[0])
    points: StagePoints = {
        "xs": [float(value) for value in np.asarray(x_at(picked), dtype=np.float64).tolist()],
        "values": json_values(np.asarray(picked_values, dtype=np.float64)),
        "start": float(x_at(np.asarray(first))) if first > 0 and complete else None,
        "end": float(x_at(np.asarray(after - 1))) if after < count and complete else None,
        "complete": complete,
        "steps": source_steps(axis, picked),
    }
    if under is not None:
        points["under"] = under
    return points


#: How many values an arrow key's seek takes at a time while it crosses a silence.
SEEK_CHUNK = 1 << 16


def _readable(values: np.ndarray, plain: bool = False) -> np.ndarray:
    """Which values a plot reads: finite and, unless ``plain`` (StageRead ``plain``), above the silent floor
    (drawn as a gap)."""
    block = np.asarray(values, dtype=np.float64)
    finite = np.isfinite(block)
    return finite if plain else finite & (block > SILENT_DB)


def _on_screen(read: StageRead, values: np.ndarray) -> np.ndarray:
    """Which values lie within the values the plot shows (StageRead ``shown``, both ends in); all without it."""
    block = np.asarray(values, dtype=np.float64)
    shown = [float(value) for value in read.get("shown", [])]
    if len(shown) != 2 or not all(math.isfinite(value) for value in shown):
        return np.ones(block.shape, dtype=bool)
    with np.errstate(invalid="ignore"):
        return (block >= min(shown)) & (block <= max(shown))


def _seek_line(
    axis: tuple[int, XAt, IndexOf],
    values_in: Callable[[int, int], np.ndarray],
    x: float,
    direction: int,
    beyond: int,
    plain: bool = False,
) -> StagePoints:
    """An arrow key's read (StageRead ``seek``): the first point with a value strictly past ``x`` toward
    ``direction``, found a chunk at a time however long the silence before it, sent with the point before it and
    ``beyond`` past it, as a complete window; none past it: only the data's end."""
    count, x_at, index_of = axis
    found: int | None = None
    if direction > 0:
        start = index_of(x, "right")
        while start < count and found is None:
            end = min(count, start + SEEK_CHUNK)
            hits = np.flatnonzero(_readable(values_in(start, end), plain))
            if hits.size:
                found = start + int(hits[0])
            start = end
    else:
        end = index_of(x, "left")
        while end > 0 and found is None:
            start = max(0, end - SEEK_CHUNK)
            hits = np.flatnonzero(_readable(values_in(start, end), plain))
            if hits.size:
                found = start + int(hits[-1])
            end = start
    if found is None:
        # Nothing past it to read: the data's end that way.
        return {"xs": [], "values": [], "start": None, "end": None, "complete": True}
    first = max(0, found - (1 if direction > 0 else beyond))
    after = min(count, found + (beyond if direction > 0 else 1) + 1)
    picked = np.arange(first, after)
    return {
        "xs": [float(value) for value in np.asarray(x_at(picked), dtype=np.float64).tolist()],
        "values": json_values(np.asarray(values_in(first, after), dtype=np.float64)),
        "start": float(x_at(np.asarray(first))) if first > 0 else None,
        "end": float(x_at(np.asarray(after - 1))) if after < count else None,
        "complete": True,
        "steps": source_steps(axis, picked),
    }


def pointer_picks(
    axis: tuple[int, XAt, IndexOf],
    values_in: Callable[[int, int], np.ndarray],
    read: StageRead,
    window: np.ndarray | None = None,
) -> tuple[int | None, int | None]:
    """The two points the pointer may read of a line (docs/display-rules.md R7's table, the rule the webview's
    stagePanes.fullLineNear follows too): the index of the point nearest it on screen among those in the pick window
    ``x`` (_nearest_on_screen; the webview reads it only within its pick radius), and of the point under it
    (_nearest_along), looked for in the window and ``beyond`` points past each end, as the webview looks among the
    points it is sent. ``window``: the values of the pick window, where the caller has read them already. Both are
    run against python-backend/tests/fixtures/pick_cases.json (test_pick_cases.py)."""
    count, x_at, index_of = axis
    bounds = [float(value) for value in read["x"]]
    low, high = index_of(min(bounds), "left"), index_of(max(bounds), "right")
    high = max(high, low)
    beyond = _limited(read, "beyond", 1, READ_BEYOND_LIMIT)
    first, after = max(0, low - beyond), min(count, high + beyond)
    near = read.get("near")
    log = bool(read.get("log")) and min(bounds) > 0
    plain = bool(read.get("plain"))
    inside = np.asarray(values_in(low, high) if window is None else window, dtype=np.float64)
    nearest = None if near is None else _nearest_on_screen(read, inside, x_at, low, high, float(near), log, plain)
    around = np.concatenate([values_in(first, low), inside, values_in(high, after)]).astype(np.float64)
    return nearest, _nearest_along(read, around, x_at, first, after, log, plain, count)


def _nearest_on_screen(
    read: StageRead, window: np.ndarray, x_at: XAt, low: int, high: int, near: float, log: bool, plain: bool = False
) -> int | None:
    """The index of the point of ``window`` (indices [low, high)) nearest the pointer (``at``, ``near``) by its true
    distance on screen (``pixels``: per axis unit, or per natural-log unit on a log axis, and per value unit), of
    those with a value to read (finite and, unless ``plain``, above the silent floor); None without the pointer's
    place or scale."""
    if "at" not in read or "pixels" not in read or high <= low:
        return None
    scale = [float(value) for value in read["pixels"]]
    at = float(read["at"])
    if len(scale) != 2 or not all(math.isfinite(value) for value in [*scale, at]) or (log and at <= 0):
        return None
    xs = np.asarray(x_at(np.arange(low, high)), dtype=np.float64)
    along = (np.log(np.maximum(xs, 1e-300)) - math.log(at)) * scale[0] if log else (xs - at) * scale[0]
    across = (window - near) * scale[1]
    away = np.hypot(along, across)
    readable = _readable(window, plain) & _on_screen(read, window) & np.isfinite(away)
    if not readable.any():
        return None
    return low + int(np.argmin(np.where(readable, away, np.inf)))


def _nearest_along(
    read: StageRead,
    window: np.ndarray,
    x_at: XAt,
    low: int,
    high: int,
    log: bool,
    plain: bool = False,
    count: int | None = None,
) -> int | None:
    """The index of the point of ``window`` (indices [low, high)) with a value to read whose x is nearest the pointer's
    (``at``, on a log axis by ratio): the point under the pointer, which it reads when no point is near it on screen
    (beyond the pick radius, StagePoints ``under``). None without the pointer's place or a point to read, and, given
    the line's ``count``, with the pointer more than half a pixel (``pixels``) before its first point or past its
    last: there the pointer is over none of it (R7, as stagePanes.fullLineNear)."""
    if "at" not in read or high <= low:
        return None
    at = float(read["at"])
    if not math.isfinite(at) or (log and at <= 0):
        return None

    def measure(xs: np.ndarray) -> np.ndarray:
        return np.log(np.maximum(xs, 1e-300)) if log else xs

    place = float(measure(np.asarray(at, dtype=np.float64)))
    if count:
        scale = [float(value) for value in read.get("pixels", [])]
        slack = 0.5 / scale[0] if len(scale) == 2 and math.isfinite(scale[0]) and scale[0] > 0 else 0.0
        ends = measure(np.asarray(x_at(np.asarray([0, count - 1])), dtype=np.float64))
        if place < float(ends[0]) - slack or place > float(ends[1]) + slack:
            return None
    xs = np.asarray(x_at(np.arange(low, high)), dtype=np.float64)
    along = np.abs(measure(xs) - place)
    # Not held to the values on screen (``shown``): the point under the pointer is the line's point there (R7).
    readable = _readable(window, plain) & np.isfinite(along)
    if not readable.any():
        return None
    return low + int(np.argmin(np.where(readable, along, np.inf)))


def read_level(values: np.ndarray, kind: Literal["db", "square"]) -> StageLevel:
    """The mean power of every finite value of a window, as the overlay orders its lines by (R6): a level's
    10^(dB/10), silence (SILENT_DB and below) as none, or a signal's square. Every value is taken, none thinned.

    A signal's read ("square") also gives its ``peak``, the largest |sample| of the window: taken here from every
    sample, because the envelope the webview draws is thinned and is not to be computed with (display rules R1)."""
    block = np.asarray(values, dtype=np.float64)
    finite = block[np.isfinite(block)]
    if kind == "square":
        if not finite.size:
            return {"power": 0.0, "count": 0, "peak": 0.0}
        return {
            "power": float(np.mean(np.square(finite))),
            "count": int(finite.size),
            "peak": float(np.max(np.abs(finite))),
        }
    if not finite.size:
        return {"power": 0.0, "count": 0}
    power = np.where(finite <= SILENT_DB, 0.0, 10.0 ** (finite / 10.0))
    return {"power": float(np.mean(power)), "count": int(finite.size)}


def read_cells(
    xs: np.ndarray,
    ys: np.ndarray,
    cells_in: Callable[[slice, slice], np.ndarray],
    read: StageRead,
) -> StagePoints:
    """An image's real cells around ``read``'s place: the column nearest ``x[0]`` and ``beyond`` columns past it on
    each side, the row nearest ``y[0]`` and ``rows`` (two unless asked) past it on each side (the plot picks the
    cell whose edges hold the pointer). ``cells_in(rows, columns)`` gives the values, rows over ``ys``, columns
    over ``xs``, unrounded, and are sent as they are."""
    times, rows_axis = np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)
    if not times.size or not rows_axis.size:
        return {"xs": [], "ys": [], "matrix": [], "start": None, "end": None, "complete": True}
    beyond = _limited(read, "beyond", 1, READ_BEYOND_LIMIT)

    def nearest(axis: np.ndarray, value: float) -> int:
        index = int(np.clip(np.searchsorted(axis, value), 1, axis.size - 1)) if axis.size > 1 else 0
        return index - 1 if axis.size > 1 and abs(axis[index - 1] - value) <= abs(axis[index] - value) else index

    column = nearest(times, float(read["x"][0]))
    row = nearest(rows_axis, float(read.get("y", [rows_axis[0]])[0]))
    columns = slice(max(0, column - beyond), min(times.size, column + beyond + 1))
    either = _limited(read, "rows", 2, READ_ROW_LIMIT)
    rows = slice(max(0, row - either), min(rows_axis.size, row + either + 1))
    matrix = np.asarray(cells_in(rows, columns), dtype=np.float64)
    return {
        "xs": [float(value) for value in times[columns].tolist()],
        "ys": [float(value) for value in rows_axis[rows].tolist()],
        "matrix": [json_values(line) for line in matrix],
        "start": float(times[columns.start]) if columns.start > 0 else None,
        "end": float(times[columns.stop - 1]) if columns.stop < times.size else None,
        "complete": True,
    }
