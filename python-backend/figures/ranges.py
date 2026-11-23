"""計算イ: a lane's confirmed range (確定範囲). The one function is ``confirmed_range``.

The ends the request specifies (made by layer 3, src/webview/figure/fieldWindow.ts / R9) are used exactly as
received: never rounded again here (第 1 節, 第 5 節 イ). An end not specified is decided from the answers before any
thinning (R9), never from drawn points (rule B: this file never sees a ``Drawn``):

- across: the axis's limits the answer says (a spectrum: 20 Hz to the Nyquist frequency);
- a level line's value axis: every value of the lines over the whole axis
  (finite, above the silent floor), each end rounded out to the finest 5/10/20/25 dB step giving at most six steps,
  never more than 100 dB under the top; with no value, −100 to 0 dB. A specified top leaves the bottom at most 100 dB
  under it;
- a Δ in dB: symmetric about 0, at least ±6 dB, rounded up to 4, 8 or 20 dB;
- the other quantities' value axes: a coherence 0 to 1; a correlation −1 to 1; a
  cepstrum ± its largest magnitude with a little room (5%), to a round end; any other value (an RMS, a loudness) its
  lowest to its highest with a little room (5% of the span), to round ends. A Δ of them: ± its largest magnitude
  with a little room, to a round end.

A point at or under 0 across is left out of the values looked at only where across is a frequency or a quefrency
(0 Hz, a cepstrum's first coefficient): time and lag have points there.

The automatic value range is taken over the whole axis, not only the part across that is confirmed: the value axis
does not jump as the axis across is zoomed, and is zoomed on its own.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from figures.levels import SILENT_DB
from figures.thinning import cells_on_screen

#: A level axis spans at most this many dB (ticks.HEATMAP_DB_SPAN).
DB_SPAN = 100.0
DB_STEPS = (5.0, 10.0, 20.0, 25.0)
DB_MAX_STEPS = 6
#: The quantities whose values are dB: the silent floor applies, their Δ is a level Δ.
DB_QUANTITIES = ("level", "gain")


@dataclass(frozen=True)
class Ends:
    """One axis's ends: a specified range (either end may be None: not specified) or a confirmed one."""

    low: float | None
    high: float | None


@dataclass(frozen=True)
class ConfirmedRange:
    x: tuple[float, float]
    y: tuple[float, float]


def _level_auto(low: float, high: float) -> tuple[float, float]:
    if not math.isfinite(high):
        return -100.0, 0.0

    def edges(step: float) -> tuple[float, float]:
        top = math.ceil(high / step) * step or 0.0
        return max(math.floor(low / step) * step, top - DB_SPAN) or 0.0, top

    step = next(
        (size for size in DB_STEPS if (edges(size)[1] - edges(size)[0]) / size <= DB_MAX_STEPS),
        DB_STEPS[-1],
    )
    bottom, top = edges(step)
    return (bottom, top) if top > bottom else (bottom - step, top)


def _delta_auto(low: float, high: float) -> tuple[float, float]:
    edge = 6.0
    if math.isfinite(high):
        edge = max(edge, abs(low), abs(high))
    unit = 20.0 if edge > 40 else 8.0 if edge > 16 else 4.0
    rounded = math.ceil(edge / unit) * unit
    return -rounded, rounded


def _symmetric_auto(low: float, high: float) -> tuple[float, float]:
    """± the largest magnitude with a little room, to a round end (±0.021 → ±0.022); ±1 with no value or all 0."""
    reach = max(abs(low), abs(high)) * 1.05 if math.isfinite(high) else 0.0
    return nice_range(-(reach or 1.0), reach or 1.0)


def _value_auto(quantity: str, low: float, high: float) -> tuple[float, float]:
    """The automatic value range of a quantity that is not in dB."""
    if quantity == "coherence":
        return 0.0, 1.0
    if quantity == "correlation":
        return -1.0, 1.0
    if quantity == "phase":
        # Degrees, a whole turn (the pair figure's fixed axis).
        return -180.0, 180.0
    if quantity == "cepstrum":
        return _symmetric_auto(low, high)
    if not math.isfinite(high):
        return -100.0, 0.0
    pad = (high - low) * 0.05 or abs(high) * 0.1 or 1.0
    return nice_range(low - pad, high + pad)


