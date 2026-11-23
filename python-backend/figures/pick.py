"""計算エ: the point a read reads (読む点を選ぶ). The one function is ``pick``.

Every line of the lane is judged at once (never line by line, 第 9 節 誤った実装 3), from the lines' answers (never
drawn points, rule B) and the lane's confirmed range. Three kinds of read (第 5 節 read (a)(b)(c)):

(a) ``PointerAsk``: the pointer's place on the axes and the scale there (px per axis unit; on a log axis px per
    natural-log unit). The rule of R7 (docs/display-rules.md) and docs/figure-design.md 第 5 節 エ「読む点」:

    - of every line's points with a value that are on screen (across and up inside the confirmed range), the one
      nearest the pointer on screen (√(dx² + dy²) px) within 20 px;
    - with none, for each line the point under the pointer: of its points in the pick window (20 px either side)
      and one point past each end, the one with a value nearest the pointer across (on a log axis by ratio),
      whatever its value (a value past the value axis is read at the plot's edge); of those, the line whose point
      (held at the plot's edge) is nearest the pointer in height;
    - only a point inside the confirmed range across is read: with none there in reach, nothing (``outside``);
    - the pointer more than half a pixel before a line's first point or past its last is over none of it; over a
      line with no point with a value in reach, the place has no value (``no-value``); over nothing, ``outside``;
    - a tie goes to the line declared first, then to the lower index: never to the draw order or the hover (仕様 1).

(b) ``StepAsk``: from a point (line, index), ``steps`` points with a value on (a signed count: the arrow keys
    pressed), inside the confirmed range across (past the plot's side there is nothing: ``outside``), however long
    a gap between them.
(c) ``NameAsk``: the point of a line at exactly this place across, or ``no-point``: never the nearest in its place.

A read returns the one point it reads, never a list of its neighbours: the arrow keys ask (b) each time, so the
Webview holds no point of its own to move to. The distance is thrown away: only the
point's name is returned.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np

from figures.levels import SILENT_DB
from figures.thinning import bar_places, bin_of, cell_edge_places, cells_on_screen, dot_places

#: How near (CSS px, across and up together) a point is picked over the point under the pointer (R7).
RADIUS_PX = 20.0


@dataclass(frozen=True)
class PickLine:
    """One line of the lane, in declared order: its answer's points (every one, before any thinning)."""

    id: str
    xs: np.ndarray
    values: np.ndarray
    #: A level: −250 dB and below is no value. A Δ and other plain values have no floor.
    silent_floor: bool


@dataclass(frozen=True)
class PointerAsk:
    x: float
    y: float
    scale_x: float
    scale_y: float


@dataclass(frozen=True)
class StepAsk:
    line: str
    index: int
    #: Points on from ``index``: positive onward, negative back; never 0.
    steps: int


@dataclass(frozen=True)
class NameAsk:
    line: str
    x: float


Ask = PointerAsk | StepAsk | NameAsk


@dataclass(frozen=True)
class Point:
    """A point's name (its line and index) with its place across, its answer and its source step."""

    line: str
    index: int
    x: float
    value: float
    x_step: float | None


@dataclass(frozen=True)
class Pick:
    status: Literal["point", "no-value", "outside", "no-point"]
    point: Point | None = None
    #: Which rule chose the point of a pointer's read: within the radius ("near") or under the pointer ("under").
    by: Literal["near", "under"] | None = None


def _readable(line: PickLine, log: bool) -> np.ndarray:
    values = np.asarray(line.values, dtype=np.float64)
    keep = np.isfinite(values)
    if line.silent_floor:
        keep &= values > SILENT_DB
    if log:
        keep &= np.asarray(line.xs, dtype=np.float64) > 0
    return keep


def _measure(xs: np.ndarray | float, log: bool) -> np.ndarray:
    xs = np.asarray(xs, dtype=np.float64)
    if not log:
        return xs
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.log(np.where(xs > 0, xs, np.nan))


def _inside(values: np.ndarray, ends: tuple[float, float]) -> np.ndarray:
    low, high = min(ends), max(ends)
    slack = (high - low) * 1e-9
    with np.errstate(invalid="ignore"):
        return (values >= low - slack) & (values <= high + slack)


