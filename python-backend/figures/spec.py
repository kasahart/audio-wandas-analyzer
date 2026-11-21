"""The figure spec (図の宣言): data only, as the Figure sends it. Read here into frozen records; nothing is computed.

A spec lists lanes (段) and, in each, lines in their declared order. The declared order is the draw order (仕様 1)
and the order a tie of the pick goes by (第 5 節 エ). A line is of one of three things:

- ``{"key": k}``: one recording's answer;
- ``{"median": [k, ...]}``: the point-by-point median of the recordings' answers (layer 1);
- ``{"delta": {"compare": k, "base": [k, ...]}}``: compare − the base's median (layer 1).

``keys`` lists every key the spec names, each once, with the state answers/ decided for it and the version of the
answer it was decided of. ``level`` is the key's level identity when answers/ knows it before the answer is usable
(its track's input): a recording known to be of another reference is said so even while its answer is pending.
``channel`` is the channel the recording is compared as (1 is the first; none: its channels together) and
``channels`` how many channels its file has: a recording without the channel compared has no answer of it, and
the figure service says so (``no-channel``) from these two.

A ``lines`` lane may say ``"axis": "own"``: its lines are on a value axis of their own (段ごとの値の軸: a gain in
dB above a phase in degrees above a coherence; a lane a unit and reference). What its lines are matched against
(計算ア: one unit and reference, one axis) is then decided among its own keys, apart from the figure's other lanes,
and none of its keys is named by another lane. Every lane still shares the axis across.

A ``bins`` lane (a distribution, one lane per group) draws a column of the user's table: ``column`` is the
column's key (listed in ``keys`` as every answer's is: its values are handed once, by key and version, never
in the spec), ``rows`` the table rows of the lane's group (each counted once). Its ``lines`` are the rows
that hold a role (``{"key": row}``), each drawn as a line at its value; a figure of bins lanes has no other
kind of lane (they share the value axis).

A ``band`` or ``image`` lane may say ``"scaleWith": [k, ...]``: the answers of other figures' lanes its automatic
scale is shared with (the Tracks rows' linked scales: a row a figure). They are no line and no member of 計算ア;
each is listed in ``keys``. The figure service takes of them only those of the lane's own unit and reference.
The Tracks rows name each recording's extent (tracks_answers.py: the smallest signal or image with the recording's
least and most), so a recording counts whether its samples and levels are kept or not.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, cast

from figures.answers import KEY_STATES, KeyState, LevelIdentity

LineOf = Literal["key", "median", "delta"]
LaneKind = Literal["lines", "image", "band", "bins"]
LANE_KINDS: tuple[LaneKind, ...] = ("lines", "image", "band", "bins")


class SpecError(ValueError):
    """The spec is not one this service draws."""


@dataclass(frozen=True)
class KeyEntry:
    key: str
    state: KeyState
    version: str
    level: LevelIdentity | None = None
    #: Whether the recording is calibrated (None: not said). Calibrated and uncalibrated share an axis (仕様 2).
    calibrated: bool | None = None
    #: The channel it is compared as (1 is the first; None: its channels together), and its file's channel count.
    channel: int | None = None
    channels: int | None = None


@dataclass(frozen=True)
class LineSpec:
    id: str
    of: LineOf
    role: str | None
    #: The recording of a ``key`` line, the compared recording of a ``delta`` line.
    key: str | None = None
    #: The base recordings of a ``median`` or ``delta`` line, in declared order.
    base: tuple[str, ...] = ()


@dataclass(frozen=True)
class TriggerSpec:
    """The trigger a band lane's signal is taken by (the lane shows the recording as the trigger takes it): the key
    of the trigger step's events of this recording, the level it fires at, how long before its firing an event
    begins and how long it is (s), and the events the user left out. The figure service makes the lane's guide
    lines of it (目安の線): the level, each firing time, each stretch cut."""

    events: str
    threshold: float
    pre: float
    duration: float
    out: tuple[int, ...] = ()


@dataclass(frozen=True)
class LaneSpec:
    id: str
    #: What the lane draws of its lines' answers: ``lines`` (a line each), ``image`` (one recording's image: a
    #: spectrogram), ``band`` (each recording's time signal as its lowest and highest samples), ``bins`` (a
    #: table column's values of the lane's rows, counted per bin).
    kind: LaneKind
    #: A bins lane's: the rows holding a role (a line of a row's key each); it may have none.
    lines: tuple[LineSpec, ...]
    #: A bins lane's column (its key) and the table rows of its group, in the table's order, each once.
    column: str | None = None
    rows: tuple[str, ...] = ()
    #: A band lane's: the trigger its signal is taken by (its guide lines).
    trigger: TriggerSpec | None = None
    #: A lines lane on a value axis of its own (``"axis": "own"``): matched among its own keys.
    own_axis: bool = False
    #: A band or image lane's: the keys of other figures' answers its automatic scale is shared with.
    scale_with: tuple[str, ...] = ()


def keys_of(lanes: tuple[LaneSpec, ...]) -> tuple[str, ...]:
    """Every key of an answer ``lanes`` name (the lines' recordings, a bins lane's column), in the order they are
    first declared. A bins lane's lines name table rows, not answers."""
    seen: dict[str, None] = {}
    for lane in lanes:
        if lane.column is not None:
            seen.setdefault(lane.column, None)
            continue
        for line in lane.lines:
            for key in (*((line.key,) if line.key is not None and line.of != "delta" else ()), *line.base):
                seen.setdefault(key, None)
            if line.of == "delta" and line.key is not None:
                seen.setdefault(line.key, None)
    return tuple(seen)