def _extent(
    lines: Sequence[tuple[np.ndarray, np.ndarray]], x_limits: tuple[float, float], floor: bool, positive: bool
) -> tuple[float, float]:
    low, high = math.inf, -math.inf
    for xs, values in lines:
        xs = np.asarray(xs, dtype=np.float64)
        values = np.asarray(values, dtype=np.float64)
        keep = (xs >= x_limits[0]) & (xs <= x_limits[1]) & np.isfinite(values)
        if positive:
            keep &= xs > 0
        if floor:
            keep &= values > SILENT_DB
        if keep.any():
            low, high = min(low, float(values[keep].min())), max(high, float(values[keep].max()))
    return low, high


def _ends(specified: Ends, auto: tuple[float, float], log: bool = False) -> tuple[float, float]:
    """One axis's confirmed ends: a specified end exactly, the other the automatic one. Where that one would meet or
    cross the specified end (the answers changed under a range specified at one end only), the other end is the
    specified one widened by the automatic range's own extent (on a log axis, by its ratio): a confirmed range is
    never inverted. The one place this is decided (class 3); both ends specified are the
    request's own (service.py refuses them inverted)."""
    low = specified.low if specified.low is not None else auto[0]
    high = specified.high if specified.high is not None else auto[1]
    if high > low or (specified.low is not None and specified.high is not None):
        return low, high
    if log:
        ratio = auto[1] / auto[0]
        return (low, low * ratio) if specified.low is not None else (high / ratio, high)
    width = auto[1] - auto[0]
    return (low, low + width) if specified.low is not None else (high - width, high)


def confirmed_range(
    lines: Sequence[tuple[np.ndarray, np.ndarray]],
    quantity: str,
    delta: bool,
    x_limits: tuple[float, float],
    specified_x: Ends,
    specified_y: Ends,
    *,
    log: bool = True,
    positive: bool = True,
) -> ConfirmedRange:
    """The lane's confirmed range (計算イ) from its lines' answers (xs, values before thinning), what they measure
    (``quantity``; ``delta``: a Δ lane), the axis's limits across and the ends the request specified. ``log``: across
    is logarithmic; ``positive``: a point at or under 0 across is no value (a frequency, a quefrency)."""
    x = _ends(specified_x, (float(x_limits[0]), float(x_limits[1])), log=log and x_limits[0] > 0)
    in_db = quantity in DB_QUANTITIES
    low, high = _extent(lines, x_limits, in_db and not delta, positive)
    if delta:
        y = _ends(specified_y, _delta_auto(low, high) if in_db else _symmetric_auto(low, high))
    elif not in_db:
        y = _ends(specified_y, _value_auto(quantity, low, high))
    else:
        auto = _level_auto(low, high)
        if specified_y.low is None and specified_y.high is not None:
            # A specified top leaves the bottom at most 100 dB under it (figureModel.levelLineRange).
            auto = (max(auto[0], specified_y.high - DB_SPAN), auto[1])
        y = _ends(specified_y, auto)
    return ConfirmedRange(x, y)


# --- Round ends (R9): the one rule of every automatic range that is not a level line's -----------------------------


def _round_off(value: float) -> float:
    """Rounded to 12 significant digits (and −0 to 0), so −120 never comes back as −120.00000000000001."""
    return float(f"{value:.12g}") + 0.0