def data_step(xs: np.ndarray, index: int) -> float | None:
    """The data's step at point ``index``: its distance to its nearer neighbour (None with none). The digits a read
    writes come of this; the headline carries it too (headline.py)."""
    gaps = [abs(float(xs[i + 1] - xs[i])) for i in (index - 1, index) if 0 <= i < xs.size - 1]
    gaps = [gap for gap in gaps if gap > 0 and math.isfinite(gap)]
    return min(gaps) if gaps else None


def _point(line: PickLine, index: int) -> Point:
    xs = np.asarray(line.xs, dtype=np.float64)
    return Point(line.id, index, float(xs[index]), float(np.asarray(line.values)[index]), data_step(xs, index))


def _read(line: PickLine, index: int, by: Literal["near", "under"] | None) -> Pick:
    """``line``'s point ``index``, alone."""
    return Pick("point", _point(line, index), by)


def _near(
    lines: Sequence[PickLine], ask: PointerAsk, x_range: tuple[float, float], y_range: tuple[float, float], log: bool
) -> tuple[int, int] | None:
    place = float(_measure(ask.x, log))
    best: tuple[int, int] | None = None
    distance = math.inf
    for at, line in enumerate(lines):
        xs = np.asarray(line.xs, dtype=np.float64)
        values = np.asarray(line.values, dtype=np.float64)
        with np.errstate(invalid="ignore"):
            across = (_measure(xs, log) - place) * ask.scale_x
            up = (values - ask.y) * ask.scale_y
            away = np.hypot(across, up)
            on = _readable(line, log) & _inside(xs, x_range) & _inside(values, y_range) & (np.abs(across) <= RADIUS_PX)
            on &= np.isfinite(away) & (away <= RADIUS_PX)
        if not on.any():
            continue
        index = int(np.argmin(np.where(on, away, np.inf)))
        if float(away[index]) < distance:
            best, distance = (at, index), float(away[index])
    return best


def _under(line: PickLine, ask: PointerAsk, x_range: tuple[float, float], log: bool) -> tuple[int | None, bool]:
    """The index of ``line``'s point under the pointer (or None), and whether the pointer is over a gap of it. Only a
    point inside the confirmed range across is read (the one past each end of the pick window too, if inside it):
    a point outside it is drawn to the frame's edge (thinning.py) but never read; with none inside, nothing."""
    xs = np.asarray(line.xs, dtype=np.float64)
    readable = _readable(line, log)
    placed = np.flatnonzero(xs > 0) if log else np.arange(xs.size)
    if not placed.size or ask.scale_x <= 0:
        return None, False
    place = float(_measure(ask.x, log))
    slack = 0.5 / ask.scale_x
    ends = _measure(xs[[placed[0], placed[-1]]], log)
    if place < float(ends[0]) - slack or place > float(ends[1]) + slack:
        return None, False
    reach = RADIUS_PX / ask.scale_x
    low_x = math.exp(place - reach) if log else place - reach
    high_x = math.exp(place + reach) if log else place + reach
    low, high = int(np.searchsorted(xs, low_x, side="left")), int(np.searchsorted(xs, high_x, side="right"))
    first, after = max(0, low - 1), min(xs.size, max(high, low) + 1)
    window = np.arange(first, after)
    window = window[_inside(xs[window], x_range)]
    if not window.size:
        return None, False
    window = window[readable[window]]
    if not window.size:
        return None, True
    along = np.abs(_measure(xs[window], log) - place)
    return int(window[int(np.argmin(along))]), False


def _pointer(
    lines: Sequence[PickLine], ask: PointerAsk, x_range: tuple[float, float], y_range: tuple[float, float], log: bool
) -> Pick:
    hit = _near(lines, ask, x_range, y_range, log)
    if hit is not None:
        return _read(lines[hit[0]], hit[1], "near")
    best: tuple[int, int] | None = None
    distance = math.inf
    gap = False
    low, high = min(y_range), max(y_range)
    for at, line in enumerate(lines):
        index, over_gap = _under(line, ask, x_range, log)
        gap = gap or over_gap
        if index is None:
            continue
        held = min(max(float(np.asarray(line.values)[index]), low), high)
        away = abs(held - ask.y) * ask.scale_y
        if away < distance:
            best, distance = (at, index), away
    if best is not None:
        return _read(lines[best[0]], best[1], "under")
    return Pick("no-value" if gap else "outside")


