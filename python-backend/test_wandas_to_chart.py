from __future__ import annotations

import tomllib
from pathlib import Path

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
    return mono_sin.concat_frame(other.get_channel(0), suffix_on_dup="_b")


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
    assert spec["unit"] == mono_sin.channels[0].level_reference.label


def test_stereo_roughness_uses_requested_channel_and_bark_axis(two_channel: wd.ChannelFrame) -> None:
    roughness = two_channel.resampling(48000).fix_length(duration=0.5).roughness_dw_spec()
    spec = adapt(roughness, title="roughness", channel=1)
    assert spec["kind"] == "heatmap"
    assert spec["yLabel"] == "Critical-band rate [Bark]"
    assert spec["ys"] == pytest.approx(roughness.bark_axis.tolist())
    assert len(spec["matrix"]) == len(roughness.bark_axis)
    assert len(spec["matrix"][0]) == len(roughness.time)


def test_noct_frame_becomes_bar(mono_sin: wd.ChannelFrame) -> None:
    spec = adapt(mono_sin.noct_spectrum(fmin=125, fmax=4000, n=3), title="1/3 oct")
    assert spec["kind"] == "bar"
    assert len(spec["categories"]) == len(spec["series"][0]["values"])
    # Centre frequencies are rendered with %g so they should look numeric-ish.
    assert any(ch.replace(".", "").isdigit() for ch in spec["categories"][:1])


def test_runtime_dependencies_pin_wandas_v08_with_psychoacoustics() -> None:
    pyproject = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())
    dependencies = pyproject["project"]["dependencies"]
    assert "scipy>=1.13" in dependencies
    assert "wandas[psychoacoustic]>=0.8.1,<0.9.0" in dependencies


def test_coherence_yields_multi_series(two_channel: wd.ChannelFrame) -> None:
    spec = adapt(two_channel.coherence(), title="coherence")
    assert spec["kind"] == "line"
    assert spec["yLabel"] == "Coherence"
    assert spec["yScale"] == "linear"
    assert len(spec["series"]) >= 2


def test_cross_spectral_frame_yields_db_series(two_channel: wd.ChannelFrame) -> None:
    spec = adapt(two_channel.csd(), title="CSD")
    assert spec["kind"] == "line"
    assert spec["yLabel"] == "Cross-spectral level [dB]"
    assert spec["yScale"] == "db"
    assert len(spec["series"]) >= 2


def test_cross_spectral_frame_preserves_value_selection(two_channel: wd.ChannelFrame) -> None:
    spec = adapt(two_channel.csd(), title="CSD phase", value="phase")
    assert spec["yLabel"] == "Phase [rad]"
    assert spec["yScale"] == "linear"


def test_transfer_function_yields_multi_series(two_channel: wd.ChannelFrame) -> None:
    spec = adapt(two_channel.transfer_function(), title="TF")
    assert spec["kind"] == "line"
    assert spec["yLabel"] == "Gain [dB]"
    assert spec["yScale"] == "db"
    assert len(spec["series"]) >= 2


def test_transfer_function_preserves_value_selection(two_channel: wd.ChannelFrame) -> None:
    spec = adapt(two_channel.transfer_function(), title="TF phase", value="phase")
    assert spec["yLabel"] == "Phase [rad]"
    assert spec["yScale"] == "linear"


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


def test_noct_frame_preserves_each_channel_level_reference(two_channel: wd.ChannelFrame) -> None:
    frame = two_channel.with_calibration({0: wd.ChannelCalibration(factor=2.0, unit="Pa", ref=2e-5)})
    octave = frame.noct_spectrum(fmin=125, fmax=4000, n=3)
    spec = adapt(octave)
    assert [series["unit"] for series in spec["series"]] == [
        channel.level_reference.label for channel in octave.channels
    ]
    assert "Pa" in spec["series"][0]["unit"]
    assert spec["series"][1]["unit"] == "dB re 1 input unit"
    np.testing.assert_allclose(spec["series"][0]["values"], octave.dB[0])


