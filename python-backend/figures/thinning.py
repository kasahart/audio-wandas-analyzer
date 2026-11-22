"""計算ウ: the points drawn of a line (描く用の点). The one function is ``drawn_line``; its result is a ``Drawn``.

A line is cut into buckets one way (equal on the axis's own scale: log-spaced on a log axis, equal in count on a
linear one) and each bucket keeps its lowest and its highest point, each at its own x (R2). A point with no value
(not finite, or a level at or under the silent floor) is a gap: the line is drawn broken there, never joined across.
Fewer points than two per bucket are all kept. The nearest answer point outside each end of the range across is kept
too (the line reaches the frame's edges; the Figure clips it there).

``Drawn`` is made only here and taken only by figures/picture.py (rule B, checked by scripts/check_figure_imports.py):
the confirmed range, the pick, the headline and the counts never receive drawn points. Its points leave it only by
``Drawn.wire_points``, the one way out, called only by picture.py.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from figures.levels import FLOOR_DB, SILENT_DB


@dataclass(frozen=True, eq=False)
class Drawn:
    """A line's points thinned to be drawn: never an answer, never read, never written as text (第 1 節)."""

    _xs: np.ndarray
    _values: np.ndarray

    def wire_points(self) -> tuple[list[float], list[float | None]]:
        """The points as the picture sends them: xs, and values with a gap as None. Called by picture.py only."""
        values = [float(value) if math.isfinite(value) else None for value in self._values.tolist()]
        return [float(x) for x in self._xs.tolist()], values


def _bucket_edges(n: int, count: int) -> np.ndarray:
    """Edges of ``count`` buckets over ``n`` points, as np.array_split cuts them."""
    if n <= 0 or count <= 0:
        return np.array([0])
    count = min(count, n)
    width, remainder = divmod(n, count)
    sizes = np.full(count, width)
    sizes[:remainder] += 1
    return np.append(np.concatenate(([0], np.cumsum(sizes[:-1]))).astype(int), n)


def _log_buckets(xs: np.ndarray, buckets: int, span: tuple[float, float]) -> np.ndarray:
    low, high = (min(span), max(span)) if min(span) > 0 else (float(xs[0]), float(xs[-1]))
    edges = np.geomspace(low, high, buckets + 1)
    return np.clip(np.searchsorted(edges, xs, side="right") - 1, 0, buckets - 1)


def _with_breaks(picked: np.ndarray, gaps: np.ndarray) -> np.ndarray:
    """``picked`` with, between two of them that have a gap between them, that gap's first index (a break)."""
    if not gaps.size or picked.size < 2:
        return picked
    after = np.searchsorted(gaps, picked[:-1], side="right")
    has = after < gaps.size
    breaks = gaps[np.minimum(after, gaps.size - 1)]
    breaks = breaks[has & (breaks < picked[1:])]
    return np.union1d(picked, breaks)


def _min_max_indices(
    xs: np.ndarray, values: np.ndarray, buckets: int, log: bool, span: tuple[float, float]
) -> np.ndarray:
    buckets = max(1, buckets)
    finite = np.isfinite(values)
    placed = (xs > 0) if log else np.ones(xs.size, dtype=bool)
    kept = np.flatnonzero(finite & placed)
    gaps = np.flatnonzero(~finite & placed)
    if kept.size <= 2 * buckets:
        return _with_breaks(kept, gaps)
    if log:
        bucket = _log_buckets(xs[kept], buckets, span)
    else:
        bucket = np.searchsorted(_bucket_edges(values.size, buckets), kept, side="right") - 1
    kept_values = values[kept]
    starts = np.flatnonzero(np.r_[True, bucket[1:] != bucket[:-1]])
    sizes = np.diff(np.r_[starts, kept.size])
    lowest, highest = np.minimum.reduceat(kept_values, starts), np.maximum.reduceat(kept_values, starts)
    index = np.arange(kept.size)
    first = np.minimum.reduceat(np.where(kept_values == np.repeat(lowest, sizes), index, kept.size), starts)
    last = np.maximum.reduceat(np.where(kept_values == np.repeat(highest, sizes), index, -1), starts)
    return _with_breaks(kept[np.unique(np.concatenate([first, last]))], gaps)


