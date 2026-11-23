"""The figure service's answers by key, from the process's one holder (services/answer_store.py), and its one service.

figures/answers.py names what the figure service needs (AnswerSource, LayerOne); this file hands it the real ones,
so figures/ imports neither services/ nor the old modules (第 5 節「答えの保持」). A key is a scan's data key
(scan_service._data_key: a hash of the file as read, the Recipe, region, channels, calibration and step), so the
answer under a key never changes: its version is the key itself.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

import numpy as np

from figures.answers import Answer, AnyAnswer, ColumnAnswer, EventsAnswer, ImageAnswer, SignalAnswer, Values
from figures.budget import Budget
from figures.service import FIGURE_BUDGET_BYTES, FigureService
from figures.thinning import cell_edges
from frames import analysis_spec as spec
from services import combine_ops
from services.answer_store import COLUMNS as COLUMNS
from services.answer_store import EXTENTS, STORE, TableColumn
from services.stage_combine import StageData
from services.tracks_answers import ImageData, LineData, SignalData


def axis_key(data: StageData) -> str:
    """The axis a kept step's values are on: kind, scale,
    quantity, unit and the count and ends of its points (to 9 significant digits). Over time, its first point and
    its step instead: recordings of other lengths are on one axis, and are combined over the part they all have
    (combine_ops.common_length)."""
    view = data.view
    xs = data.xs
    if view.get("x") == "time" and xs.size > 1:
        ends = f"from|{float(xs[0]):.9g}|{float(xs[1] - xs[0]):.9g}"
    else:
        ends = f"{xs.size}|{float(xs[0]):.9g}|{float(xs[-1]):.9g}" if xs.size else "0"
    return "|".join(
        str(part)
        for part in (
            data.mode,
            view.get("kind"),
            view.get("x"),
            view.get("xScale"),
            view.get("quantity"),
            view.get("unit"),
            ends,
        )
    )


#: The kept steps drawn as lines over one axis: a spectrum; a coherence, a transfer function and a cross spectrum
#: (stage_view reads the three as "coherence"); a metric or a level over time; a cepstrum; a cross-correlation;
#: the levels of 1/N-octave bands (a value a band, drawn as bars: ``x_kind`` "band").
LINE_MODES = ("spectrum", "coherence", "series", "cepstrum", "correlation", "bands")
#: The kept steps drawn as images, a lane a recording (stage_view.py's heatmaps).
IMAGE_MODES = ("spectrogram", "roughness", "cepstrogram")


def answer_of(key: str, data: StageData) -> Answer | None:
    """A kept step's values as the figure service's answer; None where it has no axis to draw on (fewer than two
    points)."""
    view = data.view
    log = view.get("xScale") == "log"
    if data.xs.size < 2:
        return None
    if data.mode in ("spectrum", "coherence"):
        # A spectrum's axis across, where nothing is specified: 20 Hz to its Nyquist frequency (the old xLimits).
        low, high = spec.SPECTRUM_MIN_HZ, data.nyquist
    else:
        # Any other line's: its first to its last point.
        low, high = float(data.xs[0]), float(data.xs[-1])
    exponent = view.get("measureExponent")
    return Answer(
        key=key,
        version=key,
        xs=np.asarray(data.xs, dtype=np.float64),
        values=np.asarray(data.values, dtype=np.float64),
        identity=data.calibration,
        axis=axis_key(data),
        quantity=str(view.get("quantity", "level")),
        x_scale="log" if log else "linear",
        x_limits=(float(low), float(high)),
        nbytes=data.nbytes,
        channels=data.channels or None,
        x_kind=str(view.get("x", "frequency")),
        unit=view.get("unit"),
        measure=view.get("measure"),
        measure_exponent=float(exponent) if exponent is not None else None,
        pair=dict(view["pair"]) if "pair" in view else None,
    )


def line_answer_of(key: str, line: LineData) -> Answer | None:
    """A line layer 1 kept outside a scan (tracks_answers.py: the cursor spectrum's, the pair figure's) as the
    figure service's answer; None with fewer than two points. Its axis key is made as a kept step's is (what is
    across, its scale, the quantity, the unit, the count and ends of its points), so two channels' spectra of one
    window are on one axis."""
    xs = line.xs
    if xs.size < 2:
        return None
    axis = "|".join(
        str(part)
        for part in (
            "line",
            line.x_kind,
            line.x_scale,
            line.quantity,
            line.unit,
            f"{xs.size}|{float(xs[0]):.9g}|{float(xs[-1]):.9g}",
        )
    )
    return Answer(
        key=key,
        version=key,
        xs=np.asarray(xs, dtype=np.float64),
        values=np.asarray(line.values, dtype=np.float64),
        identity=line.identity,
        axis=axis,
        quantity=line.quantity,
        x_scale=line.x_scale,
        x_limits=line.x_limits,
        nbytes=line.nbytes,
        channels=1,
        x_kind=line.x_kind,
        unit=line.unit,
    )


def track_signal_answer_of(key: str, data: SignalData) -> SignalAnswer | None:
    """A Tracks row's kept samples (tracks_answers.py) as the figure service's signal answer (the store's own array,
    not a copy); None where it has no sample or no sample rate."""
    if not data.rate > 0 or not data.values.size:
        return None
    return SignalAnswer(
        key=key,
        version=key,
        start=0.0,
        rate=data.rate,
        values=data.values,
        identity=data.identity,
        axis=f"signal|{data.unit}|{data.rate:.9g}|0",
        quantity="value",
        unit=data.unit,
        nbytes=data.nbytes,
        channels=1,
    )


#: The pixels one drawn cell of a Tracks row's spectrogram takes (ImageAnswer.cell_px): one, as fine as the old lane
#: drew it (a tone one row of pixels in a lane 96 px high).
TRACK_CELL_PX = 1


def track_image_answer_of(key: str, data: ImageData) -> ImageAnswer | None:
    """A Tracks row's kept STFT levels (tracks_answers.py) as the figure service's image answer; None where it has
    no axes to draw on (fewer than two rows or columns)."""
    if data.ys.size < 2 or data.xs.size < 2 or not data.y_limits[1] > data.y_limits[0]:
        return None
    return ImageAnswer(
        key=key,
        version=key,
        xs=data.xs,
        ys=data.ys,
        values=data.values,
        identity=data.identity,
        axis=f"image|time|frequency|{data.y_scale}",
        quantity="level",
        x_limits=data.x_limits,
        y_limits=data.y_limits,
        nbytes=data.nbytes,
        channels=1,
        y_kind="frequency",
        y_scale=data.y_scale,
        cell_px=TRACK_CELL_PX,
        extent=data.extent,
    )


def image_answer_of(key: str, data: StageData) -> ImageAnswer | None:
    """A kept image step's cells (a spectrogram's, a roughness's, a cepstrogram's) as the figure service's image
    answer; None where it has no axes to draw on (fewer than two rows or columns; a spectrogram with no band above
    20 Hz)."""
    ys = data.ys
    if ys is None or ys.size < 2 or data.xs.size < 2:
        return None
    y_kind = str(data.view.get("yAxis", "frequency"))
    if y_kind == "frequency" and data.nyquist <= spec.SPECTRUM_MIN_HZ:
        return None
    xs = np.asarray(data.xs, dtype=np.float64)
    rows = np.asarray(ys, dtype=np.float64)
    if y_kind == "frequency":
        # Up, 20 Hz to the Nyquist frequency (the old yLimits).
        y_limits = (float(spec.SPECTRUM_MIN_HZ), float(data.nyquist))
    else:
        # Up, the outer edges of the rows placed (a cepstrogram's: those above 0): every row's cell whole.
        placed = rows[rows > 0] if y_kind == "quefrency" else rows
        if placed.size < 2:
            return None
        edges = cell_edges(placed, False)
        y_limits = (float(edges[0]), float(edges[-1]))
    unit = data.view.get("unit")
    return ImageAnswer(
        key=key,
        version=key,
        xs=xs,
        ys=rows,
        values=np.asarray(data.values, dtype=np.float64),
        identity=data.calibration,
        axis=axis_key(data),
        quantity=str(data.view.get("quantity", "level")),
        # Across, the first and the last column's time.
        x_limits=(float(xs[0]), float(xs[-1])),
        y_limits=y_limits,
        nbytes=data.nbytes,
        channels=data.channels or None,
        y_kind=y_kind,
        unit=str(unit) if unit else None,
    )


def signal_answer_of(key: str, data: StageData) -> SignalAnswer | None:
    """A kept time-signal step's samples as the figure service's signal answer (the store's own array, not a copy);
    None where it has no sample or no sample rate."""
    if not data.rate > 0 or not data.values.size:
        return None
    view = data.view
    unit = str(view.get("unit", ""))
    return SignalAnswer(
        key=key,
        version=key,
        start=float(data.start),
        rate=float(data.rate),
        values=data.values,
        identity=data.calibration,
        # Signals are on one axis when they are sample for sample: one unit, one rate, and starts within half a
        # sample (of other lengths, their Δ is over the samples both have).
        axis=f"signal|{unit}|{float(data.rate):.9g}|{round(float(data.start) * float(data.rate))}",
        quantity=str(view.get("quantity", "value")),
        unit=unit,
        nbytes=data.nbytes,
        channels=data.channels or None,
    )


#: A trigger's event is named as any answer is (仕様 5): the trigger step's key, this mark, the event's number
#: (wandas' event id, from 0). ``<key>#event:<id>``.
EVENT_MARK = "#event:"


#: In place of a number: the mean of the step's events, sample by sample (layer 1's: stage_view.read_frame). It is
#: no line of its own; a base group's line is the median of its recordings' means.
EVENT_MEAN = "mean"


#: After a trigger step's key: when its events fired (figures/answers.py EventsAnswer), for the guide lines of the
#: lanes that show each recording as the trigger takes it.
EVENTS_MARK = "#events"


def events_answer_of(key: str, data: StageData, version: str) -> EventsAnswer:
    """A kept trigger step's events' numbers and firing times (s into the file), as layer 1 cut them."""
    times = tuple(float(time) for time in data.event_times)
    return EventsAnswer(key=key, version=version, ids=tuple(data.event_ids[: len(times)]), times=times)


def event_key(key: str, event_id: int | str) -> str:
    return f"{key}{EVENT_MARK}{event_id}"


def event_mean_answer_of(key: str, data: StageData, version: str) -> SignalAnswer | None:
    """The mean of a kept trigger step's events (its ``values``: layer 1 averaged them) as a signal over the time
    from the trigger, on the axis its events are on."""
    if data.rows is None or not data.event_rate > 0 or not data.values.size:
        return None
    first = event_answer_of(key, data, data.event_ids[0], version)
    return replace(first, values=data.values, nbytes=int(data.values.nbytes)) if first is not None else None


def event_answer_of(key: str, data: StageData, event_id: int, version: str) -> SignalAnswer | None:
    """One event of a kept trigger step as the figure service's signal answer: its samples (channels averaged by
    layer 1, the store's own row) over the time from its trigger; ``key`` is the event's own and ``version`` the
    trigger step's (an event is of the version its step's answer is of). None where the step
    keeps no such event. Every event of every recording cut by one trigger is on one axis (one unit, one rate, one
    start before the trigger), so they are drawn over one another; no median or Δ is taken of them."""
    if data.rows is None or event_id not in data.event_ids or not data.event_rate > 0:
        return None
    row = data.rows[data.event_ids.index(event_id)]
    unit = str(data.view.get("unit", ""))
    return SignalAnswer(
        key=key,
        version=version,
        start=float(data.event_start),
        rate=float(data.event_rate),
        values=row,
        identity=data.calibration,
        axis=f"signal|{unit}|{float(data.event_rate):.9g}|{round(float(data.event_start) * float(data.event_rate))}",
        quantity=str(data.view.get("quantity", "value")),
        unit=unit,
        nbytes=int(row.nbytes),
        channels=data.channels or None,
        x_kind="triggerTime",
    )


def column_answer_of(column: TableColumn) -> ColumnAnswer:
    """A kept table column as the figure service's answer."""
    return ColumnAnswer(
        key=column.key,
        version=column.version,
        rows=column.rows,
        values=column.values,
        # A table column has no level reference: its numbers are drawn as the table writes them.
        identity=("", 1.0, ""),
        axis="column",
        nbytes=column.nbytes,
    )


