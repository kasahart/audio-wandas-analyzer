"""``scan``: one step of a Recipe over one file, as the comparison asks for it.

The host scans files one at a time. The Recipe is one chain: its steps up to its time slice run as one plan
with the slice set to the region the user picked (the Recipe's own slice bounds never apply), and each
step after it runs on the frame the step before gave, so a step that fails is named (``failedStep``).
``stage`` names the step whose Frame the result describes (stage_view.py) and whose full values are kept for
the figure service (stage_combine.STORE). Nothing else is measured of the file.

A file that cannot be scanned is a result, not an error: ``{"ok": false, "reason": "<one line>"}`` lets
the screen keep a ✕ row while the scan moves on to the next file. (``error`` would read as the error
envelope every host checks replies for.)
"""

from __future__ import annotations

import contextvars
import functools
import hashlib
import json
import math
import re
import sys
import threading
import time
import traceback
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any, NotRequired, TypedDict

import dask.array as da
import dask.config
import dask.local
import dask.threaded
import numpy as np
import soundfile as sf
import wandas as wd
from wandas.core.base_frame import BaseFrame
from wandas.frames.pairwise import PairwiseFrame
from wandas.frames.segments import FrameSegments
from wandas.pipeline import RecipeExecutionError, RecipePlan, default_recipe_registry
from wandas.pipeline.model import RecipeNode
from wandas.processing.semantic import thaw_params

from frames import analysis_spec as spec
from frames.level_identity import level_identity
from frames.stage_view import StageView, channel_unit, describe, read_frame
from services.analyzer import has_full_scale
from services.backend_errors import InputError, lasting_failure
from services.calibration_profile import CalibrationStatus, resolve_calibration_profile
from services.stage_combine import STORE, stage_data

if TYPE_CHECKING:
    from services.analysis_engine import AnalysisEngine, CachedAnalysis

TIME_SLICE_OPERATION = "wandas.frame.time_slice"


class ScanReference(TypedDict):
    """Another recording a cross-channel step pairs each scanned one with (the comparison's base slot)."""

    #: The cross-channel step (node id) whose input is the pair: the reference's channel, then the scanned one's.
    step: str
    #: The reference's own Recipe (its channel row's get_channel), run like the scanned one's up to that step.
    recipe: Mapping[str, object]
    #: The reference recording's own calibration (None: uncalibrated).
    calibration: NotRequired[object]


class ScanRegionEcho(TypedDict):
    start: float
    end: float


class ScanInput(TypedDict):
    id: str
    fs: int
    channels: list[int]
    durationS: float
    unit: str
    ref: float
    #: wandas' name for the channels' level reference: "dBFS", "dB re 1 input unit" (a CSV), "dB SPL re 20 µPa"…
    levelReferenceLabel: str
    calibrationStatus: CalibrationStatus
    fullScale: bool
    #: Each channel's own status (in ``channels``' order): a channel taken alone names its own calibration.
    channelCalibration: NotRequired[list[CalibrationStatus]]
    #: The region the scan was asked for (seconds, exact as sent; null = the whole file), for display and for the
    #: webview to tell requests apart.
    region: NotRequired[ScanRegionEcho | None]
    #: Scanned against the base slot's recording: the status of the base channel the pair is made with.
    baseCalibrationStatus: NotRequired[CalibrationStatus]


class ScanResult(TypedDict):
    ok: bool
    reason: NotRequired[str]
    input: NotRequired[ScanInput]
    specVersion: NotRequired[int]
    wandasVersion: NotRequired[str]
    elapsedMs: NotRequired[float]
    stage: NotRequired[StageView]
    #: With ``stage``: the step's full-resolution values are over the store's budget, so they are not kept (no
    #: ``data`` key) and nothing is combined of them; the comparison says the base is too large.
    stageDataTooLarge: NotRequired[bool]
    failedStep: NotRequired[str]
    #: With ``ok: false``: the request does not fit this file (its region, channels or Recipe), so asking again
    #: for the same file version, calibration, Recipe and region gives the same answer. Other failures may pass.
    lasting: NotRequired[bool]


class StepFailure(InputError):
    """A step of the Recipe failed on this file: the result names it, so the step bar can leave it out."""

    def __init__(self, step: str, error: BaseException) -> None:
        super().__init__(wandas_cause(error))
        self.step = step


