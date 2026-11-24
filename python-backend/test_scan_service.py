from __future__ import annotations

import importlib.util
import json
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from browser_service import create_service
from frames import analysis_spec as spec
from services.analysis_engine import AnalysisEngine, file_version
from services.analysis_service import AnalysisService
from services.recipe_builder import RecipeSource, spectrum_recipe
from services.scan_service import scan_plans, welch_params
from services.stage_combine import STORE, StageData
from transport.command_dispatch import dispatch, validate_request
from transport.protocol_schema import DEFINITIONS, first_violation

ENTRY_RECIPE = json.loads((Path(__file__).parent / "recipes" / "entry-scan.recipe.json").read_text())
ENTRY100 = Path(__file__).parents[1] / "src" / "test" / "fixtures" / "entry100" / "generate.py"
RATE = 16000


def _write(path: Path, channels: list[np.ndarray], rate: int = RATE) -> str:
    sf.write(path, np.stack(channels, axis=1), rate, subtype="FLOAT")
    return str(path)


def _sine(frequency: float, amplitude: float, seconds: float = 2.0, rate: int = RATE) -> np.ndarray:
    return amplitude * np.sin(2 * np.pi * frequency * np.arange(int(seconds * rate)) / rate)


def _scan(service: AnalysisService, path: str, **payload: object) -> dict:
    """A scan of one step: the step named, or the one the Recipe ends in (a scan always names a step)."""
    recipe = payload.get("recipe", ENTRY_RECIPE)
    stage = recipe.get("output", "node-2") if isinstance(recipe, dict) else "node-2"
    request = validate_request(
        {"cmd": "scan", "requestId": "r", "filePath": path, "recipe": ENTRY_RECIPE, "stage": stage, **payload}
    )
    result = dispatch(request, service)
    assert first_violation(DEFINITIONS["ScanResult"], result) is None
    return result


def _kept(stage: dict) -> StageData:
    """Every value the scan kept of the step it describes (``stage``: a result's ``stage``)."""
    kept = STORE.get(stage["data"])
    assert kept is not None
    return kept


def _span(stage: dict) -> tuple[float, float]:
    """The first and the last x of the step's kept values (a signal's samples are at start + n / rate)."""
    kept = _kept(stage)
    if kept.mode == "signal":
        return kept.start, kept.start + (kept.values.size - 1) / kept.rate
    return float(kept.xs[0]), float(kept.xs[-1])


def _level_at(result: dict, hz: float) -> float:
    """The level of a spectrum step at the bin nearest ``hz``, from every value the scan kept of it."""
    kept = _kept(result["stage"])
    return float(kept.values[int(np.argmin(np.abs(kept.xs - hz)))])


def _peak_hz(result: dict) -> float:
    kept = _kept(result["stage"])
    return float(kept.xs[int(np.argmax(kept.values))])


