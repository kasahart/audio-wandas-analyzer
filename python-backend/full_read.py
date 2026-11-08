"""The values a plot reads under the pointer and steps through with the arrow keys, from the data before it was
thinned to be drawn (docs/display-rules.md R7).

A plot draws a line thinned to the screen (each bucket's lowest and highest point, R2) and an image in cells of
several frames or bins. Every number it shows comes from here instead: the points of the full-resolution data
around the pointer, or the next ones along for a key. A read is small whatever the data: the points inside the
pick window when there are few enough of them (and ``beyond`` more past each end, for the nearest point beside an
empty window and for the next steps), else, per pixel column across the window, that column's lowest, highest and
the point nearest the level under the pointer (``near``), each a real point at its own x.
"""

from __future__ import annotations

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
    """The mean ``power`` of the ``count`` finite values in a window (read_level)."""

    power: float
    count: int


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


def _limited(read: StageRead, key: Literal["beyond", "columns", "rows"], default: int, limit: int) -> int:
    return max(0, min(limit, int(read.get(key, default))))


def read_line(
    axis: tuple[int, XAt, IndexOf], values_in: Callable[[int, int], np.ndarray], read: StageRead
) -> StagePoints:
    """A line's points for ``read`` (see the module): ``values_in(a, b)`` gives the values at indices [a, b)."""
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
    first, after = max(0, low - beyond), min(count, max(high, low) + beyond)
    if high - low <= READ_POINT_LIMIT or "near" not in read:
        # Few enough to send whole (a read with no level asked for is a step's, which never spans a window).
        high = min(high, low + READ_POINT_LIMIT)
        after = min(count, max(high, low) + beyond)
        picked = np.arange(first, after)
        shown = values_in(first, after)
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
        inside = np.unique(np.asarray(chosen, dtype=np.int64))
        picked = np.concatenate([np.arange(first, low), inside, np.arange(high, after)]).astype(np.int64)
        shown = np.concatenate([values_in(first, low), window[inside - low], values_in(high, after)])
        complete = False
    return {
        "xs": [float(value) for value in np.asarray(x_at(picked), dtype=np.float64).tolist()],
        "values": json_values(shown),
        "start": float(x_at(np.asarray(first))) if first > 0 and complete else None,
        "end": float(x_at(np.asarray(after - 1))) if after < count and complete else None,
        "complete": complete,
    }


def read_level(values: np.ndarray, kind: Literal["db", "square"]) -> StageLevel:
    """The mean power of every finite value of a window, as the overlay orders its lines by (R6): a level's
    10^(dB/10), silence (SILENT_DB and below) as none, or a signal's square. Every value is taken, none thinned."""
    block = np.asarray(values, dtype=np.float64)
    finite = block[np.isfinite(block)]
    if not finite.size:
        return {"power": 0.0, "count": 0}
    power = np.square(finite) if kind == "square" else np.where(finite <= SILENT_DB, 0.0, 10.0 ** (finite / 10.0))
    return {"power": float(np.mean(power)), "count": int(finite.size)}


def read_cells(
    xs: np.ndarray, ys: np.ndarray, cells_in: Callable[[slice, slice], np.ndarray], read: StageRead
) -> StagePoints:
    """An image's real cells around ``read``'s place: the column nearest ``x[0]`` and ``beyond`` columns past it on
    each side, the row nearest ``y[0]`` and ``rows`` (two unless asked) past it on each side (the plot picks the
    cell whose edges hold the pointer). ``cells_in(rows, columns)`` gives the values, rows over ``ys``, columns
    over ``xs``."""
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
