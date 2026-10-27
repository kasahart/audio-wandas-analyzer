"""``scan``: one file's analysis-spec metrics for the entry table.

The host scans files one at a time, so a scan keeps nothing but its small result: the region frame is
computed, measured and dropped. The Recipe is one chain: its steps up to its time slice run as one plan
with the slice set to the region the user picked (the Recipe's own slice bounds never apply), and each
step after it runs on the frame the step before gave, so every step's Frame is at hand and a step that
fails is named (``failedStep``). The metrics take the chain's time signal and, where the chain ends in a
spectrum, that spectrum; ``stage`` asks for one step's Frame as the comparison draws it (stage_view.py).

A file that cannot be scanned is a result, not an error: ``{"ok": false, "reason": "<one line>"}`` lets
the table keep a ✕ row while the scan moves on to the next file. (``error`` would read as the error
envelope every host checks replies for.)
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import time
import traceback
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, NotRequired, TypedDict

import dask
import dask.array as da
import numpy as np
import soundfile as sf
import wandas as wd
from wandas.pipeline import RecipeExecutionError, RecipePlan
from wandas.pipeline.model import RecipeNode
from wandas.processing.semantic import thaw_params

import analysis_spec as spec
from backend_errors import InputError
from calibration_profile import resolve_calibration_profile
from stage_view import StageView, band_levels, rounded_db, stage_view

if TYPE_CHECKING:
    from analysis_engine import AnalysisEngine, CachedAnalysis

TIME_SLICE_OPERATION = "wandas.frame.time_slice"


class ScanReference(TypedDict):
    """Another recording a cross-channel step pairs each scanned one with (the comparison's base slot)."""

    #: The cross-channel step (node id) whose input is the pair: the reference's channel, then the scanned one's.
    step: str
    #: The reference's own Recipe (its channel row's get_channel), run like the scanned one's up to that step.
    recipe: Mapping[str, object]
    #: The reference recording's own calibration (None: uncalibrated).
    calibration: NotRequired[object]


class ScanInput(TypedDict):
    id: str
    fs: int
    channels: list[int]
    durationS: float
    unit: str
    ref: float


class ScanResult(TypedDict):
    ok: bool
    reason: NotRequired[str]
    conditionId: NotRequired[str]
    input: NotRequired[ScanInput]
    leqDbA: NotRequired[list[float]]
    peakHz: NotRequired[list[int]]
    spectrumDb: NotRequired[list[list[float]]]
    thirdOctDb: NotRequired[list[list[float | None]]]
    crest: NotRequired[list[float]]
    specVersion: NotRequired[int]
    wandasVersion: NotRequired[str]
    elapsedMs: NotRequired[float]
    endFrame: NotRequired[str]
    stage: NotRequired[StageView]
    failedStep: NotRequired[str]


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


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def region_label(region: Mapping[str, float] | None) -> str:
    """``"0.500-1.500"`` (seconds, three decimals) or ``"all"``, as condition IDs spell regions."""
    if region is None:
        return "all"
    return f"{region['start']:.3f}-{region['end']:.3f}"


def condition_id(
    *,
    input_id: str,
    region: Mapping[str, float] | None,
    channels: Sequence[int],
    sampling_rate: int,
    calibration: str | None,
    unit: str,
    ref: float,
    recipe_sha256: str,
) -> str:
    """sha256 of everything that decides a scan's numbers, so equal IDs mean comparable values."""
    return _sha256(
        _canonical_json(
            {
                "input": input_id,
                "region": region_label(region),
                "channels": list(channels),
                "fs": sampling_rate,
                "calibration": calibration,
                "unit": unit,
                "ref": ref,
                "recipe": recipe_sha256,
                "specVersion": spec.ANALYSIS_SPEC_VERSION,
                "wandasVersion": wd.__version__,
            }
        )
    )


WELCH_OPERATION = "wandas.audio.welch"
NOCT_OPERATION = "wandas.audio.noct_spectrum"
# The app's 1/3-octave branch beside the chain: not a Recipe node, but a step the comparison can show.
OCTAVE_STAGE = "node-noct"
# The input as the comparison draws it: the files' signals as they come in, before any step.
INPUT_STAGE = "node-input"


def _decoded_nodes(recipe: Mapping[str, object]) -> list[tuple[RecipeNode, dict[str, Any]]]:
    """The Recipe's nodes, each with its parameters as wandas decodes them."""
    return [(node, thaw_params(node.params)) for node in RecipePlan.from_dict(dict(recipe)).nodes]


def welch_params(recipe: Mapping[str, object]) -> dict[str, object]:
    """The FFT length and window of the Recipe's average-spectrum step, which the scan's spectrum uses.

    The step runs after the slice, so it is cut from the scan plan; its settings still decide the
    spectrum and the dominant frequency. Without one, the analysis spec's defaults apply.
    """
    params: dict[str, object] = {"n_fft": spec.WELCH_N_FFT, "window": "hann"}
    for node, values in _decoded_nodes(recipe):
        if node.operation == WELCH_OPERATION:
            params.update({name: values[name] for name in ("n_fft", "window") if name in values})
    return params


FILTER_EDGES = {
    "wandas.audio.highpass_filter": (("cutoff", "low"),),
    "wandas.audio.lowpass_filter": (("cutoff", "high"),),
    "wandas.audio.bandpass_filter": (("low_cutoff", "low"), ("high_cutoff", "high")),
}


def passband(recipe: Mapping[str, object]) -> tuple[float, float]:
    """The frequencies the Recipe's filters let through: a band centred outside them measures the stopband."""
    low, high = 0.0, math.inf
    for node, values in _decoded_nodes(recipe):
        for name, side in FILTER_EDGES.get(node.operation, ()):
            if values.get(name) is None:
                continue
            if side == "low":
                low = max(low, float(values[name]))
            else:
                high = min(high, float(values[name]))
    return low, high


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


class ScanPlans(TypedDict):
    """The Recipe as the scan runs it: the steps up to the region, each step after it, and the app's branches."""

    region: RecipePlan
    #: The chain's steps after the time slice, in order, each a plan over the frame the step before gave.
    steps: list[tuple[str, RecipePlan]]
    #: The steps before the slice (they run over the whole file), by id.
    upstream: list[str]
    #: The spectrum when the chain does not end in one: the Recipe's welch node, or the analysis spec's.
    welch: RecipePlan
    noct: RecipePlan | None
    sha256: str


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


def upstream_plan(recipe: Mapping[str, object], target: str) -> RecipePlan:
    """The Recipe up to one of its steps, which is then its output: that step's Frame over the whole file."""
    full = RecipePlan.from_dict(dict(recipe)).to_dict()
    keep = _upstream(full["nodes"], target)
    return RecipePlan.from_dict(
        {**full, "nodes": [node for node in full["nodes"] if node["id"] in keep], "output": target}
    )


def scan_plans(recipe: Mapping[str, object], start: float, end: float, sampling_rate: float) -> ScanPlans:
    """The Recipe's steps up to its time slice, with the slice set to the measured region, and its branches.

    wandas 0.9.0 plans have one output, so the branches are plans of their own over the region's frame:
    the Recipe's welch node (the average spectrum), and noct_spectrum (n = 3) over the bands the file can
    give. The shared steps run once. A Recipe without a slice must end in a time signal and gets a slice
    after its output; one without a welch node gets the analysis spec's.
    """
    full = RecipePlan.from_dict(dict(recipe)).to_dict()
    recipe_sha256 = _sha256(_canonical_json(full))
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
            {"id": target, "operation": TIME_SLICE_OPERATION, "version": 1, "inputs": [tail], "params": region_params}
        )
    region = RecipePlan.from_dict({**full, "nodes": nodes, "output": target})
    welch_node = next((node for node in full["nodes"] if node["operation"] == WELCH_OPERATION), None) or {
        "operation": WELCH_OPERATION,
        "version": 2,
        "params": {"$type": "map", "entries": [["n_fft", spec.WELCH_N_FFT], ["window", "hann"]]},
    }
    bands = _third_octave_bands(sampling_rate)
    noct = (
        _single_node_plan(
            {
                "operation": NOCT_OPERATION,
                "version": 1,
                "params": {
                    "$type": "map",
                    "entries": [["fmax", _python_float(bands[-1])], ["fmin", _python_float(bands[0])], ["n", 3]],
                },
            },
            "region",
        )
        if bands
        else None
    )
    return {
        "region": region,
        "steps": [(str(node["id"]), _single_node_plan(node, "region")) for node in after],
        "upstream": [
            str(node["id"]) for node in chain if node["id"] in _upstream(nodes, target) and node["id"] != target
        ],
        "welch": _single_node_plan(welch_node, "region"),
        "noct": noct,
        "sha256": recipe_sha256,
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


def _levels(values: np.ndarray) -> np.ndarray:
    if np.isnan(values).any():
        raise InputError("Analysis produced undefined levels")
    return rounded_db(values)


def log_spectrum(levels_db: np.ndarray, freqs: np.ndarray, points: int, nyquist: float) -> np.ndarray:
    """Welch levels on `points` log-spaced frequencies from SPECTRUM_MIN_HZ to Nyquist.

    Each point is the power mean of the Welch bins between its edges; a point narrower than one bin
    (the low end of a short FFT) takes the levels interpolated at its centre instead.
    """
    return band_levels(levels_db, freqs, np.geomspace(spec.SPECTRUM_MIN_HZ, nyquist, points + 1))


def _third_octave_bands(sampling_rate: float) -> tuple[float, ...]:
    from analysis_service import octave_bands

    usable = octave_bands(3, sampling_rate).centers_hz
    return tuple(c for c in usable if spec.THIRD_OCTAVE_CENTERS_HZ[0] <= c <= spec.THIRD_OCTAVE_CENTERS_HZ[-1])


def measure(
    filtered: wd.ChannelFrame,
    welch: wd.SpectralFrame,
    octave: wd.NOctFrame | None,
    *,
    passband: tuple[float, float] = (0.0, math.inf),
) -> dict[str, object]:
    """The analysis-spec metrics of a region frame and the Recipe's branches over it, one entry per channel.

    `filtered` is the Recipe's region (its time slice), `welch` and `octave` its average-spectrum and
    1/3-octave branches. Leq stays outside the Recipe: an RMS is an array, not a frame.
    """
    frame = filtered
    refs = np.array([channel.ref for channel in filtered.channels], dtype=np.float64)
    rms = np.asarray(filtered.a_weighting().rms, dtype=np.float64)
    with np.errstate(divide="ignore"):
        leq = 20.0 * np.log10(rms / refs)

    welch_db = np.asarray(welch.dB, dtype=np.float64).reshape(frame.n_channels, -1)
    freqs = np.asarray(welch.freqs, dtype=np.float64)
    searched = freqs >= spec.PEAK_MIN_HZ
    peaks = freqs[searched][np.argmax(welch_db[:, searched], axis=1)]
    spectrum = log_spectrum(welch_db, freqs, spec.SPECTRUM_POINTS, frame.sampling_rate / 2)

    third = np.full((frame.n_channels, len(spec.THIRD_OCTAVE_CENTERS_HZ)), np.nan)
    bands = _third_octave_bands(frame.sampling_rate)
    if bands and octave is not None:
        values = np.asarray(octave.dB, dtype=np.float64).reshape(frame.n_channels, -1)
        columns = [spec.THIRD_OCTAVE_CENTERS_HZ.index(band) for band in bands]
        if values.shape[1] != len(columns):
            raise InputError("1/3-octave analysis returned an unexpected number of bands")
        third[:, columns] = _levels(values)
        # A band centred where the Recipe filters the signal out shows the filter, not the file.
        for column, center in enumerate(spec.THIRD_OCTAVE_CENTERS_HZ):
            if not passband[0] <= center <= passband[1]:
                third[:, column] = np.nan

    # A silent channel has no peak-to-RMS ratio; 0 keeps the result JSON.
    crest = np.nan_to_num(np.asarray(filtered.crest_factor, dtype=np.float64), nan=0.0, posinf=0.0)
    return {
        "leqDbA": _levels(leq).tolist(),
        "peakHz": [int(round(peak)) for peak in peaks],
        "spectrumDb": _levels(spectrum).tolist(),
        "thirdOctDb": [[None if math.isnan(value) else value for value in row] for row in third.tolist()],
        "crest": np.round(crest, spec.CREST_DECIMALS).tolist(),
    }


def _selected_channels(channels: Sequence[int] | None, count: int) -> list[int]:
    if channels is None:
        return list(range(count))
    if not channels or len(set(channels)) != len(channels) or any(not 0 <= index < count for index in channels):
        raise InputError(f"channels must be distinct indices below {count}")
    return list(channels)


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
    stage: str | None = None,
    detail: Mapping[str, object] | None = None,
    reference: tuple[CachedAnalysis, ScanReference] | None = None,
) -> ScanResult:
    source = cached.frame
    sampling_rate = float(source.sampling_rate)
    duration = source.n_samples / sampling_rate
    _check_region(region, duration, sampling_rate)
    selected = _selected_channels(channels, source.n_channels)
    resolved = resolve_calibration_profile(calibration_profile, source, source_peaks=cached.source_peaks)
    calibrated = resolved.apply(source)
    picked = calibrated if selected == list(range(source.n_channels)) else calibrated.get_channel(selected)
    units = {(channel.unit or "FS", float(channel.ref)) for channel in picked.channels}
    if len(units) != 1:
        raise InputError("Selected channels have different units; scan them separately")
    [(unit, ref)] = units

    start = 0.0 if region is None else float(region["start"])
    end = duration if region is None else min(float(region["end"]), duration)
    # The Recipe's filters ring where the file starts and ends, so its time slice skips those ends of a region.
    start, end = max(start, spec.EDGE_GUARD_S), min(end, duration - spec.EDGE_GUARD_S)
    averaging = welch_params(recipe)
    if (end - start) * sampling_rate < int(averaging["n_fft"]):  # type: ignore[call-overload]
        raise InputError(f"Region is too short once the file's first and last {spec.EDGE_GUARD_S:g} s are skipped")
    plans = scan_plans(recipe, start, end, sampling_rate)
    recipe_sha256 = plans["sha256"]
    input_name = plans["region"].inputs[0].name
    described: ScanInput = {
        "id": cached.input_id,
        "fs": int(round(sampling_rate)),
        "channels": selected,
        "durationS": round(duration, 6),
        "unit": unit,
        "ref": ref,
    }
    known = {*plans["upstream"], plans["region"].output, *(step for step, _ in plans["steps"])}
    if plans["noct"] is not None:
        known.add(OCTAVE_STAGE)
    if stage == INPUT_STAGE:
        return _stage_result(described, stage_view(picked, _length_s(picked), detail))
    if stage is not None and stage not in known:
        raise InputError(f"The Recipe has no step {stage!r}")
    if stage is not None and stage in plans["upstream"]:
        # A step before the slice runs over the whole file; nothing after it is needed.
        try:
            view = stage_view(upstream_plan(recipe, stage).apply({input_name: picked}), _length_s(picked), detail)
        except Exception as error:  # noqa: BLE001 - a step that fails on this file is named, whatever it raised.
            raise StepFailure(stage, error) from error
        return _stage_result(described, view)
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
        return _stage_result(described, stage_view(region_frame, None, detail))
    # The time signal the metrics read: the region, then each step after it while every step gives a time
    # signal at the file's rate (a loudness over time is a ChannelFrame too, but not a signal to take Leq of).
    signal = current = region_frame
    leading = True
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
            current = parts.cache() if parts is not None else plan.apply({"region": current}).cache()
            if step == paired_at:
                # The scanned recording over the reference: the pair's one row.
                current = current if paired_csd else current.select_pair(1, 0).cache()
                ref_current, vs_base = None, True
            elif ref_current is not None:
                ref_current = _reference_step(ref_steps, step, ref_current)
            # A step's picture needs nothing after it, and none of the metrics.
            if step == stage:
                return _stage_result(described, _against_base(stage_view(current, _length_s(timed), detail), vs_base))
        except Exception as error:  # noqa: BLE001 - as above.
            if step == paired_at and short_base is not None:
                raise InputError(f"The base recording gives only {short_base:.2f} s of this region: {error}") from error
            raise StepFailure(step, error) from error
        if isinstance(current, wd.ChannelFrame):
            timed = current
        leading = leading and isinstance(current, wd.ChannelFrame) and current.sampling_rate == sampling_rate
        if leading:
            signal = current
    spectrum = (
        current
        if isinstance(current, wd.SpectralFrame)
        else welch_in_parts(plans["welch"], signal, welch_params(recipe)) or plans["welch"].apply({"region": signal})
    )
    octave = plans["noct"].apply({"region": signal}) if plans["noct"] is not None else None
    if stage == OCTAVE_STAGE:
        return _stage_result(described, _against_base(stage_view(octave, None, detail), vs_base))
    metrics = measure(signal, spectrum, octave, passband=passband(recipe))
    return {
        "ok": True,
        "conditionId": condition_id(
            input_id=cached.input_id,
            region=region,
            channels=selected,
            sampling_rate=int(round(sampling_rate)),
            calibration=None if resolved.is_identity else resolved.signature,
            unit=unit,
            ref=ref,
            recipe_sha256=recipe_sha256,
        ),
        "input": described,
        **metrics,  # type: ignore[typeddict-item]
        "specVersion": spec.ANALYSIS_SPEC_VERSION,
        "wandasVersion": wd.__version__,
        "endFrame": type(current).__name__,
    }


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
    return steps[step].apply({"region": frame}).cache()


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