def test_a_scan_names_its_input_and_carries_the_steps_description_alone(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tones.wav", [_sine(1000, 0.5), _sine(3150, 0.1)])

    result = _scan(service, path)

    assert result["ok"] is True
    assert result["input"] == {
        "id": json.dumps([str(Path(path).resolve()), *file_version(Path(path).stat())]),
        "fs": RATE,
        "channels": [0, 1],
        "durationS": 2.0,
        "unit": "FS",
        "ref": 1.0,
        "levelReferenceLabel": "dBFS",
        "calibrationStatus": "uncalibrated",
        "fullScale": True,
        # Each channel's own status, in channels' order (a channel taken alone names its own, R4).
        "channelCalibration": ["uncalibrated", "uncalibrated"],
        "region": None,
    }
    assert result["specVersion"] == spec.ANALYSIS_SPEC_VERSION and result["wandasVersion"] == wd.__version__
    # Nothing is measured of the file beside the step asked for: no level, peak, crest factor, band or spectrum.
    assert set(result) == {"ok", "input", "stage", "specVersion", "wandasVersion", "elapsedMs"}
    # A scan names its step: the protocol refuses one without.
    with pytest.raises(Exception, match="stage"):
        validate_request({"cmd": "scan", "requestId": "r", "filePath": path, "recipe": ENTRY_RECIPE})


def _pascal(channel: int) -> dict:
    return {
        "channelIndex": channel,
        "expectedLabel": f"ch{channel}",
        "status": "calibrated",
        "source": "manual",
        "factor": 1.0,
        "unit": "Pa",
        "referenceValue": 2e-5,
    }


def _uncalibrated(channel: int) -> dict:
    return {**_pascal(channel), "status": "uncalibrated", "source": "default", "unit": "FS", "referenceValue": 1.0}


def _described(result: dict) -> tuple:
    scanned = result["input"]
    return (
        scanned["unit"],
        scanned["ref"],
        scanned["levelReferenceLabel"],
        scanned["calibrationStatus"],
        scanned["fullScale"],
    )


def test_scan_input_takes_its_unit_reference_and_label_from_wandas(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    tone = _sine(1000, 0.5)
    wav = _write(tmp_path / "tone.wav", [tone, tone])
    csv = tmp_path / "accel.csv"
    times = np.arange(tone.size) / RATE
    csv.write_text("time,accel\n" + "".join(f"{t},{v}\n" for t, v in zip(times, tone, strict=True)), encoding="utf-8")
    both = {"schemaVersion": 1, "channels": [_pascal(0), _pascal(1)]}
    first_only = {"schemaVersion": 1, "channels": [_pascal(0), _uncalibrated(1)]}

    assert _described(_scan(service, wav)) == ("FS", 1.0, "dBFS", "uncalibrated", True)
    # A CSV has no full scale: wandas leaves its unit empty and names its level against 1 input unit.
    assert _described(_scan(service, str(csv))) == ("", 1.0, "dB re 1 input unit", "uncalibrated", False)
    # Calibrated audio keeps its full scale (it can still clip) while its levels read in dB SPL.
    assert _described(_scan(service, wav, calibration=both)) == ("Pa", 2e-5, "dB SPL re 20 µPa", "calibrated", True)
    csv_profile = {"schemaVersion": 1, "channels": [{**_pascal(0), "expectedLabel": "accel"}]}
    calibrated_csv = _described(_scan(service, str(csv), calibration=csv_profile))
    assert calibrated_csv[2:] == ("dB SPL re 20 µPa", "calibrated", False)
    # Calibrated per channel: each channel scanned on its own reads its own reference.
    assert _described(_scan(service, wav, channels=[0], calibration=first_only)) == (
        "Pa",
        2e-5,
        "dB SPL re 20 µPa",
        "calibrated",
        True,
    )
    assert _described(_scan(service, wav, channels=[1], calibration=first_only)) == (
        "FS",
        1.0,
        "dBFS",
        "uncalibrated",
        True,
    )
    assert _scan(service, wav, calibration=first_only) == {
        "ok": False,
        "reason": "Selected channels have different units or level references; scan them separately",
        "lasting": True,
    }


def test_a_gain_correction_in_fs_scans_with_an_uncalibrated_channel_on_the_same_reference(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    tone = _sine(1000, 0.25)
    wav = _write(tmp_path / "pair.wav", [tone, tone])
    gain = {**_pascal(0), "factor": 2.0, "unit": "FS", "referenceValue": 1.0}
    profile = {"schemaVersion": 1, "channels": [gain, _uncalibrated(1)]}

    whole = _scan(service, wav, calibration=profile)

    assert whole["ok"] is True
    assert _described(whole) == ("FS", 1.0, "dBFS", "uncalibrated", True)
    assert _described(_scan(service, wav, channels=[0], calibration=profile)) == ("FS", 1.0, "dBFS", "calibrated", True)


def test_scan_repeats_exactly_and_names_the_region_asked_for(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "noise.wav", [np.random.default_rng(1).standard_normal(RATE * 2) * 0.1])

    first, second = _scan(service, path), _scan(service, path)
    asked = {"start": 0.5001, "end": 1.5}
    region = _scan(service, path, region=asked)

    first.pop("elapsedMs"), second.pop("elapsedMs")
    assert first == second
    # The region's ends exactly as sent, and another region's step is another kept answer.
    assert region["input"]["region"] == asked
    assert region["stage"]["data"] != first["stage"]["data"]


def test_scan_takes_the_region_from_the_payload_not_the_recipe(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    # Loud for the first second, quiet after it.
    path = _write(tmp_path / "steps.wav", [np.concatenate([_sine(1000, 0.5, 1.0), _sine(1000, 0.05, 1.0)])])
    late_slice = spectrum_recipe(RecipeSource(1, RATE), n_fft=1024, hpf_hz=20.0, trim=(1.0, None))

    loud = _scan(service, path, recipe=late_slice, region={"start": 0.0, "end": 1.0})
    quiet = _scan(service, path, recipe=late_slice, region={"start": 1.0, "end": 2.0})

    # The Recipe's own slice starts at 1 s (the quiet part); the spectrum is of the region asked for.
    assert _level_at(loud, 1000) - _level_at(quiet, 1000) == pytest.approx(20, abs=0.5)


def test_scan_runs_the_recipe_to_its_region_then_each_step_after_it() -> None:
    plans = scan_plans(ENTRY_RECIPE, 0.15, 1.85, RATE)

    # The shared steps end in the time slice, set to the region (the file's guarded ends left out).
    region = plans["region"].to_dict()
    assert [node["operation"] for node in region["nodes"]] == [
        "wandas.audio.highpass_filter",
        "wandas.frame.time_slice",
    ]
    assert [(step, [node["operation"] for node in plan.to_dict()["nodes"]]) for step, plan in plans["steps"]] == [
        ("node-2", ["wandas.audio.welch"])
    ]


def test_a_spectrum_step_has_the_recipes_own_settings(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1010, 0.5)])
    assert welch_params(ENTRY_RECIPE) == {"n_fft": 1024, "window": "hann"}
    finer = spectrum_recipe(RecipeSource(1, RATE), n_fft=8192, hpf_hz=20.0, trim=(0.0, None))
    assert welch_params(finer)["n_fft"] == 8192

    coarse_peak = _peak_hz(_scan(service, path))
    fine_peak = _peak_hz(_scan(service, path, recipe=finer))

    # 1024 points at 16 kHz resolve 15.6 Hz bins, 8192 points 2 Hz: only the finer step finds 1010 Hz.
    assert abs(fine_peak - 1010) <= 2 < abs(coarse_peak - 1010)


def test_scan_selects_channels_and_applies_calibration(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "pair.wav", [_sine(1000, 0.5), _sine(1000, 0.1)])
    profile = {
        "schemaVersion": 1,
        "channels": [
            {
                "channelIndex": 0,
                "expectedLabel": "ch0",
                "status": "calibrated",
                "source": "manual",
                "factor": 1.0,
                "unit": "m/s^2",
                "referenceValue": 1.0,
            },
            {
                "channelIndex": 1,
                "expectedLabel": "ch1",
                "status": "calibrated",
                "source": "manual",
                "factor": 2.0,
                "unit": "Pa",
                "referenceValue": 2e-5,
            },
        ],
    }

    result = _scan(service, path, channels=[1], calibration=profile)

    assert result["input"]["channels"] == [1]
    assert (result["input"]["unit"], result["input"]["ref"]) == ("Pa", 2e-5)
    # The channel's own tone (amplitude 0.1 FS), corrected by its factor of 2 and read against 20 µPa.
    assert _level_at(result, 1000) == pytest.approx(20 * np.log10(0.2 / 2e-5), abs=0.5)
    mixed = _scan(service, path, calibration=profile)
    assert mixed == {
        "ok": False,
        "reason": "Selected channels have different units or level references; scan them separately",
        "lasting": True,
    }


@pytest.mark.parametrize(
    ("payload", "message", "lasting"),
    [
        ({"region": {"start": 1.5, "end": 1.0}}, "region must satisfy", True),
        ({"region": {"start": 0.0, "end": 5.0}}, "region ends after the file", True),
        ({"region": {"start": 0.0, "end": 0.2}}, "Region is too short", True),
        ({"channels": [2]}, "channels must be distinct", True),
        ({"recipe": spectrum_recipe(RecipeSource(1, RATE), n_fft=1024)}, "time signal", True),
        # A Recipe wandas cannot load is a fault, not the user's request on this file: it may pass.
        ({"recipe": {"schema": "wandas.recipe", "version": 2}}, "", False),
    ],
)
def test_scan_failures_are_one_line_results(tmp_path: Path, payload: dict, message: str, lasting: bool) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1000, 0.5)])

    result = _scan(service, path, **payload)

    # The request does not fit the file: asking again for the same file and request fails the same way (lasting),
    # so the screen does not ask again every few seconds (a region past the file's end made the comparison blink).
    assert result == {"ok": False, "reason": result["reason"], **({"lasting": True} if lasting else {})}
    assert message in result["reason"] and "\n" not in result["reason"]


