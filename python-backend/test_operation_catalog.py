from __future__ import annotations

import re
import struct
from pathlib import Path

import dask.array as da
import numpy as np
import pytest
import wandas as wd
from wandas.pipeline import default_recipe_registry

from operation_catalog import TS_TARGET, catalog, frames, typescript, with_refusals
from operation_probe import _direct, _flat, metric_series, needs, probe, refusals, verdicts
from stage_view import HEATMAP_TIMES, stage_view

# The probe runs every operation on every Frame (1-2 min): CI runs these with AWA_SLOW=1.
slow = pytest.mark.slow


def _by_id() -> dict[str, dict]:
    return {entry["id"]: entry for entry in catalog()}


@pytest.fixture(scope="module")
def runs() -> list:
    return probe()


@pytest.fixture(scope="module")
def needed(runs: list) -> dict:
    return needs(runs)


@slow
def test_the_generated_typescript_is_current(runs: list, needed: dict) -> None:
    # Regenerate with `python python-backend/operation_catalog.py --write` after a wandas upgrade: it runs
    # every operation again, so what a new wandas can or cannot do shows here.
    assert TS_TARGET.read_text(encoding="utf-8") == typescript(
        with_refusals(catalog(), refusals(runs), needed), frames()
    ), (
        f"{TS_TARGET.name} is not what the catalogue gives now (a wandas upgrade, or a Frame kind added to "
        "stage_view.STAGE_FRAME_TYPES). Fix: run `python python-backend/operation_catalog.py --write` and commit it."
    )


@slow
def test_every_addable_operation_is_run_on_the_frames_it_is_declared_to_take(runs: list, needed: dict) -> None:
    table = verdicts(runs)
    # A spectrogram's cepstrum runs; a spectrum's 1/N octaves only at 48 kHz (MoSQITo), so it depends on the file.
    assert table["wandas.spectrogram.cepstrum"]["SpectrogramFrame"] == "ok"
    assert table["wandas.spectral.noct_synthesis"]["SpectralFrame"] == "depends"
    assert table["wandas.audio.welch"]["ChannelFrame"] == "ok"
    # get_channel and fix_length need one of their optional values; set as a new step starts, they run.
    assert table["wandas.frame.get_channel"]["SpectralFrame"] == "ok"
    assert table["wandas.audio.fix_length"]["ChannelFrame"] == "ok"
    # HPSS runs here (wandas[effects] brings librosa) and needs librosa, which the Web runtime does not carry.
    assert table["wandas.audio.hpss_harmonic"]["ChannelFrame"] == "ok"
    assert table["wandas.audio.hpss_percussive"]["ChannelFrame"] == "ok"
    assert "librosa" in needed["wandas.audio.hpss_harmonic"]
    # Every run is of an operation the step bar can add, on a Frame it is declared to take.
    assert {run["input"] for run in runs} >= {
        "ChannelFrame",
        "SpectralFrame",
        "SpectrogramFrame",
        "NOctFrame",
        "CepstralFrame",
    }


@slow
def test_every_frame_an_added_step_gives_is_drawn_on_the_compare(runs: list) -> None:
    # What a step gives is shown as its plot() shows it; a Frame the comparison cannot draw fails here.
    undrawn = sorted({run["output"] for run in runs if run["ok"] and not run["drawn"]})
    assert undrawn == []
    # Every Frame a step can give is charted; FrameSegments is only the base of the segments a trigger gives.
    given = {operation["output"] for operation in catalog()}
    assert all(frame["charted"] for frame in frames() if frame["name"] != "FrameSegments" or frame["name"] in given)


def test_operations_name_the_frames_they_take_and_give() -> None:
    operations = _by_id()
    assert {key: operations["wandas.audio.welch"][key] for key in ("input", "output")} == {
        "input": "ChannelFrame",
        "output": "SpectralFrame",
    }
    assert operations["wandas.audio.noct_spectrum"]["output"] == "NOctFrame"
    assert operations["wandas.audio.stft"]["output"] == "SpectrogramFrame"
    assert operations["wandas.audio.highpass_filter"]["output"] == "ChannelFrame"
    assert operations["wandas.spectral.ifft"]["input"] == "SpectralFrame"
    assert operations["wandas.spectrogram.to_channel_frame"]["output"] == "ChannelFrame"
    # Every frame's operations take any Frame and give the one they took.
    assert operations["wandas.frame.get_channel"]["input"] == operations["wandas.frame.get_channel"]["output"] == "*"


def test_each_operation_is_listed_once_at_its_newest_version() -> None:
    newest: dict[str, int] = {}
    for operation in default_recipe_registry().operations:
        newest[operation.operation_id] = max(newest.get(operation.operation_id, 0), operation.version)
    for entry in catalog():
        assert entry["version"] == newest[entry["id"]]
    assert len({entry["id"] for entry in catalog()}) == len(catalog())