@dataclass(frozen=True)
class FigureSpec:
    lanes: tuple[LaneSpec, ...]
    keys: Mapping[str, KeyEntry]

    def lane(self, lane_id: str) -> LaneSpec | None:
        return next((lane for lane in self.lanes if lane.id == lane_id), None)

    def line(self, line_id: str) -> tuple[LaneSpec, LineSpec] | None:
        for lane in self.lanes:
            for line in lane.lines:
                if line.id == line_id:
                    return lane, line
        return None

    def keys_in_order(self) -> tuple[str, ...]:
        """Every key of an answer the spec names, in the order they are first declared (keys_of)."""
        return keys_of(self.lanes)

    def groups(self) -> tuple[tuple[LaneSpec, ...], ...]:
        """The lanes matched together (計算ア): the lanes on the figure's axis as one group, then each lane on an
        axis of its own."""
        shared = tuple(lane for lane in self.lanes if not lane.own_axis)
        return (*((shared,) if shared else ()), *((lane,) for lane in self.lanes if lane.own_axis))

    def guide_keys(self) -> tuple[str, ...]:
        """The keys of the answers guide lines are made of (a trigger's events): no line, no member of 計算ア."""
        return tuple(dict.fromkeys(lane.trigger.events for lane in self.lanes if lane.trigger is not None))

    def scale_keys(self) -> tuple[str, ...]:
        """The keys of the answers the lanes' automatic scales are shared with: no line, no member of 計算ア."""
        return tuple(dict.fromkeys(key for lane in self.lanes for key in lane.scale_with))