def test_scan_reports_unreadable_files(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt ")

    assert _scan(service, str(broken))["reason"].startswith("Unable to read audio")
    missing = _scan(service, str(tmp_path / "missing.wav"))
    assert missing["reason"].startswith("Audio file not found")
    # A file that cannot be read now may be readable later (put back, finished writing): it is asked again.
    assert "lasting" not in missing and "lasting" not in _scan(service, str(broken))


def test_scan_keeps_only_frames_that_were_already_open(tmp_path: Path) -> None:
    engine = AnalysisEngine()
    service = AnalysisService(engine)
    scanned = _write(tmp_path / "scanned.wav", [_sine(1000, 0.5)])
    shown = _write(tmp_path / "shown.wav", [_sine(1000, 0.5)])
    engine.get_file(shown)

    assert _scan(service, scanned)["ok"] and _scan(service, shown)["ok"]

    assert not engine.is_cached(scanned)
    assert engine.is_cached(shown)


def test_browser_scan_names_sources_by_content_and_keeps_them(tmp_path: Path) -> None:
    service = create_service()
    payload = (Path(_write(tmp_path / "tone.wav", [_sine(1000, 0.5)]))).read_bytes()
    service.engine.load("a/tone.wav", payload)
    service.engine.load("b/tone.wav", payload)

    first = _scan(service, "/sources/a/tone.wav")
    second = _scan(service, "/sources/b/tone.wav")

    assert first["input"]["id"].startswith("sha256:")
    assert first["input"]["id"] == second["input"]["id"]
    assert service.engine.is_loaded("/sources/a/tone.wav")


def _generate_entry100(out_dir: Path) -> list[Path]:
    module_spec = importlib.util.spec_from_file_location("entry100_generate", ENTRY100)
    assert module_spec is not None and module_spec.loader is not None
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module.generate(out_dir)


@pytest.fixture(scope="module")
def entry100_scan(tmp_path_factory: pytest.TempPathFactory) -> tuple[list[Path], dict[str, dict], float]:
    """The entry100 fixture scanned once: its files, each file's result, and the seconds the 100 scans took."""
    files = _generate_entry100(tmp_path_factory.mktemp("entry100"))
    service = AnalysisService(AnalysisEngine())
    _scan(service, str(files[0]))  # Imports and first-call setup are not part of the scan.
    started = time.perf_counter()
    results = {path.name: _scan(service, str(path)) for path in files}
    return files, results, time.perf_counter() - started


def test_scan_of_the_entry100_fixture_names_its_unreadable_file_and_shows_its_outliers(
    entry100_scan: tuple[list[Path], dict[str, dict], float],
    record_property: Callable[[str, object], None],
) -> None:
    files, results, elapsed = entry100_scan
    record_property("timing", f"100 scans took {elapsed:.2f}s (budget 10 s)")
    assert len(files) == 100
    assert [name for name, result in results.items() if not result["ok"]] == ["Rec_0012.wav"]
    assert results["mono_48k.wav"]["input"]["channels"] == [0]
    # The three outliers' spectrum at 3150 Hz stands at least 10 dB above their group's median.
    for outlier in ("L1_1500rpm_run018.wav", "L2_1500rpm_run043.wav", "L3_1500rpm_run060.wav"):
        group = outlier.split("_run")[0]
        levels = [_level_at(result, 3150.0) for name, result in results.items() if name.startswith(group + "_")]
        assert _level_at(results[outlier], 3150.0) - float(np.median(levels)) >= 10


# 10 s is the requirement on the developer's PC; runners' and loaded machines' speed varies (10.9-21 s seen).
@pytest.mark.perf
def test_scan_of_the_entry100_fixture_takes_under_ten_seconds(
    entry100_scan: tuple[list[Path], dict[str, dict], float],
) -> None:
    _, _, elapsed = entry100_scan
    assert elapsed < 10.0, f"100 scans took {elapsed:.2f}s"


def _with_step(recipe: dict, after: str, operation: str, version: int, entries: list | None = None) -> dict:
    """`recipe` with one more step after node `after`, as the step bar's ＋ adds it."""
    copy = json.loads(json.dumps(recipe))
    new_id = f"node-{len(copy['nodes'])}"
    for node in copy["nodes"]:
        node["inputs"] = [new_id if item == after else item for item in node["inputs"]]
    # A node comes after the node it reads, as a Recipe lists them.
    at = next(index + 1 for index, node in enumerate(copy["nodes"]) if node["id"] == after)
    copy["nodes"].insert(
        at,
        {
            "id": new_id,
            "operation": operation,
            "version": version,
            "inputs": [after],
            "params": {"$type": "map", "entries": entries or []},
        },
    )
    if copy["output"] == after:
        copy["output"] = new_id
    return copy


def _float(value: float) -> float:
    # The entry Recipe is schema 3 (wandas 0.10): a float is a plain JSON number.
    return float(value)


def test_scan_runs_every_step_after_the_slice_on_the_frame_before(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tones.wav", [_sine(200, 0.5) + _sine(3150, 0.5)])
    plain = _scan(service, path)
    # A low-pass between the region and the average spectrum: the spectrum is of the filtered signal.
    filtered = _with_step(ENTRY_RECIPE, "node-1", "wandas.audio.lowpass_filter", 1, [["cutoff", _float(1000.0)]])

    result = _scan(service, path, recipe=filtered)

    assert result["stage"]["frame"] == plain["stage"]["frame"] == "SpectralFrame"
    # The 3.15 kHz tone is filtered out; the 200 Hz one is now the largest.
    assert _level_at(result, 3150) < _level_at(plain, 3150) - 20
    assert abs(_peak_hz(result) - 200) <= RATE / spec.WELCH_N_FFT


def test_scan_describes_any_step_and_names_its_frame(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1000, 0.5)])
    # The average spectrum swapped for a spectrogram: the chain ends in a SpectrogramFrame.
    stft = json.loads(json.dumps(ENTRY_RECIPE))
    stft["nodes"][2] = {
        **stft["nodes"][2],
        "operation": "wandas.audio.stft",
        "version": 2,
        "params": {"$type": "map", "entries": []},
    }

    view = _scan(service, path, recipe=stft, stage="node-2")["stage"]

    assert (view["frame"], view["kind"], view["x"], view["yAxis"], view["quantity"]) == (
        "SpectrogramFrame",
        "heatmap",
        "time",
        "frequency",
        "level",
    )
    cells = _kept(view)
    assert cells.ys is not None and cells.values.shape == (cells.ys.size, cells.xs.size)
    # Columns at the region's ends, whose windows stick out of it, are marked; the rest are whole.
    assert cells.whole is not None
    whole = cells.whole.tolist()
    assert len(whole) == cells.xs.size and not whole[0] and not whole[-1] and any(whole)
    # A step before the slice runs over the whole file: its signal over time spans the file.
    hpf = _scan(service, path, stage="node-0", region={"start": 0.5, "end": 1.0})["stage"]
    assert (hpf["frame"], hpf["kind"], hpf["x"], hpf["quantity"]) == ("ChannelFrame", "line", "time", "value")
    assert _span(hpf)[0] < 0.01 and _span(hpf)[1] > 1.99
    # The time slice's Frame is the region.
    region = _scan(service, path, stage="node-1", region={"start": 0.5, "end": 1.0})["stage"]
    assert _span(region)[0] >= 0.5 and _span(region)[1] <= 1.0
    spectrum = _scan(service, path, stage="node-2")["stage"]
    assert (spectrum["kind"], spectrum["x"], spectrum["xScale"]) == ("line", "frequency", "log")
    # The input is a stage too: the file's signal over the whole file, before any step.
    raw = _scan(service, path, stage="node-input", region={"start": 0.5, "end": 1.0})["stage"]
    assert (raw["frame"], raw["kind"], raw["x"]) == ("ChannelFrame", "line", "time")
    assert _span(raw)[0] < 0.01 and _span(raw)[1] > 1.99
    # A scan tells what each step's result is and the key of its kept answer, with no point of it (the figures are
    # the figure service's, drawn from the kept answer); the sound itself says it is one.
    words = {"frame", "kind", "x", "xScale", "quantity", "unit", "yAxis", "pair", "signal", "measure", "data"}
    for told in (raw, spectrum, hpf, region, view):
        assert set(told) <= words, sorted(set(told) - words)
    assert raw["signal"] is True and hpf["signal"] is True
    assert "signal" not in spectrum
    # A node the Recipe does not have is not a step to show.
    assert _scan(service, path, stage="node-noct")["ok"] is False


