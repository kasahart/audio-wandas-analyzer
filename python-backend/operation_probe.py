"""Every operation the step bar can add, run on every kind of Frame a chain gives, to see what runs.

wandas declares which Frame an operation is a method of, not which Frames it actually works on; an
operation of every Frame (get_channel) or a spectrum operation on another spectrum's Frame may still
fail inside. So each operation is run, with the parameters a new step starts with, on example Frames of
each type it is declared to take: a 16 kHz two-channel and a 48 kHz one-channel recording, and every
Frame the operations give from them (two levels deep). An operation that fails on every example of a
type cannot follow that type; one that fails on some only depends on the file (e.g. a sampling rate).

``python operation_probe.py`` prints the table; operation_catalog.py writes its verdicts into the catalog.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import warnings
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, TypedDict

import numpy as np
import wandas as wd
from wandas.pipeline import RecipePlan

from operation_catalog import catalog, frames
from optional_packages import OPTIONAL_MODULES
from scan_service import TIME_SLICE_OPERATION, wandas_cause
from stage_view import stage_view

# The parameters a new step starts with where wandas has none (the step bar's STEP_PARAMS `initial`).
INITIAL: Mapping[str, Mapping[str, float | int]] = {
    "wandas.audio.highpass_filter": {"cutoff": 20.0},
    "wandas.audio.lowpass_filter": {"cutoff": 1000.0},
    "wandas.audio.bandpass_filter": {"low_cutoff": 100.0, "high_cutoff": 1000.0},
    "wandas.audio.noct_spectrum": {"fmax": 6300.0},
    "wandas.spectral.noct_synthesis": {"fmin": 25.0, "fmax": 6300.0},
    "wandas.audio.resampling": {"target_sr": 16000.0},
    "wandas.frame.get_channel": {"channel_idx": 0},
    "wandas.audio.fix_length": {"duration": 1.0},
}


class ProbeRun(TypedDict):
    operation: str
    input: str
    example: str
    ok: bool
    output: str
    drawn: bool
    error: str


def _float(value: float) -> dict[str, str]:
    import struct

    return {"$type": "number", "kind": "python-float", "data": struct.pack(">d", float(value)).hex()}


def _apply(operation: Mapping[str, Any], frame: object) -> object:
    # Integers stay integers (a channel index); the rest are Recipe floats.
    entries = sorted(
        [name, value if isinstance(value, int) else _float(value)]
        for name, value in INITIAL.get(operation["id"], {}).items()
    )
    plan = RecipePlan.from_dict(
        {
            "schema": "wandas.recipe",
            "version": 2,
            "inputs": [{"id": "input-0", "name": "frame", "kind": "frame"}],
            "nodes": [
                {
                    "id": "node-0",
                    "operation": operation["id"],
                    "version": operation["version"],
                    "inputs": ["input-0"],
                    "params": {"$type": "map", "entries": entries},
                }
            ],
            "output": "node-0",
        }
    )
    result = plan.apply({"frame": frame})
    # Frames are lazy: an operation that fails inside only does so when computed.
    return result.cache() if hasattr(result, "cache") else result


def _recordings() -> dict[str, wd.ChannelFrame]:
    rng = np.random.default_rng(7)

    def tones(rate: int, channels: int) -> np.ndarray:
        t = np.arange(rate * 2) / rate
        rows = [
            0.3 * np.sin(2 * np.pi * (440 * (k + 1)) * t) + 0.02 * rng.standard_normal(t.size) for k in range(channels)
        ]
        return np.stack(rows)

    return {
        "16 kHz 2 ch": wd.from_numpy(tones(16000, 2), sampling_rate=16000),
        "48 kHz 1 ch": wd.from_numpy(tones(48000, 1), sampling_rate=48000),
    }


def _takes(wanted: str, frame: str, bases: Mapping[str, list[str]]) -> bool:
    return wanted == "*" or wanted == frame or wanted in bases.get(frame, [])


def _self_pairs_only(frame: object) -> bool:
    pairs = getattr(frame, "pairs", None)
    return pairs is not None and all(pair.output.index == pair.input.index for pair in pairs)


def _run(operation: Mapping[str, Any], frame_type: str, label: str, frame: object) -> tuple[ProbeRun, object | None]:
    run: ProbeRun = {
        "operation": operation["id"],
        "input": frame_type,
        "example": label,
        "ok": False,
        "output": "",
        "drawn": False,
        "error": "",
    }
    try:
        with warnings.catch_warnings(), np.errstate(all="ignore"):
            warnings.simplefilter("ignore")
            result = _apply(operation, frame)
            run["output"] = type(result).__name__
            # A pair of one channel with itself says nothing and is not drawn: the step bar does not run a
            # cross-channel step on one channel (recipeSteps.ts CROSS_CHANNEL), so that is no gap.
            run["drawn"] = stage_view(result)["kind"] != "none" or _self_pairs_only(result)
        run["ok"] = True
        return run, result
    except Exception as error:  # noqa: BLE001 - every failure is a finding.
        run["error"] = wandas_cause(error)[:160]
        return run, None


def probe(depth: int = 2, recordings: int = 2) -> list[ProbeRun]:
    """Runs every addable operation on example Frames of each type it is declared to take.

    The examples start as the two recordings; each round adds what the operations gave (up to three
    Frames of a type, from different operations), so Frames two steps from a recording are tried too.
    """
    operations = [
        operation
        for operation in catalog()
        if operation["id"] != TIME_SLICE_OPERATION
        and not any(p["required"] for p in operation["params"] if p["name"] not in INITIAL.get(operation["id"], {}))
    ]
    bases = {frame["name"]: list(frame["bases"]) for frame in frames()}
    examples: dict[str, list[tuple[str, object]]] = {"ChannelFrame": list(_recordings().items())[:recordings]}
    runs: list[ProbeRun] = []
    tried: set[tuple[str, str]] = set()
    for _ in range(depth + 1):
        produced: list[tuple[str, tuple[str, object]]] = []
        for operation in operations:
            for frame_type, instances in list(examples.items()):
                if not _takes(operation["input"], frame_type, bases):
                    continue
                for label, frame in instances:
                    if (operation["id"], label) in tried:
                        continue
                    tried.add((operation["id"], label))
                    run, result = _run(operation, frame_type, label, frame)
                    runs.append(run)
                    if result is not None and run["output"] != "ChannelFrame":
                        produced.append((run["output"], (f"{operation['id'].split('.')[-1]}({label})", result)))
        if not produced:
            break
        for output, item in produced:
            if len(examples.setdefault(output, [])) < 3:
                examples[output].append(item)
    return runs


def refusals(runs: list[ProbeRun]) -> dict[str, dict[str, str]]:
    """Per operation, the Frames it failed on in every run, with the first run's reason."""
    found: dict[str, dict[str, str]] = {}
    for operation, by_frame in verdicts(runs).items():
        for frame, verdict in by_frame.items():
            if verdict == "fails":
                reason = next(run["error"] for run in runs if run["operation"] == operation and run["input"] == frame)
                found.setdefault(operation, {})[frame] = reason
    return found


