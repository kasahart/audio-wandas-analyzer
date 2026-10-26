from __future__ import annotations

import importlib.util
import json
import os
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import analysis_spec as spec
from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from browser_service import create_service
from command_dispatch import dispatch, validate_request
from protocol_schema import DEFINITIONS, first_violation
from recipe_builder import RecipeSource, spectrum_recipe
from scan_service import log_spectrum, passband, scan_plans, welch_params

ENTRY_RECIPE = json.loads((Path(__file__).parent / "recipes" / "entry-scan.recipe.json").read_text())
ENTRY100 = Path(__file__).parents[1] / "src" / "test" / "fixtures" / "entry100" / "generate.py"
RATE = 16000


def _write(path: Path, channels: list[np.ndarray], rate: int = RATE) -> str:
    sf.write(path, np.stack(channels, axis=1), rate, subtype="FLOAT")
    return str(path)


def _sine(frequency: float, amplitude: float, seconds: float = 2.0, rate: int = RATE) -> np.ndarray:
    return amplitude * np.sin(2 * np.pi * frequency * np.arange(int(seconds * rate)) / rate)


def _scan(service: AnalysisService, path: str, **payload: object) -> dict:
    request = validate_request({"cmd": "scan", "requestId": "r", "filePath": path, "recipe": ENTRY_RECIPE, **payload})
    result = dispatch(request, service)
    assert first_violation(DEFINITIONS["ScanResult"], result) is None
    return result


def _band(result: dict, channel: int, center: float) -> float | None:
    return result["thirdOctDb"][channel][spec.THIRD_OCTAVE_CENTERS_HZ.index(center)]