def wandas_cause(error: BaseException) -> str:
    """The line that says why: wandas' "Recipe operation failed" errors give it as "Cause: …"."""
    text = str(error).strip()
    for line in text.splitlines():
        if line.strip().startswith("Cause:"):
            return line.strip()[len("Cause:") :].strip()
    return text.splitlines()[0] if text else type(error).__name__


WELCH_OPERATION = "wandas.audio.welch"
# The input as the comparison draws it: the files' signals as they come in, before any step.
INPUT_STAGE = "node-input"
#: The step the webview puts at a chain's head to pick the channel a file is compared as (channelSelection.ts).
CHANNEL_NODE = "node-channel"


def _decoded_nodes(recipe: Mapping[str, object]) -> list[tuple[RecipeNode, dict[str, Any]]]:
    """The Recipe's nodes, each with its parameters as wandas decodes them."""
    return [(node, thaw_params(node.params)) for node in RecipePlan.from_dict(dict(recipe)).nodes]


def welch_params(recipe: Mapping[str, object]) -> dict[str, object]:
    """The FFT length and window of the Recipe's average-spectrum step (without one, the analysis spec's): the
    shortest region a scan takes is one FFT of it, and a long region's Welch step is computed in parts of it."""
    params: dict[str, object] = {"n_fft": spec.WELCH_N_FFT, "window": "hann"}
    for node, values in _decoded_nodes(recipe):
        if node.operation == WELCH_OPERATION:
            params.update({name: values[name] for name in ("n_fft", "window") if name in values})
    return params


def _python_float(value: float) -> float:
    """A float as a schema-3 Recipe (wandas 0.10) writes it: a plain JSON number."""
    return float(value)


def _single_node_plan(node: Mapping[str, object], input_name: str) -> RecipePlan:
    """One Recipe node as a plan of its own, applied to the frame the shared steps produced."""
    return RecipePlan.from_dict(
        {
            "schema": "wandas.recipe",
            # The node comes from RecipePlan.to_dict, which writes schema 3 (plain floats).
            "version": 3,
            "inputs": [{"id": "input-0", "name": input_name, "kind": "frame"}],
            "nodes": [{**node, "id": "node-0", "inputs": ["input-0"]}],
            "output": "node-0",
        }
    )


@functools.cache
def _gives_segments(operation: str, version: int) -> bool:
    returns = next(
        (
            described.returns
            for described in default_recipe_registry().describe()
            if described.operation_id == operation and described.version == version
        ),
        None,
    )
    return isinstance(returns, type) and issubclass(returns, FrameSegments)


def apply_step(plan: RecipePlan, current: object) -> Any:
    """A one-node plan (``_single_node_plan``) applied to the Frame before it, or to the segments a trigger gave.

    A Recipe's input and output are Frames, and a trigger's segments only sit between its nodes: a step that gives
    them, or takes them, is invoked as the Recipe would invoke it, through wandas' registry. A Frame is cached
    (every later step reads it); segments stay lazy slices of the Frame they were cut from.
    """
    [node] = plan.nodes
    if isinstance(current, BaseFrame) and not _gives_segments(node.operation, node.version):
        return plan.apply({plan.inputs[0].name: current}).cache()
    operation = default_recipe_registry().require(node.operation, node.version)
    result = operation.invoke((current,), node.params)
    return result.cache() if isinstance(result, BaseFrame) else result


class ScanPlans(TypedDict):
    """The Recipe as the scan runs it: the steps up to the region and each step after it."""

    region: RecipePlan
    #: The chain's steps after the time slice, in order, each a plan over the frame the step before gave.
    steps: list[tuple[str, RecipePlan]]
    #: The steps before the slice (they run over the whole file), by id.
    upstream: list[str]


def _upstream(nodes: Sequence[Mapping[str, object]], target: str) -> set[str]:
    """The ids of `target` and every node it is computed from."""
    by_id = {str(node["id"]): node for node in nodes}
    keep: set[str] = set()
    pending = [target]
    while pending:
        node_id = pending.pop()
        if node_id in by_id and node_id not in keep:
            keep.add(node_id)
            pending.extend(by_id[node_id]["inputs"])  # type: ignore[arg-type]
    return keep


