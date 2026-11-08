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
from dataclasses import dataclass, replace
from typing import Any, Literal, NotRequired, TypedDict

import numpy as np
from wandas.frames import (
    CepstralFrame,
    CepstrogramFrame,
    ChannelFrame,
    CoherenceFrame,
    CrossCorrelationFrame,
    CrossSpectralFrame,
    NOctFrame,
    RoughnessFrame,
    SpectralFrame,
    SpectrogramFrame,
    TransferFunctionFrame,
)
from wandas.frames.segments import ChannelFrameSegments

import analysis_spec as spec
import stage_view as sv
from decimator import bucket_edges
from stage_view import StageDetail, StageView

#: How much of the Frames' values the backend keeps for the comparison's medians and differences. The least
#: recently used go first; a picture asked for again (zooming, another compared recording) uses what is kept.
#: A base group the comparison scans without asking (up to 30 recordings or 30 minutes) fits: half an hour of a
#: 48 kHz signal's level, or of a spectrogram at the default hop. The browser keeps less (browser_service.py).
STAGE_DATA_BUDGET_BYTES = 768 * 1024 * 1024
#: A difference of dB levels to a hundredth; small linear values (cepstral coefficients, coherence) keep more.
DB_DIFF_DECIMALS = 2
VALUE_DIFF_DECIMALS = 6

Mode = Literal[
    "series",
    "signal",
    "events",
    "spectrum",
    "coherence",
    "bands",
    "spectrogram",
    "roughness",
    "cepstrum",
    "cepstrogram",
    "correlation",
]
DB_QUANTITIES = ("level", "gain")


@dataclass(frozen=True)
class StageData:
    """One recording's step at full resolution, channels combined as its picture combines them.

    ``values`` is a line over ``xs`` or an image (rows over ``ys``, columns over ``xs``). For ``signal`` (the sound
    itself) it is every sample, channels averaged, at ``start + n / rate``, kept as float32 with no ``xs`` (half an
    hour at 48 kHz fits the budget).
    """

    mode: Mode
    #: The recording's whole picture: the keys a median or a difference keeps (frame, kind, axes, unit, pair).
    view: StageView
    xs: np.ndarray
    values: np.ndarray
    ys: np.ndarray | None = None
    #: Per image column of an STFT: whether its window is inside the signal (stage_view ``whole``).
    whole: np.ndarray | None = None
    nyquist: float = 0.0
    start: float = 0.0
    rate: float = 0.0
    #: A signal's reference (its waveform's), for the difference's waveform.
    ref: float = 1.0

    @property
    def nbytes(self) -> int:
        return int(self.xs.nbytes + self.values.nbytes + (self.ys.nbytes if self.ys is not None else 0))


class CombineResult(TypedDict):
    ok: bool
    #: The keys no longer kept (the scans that made them are asked for again).
    missing: NotRequired[list[str]]
    #: The base group's median (a base of one recording is its own picture, which the comparison has).
    base: NotRequired[StageView]
    diff: NotRequired[StageView]
    #: Why there is no ``diff`` when it is not the axes: time signals at other sample rates have no sample Δ.
    noDelta: NotRequired[Literal["rate"]]


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


def _f64(values: Any) -> np.ndarray:
    return np.asarray(values, dtype=np.float64)


def _column_whole(frame: Any, columns: int, signal_s: float | None) -> np.ndarray | None:
    """Per STFT column, whether its window is inside the signal (as stage_view._whole_columns, column by column)."""
    if signal_s is None:
        return None
    centres = np.atleast_2d(_f64(frame.frame_center_times))[0][:columns] - sv._offset(frame)
    half = float(frame.n_fft) / 2 / float(frame.sampling_rate)
    return (centres >= half - 1e-9) & (centres <= signal_s - half + 1e-9)


