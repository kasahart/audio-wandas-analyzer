"""One step's Frame as the comparison takes it: what its result is, and its values at full resolution.

``read_frame`` is the only place a wandas Frame's data is interpreted: its values with the channels combined (levels
power-averaged, values averaged), on the axes they are on. They are kept for the figure service
(stage_combine.stage_data), which draws, ranges and reads them (python-backend/figures/).

``describe`` says in words what the step's result is (``StageView``: its Frame, the kind of figure, the axes, the
quantity and unit, a cross-channel Frame's pair, a trigger's events by number and time). The screen chooses the
figure to ask for from it. Nothing here thins or draws a point: every picture is the figure service's.
"""

from __future__ import annotations

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

from frames import analysis_spec as spec

#: Operations whose ChannelFrame is a metric over time, drawn as its own values however long it is, and
#: the unit of those values: wandas keeps the input channel's unit on them (rms_trend's is right: its own).
METRIC_SERIES_UNITS: dict[str, str] = {
    "wandas.audio.loudness_zwtv": "sone",
    "wandas.audio.sharpness_din": "acum",
    "wandas.audio.roughness_dw": "asper",
    "wandas.audio.rms_trend": "",
}

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
    """What one step's result is, in words. ``kind: "none"`` for a Frame the app does not draw."""

    frame: str
    kind: Literal["line", "bar", "heatmap", "none"]
    x: NotRequired[Literal["frequency", "time", "band", "quefrency", "lag"]]
    xScale: NotRequired[Literal["log", "linear"]]
    #: What the values are: dB levels (and gains) subtract to a difference in dB; the rest do not.
    quantity: NotRequired[Quantity]
    unit: NotRequired[str]
    #: An image's rows: frequencies, critical-band rates (Bark) or quefrencies.
    yAxis: NotRequired[Literal["frequency", "bark", "quefrency"]]
    #: A cross-channel Frame's one drawn pair: the compared channel over the reference (from 1).
    pair: NotRequired[StagePair]
    #: The sound itself (every sample), not a metric or a level over time.
    signal: NotRequired[bool]
    #: What a time signal's values are when steps made them from the sound (measure_of), for its axis's name: a
    #: windowed RMS, a time-weighted one, the squared signal, the amplitude or an RMS raised to ``measureExponent``,
    #: or ``unknown`` where the effect of an operation on the quantity (and so on the unit) is not known.
    measure: NotRequired[Literal["amplitude", "rms", "timeWeightedRms", "power", "unknown"]]
    #: The power ``measure`` is raised to (amplitude^3 after power(3)); sent only when it is not 1.
    measureExponent: NotRequired[float]
    #: A trigger's events, by number and time. Their lines are the figure service's.
    events: NotRequired[list[StageEvent]]
    #: The key the step's full-resolution values are kept under (stage_combine.py), for the figure service.
    data: NotRequired[str]


class StageEvent(TypedDict):
    #: wandas' event ID (from 0), which stays the same when other events are dropped.
    id: int
    #: When it triggered, seconds into the file.
    time: float


class StagePair(TypedDict):
    output: int
    input: int
    #: The pair is the recording over the comparison's base slot recording, not two channels of one recording.
    base: NotRequired[bool]


