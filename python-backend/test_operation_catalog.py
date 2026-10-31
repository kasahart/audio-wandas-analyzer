from __future__ import annotations

import pytest
from wandas.pipeline import default_recipe_registry

from operation_catalog import TS_TARGET, catalog, frames, typescript, with_refusals
from operation_probe import _direct, needs, probe, refusals, verdicts

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
    assert all(frame["charted"] for frame in frames())


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