def _hits(times: list[float], seconds: float = 2.0) -> np.ndarray:
    """Short decaying 500 Hz bursts starting at `times` (s), peaking at 1."""
    signal = np.zeros(int(seconds * RATE))
    burst = np.sin(2 * np.pi * 500 * np.arange(800) / RATE) * np.exp(-np.arange(800) / 160)
    for at in times:
        start = int(at * RATE)
        signal[start : start + burst.size] += burst / np.abs(burst).max()
    return signal


def test_a_trigger_right_after_the_input_finds_its_events_over_the_whole_file(tmp_path: Path) -> None:
    # ＋ right after the input on the default chain: the trigger comes before the high-pass and the slice, so it runs
    # over the whole file, and wandas will not end a Recipe in its segments.
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "hits.wav", [_hits([0.3, 0.8, 1.3])])
    chain = json.loads(json.dumps(ENTRY_RECIPE))
    head = chain["nodes"][0]
    trigger = {
        "id": "node-t",
        "operation": "wandas.audio.trigger",
        "version": 1,
        "inputs": list(head["inputs"]),
        "params": {"$type": "map", "entries": [["duration", _float(0.2)], ["threshold", _float(0.5)]]},
    }
    head["inputs"] = ["node-t"]
    chain["nodes"].insert(0, trigger)
    # As the step bar asks for the trigger's picture: the chain cut at it.
    cut = {**json.loads(json.dumps(chain)), "nodes": [trigger], "output": "node-t"}
    for recipe in (cut, chain):
        events = _scan(service, path, recipe=recipe, stage="node-t")
        assert events["ok"] is True, events
        assert events["stage"]["frame"] == "ChannelFrameSegments"
        assert [round(event["time"], 2) for event in events["stage"]["events"]] == [0.3, 0.8, 1.3]
        # Each event by its number and when it triggered, with no point of its signal.
        assert all(set(event) == {"id", "time"} for event in events["stage"]["events"])
    # The steps before the slice that take a time signal cannot follow it: the high-pass is named as the step failing.
    after = _scan(service, path, recipe=chain, stage=head["id"])
    assert after["ok"] is False and after["failedStep"] == head["id"]
    # Events left out on the comparison: a drop after it takes its segments, and their mean after that is a Frame.
    dropped = json.loads(json.dumps(cut))
    dropped["nodes"].append(
        {
            "id": "node-d",
            "operation": "wandas.segments.drop",
            "version": 1,
            "inputs": ["node-t"],
            "params": {"$type": "map", "entries": [["event_ids", {"$type": "list", "items": [0]}]]},
        }
    )
    dropped["nodes"].append(
        {
            "id": "node-m",
            "operation": "wandas.segments.average",
            "version": 1,
            "inputs": ["node-d"],
            "params": {"$type": "map", "entries": []},
        }
    )
    dropped["output"] = "node-m"
    kept = _scan(service, path, recipe=dropped, stage="node-d")
    assert kept["ok"] is True, kept
    assert [round(event["time"], 2) for event in kept["stage"]["events"]] == [0.8, 1.3]
    mean = _scan(service, path, recipe=dropped, stage="node-m")
    assert mean["ok"] is True and mean["stage"]["frame"] == "ChannelFrame"


