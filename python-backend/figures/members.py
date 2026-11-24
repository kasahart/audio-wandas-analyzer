"""計算ア: what a figure shows and counts (載せるものを決めて数える). The one function is ``members``.

Of every key the spec names, from the state answers/ gave it, the version it was decided of and the answer's level
identity and axis, it decides two sets and counts them (第 1 節の第 2 の表 ア):

- ``shown`` (載せる集まり): the keys whose answer is usable and of the figure's level identity (one unit and reference
  per lane, 仕様 2). Only these are drawn; a recording of another reference is not drawn, and is counted with why;
- ``combined`` (中央値・Δ に使う集まり): of those, the ones on the figure's axis. A median and a Δ are taken of
  these only (仕様 2: the median of the matching ones).

The identity it matches against (合わせる先) is the compared recording's (the line declared with role ``compare1``,
else the first ``compare…``), never the first member's; with nothing compared, the most common identity of the
usable answers, a tie going to the one declared first (仕様 2). A compared recording whose answer can be had no more
(failed for good, too large, no such channel) is matched by its level as the spec declares it when an answer is of
it, else as with nothing compared among the recordings with a role; the median's channel count is then the most
common of that identity.

The reasons, in the order they are tried:

0. a key compared as a channel its file does not have (the spec's ``channel`` and ``channels``): ``no-channel``,
   whatever its state (no answer of it can be had);
1. a key whose level is known (its answer's, or the spec's ``level``) and is of another identity than a known target:
   ``other-reference``, whatever its state (a recording known to differ is said to differ while pending), but for a
   key failed or too large, which says that;
2. not usable: its state (``pending``, ``stale``, ``failed``, ``evicted``);
3. usable, but the service holds no answer under it: ``evicted``; holds another version of it: ``version``;
4. no target identity yet (the compared answer is pending, stale or evicted): ``no-identity``. A compared
   recording failed for good, too large or without the channel is matched as the paragraph above says;
5. of another identity: ``other-reference``;
6. (``combined`` only) of another channel count than the compared answer's (both said): ``other-channels``;
7. (``combined`` only) on another axis: ``other-axis``.

A lines lane on an axis of its own (the spec's ``"axis": "own"``: a gain above a phase above a coherence; a lane a
unit and reference) is matched apart: its target identity and axis are decided among its own keys by the same
rules, and its keys are counted in the same two sets. ``Members.target`` is then of the lanes on the figure's axis
(none when every lane is on its own), and ``Members.own`` says each such lane's.

A median, and the Δ of it, is drawn only once no recording of its group is ``pending``: of part of a group it is not
drawn (the comparison waits, as it does today); stale, failed and evicted recordings are left out and counted.

It never sees a drawn point (rule B), and computes nothing of the values.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Literal, cast

import numpy as np

from figures.answers import AnyAnswer, LevelIdentity
from figures.spec import FigureSpec, LaneSpec, LineSpec, keys_of

Reason = Literal[
    "pending",
    "stale",
    "failed",
    "evicted",
    "too-large",
    "version",
    "no-identity",
    "other-reference",
    "other-axis",
    "other-channels",
    "no-channel",
]


@dataclass(frozen=True)
class Excluded:
    key: str
    reason: Reason


@dataclass(frozen=True)
class MemberSet:
    """Keys used, in declared order, and keys left out with why."""

    used: tuple[str, ...]
    excluded: tuple[Excluded, ...]

    @property
    def n(self) -> int:
        return len(self.used)


@dataclass(frozen=True)
class LineMembers:
    """What one line of the spec is drawn of: whether it is drawn, the keys it is of, and the ones it left out."""

    line: str
    drawn: bool
    #: A key line: its key. A median: the base keys in ``combined``. A Δ: the compared key, then the base keys.
    used: tuple[str, ...]
    excluded: tuple[Excluded, ...]
    #: A Δ's compared key (None for the other lines).
    compare: str | None = None
    #: Its calibration word (校正の言葉): a key line's recording's, a median's "uncalibrated" when any recording it is
    #: of is not (仕様 2: a median of recordings mixed is written uncalibrated); None for a Δ or where nothing is said.
    calibration: Literal["calibrated", "uncalibrated", "unknown"] | None = None


Calibration = Literal["calibrated", "uncalibrated", "unknown"]


@dataclass(frozen=True)
class OwnAxis:
    """What a lane on an axis of its own is matched against, and its axis's calibration word."""

    target: LevelIdentity | None
    target_axis: str | None
    calibration: Calibration


