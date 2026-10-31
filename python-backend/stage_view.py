"""One step's Frame as the comparison draws it: few enough points to send for every file of a base.

Each Frame type keeps its own picture (wandas_to_chart draws the same types): a time signal as its level
over time (or, for a metric already sampled slowly, such as loudness, its values), a spectrum on the
comparison's log frequency axis, 1/3-octave levels as bars, a spectrogram as an image on that axis, a
cepstrum as its real coefficients over quefrency, a cepstrogram as an image over time and quefrency and a
cross-correlation as its coefficients over lag (as their ``plot()`` draws them). Two files' views on the
same axes subtract to a difference in what the view measures: dB for levels, the plain difference otherwise.
Channels are combined as the entry table combines them: levels power-averaged, values averaged.
"""

from __future__ import annotations

import warnings
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

import analysis_spec as spec
from wandas_to_chart import CHART_FRAME_TYPES

# A time signal longer than this is drawn as its level over time; a shorter one is a metric's values.
LEVEL_SERIES_MIN_SAMPLES = 2048
#: A waveform's buckets before any zoom: the track lanes' overview (rangeRequestPolicy.OVERVIEW_POINTS).
WAVEFORM_OVERVIEW_POINTS = 1200
TIME_POINTS = 400
HEATMAP_TIMES = 200
HEATMAP_FREQUENCIES = 128
QUEFRENCY_POINTS = 800
# Cepstral coefficients are small (around 0.01) and signed: kept to five decimals, not one.
CEPSTRUM_DECIMALS = 5
# Every lag of a new step's ±0.1 s at 48 kHz, so its delay peak is at its own lag.
LAG_POINTS = 9601
# Normalized cross-correlation coefficients lie in [-1, 1].
CORRELATION_DECIMALS = 4

#: The Frames the comparison draws: those wandas_to_chart draws, the cepstral ones and the cross-correlation.
STAGE_FRAME_TYPES = (*CHART_FRAME_TYPES, CepstralFrame, CepstrogramFrame, CrossCorrelationFrame)


class StageView(TypedDict):
    frame: str
    kind: Literal["line", "bar", "heatmap", "none"]
    x: NotRequired[Literal["frequency", "time", "band", "quefrency", "lag"]]
    xScale: NotRequired[Literal["log", "linear"]]
    #: What the values are: dB levels (and gains) subtract to a difference in dB; the rest do not.
    quantity: NotRequired[Literal["level", "gain", "coherence", "value", "roughness", "cepstrum", "correlation"]]
    unit: NotRequired[str]
    xs: NotRequired[list[float]]
    #: Heatmap rows: frequencies (Hz, log-spaced), critical-band rates (Bark) or quefrencies (s).
    ys: NotRequired[list[float]]
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
    #: A time signal's own waveform, as the track lanes draw it: per bucket its minimum and maximum, each at the
    #: time it occurred (s into the file). ``values`` keep the level over time the headline and Δ are read from.
    waveform: NotRequired[StageWaveform]


class StagePair(TypedDict):
    output: int
    input: int
    #: The pair is the recording over the comparison's base slot recording, not two channels of one recording.
    base: NotRequired[bool]


class StageWaveform(TypedDict):
    min: list[float]
    max: list[float]
    minT: list[float]
    maxT: list[float]
    absolutePeak: float
    unit: str
    ref: float


class StageDetail(TypedDict):
    """The part of a picture on screen, in its axes' own units, and how many points the screen shows across it."""

    x: list[float]
    y: NotRequired[list[float]]
    points: int


#: A detail image's rows at most (the screen's height is about this).
DETAIL_ROWS = 256


def rounded_db(values: np.ndarray) -> np.ndarray:
    """Levels as the app shows them: no lower than MIN_LEVEL_DB (silence, an undefined level), to DB_DECIMALS."""
    floored = np.nan_to_num(values, nan=spec.MIN_LEVEL_DB, neginf=spec.MIN_LEVEL_DB, posinf=-spec.MIN_LEVEL_DB)
    return np.round(np.maximum(floored, spec.MIN_LEVEL_DB), spec.DB_DECIMALS)