class StoreAnswers:
    """AnswerSource over services/answer_store.py's STORE and COLUMNS: a table column, or a step's kept values by
    key (a line kept outside a scan
    as it is; LINE_MODES as lines, IMAGE_MODES as an image, the sound itself as a signal, one event of a trigger's as a
    signal over the time from its trigger); None when the store no longer keeps it. A key of any other step is
    answered as none too (and so counted ``evicted`` by the figure: there is no reason word yet for "not a kind this
    service draws")."""

    def answer(self, key: str) -> AnyAnswer | None:
        column = COLUMNS.get(key)
        if column is not None:
            return column_answer_of(column)
        if key.endswith(EVENTS_MARK):
            fired = STORE.get(key[: -len(EVENTS_MARK)])
            if fired is None or fired.mode != "events":
                return None
            return events_answer_of(key, fired, key[: -len(EVENTS_MARK)])
        step, mark, event = key.rpartition(EVENT_MARK)
        if mark and (event.isdigit() or event == EVENT_MEAN):
            kept = STORE.get(step)
            if kept is None or kept.mode != "events":
                return None
            if event == EVENT_MEAN:
                return event_mean_answer_of(key, kept, step)
            return event_answer_of(key, kept, int(event), step)
        data = STORE.get(key)
        if data is None:
            # A recording's extent (tracks_answers.py): a signal or an image as any other, kept in a store of its own.
            data = EXTENTS.get(key)
        if data is None:
            return None
        if isinstance(data, LineData):
            return line_answer_of(key, data)
        if isinstance(data, SignalData):
            return track_signal_answer_of(key, data)
        if isinstance(data, ImageData):
            return track_image_answer_of(key, data)
        if data.mode in LINE_MODES:
            return answer_of(key, data)
        if data.mode in IMAGE_MODES:
            return image_answer_of(key, data)
        if data.mode == "signal":
            return signal_answer_of(key, data)
        return None


class CombineOps:
    """LayerOne by services/combine_ops.py (the one entry point of the layer 1 candidates)."""

    def median(self, rows: Sequence[Values]) -> Values:
        return combine_ops.median(rows)

    def level_delta(self, compare: Values, base: Values) -> Values:
        return combine_ops.level_delta(compare, base)

    def difference(self, compare: Values, base: Values) -> Values:
        return combine_ops.difference(compare, base)

    def common_length(self, rows: Sequence[Values]) -> Sequence[Values]:
        return combine_ops.common_length(rows)

    def signal_difference(self, compare: Values, base: Values) -> Values:
        return combine_ops.signal_difference(compare, base)


#: The process's one budget (第 5 節): the answers the store keeps, what the Figures hold and what the draws
#: running now reserved, together. Its size is the store's own (smaller in the browser, browser_service.py) and the
#: Figures' share: the store never keeps more than its own, and room is made of its answers no Figure uses.
BUDGET = Budget(lambda: STORE.budget + FIGURE_BUDGET_BYTES, lambda: STORE.nbytes() + COLUMNS.nbytes(), STORE.make_room)

#: The process's one figure service (the native backend's workers and the browser Worker alike).
FIGURES = FigureService(StoreAnswers(), CombineOps(), BUDGET)