def _step(lines: Sequence[PickLine], ask: StepAsk, x_range: tuple[float, float], log: bool) -> Pick:
    line = next((line for line in lines if line.id == ask.line), None)
    if line is None:
        return Pick("no-point")
    xs = np.asarray(line.xs, dtype=np.float64)
    candidates = np.flatnonzero(_readable(line, log) & _inside(xs, x_range))
    if ask.steps > 0:
        onward = candidates[candidates > ask.index]
        return _read(line, int(onward[ask.steps - 1]), None) if onward.size >= ask.steps else Pick("outside")
    back = candidates[candidates < ask.index]
    return _read(line, int(back[ask.steps]), None) if back.size >= -ask.steps else Pick("outside")


def _named(lines: Sequence[PickLine], ask: NameAsk, x_range: tuple[float, float], log: bool) -> Pick:
    line = next((line for line in lines if line.id == ask.line), None)
    if line is None:
        return Pick("no-point")
    xs = np.asarray(line.xs, dtype=np.float64)
    found = np.flatnonzero(_readable(line, log) & _inside(xs, x_range) & (xs == ask.x))
    return _read(line, int(found[0]), None) if found.size else Pick("no-point")


def pick(
    lines: Sequence[PickLine], ask: Ask, x_range: tuple[float, float], y_range: tuple[float, float], log: bool
) -> Pick:
    """The point read (計算エ): of the lane's ``lines`` (declared order), by the pointer, a step or a name, inside
    the lane's confirmed range (``x_range``, ``y_range``; ``log``: the axis across is logarithmic)."""
    if isinstance(ask, PointerAsk):
        if not all(math.isfinite(value) for value in (ask.x, ask.y, ask.scale_x, ask.scale_y)) or (log and ask.x <= 0):
            return Pick("outside")
        return _pointer(lines, ask, x_range, y_range, log)
    if isinstance(ask, StepAsk):
        return _step(lines, ask, x_range, log)
    return _named(lines, ask, x_range, log)


# --- An image lane (a spectrogram): the cell read ------------------------------------------------------------------


@dataclass(frozen=True)
class CellPointerAsk:
    """The pointer's place on the image's axes (across and up); a cell is chosen by its edges, so no scale is needed."""

    x: float
    y: float


@dataclass(frozen=True)
class CellStepAsk:
    """From a cell (column, row), ``columns`` and ``rows`` cells on (signed; the arrow keys pressed)."""

    column: int
    row: int
    columns: int
    rows: int


@dataclass(frozen=True)
class CellNameAsk:
    """The cell at exactly this column's and row's place (a cell read again after a redraw)."""

    x: float
    y: float


CellAsk = CellPointerAsk | CellStepAsk | CellNameAsk


@dataclass(frozen=True)
class Cell:
    """An answer cell's name (its column and row) with its place, its answer and the data's steps there."""

    column: int
    row: int
    x: float
    y: float
    value: float
    x_step: float | None
    y_step: float | None


@dataclass(frozen=True)
class CellPick:
    status: Literal["point", "no-value", "outside", "no-point"]
    cell: Cell | None = None


def cell_index(axis: np.ndarray, value: float, log: bool) -> int:
    """The cell of ``axis`` (ascending) whose edges hold ``value``: a value on an edge is the lower cell's; −1 past
    the first or last cell's outer edge."""
    axis = np.asarray(axis, dtype=np.float64)
    if not axis.size or not math.isfinite(value) or (log and value <= 0):
        return -1
    edges = cell_edge_places(axis, log)
    place = math.log(max(value, 1e-12)) if log else value
    if place < edges[0] or place > edges[-1]:
        return -1
    # The first cell whose upper edge is at or past the value.
    return int(min(axis.size - 1, np.searchsorted(edges[1:], place, side="left")))


def _cell(xs: np.ndarray, ys: np.ndarray, values: np.ndarray, column: int, row: int) -> CellPick:
    value = float(values[row, column])
    if not math.isfinite(value):
        return CellPick("no-value")
    return CellPick(
        "point", Cell(column, row, float(xs[column]), float(ys[row]), value, data_step(xs, column), data_step(ys, row))
    )