def _chain(full: Mapping[str, object]) -> list[Mapping[str, object]]:
    """The nodes from the input to the output, following each node's first input: the step bar's chain."""
    nodes: list[Mapping[str, object]] = full["nodes"]  # type: ignore[assignment]
    by_id = {node["id"]: node for node in nodes}
    chain: list[Mapping[str, object]] = []
    node_id = full["output"]
    while node_id in by_id:
        chain.insert(0, by_id[node_id])
        node_id = by_id[node_id]["inputs"][0]  # type: ignore[index]
    return chain


def _upstream_step(recipe: Mapping[str, object], stage: str, input_name: str, picked: object) -> Any:
    """A step before the slice over the whole file. A trigger there gives segments, which a Recipe cannot output:
    up to the first step giving segments the chain runs as a plan, and from it each step as the scan runs a step
    after the slice (apply_step), so the trigger and what takes its segments (select, drop, average) are drawn."""
    full = RecipePlan.from_dict(dict(recipe)).to_dict()
    by_id = {node["id"]: node for node in full["nodes"]}
    path: list[Mapping[str, object]] = []
    node_id: object = stage
    while node_id in by_id:
        path.insert(0, by_id[node_id])
        node_id = by_id[node_id]["inputs"][0]  # type: ignore[index]
    first = next(
        (index for index, node in enumerate(path) if _gives_segments(str(node["operation"]), int(node["version"]))),  # type: ignore[call-overload]
        None,
    )
    if first is None:
        return upstream_plan(recipe, stage).apply({input_name: picked})
    before = path[first]["inputs"][0]  # type: ignore[index]
    current: Any = (
        picked if before not in by_id else upstream_plan(recipe, str(before)).apply({input_name: picked}).cache()
    )
    for node in path[first:]:
        current = apply_step(_single_node_plan(node, input_name), current)
    return current


def upstream_plan(recipe: Mapping[str, object], target: str) -> RecipePlan:
    """The Recipe up to one of its steps, which is then its output: that step's Frame over the whole file."""
    full = RecipePlan.from_dict(dict(recipe)).to_dict()
    keep = _upstream(full["nodes"], target)
    return RecipePlan.from_dict(
        {**full, "nodes": [node for node in full["nodes"] if node["id"] in keep], "output": target}
    )


def scan_plans(recipe: Mapping[str, object], start: float, end: float, sampling_rate: float) -> ScanPlans:
    """The Recipe's steps up to its time slice, with the slice set to the region, and each step after it as a plan
    of its own over the frame the step before gave. A Recipe without a slice must end in a time signal and gets a
    slice after its output."""
    full = RecipePlan.from_dict(dict(recipe)).to_dict()
    if len([item for item in full["inputs"] if item["kind"] == "frame"]) != 1 or len(full["inputs"]) != 1:
        raise InputError("A scan Recipe needs exactly one frame input")
    slices = [node for node in full["nodes"] if node["operation"] == TIME_SLICE_OPERATION]
    if len(slices) > 1:
        raise InputError("A scan Recipe may slice its input only once")
    region_params = {"$type": "map", "entries": [["end", _python_float(end)], ["start", _python_float(start)]]}
    by_id = {node["id"]: node for node in full["nodes"]}
    chain = _chain(full)
    after: list[Mapping[str, object]] = []
    if slices:
        target = slices[0]["id"]
        keep = _upstream(full["nodes"], target)
        ids = [node["id"] for node in chain]
        after = chain[ids.index(target) + 1 :] if target in ids else []
        nodes = [
            {**node, "params": region_params} if node["id"] == target else node
            for node in full["nodes"]
            if node["id"] in keep
        ]
    else:
        target = "node-region"
        if by_id.get(full["output"], {}).get("operation") == WELCH_OPERATION:
            raise InputError("The Recipe must give a time signal before its slice, not a SpectralFrame")
        nodes = list(full["nodes"])
        tail = nodes[-1]["id"] if nodes else full["inputs"][0]["id"]
        nodes.append(
            {"id": target, "operation": TIME_SLICE_OPERATION, "version": 2, "inputs": [tail], "params": region_params}
        )
    region = RecipePlan.from_dict({**full, "nodes": nodes, "output": target})
    return {
        "region": region,
        "steps": [(str(node["id"]), _single_node_plan(node, "region")) for node in after],
        "upstream": [
            str(node["id"]) for node in chain if node["id"] in _upstream(nodes, target) and node["id"] != target
        ],
    }