def test_operations_a_chain_cannot_hold_are_left_out() -> None:
    operations = _by_id()
    # A second input, or a callable a Recipe cannot carry.
    for left_out in (
        "wandas.audio.mix",
        "wandas.channel.add_channel",
        "wandas.channel.concat_frame",
        "wandas.custom.apply",
    ):
        assert left_out not in operations
    assert [param["name"] for param in operations["wandas.audio.highpass_filter"]["params"] if param["required"]] == [
        "cutoff"
    ]
    assert not any(param["required"] for param in operations["wandas.audio.a_weighting"]["params"])


def test_frames_list_what_they_derive_from() -> None:
    by_name = {frame["name"]: frame for frame in frames()}
    assert by_name["CoherenceFrame"]["bases"] == ["PairwiseSpectralFrame", "PairwiseFrame"]
    assert by_name["SpectralFrame"]["charted"] is True
    assert by_name["CepstralFrame"]["charted"] is True


def test_a_package_that_another_needed_package_brings_is_not_listed() -> None:
    # librosa installs scikit-learn; whether blocking scikit-learn alone breaks HPSS depends on the versions.
    assert _direct(["librosa", "scikit_learn"]) == ["librosa"]
    assert _direct(["scikit_learn"]) == ["scikit_learn"]


def test_the_step_bars_fixed_rates_are_the_ones_wandas_enforces() -> None:
    # recipeSteps.ts FIXED_RATE greys an operation out at other rates: wandas must refuse those and run at its own.
    source = (Path(__file__).parents[1] / "src" / "shared" / "recipe" / "recipeSteps.ts").read_text(encoding="utf-8")
    table = re.search(r"FIXED_RATE[^=]*=\s*\{([^}]*)\}", source)
    assert table is not None
    fixed = {name: int(rate) for name, rate in re.findall(r"'([\w.]+)':\s*(\d+)", table.group(1))}
    assert fixed == {"wandas.spectral.noct_synthesis": 48000}

    def spectrum(rate: int) -> wd.SpectralFrame:
        t = np.arange(rate) / rate
        return wd.from_numpy(np.sin(2 * np.pi * 1000 * t)[None], sampling_rate=rate).welch(n_fft=1024)

    assert spectrum(48000).noct_synthesis(fmin=25.0, fmax=6300.0).n_channels == 1
    with pytest.raises(ValueError, match="48000"):
        spectrum(16000).noct_synthesis(fmin=25.0, fmax=6300.0)


@slow
def test_no_step_offered_on_a_recording_draws_a_flat_picture(runs: list) -> None:
    # A picture whose values are all one value says nothing (docs/display-rules.md R8). The only one is the
    # difference of a one-channel file's channel with itself, which the step bar greys out on one channel.
    # The Frames a recording's steps give; a metric's series is probed one step further (and greys what fails there).
    flat = sorted(
        {
            (run["operation"], run["example"])
            for run in runs
            if run["ok"] and run["flat"] and not run["input"].startswith("ChannelFrame:")
        }
    )
    assert flat == [("wandas.audio.channel_difference", "48 kHz 1 ch")]
    steps = (Path(__file__).parent.parent / "src" / "shared" / "recipe" / "recipeSteps.ts").read_text(encoding="utf-8")
    assert re.search(r"NEEDS_TWO_CHANNELS[^;]*'wandas\.audio\.channel_difference'", steps)


@slow
def test_after_a_metric_the_steps_that_fail_on_its_series_are_refused(runs: list) -> None:
    # A metric's series is a ChannelFrame at the metric's rate (docs/display-rules.md R8). What fails on any series
    # is greyed out after it: HPSS would take the backend down with it (librosa segfaults on a short series).
    found = refusals(runs)
    for metric in ("wandas.audio.rms_trend", "wandas.audio.loudness_zwtv"):
        series = metric_series(metric)
        assert found["wandas.audio.hpss_harmonic"][series] == "crashes on a metric's series"
        # A filter at a new step's cutoff or a Welch of the probe's short series fails there, but a lower cutoff
        # or a longer file runs: the step bar judges those at the series' rate (recipeSteps METRIC_RATE), not ＋.
        for operation in (
            "wandas.audio.lowpass_filter",
            "wandas.audio.welch",
            "wandas.audio.stft",
            "wandas.audio.trim",
        ):
            assert series not in found.get(operation, {}), (operation, metric)
    # Every run on a metric's series that is kept as running draws something.
    on_series = [run for run in runs if run["input"].startswith("ChannelFrame:")]
    assert on_series and all(run["drawn"] for run in on_series if run["ok"])


