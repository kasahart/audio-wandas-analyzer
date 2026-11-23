"""Each recording's step at full resolution, kept for the figure service.

A scan with a step keeps that step's values here (``StageData``, under the key its description carries as
``data``): every bin, sample, column and coefficient, channels combined as stage_view.read_frame combines them.
The figure service (figures/, through transport/figure_answers.py) takes its answers from these; the medians, the
differences, the drawing and the reads are the figure service's alone.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from wandas.frames import CrossSpectralFrame, TransferFunctionFrame
from wandas.frames.segments import ChannelFrameSegments

from frames import stage_view as sv
from frames.level_identity import LevelIdentity, level_identity
from frames.stage_view import FrameReading, StageView
from services.answer_store import STAGE_DATA_BUDGET_BYTES as STAGE_DATA_BUDGET_BYTES
from services.answer_store import STORE as _KEPT
from services.answer_store import AnswerStore

#: How much of the Frames' values the backend keeps for the comparison's medians and differences. The least
#: recently used go first; a picture asked for again (zooming, another compared recording) uses what is kept.
#: A base group the comparison scans without asking (up to 30 recordings or 30 minutes) fits: half an hour of a
#: 48 kHz signal's level, or of a spectrogram at the default hop. The browser keeps less (browser_service.py).
#: The number is services/answer_store.py's STAGE_DATA_BUDGET_BYTES (imported above).


@dataclass(frozen=True)
class StageData(FrameReading):
    """One recording's step at full resolution, channels combined: the Frame's reading (stage_view.FrameReading,
    whose fields and x axis it keeps) with what the step's result is (its description) and the recording's
    calibration. A median or a difference is not kept here: the figure service makes it of the members' kept values
    each time it draws (transport/figure_answers.py, services/combine_ops.py).

    ``values`` is a line over ``xs`` or an image (rows over ``ys``, columns over ``xs``). For ``signal`` (the sound
    itself) it is every sample, channels averaged, at ``start + n / rate``, with no ``xs`` (half an hour at 48 kHz
    fits the budget). Every value is kept float64, as wandas computes it: a median or a difference of float32 values
    would round away a difference of a float32 step (0.5 against 0.5 + 2⁻²⁴).
    """

    #: What the step's result is (stage_view.describe: frame, kind, axes, quantity, unit, pair), without its events
    #: and key: what a median or a difference of it is too.
    view: StageView = field(kw_only=True)
    #: The recording's channel unit and reference, whatever the Frame (a level's dB are re that reference): values
    #: are combined only between recordings calibrated alike.
    calibration: LevelIdentity = field(default=("", 1.0, ""), kw_only=True)
    #: How many channels its values combine (the step's Frame's, as it was read: one for a recording asked as one
    #: channel); 0 where the Frame says none. A median or a difference of recordings of other counts is not taken
    #: (the figure service's 計算ア leaves them out, ``other-channels``).
    channels: int = field(default=0, kw_only=True)

    @property
    def nbytes(self) -> int:
        extra = (self.ys.nbytes if self.ys is not None else 0) + (self.rows.nbytes if self.rows is not None else 0)
        return int(self.xs.nbytes + self.values.nbytes + extra)


#: The kept StageData by key: the process's one holder of answers (services/answer_store.py), under the names
#: this module has always given it.
_Store = AnswerStore
STORE: AnswerStore[StageData] = _KEPT


def _template(view: StageView) -> StageView:
    return {key: value for key, value in view.items() if key not in ("events", "data")}  # type: ignore[return-value]


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
    return _channel_identity(_level_source(frame).channels[0])


def _level_source(frame: object) -> Any:
    """The Frame whose channels say what ``frame``'s levels are in. Values already in dB (rms_trend(dB=True),
    sound_level: wandas names their unit "dB …", and their own reference says nothing) are levels re the channel
    they were made from: the nearest Frame before it that is not in dB (wandas keeps it as ``previous``), so a
    level over time is on the reference its recording's spectrum is on (dBFS, dB SPL). With no such Frame, itself."""
    node: Any = frame
    while node is not None and str(getattr(node.channels[0], "unit", "") or "").startswith("dB"):
        before = getattr(node, "previous", None)
        if before is None or not getattr(before, "channels", None):
            return frame
        node = before
    return node if node is not None else frame


def _channel_identity(first: object) -> LevelIdentity:
    """One channel's level identity: its unit, reference value and level reference's label."""
    reference = getattr(first, "level_reference", None)
    return level_identity(
        getattr(first, "unit", ""), getattr(first, "ref", 1.0) or 1.0, getattr(reference, "label", "")
    )


def stage_data(
    frame: object, view: StageView, signal_s: float | None = None, reading: FrameReading | None = None
) -> StageData | None:
    """The full-resolution values of ``frame``, with ``view`` (stage_view.describe of it); None for a Frame not
    drawn.

    They are the Frame's reading (stage_view.read_frame), field for field: this function interprets no Frame itself.
    ``reading``: the one the description was made from, when the caller has it, so the Frame is not read again."""
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
        event_times=reading.event_times,
        event_start=reading.event_start,
        event_rate=reading.event_rate,
        pair_row=reading.pair_row,
        view=_template(view),
        calibration=_calibration(frame),
        channels=int(getattr(frame, "n_channels", 0) or 0),
    )