def floored_db(values: np.ndarray) -> np.ndarray:
    """Levels no lower than MIN_LEVEL_DB (silence, an undefined level), unrounded: what every level is computed
    from (a power mean, a median, a difference, the point a read picks), so a rounding never moves a result."""
    floored = np.nan_to_num(values, nan=spec.MIN_LEVEL_DB, neginf=spec.MIN_LEVEL_DB, posinf=-spec.MIN_LEVEL_DB)
    return np.maximum(floored, spec.MIN_LEVEL_DB)


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
    the axes they are on (``read_frame``). What the figure service draws and reads comes from this.

    ``values`` is a line over the x axis, or an image (rows over ``ys``, columns over the x axis). Every value is
    float64, as wandas computes it.
    """

    mode: Mode
    #: Each value's x. Empty for ``signal``, whose samples are at ``start + n / rate``.
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
    #: A trigger's events: each event's own line (event x sample) and its id; when each triggered (s into the file);
    #: and the events' own sample axis (every event's sample n is ``event_start + n / event_rate`` s from its
    #: trigger: wandas cuts every event to one length).
    rows: np.ndarray | None = None
    event_ids: tuple[int, ...] = ()
    event_times: tuple[float, ...] = ()
    event_start: float = 0.0
    event_rate: float = 0.0
    #: A cross-channel Frame's one drawn row (its pair).
    pair_row: int | None = None


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

    To support a new Frame kind, add its branch here, taking its data with ``_taken`` first, and its words in
    ``describe``. Its full-resolution values (stage_combine.stage_data) are this reading.
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
        return FrameReading(
            "events",
            times,
            np.mean(rows, axis=0),
            rows=rows,
            event_ids=ids,
            event_times=tuple(_event_time(frame, item) for item in frame),
            event_start=-float(frame.pre),
            event_rate=float(frame[0].sampling_rate),
        )
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


#: What a time signal's values are when steps made them from the sound, for its value axis to name: the amplitude
#: (raised to a power), a root mean square over a window, a time-weighted one (Fast, Slow), the squared signal, or
#: not known. The Figure turns it into the axis's words (src/webview/figure/axisNames.ts).
Measure = Literal["amplitude", "rms", "timeWeightedRms", "power", "unknown"]
#: The steps that make a measure of what they were given: its values are that measure, whatever came before.
SIGNAL_MEASURES: dict[str, Measure] = {
    "wandas.audio.rms_trend": "rms",
    "wandas.audio.sound_level": "timeWeightedRms",
}


def channel_unit(frame: object) -> str:
    """The unit of a time signal's values, as wandas names it on its channel after the operations that made it
    (``Pa``, ``Pa^2`` for the squared signal, ``sone`` for a loudness): the picture sends it as ``view.unit``.

    The one place the unit of a signal is taken: the axis name, the readout, the legend, the CSV and the report take
    it as sent and never edit it. ``""`` where wandas names none (an uncalibrated recording, or values whose unit it
    cannot tell). Since wandas 0.13.2 it keeps the unit through every operation itself; the app no longer walks the
    operation history to correct it.
    """
    channels = getattr(frame, "channels", None) or []
    return str(channels[0].unit or "") if channels else ""


def _level_kind(frame: object) -> str:
    """How wandas says ``frame``'s values convert to a level: ``amplitude``, ``power`` or ``none`` (wandas 0.13.2
    ``ChannelCalibration.level``)."""
    channels = getattr(frame, "channels", None) or []
    calibration = getattr(channels[0], "calibration", None) if channels else None
    return str(getattr(calibration, "level", "amplitude"))


def _measuring_step(frame: object) -> Measure | None:
    """The measure the last step that makes one (rms_trend, sound_level) named, if it is the last to touch the
    values' quantity: its name is the step's, not a unit the app works out.

    The one naming rule left on the app's side: wandas says how
    values convert to a level (amplitude, power, none) but not that they are an RMS over a window or a time-weighted
    one, so the axis takes that name from the step. Every unit, and every other quantity, is wandas' own."""
    for item in reversed(list(getattr(frame, "operation_history", None) or [])):
        operation = str(item.get("operation", ""))
        if operation in SIGNAL_MEASURES:
            return SIGNAL_MEASURES[operation]
        if operation in METRIC_SERIES_UNITS or operation in ("wandas.audio.power", "wandas.operator.power"):
            return None
    return None


def measure_of(frame: ChannelFrame, in_db: bool = False) -> tuple[Measure, float] | None:
    """What `frame`'s values are, for the axis to name: from wandas' level kind (wandas 0.13.2: the squared signal is
    a ``power``, values whose level it cannot tell are ``none``) and the step that measured them (an RMS over a
    window, a time-weighted one). None for the sound's own amplitude and for a metric, which its unit names.
    ``unknown`` where wandas says no level is defined: the axis then claims neither a quantity nor a unit. A level in
    dB (`in_db`) is the level of the RMS it was made from, named by that step.
    """
    measured = _measuring_step(frame)
    if in_db:
        return (measured, 1.0) if measured is not None else None
    kind = _level_kind(frame)
    if kind == "power":
        return ("power", 1.0)
    metric = metric_operation(frame)
    if metric is not None and metric not in SIGNAL_MEASURES:
        return None
    if kind == "none":
        return ("unknown", 1.0)
    return (measured, 1.0) if measured is not None else None


def _set_measure(view: StageView, measured: tuple[Measure, float] | None) -> None:
    """Write measure_of's answer on a picture: the measure, and its power when that is not 1."""
    if measured is None:
        return
    view["measure"] = measured[0]
    if measured[1] != 1:
        view["measureExponent"] = measured[1]


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


def _event_rows(segments: ChannelFrameSegments) -> tuple[np.ndarray, np.ndarray]:
    """Every event's samples with its channels averaged (event × sample), and each sample's time from the trigger."""
    # In float64 before the channels are averaged, as every reading is (read_frame): the mean of two float32
    # samples a float32 step apart lies between them.
    data = _taken(segments.to_numpy())
    rows = np.mean(data.reshape(data.shape[0], data.shape[1], -1), axis=1)
    rate = float(segments[0].sampling_rate)
    return rows, np.arange(rows.shape[1]) / rate - float(segments.pre)


def _event_time(segments: ChannelFrameSegments, item: Any) -> float:
    """When an event triggered, s into the file (trigger_times count from the region the events were cut from)."""
    return float(item.source_time_offset[0]) + float(segments.pre)


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


def _offset(frame: Any) -> float:
    """Where the frame starts in the file (a region's start), in seconds."""
    offset = _taken(getattr(frame, "source_time_offset", 0.0)).reshape(-1)
    return float(offset[0]) if offset.size else 0.0