# A Welch step over a long region runs over parts of this many segments: scipy windows and transforms every
# segment at once, so a 10-minute 48 kHz stereo file would hold about 3.5 GB; a part holds about 130 MB.
WELCH_PART_SEGMENTS = 4096


def _welch_shape(params: Mapping[str, object]) -> tuple[int, int]:
    """The segment length and hop of a Welch step, as wandas defaults them (win_length = n_fft, hop = win // 4)."""
    n_fft = int(params.get("n_fft", spec.WELCH_N_FFT))  # type: ignore[call-overload]
    win = int(params.get("win_length") or n_fft)  # type: ignore[call-overload]
    return win, int(params.get("hop_length") or win // 4)  # type: ignore[call-overload]


def welch_in_parts(plan: RecipePlan, frame: wd.ChannelFrame, params: Mapping[str, object]) -> wd.SpectralFrame | None:
    """The Welch step's result over a long frame, computed over parts of whole segments; None when short.

    Welch is the mean of the segments' power spectra, and each part holds whole segments of the same grid
    (a part starts at its first segment), so the segment-weighted mean of the parts' power is the result over
    the whole frame. Only memory changes: the parts are computed one after another. A median of the
    segments is not the parts' mean, so any other average is computed whole.
    """
    if str(params.get("average", "mean")) != "mean":
        return None
    win, hop = _welch_shape(params)
    total = (frame.n_samples - win) // hop + 1 if frame.n_samples >= win else 0
    if total <= WELCH_PART_SEGMENTS:
        return None
    power: np.ndarray | None = None
    first: wd.SpectralFrame | None = None
    for start_segment in range(0, total, WELCH_PART_SEGMENTS):
        count = min(WELCH_PART_SEGMENTS, total - start_segment)
        start = start_segment * hop
        part = plan.apply({"region": frame[:, start : start + (count - 1) * hop + win]})
        amplitude = np.asarray(part.data).reshape(frame.n_channels, -1)
        first = first or part
        # The step's spectrum is an amplitude whose square is proportional to the segments' mean power.
        weighted = np.abs(amplitude) ** 2 * count
        power = weighted if power is None else power + weighted
    assert first is not None and power is not None
    return wd.SpectralFrame(
        data=da.from_array(np.sqrt(power / total).astype(np.asarray(first.data).dtype)),
        sampling_rate=first.sampling_rate,
        n_fft=first.n_fft,
        window=first.window,
        label=first.label,
        metadata=dict(first.metadata),
        channel_metadata=list(first.channels),
        win_length=getattr(first, "win_length", None),
    )


def _node_params(recipe: Mapping[str, object], node_id: str) -> dict[str, object]:
    return next((values for node, values in _decoded_nodes(recipe) if node.id == node_id), {})


def _selected_channels(channels: Sequence[int] | None, count: int) -> list[int]:
    if channels is None:
        return list(range(count))
    if not channels or len(set(channels)) != len(channels) or any(not 0 <= index < count for index in channels):
        raise InputError(f"channels must be distinct indices below {count}")
    return list(channels)


def _compared_channels(recipe: Mapping[str, object], selected: Sequence[int]) -> list[int]:
    """The file's channels a scan's step is of: the one a get_channel step at the chain's head picks, else all."""
    try:
        params = _node_params(recipe, CHANNEL_NODE)
    except Exception:  # noqa: BLE001 - a Recipe wandas cannot read fails where it is planned, with its own reason.
        return list(selected)
    index = params.get("channel_idx")
    if isinstance(index, int) and not isinstance(index, bool) and 0 <= index < len(selected):
        return [selected[index]]
    return list(selected)


def _has_welch(recipe: Mapping[str, object]) -> bool:
    return any(node.operation == WELCH_OPERATION for node, _ in _decoded_nodes(recipe))


def _check_region(region: Mapping[str, float] | None, duration: float, sampling_rate: float) -> None:
    if region is None:
        return
    start, end = float(region["start"]), float(region["end"])
    if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end <= start:
        raise InputError("region must satisfy 0 <= start < end")
    if end > duration + 1 / sampling_rate:
        raise InputError(f"region ends after the file ({duration:.3f} s)")


def scan_cached(
    cached: CachedAnalysis,
    *,
    recipe: Mapping[str, object],
    region: Mapping[str, float] | None,
    channels: Sequence[int] | None,
    calibration_profile: object,
    stage: str,
    reference: tuple[CachedAnalysis, ScanReference] | None = None,
) -> ScanResult:
    """One step of the Recipe over one file: what its result is (``stage``) and what it is of. The step's own values
    are kept for the figure service (``_stage_result``); nothing else is measured of the file."""
    source = cached.frame
    sampling_rate = float(source.sampling_rate)
    duration = source.n_samples / sampling_rate
    _check_region(region, duration, sampling_rate)
    selected = _selected_channels(channels, source.n_channels)
    resolved = resolve_calibration_profile(calibration_profile, source, source_peaks=cached.source_peaks)
    calibrated = resolved.apply(source)
    picked = calibrated if selected == list(range(source.n_channels)) else calibrated.get_channel(selected)
    # The channels the step is of: the one the chain's head picks (the webview's withChannel), else all selected.
    # The other channels of the file take no part, so their units need not agree with it.
    compared = _compared_channels(recipe, selected)
    references = {
        (*level_identity(channel.unit, channel.ref, channel.level_reference.label), has_full_scale(source, index))
        for index, channel in zip(selected, picked.channels, strict=True)
        if index in compared
    }
    if len(references) != 1:
        raise InputError("Selected channels have different units or level references; scan them separately")
    [(unit, ref, level_label, full_scale)] = references
    # Channels on one reference compare whatever their status (a gain correction keeps FS): calibrated only if all are.
    status: CalibrationStatus = (
        "calibrated" if all(resolved.channels[index].status == "calibrated" for index in compared) else "uncalibrated"
    )

    start = 0.0 if region is None else float(region["start"])
    end = duration if region is None else min(float(region["end"]), duration)
    # The Recipe's filters ring where the file starts and ends, so its time slice skips those ends of a region.
    start, end = max(start, spec.EDGE_GUARD_S), min(end, duration - spec.EDGE_GUARD_S)
    plans = scan_plans(recipe, start, end, sampling_rate)
    # The input and the steps before the slice are of the whole file: the region's length says nothing of them.
    if stage != INPUT_STAGE and stage not in plans["upstream"]:
        # The shortest region is one FFT of the Recipe's average spectrum; without that step, one sample.
        shortest = int(welch_params(recipe)["n_fft"]) if _has_welch(recipe) else 1  # type: ignore[call-overload]
        if (end - start) * sampling_rate < shortest:
            raise InputError(f"Region is too short once the file's first and last {spec.EDGE_GUARD_S:g} s are skipped")
    input_name = plans["region"].inputs[0].name
    described: ScanInput = {
        "id": cached.input_id,
        "fs": int(round(sampling_rate)),
        "channels": selected,
        "durationS": round(duration, 6),
        "unit": unit,
        "ref": ref,
        "levelReferenceLabel": level_label,
        "calibrationStatus": status,
        "fullScale": full_scale,
        "channelCalibration": [resolved.channels[index].status for index in selected],
        # The region as it was asked for, its ends exact: the webview's sameCondition reads it through regionKey.
        "region": None if region is None else {"start": float(region["start"]), "end": float(region["end"])},
    }
    if reference is not None:
        described["baseCalibrationStatus"] = _reference_status(reference)
    known = {*plans["upstream"], plans["region"].output, *(step for step, _ in plans["steps"])}
    # The step's full-resolution values are kept under this key for the comparison's medians and differences.
    data_key = _data_key(cached, recipe, region, selected, calibration_profile, stage, reference)
    if stage == INPUT_STAGE:
        # The channel the comparison draws a file as is the get_channel step at the chain's head (withChannel):
        # the input is drawn as that channel, as every step after it is, not as all the file's channels.
        shown = picked
        if CHANNEL_NODE in plans["upstream"]:
            try:
                shown = upstream_plan(recipe, CHANNEL_NODE).apply({input_name: picked})
            except Exception as error:  # noqa: BLE001 - named as the step's failure, as a step before the slice is.
                raise StepFailure(CHANNEL_NODE, error) from error
        return _stage_result(described, shown, _length_s(picked), data_key)
    if stage not in known:
        raise InputError(f"The Recipe has no step {stage!r}")
    if stage in plans["upstream"]:
        # A step before the slice runs over the whole file; nothing after it is needed.
        try:
            upstream = _upstream_step(recipe, stage, input_name, picked)
            return _stage_result(described, upstream, _length_s(picked), data_key)
        except Exception as error:  # noqa: BLE001 - a step that fails on this file is named, whatever it raised.
            raise StepFailure(stage, error) from error
    try:
        result = plans["region"].apply({input_name: picked})
        # Computed once: every later step and branch reads it, and a lazy frame would rerun the steps before.
        region_frame = result.cache()
    except (RecipeExecutionError, ValueError) as error:
        named = re.search(r"Node: '([^']+)'", str(error))
        if named and named.group(1) in {*plans["upstream"], plans["region"].output}:
            raise StepFailure(named.group(1), error) from error
        raise
    if not isinstance(region_frame, wd.ChannelFrame):
        raise InputError(f"The Recipe must give a time signal before its slice, not a {type(region_frame).__name__}")
    if stage == plans["region"].output:
        return _stage_result(described, region_frame, None, data_key)
    current = region_frame
    # The last time signal in the chain: what an STFT after it was taken of, for its columns' windows.
    timed = region_frame
    welch_steps = {
        str(node["id"])
        for node in RecipePlan.from_dict(dict(recipe)).to_dict()["nodes"]
        if node["operation"] == WELCH_OPERATION
    }
    # With a reference, its own frame goes through the same steps until the cross-channel step pairs the two.
    paired_at = reference[1]["step"] if reference is not None else None
    ref_current, ref_steps = (
        _reference_region(reference, start, end, sampling_rate) if reference is not None else (None, {})
    )
    vs_base = False
    # A CSD keeps its auto-spectra for the cross-spectral steps after it; its picture draws the recording over the
    # base (ch2 / ch1) all the same.
    paired_csd = paired_at is not None and any(
        str(node["id"]) == paired_at and str(node["operation"]).endswith(".csd")
        for node in RecipePlan.from_dict(dict(recipe)).to_dict()["nodes"]
    )
    # Where the base is shorter than this recording's region, the pair is as long as the base: a step that then
    # fails says so, rather than failing as this recording's.
    short_base: float | None = None
    for step, plan in plans["steps"]:
        if step == paired_at and ref_current is not None:
            if (
                isinstance(ref_current, wd.ChannelFrame)
                and isinstance(current, wd.ChannelFrame)
                and ref_current.n_samples < current.n_samples
            ):
                short_base = _length_s(ref_current)
            current = _paired(ref_current, current)
        try:
            parts = (
                welch_in_parts(plan, current, _node_params(recipe, step))
                if step in welch_steps and isinstance(current, wd.ChannelFrame)
                else None
            )
            current = parts.cache() if parts is not None else apply_step(plan, current)
            if step == paired_at:
                # The scanned recording over the reference: the pair's one row.
                if not paired_csd:
                    if not isinstance(current, PairwiseFrame):
                        raise TypeError(f"{step} gives a {type(current).__name__}, not a cross-channel Frame")
                    current = current.select_pair(1, 0).cache()
                ref_current, vs_base = None, True
            elif ref_current is not None:
                ref_current = _reference_step(ref_steps, step, ref_current)
            # A step's picture needs nothing after it.
            if step == stage:
                return _stage_result(described, current, _length_s(timed), data_key, watched=timed, vs_base=vs_base)
        except Exception as error:  # noqa: BLE001 - as above.
            if step == paired_at and short_base is not None:
                raise InputError(f"The base recording gives only {short_base:.2f} s of this region: {error}") from error
            raise StepFailure(step, error) from error
        if isinstance(current, wd.ChannelFrame):
            timed = current
    raise InputError(f"The Recipe has no step {stage!r}")


def _reference_status(reference: tuple[CachedAnalysis, ScanReference]) -> CalibrationStatus:
    """The calibration status of the base slot's channel a pair is made with (its Recipe's get_channel, else ch1)."""
    cached, described = reference
    resolved = resolve_calibration_profile(described.get("calibration"), cached.frame, source_peaks=cached.source_peaks)
    try:
        index = int(_node_params(described["recipe"], CHANNEL_NODE).get("channel_idx", 0))  # type: ignore[call-overload]
    except Exception:  # noqa: BLE001 - a Recipe that names no channel pairs the base's first.
        index = 0
    channels = resolved.channels
    return channels[index].status if 0 <= index < len(channels) else "uncalibrated"


def _reference_region(
    reference: tuple[CachedAnalysis, ScanReference],
    start: float,
    end: float,
    sampling_rate: float,
) -> tuple[wd.ChannelFrame, dict[str, RecipePlan]]:
    """The reference recording over the same region, through its Recipe's steps up to the slice; its later steps."""
    cached, described = reference
    source = cached.frame
    if float(source.sampling_rate) != sampling_rate:
        raise InputError(
            f"The base recording is at {source.sampling_rate:g} Hz and this one at {sampling_rate:g} Hz:"
            " they cannot be paired"
        )
    calibrated = resolve_calibration_profile(
        described.get("calibration"), source, source_peaks=cached.source_peaks
    ).apply(source)
    duration = source.n_samples / sampling_rate
    end = min(end, duration - spec.EDGE_GUARD_S)
    if end <= start:
        raise InputError(
            f"The base recording ({duration:.2f} s) does not reach this region, which starts at {start:.2f} s"
        )
    plans = scan_plans(described["recipe"], start, end, sampling_rate)
    region = plans["region"].apply({plans["region"].inputs[0].name: calibrated}).cache()
    return region, dict(plans["steps"])


def _reference_step(steps: Mapping[str, RecipePlan], step: str, frame: wd.ChannelFrame) -> wd.ChannelFrame:
    if step not in steps:
        raise InputError(f"The base recording's Recipe has no step {step!r}")
    return apply_step(steps[step], frame)


def _paired(reference: object, frame: object) -> wd.ChannelFrame:
    """The reference's first channel and the scanned recording's, over their common length, as one frame."""
    if not isinstance(reference, wd.ChannelFrame) or not isinstance(frame, wd.ChannelFrame):
        raise InputError("A recording is paired with the base as a time signal")
    first = reference if reference.n_channels == 1 else reference.get_channel(0)
    second = frame if frame.n_channels == 1 else frame.get_channel(0)
    length = min(first.n_samples, second.n_samples)
    if first.n_samples != length:
        first = first.fix_length(length=length)
    if second.n_samples != length:
        second = second.fix_length(length=length)
    return first.concat_frame(second, label_prefix="compare", suffix_on_dup="_compare")


def _against_base(view: StageView, vs_base: bool) -> StageView:
    """A picture past the step that paired the recording with the base slot's: that is its pair, not two channels."""
    if vs_base and "pair" in view:
        view["pair"] = {**view["pair"], "base": True}
    return view


def _length_s(frame: wd.ChannelFrame) -> float:
    return float(frame.n_samples) / float(frame.sampling_rate)


def _data_key(
    cached: CachedAnalysis,
    recipe: Mapping[str, object],
    region: Mapping[str, float] | None,
    channels: list[int],
    calibration_profile: object,
    stage: str | None,
    reference: tuple[CachedAnalysis, ScanReference] | None,
) -> str:
    """What one scan's step is of: the file as read, the Recipe, region, channels, calibration and step, and the
    recording a cross-channel step pairs it with."""
    paired = (
        [reference[0].input_id, reference[1]["step"], reference[1]["recipe"], reference[1].get("calibration")]
        if reference is not None
        else None
    )
    identity = [cached.input_id, recipe, region, channels, calibration_profile, stage, paired]
    return hashlib.sha256(json.dumps(identity, sort_keys=True, default=str).encode()).hexdigest()


def _stage_result(
    described: ScanInput,
    frame: object,
    signal_s: float | None,
    data_key: str,
    *,
    watched: object = None,
    vs_base: bool = False,
) -> ScanResult:
    """What a step's result is (stage_view.describe), as the comparison asks for it per step. The Frame is read once:
    its description and its kept values are of that one reading.

    The step's own values are kept (stage_combine) and the description names them (``data``) only once the store
    holds them: a key the store refused (over its budget) would be asked for, answered missing and scanned again,
    over and over. Refused, the result says so (``stageDataTooLarge``) and the comparison draws no median or Δ of it.

    ``watched``: the time signal a trigger watched, which names the unit when no event was found. ``vs_base``: the
    step's pair is the recording over the base slot's.
    """
    reading = read_frame(frame, signal_s)
    view = describe(frame, reading)
    # A trigger that found no event has no segment to name its unit: the signal it watched does.
    if watched is not None and view.get("events") == [] and not view.get("unit"):
        view["unit"] = channel_unit(watched)
    view = _against_base(view, vs_base)
    too_large = False
    if STORE.has(data_key):
        view["data"] = data_key
    else:
        data = stage_data(frame, view, signal_s, reading)
        if data is not None:
            STORE.put(data_key, data)
            if STORE.has(data_key):
                view["data"] = data_key
            else:
                too_large = True
    result: ScanResult = {
        "ok": True,
        "input": described,
        "stage": view,
        "specVersion": spec.ANALYSIS_SPEC_VERSION,
        "wandasVersion": wd.__version__,
    }
    if too_large:
        result["stageDataTooLarge"] = True
    return result


def _first_line(error: BaseException) -> str:
    text = str(error).strip()
    line = text.splitlines()[0] if text else type(error).__name__
    return line if isinstance(error, (InputError, OSError)) else f"{type(error).__name__}: {line}"


_synchronous = contextvars.ContextVar("synchronous_dask", default=False)


def _per_thread_scheduler(dsk: Any, keys: Any, **kwargs: Any) -> Any:
    """dask's default threaded scheduler, except for computes on a thread that is running a scan."""
    if _synchronous.get():
        return dask.local.get_sync(dsk, keys, **kwargs)
    return dask.threaded.get(dsk, keys, **kwargs)


_scheduler_lock = threading.Lock()


@contextmanager
def _synchronous_dask() -> Iterator[None]:
    """Run this thread's dask computes synchronously, leaving other threads' computes threaded.

    Wandas computes inside ``cache()`` and array conversions, where no ``scheduler=`` can be passed, so the
    choice is made per compute by a scheduler installed once. dask's config is process-wide and ``config.set``
    is not thread-safe, so it is written only when no scheduler is configured yet: a configured one (the
    browser's synchronous scheduler, or the user's) is left as it is.
    """
    with _scheduler_lock:
        if dask.config.get("scheduler", None) is None:
            dask.config.set(scheduler=_per_thread_scheduler)
    token = _synchronous.set(True)
    try:
        yield
    finally:
        _synchronous.reset(token)


def scan(
    engine: AnalysisEngine,
    file_path: str,
    *,
    recipe: Mapping[str, object],
    region: Mapping[str, float] | None = None,
    channels: Sequence[int] | None = None,
    calibration_profile: object = None,
    stage: str,
    reference: tuple[str, ScanReference] | None = None,
) -> ScanResult:
    started = time.perf_counter()
    was_cached = engine.is_cached(file_path)
    cached = None
    paired: CachedAnalysis | None = None
    paired_was_cached = reference is None or engine.is_cached(reference[0])
    try:
        cached = engine.get_file(file_path)
        if reference is not None:
            paired = engine.get_file(reference[0])
        # One short file's graph gains nothing from threads, which only add scheduling overhead.
        with _synchronous_dask():
            result = scan_cached(
                cached,
                recipe=recipe,
                region=region,
                channels=channels,
                calibration_profile=calibration_profile,
                stage=stage,
                reference=(paired, reference[1]) if paired is not None and reference is not None else None,
            )
    except Exception as error:  # noqa: BLE001 - every failure becomes this file's ✕ row.
        if not isinstance(error, (InputError, OSError, sf.LibsndfileError)):
            traceback.print_exc(file=sys.stderr)
        result: ScanResult = {"ok": False, "reason": _first_line(error)}
        if isinstance(error, StepFailure):
            result["failedStep"] = error.step
        elif lasting_failure(error):
            result["lasting"] = True
    finally:
        # Files opened only for the scan are not kept: a 100-file scan must not hold 100 frames.
        if cached is not None and not was_cached:
            engine.discard(cached.path)
        if paired is not None and not paired_was_cached and paired.path != (cached.path if cached else None):
            engine.discard(paired.path)
    if result["ok"]:
        result["elapsedMs"] = round((time.perf_counter() - started) * 1000, 1)
    return result
