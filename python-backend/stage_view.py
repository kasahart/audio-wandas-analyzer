"""One step's Frame as the comparison draws it: few enough points to send for every file of a base.

Each Frame type keeps its own picture: a time signal as its level
over time (or, for a metric already sampled slowly, such as loudness, its values), a spectrum on the
comparison's log frequency axis, 1/3-octave levels as bars, a spectrogram as an image on that axis, a
cepstrum as its real coefficients over quefrency, a cepstrogram as an image over time and quefrency, a
cross-correlation as its coefficients over lag (as their ``plot()`` draws them) and a trigger's events each as
its signal over the time from its trigger, overlaid. Two files' views on the same axes subtract to a difference
in what the view measures: dB for levels, the plain difference otherwise.
Channels are combined as the entry table combines them: levels power-averaged, values averaged.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, fields
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
from decimator import absolute_peak, bucket_edges, bucket_extremes
from full_read import IndexOf, XAt, sorted_axis, uniform_axis

#: A metric's or level's points over time before any zoom (each bucket's lowest and highest value). A time signal is
#: told from a metric by the operation that made it (metric_operation), never by how many samples it has.
LEVEL_SERIES_MIN_SAMPLES = 2048
#: Operations whose ChannelFrame is a metric over time, drawn as its own values however long it is, and
#: the unit of those values: wandas keeps the input channel's unit on them (rms_trend's is right: its own).
METRIC_SERIES_UNITS: dict[str, str] = {
    "wandas.audio.loudness_zwtv": "sone",
    "wandas.audio.sharpness_din": "acum",
    "wandas.audio.roughness_dw": "asper",
    "wandas.audio.rms_trend": "",
}
#: A waveform's buckets before any zoom: the track lanes' overview (rangeRequestPolicy.OVERVIEW_POINTS).
WAVEFORM_OVERVIEW_POINTS = 1200
TIME_POINTS = 400
HEATMAP_TIMES = 200
HEATMAP_FREQUENCIES = 128
#: A cepstrum's points before any zoom: per bucket its minimum and maximum, as the lanes draw a waveform
#: (1200 buckets, WAVEFORM_OVERVIEW_POINTS), so a noisy cepstrum is not a zigzag through alternate peaks.
QUEFRENCY_POINTS = 2400
#: A level or gain spectrum's buckets before any zoom: about one per two pixels of a wide plot, the density a zoom
#: asks for, so zooming changes how much of the axis the buckets span, not how the line looks.
SPECTRUM_LINE_BUCKETS = 640
# Cepstral coefficients are small (around 0.01) and signed: kept to five decimals, not one.
CEPSTRUM_DECIMALS = 5
# Every lag of a new step's ±0.1 s at 48 kHz, so its delay peak is at its own lag.
LAG_POINTS = 9601
#: Points per event of a trigger's segments: each bucket's lowest and highest sample, so a hit keeps both its peaks.
EVENT_POINTS = 400

#: The Frames drawn as a line, bars or an image of their own values.
CHART_FRAME_TYPES = (
    ChannelFrame,
    SpectralFrame,
    CoherenceFrame,
    CrossSpectralFrame,
    TransferFunctionFrame,
    SpectrogramFrame,
    NOctFrame,
    RoughnessFrame,
)
#: The Frames the comparison draws: those, the cepstral ones, the cross-correlation and a trigger's segments.
STAGE_FRAME_TYPES = (*CHART_FRAME_TYPES, CepstralFrame, CepstrogramFrame, CrossCorrelationFrame, ChannelFrameSegments)


Quantity = Literal["level", "gain", "coherence", "value", "roughness", "cepstrum", "correlation"]


class StageView(TypedDict):
    frame: str
    kind: Literal["line", "bar", "heatmap", "none"]
    x: NotRequired[Literal["frequency", "time", "band", "quefrency", "lag"]]
    xScale: NotRequired[Literal["log", "linear"]]
    #: What the values are: dB levels (and gains) subtract to a difference in dB; the rest do not.
    quantity: NotRequired[Quantity]
    unit: NotRequired[str]
    xs: NotRequired[list[float]]
    #: A log axis's ends [low, high] Hz when its xs are drawn points rather than band centres.
    xLimits: NotRequired[list[float]]
    #: Heatmap rows: frequencies (Hz, log-spaced), critical-band rates (Bark) or quefrencies (s).
    ys: NotRequired[list[float]]
    #: An image's rows' ends [low, high] Hz on a log axis when its ys are drawn rows (a spectrogram's), as xLimits.
    yLimits: NotRequired[list[float]]
    yAxis: NotRequired[Literal["frequency", "bark", "quefrency"]]
    values: NotRequired[list[float | None]]
    matrix: NotRequired[list[list[float | None]]]
    #: Per heatmap column of an STFT: whether every frame in it has its whole window inside the signal. A frame
    #: centred less than n_fft / 2 from either end reads padding; the headline leaves such columns out.
    whole: NotRequired[list[bool]]
    #: A cross-channel Frame's one drawn pair: the compared channel over the reference (from 1).
    pair: NotRequired[StagePair]
    #: A picture of only part of its axes, at the Frame's full resolution (a zoomed comparison's StageDetail).
    detail: NotRequired[bool]
    #: What a time signal's values are when a step made them from the sound (SIGNAL_MEASURES), for its axis's name.
    measure: NotRequired[Literal["rms", "timeWeightedRms", "power"]]
    #: A time signal's own waveform, as the track lanes draw it: per bucket its minimum and maximum, each at the
    #: time it occurred (s into the file). ``values`` keep the samples' min/max line; the Δ is taken sample by sample.
    waveform: NotRequired[StageWaveform]
    #: A trigger's segments: every event's signal (channels averaged) over the time from its trigger, each drawn
    #: as its own line at its own xs. ``values`` (at ``xs``) are their mean, which a group's median uses.
    events: NotRequired[list[StageEvent]]
    #: The key the step's full-resolution values are kept under (stage_combine.py), for a median or a difference.
    data: NotRequired[str]
    #: A compared line's power in stretches of its axis, from every value before thinning (stage_combine.level_bins):
    #: what the plot orders overlaid lines by, quietest on top, over the part on screen (R6).
    levelBins: NotRequired[StageLevelBins]
    #: A difference's largest magnitude over the part on screen, from every value before thinning
    #: (stage_combine.difference_peak): where the Δ pane's headline says it is.
    peak: NotRequired[StagePeak]
    #: The lowest and highest value of every one of the picture's full-resolution values in the part drawn, before
    #: any is thinned or averaged into a cell (stage_combine.value_range): what its axis or colour range is set from.
    valueRange: NotRequired[StageValueRange]
    #: The x axis of the picture's source data, before anything was thinned and whatever part is drawn
    #: (``source_axis`` of the Frame's reading). The plot takes the whole view's x range from it, and the webview
    #: decides from it which pictures are on one axis (figureModel.pictureAxis). The drawn ``xs`` are for painting
    #: only: their count and ends say nothing about the source (docs/display-rules.md R2).
    xSource: NotRequired[StageSourceAxis]
    #: An image's rows in the source data (frequencies, Bark bands, quefrencies), likewise.
    ySource: NotRequired[StageSourceAxis]


class StageSourceAxis(TypedDict):
    """One axis of a picture's source data: how many values it has along it, and where the first and last are."""

    count: int
    first: float
    last: float
    #: With two values or more: the distance from the first to the second (a signal's sample period, an STFT's hop).
    step: NotRequired[float]


