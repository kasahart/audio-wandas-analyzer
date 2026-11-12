"""A base group's median and a recording's difference from its base, from the Frames' full resolution.

The comparison draws each recording's step as stage_view.py decimates it for the screen. Decimation is only for
drawing: a group's median and a difference are taken of the Frames' own values (every bin, sample, column and
coefficient, channels combined as each picture combines them), and only the result is decimated to be drawn. A
scan with a step keeps that step's values here (``StageData``, under the key its picture carries as ``data``);
``combine`` takes the keys of a base's recordings and of the recording compared.

A time signal is compared as its own samples: the comparison makes no level of it. Its difference is compare −
base sample by sample (a ChannelFrame subtraction; for a group, minus the sample-wise median) over the common
length, and recordings at different sample rates have no difference. A level comes only from a wandas step.
"""

from __future__ import annotations

import threading
import warnings
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Literal, NotRequired, TypedDict

import numpy as np
from wandas.frames import CrossSpectralFrame, TransferFunctionFrame
from wandas.frames.segments import ChannelFrameSegments

import analysis_spec as spec
import stage_view as sv
from decimator import bucket_edges
from full_read import SILENT_DB, StagePoints, StageRead, read_cells, read_line
from level_identity import LevelIdentity, level_identity
from stage_view import (
    FrameReading,
    Mode,
    StageDetail,
    StageLevelBins,
    StagePeak,
    StageValueRange,
    StageView,
)

#: How much of the Frames' values the backend keeps for the comparison's medians and differences. The least
#: recently used go first; a picture asked for again (zooming, another compared recording) uses what is kept.
#: A base group the comparison scans without asking (up to 30 recordings or 30 minutes) fits: half an hour of a
#: 48 kHz signal's level, or of a spectrogram at the default hop. The browser keeps less (browser_service.py).
STAGE_DATA_BUDGET_BYTES = 768 * 1024 * 1024
#: A difference of dB levels to a hundredth; small linear values (cepstral coefficients, coherence) keep more.
DB_DIFF_DECIMALS = 2
VALUE_DIFF_DIGITS = 6

DB_QUANTITIES = ("level", "gain")


@dataclass(frozen=True)
class StageData(FrameReading):
    """One recording's step at full resolution, channels combined as its picture combines them: the Frame's reading
    (stage_view.FrameReading, whose fields and x axis it keeps) with the picture's template and the recording's
    calibration. A median or a difference is a StageData too: the first recording's, with other ``values``.

    ``values`` is a line over ``xs`` or an image (rows over ``ys``, columns over ``xs``). For ``signal`` (the sound
    itself) it is every sample, channels averaged, at ``start + n / rate``, with no ``xs`` (half an hour at 48 kHz
    fits the budget). Every value is kept float64, as wandas computes it: a median or a difference of float32 values
    would round away a difference of a float32 step (0.5 against 0.5 + 2⁻²⁴).
    """

    #: The recording's whole picture: the keys a median or a difference keeps (frame, kind, axes, unit, pair).
    view: StageView = field(kw_only=True)
    #: The recording's channel unit and reference, whatever the Frame (a level's dB are re that reference): values
    #: are combined only between recordings calibrated alike.
    calibration: LevelIdentity = field(default=("", 1.0, ""), kw_only=True)

    @property
    def nbytes(self) -> int:
        extra = (self.ys.nbytes if self.ys is not None else 0) + (self.rows.nbytes if self.rows is not None else 0)
        return int(self.xs.nbytes + self.values.nbytes + extra)


class CombineResult(TypedDict):
    ok: bool
    #: The keys no longer kept (the scans that made them are asked for again).
    missing: NotRequired[list[str]]
    #: The base group's median (a base of one recording is its own picture, which the comparison has).
    base: NotRequired[StageView]
    diff: NotRequired[StageView]
    #: Why there is no ``diff`` when it is not the axes: time signals at other sample rates have no sample Δ.
    noDelta: NotRequired[Literal["rate", "unit"]]
    #: With a read: the full-resolution points the plot reads under its pointer or steps to (full_read.py).
    points: NotRequired[StagePoints]


class _Store:
    """The kept StageData by key, least recently used dropped first beyond the budget. Shared by the workers."""

    def __init__(self, budget: int) -> None:
        self._budget = budget
        self._items: OrderedDict[str, StageData] = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    def resize(self, budget: int) -> None:
        with self._lock:
            self._budget = budget
            while self._bytes > self._budget and self._items:
                _, dropped = self._items.popitem(last=False)
                self._bytes -= dropped.nbytes

    def put(self, key: str, data: StageData) -> None:
        with self._lock:
            if key in self._items:
                self._items.move_to_end(key)
                return
            if data.nbytes > self._budget:
                return
            self._items[key] = data
            self._bytes += data.nbytes
            while self._bytes > self._budget:
                _, dropped = self._items.popitem(last=False)
                self._bytes -= dropped.nbytes

    def get(self, key: str) -> StageData | None:
        with self._lock:
            data = self._items.get(key)
            if data is not None:
                self._items.move_to_end(key)
            return data

    def has(self, key: str) -> bool:
        with self._lock:
            return key in self._items

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._bytes = 0


STORE = _Store(STAGE_DATA_BUDGET_BYTES)


def _template(view: StageView) -> StageView:
    drawn = ("xs", "ys", "values", "matrix", "whole", "waveform", "events", "detail", "data")
    return {key: value for key, value in view.items() if key not in drawn}  # type: ignore[return-value]