def drawn_line(
    xs: np.ndarray, values: np.ndarray, x_range: tuple[float, float], width: float, log: bool, silent_floor: bool
) -> Drawn:
    """The points of a line (its answer: ``xs``, ``values``) to draw across ``x_range`` in a frame ``width`` CSS px
    wide (計算ウ): one bucket per two pixels, each its lowest and highest point; a gap where there is no value
    (``silent_floor``: a level's −250 dB and below is no value either)."""
    xs = np.asarray(xs, dtype=np.float64)
    values = np.asarray(values, dtype=np.float64)
    low, high = float(min(x_range)), float(max(x_range))
    placed = xs > 0 if log else np.ones(xs.size, dtype=bool)
    inside = np.flatnonzero(placed & (xs >= low) & (xs <= high))
    if silent_floor:
        values = np.where(values > SILENT_DB, values, np.nan)
    buckets = max(1, int(math.ceil(width / 2)))
    picked = inside[_min_max_indices(xs[inside], values[inside], buckets, log, (low, high))]
    # The nearest answer point outside each end, whatever its value: a line crossing a range narrower than one bin,
    # or holding one bin, is drawn to the frame's edges, as the old overlay drew it (its strokes cut at the frame,
    # tests/fixtures/figure_overlay_cases.json `range_edges`). It is drawn, never read: pick.py reads inside the
    # confirmed range only. It is added before the gap rule, so a silent or missing point between it and the range's
    # first (last) point breaks the line there, as it does inside the range.
    before, after = np.flatnonzero(placed & (xs < low)), np.flatnonzero(placed & (xs > high))
    picked = np.union1d(picked, np.concatenate([before[-1:], after[:1]])).astype(int)
    picked = _with_breaks(picked, np.flatnonzero(placed & ~np.isfinite(values)))
    return Drawn(xs[picked], values[picked])


def drawn_bars(xs: np.ndarray, values: np.ndarray, log: bool, silent_floor: bool) -> tuple[Drawn, list[float]]:
    """The bars of a line of bands (its answer: a value per band at its centre) and where they are (配置): every
    band, never thinned (計算ウ leaves a few tens of bars as they are, whatever the width), with the edges each bar is
    drawn between (``cell_edges``: neighbouring bands meet halfway, on a log axis at their geometric mean; one more
    edge than bars). A band with no value (``silent_floor``: a level at the silent floor) is a gap."""
    xs = np.asarray(xs, dtype=np.float64)
    values = np.asarray(values, dtype=np.float64)
    if silent_floor:
        values = np.where(values > SILENT_DB, values, np.nan)
    return Drawn(xs, values), [float(edge) for edge in cell_edges(xs, log).tolist()]


# --- An image lane (a spectrogram): the cells drawn and where they are (描く用のセルと配置) ---------------------------


def cell_edges(axis: np.ndarray, log: bool) -> np.ndarray:
    """The edges of each cell along an axis (配置): halfway between neighbouring points and half the end step past
    each end; on a log axis the geometric mean of two points (100 and 125 Hz meet at 111.8 Hz). ``len(axis) + 1``
    values of the axis. The one rule the cells are drawn and read by (pick.py reads with it)."""
    axis = np.asarray(axis, dtype=np.float64)
    if not axis.size:
        return np.empty(0)
    edges = cell_edge_places(axis, log)
    return np.exp(edges) if log else edges


def cell_edge_places(axis: np.ndarray, log: bool) -> np.ndarray:
    """``cell_edges`` in the axis's own measure (its log on a log axis): what a place is compared with to find its
    cell (pick.cell_index). The one statement of where a cell ends."""
    at = np.log(np.maximum(axis, 1e-12)) if log else axis
    first = at[1] - at[0] if at.size > 1 else 1.0
    last = at[-1] - at[-2] if at.size > 1 else 1.0
    return np.concatenate(([at[0] - first / 2], (at[:-1] + at[1:]) / 2, [at[-1] + last / 2]))


def cells_on_screen(axis: np.ndarray, ends: tuple[float, float], log: bool) -> tuple[int, int]:
    """The cells of ``axis`` (ascending; positive on a log axis) on screen over ``ends`` (配置): the first, and one
    past the last, of the cells any part of which lies inside the range (by their edges, ``cell_edges``). (0, 0)
    with none. The one rule the cells are drawn, read, stepped to and their colour range taken by: a cell cut by
    the range's end is drawn up to it and read there (not only the cells whose centre is inside)."""
    axis = np.asarray(axis, dtype=np.float64)
    if not axis.size:
        return (0, 0)
    edges = cell_edges(axis, log)
    low, high = min(ends), max(ends)
    first = int(np.searchsorted(edges[1:], low, side="right"))
    last = int(np.searchsorted(edges[:-1], high, side="left"))
    return (first, last) if last > first else (0, 0)