def pick_cell(
    xs: np.ndarray,
    ys: np.ndarray,
    values: np.ndarray,
    ask: CellAsk,
    x_range: tuple[float, float],
    y_range: tuple[float, float],
    y_log: bool,
    y_positive: bool | None = None,
) -> CellPick:
    """The cell read of an image (計算エ): of its answer's own cells (``values``: rows over ``ys``, columns over
    ``xs``, before any is averaged to draw: rule B), inside the lane's confirmed range.

    - a pointer reads the answer cell whose edges hold its place (``cell_index``; outside the range, or past the
      outer edges: ``outside``); a cell with no value is ``no-value``;
    - a step moves ``columns`` across and ``rows`` up from a cell, to a cell whose place is inside the range
      (``outside`` past it);
    - a name reads the cell at exactly that column's and row's place, or ``no-point``.
    """
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    values = np.asarray(values)

    # The cells on screen, by the rule they are drawn by (thinning.cells_on_screen): a cell cut by the range's end
    # is drawn up to it, and so read and stepped to.
    # The rows placed: of a frequency (log) or a quefrency axis the positive ones, as they are drawn.
    positive = y_log if y_positive is None else y_positive
    zero = int(np.searchsorted(ys, 0.0, side="right")) if positive else 0
    columns_on = cells_on_screen(xs, x_range, False)
    rows_on = cells_on_screen(ys[zero:], y_range, y_log)

    def inside(column: int, row: int) -> bool:
        return columns_on[0] <= column < columns_on[1] and rows_on[0] <= row - zero < rows_on[1]

    if isinstance(ask, CellPointerAsk):
        if not (math.isfinite(ask.x) and math.isfinite(ask.y)):
            return CellPick("outside")
        if not (bool(_inside(np.asarray(ask.x), x_range)) and bool(_inside(np.asarray(ask.y), y_range))):
            return CellPick("outside")
        placed = np.flatnonzero(ys > 0) if positive else np.arange(ys.size)
        column = cell_index(xs, ask.x, False)
        at = cell_index(ys[placed], ask.y, y_log)
        if column < 0 or at < 0 or not inside(column, int(placed[at])):
            return CellPick("outside")
        return _cell(xs, ys, values, column, int(placed[at]))
    if isinstance(ask, CellStepAsk):
        column, row = ask.column + ask.columns, ask.row + ask.rows
        return _cell(xs, ys, values, column, row) if inside(column, row) else CellPick("outside")
    columns, rows = np.flatnonzero(xs == ask.x), np.flatnonzero(ys == ask.y)
    if not columns.size or not rows.size or not inside(int(columns[0]), int(rows[0])):
        return CellPick("no-point")
    return _cell(xs, ys, values, int(columns[0]), int(rows[0]))


# --- A band lane (time signals): the sample read ---------------------------------------------------------------------


@dataclass(frozen=True)
class PickSignal:
    """One signal of the lane, in declared order: every sample of its answer; sample n is at ``start + n * (1 /
    rate)``."""

    id: str
    start: float
    rate: float
    values: np.ndarray


#: Samples a pointer's read looks at together, nearest the pointer first.
_RING = 4096


def _span(signal: PickSignal, low: float, high: float) -> tuple[int, int]:
    """The samples ``[first, after)`` of a signal at ``low`` … ``high`` (both ends in, to a billionth of a step)."""
    count = len(signal.values)
    first = int(math.ceil((low - signal.start) * signal.rate - 1e-9))
    after = int(math.floor((high - signal.start) * signal.rate + 1e-9)) + 1
    first = max(0, min(count, first))
    return first, max(first, min(count, after))