@dataclass(frozen=True)
class Members:
    target: LevelIdentity | None
    target_axis: str | None
    shown: MemberSet
    combined: MemberSet
    lines: Mapping[str, LineMembers] = field(default_factory=dict)
    #: The level axis's calibration word (R4): "calibrated" when any level line drawn is, "uncalibrated" when none is
    #: and one says it is not, "unknown" otherwise. A line uncalibrated on an axis named calibrated says so itself
    #: (``LineMembers.calibration``).
    calibration: Calibration = "unknown"
    #: The lanes on an axis of their own, by lane id.
    own: Mapping[str, OwnAxis] = field(default_factory=dict)

    def calibration_of(self, lane: str) -> Calibration:
        """The calibration word of ``lane``'s value axis: its own, or the figure's."""
        return self.own[lane].calibration if lane in self.own else self.calibration


def _compared_key(lanes: Sequence[LaneSpec]) -> str | None:
    lines = [
        line
        for lane in lanes
        if lane.kind != "bins"
        for line in lane.lines
        if line.of == "key" and line.key is not None
    ]
    first = next((line for line in lines if line.role == "compare1"), None)
    first = first or next((line for line in lines if (line.role or "").startswith("compare")), None)
    return first.key if first is not None else None


def _held(spec: FigureSpec, key: str, found: Mapping[str, AnyAnswer | None]) -> AnyAnswer | None:
    """The answer of a usable key, held at the version the spec names; None otherwise."""
    entry = spec.keys[key]
    answer = found.get(key)
    if entry.state != "usable" or answer is None or answer.version != entry.version:
        return None
    return answer


def _cannot_be_had(spec: FigureSpec, key: str) -> bool:
    """Whether no answer of ``key`` is on its way: it failed for good (the screen declares a failure it asks again
    for as pending), its values are over what the backend keeps (too-large), or it is compared as a channel its file
    does not have. Pending, stale and evicted keys are asked again: the figure waits for them."""
    entry = spec.keys[key]
    no_channel = entry.channel is not None and entry.channels is not None and entry.channels < entry.channel
    return entry.state in ("failed", "too-large") or no_channel