def _calibration(frame: object) -> LevelIdentity:
    """What ``frame``'s values are in (level_identity: unit, reference, its label; a trigger's events: their first
    event's; a transfer function or a cross spectrum: its drawn pair's)."""
    if isinstance(frame, ChannelFrameSegments):
        frame = frame[0] if len(frame) else None
    if isinstance(frame, (TransferFunctionFrame, CrossSpectralFrame)):
        # A transfer function's values are re its pair's unit ratio (a gain of one unit is re 1), a cross spectrum's
        # re its drawn pair's reference, not either channel's level (nor row 0's, which against the base slot is the
        # base's own auto-spectrum): two recordings' pictures compare when their drawn pairs' identities are alike.
        row = sv._cross_pair(frame)
        if row is not None:
            domain = frame.pair_domains[row]
            if isinstance(frame, TransferFunctionFrame) or domain.unit != "1":
                return level_identity(domain.unit, domain.reference, frame.channels[row].level_reference.label)
            # A cross spectrum of one unit is in its drawn row's level (stage_view names it so).
            return _channel_identity(frame.channels[row])
    channels = getattr(frame, "channels", None)
    if not channels:
        return level_identity("", 1.0, "")
    return _channel_identity(channels[0])


def _channel_identity(first: object) -> LevelIdentity:
    """One channel's level identity: its unit, reference value and level reference's label."""
    reference = getattr(first, "level_reference", None)
    return level_identity(
        getattr(first, "unit", ""), getattr(first, "ref", 1.0) or 1.0, getattr(reference, "label", "")
    )


def stage_data(
    frame: object, view: StageView, signal_s: float | None = None, reading: FrameReading | None = None
) -> StageData | None:
    """The full-resolution values behind ``view`` (stage_view of ``frame``); None for a Frame not drawn.

    They are the Frame's reading (stage_view.read_frame), field for field: this function interprets no Frame itself,
    so what is read here is on the axes the picture was drawn on. ``reading``: the one the picture was drawn from,
    when the caller has it, so the Frame is not computed again."""
    if view.get("kind") == "none":
        return None
    if reading is None:
        reading = sv.read_frame(frame, signal_s)
    if reading is None:
        return None
    return StageData(
        mode=reading.mode,
        xs=reading.xs,
        values=reading.values,
        ys=reading.ys,
        whole=reading.whole,
        nyquist=reading.nyquist,
        start=reading.start,
        rate=reading.rate,
        ref=reading.ref,
        rows=reading.rows,
        event_ids=reading.event_ids,
        pair_row=reading.pair_row,
        view=_template(view),
        calibration=_calibration(frame),
    )


# --- Drawing: what the comparison's lines and images are decimated to -------------------------------------


