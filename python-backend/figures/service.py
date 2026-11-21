"""The figure service's five requests: draw, read, export, release, count (第 5 節, 第 6 節).

The three steps of 第 5 節, in this order and once per request (draw, read, export and count use the same results,
never another path):

1. what is shown and counted (計算ア, members.py), from the answers looked up by key (answers.py);
2. layer 1 makes the median and the Δ of the sets step 1 decided (answers.LayerOne: services/combine_ops.py today);
3. the picture: the confirmed range (イ, ranges.py), the drawn points (ウ, through picture.py only), the headline
   (オ, headline.py); a read picks its point (エ, pick.py) from what draw held.

This file computes nothing itself (no numpy, rule A): it looks up, calls and holds.

Holdings (第 6 節「取り置きの寿命」): per Figure id, the newest generation's results only. A draw of an older
generation than one already begun is not held; a draw finished after its Figure was released, or after a newer
generation began, is not held (the check runs again when it finishes). Over the budget, the Figure read least
recently loses its holding, and its next read is answered ``no-picture``.

The budget is the process's one (budget.py): a draw reserves its estimate of it before anything is computed and
gives it back when it ends. Over the budget alone it is refused (``too-large``); not fitting beside the requests
running now, it is answered ``busy`` (the Figure asks once more). A time signal's samples are never held by a
Figure: its read looks its answer up by key again and reads the part around the pointer (第 5 節「読み値のための
取り置き」); when the answer is no longer kept, the read is answered ``no-picture`` and the Figure draws again.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import threading
from collections import OrderedDict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, cast

from figures.answers import (
    Answer,
    AnswerSource,
    AnyAnswer,
    ColumnAnswer,
    EventsAnswer,
    ImageAnswer,
    LayerOne,
    SignalAnswer,
    Values,
)
from figures.budget import Budget, Verdict
from figures.headline import Headline, delta_peak, signal_peak
from figures.members import Members, bin_counts, members, rows_picked, rows_shown
from figures.pick import (
    Ask,
    CellAsk,
    CellNameAsk,
    CellPick,
    CellPointerAsk,
    CellStepAsk,
    NameAsk,
    Pick,
    PickLine,
    PickSignal,
    PointerAsk,
    StepAsk,
    bin_lines,
    bin_under,
    pick,
    pick_cell,
    pick_sample,
)
from figures.picture import (
    AnyPlan,
    BandLine,
    BandPlan,
    BinsMark,
    BinsPlan,
    Guide,
    ImagePlan,
    LanePlan,
    LinePlan,
    assemble,
    axis_json,
    headline_json,
    members_json,
)
from figures.ranges import (
    DB_QUANTITIES,
    ConfirmedRange,
    Ends,
    ImageExtent,
    ImageRange,
    band_range,
    bins_count_axis,
    bins_range,
    confirmed_range,
    image_axes,
    image_colour,
    image_extent,
    shared_amplitude,
    value_axis,
)
from figures.spec import FigureSpec, LaneSpec, SpecError, canonical, parse_spec
from figures.thinning import BAND_WORK_BYTES, DOTS_BELOW, bin_edges, bin_of, bin_width, stacked_levels

#: The Figures' share of the process's one budget (bytes): what transport/figure_answers.py adds to the answers'
#: store's to make the one budget, and the whole budget of a service made without one (the tests').
FIGURE_BUDGET_BYTES = 256 * 1024 * 1024
#: Released Figure ids remembered, so a draw that finishes after its Figure was released is not held.
RELEASED_MEMORY = 4096
#: Band lanes whose whole range is remembered.
WHOLE_BANDS_MEMORY = 16


def log_no_picture(reason: str, **ids: object) -> None:
    """One line on stderr each time a read or an export is answered ``no-picture``, saying why: stderr is the backend's
    log in both hosts (the native backend's output channel, the browser Worker's console), as perf.py writes there."""
    told = " ".join(f"{name}={value}" for name, value in ids.items())
    print(f"[figure] no-picture: {reason} {told}".rstrip(), file=sys.stderr, flush=True)


class FigureRequestError(ValueError):
    """A request the service cannot take as it is (transport answers it as an input error)."""


@dataclass(frozen=True)
class _Band:
    """A band lane as held: its signals by name (line id, recording key, the answer's version), never their samples,
    and its confirmed range."""

    lines: tuple[tuple[str, str | None, str], ...]
    range: ConfirmedRange
    #: Per Δ line (no key): its own samples, compare − base, as the picture was drawn of them (a combined answer is
    #: the Figure's to hold, as a median's and a Δ's of a lane of lines are; counted in the holding's bytes).
    made: Mapping[str, SignalAnswer] = field(default_factory=dict)


@dataclass
class _Holding:
    generation: int
    picture_id: str
    data_id: str
    #: Per lane: its pick lines (declared order), its confirmed range and whether across is logarithmic.
    lanes: dict[str, tuple[tuple[PickLine, ...], ConfirmedRange, bool]]
    #: Per image lane: its plan (the recording's answer and the confirmed range a cell is read inside).
    images: dict[str, ImagePlan]
    #: Per line: the recording it is of (None for a median or a Δ) and its role.
    keys: dict[str, str | None]
    roles: dict[str, str | None]
    #: Per line: the version of its answer (of the versions of every recording it is made of): a point's name carries
    #: it, so a step from a point of another answer is refused (``no-point``), never taken on this one.
    versions: dict[str, str]
    nbytes: int
    #: Per band lane: its signals by name (their samples stay with the answers).
    bands: dict[str, _Band] = field(default_factory=dict)
    #: Every recording key the picture is of: their answers are in use (never let go to make room).
    answers: frozenset[str] = frozenset()
    #: Per bins lane: its plan (the rows, their placement and counts: a read's point is named of them).
    bins: dict[str, BinsPlan] = field(default_factory=dict)


@dataclass
class _Prepared:
    """Steps 1 and 2 of one spec, and the confirmed ranges and headlines of step 3."""

    spec: FigureSpec
    found: Members
    lanes: list[AnyPlan]
    headlines: dict[str, Headline]
    data_id: str
    nbytes: int
    answers: dict[str, AnyAnswer] = field(default_factory=dict)
    #: Per line drawn: the version of its answer (_Holding.versions).
    versions: dict[str, str] = field(default_factory=dict)


def _hash(*parts: object) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:32]


def _ends(raw: object, where: str) -> Ends:
    if raw is None:
        return Ends(None, None)
    if not isinstance(raw, list) or len(raw) != 2:
        raise FigureRequestError(f"{where}: expected [low, high] (null for an end not specified)")
    low, high = (None if value is None else float(value) for value in raw)
    for value in (low, high):
        if value is not None and not math.isfinite(value):
            raise FigureRequestError(f"{where}: an end must be finite")
    if low is not None and high is not None and not high > low:
        raise FigureRequestError(f"{where}: the high end must be above the low end")
    return Ends(low, high)


def _view(raw: object, spec: FigureSpec) -> tuple[Ends, dict[str, Ends], dict[str, Ends]]:
    """The specified range: ``x`` (shared by the lanes) and, per lane, ``y`` and (an image's) ``colour``; an end not
    specified is null."""
    view = cast(dict[str, object], raw) if isinstance(raw, dict) else {}
    lanes_raw = view.get("lanes") or []
    if not isinstance(lanes_raw, list):
        raise FigureRequestError("view.lanes: expected a list of {lane, y}")
    ups: dict[str, Ends] = {lane.id: Ends(None, None) for lane in spec.lanes}
    colours: dict[str, Ends] = dict(ups)
    for index, item in enumerate(cast(list[object], lanes_raw)):
        entry = cast(dict[str, object], item) if isinstance(item, dict) else {}
        lane = entry.get("lane")
        if not isinstance(lane, str) or lane not in ups:
            raise FigureRequestError(f"view.lanes[{index}].lane: no such lane {lane!r}")
        ups[lane] = _ends(entry.get("y"), f"view.lanes[{index}].y")
        colours[lane] = _ends(entry.get("colour"), f"view.lanes[{index}].colour")
    return _ends(view.get("x"), "view.x"), ups, colours


def _selection(raw: object, closed: object = False) -> tuple[float, float, bool] | None:
    """The selected value range of a distribution (範囲の選択): both ends and whether it takes the values on its
    high end (``selectionClosed``), or none."""
    ends = _ends(raw, "selection")
    if ends.low is None and ends.high is None:
        return None
    if ends.low is None or ends.high is None:
        raise FigureRequestError("selection: expected both ends of the selected range, or none")
    return ends.low, ends.high, closed is True


def _recording_lanes_together(plans: list[AnyPlan], spec: FigureSpec, ups: Mapping[str, Ends]) -> list[AnyPlan]:
    """The lanes that show recordings' own answers, a lane a recording (the recordings as a trigger takes them; the
    comparison's lines or sounds shown a lane a recording), are looked at together (計算イ), as an image's lanes
    are: across they show the same part (from the earliest first point to the latest last one), and up the lanes of
    one unit and reference share one range (the widest of theirs), a lane whose range up is specified apart. A Δ
    lane is no recording's own: it keeps its range. A lane on a value axis of its own (the spec's ``axis``: of another
    quantity or reference than its neighbours) shows the same part across and keeps its own range up."""
    own = {lane.id for lane in spec.lanes if all(line.of != "delta" for line in lane.lines)}
    apart = {lane.id for lane in spec.lanes if lane.own_axis}
    nothing = Ends(None, None)

    def widest(ends: Sequence[tuple[float, float]]) -> tuple[float, float]:
        return min(low for low, _ in ends), max(high for _, high in ends)

    lines = [
        (plan, plan.range, plan.whole)
        for plan in plans
        if isinstance(plan, LanePlan) and plan.id in own and plan.range is not None and plan.whole is not None
    ]
    together: dict[str, LanePlan] = {}
    if len(lines) >= 2:
        # (The lines of one figure are of one unit and reference: 計算ア draws no other.)
        across, whole_across = widest([at.x for _, at, _ in lines]), widest([whole.x for _, _, whole in lines])
        free = [at.y for plan, at, _ in lines if ups.get(plan.id, nothing) == nothing and plan.id not in apart]
        shared_whole = [whole.y for plan, _, whole in lines if plan.id not in apart]
        for plan, at, whole in lines:
            alone = plan.id in apart
            up = widest(free) if free and not alone and ups.get(plan.id, nothing) == nothing else at.y
            together[plan.id] = replace(
                plan,
                range=ConfirmedRange(across, up),
                whole=ConfirmedRange(whole_across, whole.y if alone else widest(shared_whole)),
            )
    plans = [together.get(plan.id, plan) if isinstance(plan, LanePlan) else plan for plan in plans]
    bands = [plan for plan in plans if isinstance(plan, BandPlan) and plan.id in own]
    if len(bands) < 2:
        return plans

    x, whole_x = widest([plan.range.x for plan in bands]), widest([plan.whole.x for plan in bands])
    shared: dict[str, BandPlan] = {}
    for plan in bands:
        first = plan.lines[0].answer
        same = [
            other
            for other in bands
            if (other.lines[0].answer.identity, other.lines[0].answer.unit) == (first.identity, first.unit)
        ]
        free = [other.range.y for other in same if ups.get(other.id, Ends(None, None)) == Ends(None, None)]
        y = widest(free) if free and ups.get(plan.id, Ends(None, None)) == Ends(None, None) else plan.range.y
        whole = ConfirmedRange(whole_x, widest([other.whole.y for other in same]))
        shared[plan.id] = replace(plan, range=ConfirmedRange(x, y), whole=whole)
    return [shared.get(plan.id, plan) if isinstance(plan, BandPlan) else plan for plan in plans]


def _delta_lanes_across(plans: list[AnyPlan], spec: FigureSpec) -> list[AnyPlan]:
    """A Δ lane shows the same part across as the lanes of the recordings it is of (計算イ). A Δ over time ends
    where the shorter recording does, and the lanes are drawn one under another over one width with the ticks
    under the last: left to its own range, the Δ and the lines above it would be at different times at the same
    place across. Past its last point the Δ lane is empty."""
    delta = {lane.id for lane in spec.lanes if any(line.of == "delta" for line in lane.lines)}
    drawn = [plan for plan in plans if isinstance(plan, (LanePlan, BandPlan)) and plan.range is not None]
    own = [plan for plan in drawn if plan.id not in delta and plan.whole is not None]
    if not own or len(own) == len(drawn):
        return plans

    def widest(ends: Sequence[tuple[float, float]]) -> tuple[float, float]:
        return min(low for low, _ in ends), max(high for _, high in ends)

    x = widest([cast(ConfirmedRange, plan.range).x for plan in own])
    whole_x = widest([cast(ConfirmedRange, plan.whole).x for plan in own])
    out: list[AnyPlan] = []
    for plan in plans:
        if isinstance(plan, (LanePlan, BandPlan)) and plan.id in delta and plan.range is not None:
            whole = ConfirmedRange(whole_x, plan.whole.y) if plan.whole is not None else None
            plan = replace(plan, range=ConfirmedRange(x, plan.range.y), whole=whole)
        out.append(plan)
    return out


#: The most of a range's length a picture is drawn past each end (``ahead``): three screens of points in all.
MAX_AHEAD = 1.0


def _ahead(raw: object) -> float:
    """How much of the range's length the time lanes are drawn past each end, as the request says (``ahead``): none
    where it says nothing, never more than ``MAX_AHEAD``."""
    if raw is None:
        return 0.0
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw) or raw < 0:
        raise FigureRequestError("ahead: expected a number from 0")
    return min(float(raw), MAX_AHEAD)


def _lane_heights(raw: object, spec: FigureSpec, height: float) -> dict[str, float]:
    """Each lane's frame height (CSS px): as the request says (``laneHeights``), else the frame's height shared."""
    heights = {lane.id: height / len(spec.lanes) for lane in spec.lanes}
    for item in cast(list[object], raw) if isinstance(raw, list) else []:
        entry = cast(dict[str, object], item) if isinstance(item, dict) else {}
        lane, value = entry.get("lane"), entry.get("height")
        if isinstance(lane, str) and lane in heights and isinstance(value, (int, float)) and value > 0:
            heights[lane] = float(value)
    return heights


class FigureService:
    def __init__(self, source: AnswerSource, ops: LayerOne, budget: int | Budget = FIGURE_BUDGET_BYTES) -> None:
        self._source = source
        self._ops = ops
        self._budget = budget if isinstance(budget, Budget) else Budget(budget)
        self._lock = threading.Lock()
        self._holdings: OrderedDict[str, _Holding] = OrderedDict()
        self._latest: dict[str, int] = {}
        self._released: OrderedDict[str, None] = OrderedDict()
        #: Figures whose holding was let go over the budget, remembered so a read of them says so (log_no_picture).
        self._evicted: OrderedDict[str, None] = OrderedDict()
        #: The whole range of the band lanes drawn last, by the answers (key, version) they are of: two pairs of
        #: numbers each, no sample.
        self._whole_bands: OrderedDict[tuple[tuple[str, str], ...], ConfirmedRange] = OrderedDict()

    # --- Steps 1 and 2, and step 3's ranges and headline --------------------------------------------------------

    def _prepare(self, spec_raw: object, view_raw: object, selection_raw: object, closed: object = False) -> _Prepared:
        try:
            spec = parse_spec(spec_raw)
        except SpecError as error:
            raise FigureRequestError(str(error)) from error
        across, ups, colours = _view(view_raw, spec)
        keys = spec.keys_in_order()
        looked = {key: self._source.answer(key) for key in keys}
        # The answers guide lines are made of (a trigger's events): no line and no member of 計算ア.
        guiding = {key: self._source.answer(key) for key in spec.guide_keys()}
        # The answers of other figures' lanes a lane's automatic scale is shared with: no line, no member either.
        scaling = {key: self._source.answer(key) for key in spec.scale_keys()}
        found = members(spec, looked)
        held = {key: answer for key, answer in looked.items() if answer is not None and key in found.shown.used}
        # The answers of the line lanes: lines over one axis (a spectrum).
        answers = {key: answer for key, answer in held.items() if isinstance(answer, Answer)}
        line_keys = {
            key for lane in spec.lanes if lane.kind == "lines" for line in lane.lines for key in (line.key, *line.base)
        }
        shared_keys = {
            key
            for lane in spec.lanes
            if lane.kind == "lines" and not lane.own_axis
            for line in lane.lines
            for key in (line.key, *line.base)
        }

        def target_of(lane: LaneSpec) -> Answer | None:
            """The answer a lines lane's axes are named and ranged by: the first combined one of the lanes on the
            figure's axis, or, for a lane on an axis of its own, of its own keys."""
            keys = {key for line in lane.lines for key in (line.key, *line.base)} if lane.own_axis else shared_keys
            return next((answers[key] for key in found.combined.used if key in answers and key in keys), None)

        if any(key in line_keys and not isinstance(answer, Answer) for key, answer in held.items()):
            raise FigureRequestError("a lines lane draws answers that are lines (a spectrum), not images")
        medians: dict[frozenset[str], Values] = {}

        def median_of(used: tuple[str, ...]) -> Values:
            # Over the part every recording of the group has (over time they may be of other lengths; on any other
            # axis the ones combined are on the same points, 計算ア).
            group = frozenset(used)
            if group not in medians:
                medians[group] = self._ops.median(self._ops.common_length([answers[key].values for key in used]))
            return medians[group]

        plans: list[AnyPlan] = []
        headlines: dict[str, Headline] = {}
        nbytes = 0
        selection = _selection(selection_raw, closed)
        bins = self._bins_plans(spec, found, held, across, selection)
        images = self._image_plans(spec, found, held, across, ups, colours, scaling)
        for lane in spec.lanes:
            if lane.kind == "bins":
                counted = bins.get(lane.id)
                plans.append(counted if counted is not None else LanePlan(lane.id, "level", None, "linear", None, ()))
                nbytes += 4 * int(getattr(counted.values, "nbytes", 0)) if counted is not None else 0
                continue
            if lane.kind == "image":
                image = images.get(lane.id)
                plans.append(image if image is not None else LanePlan(lane.id, "level", None, "linear", None, ()))
                # The holding keeps the recording's cells (a read is of them), whatever the store does after.
                nbytes += image.answer.nbytes if image is not None else 0
                continue
            if lane.kind == "band":
                band = self._band_plan(lane, found, held, across, ups[lane.id], guiding, spec, scaling)
                plans.append(band if band is not None else LanePlan(lane.id, "level", None, "linear", None, ()))
                if band is None:
                    continue
                for made in band.lines:
                    if made.key is not None:
                        continue
                    # A Δ of two signals: held by the Figure (a read is of it), and headed by its largest sample.
                    nbytes += made.answer.nbytes
                    of = made.answer
                    peak = signal_peak(made.id, of.start, of.rate, of.values, band.range.x)
                    if peak is not None:
                        headlines.setdefault(lane.id, peak)
                continue
            delta = any(line.of == "delta" for line in lane.lines)
            target = target_of(lane)
            # A level and a gain are in dB: under the silent floor is no value, and their Δ is a level Δ.
            in_db = target is not None and target.quantity in DB_QUANTITIES
            # Across, a frequency and a quefrency have no point at or under 0 (0 Hz, a cepstrum's first coefficient)
            # on a log axis. A spectrum on a linear axis is drawn and read from 0 Hz, so its 0 Hz bin counts in the
            # range up as well.
            positive = (
                target is not None
                and target.x_kind in ("frequency", "quefrency", "band")
                and not (target.x_kind == "frequency" and target.x_scale == "linear")
            )
            lines: list[LinePlan] = []
            for line in lane.lines:
                drawn = found.lines[line.id]
                if not drawn.drawn:
                    continue
                if line.of == "key":
                    answer = answers[drawn.used[0]]
                    lines.append(LinePlan(line.id, line.role, line.key, answer.xs, answer.values, in_db))
                elif line.of == "median" and len(line.base) == 1:
                    # The base of one recording (計算ア said so): its own answer, and the line is of its key.
                    answer = answers[drawn.used[0]]
                    lines.append(LinePlan(line.id, line.role, drawn.used[0], answer.xs, answer.values, in_db))
                elif line.of == "median":
                    values = median_of(drawn.used)
                    xs = answers[drawn.used[0]].xs[: len(values)]
                    lines.append(LinePlan(line.id, line.role, None, xs, values, in_db))
                else:
                    compare = answers[drawn.used[0]]
                    compared, base = self._ops.common_length([compare.values, median_of(drawn.used[1:])])
                    values = self._ops.level_delta(compared, base) if in_db else self._ops.difference(compared, base)
                    lines.append(LinePlan(line.id, line.role, None, compare.xs[: len(values)], values, False))
                nbytes += int(getattr(lines[-1].values, "nbytes", 0)) + int(getattr(lines[-1].xs, "nbytes", 0))
            confirmed = whole = None
            if target is not None:
                answered = [(plan.xs, plan.values) for plan in lines]
                limits = target.x_limits
                shown = [answers[plan.key] for plan in lines if plan.key is not None and plan.key in answers]
                if target.x_kind in ("frequency", "band"):
                    # A spectrum keeps its answers' own limits (20 Hz to the Nyquist frequency; bands: the outer
                    # edges of the first and last band, where the answer says them), of every line drawn: a
                    # recording of a higher sample rate is drawn to its own Nyquist frequency beside a lower one.
                    limits = (
                        min([limits[0], *(answer.x_limits[0] for answer in shown)]),
                        max([limits[1], *(answer.x_limits[1] for answer in shown)]),
                    )
                elif lines:
                    # Any other axis: from the first to the last point of any line drawn.
                    limits = (min(float(plan.xs[0]) for plan in lines), max(float(plan.xs[-1]) for plan in lines))
                log = target.x_scale == "log"
                nothing = Ends(None, None)
                confirmed = confirmed_range(
                    answered, target.quantity, delta, limits, across, ups[lane.id], log=log, positive=positive
                )
                whole = confirmed_range(
                    answered, target.quantity, delta, limits, nothing, nothing, log=log, positive=positive
                )
                for plan in lines if delta else ():
                    peak = delta_peak(plan.id, plan.xs, plan.values, confirmed.x, positive)
                    if peak is not None:
                        headlines.setdefault(lane.id, peak)
            plans.append(
                LanePlan(
                    lane.id,
                    "delta" if delta else "level" if in_db or target is None else "value",
                    target.identity if target is not None else None,
                    target.x_scale if target is not None else "log",
                    confirmed,
                    tuple(lines),
                    whole=whole,
                    named=target,
                )
            )
        plans = _recording_lanes_together(plans, spec, ups)
        plans = _delta_lanes_across(plans, spec)
        versions = {key: spec.keys[key].version for key in found.shown.used}
        ranges = {
            plan.id: None
            if plan.range is None
            else [plan.range.x, plan.range.y, *([plan.range.colour] if isinstance(plan, ImagePlan) else [])]
            for plan in plans
        }
        data_id = _hash(canonical(spec_raw), versions, ranges, selection)
        drawn_lines = [
            line_id
            for plan in plans
            if not isinstance(plan, BinsPlan)
            for line_id in ([plan.line] if isinstance(plan, ImagePlan) else [line.id for line in plan.lines])
        ]
        line_versions = {
            line_id: _hash([(key, spec.keys[key].version) for key in found.lines[line_id].used])
            for line_id in drawn_lines
        }
        for plan in plans:
            if isinstance(plan, BinsPlan):
                # Every line of a bins lane is of its column: a point's name carries the column's version.
                version = _hash([(plan.column, spec.keys[plan.column].version)])
                line_versions.update({line: version for line in (plan.bars, plan.rows, *(m.id for m in plan.marks))})
        return _Prepared(spec, found, plans, headlines, data_id, nbytes, held, line_versions)

    @staticmethod
    def _image_plans(
        spec: FigureSpec,
        found: Members,
        held: Mapping[str, AnyAnswer],
        across: Ends,
        ups: Mapping[str, Ends],
        colours: Mapping[str, Ends],
        scaling: Mapping[str, AnyAnswer | None],
    ) -> dict[str, ImagePlan]:
        """The image lanes' plans: each lane's one recording, if 計算ア shows it, with its confirmed range (計算イ).
        The images of one figure are looked at together (基準、比較の熱図の間で範囲がずれない): with nothing
        specified they show the same part across (from the earliest first column to the latest last one) and up
        (of the same rows' axis), and share one colour range, taken of all their cells on screen (計算ア shows
        together only recordings on one axis against one reference: one against another is left out, with why).
        A lane whose scale is shared with other figures' images (``scaleWith``) takes their whole extents into its
        colour range too: those of its own quantity, unit and reference that keep one."""
        shown: dict[str, tuple[LaneSpec, ImageAnswer]] = {}
        for lane in spec.lanes:
            if lane.kind != "image":
                continue
            (line,) = lane.lines
            drawn = found.lines[line.id]
            if not drawn.drawn:
                continue
            answer = held[drawn.used[0]]
            if not isinstance(answer, ImageAnswer):
                raise FigureRequestError("an image lane draws an answer that is an image (a spectrogram)")
            shown[lane.id] = (lane, answer)
        if not shown:
            return {}
        answers = [answer for _, answer in shown.values()]
        x_limits = (min(a.x_limits[0] for a in answers), max(a.x_limits[1] for a in answers))

        def y_limits(kind: str) -> tuple[float, float]:
            same = [a.y_limits for a in answers if a.y_kind == kind]
            return min(low for low, _ in same), max(high for _, high in same)

        nothing = Ends(None, None)

        def whole_extent(other: ImageAnswer) -> ImageExtent | None:
            # The extent it keeps of its whole recording (a Tracks row's); else of every cell it has.
            if other.extent is not None:
                return ImageExtent(*other.extent)
            return image_extent(
                other.xs,
                other.ys,
                other.values,
                other.x_limits,
                other.y_limits,
                quantity=other.quantity,
                log=other.y_log,
                positive=other.y_positive,
            )

        linked = {
            lane_id: [
                whole_extent(other)
                for other in (scaling.get(key) for key in lane.scale_with)
                if isinstance(other, ImageAnswer) and (other.quantity, other.identity) == (a.quantity, a.identity)
            ]
            for lane_id, (lane, a) in shown.items()
        }

        def ranged(specified: bool) -> dict[str, ImageRange]:
            axes = {
                lane_id: image_axes(
                    x_limits,
                    y_limits(a.y_kind),
                    across if specified else nothing,
                    ups[lane_id] if specified else nothing,
                    a.y_log,
                )
                for lane_id, (_, a) in shown.items()
            }
            extents = {
                lane_id: ImageExtent(*a.extent)
                if a.extent is not None
                else image_extent(
                    a.xs, a.ys, a.values, *axes[lane_id], quantity=a.quantity, log=a.y_log, positive=a.y_positive
                )
                for lane_id, (_, a) in shown.items()
            }
            return {
                lane_id: ImageRange(
                    *axes[lane_id],
                    image_colour(
                        a.quantity,
                        [*extents.values(), *linked[lane_id]],
                        colours[lane_id] if specified else nothing,
                    ),
                )
                for lane_id, (_, a) in shown.items()
            }

        confirmed = ranged(True)
        # With nothing specified the confirmed range is the whole one: every cell is looked at once, not twice.
        plain = across == nothing and all(ups[i] == nothing and colours[i] == nothing for i in shown)
        whole = confirmed if plain else ranged(False)
        return {
            lane_id: ImagePlan(
                lane_id, lane.lines[0].id, lane.lines[0].role, answer.key, answer, confirmed[lane_id], whole[lane_id]
            )
            for lane_id, (lane, answer) in shown.items()
        }

    def _band_plan(
        self,
        lane: LaneSpec,
        found: Members,
        held: Mapping[str, AnyAnswer],
        across: Ends,
        up: Ends,
        guiding: Mapping[str, AnyAnswer | None],
        spec: FigureSpec,
        scaling: Mapping[str, AnyAnswer | None],
    ) -> BandPlan | None:
        """A band lane's plan: the signals of its lines 計算ア shows, with their confirmed range (計算イ). A Δ line's
        signal is compare − base, sample by sample (layer 1), from the compared recording's first sample."""
        lines: list[BandLine] = []
        for line in lane.lines:
            drawn = found.lines[line.id]
            if not drawn.drawn:
                continue
            used = [held[key] for key in drawn.used]
            if not all(isinstance(answer, SignalAnswer) for answer in used):
                raise FigureRequestError("a band lane draws answers that are time signals")
            answer = cast(SignalAnswer, used[0])
            if line.of == "key":
                lines.append(BandLine(line.id, line.role, answer.key, answer))
                continue
            if line.of == "median":
                # A base group of a trigger's events: the median, sample by sample, of each recording's events'
                # mean (layer 1; 第 1 節の表「トリガーのイベント」). No median is taken of recordings' sounds.
                signals = [cast(SignalAnswer, item) for item in used]
                if any(item.x_kind != "triggerTime" for item in signals):
                    raise FigureRequestError(
                        "a band lane draws recordings' own signals: a median only of a trigger's events' means"
                    )
                if len(signals) == 1:
                    lines.append(BandLine(line.id, line.role, answer.key, answer))
                    continue
                middle = self._ops.median(self._ops.common_length([item.values for item in signals]))
                of_all = _hash([(item.key, item.version) for item in used])
                median = replace(answer, key=line.id, version=of_all, values=middle, nbytes=int(middle.nbytes))
                lines.append(BandLine(line.id, line.role, None, median))
                continue
            values = self._ops.signal_difference(answer.values, cast(SignalAnswer, used[1]).values)
            version = _hash([(item.key, item.version) for item in used])
            difference = replace(answer, key=line.id, version=version, values=values, nbytes=int(values.nbytes))
            lines.append(BandLine(line.id, line.role, None, difference))
        if not lines:
            return None
        signals = [(line.answer.start, line.answer.rate, line.answer.values) for line in lines]
        nothing = Ends(None, None)
        # The whole range (every sample of every signal looked at) is remembered by the answers it is of: a zoom or a
        # pan of a long recording looks at the part on screen only.
        trigger = lane.trigger
        level = trigger.threshold if trigger is not None else None
        of = tuple((line.answer.key, line.answer.version) for line in lines)
        if level is not None:
            of = (*of, ("#level", repr(level)))
        # The lanes of other figures its scale is shared with (``scaleWith``): the signals of its own unit and
        # reference. Their range up, of every sample of them all, is remembered as a whole range is.
        first = lines[0].answer
        others = [
            other
            for other in (scaling.get(key) for key in lane.scale_with)
            if isinstance(other, SignalAnswer) and (other.unit, other.identity) == (first.unit, first.identity)
        ]
        shared = None
        if others:
            every = {(item.key, item.version): item for item in (*(line.answer for line in lines), *others)}
            shared_of = (("#shared", ""), *sorted(every))
            with self._lock:
                remembered = self._whole_bands.get(shared_of)
            if remembered is None:
                reach = shared_amplitude([(item.start, item.rate, item.values) for item in every.values()])
                remembered = ConfirmedRange((0.0, 0.0), reach)
                with self._lock:
                    self._whole_bands[shared_of] = remembered
            shared = remembered.y
            of = (*of, ("#shared", repr(shared)))
        with self._lock:
            whole = self._whole_bands.get(of)
        if whole is None:
            whole = band_range(signals, nothing, nothing, level, shared)
            with self._lock:
                self._whole_bands[of] = whole
                while len(self._whole_bands) > WHOLE_BANDS_MEMORY:
                    self._whole_bands.popitem(last=False)
        confirmed = whole if (across, up) == (nothing, nothing) else band_range(signals, across, up, level, shared)
        deltas = {line.id for line in lane.lines if line.of == "delta"}
        plan = BandPlan(lane.id, tuple(lines), confirmed, whole, any(line.id in deltas for line in lines))
        if trigger is None:
            return plan
        # 目安の線: the level the trigger fires at, each event's firing time and the stretch each event used was cut
        # over (from ``pre`` before its firing, ``duration`` long). The events are layer 1's (the step's own cut).
        events = guiding.get(trigger.events)
        fired = list(zip(events.ids, events.times, strict=True)) if isinstance(events, EventsAnswer) else []
        # No events' answer is held: said so with why (its key's state; a usable key's answer let go is ``evicted``),
        # never counted as a trigger that fired 0 times of 0.
        state = spec.keys[trigger.events].state
        missing = None if isinstance(events, EventsAnswer) else "evicted" if state == "usable" else state
        out = set(trigger.out)
        guides = (
            Guide("y", trigger.threshold, "threshold"),
            *(Guide("x", time, f"event:{number}", number in out) for number, time in fired),
        )
        spans = tuple(
            (time - trigger.pre, time - trigger.pre + trigger.duration) for number, time in fired if number not in out
        )
        return replace(plan, guides=guides, spans=spans, events=(len(spans), len(fired)), events_missing=missing)

    @staticmethod
    def _bins_plans(
        spec: FigureSpec,
        found: Members,
        held: Mapping[str, AnyAnswer],
        across: Ends,
        selection: tuple[float, float, bool] | None,
    ) -> dict[str, BinsPlan]:
        """The bins lanes' plans, in the order 第 1 節 gives a distribution: the rows shown (ア), the value axis
        they share (イ), the bins' edges and the dots' levels (配置), the rows per bin (ア), each lane's count
        axis (イ). A lane whose column 計算ア does not show has no plan."""
        shown = {}
        for lane in spec.lanes:
            if lane.kind != "bins" or lane.column not in found.shown.used:
                continue
            column = held[lane.column]
            if not isinstance(column, ColumnAnswer):
                raise FigureRequestError("a bins lane draws a column of the table")
            shown[lane.id] = (lane, rows_shown(lane.rows, column.rows, column.values))
        if not shown:
            return {}
        low, high = value_axis([rows.values for _, rows in shown.values()])
        edges = bin_edges(low, high)
        plans: dict[str, BinsPlan] = {}
        for lane, rows in shown.values():
            picked = rows_picked(rows.values, selection) if selection is not None else None
            counts = counts_picked = levels = None
            if len(rows.keys) < DOTS_BELOW:
                levels = stacked_levels(rows.values, low, high)
            else:
                counts, counts_picked = bin_counts(bin_of(edges, rows.values), len(edges) - 1, picked)
            count_ends = bins_count_axis(counts, levels)
            value_of = dict(zip(rows.keys, rows.values.tolist(), strict=True))
            # A row holding a role is drawn where the lane shows it: a row of another group, or without a
            # number, has no line here.
            marks = tuple(
                BinsMark(line.id, line.role, line.key, float(value_of[line.key]))
                for line in lane.lines
                if line.key is not None and line.key in value_of
            )
            plans[lane.id] = BinsPlan(
                lane.id,
                cast(str, lane.column),
                f"{lane.id}:bars",
                f"{lane.id}:rows",
                edges,
                bin_width(edges),
                rows.keys,
                rows.values,
                rows.blank,
                counts,
                counts_picked,
                picked,
                levels,
                marks,
                bins_range((low, high), count_ends, across),
                bins_range((low, high), count_ends, Ends(None, None)),
            )
        return plans

    def _estimate(self, spec_raw: object) -> int:
        """Bytes a draw will hold and stack, before anything is computed: every looked-up answer's arrays twice over
        (the median stacks its rows) and one more line per line declared; an image once; of a time signal, its
        drawn points only (its samples stay with the answer and are looked at where they lie, never copied)."""
        try:
            spec = parse_spec(spec_raw)
        except SpecError as error:
            raise FigureRequestError(str(error)) from error
        looked = {key: self._source.answer(key) for key in spec.keys_in_order()}
        sizes = [answer.nbytes for answer in looked.values() if isinstance(answer, Answer)]
        largest = max(sizes, default=0)
        lines = sum(len(lane.lines) for lane in spec.lanes if lane.kind == "lines")
        # An image is held as its answer is (nothing is stacked or combined of it): once.
        images = sum(answer.nbytes for answer in looked.values() if isinstance(answer, ImageAnswer))
        band = BAND_WORK_BYTES * sum(isinstance(answer, SignalAnswer) for answer in looked.values())
        # A time signal's Δ is made whole (compare − base) and held: once, the size of the compared recording's.
        for lane in spec.lanes:
            for line in lane.lines if lane.kind == "band" else ():
                compared = looked.get(line.key) if line.of == "delta" and line.key is not None else None
                band += compared.nbytes if isinstance(compared, SignalAnswer) else 0
                if line.of == "median":
                    # A median of signals (a base group's event means) stacks every one whole as float64, np.median
                    # works on a copy of the stack, and the median is held: twice the stack and one more row.
                    rows = [
                        8 * len(item.values) for key in line.base if isinstance(item := looked.get(key), SignalAnswer)
                    ]
                    band += 2 * sum(rows) + max(rows, default=0)
        # A table column: its rows sorted, counted and placed (a few arrays of its length).
        columns = 4 * sum(answer.nbytes for answer in looked.values() if isinstance(answer, ColumnAnswer))
        return 2 * sum(sizes) + lines * largest + images + band + columns

    def _reserve(self, figure_id: str, spec_raw: object, nbytes: int) -> Verdict:
        """Reserve a draw's estimate of the one budget. Where it does not fit, room is made first of the answers no
        Figure uses (the budget's own), then of the other Figures' holdings, the least recently read first (第 5 節
        「使用中の印」)."""
        try:
            named = frozenset(parse_spec(spec_raw).keys_in_order())
        except SpecError as error:
            raise FigureRequestError(str(error)) from error
        with self._lock:
            while True:
                # The Figure's own holding is not counted: this draw's takes its place.
                held = sum(item.nbytes for key, item in self._holdings.items() if key != figure_id)
                in_use = named.union(*(item.answers for item in self._holdings.values()))
                verdict = self._budget.reserve(nbytes, held, in_use)
                other = next((key for key in self._holdings if key != figure_id), None)
                if verdict == "ok" or other is None or nbytes > self._budget.limit:
                    return verdict
                self._let_go(other)

    def _let_go(self, figure_id: str) -> None:
        """Drop a Figure's holding over the budget (the lock is held): its next read is answered ``no-picture``."""
        self._holdings.pop(figure_id)
        self._evicted[figure_id] = None
        while len(self._evicted) > RELEASED_MEMORY:
            self._evicted.popitem(last=False)

    # --- Holdings -----------------------------------------------------------------------------------------------

    def _begin(self, figure_id: str, generation: int) -> bool:
        with self._lock:
            if figure_id in self._released or generation < self._latest.get(figure_id, generation):
                return False
            self._latest[figure_id] = generation
            return True

    def _keep(self, figure_id: str, holding: _Holding) -> bool:
        """Hold ``holding`` for its Figure, checked again now that it is made (第 6 節)."""
        with self._lock:
            if figure_id in self._released or self._latest.get(figure_id) != holding.generation:
                return False
            self._holdings.pop(figure_id, None)
            self._evicted.pop(figure_id, None)
            self._holdings[figure_id] = holding
            total = sum(item.nbytes for item in self._holdings.values())
            room = self._budget.limit - self._budget.kept()
            for other in list(self._holdings):
                if total <= room or other == figure_id:
                    continue
                total -= self._holdings[other].nbytes
                self._let_go(other)
            return True

    def held(self) -> dict[str, tuple[int, str]]:
        """The Figures holding results: their generation and picture id (for tests and measurements)."""
        with self._lock:
            return {key: (item.generation, item.picture_id) for key, item in self._holdings.items()}

    # --- The five requests --------------------------------------------------------------------------------------

    def draw(self, request: Mapping[str, Any]) -> dict[str, Any]:
        figure_id, generation = str(request["figureId"]), int(request["generation"])
        number = int(request["requestNumber"])
        echo = {"figureId": figure_id, "generation": generation, "requestNumber": number}
        width, height = float(request["width"]), float(request["height"])
        if not (width > 0 and height > 0 and math.isfinite(width) and math.isfinite(height)):
            raise FigureRequestError("width and height: expected positive CSS pixels")
        if not self._begin(figure_id, generation):
            return {"status": "superseded", **echo}
        estimate = self._estimate(request["spec"])
        verdict = self._reserve(figure_id, request["spec"], estimate)
        if verdict != "ok":
            return {"status": verdict, **echo}
        try:
            return self._draw(request, echo, width, height)
        finally:
            self._budget.release(estimate)

    def _draw(self, request: Mapping[str, Any], echo: dict[str, Any], width: float, height: float) -> dict[str, Any]:
        figure_id, generation, number = str(echo["figureId"]), int(echo["generation"]), int(echo["requestNumber"])
        prepared = self._prepare(
            request["spec"], request.get("view"), request.get("selection"), request.get("selectionClosed")
        )
        ahead = _ahead(request.get("ahead"))
        picture_id = _hash(prepared.data_id, width, height, ahead) if ahead else _hash(prepared.data_id, width, height)
        picture = assemble(
            figure_id=figure_id,
            generation=generation,
            request_number=number,
            picture_id=picture_id,
            data_id=prepared.data_id,
            lanes=prepared.lanes,
            headlines=prepared.headlines,
            found=prepared.found,
            width=width,
            heights=_lane_heights(request.get("laneHeights"), prepared.spec, height),
            ahead=ahead,
        )
        holding = _Holding(
            generation,
            picture_id,
            prepared.data_id,
            {
                plan.id: (
                    tuple(PickLine(line.id, line.xs, line.values, line.silent_floor) for line in plan.lines),
                    plan.range,
                    plan.x_scale == "log",
                )
                for plan in prepared.lanes
                if isinstance(plan, LanePlan) and plan.range is not None
            }
            | {
                plan.id: (
                    bin_lines(
                        plan.bars,
                        plan.rows,
                        plan.edges,
                        plan.counts,
                        plan.values,
                        plan.levels,
                        [(mark.id, mark.value) for mark in plan.marks],
                        plan.range.y[1],
                        plan.range.x,
                    ),
                    plan.range,
                    False,
                )
                for plan in prepared.lanes
                if isinstance(plan, BinsPlan)
            },
            {plan.id: plan for plan in prepared.lanes if isinstance(plan, ImagePlan)},
            {
                **{
                    line.id: line.key
                    for plan in prepared.lanes
                    if not isinstance(plan, (ImagePlan, BinsPlan))
                    for line in plan.lines
                },
                **{plan.line: plan.key for plan in prepared.lanes if isinstance(plan, ImagePlan)},
                **{mark.id: mark.key for plan in prepared.lanes if isinstance(plan, BinsPlan) for mark in plan.marks},
            },
            {
                **{
                    line.id: line.role
                    for plan in prepared.lanes
                    if not isinstance(plan, (ImagePlan, BinsPlan))
                    for line in plan.lines
                },
                **{plan.line: plan.role for plan in prepared.lanes if isinstance(plan, ImagePlan)},
                **{mark.id: mark.role for plan in prepared.lanes if isinstance(plan, BinsPlan) for mark in plan.marks},
            },
            prepared.versions,
            prepared.nbytes,
            {
                plan.id: _Band(
                    tuple((line.id, line.key, line.answer.version) for line in plan.lines),
                    plan.range,
                    {line.id: line.answer for line in plan.lines if line.key is None},
                )
                for plan in prepared.lanes
                if isinstance(plan, BandPlan)
            },
            frozenset(prepared.found.shown.used),
            {plan.id: plan for plan in prepared.lanes if isinstance(plan, BinsPlan)},
        )
        if not self._keep(figure_id, holding):
            return {"status": "superseded", **echo}
        return picture

    def read(self, request: Mapping[str, Any]) -> dict[str, Any]:
        figure_id, picture_id = str(request["figureId"]), str(request["pictureId"])
        echo = {"figureId": figure_id, "pictureId": picture_id, "requestNumber": int(request["requestNumber"])}
        with self._lock:
            holding = self._holdings.get(figure_id)
            if holding is None or holding.picture_id != picture_id:
                reason = (
                    "the Figure was released"
                    if figure_id in self._released
                    else "its holding was let go over the budget"
                    if figure_id in self._evicted
                    else "nothing is held for the Figure"
                    if holding is None
                    else "the picture held is another (a newer draw)"
                )
                log_no_picture(reason, figure=figure_id, picture=picture_id)
                return {"status": "no-picture", **echo}
            self._holdings.move_to_end(figure_id)
        image = holding.images.get(self._lane_of(request, holding))
        if image is not None:
            return {**echo, **self._read_image(request, image, holding)}
        ask, lane_id = self._ask(request, holding)
        counted = holding.bins.get(lane_id)
        if counted is not None:
            return {**echo, **self._read_bins(request, ask, counted, holding)}
        if not self._names_a_point_here(request, ask, lane_id, holding):
            return {"status": "no-point", **echo}
        band = holding.bands.get(lane_id)
        if band is not None:
            signals = self._signals(band)
            if signals is None:
                log_no_picture("a time signal's answer is no longer kept", figure=figure_id, picture=picture_id)
                return {"status": "no-picture", **echo}
            got = pick_sample(signals, ask, band.range.x, band.range.y)
        else:
            lines, confirmed, log = holding.lanes[lane_id]
            got = pick(lines, ask, confirmed.x, confirmed.y, log)
        return {**echo, **self._read_json(got, lane_id, holding)}

    @staticmethod
    def _read_bins(request: Mapping[str, Any], ask: Ask, plan: BinsPlan, holding: _Holding) -> dict[str, Any]:
        """A read of a bins lane (計算エ, the lines' own ``pick`` over its bars, rows and role lines). A row's
        point is named by its row's key (rows of one value are told apart by it): a step is from that row, a
        name is that row wherever it now is. A pointer's read of no point says the bin under the pointer
        (``bin``), which a click there picks."""
        lines, confirmed, log = holding.lanes[plan.id]
        if not isinstance(ask, PointerAsk):
            asked = cast(Mapping[str, Any], request.get("step") if isinstance(ask, StepAsk) else request.get("name"))
            if ask.line not in (line.id for line in lines):
                return {"status": "no-point", "lane": plan.id}
            if ask.line == plan.rows:
                if asked.get("key") not in plan.keys:
                    return {"status": "no-point", "lane": plan.id}
                index = plan.keys.index(asked["key"])
                if isinstance(ask, StepAsk):
                    ask = StepAsk(ask.line, index, ask.steps)
                elif not (min(confirmed.x) <= float(plan.values[index]) <= max(confirmed.x)):
                    # The row named is off the lane's range now (a zoom): not read, as a pointer would not read it.
                    return {"status": "outside", "lane": plan.id}
                else:
                    # The row named: its own point, wherever it now is among the rows.
                    return {
                        "status": "point",
                        "lane": plan.id,
                        "line": plan.rows,
                        "version": holding.versions[plan.rows],
                        "point": {
                            "index": index,
                            "x": float(plan.values[index]),
                            "value": float(next(line for line in lines if line.id == plan.rows).values[index]),
                            "key": plan.keys[index],
                        },
                    }
            elif asked.get("key") != holding.keys.get(ask.line):
                return {"status": "no-point", "lane": plan.id}
            if isinstance(ask, StepAsk) and (
                asked.get("version") != holding.versions.get(ask.line)
                or request.get("dataId") != holding.data_id
                or request.get("generation") != holding.generation
            ):
                return {"status": "no-point", "lane": plan.id}
        got = pick(lines, ask, confirmed.x, confirmed.y, log)
        out = FigureService._read_json(got, plan.id, holding)
        if got.point is not None and got.point.line == plan.rows:
            out["point"]["key"] = plan.keys[got.point.index]
        if got.point is None and isinstance(ask, PointerAsk):
            under = bin_under(plan.edges, ask.x)
            if under is not None:
                out["bin"] = {"index": under, "low": float(plan.edges[under]), "high": float(plan.edges[under + 1])}
        return out

    def _signals(self, band: _Band) -> Sequence[PickSignal] | None:
        """A held band lane's signals, looked up by key again (a Figure holds none of their samples); None when one
        is no longer kept, or is another answer than the picture was drawn of."""
        signals: list[PickSignal] = []
        for line, key, version in band.lines:
            if key is None:
                made = band.made[line]
                signals.append(PickSignal(line, made.start, made.rate, made.values))
                continue
            answer = self._source.answer(key)
            if not isinstance(answer, SignalAnswer) or answer.version != version:
                return None
            signals.append(PickSignal(line, answer.start, answer.rate, answer.values))
        return signals

    @staticmethod
    def _lines_of(holding: _Holding, lane_id: str) -> tuple[str, ...] | None:
        """The ids of the lines a held lane of lines or band holds (None: no such lane)."""
        band = holding.bands.get(lane_id)
        if band is not None:
            return tuple(line for line, _, _ in band.lines)
        held = holding.lanes.get(lane_id)
        return tuple(line.id for line in held[0]) if held is not None else None

    @staticmethod
    def _lane_of(request: Mapping[str, Any], holding: _Holding) -> str:
        """The lane a read names (a name without its lane: the image lane holding its line, if one does)."""
        asked = request.get("pointer") or request.get("step") or request.get("name") or {}
        lane = asked.get("lane")
        if lane is None:
            lane = next((plan.id for plan in holding.images.values() if plan.line == asked.get("line")), "")
        return str(lane)

    @staticmethod
    def _read_image(request: Mapping[str, Any], plan: ImagePlan, holding: _Holding) -> dict[str, Any]:
        """A read of an image lane (計算エ, pick_cell): by the pointer's place, a step from a cell, or a cell's name.
        A step and a name are of this picture's recording (and a step of this very answer), as a line's are."""
        pointer, step, name = request.get("pointer"), request.get("step"), request.get("name")
        if sum(value is not None for value in (pointer, step, name)) != 1:
            raise FigureRequestError("a read asks by exactly one of pointer, step or name")
        ask: CellAsk
        if pointer is not None:
            ask = CellPointerAsk(float(pointer["x"]), float(pointer["y"]))
        else:
            asked = cast(Mapping[str, Any], step if step is not None else name)
            if asked.get("line") != plan.line or asked.get("key") != plan.key:
                return {"status": "no-point", "lane": plan.id}
            if step is not None:
                if (
                    asked.get("version") != holding.versions.get(plan.line)
                    or request.get("dataId") != holding.data_id
                    or request.get("generation") != holding.generation
                ):
                    return {"status": "no-point", "lane": plan.id}
                columns, rows = int(step.get("steps", 0)), int(step.get("rows", 0))
                if columns == 0 and rows == 0:
                    raise FigureRequestError("step: expected a signed count of cells across (steps) or up (rows)")
                ask = CellStepAsk(int(step["index"]), int(step["row"]), columns, rows)
            else:
                ask = CellNameAsk(float(asked["x"]), float(asked["y"]))
        answer = plan.answer
        got: CellPick = pick_cell(
            answer.xs, answer.ys, answer.values, ask, plan.range.x, plan.range.y, answer.y_log, answer.y_positive
        )
        if got.cell is None:
            return {"status": got.status, "lane": plan.id}
        cell = got.cell
        return {
            "status": "point",
            "lane": plan.id,
            "line": plan.line,
            **({"role": plan.role} if plan.role is not None else {}),
            "version": holding.versions[plan.line],
            "point": {
                "index": cell.column,
                "row": cell.row,
                "x": cell.x,
                "y": cell.y,
                "value": cell.value,
                **({"xStep": cell.x_step} if cell.x_step is not None else {}),
                **({"yStep": cell.y_step} if cell.y_step is not None else {}),
                "key": plan.key,
            },
        }

    @staticmethod
    def _ask(request: Mapping[str, Any], holding: _Holding) -> tuple[Ask, str]:
        pointer, step, name = request.get("pointer"), request.get("step"), request.get("name")
        if sum(value is not None for value in (pointer, step, name)) != 1:
            raise FigureRequestError("a read asks by exactly one of pointer, step or name")
        if pointer is not None:
            scale = pointer["scale"]
            ask: Ask = PointerAsk(float(pointer["x"]), float(pointer["y"]), float(scale[0]), float(scale[1]))
            return ask, str(pointer["lane"])
        if step is not None:
            steps = int(step["steps"])
            if steps == 0:
                raise FigureRequestError("step.steps: expected a signed count of points, never 0")
            return StepAsk(str(step["line"]), int(step["index"]), steps), str(step["lane"])
        asked = cast(Mapping[str, Any], name)
        line = str(asked["line"])
        lane = asked.get("lane")
        if lane is None:
            # A name without its lane: the lane holding the line (a headline's point, read by its line and place).
            lane = next(
                (
                    lane
                    for lane in (*holding.lanes, *holding.bands)
                    if line in (FigureService._lines_of(holding, lane) or ())
                ),
                "",
            )
        return NameAsk(line, float(asked["x"])), str(lane)

    @staticmethod
    def _names_a_point_here(request: Mapping[str, Any], ask: Ask, lane_id: str, holding: _Holding) -> bool:
        """Whether a read names a point of this picture: its lane holds the line, and a step's or a name's recording
        key is the line's here. A step is from a point of this very answer (its version, the data id and the
        generation it was read from); a name may be of the answer before (the point read again after a redraw)."""
        held = FigureService._lines_of(holding, lane_id)
        if held is None:
            return False
        if isinstance(ask, PointerAsk):
            return True
        if ask.line not in held:
            return False
        asked = cast(Mapping[str, Any], request.get("step") if isinstance(ask, StepAsk) else request.get("name"))
        if asked.get("key") != holding.keys.get(ask.line):
            return False
        if isinstance(ask, NameAsk):
            return True
        return (
            asked.get("version") == holding.versions.get(ask.line)
            and request.get("dataId") == holding.data_id
            and request.get("generation") == holding.generation
        )

    @staticmethod
    def _read_json(got: Pick, lane: str, holding: _Holding) -> dict[str, Any]:
        if got.point is None:
            return {"status": got.status, "lane": lane}

        def point(item: Any) -> dict[str, Any]:
            key = holding.keys.get(item.line)
            return {
                "index": item.index,
                "x": item.x,
                "value": item.value,
                **({"xStep": item.x_step} if item.x_step is not None else {}),
                **({"key": key} if key is not None else {}),
            }

        role = holding.roles.get(got.point.line)
        return {
            "status": "point",
            "lane": lane,
            "line": got.point.line,
            **({"role": role} if role is not None else {}),
            "version": holding.versions[got.point.line],
            "point": point(got.point),
            # The pointer is on the point (within the radius), not only over its place across: what a click on a
            # line itself acts on (a trigger's event left out).
            **({"near": True} if got.by == "near" else {}),
        }

    def export(self, request: Mapping[str, Any]) -> dict[str, Any]:
        number = request.get("requestNumber")
        echo = {"requestNumber": int(number)} if number is not None else {}
        if self._estimate(request["spec"]) > self._budget.limit:
            return {"status": "too-large", **echo}
        prepared = self._prepare(
            request["spec"], request.get("view"), request.get("selection"), request.get("selectionClosed")
        )
        if prepared.data_id != str(request["dataId"]):
            log_no_picture("the data id changed (an answer's version)", asked=request["dataId"], now=prepared.data_id)
            return {"status": "no-picture", "dataId": prepared.data_id, **echo}
        columns: list[dict[str, Any]] = []
        # Line lanes only: an image's table (its every cell), a time signal's (its every sample) and a
        # distribution's (the rows of the user's own table) are not written by this request yet.
        line_lanes = [plan for plan in prepared.lanes if isinstance(plan, LanePlan)]
        for plan in line_lanes:
            for line in plan.lines:
                columns.append(
                    {
                        "lane": plan.id,
                        "line": line.id,
                        **({"role": line.role} if line.role is not None else {}),
                        **({"key": line.key} if line.key is not None else {}),
                        "quantity": plan.quantity,
                        "xs": [float(x) for x in line.xs.tolist()],
                        "values": [float(v) if math.isfinite(v) else None for v in line.values.tolist()],
                    }
                )
        return {
            "status": "rows",
            "dataId": prepared.data_id,
            **echo,
            "axes": [
                {"lane": plan.id, **axis_json(plan, prepared.found.calibration_of(plan.id))} for plan in line_lanes
            ],
            "columns": columns,
            "headlines": [headline_json(lane, headline) for lane, headline in prepared.headlines.items()],
            "members": members_json(prepared.found),
        }

    def release(self, request: Mapping[str, Any]) -> dict[str, Any]:
        figure_id = str(request["figureId"])
        with self._lock:
            self._holdings.pop(figure_id, None)
            self._latest.pop(figure_id, None)
            self._released[figure_id] = None
            while len(self._released) > RELEASED_MEMORY:
                self._released.popitem(last=False)
        return {}

    def count(self, request: Mapping[str, Any]) -> dict[str, Any]:
        try:
            spec = parse_spec(request["spec"])
        except SpecError as error:
            raise FigureRequestError(str(error)) from error
        looked = {key: self._source.answer(key) for key in spec.keys_in_order()}
        return {"members": members_json(members(spec, looked))}
