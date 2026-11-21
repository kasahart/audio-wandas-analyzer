"""The figure service's one window on the answers: "鍵で答えを引く" (第 5 節「答えの保持」).

figures/ never imports services/ or transport/ (rule A). It names here what it needs
of the answers and of the layer 1 operations, and transport/ hands it the real ones (transport/figure_answers.py).

Arrays are typed loosely (``Values``) so this file imports no numpy (rule A: numpy only in the five rule files).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

#: A float64 array of answers or of their axis (a numpy array, held as the answer gives it).
Values = Any

#: What answers/ (layer 3) decided of a key before it sent the figure spec (第 5 節「答えの状態を判定するのは
#: answers/」). The figure service never decides freshness itself.
#: ``too-large``: the step's values were over what the answer store keeps (the scan said so): nothing can be drawn
#: of it, and the figure says why (the budget is a cap; a recording that does not fit is refused with its reason).
KeyState = Literal["usable", "pending", "stale", "failed", "evicted", "too-large"]
KEY_STATES: tuple[KeyState, ...] = ("usable", "pending", "stale", "failed", "evicted", "too-large")

#: A level identity: the channel's unit, its reference value and its level reference's label (level_identity.py).
#: Calibration status is not part of it: calibrated and uncalibrated recordings share an axis (仕様 2).
LevelIdentity = tuple[str, float, str]


@dataclass(frozen=True)
class Answer:
    """One recording's answer on a line: its values over its axis, and what they are.

    ``axis`` is a key of the source axis (kind, scale, quantity, unit, count and ends; over time, its first point
    and its step instead): two answers on one axis key are on the same points as far as both reach, so a median and
    a Δ are taken of them point by point (over time, over the part every one of them has)."""

    key: str
    #: The version of the answer the service holds (compared with the version the spec carries for the key).
    version: str
    xs: Values
    values: Values
    identity: LevelIdentity
    axis: str
    #: What the values measure: "level" or "gain" (dB values: the silent floor applies, a Δ is a level Δ), or
    #: "value", "coherence", "cepstrum", "correlation" (plain numbers), "phase" (degrees, −180 to 180).
    quantity: str
    x_scale: Literal["log", "linear"]
    #: The axis's ends across where nothing is specified (a spectrum: 20 Hz to its Nyquist frequency), as the old
    #: picture's ``xLimits``.
    x_limits: tuple[float, float]
    #: The memory the answer's arrays take (for the budget).
    nbytes: int
    #: How many channels its values combine (None: not said). Recordings of other counts are not combined.
    channels: int | None = None
    #: What is across: "frequency", "time", "quefrency", "lag", or "band" (a value per 1/N-octave band at its centre
    #: frequency: drawn as bars from edge to edge of its band, every one of them, never thinned).
    x_kind: str = "frequency"
    #: What layer 3 names the value axis with, passed on as the answer says it (the figure service reads none of
    #: them): the unit the values are written in (None: not said), the measure a series over time is of ("rms",
    #: "timeWeightedRms", "power", "unknown") and the power it is raised to, and the channel pair of a
    #: cross-channel answer.
    unit: str | None = None
    measure: str | None = None
    measure_exponent: float | None = None
    pair: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class ImageAnswer:
    """One recording's answer as an image: its cells, rows over ``ys``, columns over ``xs`` (s into the file),
    channels combined by layer 1, every cell as it was computed (never pooled to draw). A spectrogram's levels in dB
    over frequency (Hz, a log axis); a roughness's values over Bark bands; a cepstrogram's signed coefficients over
    quefrency (s). What the rule files do differently for each is said here once (``y_log``, ``y_positive``,
    ``pooling``), from ``quantity`` and ``y_kind``."""

    key: str
    version: str
    xs: Values
    ys: Values
    #: rows × columns.
    values: Values
    identity: LevelIdentity
    axis: str
    quantity: str
    #: The axes' ends where nothing is specified: across, the first and last column's time; up, 20 Hz to the Nyquist
    #: frequency.
    x_limits: tuple[float, float]
    y_limits: tuple[float, float]
    nbytes: int
    channels: int | None = None
    #: What the rows are over: "frequency" (Hz), "bark" (a roughness's bands) or "quefrency" (s).
    y_kind: str = "frequency"
    #: The unit the values are written in, for a quantity not in dB (a roughness: "asper/Bark").
    unit: str | None = None
    #: How a frequency axis is drawn: "log" (the comparison bench's heatmaps) or "linear" (a Tracks row's
    #: spectrogram: the display setting of that screen). Said by the answer, as a line's ``x_scale`` is.
    y_scale: str = "log"
    #: The screen pixels one drawn cell takes at least, each way (thinning.drawn_image): 2 for the comparison
    #: bench's heatmaps; 1 for a Tracks row's spectrogram, whose lane is low (a tone is one row of pixels).
    cell_px: int = 2
    #: The lowest and highest value the colour range is decided from, where that is not the cells on screen: a Tracks
    #: row's spectrogram is coloured by its whole recording's levels, so a zoom or a pan keeps the colours. None: the
    #: cells on screen (the comparison bench's heatmaps).
    extent: tuple[float, float] | None = None

    @property
    def y_log(self) -> bool:
        """The rows' axis is logarithmic: a frequency axis drawn so (Bark bands and quefrencies are placed
        linearly)."""
        return self.y_kind == "frequency" and self.y_scale == "log"

    @property
    def y_positive(self) -> bool:
        """Only the rows above 0 are placed: a logarithmic frequency axis has no 0 Hz, a cepstrogram no zeroth
        coefficient (as a spectrum's and a cepstrum's lines have no point at or under 0). A linear frequency axis
        places its 0 Hz row."""
        return self.y_log or self.y_kind == "quefrency"

    @property
    def pooling(self) -> str:
        """How cells are pooled to be drawn (thinning.drawn_image): a level by its loudest cell, a signed
        coefficient by the one of largest magnitude (its sign kept), any other value by its highest."""
        return "level" if self.quantity in ("level", "gain") else "signed" if self.quantity == "cepstrum" else "value"


@dataclass(frozen=True)
class SignalAnswer:
    """One recording's answer as the sound itself (a time signal): every sample, channels combined by layer 1, with
    no array of its samples' times. Sample ``n`` is at ``start + n * (1 / rate)`` seconds into the file, so a drawn
    sample, the sample read and a sample named again are at the same time. ``values`` may be as long as the
    recording (half an hour): the rule files look at the part on screen or around the pointer, a block at a time,
    and never copy it whole."""

    key: str
    version: str
    start: float
    rate: float
    values: Values
    identity: LevelIdentity
    axis: str
    #: What the samples measure ("value") and the unit they are in ("" where it has none, "Pa" once calibrated).
    quantity: str
    unit: str
    nbytes: int
    channels: int | None = None
    #: What its time is counted from: "time" (s into the file), or "triggerTime" (s from the trigger that cut it:
    #: one event of a trigger's). Passed on to name the axis; the figure service reads none of it.
    x_kind: str = "time"


@dataclass(frozen=True)
class ColumnAnswer:
    """One number column of the user's table (CSV), as answers/ handed it: a value per table row (a recording),
    in the table's order; a row left blank has no number (NaN). No answer is made of it: a distribution draws
    these values as they are and counts them (仕様 7)."""

    key: str
    version: str
    #: The table rows' keys, and each one's value.
    rows: tuple[str, ...]
    values: Values
    identity: LevelIdentity
    axis: str
    nbytes: int
    channels: int | None = None


@dataclass(frozen=True)
class EventsAnswer:
    """When a trigger step's events fired in one recording (layer 1's: the step's own cut): each event's number and
    its time (s into the file). No line is drawn of it: a band lane that declares the trigger (spec.py TriggerSpec)
    takes its guide lines from it (目安の線: the firing times, the stretches cut)."""

    key: str
    version: str
    ids: tuple[int, ...]
    times: tuple[float, ...]
    identity: LevelIdentity = ("", 1.0, "")
    axis: str = "events"
    nbytes: int = 0
    channels: int | None = None


#: Whatever is held under a key. 計算ア reads only what they share: version, identity, axis, channels.
AnyAnswer = Answer | ImageAnswer | SignalAnswer | ColumnAnswer | EventsAnswer


class AnswerSource(Protocol):
    """Answers by key. None: no answer is held under the key (it was evicted, or never made)."""

    def answer(self, key: str) -> AnyAnswer | None: ...


class LayerOne(Protocol):
    """The layer 1 operations the figure asks for (wandas-extras' candidates, services/combine_ops.py today)."""

    def median(self, rows: Sequence[Values]) -> Values: ...

    def level_delta(self, compare: Values, base: Values) -> Values: ...

    def difference(self, compare: Values, base: Values) -> Values: ...

    def common_length(self, rows: Sequence[Values]) -> Sequence[Values]: ...

    def signal_difference(self, compare: Values, base: Values) -> Values: ...