def test_the_step_bars_metric_rates_are_the_ones_wandas_gives() -> None:
    # recipeSteps.ts METRIC_RATE judges a filter's cutoff and an FFT's length after a metric at its series' rate.
    source = (Path(__file__).parents[1] / "src" / "shared" / "recipe" / "recipeSteps.ts").read_text(encoding="utf-8")
    table = re.search(r"METRIC_RATE[^=]*=\s*\{([^}]*)\}", source)
    assert table is not None
    rates = {name: float(rate) for name, rate in re.findall(r"'wandas\.audio\.(\w+)':\s*(\d+)", table.group(1))}
    for sampling_rate in (16000, 48000):
        t = np.arange(sampling_rate) / sampling_rate
        tone = wd.from_numpy(0.3 * np.sin(2 * np.pi * 1000 * t)[None], sampling_rate=sampling_rate)
        assert {name: getattr(tone, name)().sampling_rate for name in rates} == rates
        # rms_trend's is the input's over its hop.
        assert tone.rms_trend().sampling_rate == sampling_rate / 512
        assert tone.rms_trend(hop_length=256).sampling_rate == sampling_rate / 256


def test_a_steady_tone_is_not_flat_and_a_silent_difference_is() -> None:
    t = np.arange(48000) / 48000
    tone = wd.from_numpy(0.5 * np.sin(2 * np.pi * 1000 * t)[None], sampling_rate=48000)
    # A steady tone's level line is one value, but its samples are a ±0.5 tone: it says something.
    assert not _flat(tone, stage_view(tone))
    difference = tone.channel_difference()
    assert _flat(difference, stage_view(difference))