def stage_data(frame: object, view: StageView, signal_s: float | None = None) -> StageData | None:
    """The full-resolution values behind ``view`` (stage_view of ``frame``); None for a Frame not drawn."""
    if view.get("kind") == "none":
        return None
    template = _template(view)
    if isinstance(frame, CepstralFrame):
        coefficients = np.mean(sv._rows(frame.data, frame.n_channels), axis=0)
        return StageData("cepstrum", template, _f64(frame.quefrencies), coefficients)
    if isinstance(frame, CepstrogramFrame):
        data = _f64(frame.data)
        plane = np.mean(data.reshape(-1, data.shape[-2], data.shape[-1]), axis=0).astype(np.float32)
        times = _f64(frame.times)[: plane.shape[1]] + sv._offset(frame)
        whole = _column_whole(frame, plane.shape[1], signal_s)
        return StageData("cepstrogram", template, times, plane, _f64(frame.quefrencies), whole)
    if isinstance(frame, CrossCorrelationFrame):
        drawn = sv._correlation_rows(frame)
        return None if drawn is None else StageData("correlation", template, _f64(frame.lags), drawn[1])
    if isinstance(frame, ChannelFrameSegments):
        if not len(frame):
            return None
        rows, times = sv._event_rows(frame)
        return StageData("events", template, times, np.mean(rows, axis=0))
    if isinstance(frame, ChannelFrame):
        data = sv._rows(frame.data, frame.n_channels)
        times = _f64(frame.source_time).reshape(frame.n_channels, -1)[0]
        if sv._in_db(frame):
            # Already dB levels: compared as the levels they are, channels power-averaged as the picture averages them.
            return StageData("series", template, times, sv._power_mean(data))
        if "waveform" not in view:
            return StageData("series", template, times, np.mean(data, axis=0))
        # The sound itself: a difference is compare − base sample by sample (a ChannelFrame subtraction), never a
        # level the comparison would make of it.
        start = float(times[0]) if times.size else 0.0
        samples = np.mean(data, axis=0).astype(np.float32)
        ref = float(frame.channels[0].ref)
        return StageData(
            "signal", template, np.empty(0), samples, start=start, rate=float(frame.sampling_rate), ref=ref
        )
    if isinstance(frame, (SpectralFrame, CoherenceFrame, CrossSpectralFrame, TransferFunctionFrame)):
        quantity, rows = sv._spectral_rows(frame)
        if sv._pairwise(frame):
            row = sv._cross_pair(frame)
            if row is None:
                return None
            rows = rows[row : row + 1]
        freqs = _f64(frame.freqs)
        nyquist = float(frame.sampling_rate) / 2
        if quantity == "coherence":
            return StageData("coherence", template, freqs, rows[0], nyquist=nyquist)
        levels = sv.rounded_db(sv._power_mean(sv.rounded_db(rows)))
        return StageData("spectrum", template, freqs, levels, nyquist=nyquist)
    if isinstance(frame, NOctFrame):
        levels = sv.rounded_db(sv._power_mean(sv.rounded_db(sv._rows(frame.dB, frame.n_channels))))
        return StageData("bands", template, _f64(frame.freqs), levels)
    if isinstance(frame, SpectrogramFrame):
        db = _f64(frame.dB)
        plane = sv._power_mean(sv.rounded_db(db.reshape(-1, db.shape[-2], db.shape[-1]))).astype(np.float32)
        times = _f64(frame.times)[: plane.shape[1]] + sv._offset(frame)
        whole = _column_whole(frame, plane.shape[1], signal_s)
        nyquist = float(frame.sampling_rate) / 2
        return StageData("spectrogram", template, times, plane, _f64(frame.freqs), whole, nyquist=nyquist)
    if isinstance(frame, RoughnessFrame):
        data = _f64(frame.data)
        plane = np.mean(data.reshape(-1, data.shape[-2], data.shape[-1]), axis=0).astype(np.float32)
        times = _f64(frame.time)[: plane.shape[1]] + sv._offset(frame)
        return StageData("roughness", template, times, plane, _f64(frame.bark_axis)[: plane.shape[0]])
    return None


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


def _rounded(values: np.ndarray, quantity: str | None, diff: bool) -> np.ndarray:
    if not diff:
        return values
    return np.round(values, DB_DIFF_DECIMALS if quantity in DB_QUANTITIES else VALUE_DIFF_DECIMALS)


def _bounds(detail: StageDetail | None) -> tuple[list[float] | None, int]:
    return ([float(value) for value in detail["x"]], int(detail["points"])) if detail else (None, 0)


def _line(data: StageData, detail: StageDetail | None, diff: bool) -> tuple[np.ndarray, np.ndarray]:
    """A line's xs and values as drawn: a median as the recordings' own pictures are, a difference by
    difference_line."""
    bounds, points = _bounds(detail)
    if data.mode == "signal":
        data = _series_of(data)
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
        return (line[0], np.round(line[1], 4)) if mode == "coherence" else line
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
        line = sv._cepstrum_envelope(xs, values, points or sv.QUEFRENCY_POINTS)
        return line[0], np.round(line[1], sv.CEPSTRUM_DECIMALS)
    if mode == "correlation":
        line = sv._envelope(xs, values, points or sv.LAG_POINTS)
        return line[0], np.round(line[1], sv.CORRELATION_DECIMALS)
    if mode == "events":
        line = sv._shared_envelope(xs, values[np.newaxis], points or sv.EVENT_POINTS)
        return line[0], line[1][0]
    raise ValueError(f"not a line: {mode}")


