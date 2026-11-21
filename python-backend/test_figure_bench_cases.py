"""The comparison's remaining figures' shared test data: tests/fixtures/figure_bench_cases.json, recorded from the old
path before it was removed. The figure service's tests replay it
(test_figures_lines_kinds.py, test_figures_images.py, test_figures_events.py). This file holds the scene and the steps
the cases are of, each step's kept values as a scan keeps them (``_data``), and checks the file's shape.

A case is one kind of step (a metric over time, a cepstrum, a cross-correlation, the three figures of a channel
pair, the octave bands, the roughness and cepstrogram images, a trigger's events; the spectrum's lines, the
spectrogram and the time signal have their own files from stages 2 and 2b). The old path is gone, so the
file can no longer be recorded again: a case changes only by hand, on purpose, and is named in the stage's list of
changed tests.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import wandas as wd

from frames import stage_view as sv
from services.stage_combine import StageData, stage_data

FIXTURE = Path(__file__).parent / "tests" / "fixtures" / "figure_bench_cases.json"
SECTIONS = ("view", "combine", "read")
#: The steps recorded, by the name a case gives: the wandas chain the comparison's step bar would run.
STEPS: dict[str, Callable[[Any], Any]] = {
    "rms": lambda frame: frame.rms_trend(frame_length=256, hop_length=64),
    "rms_db": lambda frame: frame.rms_trend(frame_length=256, hop_length=64, dB=True),
    "cepstrum": lambda frame: frame.cepstrum(),
    "correlation": lambda frame: frame.cross_correlation(max_lag=0.05),
    "coherence": lambda frame: frame.coherence(n_fft=512),
    "transfer": lambda frame: frame.transfer_function(n_fft=512),
    "csd": lambda frame: frame.csd(n_fft=512),
    "bands": lambda frame: frame.noct_spectrum(n=3, fmin=50, fmax=2500),
    "cepstrogram": lambda frame: frame.stft(n_fft=256).cepstrum(),
    "roughness": lambda frame: frame.roughness_dw_spec(),
    "events": lambda frame: frame.trigger(threshold=0.5, duration=0.1, pre=0.02),
}


def scene_recording(scene: dict[str, Any], name: str) -> wd.ChannelFrame:
    """One of the scene's recordings: two channels of tones under a slow swell with a click every half second, each
    recording with its own gain and its own detuning; the second channel is a delayed, quieter copy of the first plus
    a tone of its own. Made without randomness."""
    rate, seconds = int(scene["rate"]), float(scene["seconds"])
    spec = scene["recordings"][name]
    gain, detune = float(spec["gain"]), float(spec["detune"])
    t = np.arange(int(rate * seconds)) / rate
    first = np.zeros_like(t)
    for tone in scene["tones"]:
        first += float(tone["amplitude"]) * np.sin(2 * np.pi * float(tone["hz"]) * detune * t)
    first *= 1.0 + float(scene["swell"]) * np.sin(2 * np.pi * t / seconds)
    click = scene["click"]
    for at in np.arange(float(click["first_s"]), seconds, float(click["every_s"])):
        start = int(round(at * rate))
        first[start : start + int(click["samples"])] += float(click["amplitude"])
    first *= gain
    delay = int(scene["second"]["delay_samples"])
    second = float(scene["second"]["gain"]) * np.roll(first, delay)
    second[:delay] = 0.0
    second += float(scene["second"]["own_amplitude"]) * np.sin(2 * np.pi * float(scene["second"]["own_hz"]) * t)
    return wd.from_numpy(np.stack([first, second]), sampling_rate=rate)


#: Each recording's step and what it is, made once (a roughness takes seconds): keyed by the scene's own text.
_MADE: dict[tuple[str, str, str], tuple[Any, dict[str, Any]]] = {}


def _made(scenes: dict[str, Any], given: dict[str, Any], name: str) -> tuple[Any, dict[str, Any]]:
    """A recording's step (the Frame) and its description."""
    scene = scenes[given["scene"]]
    key = (json.dumps(scene, sort_keys=True), given["step"], name)
    if key not in _MADE:
        frame = STEPS[given["step"]](scene_recording(scene, name))
        _MADE[key] = (frame, dict(sv.stage_view(frame)))
    return _MADE[key]


def _data(scenes: dict[str, Any], given: dict[str, Any], name: str) -> StageData | None:
    frame, view = _made(scenes, given, name)
    return stage_data(frame, view)  # type: ignore[arg-type]


def test_every_kind_of_step_has_a_recorded_case_in_every_section() -> None:
    table = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for section in SECTIONS:
        cases = table[section]
        assert {case["input"]["step"] for case in cases} == set(STEPS), f"{section}: a kind of step has no case"
        for case in cases:
            assert case["id"] and case["description"] and "input" in case and "expected" in case
            assert case["source"].startswith("old path: "), f"{section}: {case['id']} names no old-path source"
        assert len({case["id"] for case in cases}) == len(cases), f"{section}: ids repeat"