def test_a_trigger_after_the_channel_picked_fires_on_that_channel_over_the_whole_file(tmp_path: Path) -> None:
    # As the app sends it: get_channel heads the chain, and the trigger right after it (the failure in #648).
    service = AnalysisService(AnalysisEngine())
    tone = 0.3 * np.sin(2 * np.pi * 1000 * np.arange(2 * RATE) / RATE)
    path = _write(tmp_path / "two.wav", [tone, _hits([0.3, 0.8, 1.3])])
    recipe = {
        **json.loads(json.dumps(ENTRY_RECIPE)),
        "nodes": [
            {
                "id": "node-channel",
                "operation": "wandas.frame.get_channel",
                "version": 1,
                "inputs": ["input-0"],
                "params": {"$type": "map", "entries": [["channel_idx", 1]]},
            },
            {
                "id": "node-t",
                "operation": "wandas.audio.trigger",
                "version": 1,
                "inputs": ["node-channel"],
                "params": {"$type": "map", "entries": [["duration", _float(0.2)], ["threshold", _float(0.5)]]},
            },
        ],
        "output": "node-t",
    }
    events = _scan(service, path, recipe=recipe, stage="node-t")
    assert events["ok"] is True, events
    # The second channel's hits only: the first channel's tone never crosses the level.
    assert [round(event["time"], 2) for event in events["stage"]["events"]] == [0.3, 0.8, 1.3]


