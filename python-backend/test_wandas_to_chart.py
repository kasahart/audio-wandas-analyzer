from __future__ import annotations

import numpy as np
import pytest
import wandas as wd

from wandas_to_chart import adapt


@pytest.fixture
def mono_sin() -> wd.ChannelFrame:
    return wd.generate_sin(freqs=[440.0], duration=0.25, sampling_rate=16000)


@pytest.fixture
def two_channel(mono_sin: wd.ChannelFrame) -> wd.ChannelFrame:
    other = wd.generate_sin(freqs=[880.0], duration=0.25, sampling_rate=16000).rename_channels({"Channel 1": "ref"})
    return mono_sin.add_channel(other.get_channel(0), suffix_on_dup="_b")


def test_channel_frame_becomes_line(mono_sin: wd.ChannelFrame) -> None:
    spec = adapt(mono_sin, title="waveform")
    assert spec["kind"] == "line"
    assert spec["title"] == "waveform"
    assert spec["xLabel"].startswith("Time")
    assert len(spec["xs"]) == len(spec["series"][0]["ys"])
    assert spec["series"][0]["name"]


def test_spectral_frame_from_welch(mono_sin: wd.ChannelFrame) -> None:
    spec = adapt(mono_sin.welch(), title="welch")
    assert spec["kind"] == "line"
    assert spec["yScale"] == "db"
    assert spec["xs"][0] == 0.0
    assert len(spec["xs"]) == len(spec["series"][0]["ys"])


def test_spectrogram_frame_from_stft(mono_sin: wd.ChannelFrame) -> None:
    spec = adapt(mono_sin.stft(), title="stft")
    assert spec["kind"] == "heatmap"
    assert len(spec["ys"]) == len(spec["matrix"])
    assert len(spec["xs"]) == len(spec["matrix"][0])
    assert spec["unit"] == "dB"


def test_noct_frame_becomes_bar(mono_sin: wd.ChannelFrame) -> None:
    spec = adapt(mono_sin.noct_spectrum(fmin=125, fmax=4000, n=3), title="1/3 oct")
    assert spec["kind"] == "bar"
    assert len(spec["categories"]) == len(spec["series"][0]["values"])
    # Centre frequencies are rendered with %g so they should look numeric-ish.
    assert any(ch.replace(".", "").isdigit() for ch in spec["categories"][:1])


def test_coherence_yields_multi_series(two_channel: wd.ChannelFrame) -> None:
    spec = adapt(two_channel.coherence(), title="coherence")
    assert spec["kind"] == "line"
    # 2 channels → 2x2 cross matrix in wandas 0.2.0
    assert len(spec["series"]) >= 2


def test_transfer_function_yields_multi_series(two_channel: wd.ChannelFrame) -> None:
    spec = adapt(two_channel.transfer_function(), title="TF")
    assert spec["kind"] == "line"
    assert len(spec["series"]) >= 2


def test_ndarray_becomes_scalar_table() -> None:
    spec = adapt(np.array([0.42, 0.51]), title="loudness")
    assert spec["kind"] == "scalar"
    assert len(spec["rows"]) == 2
    assert spec["rows"][0]["value"] == pytest.approx(0.42)


def test_unknown_falls_back_to_scalar_repr() -> None:
    spec = adapt(object(), title="x")
    assert spec["kind"] == "scalar"
    assert spec["rows"][0]["label"] == "repr"


def test_scalar_numeric() -> None:
    spec = adapt(3.14, title="pi")
    assert spec["kind"] == "scalar"
    assert spec["rows"][0]["value"] == pytest.approx(3.14)