def _nice_on_step(low: float, high: float) -> tuple[float, float, float | None]:
    """``low`` … ``high`` widened outward to round ends, and the step they are on (None: its own ends are kept): the
    coarsest step of 1, 2 or 5 times a power of ten (at most a fifth of the span) that moves neither end by more
    than 8% of the span (ticks.ts niceRangeOnStep, moved here: the ends are decided in Python only)."""
    if not (math.isfinite(low) and math.isfinite(high) and high > low):
        return low, high, None
    span = high - low
    slack = span * 0.08
    power = 10.0 ** math.floor(math.log10(span / 5))
    while True:
        for size in (5, 2, 1):
            step = size * power
            if step > span / 5 * (1 + 1e-9):
                continue
            wide_low = _round_off(math.floor(_round_off(low / step)) * step)
            wide_high = _round_off(math.ceil(_round_off(high / step)) * step)
            if step <= slack or (wide_high - high <= slack and low - wide_low <= slack):
                if wide_high > wide_low and wide_low <= low and wide_high >= high:
                    return wide_low, wide_high, step
                return low, high, None
        power /= 10


def nice_range(low: float, high: float) -> tuple[float, float]:
    """An automatic range widened outward to round ends (R9): −42.7 … −18.3 reads −44 … −16."""
    wide_low, wide_high, _step = _nice_on_step(low, high)
    return wide_low, wide_high


def colour_range(low: float, high: float) -> tuple[float, float]:
    """A dB image's automatic colour range (計算イ「熱図の色の幅」) from its answers' lowest and highest value: at
    most 100 dB after rounding. The top is the highest value rounded up to a round tick; the bottom the lowest
    rounded down, but no lower than 100 dB under the rounded top (ticks.ts heatmapDbRange, moved here)."""
    bottom = max(low, high - DB_SPAN)
    wide_low, wide_high, step = _nice_on_step(bottom, high if high > bottom else bottom + 1)
    if step is None or wide_high - wide_low <= DB_SPAN:
        return wide_low, wide_high
    capped = _round_off(math.ceil(_round_off((wide_high - DB_SPAN) / step)) * step)
    return max(wide_low, capped), wide_high


# --- An image lane (a spectrogram) ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class ImageRange:
    """An image lane's confirmed range: across (time), up (its rows' axis) and its colour axis."""

    x: tuple[float, float]
    y: tuple[float, float]
    colour: tuple[float, float]


@dataclass(frozen=True)
class ImageExtent:
    """The lowest and highest answer cell of an image on screen and, of signed coefficients (a cepstrogram), the
    99th percentile of their magnitudes (as wandas plots it): what a colour range is decided from."""

    low: float
    high: float
    robust: float | None = None


def image_axes(
    x_limits: tuple[float, float], y_limits: tuple[float, float], specified_x: Ends, specified_y: Ends, log: bool
) -> tuple[tuple[float, float], tuple[float, float]]:
    """An image lane's confirmed range across and up (計算イ): the ends the request specified, else the limits
    (of images in one figure: the limits of them all, so their lanes show the same part)."""
    x = _ends(specified_x, (float(x_limits[0]), float(x_limits[1])))
    y = _ends(specified_y, (float(y_limits[0]), float(y_limits[1])), log=log and y_limits[0] > 0)
    return x, y


def image_extent(
    xs: np.ndarray,
    ys: np.ndarray,
    values: np.ndarray,
    x: tuple[float, float],
    y: tuple[float, float],
    *,
    quantity: str = "level",
    log: bool = True,
    positive: bool = True,
) -> ImageExtent | None:
    """The extent of every answer cell on screen over ``x`` × ``y`` (``thinning.cells_on_screen``: any part of it
    inside the range; a level at or under the silent floor, and a missing value, left out): never of the cells
    drawn (R9). None with no value there."""
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    zero = int(np.searchsorted(ys, 0.0, side="right")) if positive else 0
    first_row, last_row = cells_on_screen(ys[zero:], y, log)
    first_column, last_column = cells_on_screen(xs, x, False)
    # The cells on screen, looked at where the answer lies (a slice, never a copy: an image can be hundreds of MiB,
    # and a draw reserves the budget for one of it). The mask is a bit a cell.
    part = np.asarray(values, dtype=np.float64)[zero + first_row : zero + last_row, first_column:last_column]
    keep = (part > SILENT_DB) & (part < np.inf) if quantity in DB_QUANTITIES else np.isfinite(part)
    if not part.size or not bool(keep.any()):
        return None
    low, high = float(part.min(where=keep, initial=np.inf)), float(part.max(where=keep, initial=-np.inf))
    robust = float(np.quantile(np.abs(part[keep]), 0.99, method="lower")) if quantity == "cepstrum" else None
    return ImageExtent(low, high, robust)