def test_scan_measures_the_analysis_spec_metrics(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tones.wav", [_sine(1000, 0.5), _sine(3150, 0.1)])

    result = _scan(service, path)

    assert result["ok"] is True
    assert result["input"] == {
        "id": json.dumps(
            [str(Path(path).resolve()), Path(path).stat().st_size, Path(path).stat().st_mtime_ns // 10**6]
        ),
        "fs": RATE,
        "channels": [0, 1],
        "durationS": 2.0,
        "unit": "FS",
        "ref": 1.0,
    }
    rms_db = [20 * np.log10(0.5 / np.sqrt(2)), 20 * np.log10(0.1 / np.sqrt(2))]
    # A-weighting is 0 dB at 1 kHz and +1.2 dB at 3.15 kHz.
    assert result["leqDbA"] == pytest.approx([rms_db[0], rms_db[1] + 1.2], abs=0.3)
    assert result["peakHz"][0] == 1000
    assert abs(result["peakHz"][1] - 3150) <= RATE / spec.WELCH_N_FFT
    assert [len(row) for row in result["spectrumDb"]] == [spec.SPECTRUM_POINTS] * 2
    assert [len(row) for row in result["thirdOctDb"]] == [len(spec.THIRD_OCTAVE_CENTERS_HZ)] * 2
    assert _band(result, 0, 1000.0) == pytest.approx(rms_db[0], abs=0.5)
    assert _band(result, 1, 3150.0) == pytest.approx(rms_db[1], abs=0.5)
    # 20 Hz is measured (wandas 0.10); 8 kHz is above 0.88 x Nyquist at 16 kHz.
    assert _band(result, 0, 20.0) is not None
    assert _band(result, 0, 8000.0) is None
    assert _band(result, 0, 6300.0) is not None
    assert result["crest"] == pytest.approx([np.sqrt(2)] * 2, abs=0.01)
    assert result["specVersion"] == spec.ANALYSIS_SPEC_VERSION
    assert all(value == round(value, 2) for value in result["leqDbA"])


def test_scan_repeats_exactly_and_names_the_condition(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "noise.wav", [np.random.default_rng(1).standard_normal(RATE * 2) * 0.1])

    first, second = _scan(service, path), _scan(service, path)
    region = _scan(service, path, region={"start": 0.5, "end": 1.5})

    first.pop("elapsedMs"), second.pop("elapsedMs")
    assert first == second
    assert region["conditionId"] != first["conditionId"]
    other_recipe = spectrum_recipe(RecipeSource(1, RATE), n_fft=2048, hpf_hz=40.0, trim=(0.0, None))
    assert _scan(service, path, recipe=other_recipe)["conditionId"] != first["conditionId"]


def test_scan_takes_the_region_from_the_payload_not_the_recipe(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    # Loud for the first second, quiet after it.
    path = _write(tmp_path / "steps.wav", [np.concatenate([_sine(1000, 0.5, 1.0), _sine(1000, 0.05, 1.0)])])
    late_slice = spectrum_recipe(RecipeSource(1, RATE), n_fft=1024, hpf_hz=20.0, trim=(1.0, None))

    loud = _scan(service, path, recipe=late_slice, region={"start": 0.0, "end": 1.0})

    assert loud["leqDbA"][0] == pytest.approx(20 * np.log10(0.5 / np.sqrt(2)), abs=0.5)


def test_scan_runs_the_recipe_to_its_region_then_its_branches() -> None:
    plans = scan_plans(ENTRY_RECIPE, 0.15, 1.85, RATE)

    # The shared steps end in the time slice, set to the measured region (the file's guarded ends left out).
    region = plans["region"].to_dict()
    assert [node["operation"] for node in region["nodes"]] == [
        "wandas.audio.highpass_filter",
        "wandas.frame.time_slice",
    ]
    assert [node["operation"] for node in plans["welch"].to_dict()["nodes"]] == ["wandas.audio.welch"]
    noct = plans["noct"].to_dict()["nodes"][0]
    assert noct["operation"] == "wandas.audio.noct_spectrum"
    assert dict(noct["params"]["entries"])["n"] == 3
    assert len(plans["sha256"]) == 64
    # The Recipe's own welch settings are the branch's.
    finer = spectrum_recipe(RecipeSource(1, RATE), n_fft=2048, hpf_hz=20.0, trim=(0.0, None))
    assert (
        dict(scan_plans(finer, 0.15, 1.85, RATE)["welch"].to_dict()["nodes"][0]["params"]["entries"])["n_fft"] == 2048
    )


def test_scan_takes_the_spectrum_settings_from_the_recipes_average_step(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1010, 0.5)])
    assert welch_params(ENTRY_RECIPE) == {"n_fft": 1024, "window": "hann"}
    finer = spectrum_recipe(RecipeSource(1, RATE), n_fft=8192, hpf_hz=20.0, trim=(0.0, None))
    assert welch_params(finer)["n_fft"] == 8192

    coarse_peak = _scan(service, path)["peakHz"][0]
    fine_peak = _scan(service, path, recipe=finer)["peakHz"][0]

    # 1024 points at 16 kHz resolve 15.6 Hz bins, 8192 points 2 Hz: only the finer step finds 1010 Hz.
    assert abs(fine_peak - 1010) <= 2 < abs(coarse_peak - 1010)


def test_scan_leaves_out_bands_outside_the_recipes_passband(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "noise.wav", [np.random.default_rng(2).standard_normal(RATE * 2) * 0.1])
    assert passband(ENTRY_RECIPE) == (20.0, float("inf"))
    hpf100 = spectrum_recipe(RecipeSource(1, RATE), n_fft=1024, hpf_hz=100.0, trim=(0.0, None))
    assert passband(hpf100)[0] == 100.0

    result = _scan(service, path, recipe=hpf100)

    assert _band(result, 0, 80.0) is None
    assert _band(result, 0, 100.0) is not None
    assert _band(_scan(service, path), 0, 31.5) is not None


def test_the_spectrum_is_log_spaced_from_20_hz_to_nyquist() -> None:
    freqs = np.linspace(0, 8000, 513)
    levels = np.where(np.abs(freqs - 3000) < 1, 0.0, -60.0)[None, :]

    spectrum = log_spectrum(levels, freqs, 192, 8000.0)

    edges = np.geomspace(20.0, 8000.0, 193)
    peak = int(np.argmax(spectrum[0]))
    assert edges[peak] <= 3000 < edges[peak + 1]
    # The low points are narrower than a 15.6 Hz bin: interpolated, never empty.
    assert np.isfinite(spectrum).all()
    assert spectrum.shape == (1, 192)


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
    assert len(result["leqDbA"]) == len(result["spectrumDb"]) == 1
    assert result["leqDbA"][0] == pytest.approx(20 * np.log10(0.2 / np.sqrt(2) / 2e-5), abs=0.3)
    mixed = _scan(service, path, calibration=profile)
    assert mixed == {"ok": False, "reason": "Selected channels have different units; scan them separately"}


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"region": {"start": 1.5, "end": 1.0}}, "region must satisfy"),
        ({"region": {"start": 0.0, "end": 5.0}}, "region ends after the file"),
        ({"region": {"start": 0.0, "end": 0.2}}, "Region is too short"),
        ({"channels": [2]}, "channels must be distinct"),
        ({"recipe": spectrum_recipe(RecipeSource(1, RATE), n_fft=1024)}, "time signal"),
        ({"recipe": {"schema": "wandas.recipe", "version": 2}}, ""),
    ],
)
def test_scan_failures_are_one_line_results(tmp_path: Path, payload: dict, message: str) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1000, 0.5)])

    result = _scan(service, path, **payload)

    assert set(result) == {"ok", "reason"} and result["ok"] is False
    assert message in result["reason"] and "\n" not in result["reason"]