def _most_common(values: Sequence[object]) -> object:
    counts: dict[object, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return max(counts, key=lambda value: counts[value])  # max keeps the first of equal counts


@dataclass(frozen=True)
class _Target:
    identity: LevelIdentity | None = None
    axis: str | None = None
    #: The channel count a median or Δ is taken of (None: not checked).
    channels: int | None = None


def _role_keys(lanes: tuple[LaneSpec, ...]) -> set[str]:
    """The keys of the lines with a role: the base's and the compared recordings'."""
    return {
        key
        for lane in lanes
        if lane.kind != "bins"
        for line in lane.lines
        if line.role is not None
        for key in ((line.key,) if line.key is not None else ()) + line.base
    }


def _target(spec: FigureSpec, found: Mapping[str, AnyAnswer | None], lanes: tuple[LaneSpec, ...]) -> _Target:
    compared = _compared_key(lanes)
    if compared is not None and not _cannot_be_had(spec, compared):
        answer = _held(spec, compared, found)
        return _Target(answer.identity, answer.axis, answer.channels) if answer is not None else _Target()
    held_by = {key: answer for key in keys_of(lanes) if (answer := _held(spec, key, found)) is not None}
    held = list(held_by.values())
    # The compared recording can be had no more (a region past its end, too large, no such channel): rather than
    # drawing nothing, the figure is matched against its level as the screen knows it (仕様 2: the compared
    # recording is the target) when an answer is of it, or else as one with nothing compared, of the recordings
    # with a role (the base and the compared ones) before any other line's.
    known = spec.keys[compared].level if compared is not None else None
    # The level the screen declares is its file's: of a step in another unit (a loudness in sone) none of the answers
    # is of it, so it is no target then.
    if known is not None and not any(answer.identity == known for answer in held):
        known = None
    if known is None:
        among = [answer for key, answer in held_by.items() if key in _role_keys(lanes)] if compared is not None else []
        # Nothing compared: the most common identity of the usable answers, a tie to the one declared first.
        pool = among or held
        if not pool:
            return _Target()
        known = cast(LevelIdentity, _most_common([answer.identity for answer in pool]))
    # Its axis and channel count of the recordings with a role first, as its identity (a line drawn behind them
    # does not decide what the base's median is of).
    roles_held = [answer for key, answer in held_by.items() if key in _role_keys(lanes)] if compared is not None else []
    alike = [answer for answer in roles_held if answer.identity == known] or [
        answer for answer in held if answer.identity == known
    ]
    if not alike:
        return _Target(known)
    # Its axis likewise among the answers of that identity; with a compared recording that cannot be had, the
    # channel count too (a median is of one count).
    axis = cast(str, _most_common([answer.axis for answer in alike]))
    counts = [answer.channels for answer in alike if answer.axis == axis and answer.channels is not None]
    channels = cast(int, _most_common(counts)) if compared is not None and counts else None
    return _Target(known, axis, channels)


def _shown_reason(
    spec: FigureSpec, key: str, found: Mapping[str, AnyAnswer | None], target: LevelIdentity | None
) -> Reason | None:
    entry = spec.keys[key]
    if entry.channel is not None and entry.channels is not None and entry.channels < entry.channel:
        return "no-channel"
    answer = found.get(key)
    known = answer.identity if entry.state == "usable" and answer is not None else entry.level
    # A recording that failed for good or is too large says so: its level is the file's as the screen knows it, which
    # need not be its step's (a loudness), and no answer of it is to come whatever its reference.
    if target is not None and known is not None and known != target and entry.state not in ("failed", "too-large"):
        return "other-reference"
    if entry.state != "usable":
        return cast(Reason, entry.state)
    if answer is None:
        return "evicted"
    if answer.version != entry.version:
        return "version"
    if target is None:
        return "no-identity"
    if answer.identity != target:
        return "other-reference"
    return None


def _line_members(
    line: LineSpec, reasons: Mapping[str, Reason | None], apart: Mapping[str, Reason | None]
) -> LineMembers:
    def combined_reason(key: str) -> Reason | None:
        reason = reasons[key]
        return reason if reason is not None else apart.get(key)

    if line.of == "key" and line.key is not None:
        reason = reasons[line.key]
        drawn = reason is None
        return LineMembers(line.id, drawn, (line.key,) if drawn else (), () if drawn else (Excluded(line.key, reason),))  # type: ignore[arg-type]
    used = tuple(key for key in line.base if combined_reason(key) is None)
    excluded = tuple(Excluded(key, combined_reason(key)) for key in line.base if combined_reason(key) is not None)  # type: ignore[arg-type]
    # A base recording still on its way: the median (and the Δ of it) waits for the whole group, never drawn of part of
    # it (the comparison's rule today: no median is asked until none is pending). The pending ones are counted as such;
    # stale, failed and evicted ones are left out, as every other reason.
    waiting = any(item.reason == "pending" for item in excluded)
    if line.of == "median" and len(line.base) == 1:
        # A base of one recording is that recording (1 本だけの基準には中央値を取らない): drawn as a recording's
        # line is, on whatever axis its answer is, as long as it is shown.
        (only,) = line.base
        reason = reasons[only]
        if reason is None:
            return LineMembers(line.id, True, (only,), ())
        return LineMembers(line.id, False, (), (Excluded(only, reason),))
    if line.of == "median":
        return LineMembers(line.id, bool(used) and not waiting, used, excluded)
    compare = line.key
    assert compare is not None
    compare_reason = combined_reason(compare)
    if compare_reason is not None:
        excluded = (Excluded(compare, compare_reason), *excluded)
    drawn = compare_reason is None and bool(used) and not waiting
    return LineMembers(line.id, drawn, ((compare, *used) if drawn else ()), excluded, compare=compare)


def _calibration_of(keys: tuple[str, ...], spec: FigureSpec) -> Literal["calibrated", "uncalibrated", "unknown"]:
    """What recordings ``keys`` say of their calibration together: uncalibrated when any is not, calibrated when all
    are, unknown otherwise (figureModel.ts medianInputOf's rule)."""
    said = [spec.keys[key].calibrated for key in keys]
    return "uncalibrated" if False in said else "calibrated" if said and all(said) else "unknown"


def _with_calibration(found: LineMembers, line: LineSpec, spec: FigureSpec) -> LineMembers:
    if line.of == "delta" or not found.drawn:
        return found
    return replace(found, calibration=_calibration_of(found.used, spec))


def _axis_word(lines: Sequence[LineMembers]) -> Calibration:
    said = [item.calibration for item in lines if item.drawn and item.calibration is not None]
    return "calibrated" if "calibrated" in said else "uncalibrated" if "uncalibrated" in said else "unknown"


def members(spec: FigureSpec, found: Mapping[str, AnyAnswer | None]) -> Members:
    """The figure's two sets, every line's members and the counts (計算ア). ``found``: the answers the service
    holds by key (None: none held). Only identities, axes, channel counts, versions and states are read, never
    values."""
    reasons: dict[str, Reason | None] = {}
    apart: dict[str, Reason | None] = {}
    lines: dict[str, LineMembers] = {}
    target: LevelIdentity | None = None
    target_axis: str | None = None
    calibration: Calibration = "unknown"
    own: dict[str, OwnAxis] = {}
    # The lanes on the figure's axis are matched together; a lane on an axis of its own, among its own keys.
    for lanes in spec.groups():
        matched = _target(spec, found, lanes)
        group_target, group_axis, target_channels = matched.identity, matched.axis, matched.channels
        keys = keys_of(lanes)
        reasons.update({key: _shown_reason(spec, key, found, group_target) for key in keys})

        def combined_reason(
            key: str, channels: int | None = target_channels, axis: str | None = group_axis
        ) -> Reason | None:
            """Why a key shown is not in a median or a Δ (None: it is): another channel count, then another axis."""
            answer = found.get(key)
            if answer is None:
                return "other-axis"
            if channels is not None and answer.channels is not None and answer.channels != channels:
                return "other-channels"
            return None if answer.axis == axis else "other-axis"

        apart.update({key: combined_reason(key) for key in keys if reasons[key] is None})
        made = {
            line.id: _with_calibration(_line_members(line, reasons, apart), line, spec)
            for lane in lanes
            if lane.kind != "bins"
            for line in lane.lines
        }
        lines.update(made)
        if lanes[0].own_axis:
            own[lanes[0].id] = OwnAxis(group_target, group_axis, _axis_word(list(made.values())))
        else:
            target, target_axis, calibration = group_target, group_axis, _axis_word(list(made.values()))
    keys = spec.keys_in_order()
    shown_used = tuple(key for key in keys if reasons[key] is None)
    shown = MemberSet(shown_used, tuple(Excluded(key, reasons[key]) for key in keys if reasons[key] is not None))  # type: ignore[arg-type]
    combined = MemberSet(
        tuple(key for key in shown_used if apart[key] is None),
        (*shown.excluded, *(Excluded(key, reason) for key in shown_used if (reason := apart[key]) is not None)),
    )
    # The lines in declared order, whatever group their lane is of.
    ordered = {line.id: lines[line.id] for lane in spec.lanes if lane.kind != "bins" for line in lane.lines}
    return Members(target, target_axis, shown, combined, ordered, calibration, own)


# --- A bins lane (a distribution): the rows shown, and the rows counted per bin -------------------------------------


@dataclass(frozen=True)
class Rows:
    """The rows a bins lane shows: those of its group with a number in the column, by value then by key (rows of one
    value keep one order whatever order the table gave them in), and how many of its group have none (counted, not
    drawn)."""

    keys: tuple[str, ...]
    values: np.ndarray
    blank: int


def rows_shown(rows: Sequence[str], column_rows: Sequence[str], column_values: np.ndarray) -> Rows:
    """Of a lane's ``rows``, the ones the column has a number for (計算ア: 載せる値を決める)."""
    at = {key: index for index, key in enumerate(column_rows)}
    values = np.asarray(column_values, dtype=np.float64)
    found = sorted((float(values[at[key]]), key) for key in rows if key in at and math.isfinite(float(values[at[key]])))
    return Rows(
        tuple(key for _, key in found),
        np.array([value for value, _ in found], dtype=np.float64),
        len(rows) - len(found),
    )


def rows_picked(values: np.ndarray, selection: tuple[float, float, bool]) -> np.ndarray:
    """Which values the selected range takes: from its low end up to, not including, its high end, as a bin takes
    its values (thinning.bin_of), so a picked bin takes exactly the rows its bar counts; a range that says it is
    closed (picked up to the top of the axis, as the last bin holds the top) takes the values on its high end too.
    The one rule of a selected range: the table that narrows to it applies the same (datasetTable.ts inValueRange)."""
    low, high, closed = selection
    values = np.asarray(values, dtype=np.float64)
    return (values >= low) & ((values < high) | (closed & (values <= high)))


def bin_counts(bins: np.ndarray, count: int, picked: np.ndarray | None) -> tuple[np.ndarray, np.ndarray | None]:
    """How many rows each of ``count`` bins holds (``bins``: each row's bin, 配置), and, with a range selected, how
    many of them it takes (計算ア: 棒ごとの本数)."""
    counts = np.bincount(bins, minlength=count)
    return counts, None if picked is None else np.bincount(bins[picked], minlength=count)