def _words(
    frame: object,
    kind: Literal["line", "bar", "heatmap"],
    x: Literal["frequency", "time", "band", "quefrency", "lag"],
    x_scale: Literal["log", "linear"],
    quantity: Quantity,
) -> StageView:
    return {"frame": type(frame).__name__, "kind": kind, "x": x, "xScale": x_scale, "quantity": quantity}


def _channel_words(frame: ChannelFrame, reading: FrameReading) -> StageView:
    if reading.mode == "series" and _in_db(frame):
        # A level already in dB: a level, compared as one. The level of what (an RMS over a window, a time-weighted
        # one) is for its axis to name, never "amplitude".
        level = _words(frame, "line", "time", "linear", "level")
        level["unit"] = channel_unit(frame)
        _set_measure(level, measure_of(frame, in_db=True))
        return level
    # A metric (loudness, ...) is its own values however long or short the region; the sound itself is every sample
    # (``signal``), compared sample by sample. The comparison makes no level of either: a level is a wandas step's.
    view = _words(frame, "line", "time", "linear", "value")
    view["unit"] = channel_unit(frame)
    if reading.mode == "signal":
        view["signal"] = True
    _set_measure(view, measure_of(frame))
    return view


def _segments_words(segments: ChannelFrameSegments, reading: FrameReading | None) -> StageView:
    view = _words(segments, "line", "time", "linear", "value")
    if reading is None or reading.rows is None:
        # No event crossed the level: still the trigger's result, with none in it (the headline counts 0).
        view["events"] = []
        return view
    view["unit"] = channel_unit(segments[0]) if len(segments) else ""
    # Each event's trigger in the file's own time (trigger_times count from the region the events were cut from).
    view["events"] = [
        {"id": event_id, "time": time} for event_id, time in zip(reading.event_ids, reading.event_times, strict=True)
    ]
    return view


def _spectral_words(frame: Any, reading: FrameReading) -> StageView:
    view = _words(frame, "line", "frequency", "log", _spectral_quantity(frame))
    row = reading.pair_row
    if row is None:
        return view
    view["pair"] = _pair_of(frame, row)
    unit = _transfer_unit(frame, row)
    if isinstance(frame, CrossSpectralFrame) and frame.pair_domains[row].unit != "1":
        # A cross spectrum of two units (a recording against the base slot's) is re its pair's reference
        # (wandas' pair domain), never either channel's.
        unit = str(frame.channels[row].level_reference.label)
    if unit is not None:
        view["unit"] = unit
    return view


def describe(frame: object, reading: FrameReading | None) -> StageView:
    """What ``frame`` (one step's output) is, in words; ``kind: "none"`` for a Frame the app does not draw.

    ``reading``: read_frame of it. The Frame itself gives only what is not data: its name, units, pair and the
    operations that made it. To support a new Frame kind, add its branch here and in ``_read_frame``."""
    none: StageView = {"frame": type(frame).__name__, "kind": "none"}
    if isinstance(frame, ChannelFrameSegments):
        return _segments_words(frame, reading)
    if reading is None:
        return none
    if isinstance(frame, CrossCorrelationFrame):
        if reading.pair_row is None or reading.xs.size < 2:
            return none
        view = _words(frame, "line", "lag", "linear", "correlation")
        view["pair"] = _pair_of(frame, reading.pair_row)
        return view
    if isinstance(frame, (SpectralFrame, CoherenceFrame, CrossSpectralFrame, TransferFunctionFrame)):
        if reading.nyquist <= spec.SPECTRUM_MIN_HZ or reading.xs.size < 2:
            return none
        return _spectral_words(frame, reading)
    if isinstance(frame, CepstralFrame):
        return _words(frame, "line", "quefrency", "linear", "cepstrum")
    if isinstance(frame, CepstrogramFrame):
        return {**_words(frame, "heatmap", "time", "linear", "cepstrum"), "yAxis": "quefrency"}
    if isinstance(frame, ChannelFrame):
        return _channel_words(frame, reading)
    if isinstance(frame, NOctFrame):
        return _words(frame, "bar", "band", "log", "level")
    if isinstance(frame, SpectrogramFrame):
        if reading.nyquist <= spec.SPECTRUM_MIN_HZ or reading.ys is None or reading.ys.size < 2:
            return none
        return {**_words(frame, "heatmap", "time", "linear", "level"), "yAxis": "frequency"}
    if isinstance(frame, RoughnessFrame):
        # Each Bark band's specific roughness (wandas' own plot: "Specific Roughness [Asper/Bark]"), not the total.
        return {**_words(frame, "heatmap", "time", "linear", "roughness"), "unit": "asper/Bark", "yAxis": "bark"}
    return none


def stage_view(frame: object, signal_s: float | None = None) -> StageView:
    """``describe`` of ``frame`` from its own reading. ``signal_s``: the length (s) of the time signal before the
    step, which an STFT's columns are checked against."""
    return describe(frame, read_frame(frame, signal_s))