def image_colour(quantity: str, extents: Sequence[ImageExtent | None], specified: Ends) -> tuple[float, float]:
    """The colour range of the images that share a scale (計算イ「熱図の色の幅」), from their extents together, so
    their lanes compare at a glance:

    - a level in dB: its top the highest value rounded up, at most 100 dB (``colour_range``);
    - signed coefficients (a cepstrogram): symmetric about 0, to the largest 99th percentile of their magnitudes,
      rounded up to a round end;
    - any other value (a roughness): its extent padded by a twentieth, to round ends.
    """
    found = [extent for extent in extents if extent is not None]
    if quantity in DB_QUANTITIES:
        auto = colour_range(min(e.low for e in found), max(e.high for e in found)) if found else (-DB_SPAN, 0.0)
    elif quantity == "cepstrum":
        edge = max((e.robust or 0.0 for e in found), default=0.0) or 1.0
        top = nice_range(-edge, edge)[1]
        auto = (-top, top)
    elif found:
        low, high = min(e.low for e in found), max(e.high for e in found)
        pad = (high - low) * 0.05 or abs(high) * 0.1 or 1.0
        auto = nice_range(low - pad, high + pad)
    else:
        auto = (0.0, 1.0)
    return _ends(specified, auto)


def image_range(
    xs: np.ndarray,
    ys: np.ndarray,
    values: np.ndarray,
    x_limits: tuple[float, float],
    y_limits: tuple[float, float],
    specified_x: Ends,
    specified_y: Ends,
    specified_colour: Ends,
    *,
    quantity: str = "level",
    log: bool = True,
    positive: bool = True,
) -> ImageRange:
    """One image's confirmed range on its own (``image_axes``, ``image_extent``, ``image_colour`` of it alone)."""
    x, y = image_axes(x_limits, y_limits, specified_x, specified_y, log)
    extent = image_extent(xs, ys, values, x, y, quantity=quantity, log=log, positive=positive)
    return ImageRange(x, y, image_colour(quantity, [extent], specified_colour))


def bins_count_axis(counts: np.ndarray | None, levels: np.ndarray | None) -> tuple[float, float]:
    """A bins lane's count axis (計算イ) from what the lane holds: its bars' counts, or (a group of few, drawn as
    dots) each dot's level."""
    if counts is not None:
        return count_axis(int(counts.max()) if counts.size else 0, 0)
    return count_axis(None, int(levels.max()) + 1 if levels is not None and levels.size else 0)


# --- A band lane (time signals) ------------------------------------------------------------------------------------


def sample_span(start: float, rate: float, count: int, x_range: tuple[float, float]) -> tuple[int, int]:
    """The samples ``[first, after)`` of a signal (sample n at ``start + n / rate``) inside ``x_range``, both ends in
    (a sample on an end is inside)."""
    if count <= 0 or rate <= 0:
        return 0, 0
    first = int(math.ceil((min(x_range) - start) * rate - 1e-9))
    after = int(math.floor((max(x_range) - start) * rate + 1e-9)) + 1
    first, after = max(0, min(count, first)), max(0, min(count, after))
    return first, max(first, after)


def amplitude_range(peak: float) -> tuple[float, float]:
    """A time signal's automatic value range from its largest magnitude (of every sample): ± it with a little room,
    widened to round ends (±0.35, not ±0.34272); ±1 with no sample or silence (waveformLayer.ts waveformRange, moved
    here)."""
    reach = peak * 1.05 if math.isfinite(peak) and peak > 0 else 1.0
    return nice_range(-reach, reach)