def _loudest(levels_db: np.ndarray, axis: int) -> np.ndarray:
    """The highest of the levels along ``axis`` (a missing one is passed over), floored at the level floor (silence
    stays silence). Drawn cells only (第 1 節: 熱図は最大でまとめる): a drawn cell is one of its answer cells, the
    loudest, so a click one frame long in half an hour is drawn at its own level, and the brightest drawn cell is the
    colour range's top (the answer's highest level). An average would draw it tens of dB lower, or not at all."""
    highest = np.fmax.reduce(levels_db, axis=axis, initial=FLOOR_DB)
    return np.maximum(np.nan_to_num(highest, nan=FLOOR_DB, neginf=FLOOR_DB, posinf=-FLOOR_DB), FLOOR_DB)


def _highest(values: np.ndarray, axis: int) -> np.ndarray:
    """The highest of the values along ``axis`` (a missing one is passed over; all missing: missing). A quantity
    with no floor and no sign to keep (a roughness)."""
    return np.fmax.reduce(values, axis=axis)


def _farthest(values: np.ndarray, axis: int) -> np.ndarray:
    """The value of largest magnitude along ``axis``, its sign kept (a missing one is passed over; of two as far
    from 0, the positive one). A signed quantity (a cepstrogram's coefficients, a Δ): a mean would cancel a
    positive and a negative peak, a highest would lose the negative one."""
    low, high = np.fmin.reduce(values, axis=axis), np.fmax.reduce(values, axis=axis)
    return np.where(-low > high, low, high)


def _pooled_columns(plane: np.ndarray, blocks: list[tuple[int, int]], pooling: str) -> np.ndarray:
    """``plane``'s columns pooled in ``blocks`` (each ``[a, b)``, one after the other), as float64: what
    ``POOLS[pooling]`` gives of each block, made in one pass over the part of the answer on screen (the answer
    is not copied, and a picture a scroll step asks is made of thousands of columns: a call a block was most of
    its time). A pick of the answer's own cells either way: the same values."""
    starts = np.array([a for a, _ in blocks], dtype=np.intp)
    part = plane[:, : blocks[-1][1]]
    if pooling == "signed":
        low = np.fmin.reduceat(part, starts, axis=1).astype(np.float64)
        high = np.fmax.reduceat(part, starts, axis=1).astype(np.float64)
        return np.where(-low > high, low, high)
    highest = np.fmax.reduceat(part, starts, axis=1).astype(np.float64)
    if pooling == "level":
        # (``_loudest``: a block of no value is the floor, and nothing is under it.)
        return np.maximum(np.nan_to_num(highest, nan=FLOOR_DB, neginf=FLOOR_DB, posinf=-FLOOR_DB), FLOOR_DB)
    return highest


#: How cells are pooled to be drawn, by what they measure (ImageAnswer.pooling). Each drawn cell is one of its
#: answer cells' own values: nothing is computed of them (第 1 節: 熱図は最大でまとめる).
POOLS = {"level": _loudest, "value": _highest, "signed": _farthest}
#: The decimals a drawn cell is sent to: 0.1 dB of a level; a value not in dB to six.
_CELL_DECIMALS = {"level": 1}


def _band_levels(levels_db: np.ndarray, freqs: np.ndarray, edges: np.ndarray, pool: Any = _loudest) -> np.ndarray:
    """Each column's (levels_db: freqs × columns) level in the bands between ``edges``: the loudest of a band's
    bins (low ≤ f < high; the last band includes its top), or, for a band holding no bin's centre, the one answer
    cell its centre lies in (``_covering``). Never a level between two cells: a drawn cell is always one of the
    answer's own."""
    centres = np.sqrt(edges[:-1] * edges[1:])
    out = np.empty((edges.size - 1, levels_db.shape[1]), dtype=np.float64)
    for index in range(edges.size - 1):
        upper = freqs < edges[index + 1] if index < edges.size - 2 else freqs <= edges[index + 1]
        inside = (freqs >= edges[index]) & upper
        if inside.any():
            out[index] = pool(levels_db[inside], axis=0)
        else:
            out[index] = pool(levels_db[_covering(freqs, float(centres[index]))][np.newaxis], axis=0)
    return out