class StagePeak(TypedDict):
    #: Where it is on the x axis, and (an image) on the y axis, at the point's own full-resolution place.
    x: float
    y: NotRequired[float]
    #: The difference there, rounded as the picture's values are.
    value: float
    #: The gap to the nearer neighbouring point on each axis, for the digits the headline writes.
    xStep: NotRequired[float]
    yStep: NotRequired[float]


class StageValueRange(TypedDict):
    min: float
    max: float
    #: A cepstrogram's colour edge: the 99th percentile of its coefficients' magnitudes (as wandas plots it).
    robust: NotRequired[float]


class StageLevelBins(TypedDict):
    #: The stretches' edges on the x axis (one more than the stretches).
    edges: list[float]
    #: Each stretch's mean power (linear: mean square of a signal, mean of 10^(dB/10) of a level).
    power: list[float]
    #: How many values each stretch holds.
    count: list[int]


class StageEvent(TypedDict):
    #: wandas' event ID (from 0), which stays the same when other events are dropped.
    id: int
    #: When it triggered, seconds into the file.
    time: float
    #: The event's own line, as every line is drawn (_envelope): per bucket its lowest and highest sample, each at
    #: the time from the trigger it occurred.
    xs: list[float]
    values: list[float | None]


class StagePair(TypedDict):
    output: int
    input: int
    #: The pair is the recording over the comparison's base slot recording, not two channels of one recording.
    base: NotRequired[bool]


class StageWaveform(TypedDict):
    min: list[float | None]
    max: list[float | None]
    minT: list[float | None]
    maxT: list[float | None]
    absolutePeak: float
    unit: str
    ref: float


class StageDetail(TypedDict):
    """The part of a picture on screen, in its axes' own units, and how many points the screen shows across it."""

    x: list[float]
    y: NotRequired[list[float]]
    points: int
    #: The window on screen itself (the request's x and y reach past it): the Δ headline's peak is found only in it.
    peakX: NotRequired[list[float]]
    peakY: NotRequired[list[float]]


#: A detail image's rows at most (the screen's height is about this).
DETAIL_ROWS = 256


def floored_db(values: np.ndarray) -> np.ndarray:
    """Levels no lower than MIN_LEVEL_DB (silence, an undefined level), unrounded: what every level is computed
    from (a power mean, a median, a difference, the point a read picks), so a rounding never moves a result."""
    floored = np.nan_to_num(values, nan=spec.MIN_LEVEL_DB, neginf=spec.MIN_LEVEL_DB, posinf=-spec.MIN_LEVEL_DB)
    return np.maximum(floored, spec.MIN_LEVEL_DB)