def test_a_trigger_step_keeps_each_event_and_the_steps_after_it_take_them(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    hits = _hits([0.3, 0.8, 1.3])
    path = _write(tmp_path / "hits.wav", [hits, 0.5 * hits])
    trigger = [["duration", _float(0.2)], ["pre", _float(0.01)], ["threshold", _float(0.5)]]
    # Region, trigger, then the mean of the events: the chain the step bar builds with ＋.
    averaged = _with_step(
        _with_step(ENTRY_RECIPE, "node-1", "wandas.audio.trigger", 1, trigger), "node-3", "wandas.segments.average", 1
    )

    events = _scan(service, path, recipe=averaged, stage="node-3")["stage"]
    mean = _scan(service, path, recipe=averaged, stage="node-4")["stage"]

    # Each event is its own line over the time from its trigger, numbered by wandas' event IDs.
    assert (events["frame"], events["kind"], events["x"], events["quantity"]) == (
        "ChannelFrameSegments",
        "line",
        "time",
        "value",
    )
    assert [event["id"] for event in events["events"]] == [0, 1, 2]
    assert [round(event["time"], 2) for event in events["events"]] == [0.3, 0.8, 1.3]
    lines = _kept(events)
    assert lines.rows is not None and lines.rows.shape == (3, lines.xs.size)
    assert lines.xs[0] == pytest.approx(-0.01, abs=1e-3) and lines.xs[-1] < 0.19
    # Every sample of each event is kept, at the samples' own step, so each hit keeps its peak (channels averaged:
    # 1 and 0.5).
    assert np.diff(lines.xs) == pytest.approx(1 / RATE)
    assert float(np.abs(lines.rows).max()) > 0.7
    # The mean of the events is a short time signal (the entry Recipe's average spectrum follows it).
    assert mean["frame"] == "ChannelFrame" and _span(mean)[1] - _span(mean)[0] < 0.2
    # The transfer function averaged over the events, ch2 over ch1: half, at every frequency the hits excite.
    transfer = _with_step(
        _with_step(
            _with_step(ENTRY_RECIPE, "node-1", "wandas.audio.trigger", 1, trigger),
            "node-3",
            "wandas.segments.transfer_function",
            1,
        ),
        "node-4",
        "wandas.frame.select_pair",
        1,
        [["input", 0], ["output", 1]],
    )
    gain = _scan(service, path, recipe=transfer, stage="node-5")["stage"]
    assert gain["frame"] == "TransferFunctionFrame" and gain["pair"] == {"output": 2, "input": 1}
    levels = _kept(gain)
    near = levels.values[(levels.xs > 400) & (levels.xs < 600)]
    assert near.size and bool(np.all(np.abs(near - 20 * np.log10(0.5)) < 0.1))
    # Events left out on the comparison: wandas.segments.drop after the trigger, and the steps after it take the rest.
    dropped = _with_step(
        _with_step(
            _with_step(ENTRY_RECIPE, "node-1", "wandas.audio.trigger", 1, trigger),
            "node-3",
            "wandas.segments.drop",
            1,
            [["event_ids", {"$type": "list", "items": [0, 2]}]],
        ),
        "node-4",
        "wandas.segments.average",
        1,
    )
    assert [event["id"] for event in _scan(service, path, recipe=dropped, stage="node-4")["stage"]["events"]] == [1]
    assert _scan(service, path, recipe=dropped, stage="node-5")["stage"]["frame"] == "ChannelFrame"

    # Measured against the base slot's recording after the events' mean: both Recipes drop at the same step, each
    # its own events (none of the base's), so the base goes through the same steps.
    def paired(ids: list[int]) -> dict:
        with_drop = _with_step(
            _with_step(ENTRY_RECIPE, "node-1", "wandas.audio.trigger", 1, trigger),
            "node-3",
            "wandas.segments.drop",
            1,
            [["event_ids", {"$type": "list", "items": ids}]],
        )
        return _with_step(
            _with_step(with_drop, "node-4", "wandas.segments.average", 1), "node-5", "wandas.audio.coherence", 2
        )

    base = _write(tmp_path / "base.wav", [hits])
    against = {"filePath": base, "step": "node-6", "recipe": paired([])}
    coherent = _scan(service, path, recipe=paired([1]), stage="node-6", reference=against)
    assert coherent["ok"] is True and coherent["stage"]["pair"] == {"output": 2, "input": 1, "base": True}
    # A level nothing crosses: still the trigger's result, with no event in it.
    high = [["duration", _float(0.2)], ["pre", _float(0.01)], ["threshold", _float(5.0)]]
    none = _with_step(ENTRY_RECIPE, "node-1", "wandas.audio.trigger", 1, high)
    empty = _scan(service, path, recipe=none, stage="node-3")["stage"]
    assert (empty["frame"], empty["kind"], empty["events"]) == ("ChannelFrameSegments", "line", [])


def test_a_step_that_fails_on_a_file_is_named(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1000, 0.5)])
    # welch takes a time signal: after the average spectrum it fails.
    twice = _with_step(ENTRY_RECIPE, "node-2", "wandas.audio.welch", 2)

    result = _scan(service, path, recipe=twice)

    assert result["ok"] is False and result["failedStep"] == "node-3"
    assert "\n" not in result["reason"] and result["reason"]
    # A step before the slice too, by its id in the Recipe.
    above = json.loads(json.dumps(ENTRY_RECIPE))
    above["nodes"][0]["params"]["entries"] = [["cutoff", _float(9000.0)]]
    failed = _scan(service, path, recipe=above)
    assert failed["ok"] is False and failed["failedStep"] == "node-0"
    assert _scan(service, path, stage="node-9")["reason"] == "The Recipe has no step 'node-9'"


def test_a_steps_description_comes_alone(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1000, 0.5)])
    # The comparison asks for one step's Frame at a time, and nothing else is measured of the file.
    for stage in ("node-0", "node-1", "node-2"):
        result = _scan(service, path, stage=stage)
        assert set(result) == {"ok", "input", "stage", "specVersion", "wandasVersion", "elapsedMs"}


def _with_channel(recipe: dict, index: int) -> dict:
    """The webview's withChannel: a get_channel step at the head of the chain (channelSelection.ts)."""
    copy = json.loads(json.dumps(recipe))
    for node in copy["nodes"]:
        node["inputs"] = ["node-channel" if item == "input-0" else item for item in node["inputs"]]
    copy["nodes"].insert(
        0,
        {
            "id": "node-channel",
            "operation": "wandas.frame.get_channel",
            "version": 1,
            "inputs": ["input-0"],
            "params": {"$type": "map", "entries": [["channel_idx", index]]},
        },
    )
    return copy


def test_a_recipe_that_starts_with_get_channel_scans_that_channel(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "two.wav", [_sine(1000, 0.5), _sine(3150, 0.1)])
    # A step's values are of that channel only (its 3.15 kHz tone, not the 1 kHz one of ch 1).
    welch = next(node["id"] for node in ENTRY_RECIPE["nodes"] if node["operation"] == "wandas.audio.welch")
    ch2_recipe = _with_channel(ENTRY_RECIPE, 1)
    staged = dispatch(
        validate_request({"cmd": "scan", "requestId": "r", "filePath": path, "recipe": ch2_recipe, "stage": welch}),
        service,
    )
    assert staged["ok"] is True
    assert 2800 < _peak_hz(staged) < 3500


def test_a_channel_row_of_a_file_with_mixed_units_scans_as_that_channel_alone(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "two.wav", [_sine(1000, 0.5), _sine(3150, 0.1)])
    # ch 1 in pascals, ch 2 left in full scale: the two do not compare, but each row of the file does.
    first_only = {"schemaVersion": 1, "channels": [_pascal(0), _uncalibrated(1)]}
    for index, unit, status in ((0, "Pa", "calibrated"), (1, "FS", "uncalibrated")):
        result = _scan(service, path, recipe=_with_channel(ENTRY_RECIPE, index), calibration=first_only)
        assert result["ok"] is True
        assert (result["input"]["unit"], result["input"]["calibrationStatus"]) == (unit, status)
    assert _scan(service, path, calibration=first_only)["ok"] is False