def _covering(freqs: np.ndarray, at: float) -> int:
    """The row whose cell the frequency ``at`` lies in, by the one rule of where a cell ends on a log axis
    (``cell_edge_places``: what a read finds a cell by, so the colour drawn there and the cell read there are the
    same cell's); the end row past either end."""
    places = cell_edge_places(freqs, True)
    row = int(np.searchsorted(places[1:-1], np.log(max(at, 1e-12)), side="right"))
    return min(max(row, 0), freqs.size - 1)


@dataclass(frozen=True, eq=False)
class DrawnImage:
    """An image's cells pooled to be drawn, and their edges: never an answer, never read, never written as text."""

    _column_edges: np.ndarray
    _row_edges: np.ndarray
    _cells: np.ndarray
    _decimals: int = 1

    def wire_points(self) -> tuple[list[float], list[float], list[list[float | None]]]:
        """The cells as the picture sends them: column edges, row edges (one more than the cells each way) and the
        cells (rows over the row edges), to 0.1 dB (a value not in dB: to six decimals). Called by picture.py only."""
        cells = np.round(self._cells, self._decimals)
        finite = np.isfinite(cells)
        if bool(finite.all()):
            rows = cells.tolist()
        else:
            # A cell with no value is sent as none (looked at as one array, not a cell at a time).
            sent = cells.astype(object)
            sent[~finite] = None
            rows = sent.tolist()
        return [float(x) for x in self._column_edges.tolist()], [float(y) for y in self._row_edges.tolist()], rows


def image_blocks(frames: int, width: float, cell_px: int = 2) -> np.ndarray:
    """The edges of the column blocks ``frames`` columns are pooled in for a frame ``width`` CSS px wide: at most
    one block per ``cell_px`` pixels (never fewer than two), cut as np.array_split cuts them (the bucket rule of
    every time axis, ``_bucket_edges``)."""
    return _bucket_edges(frames, max(2, int(math.ceil(width / cell_px))))


def drawn_image(
    xs: np.ndarray,
    ys: np.ndarray,
    values: np.ndarray,
    x_range: tuple[float, float],
    y_range: tuple[float, float],
    width: float,
    height: float,
    *,
    log: bool = True,
    positive: bool = True,
    pooling: str = "level",
    cell_px: int = 2,
) -> DrawnImage:
    """The cells of an image (its answer: ``values``, rows over ``ys``, columns over ``xs`` s) to draw over
    ``x_range`` × ``y_range`` in a frame ``width`` × ``height`` CSS px (計算ウ). As said for a spectrogram (levels in
    dB over Hz: ``log`` rows, the ``positive`` ones, pooled as a ``level``):

    - across, the answer's columns on screen (``cells_on_screen``: any part of the cell inside the range) in blocks
      of at most one per two pixels
      (``image_blocks``), each block the loudest of its columns (``_loudest``);
    - up, the answer's rows on screen: every row as it is, or, with more rows than one per two pixels, that
      many log-spaced bands between the first and last row there, each the loudest of its rows;
    - each cell's edges are its answer cells' own (``cell_edges``): a block spans exactly the columns it pools.

    Rows on a linear axis (``log`` false: Bark bands, quefrencies) with more than one per two pixels are pooled in
    blocks of neighbouring rows, cut as the columns are. ``pooling`` says how a block is pooled (``POOLS``).
    ``cell_px`` is the pixels a cell takes at least each way where the answer says other than two
    (``ImageAnswer.cell_px``).
    """
    pool = POOLS[pooling]
    decimals = _CELL_DECIMALS.get(pooling, 6)
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    values = np.asarray(values)
    # The rows that are placed: of a frequency or a quefrency axis the positive ones (the rows after any at 0).
    zero = int(np.searchsorted(ys, 0.0, side="right")) if positive else 0
    column_ends = cells_on_screen(xs, x_range, False)
    row_ends = cells_on_screen(ys[zero:], y_range, log)
    columns = np.arange(*column_ends)
    rows = zero + np.arange(*row_ends)
    if not columns.size or not rows.size:
        return DrawnImage(np.empty(0), np.empty(0), np.empty((0, 0)), decimals)
    # Looked at where the answer lies (a slice, not a copy).
    plane = values[:, column_ends[0] : column_ends[1]]
    edges = image_blocks(columns.size, width, cell_px)
    blocks = [(int(a), int(b)) for a, b in zip(edges[:-1], edges[1:], strict=True) if b > a]
    columned = _pooled_columns(plane, blocks, pooling)
    every_column = cell_edges(xs, False)
    column_edges = np.array(
        [every_column[columns[a]] for a, _ in blocks] + [every_column[columns[blocks[-1][1] - 1] + 1]]
    )
    limit = max(1, int(math.ceil(height / cell_px)))
    every_row = cell_edges(ys[zero:], log)
    first = int(rows[0]) - zero
    own_edges = every_row[first : first + rows.size + 1]
    if rows.size <= limit:
        row_edges = own_edges
        cells = columned[rows]
    elif not log:
        cut = _bucket_edges(rows.size, limit)
        groups = [(int(a), int(b)) for a, b in zip(cut[:-1], cut[1:], strict=True) if b > a]
        cells = np.stack([pool(columned[rows[a:b]], axis=0) for a, b in groups], axis=0)
        row_edges = np.array([own_edges[a] for a, _ in groups] + [own_edges[groups[-1][1]]])
    else:
        # The bands cover what the rows there cover (their own outer edges), no further than the range: but as far
        # as the first and last row's own place, so a row the range's end cuts is in a band as every other is (its
        # band is drawn up to the frame's side).
        low = min(max(min(y_range), float(own_edges[0])), float(ys[rows[0]]))
        high = max(min(max(y_range), float(own_edges[-1])), float(ys[rows[-1]]))
        row_edges = np.geomspace(low, high, limit + 1)
        cells = _band_levels(columned[rows], ys[rows], row_edges, pool)
    return DrawnImage(column_edges, row_edges, cells, decimals)