def band_levels(levels_db: np.ndarray, freqs: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """Each row's (levels_db: rows × freqs) levels in the bands between `edges`: the power mean of a band's bins,
    or, for a band narrower than one bin, the level interpolated at its centre. The last band includes its top."""
    centres = np.sqrt(edges[:-1] * edges[1:])
    out = np.empty((levels_db.shape[0], edges.size - 1), dtype=np.float64)
    for index in range(edges.size - 1):
        upper = freqs < edges[index + 1] if index < edges.size - 2 else freqs <= edges[index + 1]
        inside = (freqs >= edges[index]) & upper
        if inside.any():
            out[:, index] = power_mean_db(levels_db[:, inside], axis=1)
        else:
            out[:, index] = [np.interp(centres[index], freqs, row) for row in levels_db]
    return out


def _json(values: np.ndarray) -> list[float | None]:
    return [float(value) if np.isfinite(value) else None for value in np.asarray(values, dtype=np.float64).tolist()]


def _axis(values: np.ndarray) -> list[float]:
    """An axis's coordinates, which are finite (frequencies, times, bands, lags)."""
    return [float(value) for value in np.asarray(values, dtype=np.float64).tolist()]


def power_mean_db(levels_db: np.ndarray, axis: int) -> np.ndarray:
    """Levels power-averaged along ``axis``; silence (zero mean power) is -inf, for the caller to floor."""
    with np.errstate(divide="ignore"):
        return 10.0 * np.log10(np.mean(10.0 ** (levels_db / 10.0), axis=axis))


def _power_mean(levels_db: np.ndarray) -> np.ndarray:
    """Channels (axis 0) power-averaged."""
    return power_mean_db(levels_db, axis=0)


def _rows(values: Any, channels: int) -> np.ndarray:
    """A Frame's per-channel values (channel x value), taken as the reading holds them (``_taken``)."""
    return _taken(values).reshape(channels, -1)


def _log_points(levels_db: np.ndarray, freqs: np.ndarray, points: int, nyquist: float) -> tuple[np.ndarray, np.ndarray]:
    """Levels on `points` log-spaced frequencies from 20 Hz to Nyquist, as the scan's spectrum."""
    edges = np.geomspace(spec.SPECTRUM_MIN_HZ, nyquist, points + 1)
    return np.sqrt(edges[:-1] * edges[1:]), band_levels(levels_db, freqs, edges)


def log_buckets(xs: np.ndarray, buckets: int, span: Sequence[float] | None = None) -> np.ndarray:
    """Each x's bucket among ``buckets`` equally wide on a log axis, between ``span`` when given (else the xs' own
    ends), so the buckets stay put while the view pans. ``xs`` must be positive."""
    low, high = (min(span), max(span)) if span is not None and min(span) > 0 else (float(xs[0]), float(xs[-1]))
    edges = np.geomspace(low, high, buckets + 1)
    return np.clip(np.searchsorted(edges, xs, side="right") - 1, 0, buckets - 1)


def min_max_indices(
    xs: np.ndarray, values: np.ndarray, buckets: int, log: bool, span: Sequence[float] | None = None
) -> np.ndarray:
    """The points of a line to draw in at most ``buckets`` buckets: each bucket's smallest and largest value, each
    at its own x (the one display decimation of a line over frequency, rule 4 of the unified plot spec). Buckets are
    log-spaced on a log axis (``log_buckets``), equal in count on a linear one. Non-finite values (and on a log axis,
    x <= 0) are left out; fewer values than two per bucket are all kept. Of equal values, a bucket's lowest is its
    first and its highest its last. ``xs`` ascending; indices into it, ascending."""
    buckets = max(1, buckets)
    finite = np.isfinite(values)
    if not log and finite.all():
        # Every value kept on a linear axis (a long signal): each bucket's extremes from views of the values,
        # without arrays of indices as long as the line.
        return _linear_extremes(values, buckets)
    kept = np.flatnonzero(finite & ((xs > 0) if log else np.ones(xs.size, dtype=bool)))
    if kept.size <= 2 * buckets:
        return kept
    if log:
        bucket = log_buckets(xs[kept], buckets, span)
    else:
        # On a linear axis, the one bucket rule of every time axis (decimator.bucket_starts).
        bucket = np.repeat(np.arange(buckets), np.diff(bucket_edges(kept.size, buckets)))
    kept_values = values[kept]
    # The buckets are runs of the ascending xs: each run's extremes by reduceat, in one pass.
    starts = np.flatnonzero(np.r_[True, bucket[1:] != bucket[:-1]])
    sizes = np.diff(np.r_[starts, kept.size])
    lowest, highest = np.minimum.reduceat(kept_values, starts), np.maximum.reduceat(kept_values, starts)
    index = np.arange(kept.size)
    first = np.minimum.reduceat(np.where(kept_values == np.repeat(lowest, sizes), index, kept.size), starts)
    last = np.maximum.reduceat(np.where(kept_values == np.repeat(highest, sizes), index, -1), starts)
    return kept[np.unique(np.concatenate([first, last]))]


def _linear_extremes(values: np.ndarray, buckets: int) -> np.ndarray:
    """min_max_indices of finite values on a linear axis: per bucket (decimator.bucket_edges) the first lowest and
    the last highest value's index, ascending."""
    if values.size <= 2 * buckets:
        return np.arange(values.size)
    edges = bucket_edges(values.size, buckets)
    picked = np.empty(2 * buckets, dtype=np.int64)
    for bucket, (start, end) in enumerate(zip(edges[:-1], edges[1:], strict=True)):
        block = values[start:end]
        picked[2 * bucket] = start + int(np.argmin(block))
        picked[2 * bucket + 1] = end - 1 - int(np.argmax(block[::-1]))
    return np.unique(picked)


def min_max_line(
    xs: np.ndarray, values: np.ndarray, buckets: int, log: bool, span: Sequence[float] | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """A line in at most ``buckets`` buckets (min_max_indices), as its xs and values."""
    picked = min_max_indices(xs, values, buckets, log, span)
    return xs[picked], values[picked]


def rows_bucket_count(xs: np.ndarray, rows: int, point_limit: int, span: Sequence[float] | None = None) -> int:
    """The most log buckets whose points fit ``point_limit`` for ``rows`` lines sharing ``xs`` (at most two per row
    per bucket, and no more than the bucket holds), for rows of finite values (the cursor spectrum's are: wandas
    floors its dB at -240). A row with missing values keeps its finite ones whole once they are few enough
    (min_max_indices), which this count does not foresee."""
    positive = xs[xs > 0]
    if positive.size == 0:
        return 1

    def points(buckets: int) -> int:
        # As min_max_indices: no more values than two per bucket are all kept.
        if positive.size <= 2 * buckets:
            return int(positive.size)
        sizes = np.bincount(log_buckets(positive, buckets, span), minlength=buckets)
        return int(np.minimum(sizes, 2 * max(1, rows)).sum())

    low, high = 1, max(1, positive.size)
    while low < high:
        middle = (low + high + 1) // 2
        if points(middle) <= point_limit:
            low = middle
        else:
            high = middle - 1
    return low


def min_max_rows(xs: np.ndarray, rows: np.ndarray, buckets: int, span: Sequence[float] | None = None) -> np.ndarray:
    """Lines that share one x list (a recording's channels): the union of every row's extreme points
    (min_max_indices on a log axis), so each row's line also passes through its real values at the others'
    extremes. ``rows_bucket_count`` gives the buckets that fit a point budget. Indices into ``xs``, ascending."""
    return np.unique(np.concatenate([min_max_indices(xs, row, buckets, True, span) for row in rows]))


def spectrum_line(
    freqs: np.ndarray, levels_db: np.ndarray, bounds: Sequence[float], buckets: int
) -> tuple[np.ndarray, np.ndarray]:
    """A level or gain spectrum's line between ``bounds`` Hz: every bin there, or per log-spaced bucket its lowest
    and highest bin (min_max_line). The same at every zoom, so a peak keeps its height and the line its look."""
    inside = _inside(freqs, list(bounds)) & (freqs > 0)
    return min_max_line(freqs[inside], levels_db[inside], buckets, True, bounds)


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


@dataclass(frozen=True)
class FrameReading:
    """One step's output as the comparison takes it: its values at full resolution with the channels combined, and
    the axes they are on (``read_frame``). Both what is drawn and what is read come from this.

    ``values`` is a line over the x axis, or an image (rows over ``ys``, columns over the x axis). Every value is
    float64, as wandas computes it. The x of a value is asked of ``reading_axis`` / ``x_at`` below, never computed
    from these fields anywhere else.
    """

    mode: Mode
    #: Each value's x. Empty for ``signal``, whose samples are at ``start + n / rate`` (reading_axis).
    xs: np.ndarray
    values: np.ndarray
    #: An image's rows: frequencies (Hz), critical-band rates (Bark) or quefrencies (s).
    ys: np.ndarray | None = None
    #: Per image column of an STFT: whether its whole window is inside the signal (None when its length is unknown).
    whole: np.ndarray | None = None
    nyquist: float = 0.0
    #: A signal's first sample's time (s into the file) and its sample rate.
    start: float = 0.0
    rate: float = 0.0
    #: A signal's reference (its waveform's).
    ref: float = 1.0
    #: A trigger's events: each event's own line (event x sample) and its id.
    rows: np.ndarray | None = None
    event_ids: tuple[int, ...] = ()
    #: A cross-channel Frame's one drawn row (its pair).
    pair_row: int | None = None


def reading_axis(reading: FrameReading) -> tuple[int, XAt, IndexOf]:
    """Where a reading's values are on its x axis, as full_read.py reads an axis: how many points, the x at
    indices, and the index of an x. The one place an index becomes an x.

    A ``signal`` (the sound itself) keeps no array of its samples' times: sample n is at ``start + n / rate``. Every
    other mode keeps its own ``xs``. The picture drawn (this file, stage_combine.draw) and the values read under the
    pointer (stage_combine.read_points) both ask here, so a drawn point and the point read there have the same x
    (docs/display-rules.md R2). Never compute a time, frequency or lag of a reading's values any other way.
    """
    if reading.mode == "signal":
        return uniform_axis(reading.values.size, reading.start, 1.0 / reading.rate if reading.rate > 0 else 0.0)
    return sorted_axis(reading.xs)


def image_rows(reading: FrameReading) -> np.ndarray:
    """An image reading's rows (``ys``). Only an image's view asks, and every image reading has them."""
    if reading.ys is None:
        raise ValueError(f"a {reading.mode} reading has no rows: only an image (spectrogram, ...) is drawn by rows")
    return reading.ys


def source_axis(reading: FrameReading) -> StageSourceAxis | None:
    """The reading's x axis as a picture carries it (StageView ``xSource``): how many values it has, where the first
    and last are, and the step from the first to the second, all asked of ``reading_axis`` (``x_at``). Taken of the
    whole reading, before any value is thinned and whatever part of it is drawn. None for a reading with no values.

    The only producer of ``xSource``: the webview takes a picture's whole-view x range and which pictures share an
    axis from it, never from the drawn points (docs/display-rules.md R2)."""
    count, _x_at, _index_of = reading_axis(reading)
    if count == 0:
        return None
    first, last = (float(value) for value in x_at(reading, [0, count - 1]))
    axis: StageSourceAxis = {"count": int(count), "first": first, "last": last}
    if count > 1:
        axis["step"] = float(x_at(reading, [1])[0]) - first
    return axis


def source_rows(reading: FrameReading) -> StageSourceAxis | None:
    """An image reading's rows as a picture carries them (StageView ``ySource``), as ``source_axis`` takes its x:
    the whole reading's rows, whatever rows are drawn. None for a line."""
    if reading.ys is None or reading.ys.size == 0:
        return None
    ys = reading.ys
    rows: StageSourceAxis = {"count": int(ys.size), "first": float(ys[0]), "last": float(ys[-1])}
    if ys.size > 1:
        rows["step"] = float(ys[1] - ys[0])
    return rows


def with_source_axes(view: StageView | dict, reading: FrameReading | None) -> None:
    """``view`` with the axes of its source data (``xSource``, an image's ``ySource``). Every picture sent gets them
    here: a recording's own (stage_view, whole or zoomed, from the recording's whole reading) and a median or a
    difference (stage_combine.draw, from the common part ``_aligned`` combined)."""
    if reading is None or view.get("kind") == "none":
        return
    x_axis, rows = source_axis(reading), source_rows(reading)
    if x_axis is not None:
        view["xSource"] = x_axis  # type: ignore[typeddict-unknown-key]
    if rows is not None and view.get("kind") == "heatmap":
        view["ySource"] = rows  # type: ignore[typeddict-unknown-key]


def x_at(reading: FrameReading, index: Any) -> np.ndarray:
    """The x of the reading's values at ``index`` (indices into the values along the x axis): ``reading_axis``'s."""
    _count, axis_x_at, _index_of = reading_axis(reading)
    return np.asarray(axis_x_at(np.asarray(index, dtype=np.int64)))


def index_range(reading: FrameReading, bounds: Sequence[float] | None) -> tuple[int, int]:
    """The reading's values whose x is inside ``bounds`` (both ends in), as ``first, last`` for
    ``values[first:last]``; every value without bounds. By ``reading_axis``, so no array of a signal's times is made."""
    count, _x_at, index_of = reading_axis(reading)
    if bounds is None:
        return 0, count
    first = index_of(float(min(bounds)), "left")
    return first, max(first, index_of(float(max(bounds)), "right"))


def _taken(values: Any) -> np.ndarray:
    """A Frame's numbers as a reading holds them: float64, or complex128 for complex values, whatever dtype the
    recording was read in (a 16-bit WAV is float32).

    The one conversion of the comparison's numbers. Only ``_read_frame`` and the helpers it calls use it, on the
    Frame's own arrays and before any arithmetic on them (a channel mean, a power mean, a median): the mean of two
    float32 values a float32 step apart lies between them, which float32 cannot hold. Everything computed later is of
    the reading, which ``read_frame`` has checked, so nothing else converts (docs/display-rules.md R1).
    """
    array = np.asarray(values)
    return array.astype(np.complex128 if np.iscomplexobj(array) else np.float64, copy=False)


def _plane(values: Any) -> np.ndarray:
    """An image Frame's values (channel x row x column) as planes, taken as the reading holds them (``_taken``)."""
    data = _taken(values)
    return data.reshape(-1, data.shape[-2], data.shape[-1])


def _stft_whole(frame: Any, columns: int, signal_s: float | None) -> np.ndarray | None:
    """Per STFT column, whether its window is inside the signal it was taken of (``signal_s`` long)."""
    if signal_s is None:
        return None
    # Frame centres are in the file's time: measured from the start of the signal the STFT was taken of.
    centres = np.atleast_2d(_taken(frame.frame_center_times))[0][:columns] - _offset(frame)
    half = float(frame.n_fft) / 2 / float(frame.sampling_rate)
    return (centres >= half - 1e-9) & (centres <= signal_s - half + 1e-9)


#: The FrameReading array fields that hold flags, not numbers. Every other array field holds numbers.
READING_FLAG_FIELDS = ("whole",)
#: The dtypes a reading's numbers are held in (``_taken``).
READING_DTYPES = (np.dtype(np.float64), np.dtype(np.complex128))


def read_frame(frame: object, signal_s: float | None = None) -> FrameReading | None:
    """``frame``'s values and axes (``_read_frame``), every number of them float64 (complex128 for complex values)
    whatever dtype the Frame's data has.

    A recording read as float32 is converted once, as its data is taken (``_taken``), before any channel is averaged,
    and every array of the reading (values, axes, a trigger's event rows, and any field added later) is checked here:
    nothing after this computes in float32 (docs/display-rules.md R1)."""
    reading = _read_frame(frame, signal_s)
    if reading is None:
        return None
    for item in fields(reading):
        array = getattr(reading, item.name)
        if not isinstance(array, np.ndarray) or item.name in READING_FLAG_FIELDS:
            continue
        if array.dtype not in READING_DTYPES:
            raise TypeError(
                f"read_frame: the reading of a {type(frame).__name__} has {item.name} in {array.dtype}, not float64 "
                "(R1: a reading's numbers are float64). Take the Frame's array with stage_view._taken in its "
                "branch of _read_frame, before any arithmetic on it."
            )
    return reading


def _read_frame(frame: object, signal_s: float | None = None) -> FrameReading | None:
    """``frame``'s values and axes, per Frame kind: the only place the comparison interprets a wandas Frame's data.

    Channels are combined as the entry table combines them (levels power-averaged, values averaged), a
    cross-channel Frame keeps its one drawn pair, and times are seconds into the file. None for a Frame with
    nothing to draw (a kind the app does not draw, no pair of two channels, a trigger with no event).

    To support a new Frame kind, add its branch here, taking its data with ``_taken`` first. Its picture
    (``_stage_view``) and its full-resolution values (stage_combine.stage_data) then both take it from the reading.
    ``signal_s``: the length (s) of the time signal before the step, which an STFT's columns are checked against.
    """
    if isinstance(frame, CepstralFrame):
        return FrameReading("cepstrum", _taken(frame.quefrencies), np.mean(_rows(frame.data, frame.n_channels), axis=0))
    if isinstance(frame, CepstrogramFrame):
        plane = np.mean(_plane(frame.data), axis=0)  # (quefrency, time)
        times = _taken(frame.times)[: plane.shape[1]] + _offset(frame)
        whole = _stft_whole(frame, plane.shape[1], signal_s)
        return FrameReading("cepstrogram", times, plane, _taken(frame.quefrencies), whole)
    if isinstance(frame, CrossCorrelationFrame):
        row = _cross_pair(frame)
        if row is None:
            return None
        coefficients = _taken(frame.coefficients).reshape(-1, frame.n_lags)[row]
        return FrameReading("correlation", _taken(frame.lags), coefficients, pair_row=row)
    if isinstance(frame, ChannelFrameSegments):
        if not len(frame):
            return None
        rows, times = _event_rows(frame)
        ids = tuple(int(event_id) for event_id in frame.event_ids)
        return FrameReading("events", times, np.mean(rows, axis=0), rows=rows, event_ids=ids)
    if isinstance(frame, ChannelFrame):
        data = _rows(frame.data, frame.n_channels)
        # Seconds into the file, so a region's level reads at the region's times.
        times = _taken(frame.source_time).reshape(frame.n_channels, -1)[0]
        if _in_db(frame):
            # Already dB levels (sound_level or rms_trend with dB=True): channels power-averaged, never a level of
            # them.
            return FrameReading("series", times, _power_mean(data))
        if metric_operation(frame) is not None:
            # A metric (loudness, ...) is its own values however long or short the region.
            return FrameReading("series", times, np.mean(data, axis=0))
        # The sound itself, however few samples it has: every sample, channels averaged. The comparison makes no
        # level of it (a level is a wandas step's), and a difference is compare - base sample by sample.
        return FrameReading(
            "signal",
            np.empty(0),
            np.mean(data, axis=0),
            start=float(times[0]) if times.size else 0.0,
            rate=float(frame.sampling_rate),
            ref=float(frame.channels[0].ref),
        )
    if isinstance(frame, (SpectralFrame, CoherenceFrame, CrossSpectralFrame, TransferFunctionFrame)):
        quantity, rows = _spectral_rows(frame)
        pair_row: int | None = None
        if _pairwise(frame):
            pair_row = _cross_pair(frame)
            if pair_row is None:
                return None
            rows = rows[pair_row : pair_row + 1]
        freqs, nyquist = _taken(frame.freqs), float(frame.sampling_rate) / 2
        if quantity == "coherence":
            return FrameReading("coherence", freqs, rows[0], nyquist=nyquist, pair_row=pair_row)
        return FrameReading("spectrum", freqs, _power_mean(floored_db(rows)), nyquist=nyquist, pair_row=pair_row)
    if isinstance(frame, NOctFrame):
        levels = _power_mean(floored_db(_rows(frame.dB, frame.n_channels)))
        return FrameReading("bands", _taken(frame.freqs), levels)
    if isinstance(frame, SpectrogramFrame):
        plane = _power_mean(floored_db(_plane(frame.dB)))  # (frequency, time)
        times = _taken(frame.times)[: plane.shape[1]] + _offset(frame)
        whole = _stft_whole(frame, plane.shape[1], signal_s)
        return FrameReading(
            "spectrogram", times, plane, _taken(frame.freqs), whole, nyquist=float(frame.sampling_rate) / 2
        )
    if isinstance(frame, RoughnessFrame):
        plane = np.mean(_plane(frame.data), axis=0)  # (Bark band, time)
        times = _taken(frame.time)[: plane.shape[1]] + _offset(frame)
        return FrameReading("roughness", times, plane, _taken(frame.bark_axis)[: plane.shape[0]])
    return None


def signal_line(reading: FrameReading, first: int, last: int, points: int) -> tuple[np.ndarray, np.ndarray]:
    """A signal's samples ``first`` to ``last`` as a line of at most ``points`` points (_envelope_indices): each
    drawn sample at its own time, which only the samples drawn are given (no array of every sample's time)."""
    values = reading.values[first:last]
    picked = _envelope_indices(values, points)
    return x_at(reading, first + picked), values[picked]


def samples_waveform(reading: FrameReading, first: int, last: int, unit: str, ref: float, points: int) -> StageWaveform:
    """A signal's samples ``first`` to ``last`` as the lanes draw a waveform: per bucket its lowest and highest
    sample (decimator.bucket_extremes), each at that sample's own time.

    minT and maxT are ``x_at`` of the drawn samples' indices: the times a read of the same samples gives
    (docs/display-rules.md R2). They are never a fraction of the picture scaled to a span.
    """
    samples = reading.values[first:last]
    if samples.size == 0:
        return {"min": [], "max": [], "minT": [], "maxT": [], "absolutePeak": 0.0, "unit": unit, "ref": ref}
    lowest, highest = bucket_extremes(samples, min(points, samples.size))
    return {
        "min": _json(samples[lowest]),
        "max": _json(samples[highest]),
        "minT": _json(x_at(reading, first + lowest)),
        "maxT": _json(x_at(reading, first + highest)),
        "absolutePeak": absolute_peak(samples),
        "unit": unit,
        "ref": ref,
    }


#: What a time signal's values are when a step made them from the sound, for its value axis to name: a root mean
#: square over a window, a time-weighted one (Fast, Slow), or the squared signal.
Measure = Literal["rms", "timeWeightedRms", "power"]
SIGNAL_MEASURES: dict[str, Measure] = {
    "wandas.audio.rms_trend": "rms",
    "wandas.audio.sound_level": "timeWeightedRms",
    "wandas.audio.power": "power",
}


def signal_measure(frame: ChannelFrame, in_db: bool = False) -> Measure | None:
    """What rms_trend, sound_level or power made `frame`'s values (SIGNAL_MEASURES), or None.

    None where the name would be wrong: a power other than the square is not in the unit squared; and one of them
    after another (an RMS of a power) is in neither's unit. Those are drawn as an amplitude, as before. A level in dB
    (`in_db`) is the level of the RMS it was made from: named by it, its unit the level's (a power in dB is not one).
    """
    found: list[tuple[str, dict]] = []
    for item in reversed(frame.operation_history):
        operation = str(item.get("operation", ""))
        if operation in SIGNAL_MEASURES:
            params = item.get("params")
            found.append((operation, params if isinstance(params, dict) else {}))
        elif operation in METRIC_SERIES_UNITS:
            # A metric (loudness, …) is its own quantity: what came before it does not name its values.
            break
    if len(found) != 1:
        return None
    operation, params = found[0]
    if bool(params.get("dB")) != in_db or (
        operation == "wandas.audio.power" and (in_db or params.get("exponent", 2.0) != 2.0)
    ):
        return None
    return SIGNAL_MEASURES[operation]


def _in_db(frame: ChannelFrame) -> bool:
    """Whether the time signal's values are already dB levels (wandas names their unit "dB …")."""
    return (frame.channels[0].unit or "").startswith("dB")


def metric_operation(frame: ChannelFrame) -> str | None:
    """The latest metric `frame` came through (a trim after it keeps it one), or None for a sound signal."""
    for item in reversed(frame.operation_history):
        operation = str(item.get("operation", ""))
        if operation in METRIC_SERIES_UNITS:
            return operation
    return None


def _channel_view(frame: ChannelFrame, reading: FrameReading) -> StageView:
    measure = signal_measure(frame)
    if reading.mode == "series" and _in_db(frame):
        # A level already in dB: a level, drawn and compared as one (the headline's audible floor, the dB ranges).
        xs, values = _envelope(reading.xs, reading.values, LEVEL_SERIES_MIN_SAMPLES)
        level: StageView = {
            "frame": type(frame).__name__,
            "kind": "line",
            "x": "time",
            "xScale": "linear",
            "quantity": "level",
            "unit": frame.channels[0].unit or "",
            "xs": _axis(xs),
            "values": _json(floored_db(values)),
        }
        # The level of what: an RMS over a window, or a time-weighted one, for its axis to name (never "amplitude").
        level_of = signal_measure(frame, in_db=True)
        if level_of:
            level["measure"] = level_of
        return level
    if reading.mode == "series":
        # A metric (loudness at 500 Hz, …) is its own values however long or short the region: never a level of them.
        metric = metric_operation(frame)
        xs, values = _envelope(reading.xs, reading.values, LEVEL_SERIES_MIN_SAMPLES)
        series: StageView = {
            "frame": type(frame).__name__,
            "kind": "line",
            "x": "time",
            "xScale": "linear",
            "quantity": "value",
            "unit": (METRIC_SERIES_UNITS[metric] if metric else "") or frame.channels[0].unit or "",
            "xs": _axis(xs),
            "values": _json(values),
        }
        if measure:
            series["measure"] = measure
        return series
    # The sound itself, as wandas gives it, however few samples it has: drawn as its waveform and compared sample by
    # sample (a difference is compare − base, a ChannelFrame subtraction). The comparison makes no level of it: a
    # level is a wandas step's (sound_level, rms_trend), whose window the recipe records.
    unit = frame.channels[0].unit or ""
    count = reading.values.size
    xs, values = signal_line(reading, 0, count, LEVEL_SERIES_MIN_SAMPLES)
    view: StageView = {
        "frame": type(frame).__name__,
        "kind": "line",
        "x": "time",
        "xScale": "linear",
        "quantity": "value",
        "unit": unit,
        "xs": _axis(xs),
        "values": _json(values),
        "waveform": samples_waveform(reading, 0, count, unit, reading.ref, WAVEFORM_OVERVIEW_POINTS),
    }
    if measure:
        view["measure"] = measure
    return view


def _event_rows(segments: ChannelFrameSegments) -> tuple[np.ndarray, np.ndarray]:
    """Every event's samples with its channels averaged (event × sample), and each sample's time from the trigger."""
    # In float64 before the channels are averaged, as every reading is (read_frame): the mean of two float32
    # samples a float32 step apart lies between them.
    data = _taken(segments.to_numpy())
    rows = np.mean(data.reshape(data.shape[0], data.shape[1], -1), axis=1)
    rate = float(segments[0].sampling_rate)
    return rows, np.arange(rows.shape[1]) / rate - float(segments.pre)


def _events_view(segments: ChannelFrameSegments, rows: np.ndarray, times: np.ndarray, points: int) -> StageView:
    # Every event's line and their mean by the rule of every line: each bucket's lowest and highest value, each at
    # its own time, so each event is its own series (no x shared, no value moved to a bucket's edge).
    xs, mean = _envelope(times, np.mean(rows, axis=0), points)
    lines = [_envelope(times, row, points) for row in rows]
    return {
        "frame": type(segments).__name__,
        "kind": "line",
        "x": "time",
        "xScale": "linear",
        "quantity": "value",
        "unit": segments[0].channels[0].unit or "",
        "xs": _axis(xs),
        "values": _json(mean),
        # Each event's trigger in the file's own time (trigger_times count from the region the events were cut from).
        "events": [
            {
                "id": int(event_id),
                "time": float(item.source_time_offset[0]) + float(segments.pre),
                "xs": _axis(line_xs),
                "values": _json(line_values),
            }
            for event_id, item, (line_xs, line_values) in zip(segments.event_ids, segments, lines, strict=True)
        ],
    }


def _segments_view(segments: ChannelFrameSegments, reading: FrameReading | None) -> StageView:
    if reading is None or reading.rows is None:
        # No event crossed the level: still the trigger's picture, with none on it (the headline counts 0).
        return {
            "frame": type(segments).__name__,
            "kind": "line",
            "x": "time",
            "xScale": "linear",
            "quantity": "value",
            "xs": [],
            "values": [],
            "events": [],
        }
    return _events_view(segments, reading.rows, reading.xs, EVENT_POINTS)


def _cross_pair(frame: Any) -> int | None:
    """The row drawn of a cross-channel Frame: the pair a select_pair step left, else the first channel over
    the first reference (ch2 / ch1). A channel's coherence with itself is 1, and its transfer function 0 dB:
    they say nothing, so a Frame with no other pair (a one-channel recording) is not drawn."""
    cross = [
        (pair.input.index, pair.output.index, row)
        for row, pair in enumerate(frame.pairs)
        if pair.output.index != pair.input.index
    ]
    return min(cross)[2] if cross else None


def _pair_of(frame: Any, row: int) -> StagePair:
    pair = frame.pairs[row]
    return {"output": int(pair.output.index) + 1, "input": int(pair.input.index) + 1}


def _spectral_rows(frame: Any) -> tuple[Quantity, np.ndarray]:
    """What a spectrum-like Frame measures, and its values: one row per channel (or channel pair)."""
    quantity: Quantity
    if isinstance(frame, CoherenceFrame):
        quantity, raw = "coherence", frame.coherence
    elif isinstance(frame, TransferFunctionFrame):
        quantity, raw = "gain", _transfer_rows(frame)
    elif isinstance(frame, CrossSpectralFrame):
        quantity, raw = "level", frame.level_db
    else:
        quantity, raw = "level", frame.dB
    return quantity, _taken(raw).reshape(-1, np.asarray(frame.freqs).size)


def _spectral_quantity(frame: Any) -> Quantity:
    """What a spectrum-like Frame measures (as _spectral_rows names it), without computing its values."""
    if isinstance(frame, CoherenceFrame):
        return "coherence"
    return "gain" if isinstance(frame, TransferFunctionFrame) else "level"


def _transfer_rows(frame: TransferFunctionFrame) -> np.ndarray:
    """A transfer function's rows in dB, as the pair view measures them (A33): a gain, 20 log10 |H|, for a pair of
    one unit; else the transfer level in dB re the units' ratio, since a gain of two units is no ratio. gain_db
    refuses a Frame with any such pair, so every row is taken as a transfer level and a dimensionless one's
    reference ratio put back."""
    levels = _taken(frame.transfer_level_db).reshape(len(frame.pair_domains), -1).copy()
    for row, domain in enumerate(frame.pair_domains):
        if domain.unit == "1":
            levels[row] += 20.0 * np.log10(domain.reference)
    return levels


def _transfer_unit(frame: Any, row: int) -> str | None:
    """A transfer function row's level reference ("dB re 2e-05 Pa/V") where its two channels' units differ; None
    for a gain, which is plain dB."""
    if not isinstance(frame, TransferFunctionFrame) or frame.pair_domains[row].unit == "1":
        return None
    return str(frame.channels[row].level_reference.label)


def _pairwise(frame: Any) -> bool:
    return isinstance(frame, (CoherenceFrame, CrossSpectralFrame, TransferFunctionFrame))


def _spectral_view(frame: Any, reading: FrameReading | None) -> StageView:
    if reading is None or reading.nyquist <= spec.SPECTRUM_MIN_HZ or reading.xs.size < 2:
        return {"frame": type(frame).__name__, "kind": "none"}
    quantity, nyquist = _spectral_quantity(frame), reading.nyquist
    pair: StagePair | None = None
    unit: str | None = None
    row = reading.pair_row
    if row is not None:
        pair, unit = _pair_of(frame, row), _transfer_unit(frame, row)
        if isinstance(frame, CrossSpectralFrame) and frame.pair_domains[row].unit != "1":
            # A cross spectrum of two units (a recording against the base slot's) is re its pair's reference
            # (wandas' pair domain), never either channel's.
            unit = str(frame.channels[row].level_reference.label)
    # Each bucket's lowest and highest bin at its own frequency, so a dip stays. The bins kept are picked from the
    # unrounded values; a level is floored only once picked.
    centres, line = spectrum_line(reading.xs, reading.values, [spec.SPECTRUM_MIN_HZ, nyquist], SPECTRUM_LINE_BUCKETS)
    if quantity != "coherence":
        line = floored_db(line)
    view: StageView = {
        "frame": type(frame).__name__,
        "kind": "line",
        "x": "frequency",
        "xScale": "log",
        "quantity": quantity,
        "xs": _axis(centres),
        "xLimits": [float(spec.SPECTRUM_MIN_HZ), float(nyquist)],
        "values": _json(line),
    }
    if pair is not None:
        view["pair"] = pair
    if unit is not None:
        view["unit"] = unit
    return view


def _noct_view(frame: NOctFrame, reading: FrameReading) -> StageView:
    return {
        "frame": type(frame).__name__,
        "kind": "bar",
        "x": "band",
        "xScale": "log",
        "quantity": "level",
        "xs": _axis(reading.xs),
        "values": _json(floored_db(reading.values)),
    }


def _offset(frame: Any) -> float:
    """Where the frame starts in the file (a region's start), in seconds."""
    offset = _taken(getattr(frame, "source_time_offset", 0.0)).reshape(-1)
    return float(offset[0]) if offset.size else 0.0


def _time_blocks(count: int) -> list[slice]:
    edges = bucket_edges(count, HEATMAP_TIMES)
    return [slice(start, end) for start, end in zip(edges[:-1], edges[1:], strict=True)]


class _WholeColumns(TypedDict, total=False):
    whole: list[bool]


def _whole_columns(reading: FrameReading, blocks: list[slice]) -> _WholeColumns:
    """``whole`` for an STFT's drawn columns, when the length of the signal it was taken of is known: a drawn
    column is whole when every frame in it is."""
    if reading.whole is None:
        return {}
    return {"whole": [bool(np.all(reading.whole[block])) for block in blocks]}


def _block_centres(times: np.ndarray, blocks: list[slice]) -> np.ndarray:
    """Where each drawn column of an image is: the mean of the times of the frames it holds, so inside its block."""
    return np.array([float(np.mean(times[block])) for block in blocks])


def _spectrogram_view(frame: SpectrogramFrame, reading: FrameReading) -> StageView:
    level, freqs, nyquist = reading.values, image_rows(reading), reading.nyquist  # level: (freq, time)
    if nyquist <= spec.SPECTRUM_MIN_HZ or freqs.size < 2:
        return {"frame": type(frame).__name__, "kind": "none"}
    blocks = _time_blocks(level.shape[1])
    columns = np.stack([_power_mean(level[:, block].T) for block in blocks], axis=1)
    centres, matrix = _log_points(columns.T, freqs, HEATMAP_FREQUENCIES, nyquist)
    return {
        "frame": type(frame).__name__,
        "kind": "heatmap",
        "x": "time",
        "xScale": "linear",
        "quantity": "level",
        "xs": _axis(_block_centres(reading.xs, blocks)),
        "ys": _axis(centres),
        "yLimits": [float(spec.SPECTRUM_MIN_HZ), float(nyquist)],
        "yAxis": "frequency",
        # One decimal: an image of a dB level needs no more, and a base sends one per file.
        "matrix": [_json(row) for row in np.round(floored_db(matrix).T, 1)],
        **_whole_columns(reading, blocks),
    }


def _roughness_view(frame: RoughnessFrame, reading: FrameReading) -> StageView:
    plane = reading.values
    blocks = _time_blocks(plane.shape[1])
    return {
        "frame": type(frame).__name__,
        "kind": "heatmap",
        "x": "time",
        "xScale": "linear",
        "quantity": "roughness",
        # Each Bark band's specific roughness (wandas' own plot: "Specific Roughness [Asper/Bark]"), not the total.
        "unit": "asper/Bark",
        "xs": _axis(_block_centres(reading.xs, blocks)),
        "ys": _axis(image_rows(reading)),
        "yAxis": "bark",
        "matrix": [_json(np.array([np.mean(row[block]) for block in blocks])) for row in plane],
    }


def _block_peaks(values: np.ndarray, count: int) -> tuple[np.ndarray, np.ndarray]:
    """`values` (last axis) in at most `count` blocks, each the value of largest magnitude, and the block edges."""
    edges = bucket_edges(values.shape[-1], count)
    picked = [
        np.take_along_axis(block, np.argmax(np.abs(block), axis=-1)[..., np.newaxis], axis=-1)[..., 0]
        for block in (values[..., start:end] for start, end in zip(edges[:-1], edges[1:], strict=True))
    ]
    return np.stack(picked, axis=-1), edges


def _signed_peaks(values: np.ndarray, count: int) -> tuple[np.ndarray, np.ndarray]:
    """`values` (last axis) in at most `count` blocks, each the value of largest magnitude, with its first index.

    A cepstrum's peaks are single bins: an average over a block would wash them out.
    """
    peaks, edges = _block_peaks(values, count)
    return peaks, edges[:-1]


def _cepstrum_envelope(quefrencies: np.ndarray, coefficients: np.ndarray, points: int) -> tuple[np.ndarray, np.ndarray]:
    """A cepstrum's line: the zero-quefrency coefficient as it is (the first point, which the ranges leave out),
    then the rest's minimum and maximum per bucket (_envelope)."""
    if quefrencies.size and quefrencies[0] == 0:
        xs, values = _envelope(quefrencies[1:], coefficients[1:], max(0, points - 1))
        return np.concatenate([quefrencies[:1], xs]), np.concatenate([coefficients[:1], values])
    return _envelope(quefrencies, coefficients, points)


def _cepstral_view(frame: CepstralFrame, reading: FrameReading) -> StageView:
    # One line per channel in plot(); the comparison averages channels, as it does every value.
    xs, values = _cepstrum_envelope(reading.xs, reading.values, QUEFRENCY_POINTS)
    return {
        "frame": type(frame).__name__,
        "kind": "line",
        "x": "quefrency",
        "xScale": "linear",
        "quantity": "cepstrum",
        "xs": _axis(xs),
        "values": _json(values),
    }


def _correlation_view(frame: CrossCorrelationFrame, reading: FrameReading | None) -> StageView:
    if reading is None or reading.pair_row is None or reading.xs.size < 2:
        return {"frame": type(frame).__name__, "kind": "none"}
    lags, values = _envelope(reading.xs, reading.values, LAG_POINTS)
    return {
        "frame": type(frame).__name__,
        "kind": "line",
        "x": "lag",
        "xScale": "linear",
        "quantity": "correlation",
        "xs": _axis(lags),
        "values": _json(values),
        "pair": _pair_of(frame, reading.pair_row),
    }


def _cepstrogram_view(frame: CepstrogramFrame, reading: FrameReading) -> StageView:
    plane = reading.values  # (quefrency, time)
    blocks = _time_blocks(plane.shape[1])
    columns = np.stack([np.mean(plane[:, block], axis=1) for block in blocks], axis=1)
    rows, starts = _signed_peaks(columns.T, HEATMAP_FREQUENCIES)
    return {
        "frame": type(frame).__name__,
        "kind": "heatmap",
        "x": "time",
        "xScale": "linear",
        "quantity": "cepstrum",
        "xs": _axis(_block_centres(reading.xs, blocks)),
        "ys": _axis(image_rows(reading)[starts]),
        "yAxis": "quefrency",
        "matrix": [_json(row) for row in np.round(rows.T, CEPSTRUM_DECIMALS)],
        **_whole_columns(reading, blocks),
    }


def _envelope_indices(values: np.ndarray, points: int) -> np.ndarray:
    """Which values of a line on a linear axis are drawn in at most ``points`` points: all of them when they are
    that few, else each bucket's lowest and highest (min_max_indices, whose buckets are ``decimator.bucket_starts``'s,
    as the lanes' waveforms; non-finite values are then left out). Indices into ``values``, ascending."""
    if values.size <= points:
        return np.arange(values.size)
    # On a linear axis the buckets are counts of values: min_max_indices needs no xs.
    return min_max_indices(np.broadcast_to(np.float64(0.0), values.shape), values, max(1, points // 2), False)


def _envelope(xs: np.ndarray, values: np.ndarray, points: int) -> tuple[np.ndarray, np.ndarray]:
    """A line over time, quefrency or lag in at most `points` points: per bucket its lowest and highest value, each
    at its own x (_envelope_indices). Fewer values than points are all kept."""
    picked = _envelope_indices(values, points)
    return xs[picked], values[picked]


def _inside(axis: np.ndarray, bounds: list[float]) -> np.ndarray:
    return (axis >= min(bounds)) & (axis <= max(bounds))


def _log_rows(
    levels_db: np.ndarray, freqs: np.ndarray, bounds: list[float], rows: int
) -> tuple[np.ndarray, np.ndarray]:
    """A spectrogram's rows (levels_db: frequency × time) between `bounds` Hz: every bin there, or, with more bins
    than `rows`, `rows` log-spaced bands (band_levels, as the spectra are made) between the bins there, so a range
    past the Frame's Nyquist frequency adds no band without bins."""
    inside = _inside(freqs, bounds) & (freqs > 0)
    if inside.sum() <= rows:
        return freqs[inside], levels_db[inside]
    edges = np.geomspace(max(min(bounds), freqs[inside][0]), min(max(bounds), freqs[inside][-1]), rows + 1)
    return np.sqrt(edges[:-1] * edges[1:]), band_levels(levels_db.T, freqs, edges).T


def _detail_view(frame: object, reading: FrameReading | None, coarse: StageView, detail: StageDetail) -> StageView:
    """The part of `coarse` on screen, from the Frame's full resolution (``reading``): the spectrum's own bins, the
    samples or short levels of a time signal, the cepstrum's coefficients, an image's own columns and rows (or as
    many as the screen shows). 1/3-octave bars are already whole bands: they stay as they are."""
    if reading is None:
        return coarse
    points = int(detail["points"])
    bounds = [float(value) for value in detail["x"]]
    view: StageView = {
        key: value for key, value in coarse.items() if key not in ("xs", "ys", "values", "matrix", "whole")
    }  # type: ignore[assignment]
    view["detail"] = True
    mode = reading.mode
    if mode == "signal":
        first, last = index_range(reading, bounds)
        xs, values = signal_line(reading, first, last, points)
        view.update({"xs": _axis(xs), "values": _json(values)})
        view["waveform"] = samples_waveform(reading, first, last, str(coarse.get("unit") or ""), reading.ref, points)
        return view
    if mode in ("spectrum", "coherence"):
        # As the whole picture: each two pixels' lowest and highest bin.
        xs, values = spectrum_line(reading.xs, reading.values, bounds, points // 2)
        view.update({"xs": _axis(xs), "values": _json(values)})
        return view
    keep = _inside(reading.xs, bounds)
    if mode == "events":
        if reading.rows is None or not keep.any() or not isinstance(frame, ChannelFrameSegments):
            return coarse
        return {**_events_view(frame, reading.rows[:, keep], reading.xs[keep], points), "detail": True}
    if mode == "series":
        xs, values = _envelope(reading.xs[keep], reading.values[keep], points)
        # As the whole picture's (_channel_view): a level in dB is floored.
        view.update(
            {"xs": _axis(xs), "values": _json(floored_db(values) if coarse.get("quantity") == "level" else values)}
        )
        return view
    if mode == "correlation":
        if not keep.any():
            return coarse
        xs, values = _envelope(reading.xs[keep], reading.values[keep], points)
        view.update({"xs": _axis(xs), "values": _json(values)})
        return view
    if mode == "cepstrum":
        xs, values = _cepstrum_envelope(reading.xs[keep], reading.values[keep], points)
        view.update({"xs": _axis(xs), "values": _json(values)})
        return view
    if mode in ("spectrogram", "cepstrogram", "roughness"):
        rows_bounds = [float(value) for value in detail.get("y", [-np.inf, np.inf])]
        plane, times, rows_axis = reading.values[:, keep], reading.xs[keep], image_rows(reading)
        edges = bucket_edges(times.size, max(2, points // 2))
        blocks = [slice(a, b) for a, b in zip(edges[:-1], edges[1:], strict=True) if b > a]
        if mode == "spectrogram":
            columned = (
                np.stack([_power_mean(plane[:, block].T) for block in blocks], axis=1) if blocks else plane[:, :0]
            )
            limits = rows_bounds if np.all(np.isfinite(rows_bounds)) else [spec.SPECTRUM_MIN_HZ, reading.nyquist]
            ys, matrix = _log_rows(columned, rows_axis, limits, DETAIL_ROWS)
            matrix = np.round(floored_db(matrix), 1)
        else:
            columned = (
                np.stack([np.mean(plane[:, block], axis=1) for block in blocks], axis=1) if blocks else plane[:, :0]
            )
            inside = _inside(rows_axis, rows_bounds)
            if mode == "cepstrogram":
                peaks, starts = _signed_peaks(columned[inside].T, DETAIL_ROWS)
                ys, matrix = rows_axis[inside][starts], np.round(peaks.T, CEPSTRUM_DECIMALS)
            else:
                ys, matrix = rows_axis[inside], columned[inside]
        view.update(
            {
                "xs": _axis(_block_centres(times, blocks)),
                "ys": _axis(ys),
                "matrix": [_json(row) for row in np.asarray(matrix)],
            }
        )
        return view
    return coarse


def stage_view(frame: object, signal_s: float | None = None, detail: StageDetail | None = None) -> StageView:
    """The comparison's picture of one step's output; ``kind: "none"`` for a Frame the app does not draw.

    ``signal_s``: the length (s) of the time signal before the step, which an STFT's columns are checked against.
    ``detail``: only the part on screen of a zoomed picture, at the Frame's full resolution.
    """
    # The Frame is interpreted once (read_frame): the picture, its zoomed part and the full-resolution values kept
    # for reading all come from this one reading, so they are on the same axes.
    reading = read_frame(frame, signal_s)
    coarse = _stage_view(frame, reading)
    view = (
        coarse if detail is None or coarse["kind"] in ("none", "bar") else _detail_view(frame, reading, coarse, detail)
    )
    if view["kind"] in ("line", "bar", "heatmap"):
        # The order overlaid lines are drawn in, and every axis and colour range, come from every value, not the
        # drawn points or the cells averaged to draw them (R1, R2, R6, R9).
        from stage_combine import stage_data, with_level_bins, with_value_range

        data = stage_data(frame, coarse, signal_s, reading)
        part = detail if view is not coarse else None
        with_level_bins(view, data, part)
        with_value_range(view, data, part)
        with_source_axes(view, reading)
    return view


def _stage_view(frame: object, reading: FrameReading | None) -> StageView:
    """``frame``'s whole picture, drawn from ``reading`` (read_frame of it). The Frame itself gives only what is not
    data: its name, units, pair and the operations that made it."""
    none: StageView = {"frame": type(frame).__name__, "kind": "none"}
    if isinstance(frame, ChannelFrameSegments):
        return _segments_view(frame, reading)
    if isinstance(frame, CrossCorrelationFrame):
        return _correlation_view(frame, reading)
    if isinstance(frame, (SpectralFrame, CoherenceFrame, CrossSpectralFrame, TransferFunctionFrame)):
        return _spectral_view(frame, reading)
    if reading is None:
        return none
    if isinstance(frame, CepstralFrame):
        return _cepstral_view(frame, reading)
    if isinstance(frame, CepstrogramFrame):
        return _cepstrogram_view(frame, reading)
    if isinstance(frame, ChannelFrame):
        return _channel_view(frame, reading)
    if isinstance(frame, NOctFrame):
        return _noct_view(frame, reading)
    if isinstance(frame, SpectrogramFrame):
        return _spectrogram_view(frame, reading)
    if isinstance(frame, RoughnessFrame):
        return _roughness_view(frame, reading)
    return none