def test_scan_reports_unreadable_files(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt ")

    assert _scan(service, str(broken))["reason"].startswith("Unable to read audio")
    assert _scan(service, str(tmp_path / "missing.wav"))["reason"].startswith("Audio file not found")


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
    assert first["conditionId"] == second["conditionId"]
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


def test_scan_of_the_entry100_fixture_finds_its_outliers(
    entry100_scan: tuple[list[Path], dict[str, dict], float],
) -> None:
    files, results, _ = entry100_scan
    assert len(files) == 100
    assert [name for name, result in results.items() if not result["ok"]] == ["Rec_0012.wav"]
    assert results["mono_48k.wav"]["input"]["channels"] == [0]
    # The three outliers' 3150 Hz band stands at least 10 dB above their group's median.
    for outlier in ("L1_1500rpm_run018.wav", "L2_1500rpm_run043.wav", "L3_1500rpm_run060.wav"):
        group = outlier.split("_run")[0]
        levels = [_band(result, 0, 3150.0) for name, result in results.items() if name.startswith(group + "_")]
        assert _band(results[outlier], 0, 3150.0) - float(np.median(levels)) >= 10


@pytest.mark.skipif(
    bool(os.environ.get("CI")),
    reason="10 s is the requirement on the developer's PC; CI runners' speed varies (10.9-17.4 s seen). "
    "Run locally only, as the maintainer decided on 2026-10-23.",
)
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
    # A low-pass between the region and the average spectrum: the time signal the metrics read is filtered.
    filtered = _with_step(ENTRY_RECIPE, "node-1", "wandas.audio.lowpass_filter", 1, [["cutoff", _float(1000.0)]])

    result = _scan(service, path, recipe=filtered)

    assert result["endFrame"] == plain["endFrame"] == "SpectralFrame"
    # The 3.15 kHz tone is filtered out: its band is outside the passband, and Leq drops by its share.
    assert _band(result, 0, 3150.0) is None and _band(plain, 0, 3150.0) is not None
    assert result["leqDbA"][0] < plain["leqDbA"][0] - 2
    assert result["spectrumDb"][0][-40] < plain["spectrumDb"][0][-40] - 20
    assert abs(result["peakHz"][0] - 200) <= RATE / spec.WELCH_N_FFT


def test_scan_names_the_frame_the_chain_ends_in_and_draws_any_step(tmp_path: Path) -> None:
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

    result = _scan(service, path, recipe=stft)
    view = _scan(service, path, recipe=stft, stage="node-2")["stage"]

    assert result["endFrame"] == "SpectrogramFrame"
    assert (view["frame"], view["kind"], view["x"], view["yAxis"], view["quantity"]) == (
        "SpectrogramFrame",
        "heatmap",
        "time",
        "frequency",
        "level",
    )
    assert len(view["matrix"]) == len(view["ys"]) and len(view["matrix"][0]) == len(view["xs"])
    # Columns at the region's ends, whose windows stick out of it, are marked; the rest are whole.
    whole = view["whole"]
    assert len(whole) == len(view["xs"]) and not whole[0] and not whole[-1] and any(whole)
    # The metrics still read the time signal: Leq is the same as with the spectrum.
    assert result["leqDbA"] == _scan(service, path)["leqDbA"]
    # A step before the slice runs over the whole file: its level over time spans the file.
    hpf = _scan(service, path, stage="node-0", region={"start": 0.5, "end": 1.0})["stage"]
    assert (hpf["frame"], hpf["kind"], hpf["x"], hpf["quantity"]) == ("ChannelFrame", "line", "time", "level")
    assert hpf["xs"][0] < 0.01 and hpf["xs"][-1] > 1.99
    # The time slice's Frame is the region.
    region = _scan(service, path, stage="node-1", region={"start": 0.5, "end": 1.0})["stage"]
    assert region["xs"][0] >= 0.5 and region["xs"][-1] <= 1.0
    spectrum = _scan(service, path, stage="node-2")["stage"]
    assert (spectrum["kind"], spectrum["x"], spectrum["xScale"], len(spectrum["xs"])) == (
        "line",
        "frequency",
        "log",
        spec.SPECTRUM_POINTS,
    )
    # The app's 1/3-octave branch beside the chain is a step too: its bands.
    # The input is a stage too: the file's signal over the whole file, before any step.
    raw = _scan(service, path, stage="node-input", region={"start": 0.5, "end": 1.0})["stage"]
    assert (raw["frame"], raw["kind"], raw["x"]) == ("ChannelFrame", "line", "time")
    assert raw["xs"][0] < 0.01 and raw["xs"][-1] > 1.99
    bands = _scan(service, path, stage="node-noct")["stage"]
    assert (bands["frame"], bands["kind"], bands["x"]) == ("NOctFrame", "bar", "band")


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


def test_a_steps_picture_comes_alone(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    path = _write(tmp_path / "tone.wav", [_sine(1000, 0.5)])
    # The comparison asks for one step's Frame at a time: the metrics, the spectrum and the bands are not computed.
    for stage in ("node-0", "node-1", "node-2"):
        result = _scan(service, path, stage=stage)
        assert set(result) == {"ok", "input", "stage", "specVersion", "wandasVersion", "elapsedMs"}