def band_levels(levels_db: np.ndarray, freqs: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """Each row's (levels_db: rows × freqs) levels in the bands between `edges`: the power mean of a band's bins,
    or, for a band narrower than one bin, the level interpolated at its centre. The last band includes its top."""
    centres = np.sqrt(edges[:-1] * edges[1:])
    out = np.empty((levels_db.shape[0], edges.size - 1), dtype=np.float64)
    for index in range(edges.size - 1):
        upper = freqs < edges[index + 1] if index < edges.size - 2 else freqs <= edges[index + 1]
        inside = (freqs >= edges[index]) & upper
        if inside.any():
            with np.errstate(divide="ignore"):
                out[:, index] = 10.0 * np.log10(np.mean(10.0 ** (levels_db[:, inside] / 10.0), axis=1))
        else:
            out[:, index] = [np.interp(centres[index], freqs, row) for row in levels_db]
    return out


def _json(values: np.ndarray) -> list[float | None]:
    return [float(value) if np.isfinite(value) else None for value in np.asarray(values, dtype=np.float64).tolist()]


def _power_mean(levels_db: np.ndarray) -> np.ndarray:
    """Channels (axis 0) power-averaged."""
    with np.errstate(divide="ignore"):
        return 10.0 * np.log10(np.mean(10.0 ** (levels_db / 10.0), axis=0))


def _rows(values: Any, channels: int) -> np.ndarray:
    return np.asarray(values, dtype=np.float64).reshape(channels, -1)


def _log_points(levels_db: np.ndarray, freqs: np.ndarray, points: int, nyquist: float) -> tuple[np.ndarray, np.ndarray]:
    """Levels on `points` log-spaced frequencies from 20 Hz to Nyquist, as the scan's spectrum."""
    edges = np.geomspace(spec.SPECTRUM_MIN_HZ, nyquist, points + 1)
    return np.sqrt(edges[:-1] * edges[1:]), band_levels(levels_db, freqs, edges)


def _waveform(
    frame: ChannelFrame, keep: np.ndarray | None = None, points: int = WAVEFORM_OVERVIEW_POINTS
) -> StageWaveform:
    """The signal itself (channels averaged) as the lanes draw it, by the lanes' own decimation (decimator.py)."""
    from decimator import decimated_waveform

    samples = np.mean(_rows(frame.data, frame.n_channels), axis=0)
    times = np.asarray(frame.source_time, dtype=np.float64).reshape(frame.n_channels, -1)[0]
    if keep is not None:
        samples, times = samples[keep], times[keep]
    if samples.size == 0:
        return {
            "min": [],
            "max": [],
            "minT": [],
            "maxT": [],
            "absolutePeak": 0.0,
            "unit": frame.channels[0].unit or "",
            "ref": float(frame.channels[0].ref),
        }
    envelope = decimated_waveform(samples, min(points, samples.size), 0, samples.size)
    span = times[-1] - times[0] if samples.size > 1 else 0.0
    at = lambda norms: _json(times[0] + np.asarray(norms, dtype=np.float64) * span)  # noqa: E731
    return {
        "min": _json(np.asarray(envelope["min"])),
        "max": _json(np.asarray(envelope["max"])),
        "minT": at(envelope["minT"]),
        "maxT": at(envelope["maxT"]),
        "absolutePeak": float(envelope["absolutePeak"]),
        "unit": frame.channels[0].unit or "",
        "ref": float(frame.channels[0].ref),
    }


def _channel_view(frame: ChannelFrame) -> StageView:
    data = _rows(frame.data, frame.n_channels)
    # Seconds into the file, so a region's level reads at the region's times.
    times = np.asarray(frame.source_time, dtype=np.float64).reshape(frame.n_channels, -1)[0]
    if data.shape[1] <= LEVEL_SERIES_MIN_SAMPLES:
        return {
            "frame": type(frame).__name__,
            "kind": "line",
            "x": "time",
            "xScale": "linear",
            "quantity": "value",
            "unit": frame.channels[0].unit or "",
            "xs": _json(times),
            "values": _json(np.mean(data, axis=0)),
        }
    edges = np.linspace(0, data.shape[1], min(TIME_POINTS, data.shape[1]) + 1).astype(int)
    refs = np.array([channel.ref for channel in frame.channels], dtype=np.float64)[:, np.newaxis]
    power = np.stack(
        [np.mean(data[:, start:end] ** 2, axis=1) for start, end in zip(edges[:-1], edges[1:], strict=True)], axis=1
    )
    with np.errstate(divide="ignore"):
        levels = 10.0 * np.log10(power / refs**2)
    return {
        "frame": type(frame).__name__,
        "kind": "line",
        "x": "time",
        "xScale": "linear",
        "quantity": "level",
        "xs": _json(times[(edges[:-1] + edges[1:] - 1) // 2]),
        "values": _json(rounded_db(_power_mean(levels))),
        "waveform": _waveform(frame),
    }


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


def _spectral_rows(frame: Any) -> tuple[str, np.ndarray]:
    """What a spectrum-like Frame measures, and its values: one row per channel (or channel pair)."""
    if isinstance(frame, CoherenceFrame):
        quantity, raw = "coherence", frame.coherence
    elif isinstance(frame, TransferFunctionFrame):
        quantity, raw = "gain", frame.gain_db
    elif isinstance(frame, CrossSpectralFrame):
        quantity, raw = "level", frame.level_db
    else:
        quantity, raw = "level", frame.dB
    return quantity, np.asarray(raw, dtype=np.float64).reshape(-1, np.asarray(frame.freqs).size)


def _pairwise(frame: Any) -> bool:
    return isinstance(frame, (CoherenceFrame, CrossSpectralFrame, TransferFunctionFrame))


def _spectral_view(frame: Any) -> StageView:
    freqs = np.asarray(frame.freqs, dtype=np.float64)
    nyquist = float(frame.sampling_rate) / 2
    quantity, values = _spectral_rows(frame)
    if nyquist <= spec.SPECTRUM_MIN_HZ or freqs.size < 2:
        return {"frame": type(frame).__name__, "kind": "none"}
    pair: StagePair | None = None
    if _pairwise(frame):
        row = _cross_pair(frame)
        if row is None:
            return {"frame": type(frame).__name__, "kind": "none"}
        values, pair = values[row : row + 1], _pair_of(frame, row)
    if quantity == "coherence":
        edges = np.geomspace(spec.SPECTRUM_MIN_HZ, nyquist, spec.SPECTRUM_POINTS + 1)
        centres = np.sqrt(edges[:-1] * edges[1:])
        line = np.round(np.interp(centres, freqs, values[0]), 4)
    else:
        centres, levels = _log_points(rounded_db(values), freqs, spec.SPECTRUM_POINTS, nyquist)
        line = rounded_db(_power_mean(levels))
    view: StageView = {
        "frame": type(frame).__name__,
        "kind": "line",
        "x": "frequency",
        "xScale": "log",
        "quantity": quantity,
        "xs": _json(centres),
        "values": _json(line),
    }
    if pair is not None:
        view["pair"] = pair
    return view


def _noct_view(frame: NOctFrame) -> StageView:
    return {
        "frame": type(frame).__name__,
        "kind": "bar",
        "x": "band",
        "xScale": "log",
        "quantity": "level",
        "xs": _json(np.asarray(frame.freqs, dtype=np.float64)),
        "values": _json(rounded_db(_power_mean(rounded_db(_rows(frame.dB, frame.n_channels))))),
    }


def _offset(frame: Any) -> float:
    """Where the frame starts in the file (a region's start), in seconds."""
    offset = np.asarray(getattr(frame, "source_time_offset", 0.0), dtype=np.float64).reshape(-1)
    return float(offset[0]) if offset.size else 0.0


def _time_blocks(count: int) -> list[slice]:
    edges = np.linspace(0, count, min(HEATMAP_TIMES, count) + 1).astype(int)
    return [slice(start, end) for start, end in zip(edges[:-1], edges[1:], strict=True)]


def _whole_columns(frame: Any, blocks: list[slice], signal_s: float | None) -> dict[str, list[bool]]:
    """``whole`` for an STFT's columns, when the length of the signal it was taken of is known."""
    if signal_s is None:
        return {}
    # Frame centres are in the file's time: measured from the start of the signal the STFT was taken of.
    centres = np.atleast_2d(np.asarray(frame.frame_center_times, dtype=np.float64))[0] - _offset(frame)
    half = float(frame.n_fft) / 2 / float(frame.sampling_rate)
    inside = (centres >= half - 1e-9) & (centres <= signal_s - half + 1e-9)
    return {"whole": [bool(np.all(inside[block])) for block in blocks]}


def _spectrogram_view(frame: SpectrogramFrame, signal_s: float | None = None) -> StageView:
    db = np.asarray(frame.dB, dtype=np.float64)
    planes = db.reshape(-1, db.shape[-2], db.shape[-1])
    freqs = np.asarray(frame.freqs, dtype=np.float64)
    times = np.asarray(frame.times, dtype=np.float64)[: planes.shape[-1]] + _offset(frame)
    nyquist = float(frame.sampling_rate) / 2
    if nyquist <= spec.SPECTRUM_MIN_HZ or freqs.size < 2:
        return {"frame": type(frame).__name__, "kind": "none"}
    level = _power_mean(rounded_db(planes))  # (freq, time)
    blocks = _time_blocks(level.shape[1])
    columns = np.stack([_power_mean(level[:, block].T) for block in blocks], axis=1)
    centres, matrix = _log_points(columns.T, freqs, HEATMAP_FREQUENCIES, nyquist)
    return {
        "frame": type(frame).__name__,
        "kind": "heatmap",
        "x": "time",
        "xScale": "linear",
        "quantity": "level",
        "xs": _json(np.array([float(np.mean(times[block])) for block in blocks])),
        "ys": _json(centres),
        "yAxis": "frequency",
        # One decimal: an image of a dB level needs no more, and a base sends one per file.
        "matrix": [_json(row) for row in np.round(rounded_db(matrix).T, 1)],
        **_whole_columns(frame, blocks, signal_s),
    }


def _roughness_view(frame: RoughnessFrame) -> StageView:
    data = np.asarray(frame.data, dtype=np.float64)
    plane = np.mean(data.reshape(-1, data.shape[-2], data.shape[-1]), axis=0)
    times = np.asarray(frame.time, dtype=np.float64)[: plane.shape[1]] + _offset(frame)
    blocks = _time_blocks(plane.shape[1])
    return {
        "frame": type(frame).__name__,
        "kind": "heatmap",
        "x": "time",
        "xScale": "linear",
        "quantity": "roughness",
        "unit": "asper",
        "xs": _json(np.array([float(np.mean(times[block])) for block in blocks])),
        "ys": _json(np.asarray(frame.bark_axis, dtype=np.float64)[: plane.shape[0]]),
        "yAxis": "bark",
        "matrix": [_json(np.array([np.mean(row[block]) for block in blocks])) for row in plane],
    }


def _signed_peaks(values: np.ndarray, count: int) -> tuple[np.ndarray, np.ndarray]:
    """`values` (last axis) in at most `count` blocks, each the value of largest magnitude, with its first index.

    A cepstrum's peaks are single bins: an average over a block would wash them out.
    """
    edges = np.linspace(0, values.shape[-1], min(count, values.shape[-1]) + 1).astype(int)
    picked = [
        np.take_along_axis(block, np.argmax(np.abs(block), axis=-1)[..., np.newaxis], axis=-1)[..., 0]
        for block in (values[..., start:end] for start, end in zip(edges[:-1], edges[1:], strict=True))
    ]
    return np.stack(picked, axis=-1), edges[:-1]


def _peak_points(values: np.ndarray, count: int) -> tuple[np.ndarray, np.ndarray]:
    """`values` (1-D) in at most `count` blocks, each the value of largest magnitude, at its block's centre index.

    Every lag is kept when they fit, so a peak is at its own lag. Over more, the blocks' centres are the same for
    every view of as many lags: the median and the difference pair values by index, so they meet at one lag.
    """
    if values.size <= count:
        return values, np.arange(values.size)
    edges = np.linspace(0, values.size, count + 1).astype(int)
    peaks = np.array(
        [
            values[start + int(np.argmax(np.abs(values[start:end])))]
            for start, end in zip(edges[:-1], edges[1:], strict=True)
        ]
    )
    return peaks, (edges[:-1] + edges[1:] - 1) // 2


def _cepstral_view(frame: CepstralFrame) -> StageView:
    # One line per channel in plot(); the comparison averages channels, as it does every value.
    coefficients = np.mean(_rows(frame.data, frame.n_channels), axis=0)
    values, starts = _signed_peaks(coefficients, QUEFRENCY_POINTS)
    return {
        "frame": type(frame).__name__,
        "kind": "line",
        "x": "quefrency",
        "xScale": "linear",
        "quantity": "cepstrum",
        "xs": _json(np.asarray(frame.quefrencies, dtype=np.float64)[starts]),
        "values": _json(np.round(values, CEPSTRUM_DECIMALS)),
    }


def _correlation_rows(frame: CrossCorrelationFrame) -> tuple[int, np.ndarray] | None:
    """The drawn pair's row and its coefficients over lag, or None for a Frame with no pair of two channels."""
    row = _cross_pair(frame)
    if row is None:
        return None
    return row, np.asarray(frame.coefficients, dtype=np.float64).reshape(-1, frame.n_lags)[row]


def _correlation_view(frame: CrossCorrelationFrame) -> StageView:
    drawn = _correlation_rows(frame)
    if drawn is None or frame.n_lags < 2:
        return {"frame": type(frame).__name__, "kind": "none"}
    row, coefficients = drawn
    values, picked = _peak_points(coefficients, LAG_POINTS)
    return {
        "frame": type(frame).__name__,
        "kind": "line",
        "x": "lag",
        "xScale": "linear",
        "quantity": "correlation",
        "xs": _json(np.asarray(frame.lags, dtype=np.float64)[picked]),
        "values": _json(np.round(values, CORRELATION_DECIMALS)),
        "pair": _pair_of(frame, row),
    }


def _cepstrogram_view(frame: CepstrogramFrame, signal_s: float | None = None) -> StageView:
    data = np.asarray(frame.data, dtype=np.float64)
    plane = np.mean(data.reshape(-1, data.shape[-2], data.shape[-1]), axis=0)  # (quefrency, time)
    times = np.asarray(frame.times, dtype=np.float64)[: plane.shape[1]] + _offset(frame)
    blocks = _time_blocks(plane.shape[1])
    columns = np.stack([np.mean(plane[:, block], axis=1) for block in blocks], axis=1)
    rows, starts = _signed_peaks(columns.T, HEATMAP_FREQUENCIES)
    return {
        "frame": type(frame).__name__,
        "kind": "heatmap",
        "x": "time",
        "xScale": "linear",
        "quantity": "cepstrum",
        "xs": _json(np.array([float(np.mean(times[block])) for block in blocks])),
        "ys": _json(np.asarray(frame.quefrencies, dtype=np.float64)[starts]),
        "yAxis": "quefrency",
        "matrix": [_json(row) for row in np.round(rows.T, CEPSTRUM_DECIMALS)],
        **_whole_columns(frame, blocks, signal_s),
    }


def _envelope(xs: np.ndarray, values: np.ndarray, points: int) -> tuple[np.ndarray, np.ndarray]:
    """At most `points` points, as the track lanes decimate: per bucket its minimum and its maximum.

    Fewer values than points are all kept. A bucket's two points sit at its first and last x, so every
    file's buckets fall at the same places and a group's pictures still have a median point by point.
    """
    n = xs.size
    if n <= points:
        return xs, values
    count = max(1, points // 2)
    starts = np.unique(np.linspace(0, n, count + 1).astype(int)[:-1])
    ends = np.append(starts[1:], n) - 1
    masked = np.where(np.isfinite(values), values, np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        low, high = np.fmin.reduceat(masked, starts), np.fmax.reduceat(masked, starts)
    return np.stack([xs[starts], xs[ends]], axis=1).reshape(-1), np.stack([low, high], axis=1).reshape(-1)


def _inside(axis: np.ndarray, bounds: list[float]) -> np.ndarray:
    return (axis >= min(bounds)) & (axis <= max(bounds))


def _log_rows(
    levels_db: np.ndarray, freqs: np.ndarray, bounds: list[float], rows: int
) -> tuple[np.ndarray, np.ndarray]:
    """A spectrogram's rows (levels_db: frequency × time) between `bounds` Hz: every bin there, or, with more bins
    than `rows`, `rows` log-spaced bands (band_levels, as the spectra are made)."""
    inside = _inside(freqs, bounds) & (freqs > 0)
    if inside.sum() <= rows:
        return freqs[inside], levels_db[inside]
    edges = np.geomspace(max(min(bounds), freqs[inside][0]), max(bounds), rows + 1)
    return np.sqrt(edges[:-1] * edges[1:]), band_levels(levels_db.T, freqs, edges).T


def _detail_view(frame: object, coarse: StageView, detail: StageDetail) -> StageView:
    """The part of `coarse` on screen, from the Frame's full resolution: the spectrum's own bins, the samples or
    short levels of a time signal, the cepstrum's coefficients, an image's own columns and rows (or as many as
    the screen shows). 1/3-octave bars are already whole bands: they stay as they are."""
    points = int(detail["points"])
    bounds = [float(value) for value in detail["x"]]
    view: StageView = {
        key: value for key, value in coarse.items() if key not in ("xs", "ys", "values", "matrix", "whole")
    }  # type: ignore[assignment]
    view["detail"] = True
    if isinstance(frame, (SpectralFrame, CoherenceFrame, CrossSpectralFrame, TransferFunctionFrame)):
        freqs = np.asarray(frame.freqs, dtype=np.float64)
        _, rows = _spectral_rows(frame)
        if _pairwise(frame):
            row = _cross_pair(frame)
            rows = rows[row : row + 1] if row is not None else rows
        line = rows[0] if coarse.get("quantity") == "coherence" else _power_mean(rounded_db(rows))
        keep = _inside(freqs, bounds) & (freqs > 0)
        xs, values = _envelope(freqs[keep], line[keep], points)
        view.update(
            {
                "xs": _json(xs),
                "values": _json(np.round(values, 4 if coarse.get("quantity") == "coherence" else spec.DB_DECIMALS)),
            }
        )
        return view
    if isinstance(frame, ChannelFrame):
        data = _rows(frame.data, frame.n_channels)
        times = np.asarray(frame.source_time, dtype=np.float64).reshape(frame.n_channels, -1)[0]
        keep = _inside(times, bounds)
        if coarse.get("quantity") != "level":
            xs, values = _envelope(times[keep], np.mean(data[:, keep], axis=0), points)
            view.update({"xs": _json(xs), "values": _json(values)})
            return view
        part = data[:, keep]
        view["waveform"] = _waveform(frame, keep, points)
        if part.shape[1] == 0:
            view.update({"xs": [], "values": []})
            return view
        edges = np.linspace(0, part.shape[1], min(points, part.shape[1]) + 1).astype(int)
        refs = np.array([channel.ref for channel in frame.channels], dtype=np.float64)[:, np.newaxis]
        power = np.stack(
            [np.mean(part[:, a:b] ** 2, axis=1) for a, b in zip(edges[:-1], edges[1:], strict=True) if b > a], axis=1
        )
        centres = np.array([(a + b - 1) // 2 for a, b in zip(edges[:-1], edges[1:], strict=True) if b > a])
        with np.errstate(divide="ignore"):
            levels = 10.0 * np.log10(power / refs**2)
        view.update({"xs": _json(times[keep][centres]), "values": _json(rounded_db(_power_mean(levels)))})
        return view
    if isinstance(frame, CrossCorrelationFrame):
        lags = np.asarray(frame.lags, dtype=np.float64)
        keep = _inside(lags, bounds)
        drawn = _correlation_rows(frame)
        if drawn is not None and keep.any():
            values, picked = _peak_points(drawn[1][keep], points)
            view.update({"xs": _json(lags[keep][picked]), "values": _json(np.round(values, CORRELATION_DECIMALS))})
            return view
        return coarse
    if isinstance(frame, CepstralFrame):
        quefrencies = np.asarray(frame.quefrencies, dtype=np.float64)
        keep = _inside(quefrencies, bounds)
        values, starts = _signed_peaks(np.mean(_rows(frame.data, frame.n_channels), axis=0)[keep], points)
        view.update({"xs": _json(quefrencies[keep][starts]), "values": _json(np.round(values, CEPSTRUM_DECIMALS))})
        return view
    if isinstance(frame, (SpectrogramFrame, CepstrogramFrame, RoughnessFrame)):
        rows_bounds = [float(value) for value in detail.get("y", [-np.inf, np.inf])]
        offset = _offset(frame)
        if isinstance(frame, SpectrogramFrame):
            planes = np.asarray(frame.dB, dtype=np.float64)
            plane = _power_mean(rounded_db(planes.reshape(-1, planes.shape[-2], planes.shape[-1])))
            times = np.asarray(frame.times, dtype=np.float64)[: plane.shape[1]] + offset
        elif isinstance(frame, CepstrogramFrame):
            data = np.asarray(frame.data, dtype=np.float64)
            plane = np.mean(data.reshape(-1, data.shape[-2], data.shape[-1]), axis=0)
            times = np.asarray(frame.times, dtype=np.float64)[: plane.shape[1]] + offset
        else:
            data = np.asarray(frame.data, dtype=np.float64)
            plane = np.mean(data.reshape(-1, data.shape[-2], data.shape[-1]), axis=0)
            times = np.asarray(frame.time, dtype=np.float64)[: plane.shape[1]] + offset
        columns = _inside(times, bounds)
        plane, times = plane[:, columns], times[columns]
        blocks = [
            slice(a, b)
            for a, b in zip(
                *(lambda e: (e[:-1], e[1:]))(
                    np.linspace(0, times.size, min(max(2, points // 2), times.size) + 1).astype(int)
                ),
                strict=True,
            )
            if b > a
        ]
        if isinstance(frame, SpectrogramFrame):
            columned = (
                np.stack([_power_mean(plane[:, block].T) for block in blocks], axis=1) if blocks else plane[:, :0]
            )
            ys, matrix = _log_rows(
                columned,
                np.asarray(frame.freqs, dtype=np.float64),
                rows_bounds
                if np.all(np.isfinite(rows_bounds))
                else [spec.SPECTRUM_MIN_HZ, float(frame.sampling_rate) / 2],
                DETAIL_ROWS,
            )
            matrix = np.round(rounded_db(matrix), 1)
        elif isinstance(frame, CepstrogramFrame):
            columned = (
                np.stack([np.mean(plane[:, block], axis=1) for block in blocks], axis=1) if blocks else plane[:, :0]
            )
            quefrencies = np.asarray(frame.quefrencies, dtype=np.float64)
            keep = _inside(quefrencies, rows_bounds)
            peaks, starts = _signed_peaks(columned[keep].T, DETAIL_ROWS)
            ys, matrix = quefrencies[keep][starts], np.round(peaks.T, CEPSTRUM_DECIMALS)
        else:
            columned = (
                np.stack([np.mean(plane[:, block], axis=1) for block in blocks], axis=1) if blocks else plane[:, :0]
            )
            bark = np.asarray(frame.bark_axis, dtype=np.float64)[: plane.shape[0]]
            keep = _inside(bark, rows_bounds)
            ys, matrix = bark[keep], columned[keep]
        view.update(
            {
                "xs": _json(np.array([float(np.mean(times[block])) for block in blocks])),
                "ys": _json(ys),
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
    coarse = _stage_view(frame, signal_s)
    if detail is None or coarse["kind"] in ("none", "bar"):
        return coarse
    return _detail_view(frame, coarse, detail)


def _stage_view(frame: object, signal_s: float | None) -> StageView:
    name = type(frame).__name__
    if isinstance(frame, CepstralFrame):
        return _cepstral_view(frame)
    if isinstance(frame, CepstrogramFrame):
        return _cepstrogram_view(frame, signal_s)
    if isinstance(frame, CrossCorrelationFrame):
        return _correlation_view(frame)
    if not isinstance(frame, CHART_FRAME_TYPES):
        return {"frame": name, "kind": "none"}
    if isinstance(frame, ChannelFrame):
        return _channel_view(frame)
    if isinstance(frame, (SpectralFrame, CoherenceFrame, CrossSpectralFrame, TransferFunctionFrame)):
        return _spectral_view(frame)
    if isinstance(frame, NOctFrame):
        return _noct_view(frame)
    if isinstance(frame, SpectrogramFrame):
        return _spectrogram_view(frame, signal_s)
    if isinstance(frame, RoughnessFrame):
        return _roughness_view(frame)
    return {"frame": name, "kind": "none"}