# --- A band lane (a time signal): each bucket's lowest and highest sample -------------------------------------------

#: What a band's making takes beside the signal itself, whatever its length: the samples are looked at where they lie
#: (never copied), so only the drawn points and their indices: what a draw reserves of the budget for it.
BAND_WORK_BYTES = 1 << 20


#: Buckets of a band a CSS px. A band is drawn as a line through each bucket's lowest and highest sample at their
#: own times, so two neighbouring extremes can lie up to two buckets apart: with a bucket per two pixels (a line's
#: density) a steady tone was drawn as a zigzag with the background showing through, which read as a thinning gone
#: wrong; with two buckets a pixel the strokes lie closer than the line is wide, and a dense signal is a filled band
#: (its upper and lower edge still each bucket's real extreme). Four points a pixel at most.
BAND_BUCKETS_PER_PX = 2


def band_extremes(samples: np.ndarray, buckets: int) -> tuple[np.ndarray, np.ndarray]:
    """Per bucket (``_bucket_edges``: as np.array_split cuts them) of ``samples``: the index of its lowest sample and
    of its highest (the first of equal samples; a sample with no value counts as both, so the band is broken
    there). Indices into ``samples``, never times. The samples are looked at
    where they lie, as two tables of equal buckets (the longer buckets first): nothing as long as the signal is
    made, however long it is."""
    samples = np.asarray(samples)
    n = int(samples.size)
    count = min(max(1, buckets), n)
    lowest, highest = np.empty(count, dtype=np.int64), np.empty(count, dtype=np.int64)
    if not n:
        return lowest, highest
    width, longer = divmod(n, count)
    cut = longer * (width + 1)
    for part, first, rows, size in (
        (samples[:cut], 0, longer, width + 1),
        (samples[cut:], longer, count - longer, width),
    ):
        if not rows:
            continue
        table = part.reshape(rows, size)
        starts = (cut if first else 0) + np.arange(rows, dtype=np.int64) * size
        # argmin and argmax answer the first of equal samples, and the first sample with no value (NaN) as both.
        lowest[first : first + rows] = starts + table.argmin(axis=1)
        highest[first : first + rows] = starts + table.argmax(axis=1)
    return lowest, highest