def _near_sample(
    signal: PickSignal, ask: PointerAsk, x_range: tuple[float, float], y_range: tuple[float, float]
) -> tuple[float, int] | None:
    """Of a signal's samples with a value on screen within the radius of the pointer, the nearest on screen (its
    distance in px and its index; of equal ones the lower index). The samples are looked at in rings outward from
    the pointer, and no further once a ring starts further across than the nearest found: the same sample as
    looking at every one within the radius, without looking at them all where they are dense."""
    reach = RADIUS_PX / ask.scale_x
    step = 1.0 / signal.rate
    first, after = _span(signal, max(min(x_range), ask.x - reach), min(max(x_range), ask.x + reach))
    if after <= first:
        return None
    values = np.asarray(signal.values)
    low, high = min(y_range), max(y_range)
    # Samples none of which reaches the pointer's height within the radius (a pointer in the empty part of the plot,
    # well off a quiet signal) are passed without measuring each one's distance: a long recording has millions of
    # samples within the radius across.
    up = RADIUS_PX / ask.scale_y
    centre = max(first, min(after, int(round((ask.x - signal.start) * signal.rate))))
    best: tuple[float, int] | None = None
    left, right = centre, centre
    while left > first or right < after:
        # The nearest sample not looked at yet is this far across (px): no sample past it is nearer than ``best``.
        inner = min(
            (ask.x - (signal.start + (left - 1) * step)) if left > first else math.inf,
            ((signal.start + right * step) - ask.x) if right < after else math.inf,
        )
        if best is not None and inner * ask.scale_x > best[0]:
            break
        for a, b in ((max(first, left - _RING), left), (right, min(after, right + _RING))):
            if b <= a:
                continue
            part = values[a:b].astype(np.float64, copy=False)
            if float(part.min()) > ask.y + up or float(part.max()) < ask.y - up:
                continue
            with np.errstate(invalid="ignore"):
                across = (signal.start + np.arange(a, b) * step - ask.x) * ask.scale_x
                away = np.hypot(across, (part - ask.y) * ask.scale_y)
                on = (part >= low) & (part <= high) & (np.abs(across) <= RADIUS_PX) & (away <= RADIUS_PX)
            if on.any():
                at = int(np.argmin(np.where(on, away, np.inf)))
                found = (float(away[at]), a + at)
                if best is None or found < best:
                    best = found
        left, right = max(first, left - _RING), min(after, right + _RING)
    return best


def _under_sample(signal: PickSignal, ask: PointerAsk, x_range: tuple[float, float]) -> tuple[int | None, bool]:
    """The index of the signal's sample under the pointer (or None), and whether the pointer is over a gap of it: the
    rule of ``_under`` (the sample with a value nearest the pointer across, of those within the radius and one past
    each side, inside the confirmed range; over none of it more than half a pixel before its first sample or past
    its last)."""
    count = len(signal.values)
    step = 1.0 / signal.rate
    slack = 0.5 / ask.scale_x
    if ask.x < signal.start - slack or ask.x > signal.start + (count - 1) * step + slack:
        return None, False
    reach = RADIUS_PX / ask.scale_x
    first, after = _span(signal, ask.x - reach, ask.x + reach)
    first, after = max(0, first - 1), min(count, max(after, first) + 1)
    inside_first, inside_after = _span(signal, min(x_range), max(x_range))
    first, after = max(first, inside_first), min(after, inside_after)
    if after <= first:
        return None, False
    values = np.asarray(signal.values)
    centre = max(first, min(after - 1, int(round((ask.x - signal.start) * signal.rate))))
    left, right = centre, centre
    while left > first or right < after:
        a, b = max(first, left - _RING), min(after, right + _RING)
        with_value = a + np.flatnonzero(np.isfinite(values[a:b]))
        if with_value.size:
            along = np.abs(signal.start + with_value * step - ask.x)
            return int(with_value[int(np.argmin(along))]), False
        left, right = a, b
    return None, True