def verdicts(runs: list[ProbeRun]) -> dict[str, dict[str, str]]:
    """Per operation and input Frame: "ok" (runs on every example), "fails" (on none) or "depends"."""
    table: dict[str, dict[str, list[bool]]] = {}
    for run in runs:
        table.setdefault(run["operation"], {}).setdefault(run["input"], []).append(run["ok"])
    return {
        operation: {
            frame: "ok" if all(results) else "fails" if not any(results) else "depends"
            for frame, results in by_frame.items()
        }
        for operation, by_frame in table.items()
    }


BROWSER_LOCK = Path(__file__).parents[1] / "runtime" / "lock.json"


def browser_packages() -> set[str]:
    """The packages the Web version's Pyodide runtime carries (runtime/lock.json), by normalized name."""
    lock = json.loads(BROWSER_LOCK.read_text(encoding="utf-8"))
    names = list(lock["nativePackages"]) + [wheel.split("-", 1)[0] for wheel in lock["pureWheels"]]
    return {name.lower().replace("-", "_") for name in names}


def _probe_without(module: str) -> list[ProbeRun]:
    """The probe of the operations on recordings, in a process where `module` cannot be imported."""
    blocker = (
        "import sys, importlib.abc\n"
        "class Block(importlib.abc.MetaPathFinder):\n"
        "    def find_spec(self, name, path=None, target=None):\n"
        f"        if name == {module!r} or name.startswith({module + '.'!r}):\n"
        "            raise ModuleNotFoundError(f'No module named {name!r}', name=name)\n"
        "sys.meta_path.insert(0, Block())\n"
        "import json, operation_probe\n"
        # One recording, no Frames after it: what a missing package breaks shows on the recording itself.
        "print(json.dumps(operation_probe.probe(depth=0, recordings=1)))\n"
    )
    done = subprocess.run(
        [sys.executable, "-c", blocker], cwd=Path(__file__).parent, capture_output=True, text=True, check=True
    )
    return json.loads(done.stdout.strip().splitlines()[-1])


def needs(runs: list[ProbeRun]) -> dict[str, list[str]]:
    """Per operation, the optional packages (as the runtime lock names them) it needs that the Web runtime lacks.

    Each such package installed here is blocked in a probe of its own: an operation that runs here but
    fails on every recording without the package needs it.
    """
    carried = browser_packages()
    found: dict[str, list[str]] = {}
    ran = {run["operation"] for run in runs if run["ok"] and run["input"] == "ChannelFrame"}
    blocked = [
        (module, distribution)
        for module, distribution in OPTIONAL_MODULES
        if distribution not in carried and importlib.util.find_spec(module) is not None
    ]
    # Each probe is a process of its own, so they run side by side.
    with ThreadPoolExecutor(max_workers=max(1, len(blocked))) as pool:
        probes = list(pool.map(_probe_without, [module for module, _ in blocked]))
    for (_, distribution), blocked_runs in zip(blocked, probes, strict=True):
        for operation, by_frame in verdicts(blocked_runs).items():
            if operation in ran and by_frame.get("ChannelFrame") == "fails":
                found.setdefault(operation, []).append(distribution)
    return found


if __name__ == "__main__":
    found = probe()
    if "--json" in sys.argv:
        print(json.dumps(found, indent=1))
    else:
        for run in found:
            mark = "ok " if run["ok"] else "ERR"
            drawn = "" if not run["ok"] else ("drawn" if run["drawn"] else "NOT DRAWN")
            where = f"{run['operation']:42s} {run['input']:22s} {run['example']:40s}"
            print(f"{mark} {where} -> {run['output']:22s} {drawn} {run['error']}")