def drawn_band(start: float, rate: float, values: np.ndarray, x_range: tuple[float, float], width: float) -> Drawn:
    """The points of a time signal (sample n at ``start + n * (1 / rate)``) to draw across ``x_range`` in a frame
    ``width`` CSS px wide (計算ウ): of the samples inside the range (both ends in), ``BAND_BUCKETS_PER_PX`` buckets a
    pixel, each its lowest and its highest sample at that sample's own time; fewer samples than two per bucket are
    all kept. The sample outside each end is kept too (the line reaches the frame's edges), as ``drawn_line`` keeps
    it."""
    n = int(len(values))
    step = 1.0 / rate if rate > 0 else 0.0
    if not n or step <= 0:
        return Drawn(np.empty(0), np.empty(0))
    first = max(0, min(n, int(math.ceil((min(x_range) - start) * rate - 1e-9))))
    after = max(first, min(n, int(math.floor((max(x_range) - start) * rate + 1e-9)) + 1))
    buckets = max(1, int(math.ceil(width * BAND_BUCKETS_PER_PX)))
    if after - first <= 2 * buckets:
        picked = np.arange(first, after)
    else:
        lowest_at, highest_at = band_extremes(np.asarray(values)[first:after], buckets)
        picked = first + np.union1d(lowest_at, highest_at)
    picked = np.union1d(picked, [index for index in (first - 1, after) if 0 <= index < n]).astype(np.int64)
    return Drawn(start + picked * step, np.asarray(values)[picked].astype(np.float64))


# --- A bins lane (a distribution): its placement (配置). Nothing is thinned: bars are counts, a row is one point ------

#: Bins across the whole value axis: the same for every lane, so their bars line up (distribution.ts, moved here).
BINS = 48
#: A lane of fewer rows than this is drawn as one dot per row: a histogram of a few says nothing.
DOTS_BELOW = 12
#: Dots nearer each other across than the value axis's span over this are stacked upward.
DOT_SPACINGS = 60


def bin_edges(low: float, high: float, bins: int = BINS) -> np.ndarray:
    """The bins' edges across the value axis (``bins + 1`` of them): bin ``b`` is from ``edges[b]`` to
    ``edges[b + 1]``. The one array the bars are drawn between, the rows are counted by (``bin_of``), a bar's
    readout writes and a click picks: none of them works an edge out again."""
    edges = low + np.arange(bins + 1, dtype=np.float64) * ((high - low) / bins)
    edges[-1] = high
    return edges


def bin_width(edges: np.ndarray) -> float:
    """How wide a bin is: the step a readout takes its digits from."""
    return (float(edges[-1]) - float(edges[0])) / (edges.size - 1)


def bin_centres(edges: np.ndarray) -> np.ndarray:
    """Where each bin's bar stands across (its middle)."""
    return float(edges[0]) + (np.arange(edges.size - 1, dtype=np.float64) + 0.5) * bin_width(edges)


def bar_places(edges: np.ndarray, across: tuple[float, float]) -> np.ndarray:
    """Where each bin's bar is read across (配置): the middle of the part of it on screen over ``across`` (its own
    middle, with all of it on screen or none), so a bar a zoom cuts is read where it is drawn."""
    low = np.maximum(edges[:-1], min(across))
    high = np.minimum(edges[1:], max(across))
    return np.where(high > low, (low + high) / 2, bin_centres(edges))


def bin_of(edges: np.ndarray, values: np.ndarray | float) -> np.ndarray:
    """The bin each value is in: from its low edge up to, not including, its high edge (a value on an edge is in
    the bin above it); the last bin holds the axis's top too. A value past either end is held in the end bin."""
    at = np.searchsorted(edges, np.asarray(values, dtype=np.float64), side="right") - 1
    return np.clip(at, 0, edges.size - 2)


def dot_places(levels: np.ndarray) -> np.ndarray:
    """Where up the count axis each stacked dot is (配置): the middle of the level it is stacked on. The one place it
    is decided: the picture carries it (a member's ``at``) and a read looks for a dot there (pick.py)."""
    return np.asarray(levels, dtype=np.float64) + 0.5


def stacked_levels(values: np.ndarray, low: float, high: float) -> np.ndarray:
    """How high each dot is stacked (0: on the lowest row), for ``values`` in rising order: a dot goes on the lowest
    level whose last dot is at least a sixtieth of the axis away, so dots that would cover each other can each be
    pointed at (entryDistribution.ts, moved here)."""
    spacing = (high - low) / DOT_SPACINGS
    last: list[float] = []
    levels = np.zeros(len(values), dtype=np.int64)
    for index, value in enumerate(np.asarray(values, dtype=np.float64).tolist()):
        level = next((at for at, before in enumerate(last) if value - before >= spacing), len(last))
        if level == len(last):
            last.append(value)
        else:
            last[level] = value
        levels[index] = level
    return levels