def test_an_image_that_draws_flat_from_block_averages_is_not_flat_when_its_cells_are_not() -> None:
    # Columns alternating between two levels in every bin: each time block (two columns, HEATMAP_TIMES blocks) has
    # the same power mean, so the drawn picture is one value, but the STFT's own cells are not (display rules R8).
    rate, n_fft, columns = 48000, 256, 2 * HEATMAP_TIMES
    magnitudes = np.where(np.arange(columns) % 2 == 0, 1.0, 4.0)
    cells = np.broadcast_to(magnitudes, (1, n_fft // 2 + 1, columns)).astype(np.complex128)
    frame = wd.SpectrogramFrame(da.from_array(cells), sampling_rate=rate, n_fft=n_fft, hop_length=n_fft // 2)
    view = stage_view(frame)
    drawn = np.array([[value for value in row if value is not None] for row in view["matrix"]], dtype=np.float64)
    # The hard case itself: judged from the drawn points (the old rule), this picture is flat.
    assert drawn.size and drawn.max() == drawn.min()
    assert not _flat(frame, view)


def test_a_parameters_field_kind_is_read_from_its_wandas_annotation() -> None:
    # The step bar builds a step's form from these (recipeSteps.ts STEP_PARAMS): one field per plain value.
    def kinds(operation: str) -> dict[str, tuple[str | None, bool]]:
        return {
            param["name"]: (param.get("kind"), param.get("nullable", False)) for param in _by_id()[operation]["params"]
        }

    assert kinds("wandas.audio.sound_level") == {
        "freq_weighting": ("enum", True),  # Optional[Literal['A', 'C', 'Z']]
        "time_weighting": ("enum", False),
        "dB": ("bool", False),
    }
    assert kinds("wandas.audio.welch") == {
        "n_fft": ("int", False),
        "hop_length": ("int", True),  # int | None: wandas picks it
        "win_length": ("int", True),
        "window": ("str", False),
        "average": ("enum", False),
    }
    assert kinds("wandas.audio.normalize")["norm"] == ("float", True)
    # SupportsFloat / SupportsIndex are a number; an int or a float is a number.
    hpss = kinds("wandas.audio.hpss_harmonic")
    assert hpss["power"] == ("float", False) and hpss["n_fft"] == ("int", False)
    assert kinds("wandas.operator.reverse_add")["other"] == ("float", False)
    # Lists, arrays, tuples, Any and channel names or numbers are not one plain value: no field.
    assert hpss["kernel_size"][0] is None and hpss["window"][0] is None
    assert kinds("wandas.frame.get_channel")["channel_idx"][0] is None
    assert kinds("wandas.audio.channel_difference")["other_channel"][0] is None
    assert kinds("wandas.frame.time_slice")["start"][0] is None
    sound_level = {param["name"]: param for param in _by_id()["wandas.audio.sound_level"]["params"]}
    assert sound_level["freq_weighting"]["choices"] == ["A", "C", "Z"]


_EXAMPLE_INPUTS = ("ChannelFrame", "SpectralFrame", "SpectrogramFrame", "CepstralFrame", "CepstrogramFrame")


def _example(frame: str) -> wd.ChannelFrame:
    rate = 48000
    t = np.arange(rate) / rate
    signal = wd.from_numpy(
        np.stack([0.3 * np.sin(2 * np.pi * 1000 * t), 0.1 * np.sin(2 * np.pi * 250 * t)]),
        sampling_rate=rate,
        ch_units=["m/s^2", "m/s^2"],  # integrate infers its unit from an acceleration
    )
    return {
        "ChannelFrame": signal,
        "SpectralFrame": signal.welch(),
        "SpectrogramFrame": signal.stft(),
        "CepstralFrame": signal.cepstrum(),
        "CepstrogramFrame": signal.stft().cepstrum(),
    }[frame]


_STARTS: dict[str, dict[str, object]] = {
    "wandas.audio.fix_length": {"duration": 0.5},
    "wandas.frame.get_channel": {"channel_idx": 0},
}


def _encoded(value: object) -> object:
    # As recipeSteps.ts encodeNumber writes it: a finite float plainly, infinity as its IEEE 754 bytes.
    if isinstance(value, float) and not np.isfinite(value):
        return {"$type": "number", "kind": "python-float", "data": struct.pack(">d", value).hex()}
    return value


def _one_step(operation: dict, entries: list) -> dict:
    return {
        "schema": "wandas.recipe",
        "version": 3,
        "inputs": [{"id": "input-0", "name": "input_0", "kind": "frame"}],
        "nodes": [
            {
                "id": "node-0",
                "operation": operation["id"],
                "version": operation["version"],
                "inputs": ["input-0"],
                "params": {"$type": "map", "entries": [list(item) for item in sorted(dict(entries).items())]},
            }
        ],
        "output": "node-0",
    }


def _shown(operation: dict) -> list:
    """What a form shows for each field: wandas' default, None for an auto value, and the start a step bar gives."""
    entries = [
        [param["name"], _encoded(param["default"]) if "default" in param else None]
        for param in operation["params"]
        if "kind" in param and ("default" in param or param.get("nullable"))
    ]
    # Two optional values of which one is needed: the step bar starts a new step with it (recipeSteps.ts).
    return entries + [[name, value] for name, value in _STARTS.get(operation["id"], {}).items()]


def _formed() -> list[dict]:
    """The operations a form is shown for on these examples (librosa's hpss is the slow probe's)."""
    return [
        operation
        for operation in catalog()
        if operation["input"] in _EXAMPLE_INPUTS
        and not any(param["required"] for param in operation["params"])
        and not operation["id"].startswith("wandas.audio.hpss")
    ]


def test_every_choice_a_field_offers_runs_and_a_level_it_gives_is_drawn_as_a_level() -> None:
    # Each choice of an enum (and None when it takes None) and each side of a bool, one at a time with the rest as
    # shown: wandas takes it, its result is drawn, and a time signal in dB (sound_level's dB, rms_trend's dB=True) is
    # drawn as a level, whichever choice made it.
    from wandas.pipeline import RecipePlan

    failed: list[str] = []
    levels: list[str] = []
    for operation in _formed():
        shown = dict(_shown(operation))
        for param in operation["params"]:
            values: list[object] = list(param.get("choices", [])) if param.get("kind") == "enum" else []
            values += [True, False] if param.get("kind") == "bool" else []
            values += [None] if values and param.get("nullable") else []
            for value in values:
                entries = list({**shown, param["name"]: value}.items())
                where = f"{operation['id']}.{param['name']}={value!r}"
                try:
                    result = RecipePlan.from_dict(_one_step(operation, entries)).apply(
                        {"input_0": _example(operation["input"])}
                    )
                except Exception as error:  # noqa: BLE001 - every refusal is listed with wandas' reason
                    failed.append(f"{where}: {error}")
                    continue
                view = stage_view(result)
                if isinstance(result, wd.ChannelFrame) and (result.channels[0].unit or "").startswith("dB"):
                    levels.append(where)
                    assert view.get("quantity") == "level", where
    assert failed == [], failed
    assert any(item.startswith("wandas.audio.rms_trend.dB=True") for item in levels), levels


def test_every_operation_runs_with_the_values_its_form_shows_written_into_the_recipe() -> None:
    # A form writes what it shows in wandas' Recipe encoding (true/false, null, text, numbers): wandas must take
    # each operation's shown defaults written out explicitly, as an exported Recipe carries them.
    from wandas.pipeline import RecipePlan

    ran: list[str] = []
    for operation in _formed():
        _ = (
            RecipePlan.from_dict(_one_step(operation, _shown(operation)))
            .apply({"input_0": _example(operation["input"])})
            .data
        )
        ran.append(operation["id"])
    assert {"wandas.audio.sound_level", "wandas.audio.welch", "wandas.audio.normalize", "wandas.audio.stft"} <= set(ran)