def whole_band(
    signals: Sequence[tuple[float, float, np.ndarray]],
    level: float | None = None,
    shared: tuple[float, float] | None = None,
) -> ConfirmedRange:
    """A band lane's automatic range (計算イ) from its signals (start, rate, every sample), with nothing specified:
    across, from the first to the last sample of any of them; up, ± the largest magnitude of EVERY sample of them.

    The range up is never of the part on screen (規則 R16: the automatic range up does not move as the time is
    scrolled or zoomed; the old path's waveformRange and laneAmplitudeRange were of the whole recording's peak).
    Each signal is looked at as it lies (no copy is made of it). ``level``: a guide line up the lane (a trigger's
    level) stays in sight with a little room (5% of it), above or below every signal. ``shared``: the automatic
    range up of the lanes its scale is shared with (``shared_amplitude``), in place of its own."""
    spans = [(start, start + (len(values) - 1) * (1.0 / rate)) for start, rate, values in signals if len(values)]
    whole = (min(low for low, _ in spans), max(high for _, high in spans)) if spans else (0.0, 1.0)
    if not whole[1] > whole[0]:
        whole = (whole[0], whole[0] + 1.0)
    peak = 0.0
    for _start, _rate, values in signals:
        if len(values):
            part = np.asarray(values)
            low, high = float(np.fmin.reduce(part)), float(np.fmax.reduce(part))
            for end in (low, high):
                if math.isfinite(end):
                    peak = max(peak, abs(end))
    if level is not None and math.isfinite(level):
        peak = max(peak, abs(level) * 1.05)
    return ConfirmedRange(whole, shared if shared is not None else amplitude_range(peak))


def band_range(
    signals: Sequence[tuple[float, float, np.ndarray]],
    specified_x: Ends,
    specified_y: Ends,
    level: float | None = None,
    shared: tuple[float, float] | None = None,
    whole: ConfirmedRange | None = None,
) -> ConfirmedRange:
    """A band lane's confirmed range (計算イ): each end specified exactly, every other end the automatic one
    (``whole_band``; ``whole``: that range already made, so a pan of a long recording does not look at every sample
    again). A range specified across (a scroll, a zoom) never changes the range up (規則 R16)."""
    auto = whole if whole is not None else whole_band(signals, level, shared)
    return ConfirmedRange(_ends(specified_x, auto.x), _ends(specified_y, auto.y))


def shared_amplitude(signals: Sequence[tuple[float, float, np.ndarray]]) -> tuple[float, float]:
    """The automatic range up that band lanes of several figures share (the Tracks rows' linked scales): ± the
    largest magnitude of every sample of every one of them (the rows lie at different places of the screen's time,
    and one scale for all of them must not move as one of them is panned)."""
    return whole_band(signals).y


# --- A bins lane (a distribution) ----------------------------------------------------------------------------------


def value_axis(lanes: Sequence[np.ndarray]) -> tuple[float, float]:
    """The value axis the bins lanes of a figure share, from every value they show: its lowest to its highest with
    a little room (4% of the span; of one value alone, 5% of it or 0.5), widened to round ends (R9); 0 to 1 with no
    value (distribution.ts, moved here). A selected range is no part of it, so picking one does not move the axis."""
    values = np.concatenate([np.asarray(lane, dtype=np.float64) for lane in lanes]) if lanes else np.zeros(0)
    low, high = (float(values.min()), float(values.max())) if values.size else (0.0, 1.0)
    pad = (high - low) * 0.04 if high > low else max(abs(low) * 0.05, 0.5)
    return nice_range(low - pad, high + pad)


def count_axis(most: int | None, levels: int) -> tuple[float, float]:
    """A bins lane's count axis, from none: over bars, a little above the tallest (``most`` rows); over dots
    (``most`` None), room for three levels or for as many as are stacked."""
    top = float(max(3, levels)) if most is None else max(1.0, most * 1.08)
    return 0.0, top


def bins_range(whole: tuple[float, float], counts: tuple[float, float], specified_x: Ends) -> ConfirmedRange:
    """A bins lane's confirmed range: across, the part of the value axis specified (the bins stay the whole axis's);
    up, its count axis."""
    return ConfirmedRange(_ends(specified_x, whole), counts)