def pick_sample(
    signals: Sequence[PickSignal], ask: Ask, x_range: tuple[float, float], y_range: tuple[float, float]
) -> Pick:
    """The sample read of a band lane (計算エ): by the rule of ``pick`` (the nearest sample on screen within the
    radius, else the one under the pointer of the signal nearest in height; a step; a name; a tie to the signal
    declared first, then the lower index), of the signals' own samples, inside the confirmed range. A pointer's read
    looks at the samples nearest the pointer first and stops where no other can be nearer: a long signal is never
    looked at whole. The index answered is the sample's own."""
    live = [signal for signal in signals if signal.rate > 0 and len(signal.values)]

    def read_of(signal: PickSignal, index: int, by: Literal["near", "under"] | None) -> Pick:
        step = 1.0 / signal.rate
        value = float(np.asarray(signal.values)[index])
        return Pick("point", Point(signal.id, index, signal.start + index * step, value, step), by)

    if isinstance(ask, PointerAsk):
        if not all(math.isfinite(value) for value in (ask.x, ask.y, ask.scale_x, ask.scale_y)) or ask.scale_x <= 0:
            return Pick("outside")
        near: tuple[float, int, int] | None = None
        for at, signal in enumerate(live):
            found = _near_sample(signal, ask, x_range, y_range)
            if found is not None and (near is None or found[0] < near[0]):
                near = (found[0], at, found[1])
        if near is not None:
            return read_of(live[near[1]], near[2], "near")
        under: tuple[float, int, int] | None = None
        gap = False
        low, high = min(y_range), max(y_range)
        for at, signal in enumerate(live):
            index, over_gap = _under_sample(signal, ask, x_range)
            gap = gap or over_gap
            if index is None:
                continue
            held = min(max(float(np.asarray(signal.values)[index]), low), high)
            away = abs(held - ask.y) * ask.scale_y
            if under is None or away < under[0]:
                under = (away, at, index)
        if under is not None:
            return read_of(live[under[1]], under[2], "under")
        return Pick("no-value" if gap else "outside")
    signal = next((item for item in live if item.id == ask.line), None)
    if signal is None:
        return Pick("no-point")
    count, step = len(signal.values), 1.0 / signal.rate
    values = np.asarray(signal.values)

    def read(index: int) -> Pick:
        return read_of(signal, index, None)

    def inside(index: int) -> bool:
        return 0 <= index < count and bool(_inside(np.asarray(signal.start + index * step), x_range))

    if isinstance(ask, StepAsk):
        way = 1 if ask.steps > 0 else -1
        index, left = ask.index, abs(ask.steps)
        while left:
            index += way
            if not inside(index):
                return Pick("outside")
            # A sample with no value is stepped over, as a line's point with none is.
            if math.isfinite(float(values[index])):
                left -= 1
        return read(index)
    index = int(round((ask.x - signal.start) * signal.rate))
    if not inside(index) or signal.start + index * step != ask.x or not math.isfinite(float(values[index])):
        return Pick("no-point")
    return read(index)


# --- A bins lane (a distribution): its bars, rows and role lines as the lines ``pick`` reads ------------------------


def bin_lines(
    bars: str,
    rows: str,
    edges: np.ndarray,
    counts: np.ndarray | None,
    values: np.ndarray,
    levels: np.ndarray | None,
    marks: Sequence[tuple[str, float]],
    top: float,
    across: tuple[float, float],
) -> tuple[PickLine, ...]:
    """What a bins lane holds to be read, in the order a tie goes by, for ``pick`` (the one rule of every line: a
    bar is read as a point at its top, 第 5 節 エ):

    - over bars (``counts``): each bin with a row as a point at the middle of its part on screen over ``across``
      (``bar_places``) and its count (an empty bin has no bar
      to read), then each row as a point at its value on the foot of the lane (the ticks under the bars);
    - over dots (``levels``): each row as a point at its value, half a count above the level it is stacked on;
    - then each role line (``marks``: its id and value) as its two ends, the foot and the ``top`` of the lane.
    """
    values = np.asarray(values, dtype=np.float64)
    lines: list[PickLine] = []
    if counts is not None:
        tops = np.where(np.asarray(counts) > 0, np.asarray(counts, dtype=np.float64), np.nan)
        lines.append(PickLine(bars, bar_places(edges, across), tops, False))
        lines.append(PickLine(rows, values, np.zeros(values.size), False))
    else:
        assert levels is not None
        lines.append(PickLine(rows, values, dot_places(levels), False))
    for line, value in marks:
        lines.append(PickLine(line, np.array([value, value]), np.array([0.0, top]), False))
    return tuple(lines)


def bin_under(edges: np.ndarray, x: float) -> int | None:
    """The bin a place on the value axis is in (None off the axis): what a click picks where the pointer reads no
    point, by the same edges the rows are counted by."""
    if not (math.isfinite(x) and float(edges[0]) <= x <= float(edges[-1])):
        return None
    return int(bin_of(edges, x))