def test_the_input_and_a_step_before_the_slice_do_not_need_a_region_as_long_as_one_fft(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    # 0.2 s: nothing is left once the first and last 0.15 s are skipped, but the input is of the whole file.
    path = _write(tmp_path / "short.wav", [_sine(1000, 0.5, seconds=0.2)])
    recipe = _with_channel(ENTRY_RECIPE, 0)
    for stage in ("node-input", "node-channel"):
        drawn = _scan(service, path, recipe=recipe, stage=stage)
        assert drawn["ok"] is True and drawn["stage"]["signal"] is True and _kept(drawn["stage"]).values.size
    spectrum = _scan(service, path, recipe=recipe)
    assert spectrum["ok"] is False and spectrum["reason"].startswith("Region is too short")


def test_the_input_is_the_channel_the_chain_picks_not_the_channels_mean(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "two.wav", [_sine(1000, 0.5), _sine(3150, 0.1)])
    for index, amplitude in ((0, 0.5), (1, 0.1)):
        request = {"cmd": "scan", "requestId": "r", "filePath": path, "stage": "node-input"}
        drawn = dispatch(validate_request({**request, "recipe": _with_channel(ENTRY_RECIPE, index)}), service)
        assert drawn["ok"] is True
        samples = _kept(drawn["stage"]).values
        # The channel's own peak (the mean of the two would peak near 0.3), as its legend names it.
        assert float(samples.max()) == pytest.approx(amplitude, rel=0.02)
        assert float(samples.min()) == pytest.approx(-amplitude, rel=0.02)
    # A channel the file lacks fails as the channel step, as it does when that step itself is asked for.
    request = {"cmd": "scan", "requestId": "r", "filePath": path, "recipe": _with_channel(ENTRY_RECIPE, 5)}
    missing = dispatch(validate_request({**request, "stage": "node-input"}), service)
    assert missing["ok"] is False and missing["failedStep"] == "node-channel"


def test_a_median_welch_is_never_split_into_parts(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import scan_service

    monkeypatch.setattr(scan_service, "WELCH_PART_SEGMENTS", 2)
    frame = wd.from_numpy(np.zeros((1, 48_000)), sampling_rate=48_000)
    # The median of all segments is not a mean of the parts' medians: the step runs over the whole frame.
    assert scan_service.welch_in_parts(None, frame, {"n_fft": 1024, "average": "median"}) is None  # type: ignore[arg-type]


def test_a_long_region_s_welch_is_computed_in_parts_with_the_same_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services import scan_service

    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "long.wav", [_sine(1000, 0.5, seconds=6.0), _sine(3150, 0.1, seconds=6.0)])
    kept = STORE.get(_scan(service, path)["stage"]["data"])
    assert kept is not None
    single = kept.values.copy()
    STORE.clear()
    # Parts of a few segments: the result is the segments' mean power all the same.
    monkeypatch.setattr(scan_service, "WELCH_PART_SEGMENTS", 37)
    parted = _scan(AnalysisService(AnalysisEngine()), path)
    # To a hundredth of a dB at every bin, where there is signal (far below it is rounding noise of a pure tone).
    split = STORE.get(parted["stage"]["data"])
    assert split is not None
    heard = single > -150
    assert heard.any() and np.abs(split.values[heard] - single[heard]).max() <= 0.01


def test_a_cross_channel_step_pairs_the_scanned_recording_with_the_reference_recording(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    noise = np.random.default_rng(5).standard_normal((2, 2 * RATE)) * 0.1
    base = _write(tmp_path / "base.wav", [noise[0]])
    # The same signal plus as much again unrelated: coherence about 0.5; an unrelated one: near 0.
    alike = _write(tmp_path / "alike.wav", [noise[0] + noise[1]])
    other = _write(tmp_path / "other.wav", [noise[1]])
    coherence = json.loads(json.dumps(ENTRY_RECIPE))
    coherence["nodes"][2] = {**coherence["nodes"][2], "operation": "wandas.audio.coherence", "version": 2}
    coherence["nodes"][2]["params"] = {"$type": "map", "entries": []}
    reference = {"filePath": base, "step": "node-2", "recipe": coherence}

    paired = _scan(service, alike, recipe=coherence, stage="node-2", reference=reference)
    near = paired["stage"]
    far = _scan(service, other, recipe=coherence, stage="node-2", reference=reference)["stage"]
    # The base side's own calibration goes with the scan: a pair is calibrated only when both sides are (R4).
    assert paired["input"]["baseCalibrationStatus"] == "uncalibrated"

    # The pair is the recording over the base one, said so (not two channels of one recording).
    assert near["pair"] == far["pair"] == {"output": 2, "input": 1, "base": True}
    assert 0.35 < np.median(_kept(near).values) < 0.65
    assert np.median(_kept(far).values) < 0.1
    # Alone, a one-channel recording has only itself: nothing is drawn.
    assert _scan(service, alike, recipe=coherence, stage="node-2")["stage"]["kind"] == "none"
    # A reference at another sampling rate cannot be paired: this file's ✕, not the step's.
    slow = _write(tmp_path / "slow.wav", [noise[0][:RATE]], rate=RATE // 2)
    refused = _scan(service, alike, recipe=coherence, stage="node-2", reference={**reference, "filePath": slow})
    assert refused["ok"] is False and "failedStep" not in refused
    # A base too short for this region, or for the step, is said to be the base's, not this recording's step.
    brief = _write(tmp_path / "brief.wav", [noise[0][: RATE // 3]])
    region = {"start": 1.0, "end": 1.9}
    for refused in (
        _scan(
            service, alike, recipe=coherence, stage="node-2", region=region, reference={**reference, "filePath": brief}
        ),
        _scan(service, alike, recipe=coherence, stage="node-2", reference={**reference, "filePath": brief}),
    ):
        assert refused["ok"] is False and "failedStep" not in refused and "base recording" in refused["reason"]
    # A CSD keeps its auto-spectra: the coherence derived from it after the pairing still runs.
    derived = json.loads(json.dumps(coherence))
    derived["nodes"][2] = {**derived["nodes"][2], "operation": "wandas.audio.csd", "version": 2}
    derived["nodes"].append(
        {
            "id": "node-3",
            "operation": "wandas.cross_spectral.coherence",
            "version": 1,
            "inputs": ["node-2"],
            "params": {"$type": "map", "entries": []},
        }
    )
    derived["output"] = "node-3"
    through = _scan(service, alike, recipe=derived, stage="node-3", reference={**reference, "recipe": derived})["stage"]
    assert through["pair"] == {"output": 2, "input": 1, "base": True}
    assert 0.35 < np.median(_kept(through).values) < 0.65


def test_overlapping_scans_leave_the_dask_scheduler_as_it_was() -> None:
    import threading

    import dask

    from services import scan_service

    before = dask.config.get("scheduler", None)
    a_in, b_in, a_out = threading.Event(), threading.Event(), threading.Event()
    seen: list[object] = []

    def scan_a() -> None:
        with scan_service._synchronous_dask():
            a_in.set()
            b_in.wait(5)
        a_out.set()

    def scan_b() -> None:
        a_in.wait(5)
        with scan_service._synchronous_dask():
            b_in.set()
            a_out.wait(5)
            # Scan A's end must not turn scan B's computes threaded.
            seen.append(scan_service._synchronous.get())

    threads = [threading.Thread(target=scan_a), threading.Thread(target=scan_b)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)

    assert seen == [True]
    assert dask.config.get("scheduler", None) in (before, scan_service._per_thread_scheduler)


def test_a_running_scan_leaves_other_threads_dask_computes_threaded() -> None:
    import threading

    import dask.array as da

    from services.scan_service import _synchronous_dask

    def compute_thread() -> int:
        # A one-chunk array's single task runs on the computing thread only under the synchronous scheduler.
        array = da.from_array(np.zeros(4), chunks=4).map_blocks(
            lambda block: np.full(block.shape, threading.get_ident())
        )
        return int(array.compute()[0])

    in_scan = threading.Event()
    scan_done = threading.Event()
    seen: dict[str, tuple[int, int]] = {}

    def scanning() -> None:
        with _synchronous_dask():
            in_scan.set()
            seen["scan"] = (threading.get_ident(), compute_thread())
            scan_done.wait(5)

    def other() -> None:
        in_scan.wait(5)
        seen["other"] = (threading.get_ident(), compute_thread())
        scan_done.set()

    threads = [threading.Thread(target=scanning), threading.Thread(target=other)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(10)

    scan_thread, scan_task = seen["scan"]
    other_thread, other_task = seen["other"]
    assert scan_task == scan_thread
    assert other_task != other_thread


def test_importing_and_creating_the_browser_service_leaves_the_dask_scheduler_alone() -> None:
    import subprocess
    import sys

    code = "import dask, browser_service; browser_service.create_service(); print(dask.config.get('scheduler', None))"
    output = subprocess.run(
        [sys.executable, "-c", code], cwd=Path(__file__).parent, capture_output=True, text=True, check=True
    ).stdout
    assert output.strip() == "None"


def test_a_file_replaced_within_the_same_millisecond_is_another_input(tmp_path: Path) -> None:
    """The scan's input id names the version read: a rewrite within the same millisecond, or a
    copy that keeps the old modification time and size, is read again and named anew (never by a truncated mtime)."""
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1000, 0.5)])
    first = _scan(service, path)
    mtime = Path(path).stat().st_mtime_ns
    # Same size, a modification time 1 µs later (the same millisecond), other content.
    _write(tmp_path / "tone.wav", [_sine(1000, 0.1)])
    import os

    os.utime(path, ns=(mtime + 1_000, mtime + 1_000))
    second = _scan(service, path)
    assert second["input"]["id"] != first["input"]["id"]
    assert _level_at(second, 1000) < _level_at(first, 1000) - 10
    # Replaced by a copy carrying the old modification time (cp -p): the same mtime and size, another file.
    replacement = _write(tmp_path / "copy.wav", [_sine(1000, 0.5)])
    os.utime(replacement, ns=(mtime, mtime))
    os.replace(replacement, path)
    third = _scan(service, path)
    assert third["input"]["id"] not in {first["input"]["id"], second["input"]["id"]}
    assert _level_at(third, 1000) == pytest.approx(_level_at(first, 1000), abs=0.01)


def test_a_step_over_the_store_budget_is_not_named_by_a_key_it_was_refused(tmp_path: Path) -> None:
    """Every ``data`` key a scan gives is held by the store (the figure service finds it), so a figure never counts a
    key the store refused as let go, and the comparison never scans the step again for it: over the budget
    the result says ``stageDataTooLarge`` instead, on every scan of that step."""
    from services.stage_combine import STAGE_DATA_BUDGET_BYTES as STAGE_BUDGET
    from services.stage_combine import STORE

    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1000, 0.5)])
    STORE.clear()
    try:
        STORE.resize(1)
        for _again in range(2):
            result = _scan(service, path, stage="node-0")
            assert result["ok"] is True and "data" not in result["stage"]
            assert result["stageDataTooLarge"] is True
        STORE.resize(STAGE_BUDGET)
        kept = _scan(service, path, stage="node-0")
        assert "stageDataTooLarge" not in kept
        key = kept["stage"]["data"]
        assert STORE.has(key)
    finally:
        STORE.resize(STAGE_BUDGET)
        STORE.clear()