def _stage_result(described: ScanInput, view: StageView) -> ScanResult:
    """A step's picture alone: the comparison asks for it per step, so the metrics are not computed again."""
    return {
        "ok": True,
        "input": described,
        "stage": view,
        "specVersion": spec.ANALYSIS_SPEC_VERSION,
        "wandasVersion": wd.__version__,
    }


def _first_line(error: BaseException) -> str:
    text = str(error).strip()
    line = text.splitlines()[0] if text else type(error).__name__
    if isinstance(error, sf.LibsndfileError):
        return f"Unable to read audio: {error.error_string}"
    return line if isinstance(error, (InputError, OSError)) else f"{type(error).__name__}: {line}"


def scan(
    engine: AnalysisEngine,
    file_path: str,
    *,
    recipe: Mapping[str, object],
    region: Mapping[str, float] | None = None,
    channels: Sequence[int] | None = None,
    calibration_profile: object = None,
    stage: str | None = None,
    detail: Mapping[str, object] | None = None,
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
        with dask.config.set(scheduler="synchronous"):
            result = scan_cached(
                cached,
                recipe=recipe,
                region=region,
                channels=channels,
                calibration_profile=calibration_profile,
                stage=stage,
                detail=detail,
                reference=(paired, reference[1]) if paired is not None and reference is not None else None,
            )
    except Exception as error:  # noqa: BLE001 - every failure becomes this file's ✕ row.
        if not isinstance(error, (InputError, OSError, sf.LibsndfileError)):
            traceback.print_exc(file=sys.stderr)
        result = {"ok": False, "reason": _first_line(error)}
        if isinstance(error, StepFailure):
            result["failedStep"] = error.step
    finally:
        # Files opened only for the scan are not kept: a 100-file scan must not hold 100 frames.
        if cached is not None and not was_cached:
            engine.discard(cached.path)
        if paired is not None and not paired_was_cached and paired.path != (cached.path if cached else None):
            engine.discard(paired.path)
    if result["ok"]:
        result["elapsedMs"] = round((time.perf_counter() - started) * 1000, 1)
    return result