def difference_line(
    xs: np.ndarray, values: np.ndarray, buckets: int, log: bool, span: Sequence[float] | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """A difference's line in at most ``buckets`` buckets: each bucket's smallest and largest value, each at its
    own x (sv.min_max_line), so no difference is averaged away.

    The one reduction of every difference line: drawing a difference otherwise changes it here only.
    """
    return sv.min_max_line(xs, values, buckets, log, span)


def _peak_blocks(values: np.ndarray, count: int) -> tuple[np.ndarray, np.ndarray]:
    """The last axis in at most ``count`` blocks, each the (signed) value of largest magnitude, ignoring NaN."""
    edges = bucket_edges(values.shape[-1], count)
    filled = np.nan_to_num(values, nan=0.0)
    picked = [
        np.take_along_axis(block, np.argmax(np.abs(block), axis=-1)[..., np.newaxis], axis=-1)[..., 0]
        for block in (filled[..., start:end] for start, end in zip(edges[:-1], edges[1:], strict=True))
    ]
    return np.stack(picked, axis=-1), edges


def _band_peaks(rows: np.ndarray, axis: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """``rows`` (axis × columns) in the bands between ``edges``: each band's value of largest magnitude, or for a
    band with no row inside it, the values interpolated at its centre (as band_levels interpolates)."""
    centres = np.sqrt(edges[:-1] * edges[1:])
    out = np.empty((edges.size - 1, rows.shape[1]), dtype=np.float64)
    for index in range(edges.size - 1):
        upper = axis < edges[index + 1] if index < edges.size - 2 else axis <= edges[index + 1]
        inside = (axis >= edges[index]) & upper
        if inside.any():
            block = np.nan_to_num(rows[inside], nan=0.0)
            out[index] = np.take_along_axis(block, np.argmax(np.abs(block), axis=0)[np.newaxis], axis=0)[0]
        else:
            out[index] = [np.interp(centres[index], axis, column) for column in rows.T]
    return out


def _block_times(times: np.ndarray, edges: np.ndarray) -> np.ndarray:
    return np.array([float(np.mean(times[start:end])) for start, end in zip(edges[:-1], edges[1:], strict=True)])


def _significant(values: np.ndarray, digits: int) -> np.ndarray:
    """``values`` to ``digits`` significant figures, so a difference of small values (µPa) is never rounded away."""
    with np.errstate(divide="ignore", invalid="ignore"):
        magnitude = np.floor(np.log10(np.abs(values)))
    scale = 10.0 ** (digits - 1 - np.where(np.isfinite(magnitude), magnitude, 0.0))
    return np.round(values * scale) / scale


def _rounded(values: np.ndarray, quantity: str | None, diff: bool) -> np.ndarray:
    if not diff:
        return values
    if quantity in DB_QUANTITIES:
        return np.round(values, DB_DIFF_DECIMALS)
    return _significant(values, VALUE_DIFF_DIGITS)


def _bounds(detail: StageDetail | None) -> tuple[list[float] | None, int]:
    return ([float(value) for value in detail["x"]], int(detail["points"])) if detail else (None, 0)


def _line(data: StageData, detail: StageDetail | None, diff: bool) -> tuple[np.ndarray, np.ndarray]:
    """A line's xs and values as drawn: a median as the recordings' own pictures are, a difference by
    difference_line."""
    bounds, points = _bounds(detail)
    if data.mode == "signal":
        return _signal_line(data, bounds, points, diff)
    mode = data.mode
    if mode == "bands":
        return data.xs, data.values
    if mode in ("spectrum", "coherence") and not diff:
        # As each recording's own picture (stage_view.spectrum_line).
        if bounds is None:
            line = sv.spectrum_line(
                data.xs, data.values, [spec.SPECTRUM_MIN_HZ, data.nyquist], sv.SPECTRUM_LINE_BUCKETS
            )
        else:
            line = sv.spectrum_line(data.xs, data.values, bounds, points // 2)
        return line
    xs, values = data.xs, data.values
    if bounds is not None:
        keep = sv._inside(xs, bounds)
        if mode in ("spectrum", "coherence"):
            keep &= xs > 0
        xs, values = xs[keep], values[keep]
    log = data.view.get("xScale") == "log"
    if diff:
        if mode in ("spectrum", "coherence") and bounds is None:
            inside = (xs >= spec.SPECTRUM_MIN_HZ) & (xs <= data.nyquist)
            return difference_line(
                xs[inside], values[inside], sv.SPECTRUM_LINE_BUCKETS, True, [spec.SPECTRUM_MIN_HZ, data.nyquist]
            )
        if mode == "cepstrum" and xs.size and xs[0] == 0:
            rest = difference_line(xs[1:], values[1:], _line_buckets(mode, points), log)
            return np.concatenate([xs[:1], rest[0]]), np.concatenate([values[:1], rest[1]])
        return difference_line(xs, values, _line_buckets(mode, points), log, bounds)
    if mode == "series":
        return sv._envelope(xs, values, points or sv.LEVEL_SERIES_MIN_SAMPLES)
    if mode == "cepstrum":
        return sv._cepstrum_envelope(xs, values, points or sv.QUEFRENCY_POINTS)
    if mode == "correlation":
        return sv._envelope(xs, values, points or sv.LAG_POINTS)
    if mode == "events":
        return sv._envelope(xs, values, points or sv.EVENT_POINTS)
    raise ValueError(f"not a line: {mode}")


def _signal_range(data: StageData, bounds: Sequence[float] | None) -> tuple[int, int]:
    """The samples of a signal inside ``bounds`` (s), as indices: no array of the samples' times is made."""
    return sv.index_range(data, bounds)


def _signal_line(
    data: StageData, bounds: Sequence[float] | None, points: int, diff: bool
) -> tuple[np.ndarray, np.ndarray]:
    """A signal's line as a series over time is drawn (sv.signal_line; a difference by difference_line's buckets),
    taken by index from the samples inside ``bounds``: only the points drawn get a time, from the samples' own axis
    (sv.x_at)."""
    first, last = _signal_range(data, bounds)
    if not diff:
        return sv.signal_line(data, first, last, points or sv.LEVEL_SERIES_MIN_SAMPLES)
    values = data.values[first:last]
    # On a linear axis the buckets are counts of samples (decimator.bucket_starts): no xs are needed.
    picked = sv.min_max_indices(
        np.broadcast_to(np.float64(0.0), values.shape), values, _line_buckets("series", points), False
    )
    return sv.x_at(data, first + picked), values[picked]


#: How many stretches of the axis a line's level on screen is kept in (StageView ``levelBins``).
LEVEL_BINS = 256


def level_bins(data: StageData, detail: StageDetail | None = None) -> StageLevelBins | None:
    """The power of a compared line's every value, in ``LEVEL_BINS`` stretches of the axis it is drawn over (the
    whole picture, or ``detail``'s part): for the plot to draw the quietest line on top over whatever part is on
    screen (R6) from the values before they were thinned to be drawn. A signal's power is the mean square of its
    samples (on the amplitude axis the signals share); a level's or gain's, the mean of 10^(dB/10), silence (−250
    dB and below) counted as no power. None for a line of other values (a coherence) or an image.

    The one place level bins are made: each states which of the two its ``power`` is (``of``: ``"square"`` or
    ``"dbPower"``), from the reading's kind, and the webview reads the level on screen as that one quantity at every
    zoom (R6): the exact read of a window an edge cuts (read_points, full_read.read_level) asks for the same ``of``."""
    bounds, _ = _bounds(detail)
    if data.mode == "signal":
        first, last = _signal_range(data, bounds)
        if last <= first:
            return None
        edges = np.linspace(first, last, min(LEVEL_BINS, last - first) + 1).round().astype(np.int64)
        powers, counts = [], []
        for start, end in zip(edges[:-1], edges[1:], strict=True):
            block = data.values[start:end]
            finite = block[np.isfinite(block)]
            counts.append(int(finite.size))
            powers.append(float(np.dot(finite, finite) / finite.size) if finite.size else 0.0)
        times = sv.x_at(data, edges)
        # The last stretch ends at its last sample's time.
        times[-1] = sv.x_at(data, last - 1)
        return {"of": "square", "edges": sv._axis(times), "power": powers, "count": counts}
    if data.mode == "events" and data.rows is not None:
        return _event_level_bins(data, bounds)
    if data.view.get("quantity") not in DB_QUANTITIES or data.values.ndim != 1:
        return None
    xs, values = data.xs, data.values
    log = data.view.get("xScale") == "log"
    if bounds is None and data.mode == "spectrum":
        bounds = [spec.SPECTRUM_MIN_HZ, data.nyquist]
    keep = np.isfinite(values) & np.isfinite(xs) & ((xs > 0) if log else True)
    if bounds is not None:
        keep &= sv._inside(xs, bounds)
    xs, values = xs[keep], values[keep]
    if not xs.size:
        return None
    low, high = (min(bounds), max(bounds)) if bounds is not None else (float(xs[0]), float(xs[-1]))
    if log:
        low = max(low, float(xs[0]))
    edges = (
        np.geomspace(low, high, LEVEL_BINS + 1) if log and high > low > 0 else np.linspace(low, high, LEVEL_BINS + 1)
    )
    which = np.clip(np.searchsorted(edges, xs, side="right") - 1, 0, LEVEL_BINS - 1)
    power = np.where(values <= SILENT_DB, 0.0, 10.0 ** (values / 10.0))
    counts = np.bincount(which, minlength=LEVEL_BINS)
    sums = np.bincount(which, weights=power, minlength=LEVEL_BINS)
    means = np.divide(sums, counts, out=np.zeros(LEVEL_BINS), where=counts > 0)
    return {
        "of": "dbPower",
        "edges": sv._axis(edges),
        "power": [float(v) for v in means],
        "count": [int(c) for c in counts],
    }


def _event_level_bins(data: StageData, bounds: list[float] | None) -> StageLevelBins | None:
    """A trigger's events' power, as a signal's (A44, R6): the mean square of every event's samples, in LEVEL_BINS
    stretches of the time from the trigger, so its events are ordered among the overlaid recordings' by their
    samples, never left unordered. A window an edge cuts is read as the same quantity (read_points: every event's
    samples, never the events' mean)."""
    rows, xs = data.rows, data.xs
    if rows is None or rows.ndim != 2 or not xs.size or rows.shape[1] != xs.size:
        return None
    low, high = (min(bounds), max(bounds)) if bounds is not None else (float(xs[0]), float(xs[-1]))
    keep = np.isfinite(xs) & (xs >= low) & (xs <= high)
    if not keep.any() or high <= low:
        return None
    edges = np.linspace(low, high, LEVEL_BINS + 1)
    which = np.clip(np.searchsorted(edges, xs[keep], side="right") - 1, 0, LEVEL_BINS - 1)
    part = rows[:, keep]
    finite = np.isfinite(part)
    squares = np.where(finite, part, 0.0) ** 2
    counts = np.bincount(which, weights=finite.sum(axis=0), minlength=LEVEL_BINS)
    sums = np.bincount(which, weights=squares.sum(axis=0), minlength=LEVEL_BINS)
    means = np.divide(sums, counts, out=np.zeros(LEVEL_BINS), where=counts > 0)
    return {
        "of": "square",
        "edges": sv._axis(edges),
        "power": [float(v) for v in means],
        "count": [int(c) for c in counts],
    }


def _line_buckets(mode: Mode, points: int) -> int:
    """How many buckets a difference line has: as many points as the recordings' own pictures have."""
    if points:
        return max(1, points // 2)
    whole = {
        "series": sv.LEVEL_SERIES_MIN_SAMPLES,
        "cepstrum": sv.QUEFRENCY_POINTS,
        "correlation": sv.LAG_POINTS,
        "events": sv.EVENT_POINTS,
    }
    return max(1, whole.get(mode, spec.SPECTRUM_POINTS * 2) // 2)


def _image(data: StageData, detail: StageDetail | None, diff: bool) -> StageView:
    """An image as drawn: columns in blocks over time, rows on the picture's axis (log-spaced bands for an
    STFT's frequencies, quefrency blocks for a cepstrogram). A median is reduced as the recordings' own images
    are; a difference keeps each block's value of largest magnitude."""
    bounds, points = _bounds(detail)
    plane = data.values
    times, ys = data.xs, data.ys if data.ys is not None else np.empty(0)
    whole = data.whole
    if bounds is not None:
        columns = sv._inside(times, bounds)
        plane, times = plane[:, columns], times[columns]
        whole = whole[columns] if whole is not None else None
    count = sv.HEATMAP_TIMES if bounds is None else max(2, points // 2)
    edges = bucket_edges(times.size, count)
    blocks = [slice(start, end) for start, end in zip(edges[:-1], edges[1:], strict=True) if end > start]
    edges = np.array([block.start for block in blocks] + [blocks[-1].stop]) if blocks else np.array([0])
    view: StageView = dict(data.view)  # type: ignore[assignment]
    if not blocks:
        view.update({"xs": [], "ys": [], "matrix": []})
        return view
    if diff:
        columned = _peak_blocks(plane, len(blocks))[0]
    elif data.mode == "spectrogram":
        columned = np.stack([sv._power_mean(plane[:, block].T) for block in blocks], axis=1)
    else:
        columned = np.stack([np.mean(plane[:, block], axis=1) for block in blocks], axis=1)
    rows_bounds = [float(value) for value in detail.get("y", [-np.inf, np.inf])] if detail else None
    if data.mode == "spectrogram":
        if bounds is None:
            band_edges = np.geomspace(spec.SPECTRUM_MIN_HZ, data.nyquist, sv.HEATMAP_FREQUENCIES + 1)
            out_ys = np.sqrt(band_edges[:-1] * band_edges[1:])
            matrix = _band_peaks(columned, ys, band_edges) if diff else sv.band_levels(columned.T, ys, band_edges).T
        else:
            limits = (
                rows_bounds
                if rows_bounds is not None and np.all(np.isfinite(rows_bounds))
                else [spec.SPECTRUM_MIN_HZ, data.nyquist]
            )
            if diff:
                inside = sv._inside(ys, limits) & (ys > 0)
                if inside.sum() <= sv.DETAIL_ROWS:
                    out_ys, matrix = ys[inside], columned[inside]
                else:
                    band_edges = np.geomspace(
                        max(min(limits), ys[inside][0]), min(max(limits), ys[inside][-1]), sv.DETAIL_ROWS + 1
                    )
                    out_ys, matrix = np.sqrt(band_edges[:-1] * band_edges[1:]), _band_peaks(columned, ys, band_edges)
            else:
                out_ys, matrix = sv._log_rows(columned, ys, limits, sv.DETAIL_ROWS)
        matrix = _rounded(matrix, "level", True) if diff else np.round(sv.floored_db(matrix), 1)
    elif data.mode == "cepstrogram":
        keep = sv._inside(ys, rows_bounds) if rows_bounds is not None else np.ones(ys.size, dtype=bool)
        rows = sv.DETAIL_ROWS if bounds is not None else sv.HEATMAP_FREQUENCIES
        peaks, starts = sv._signed_peaks(columned[keep].T, rows)
        out_ys, matrix = ys[keep][starts], np.round(peaks.T, sv.CEPSTRUM_DECIMALS)
    else:
        keep = sv._inside(ys, rows_bounds) if rows_bounds is not None else np.ones(ys.size, dtype=bool)
        out_ys, matrix = ys[keep], _rounded(columned[keep], data.view.get("quantity"), diff)
    view.update(
        {
            "xs": sv._axis(_block_times(times, edges)),
            "ys": sv._axis(out_ys),
            "matrix": [sv._json(row) for row in np.asarray(matrix)],
        }
    )
    if whole is not None and bounds is None:
        view["whole"] = [bool(np.all(whole[block])) for block in blocks]
    return view


def draw(data: StageData, detail: StageDetail | None = None, *, diff: bool = False) -> StageView:
    """``data`` as the comparison draws it: the whole picture, or with ``detail`` the part of it on screen. A
    median (``diff`` false) is drawn as a recording's own picture is; a difference by its own reduction."""
    if data.mode in ("spectrogram", "roughness", "cepstrogram"):
        view = _image(data, detail, diff)
    else:
        xs, values = _line(data, detail, diff)
        view = dict(data.view)  # type: ignore[assignment]
        view.update({"xs": sv._axis(xs), "values": sv._json(_sent(data, values, diff))})
        if data.mode == "signal":
            # Drawn as the recordings are: a waveform, by the lanes' own decimation, over the range on screen.
            bounds, points = _bounds(detail)
            first, last = _signal_range(data, bounds)
            unit = str(data.view.get("unit") or "")
            view["waveform"] = sv.samples_waveform(
                data, first, last, unit, data.ref, points or sv.WAVEFORM_OVERVIEW_POINTS
            )
    if detail is not None:
        view["detail"] = True
    if not diff:
        with_level_bins(view, data, detail)
    with_value_range(view, data, detail, diff=diff)
    # The axes of the data combined (the recordings' common part), whatever part of it is drawn.
    sv.with_source_axes(view, data)
    return view  # type: ignore[return-value]


def with_level_bins(view: StageView | dict, data: StageData | None, detail: StageDetail | None = None) -> None:
    """``view`` with its line's levelBins (level_bins) when it is a line the plot compares (R6)."""
    if data is None or view.get("kind") not in ("line", "bar"):
        return
    bins = level_bins(data, detail)
    if bins is not None:
        view["levelBins"] = bins  # type: ignore[typeddict-unknown-key]


def _drawn_part(data: StageData, detail: StageDetail | None) -> np.ndarray | None:
    """Every full-resolution value of the part ``draw`` draws (the whole picture, or ``detail``'s window): a line's
    values over its x window (a spectrum's from SPECTRUM_MIN_HZ to Nyquist, a cepstrum's without its zero quefrency),
    every event's samples, an image's cells in its time window and rows. None for a signal with no samples there."""
    bounds, _ = _bounds(detail)
    mode = data.mode
    if mode == "signal":
        first, last = _signal_range(data, bounds)
        return data.values[first:last] if last > first else None
    xs = data.xs
    columns = np.ones(xs.size, dtype=bool) if bounds is None or mode == "bands" else sv._inside(xs, bounds)
    if mode in ("spectrogram", "roughness", "cepstrogram"):
        ys = data.ys if data.ys is not None else np.empty(0)
        rows_bounds = [float(value) for value in detail.get("y", [-np.inf, np.inf])] if detail else None
        if mode == "spectrogram":
            limits = (
                rows_bounds
                if rows_bounds is not None and np.all(np.isfinite(rows_bounds))
                else [spec.SPECTRUM_MIN_HZ, data.nyquist]
            )
            rows = sv._inside(ys, limits) & (ys > 0)
        else:
            rows = sv._inside(ys, rows_bounds) if rows_bounds is not None else np.ones(ys.size, dtype=bool)
            if mode == "cepstrogram":
                rows &= ys > 0
        return np.asarray(data.values)[np.ix_(np.flatnonzero(rows), np.flatnonzero(columns))]
    if mode in ("spectrum", "coherence"):
        columns &= xs > 0
        if bounds is None:
            columns &= (xs >= spec.SPECTRUM_MIN_HZ) & (xs <= data.nyquist)
    if mode == "cepstrum":
        columns &= xs > 0
    if mode == "events" and data.rows is not None:
        return np.asarray(data.rows)[:, columns]
    return np.asarray(data.values)[..., columns]


def floored(view: StageView | dict, diff: bool = False) -> bool:
    """Whether a picture's values have a silent floor (SILENT_DB and below is silence, left out of its range): only a
    level or a gain in dB, which the backend floors at MIN_LEVEL_DB (stage_view.floored_db). A difference has none
    (a Δ of −260 dB is a Δ), nor any other quantity (a plain value, a coherence, a cepstrum): the webview's
    ``floorless``."""
    return not diff and view.get("quantity", "level") in DB_QUANTITIES


def value_range(
    data: StageData | None, detail: StageDetail | None = None, *, diff: bool = False
) -> StageValueRange | None:
    """The lowest and highest of every full-resolution value ``draw`` draws of ``data`` (the part ``detail`` names),
    silence (a level at the floor) and undefined values left out as the plot leaves them out; a cepstrogram's colour
    edge too (the 99th percentile of its magnitudes). From these, never from the thinned line or the cells averaged to
    draw an image, the plot sets its axis and colour ranges (R1, R9). None with no value to range over."""
    if data is None:
        return None
    part = _drawn_part(data, detail)
    if part is None or not part.size:
        return None
    if data.mode == "signal":
        # Every sample, with no float64 copy of them (half an hour of samples): only their lowest and highest.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            low, high = float(np.nanmin(part)), float(np.nanmax(part))
        return {"min": low, "max": high} if np.isfinite(low) and np.isfinite(high) else None
    values = np.ravel(part)
    keep = np.isfinite(values)
    if floored(data.view, diff):
        keep &= values > SILENT_DB
    values = values[keep]
    if not values.size:
        return None
    found: StageValueRange = {"min": float(values.min()), "max": float(values.max())}
    if data.mode == "cepstrogram":
        found["robust"] = float(np.quantile(np.abs(values), 0.99, method="lower"))
    return found


def with_value_range(
    view: StageView | dict, data: StageData | None, detail: StageDetail | None = None, *, diff: bool = False
) -> None:
    """``view`` with its valueRange (value_range) when it has values to range over (``diff``: of a difference)."""
    found = value_range(data, detail, diff=diff)
    if found is not None:
        view["valueRange"] = found  # type: ignore[typeddict-unknown-key]


# --- Combining ---------------------------------------------------------------------------------------------


def _aligned(items: list[StageData]) -> list[StageData] | None:
    """The recordings on one set of axes, or None. Over time, recordings of different lengths keep the part
    they all have (from the same start, at the same rate)."""
    first = items[0]
    same = ("kind", "x", "quantity", "yAxis")
    if any(item.mode != first.mode or any(item.view.get(key) != first.view.get(key) for key in same) for item in items):
        return None
    # Values are subtracted (and a median taken) only in one unit, whatever the Frame: a calibrated recording against
    # an uncalibrated one has no difference (_no_delta_reason).
    if any(item.calibration != first.calibration or item.view.get("unit") != first.view.get("unit") for item in items):
        return None
    if first.ys is not None and any(item.ys is None or not np.array_equal(item.ys, first.ys) for item in items):
        return None
    if first.mode == "signal":
        # Sample by sample: the same rate and start, over the samples they all have.
        if any(item.rate != first.rate or abs(item.start - first.start) > 0.5 / first.rate for item in items):
            return None
        # Samples are subtracted as they are: only against one reference too (calibrated alike).
        if any(item.ref != first.ref for item in items):
            return None
        count = min(item.values.size for item in items)
        return [replace(item, values=item.values[:count]) for item in items]
    timed = first.view.get("x") == "time"
    n = min(item.xs.size for item in items)
    if not timed and any(item.xs.size != n for item in items):
        return None
    if any(not np.allclose(item.xs[:n], first.xs[:n], rtol=1e-9, atol=1e-9) for item in items):
        return None

    def cut(item: StageData) -> StageData:
        if item.xs.size == n:
            return item
        whole = item.whole[:n] if item.whole is not None else None
        return replace(item, xs=item.xs[:n], values=item.values[..., :n], whole=whole)

    return [cut(item) for item in items]


def _median(items: list[StageData]) -> np.ndarray:
    """Point by point; a point where any recording has no value has none (NaN)."""
    # In float64 (as kept), never float32: a median of two values a float32 step apart lies between them.
    stacked = np.stack([item.values for item in items])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.median(stacked, axis=0)


def _whole_of(items: list[StageData]) -> np.ndarray | None:
    wholes = [item.whole for item in items if item.whole is not None]
    return np.logical_and.reduce(wholes) if wholes else None


def _no_delta_reason(items: list[StageData]) -> Literal["rate", "unit"] | None:
    """Why recordings have no difference: time signals at another sample rate, or values of any Frame in another
    unit or reference (a calibrated recording against an uncalibrated one). None for any other reason (other axes)."""
    first = items[0]
    if any(item.mode != first.mode for item in items):
        return None
    signal = first.mode == "signal"
    if signal and any(item.rate != first.rate for item in items):
        return "rate"
    if any(item.calibration != first.calibration or item.view.get("unit") != first.view.get("unit") for item in items):
        return "unit"
    return None


def combine(base: list[StageData], compare: StageData | None, detail: StageDetail | None = None) -> CombineResult:
    """The base's median (of two or more recordings) and ``compare`` − base, at full resolution, then drawn; on
    other axes, neither (the comparison says there is no difference)."""
    if not base:
        return {"ok": True}
    items = [*base, *([compare] if compare is not None else [])]
    aligned = _aligned(items)
    if aligned is None:
        reason = _no_delta_reason(items)
        return {"ok": True, "noDelta": reason} if reason else {"ok": True}
    base, compare = aligned[: len(base)], (aligned[-1] if compare is not None else None)
    first = base[0]
    median = _median(base) if len(base) > 1 else first.values
    result: CombineResult = {"ok": True}
    if len(base) > 1:
        result["base"] = draw(replace(first, values=median, whole=_whole_of(base)), detail)
    # Two recordings' events are not one another's: they are compared overlaid, with no difference.
    if compare is None or first.mode == "events":
        return result
    difference = compare.values - median
    whole = _whole_of([*base, compare])
    drawn = replace(first, values=difference, whole=whole)
    result["diff"] = draw(drawn, detail, diff=True)
    peak = difference_peak(drawn, difference, _on_screen(detail))
    if peak is not None:
        result["diff"]["peak"] = peak
    return result


def _step_at(axis: np.ndarray, index: int) -> float | None:
    """The gap from ``axis[index]`` to its nearer neighbour, so the headline writes the digits that tell them apart."""
    gaps = [abs(float(axis[i + 1] - axis[i])) for i in (index - 1, index) if 0 <= i < axis.size - 1]
    gaps = [gap for gap in gaps if gap > 0 and np.isfinite(gap)]
    return min(gaps) if gaps else None


def _on_screen(detail: StageDetail | None) -> StageDetail | None:
    """The window on screen of ``detail`` (its peakX / peakY), where the Δ headline's peak is looked for: never the
    margin the detail reaches past it (C4). The detail itself without them."""
    if not detail or "peakX" not in detail:
        return detail
    window: StageDetail = {"x": list(detail["peakX"]), "points": detail["points"]}
    if "peakY" in detail:
        window["y"] = list(detail["peakY"])
    return window


def difference_peak(data: StageData, values: np.ndarray, detail: StageDetail | None = None) -> StagePeak | None:
    """Where the difference ``values`` (``data``'s axes) is largest in magnitude over the detail's range (the screen and
    a margin around it: the webview names it only when it is on screen, stagePanes.peakOnScreen), from every
    value before thinning (R2): the Δ pane's headline. Its first quefrency and an STFT's columns that read padding
    are left out, as the headline leaves them out; None with nothing to find."""
    bounds, _ = _bounds(detail)
    if data.mode == "signal":
        # Only the samples on screen, and never the whole recording as float64.
        first, last = _signal_range(data, bounds)
        part = values[first:last]
        if not part.size:
            return None
        # Its highest and lowest sample, with no copy of the samples unless one is NaN (nanargmax copies to skip it).
        if np.isnan(part.max()):
            if np.all(np.isnan(part)):
                return None
            high, low = int(np.nanargmax(part)), int(np.nanargmin(part))
        else:
            high, low = int(part.argmax()), int(part.argmin())
        index = high if abs(float(part[high])) >= abs(float(part[low])) else low
        signal_peak: StagePeak = {
            "x": float(sv.x_at(data, first + index)),
            "value": float(_sent(data, part[index : index + 1], True)[0]),
        }
        if data.rate > 0:
            signal_peak["xStep"] = 1 / data.rate
        return signal_peak
    if data.mode in ("spectrogram", "roughness", "cepstrogram"):
        ys = data.ys if data.ys is not None else np.empty(0)
        columns = np.ones(data.xs.size, dtype=bool) if bounds is None else sv._inside(data.xs, bounds)
        if data.whole is not None:
            columns &= data.whole[: data.xs.size].astype(bool)
        rows_bounds = [float(value) for value in detail.get("y", [-np.inf, np.inf])] if detail else None
        if data.mode == "spectrogram":
            limits = (
                rows_bounds
                if rows_bounds is not None and np.all(np.isfinite(rows_bounds))
                else [spec.SPECTRUM_MIN_HZ, data.nyquist]
            )
            rows = sv._inside(ys, limits) & (ys > 0)
        else:
            rows = sv._inside(ys, rows_bounds) if rows_bounds is not None else np.ones(ys.size, dtype=bool)
            if data.mode == "cepstrogram":
                rows &= ys > 0
        # Only the part on screen is copied (rounded as drawn), never the whole plane.
        row_at, column_at = np.flatnonzero(rows), np.flatnonzero(columns)
        if not row_at.size or not column_at.size:
            return None
        # Searched a block of columns at a time: never a copy of the whole part on screen, let alone the plane.
        plane = np.asarray(values)
        best, row, column = -1.0, -1, -1
        for start in range(0, column_at.size, 256):
            block = np.abs(plane[np.ix_(row_at, column_at[start : start + 256])])
            np.nan_to_num(block, copy=False, nan=-1.0, posinf=-1.0, neginf=-1.0)
            at = int(np.argmax(block))
            if block.flat[at] > best:
                best = float(block.flat[at])
                row, column = int(row_at[at // block.shape[1]]), int(column_at[start + at % block.shape[1]])
        if best < 0:
            return None
        value = float(_sent(data, np.asarray(values)[row : row + 1, column : column + 1], True)[0, 0])
        peak: StagePeak = {"x": float(data.xs[column]), "y": float(ys[row]), "value": value}
        x_step, y_step = _step_at(data.xs, int(column)), _step_at(ys, int(row))
    else:
        xs = data.xs
        keep = np.ones(xs.size, dtype=bool) if bounds is None else sv._inside(xs, bounds)
        if data.mode in ("spectrum", "coherence"):
            keep &= xs > 0
            if bounds is None:
                keep &= (xs >= spec.SPECTRUM_MIN_HZ) & (xs <= data.nyquist)
        if data.view.get("quantity") == "cepstrum":
            keep &= xs > 0
        # Found among the unrounded values (two that round alike still differ), rounded as drawn only once found.
        at = np.flatnonzero(keep)
        line = np.abs(np.asarray(values)[at])
        line[~np.isfinite(line)] = -1.0
        if not line.size or float(line.max()) < 0:
            return None
        index = int(at[int(np.argmax(line))])
        peak = {"x": float(xs[index]), "value": float(_sent(data, np.asarray(values)[index : index + 1], True)[0])}
        x_step, y_step = _step_at(xs, index), None
    if x_step is not None:
        peak["xStep"] = x_step
    if y_step is not None:
        peak["yStep"] = y_step
    return peak


def _sent(data: StageData, values: np.ndarray, diff: bool) -> np.ndarray:
    """A line's values or a peak as they are sent to the webview: unrounded (a level floored at MIN_LEVEL_DB as it is
    computed with, stage_view.floored_db). A read's points (read_points) are sent as the Frame has them, an undefined
    one as null. A line drawn, a read and a peak alike carry the values themselves: the webview
    picks the nearest point, tells silence, orders lines and steps the arrow keys on them, and only the text it writes
    rounds them (R1, R7). Only an image's cells, which are drawn as colours and never read (the readout reads the full
    cells, read_cells), are rounded to keep the picture small."""
    values = np.asarray(values)
    if not diff and data.mode in ("spectrogram", "spectrum", "bands"):
        return sv.floored_db(values)
    return values


def read_points(base: list[StageData], compare: StageData | None, read: StageRead) -> StagePoints | None:
    """The full-resolution points a plot reads (full_read.py) of a recording's own picture, the base's median
    (``of: "base"``) or the difference (``of: "diff"``): taken at full resolution over the read's window only, never
    from the thinned picture. None where the picture has none (other axes, no such event)."""
    diff = read.get("of") == "diff"
    if not base or (diff and compare is None):
        return None
    # Aligned with the compared recording whenever there is one, as ``combine`` aligns the picture: a median read
    # never reaches past the extent its picture was drawn over.
    items = [*base, *([compare] if compare is not None else [])]
    aligned = items if len(items) == 1 else _aligned(items)
    if aligned is None:
        return None
    group, other = aligned[: len(base)], (aligned[-1] if diff else None)
    first = group[0]

    def combined(part: Any) -> np.ndarray:
        """``part`` of each recording (a slice of its values), as the picture combines them: the base's median, or
        compare − that median as ``combine`` takes it."""
        parts = [part(item) for item in group]
        if len(parts) == 1:
            middle = parts[0]
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                middle = np.median(np.stack(parts), axis=0)
        if other is None:
            return middle
        return part(other) - middle

    if first.mode in ("spectrogram", "roughness", "cepstrogram"):
        ys = first.ys if first.ys is not None else np.empty(0)
        return read_cells(first.xs, ys, lambda rows, columns: combined(lambda item: item.values[rows, columns]), read)
    if first.mode == "events" and "event" in read:
        # One event's own line: a recording's, as the plot draws each event of it.
        if len(group) != 1 or diff or first.rows is None or int(read["event"]) not in first.event_ids:
            return None
        row = first.rows[first.event_ids.index(int(read["event"]))]
        return read_line(sv.reading_axis(first), lambda a, b: row[a:b], read)
    if first.mode == "events" and "level" in read and not diff and first.rows is not None:
        # The level on screen of a trigger's events (R6) is what their levelBins are (_event_level_bins): the mean
        # square of every event's every sample in the window, never of the events' mean. A median's are its first
        # recording's events, as its levelBins are (combine draws it from ``first`` with the median values).
        rows = first.rows
        return read_line(sv.reading_axis(first), lambda a, b: rows[:, a:b].ravel(), read)
    # The x of every point read is the reading's own axis (sv.reading_axis), which the picture was drawn on: the
    # recordings combined were cut to the same count of values (_aligned).
    return read_line(sv.reading_axis(first), lambda a, b: combined(lambda item: item.values[a:b]), read)


def combine_keys(
    base: list[str], compare: str | None, detail: StageDetail | None = None, read: StageRead | None = None
) -> CombineResult:
    """``combine`` of the kept StageData by key; the keys no longer kept are named instead. With ``read``, only the
    points that read asks for (read_points)."""
    keys = [*base, *([compare] if compare is not None else [])]
    found = {key: STORE.get(key) for key in keys}
    missing = [key for key, data in found.items() if data is None]
    if missing:
        return {"ok": False, "missing": missing}
    if read is not None:
        points = read_points(
            [found[key] for key in base],  # type: ignore[misc]
            found[compare] if compare is not None else None,
            read,
        )
        return {"ok": True, **({"points": points} if points is not None else {})}  # type: ignore[typeddict-item]
    return combine(
        [found[key] for key in base],  # type: ignore[misc]
        found[compare] if compare is not None else None,
        detail,
    )