@pytest.mark.parametrize("channel, selected", [(0, 0), (1, 1), (-1, 0), (99, 1)])
def test_spectrogram_preserves_selected_channel_reference(
    two_channel: wd.ChannelFrame, channel: int, selected: int
) -> None:
    frame = two_channel.with_calibration({0: wd.ChannelCalibration(factor=2.0, unit="Pa", ref=2e-5)}).stft()
    spec = adapt(frame, channel=channel)
    assert spec["unit"] == frame.channels[selected].level_reference.label
    np.testing.assert_allclose(spec["matrix"], frame.dB[selected])


@pytest.mark.parametrize("method", ["csd", "transfer_function"])
def test_calibrated_pairwise_charts_preserve_values_and_references(two_channel: wd.ChannelFrame, method: str) -> None:
    frame = two_channel.with_calibration(
        {
            0: wd.ChannelCalibration(factor=2.0, unit="Pa", ref=2e-5),
            1: wd.ChannelCalibration(factor=3.0, unit="V", ref=1e-6),
        }
    )
    pairwise = getattr(frame, method)()
    spec = adapt(pairwise)
    levels = pairwise.level_db if method == "csd" else pairwise.transfer_level_db
    assert spec["yLabel"] == ("Cross-spectral level [dB]" if method == "csd" else "Transfer level [dB]")
    assert [series["unit"] for series in spec["series"]] == [
        channel.level_reference.label for channel in pairwise.channels
    ]
    actual = np.array([series["ys"] for series in spec["series"]])
    finite = np.isfinite(levels)
    np.testing.assert_allclose(actual[finite], levels[finite])
    assert any("Pa" in series["unit"] and "V" in series["unit"] for series in spec["series"])
    if method == "transfer_function":
        assert adapt(pairwise, value="transfer_level_db") == spec
        with pytest.raises(ValueError, match="dimensionless transfer pairs"):
            adapt(pairwise, value="gain_db")


def test_same_unit_transfer_default_keeps_gain_even_with_different_references(two_channel: wd.ChannelFrame) -> None:
    frame = two_channel.with_calibration(
        {
            0: wd.ChannelCalibration(factor=2.0, unit="Pa", ref=2e-5),
            1: wd.ChannelCalibration(factor=3.0, unit="Pa", ref=1e-3),
        }
    ).transfer_function()
    spec = adapt(frame)
    assert spec["yLabel"] == "Gain [dB]"
    actual = np.array([series["ys"] for series in spec["series"]])
    finite = np.isfinite(frame.gain_db)
    np.testing.assert_allclose(actual[finite], frame.gain_db[finite])
    referenced = adapt(frame, value="transfer_level_db")
    assert [series["unit"] for series in referenced["series"]] == [
        channel.level_reference.label for channel in frame.channels
    ]


@pytest.mark.parametrize("second_unit", ["V", "Pa"])
def test_linear_transfer_gain_preserves_channel_units_and_values(
    two_channel: wd.ChannelFrame, second_unit: str
) -> None:
    frame = two_channel.with_calibration(
        {
            0: wd.ChannelCalibration(factor=2.0, unit="Pa", ref=2e-5),
            1: wd.ChannelCalibration(factor=3.0, unit=second_unit, ref=1e-6),
        }
    ).transfer_function()
    spec = adapt(frame, value="gain")
    assert spec["yLabel"] == "Gain"
    assert spec["yScale"] == "linear"
    assert [series["unit"] for series in spec["series"]] == [channel.unit for channel in frame.channels]
    if second_unit == "V":
        assert {series["unit"] for series in spec["series"]} == {"1", "Pa/V", "V/Pa"}
    else:
        assert {series["unit"] for series in spec["series"]} == {"1"}
    actual = np.array([series["ys"] for series in spec["series"]])
    finite = np.isfinite(frame.gain)
    np.testing.assert_allclose(actual[finite], frame.gain[finite])