def _number(value: object, where: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise SpecError(f"{where}: expected a number")
    return float(value)


def _trigger(raw: object, where: str) -> TriggerSpec:
    if not isinstance(raw, dict):
        raise SpecError(f"{where}: expected {{events, threshold, pre, duration, out}}")
    given = cast(dict[str, object], raw)
    out = given.get("out", [])
    if not isinstance(out, list) or any(isinstance(item, bool) or not isinstance(item, int) for item in out):
        raise SpecError(f"{where}.out: expected the numbers of the events left out")
    return TriggerSpec(
        _text(given.get("events"), f"{where}.events"),
        _number(given.get("threshold"), f"{where}.threshold"),
        _number(given.get("pre"), f"{where}.pre"),
        _number(given.get("duration"), f"{where}.duration"),
        tuple(cast(list[int], out)),
    )


def _text(value: object, where: str) -> str:
    if not isinstance(value, str) or not value:
        raise SpecError(f"{where}: expected a non-empty string")
    return value


def _keys(value: object, where: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise SpecError(f"{where}: expected a non-empty list of keys")
    return tuple(_text(item, f"{where}[]") for item in value)


def _level(value: object, where: str) -> LevelIdentity | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise SpecError(f"{where}: expected {{unit, ref, label}}")
    raw = cast(dict[str, object], value)
    ref = raw.get("ref")
    if not isinstance(ref, (int, float)) or isinstance(ref, bool) or not math.isfinite(ref):
        raise SpecError(f"{where}.ref: expected a number")
    return (str(raw.get("unit", "")), float(ref), str(raw.get("label", "")))


def _line(raw: object, where: str, band: bool = False) -> LineSpec:
    if not isinstance(raw, dict):
        raise SpecError(f"{where}: expected an object")
    line = cast(dict[str, object], raw)
    line_id = _text(line.get("id"), f"{where}.id")
    role = line.get("role")
    if role is not None and not isinstance(role, str):
        raise SpecError(f"{where}.role: expected a string")
    of = line.get("of")
    if not isinstance(of, dict) or len(of) != 1:
        raise SpecError(f"{where}.of: expected one of key, median, delta")
    ((kind, what),) = cast(dict[str, object], of).items()
    if role == "base" and kind != "median" and not band:
        # The base is declared as its set of recordings: whether its line is one recording or their median is 計算ア's
        # (members.py), never the screen's. (A band lane draws each base recording's own signal, an image lane one
        # recording's image: no median is taken of time signals or of images.)
        raise SpecError(f"{where}.of: the base is declared as its recordings' set (median), not {kind!r}")
    if kind == "key":
        return LineSpec(line_id, "key", role, key=_text(what, f"{where}.of.key"))
    if kind == "median":
        return LineSpec(line_id, "median", role, base=_keys(what, f"{where}.of.median"))
    if kind == "delta":
        if not isinstance(what, dict):
            raise SpecError(f"{where}.of.delta: expected {{compare, base}}")
        delta = cast(dict[str, object], what)
        return LineSpec(
            line_id,
            "delta",
            role,
            key=_text(delta.get("compare"), f"{where}.of.delta.compare"),
            base=_keys(delta.get("base"), f"{where}.of.delta.base"),
        )
    raise SpecError(f"{where}.of: unknown line kind {kind!r}")


def parse_spec(raw: object) -> FigureSpec:
    """The spec of ``raw`` (the request's JSON), checked for what this service needs; SpecError otherwise."""
    if not isinstance(raw, dict):
        raise SpecError("spec: expected an object")
    spec = cast(dict[str, object], raw)
    lanes_raw = spec.get("lanes")
    if not isinstance(lanes_raw, list) or not lanes_raw:
        raise SpecError("spec.lanes: expected a non-empty list")
    lanes: list[LaneSpec] = []
    line_ids: set[str] = set()
    for index, lane_raw in enumerate(lanes_raw):
        where = f"spec.lanes[{index}]"
        if not isinstance(lane_raw, dict):
            raise SpecError(f"{where}: expected an object")
        lane = cast(dict[str, object], lane_raw)
        kind = lane.get("kind")
        if kind not in LANE_KINDS:
            raise SpecError(f"{where}.kind: expected one of {', '.join(LANE_KINDS)}")
        lines_raw = lane.get("lines")
        if not isinstance(lines_raw, list) or not (lines_raw or kind == "bins"):
            raise SpecError(f"{where}.lines: expected a non-empty list")
        own = kind in ("band", "bins", "image")
        lines = tuple(_line(item, f"{where}.lines[{at}]", own) for at, item in enumerate(lines_raw))
        for line in lines:
            if line.id in line_ids:
                raise SpecError(f"{where}: line id {line.id!r} is declared twice")
            line_ids.add(line.id)
        if kind == "image" and (len(lines) != 1 or lines[0].of != "key"):
            raise SpecError(f"{where}.lines: an image lane draws one recording's image (one line of a key)")
        if kind == "band" and any(line.of == "delta" and len(line.base) != 1 for line in lines):
            # A Δ is of two recordings, sample by sample. (A median is taken only of a trigger's events' means,
            # which the service checks of the answers: no median is taken of recordings' sounds.)
            raise SpecError(
                f"{where}.lines: a band lane draws recordings' own signals (lines of a key each), or the Δ of two"
            )
        column, rows = None, ()
        if kind == "bins":
            if any(line.of != "key" for line in lines):
                raise SpecError(f"{where}.lines: a bins lane's lines are rows holding a role (a key each)")
            column = _text(lane.get("column"), f"{where}.column")
            rows_raw = lane.get("rows")
            if not isinstance(rows_raw, list):
                raise SpecError(f"{where}.rows: expected the list of the group's rows")
            rows = tuple(dict.fromkeys(_text(item, f"{where}.rows[]") for item in rows_raw))
        trigger = None
        if lane.get("trigger") is not None:
            if kind != "band":
                raise SpecError(f"{where}.trigger: only a band lane shows a recording as a trigger takes it")
            trigger = _trigger(lane.get("trigger"), f"{where}.trigger")
        axis = lane.get("axis")
        if axis is not None and (axis != "own" or kind != "lines"):
            raise SpecError(f'{where}.axis: only a lines lane is on an axis of its own ("own")')
        scale_raw = lane.get("scaleWith")
        if scale_raw is not None and (not isinstance(scale_raw, list) or kind not in ("band", "image")):
            raise SpecError(f"{where}.scaleWith: only a band or an image lane shares its scale (a list of keys)")
        scale_with = tuple(
            dict.fromkeys(_text(item, f"{where}.scaleWith[]") for item in cast(list[object], scale_raw or []))
        )
        lanes.append(
            LaneSpec(
                _text(lane.get("id"), f"{where}.id"),
                cast(LaneKind, kind),
                lines,
                column,
                rows,
                trigger,
                axis == "own",
                scale_with,
            )
        )
    if any(lane.kind == "bins" for lane in lanes) and any(lane.kind != "bins" for lane in lanes):
        raise SpecError("spec.lanes: a figure of bins lanes has no other kind of lane (one value axis)")
    if len({lane.id for lane in lanes}) != len(lanes):
        raise SpecError("spec.lanes: a lane id is declared twice")
    keys_raw = spec.get("keys")
    if not isinstance(keys_raw, list):
        raise SpecError("spec.keys: expected a list of every key's state and version")
    keys: dict[str, KeyEntry] = {}
    for index, entry_raw in enumerate(keys_raw):
        where = f"spec.keys[{index}]"
        if not isinstance(entry_raw, dict):
            raise SpecError(f"{where}: expected {{key, state, version}}")
        key = _text(cast(dict[str, object], entry_raw).get("key"), f"{where}.key")
        if key in keys:
            raise SpecError(f"{where}: key {key!r} is listed twice")
        entry = cast(dict[str, object], entry_raw)
        state = entry.get("state")
        if state not in KEY_STATES:
            raise SpecError(f"{where}.state: expected one of {', '.join(KEY_STATES)}")
        calibrated = entry.get("calibrated")
        if calibrated is not None and not isinstance(calibrated, bool):
            raise SpecError(f"{where}.calibrated: expected a boolean")
        counts: dict[str, int | None] = {}
        for name in ("channel", "channels"):
            value = entry.get(name)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 1):
                raise SpecError(f"{where}.{name}: expected a whole number from 1")
            counts[name] = cast(int | None, value)
        keys[key] = KeyEntry(
            key,
            cast(KeyState, state),
            _text(entry.get("version"), f"{where}.version"),
            _level(entry.get("level"), f"{where}.level"),
            calibrated,
            counts["channel"],
            counts["channels"],
        )
    figure = FigureSpec(tuple(lanes), keys)
    for lane in figure.lanes:
        others = tuple(other for other in figure.lanes if other is not lane)
        shared = set(keys_of((lane,))) & set(keys_of(others)) if lane.own_axis else set()
        if shared:
            raise SpecError(
                f"spec.lanes: lane {lane.id!r} is on an axis of its own, but {sorted(shared)} is named elsewhere"
            )
    named = (*figure.keys_in_order(), *figure.guide_keys(), *figure.scale_keys())
    missing = [key for key in named if key not in keys]
    if missing:
        raise SpecError(f"spec.keys: no state and version for {missing}")
    return figure


def canonical(raw: object) -> str:
    """The spec as one string (keys sorted), for the data id: two equal specs give the same string."""
    return json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