def _series_of(data: StageData) -> StageData:
    """A signal's samples as a line over their times (float64), for a moment: the store keeps them without."""
    times = data.start + np.arange(data.values.size) / data.rate
    return replace(data, mode="series", xs=times, values=_f64(data.values))


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
    plane = _f64(data.values)
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
        matrix = _rounded(matrix, "level", True) if diff else np.round(sv.rounded_db(matrix), 1)
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
        view.update({"xs": sv._axis(xs), "values": sv._json(_rounded(_f64(values), data.view.get("quantity"), diff))})
        if data.mode == "signal":
            # Drawn as the recordings are: a waveform, by the lanes' own decimation, over the range on screen.
            line = _series_of(data)
            bounds, points = _bounds(detail)
            keep = sv._inside(line.xs, bounds) if bounds is not None else np.ones(line.xs.size, dtype=bool)
            unit = str(data.view.get("unit") or "")
            view["waveform"] = sv.samples_waveform(
                line.values[keep], line.xs[keep], unit, data.ref, points or sv.WAVEFORM_OVERVIEW_POINTS
            )
    if detail is not None:
        view["detail"] = True
    return view  # type: ignore[return-value]


# --- Combining ---------------------------------------------------------------------------------------------


def _aligned(items: list[StageData]) -> list[StageData] | None:
    """The recordings on one set of axes, or None. Over time, recordings of different lengths keep the part
    they all have (from the same start, at the same rate)."""
    first = items[0]
    same = ("kind", "x", "quantity", "yAxis")
    if any(item.mode != first.mode or any(item.view.get(key) != first.view.get(key) for key in same) for item in items):
        return None
    if first.ys is not None and any(item.ys is None or not np.array_equal(item.ys, first.ys) for item in items):
        return None
    if first.mode == "signal":
        # Sample by sample: the same rate and start, over the samples they all have.
        if any(item.rate != first.rate or abs(item.start - first.start) > 0.5 / first.rate for item in items):
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
    stacked = np.stack([_f64(item.values) for item in items])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.median(stacked, axis=0)


def _whole_of(items: list[StageData]) -> np.ndarray | None:
    wholes = [item.whole for item in items if item.whole is not None]
    return np.logical_and.reduce(wholes) if wholes else None


def combine(base: list[StageData], compare: StageData | None, detail: StageDetail | None = None) -> CombineResult:
    """The base's median (of two or more recordings) and ``compare`` − base, at full resolution, then drawn; on
    other axes, neither (the comparison says there is no difference)."""
    if not base:
        return {"ok": True}
    items = [*base, *([compare] if compare is not None else [])]
    aligned = _aligned(items)
    if aligned is None:
        if all(item.mode == "signal" for item in items) and any(item.rate != items[0].rate for item in items):
            return {"ok": True, "noDelta": "rate"}
        return {"ok": True}
    base, compare = aligned[: len(base)], (aligned[-1] if compare is not None else None)
    first = base[0]
    median = _median(base) if len(base) > 1 else _f64(first.values)
    result: CombineResult = {"ok": True}
    if len(base) > 1:
        result["base"] = draw(replace(first, values=median, whole=_whole_of(base)), detail)
    # Two recordings' events are not one another's: they are compared overlaid, with no difference.
    if compare is None or first.mode == "events":
        return result
    difference = _f64(compare.values) - median
    whole = _whole_of([*base, compare])
    result["diff"] = draw(replace(first, values=difference, whole=whole), detail, diff=True)
    return result


def combine_keys(base: list[str], compare: str | None, detail: StageDetail | None = None) -> CombineResult:
    """``combine`` of the kept StageData by key; the keys no longer kept are named instead."""
    keys = [*base, *([compare] if compare is not None else [])]
    found = {key: STORE.get(key) for key in keys}
    missing = [key for key, data in found.items() if data is None]
    if missing:
        return {"ok": False, "missing": missing}
    return combine(
        [found[key] for key in base],  # type: ignore[misc]
        found[compare] if compare is not None else None,
        detail,
    )
