"""What a step's result is (stage_view.describe: the words the screen chooses its figure by) and its reading
(stage_view.read_frame: the full-resolution values kept for the figure service), per Frame kind. The drawing, the
ranges and the reads of those values are the figure service's (test_figures_*.py)."""

from __future__ import annotations

import numpy as np
import pytest
import wandas as wd

from frames.stage_view import FrameReading, read_frame, stage_view
from transport.protocol_schema import DEFINITIONS, first_violation

RATE = 16000


@pytest.fixture(scope="module")
def signal() -> wd.ChannelFrame:
    rng = np.random.default_rng(3)
    tone = 0.5 * np.sin(2 * np.pi * 1000 * np.arange(RATE * 2) / RATE)
    return wd.from_numpy(np.stack([tone, tone + 0.05 * rng.standard_normal(RATE * 2)]), sampling_rate=RATE)


def _checked(frame: object) -> dict:
    view = stage_view(frame)
    assert first_violation(DEFINITIONS["StageView"], view) is None
    return dict(view)


def _read(frame: object, signal_s: float | None = None) -> FrameReading:
    reading = read_frame(frame, signal_s)
    assert reading is not None
    return reading


def test_a_time_signal_is_its_own_values_never_a_level_the_comparison_makes(signal: wd.ChannelFrame) -> None:
    # The sound as wandas gives it: every sample, in its unit. A level is a wandas step's (sound_level, rms_trend),
    # whose window the recipe records, never one the comparison picks.
    view = _checked(signal)
    assert (view["kind"], view["x"], view["quantity"], view["signal"]) == ("line", "time", "value", True)
    reading = _read(signal)
    assert reading.mode == "signal" and reading.values.size == signal.n_samples
    assert reading.values.max() == pytest.approx(0.5, abs=0.15) and reading.values.min() == pytest.approx(
        -0.5, abs=0.15
    )
    # A region keeps the file's seconds.
    region = _read(signal.trim(0.5, 1.0))
    assert region.start >= 0.5 and region.start + (region.values.size - 1) / region.rate <= 1.0


def test_a_metric_over_time_is_drawn_as_its_values(signal: wd.ChannelFrame) -> None:
    view = _checked(signal.rms_trend())
    assert (view["kind"], view["quantity"]) == ("line", "value")


def test_a_level_set_to_db_in_its_step_is_drawn_as_its_db_values(signal: wd.ChannelFrame) -> None:
    # sound_level / rms_trend with dB=True (a step's form can set it) already give dB: drawn as those values in
    # their unit, not as a level of them (a dB of dB).
    for frame in (signal.sound_level(dB=True), signal.rms_trend(dB=True)):
        view = _checked(frame)
        # A level (the headline's audible floor and the dB ranges apply), not the sound itself to take a level of.
        assert (view["kind"], view["quantity"]) == ("line", "level")
        assert view["unit"].startswith("dB")
        assert "signal" not in view
        # A 0.5 sine is 3 dB below its peak: −9 dB re 1 (as the level over time of the plain signal reads).
        assert np.nanmedian(_read(frame).values) == pytest.approx(-9.0, abs=0.5)


def test_a_long_metric_stays_its_values_with_its_unit_even_after_a_trim() -> None:
    # 6 s of loudness at 500 Hz is 3000 points: more than a sound's level series would keep as values.
    noise = np.random.default_rng(5).normal(0.0, 0.05, RATE * 6)
    loudness = wd.from_numpy(noise[np.newaxis], sampling_rate=RATE).loudness_zwtv()
    for frame in (loudness, loudness.trim(1.0, 5.0)):
        view = _checked(frame)
        assert (view["kind"], view["quantity"], view["unit"]) == ("line", "value", "sone")
        # sone values, not dB of them (which would be negative for values below 1).
        assert np.nanmin(_read(frame).values) >= 0


def test_spectra_bands_and_spectrograms_share_the_comparisons_log_frequency_axis(signal: wd.ChannelFrame) -> None:
    spectrum = _checked(signal.welch(n_fft=1024))
    assert (spectrum["kind"], spectrum["x"], spectrum["xScale"]) == ("line", "frequency", "log")
    # The reading keeps every bin, as it is.
    freqs = np.asarray(signal.welch(n_fft=1024).freqs)
    assert _read(signal.welch(n_fft=1024)).xs.tolist() == [float(f) for f in freqs]
    bands = _checked(signal.noct_spectrum(fmin=25, fmax=6300))
    assert (bands["kind"], bands["x"], bands["xScale"]) == ("bar", "band", "log")
    assert _read(signal.noct_spectrum(fmin=25, fmax=6300)).xs[0] == 25.0
    image = _checked(signal.stft(n_fft=512))
    assert (image["kind"], image["yAxis"]) == ("heatmap", "frequency")
    cells = _read(signal.stft(n_fft=512))
    assert cells.ys is not None and cells.values.shape == (cells.ys.size, cells.xs.size)


def test_pairwise_frames_draw_what_they_measure(signal: wd.ChannelFrame) -> None:
    coherence = _checked(signal.coherence(n_fft=1024))
    # The pair of two channels, not each channel with itself: high at the shared tone, below 1 elsewhere.
    assert coherence["quantity"] == "coherence" and np.nanmin(_read(signal.coherence(n_fft=1024)).values) < 0.9
    assert _checked(signal.transfer_function(n_fft=1024))["quantity"] == "gain"


def test_a_cepstrum_is_its_real_coefficients_over_quefrency_as_plot_draws_it(signal: wd.ChannelFrame) -> None:
    cepstrum = signal.cepstrum()
    view = _checked(cepstrum)
    assert (view["kind"], view["x"], view["xScale"], view["quantity"]) == ("line", "quefrency", "linear", "cepstrum")
    # The whole quefrency axis, as plot() draws it, from zero: every coefficient, channels averaged.
    reading = _read(cepstrum)
    assert reading.xs[0] == 0.0 and reading.xs[-1] == cepstrum.quefrencies[-1]
    coefficients = np.asarray(cepstrum.data).mean(axis=0)
    assert reading.values == pytest.approx(coefficients, abs=1e-5)


def test_a_cross_correlation_is_its_coefficients_over_lag_with_the_delay_peak_kept() -> None:
    rng = np.random.default_rng(0)
    signal = rng.standard_normal(16000)
    # ch2 is ch1 80 samples (5 ms) later: the peak sits at +5 ms.
    frame = wd.from_numpy(np.vstack([signal, np.roll(signal, 80)]), sampling_rate=16000)
    correlation = frame.cross_correlation(max_lag=0.1)
    view = _checked(correlation)
    assert (view["kind"], view["x"], view["xScale"], view["quantity"]) == ("line", "lag", "linear", "correlation")
    assert view["pair"] == {"output": 2, "input": 1}
    # ±0.1 s at 16 kHz is 3,201 lags: the reading keeps every one, each at its own lag.
    reading = _read(correlation)
    assert reading.xs.size == 3201 and reading.xs[0] == pytest.approx(-0.1)
    assert np.diff(reading.xs).min() == pytest.approx(1 / 16000)
    peak = int(np.argmax(reading.values))
    assert reading.xs[peak] == pytest.approx(0.005, abs=1 / 16000 * 2) and reading.values[peak] > 0.99
    # One channel has no pair of two: nothing to draw.
    assert stage_view(frame.get_channel(0).cross_correlation())["kind"] == "none"


def test_a_cepstrogram_is_an_image_over_time_and_quefrency(signal: wd.ChannelFrame) -> None:
    cepstrogram = signal.stft().cepstrum()
    view = _checked(cepstrogram)
    assert (view["kind"], view["x"], view["yAxis"], view["quantity"]) == ("heatmap", "time", "quefrency", "cepstrum")
    reading = _read(cepstrogram)
    assert reading.ys is not None and reading.values.shape == (reading.ys.size, reading.xs.size)
    assert reading.ys[0] == 0.0


def test_every_wandas_frame_is_drawn() -> None:
    import inspect

    import wandas.frames
    from wandas.core.base_frame import BaseFrame

    from frames.stage_view import STAGE_FRAME_TYPES

    found = [value for value in vars(wandas.frames).values() if inspect.isclass(value) and issubclass(value, BaseFrame)]
    missing = [frame.__name__ for frame in found if not issubclass(frame, STAGE_FRAME_TYPES)]
    assert missing == [], (
        f"wandas has Frame kinds the comparison does not draw: {missing}. Fix: follow 'Adding a new Frame kind' in "
        "docs/plot-layers.md (a branch in stage_view._read_frame and describe, then STAGE_FRAME_TYPES)."
    )


def test_an_stft_column_whose_window_sticks_out_of_the_signal_is_marked(signal: wd.ChannelFrame) -> None:
    spectrogram = signal.stft()
    assert _read(spectrogram).whole is None  # Without the signal's length nothing is marked.
    marked = _read(spectrogram, 2.0).whole
    assert marked is not None
    whole = marked.tolist()
    centres = np.atleast_2d(spectrogram.frame_center_times)[0]
    half = spectrogram.n_fft / 2 / RATE
    assert len(whole) == len(centres)
    assert whole == [bool(half <= centre <= 2.0 - half) for centre in centres]
    assert not whole[0] and not whole[-1] and any(whole)


def test_a_pairwise_frame_draws_one_named_pair_of_two_channels_never_a_channel_with_itself() -> None:
    noise = np.random.default_rng(3).standard_normal((2, 48_000))
    # ch1 and ch2 are the same signal (coherent at every frequency), ch3 is unrelated to both.
    stereo = wd.from_numpy(np.vstack([noise[0], noise[0], noise[1]]), sampling_rate=48_000)
    # Every pair: ch2 over the reference ch1, which are the same signal.
    view = _checked(stereo.coherence(n_fft=1024))
    assert view["pair"] == {"output": 2, "input": 1}
    assert np.nanmin(_read(stereo.coherence(n_fft=1024)).values) > 0.99
    # The pair a select_pair step leaves: ch3 over ch1, unrelated.
    picked = _checked(stereo.coherence(n_fft=1024).select_pair(2, 0))
    assert picked["pair"] == {"output": 3, "input": 1}
    assert np.nanmedian(_read(stereo.coherence(n_fft=1024).select_pair(2, 0)).values) < 0.1
    gain = _checked(stereo.transfer_function(n_fft=1024).select_pair(1, 0))
    assert gain["pair"] == {"output": 2, "input": 1}
    assert abs(np.median(_read(stereo.transfer_function(n_fft=1024).select_pair(1, 0)).values)) < 0.1
    # One channel has only itself to be compared with: coherence 1, gain 0 dB, which say nothing.
    mono = wd.from_numpy(noise[:1], sampling_rate=48_000)
    for frame in (mono.coherence(n_fft=1024), mono.transfer_function(n_fft=1024), mono.csd(n_fft=1024)):
        assert _checked(frame)["kind"] == "none"


def test_a_transfer_function_of_two_units_is_drawn_as_its_transfer_level_named_by_its_reference() -> None:
    # A33: gain_db refuses a pair of two units (Pa over V); the reading is the transfer level in dB re the units'
    # ratio, as the pair view's (analysis_service), and the description names that reference. A pair of one unit
    # stays a gain.
    noise = np.random.default_rng(5).standard_normal(48_000)
    mixed = wd.from_numpy(np.vstack([noise, 0.5 * noise]), sampling_rate=48_000, ch_units=["V", "Pa"])
    transfer = mixed.transfer_function(n_fft=1024)
    view = _checked(transfer)
    assert view["quantity"] == "gain" and view["pair"] == {"output": 2, "input": 1}
    picked = transfer.select_pair(1, 0)
    assert view["unit"] == picked.channels[0].level_reference.label
    # |H| = 0.5 Pa/V, in dB re the ratio of Pa's 20 µPa to V's 1 V.
    expected = 20 * np.log10(0.5 / picked.pair_domains[0].reference)
    values = _read(transfer).values
    assert np.median(values) == pytest.approx(expected, abs=0.2)
    assert np.median(values) == pytest.approx(np.median(np.asarray(picked.transfer_level_db)), abs=0.2)
    same = wd.from_numpy(np.vstack([noise, 0.5 * noise]), sampling_rate=48_000, ch_units=["Pa", "Pa"])
    gain = _checked(same.transfer_function(n_fft=1024))
    assert "unit" not in gain
    assert np.median(_read(same.transfer_function(n_fft=1024)).values) == pytest.approx(20 * np.log10(0.5), abs=0.2)


def test_power_mean_db_is_the_power_average_every_reading_uses() -> None:
    from frames.stage_view import _power_mean, power_mean_db

    rng = np.random.default_rng(7)
    levels = rng.uniform(-300.0, 120.0, size=(6, 50))
    levels[0, :] = -np.inf  # silence
    levels[1, 3] = np.nan
    levels[2, :] = rng.uniform(-200.0, -130.0, size=50)  # below the display floor
    with np.errstate(divide="ignore", invalid="ignore"):
        for axis in (0, 1):
            expected = 10.0 * np.log10(np.mean(10.0 ** (levels / 10.0), axis=axis))
            np.testing.assert_array_equal(power_mean_db(levels, axis), expected)
    np.testing.assert_array_equal(_power_mean(levels), power_mean_db(levels, 0))


def test_a_time_signal_names_the_measure_a_step_made_of_it() -> None:
    # rms_trend, sound_level and power turn the sound into another quantity: the value axis names it (R4).
    t = np.arange(16000) / 16000
    tone = wd.from_numpy(0.3 * np.sin(2 * np.pi * 1000 * t)[None], sampling_rate=16000)
    assert "measure" not in stage_view(tone)
    assert stage_view(tone.rms_trend())["measure"] == "rms"
    assert stage_view(tone.sound_level())["measure"] == "timeWeightedRms"
    assert stage_view(tone.power())["measure"] == "power"
    # In dB they give the level of what they measured: the axis names it (never the amplitude of a level).
    assert stage_view(tone.rms_trend(dB=True))["measure"] == "rms"
    assert stage_view(tone.sound_level(dB=True))["measure"] == "timeWeightedRms"
    # wandas defines no level for the amplitude to another power than 2: the quantity is not claimed (was
    # the amplitude raised to 3). An RMS of a power is a power to wandas (was an RMS in the power's unit).
    assert stage_view(tone.power(exponent=3))["measure"] == "unknown"
    assert "measureExponent" not in stage_view(tone.power(exponent=3))
    assert stage_view(tone.power().rms_trend())["measure"] == "power"
    # wandas keeps the unit through a normalisation: the amplitude, named so (was unknown).
    assert "measure" not in stage_view(tone.normalize())
    # A step after it keeps it; a metric after it is its own quantity.
    assert stage_view(tone.power().trim(0.1, 0.5))["measure"] == "power"
    assert "measure" not in stage_view(tone.power().loudness_zwtv())


_PA_TONE = wd.from_numpy(
    (0.3 * np.sin(2 * np.pi * 1000 * np.arange(16000) / 16000))[None], sampling_rate=16000, ch_units="Pa"
)
#: A chain of operations, the unit of the values it gives as wandas names it on the channel (stage_view.channel_unit;
#: wandas 0.13.2 keeps a unit through every operation: Pa^2 for the squared signal) and the quantity it is named
#: (stage_view.measure_of, from wandas' level kind and the step that measured: the measure and the power it is
#: raised to; None for the sound's own amplitude). The app once walked the operation history for both
#: (stage_view._walk, removed): the rows whose words changed with that are marked.
_UNIT_CHAINS = {
    "power(2)": (lambda s: s.power(2), "Pa^2", ("power", None)),
    # wandas defines no level for the amplitude to another power than 2: the quantity is not claimed (was Amplitude^3).
    "power(3)": (lambda s: s.power(exponent=3), "Pa^3", ("unknown", None)),
    "abs -> power(0.5)": (lambda s: s.abs().power(exponent=0.5), "Pa^0.5", ("unknown", None)),
    "power(1)": (lambda s: s.power(exponent=1), "Pa", None),
    "rms_trend": (lambda s: s.rms_trend(), "Pa", ("rms", None)),
    "sound_level": (lambda s: s.sound_level(), "Pa", ("timeWeightedRms", None)),
    # The square of an RMS is a power to wandas (was RMS^2).
    "rms_trend -> power(2)": (lambda s: s.rms_trend().power(2), "Pa^2", ("power", None)),
    # An RMS of a power is a power to wandas (was RMS, in the power's unit).
    "power(2) -> rms_trend": (lambda s: s.power(2).rms_trend(), "Pa^2", ("power", None)),
    "power(2) -> power(0.5)": (lambda s: s.power(2).power(exponent=0.5), "Pa", None),
    "power(2) -> trim": (lambda s: s.power(2).trim(0.1, 0.5), "Pa^2", ("power", None)),
    "lowpass -> resampling -> power(3)": (
        lambda s: s.low_pass_filter(4000).resampling(8000).power(exponent=3),
        "Pa^3",
        ("unknown", None),
    ),
    "operator ** 2": (lambda s: s**2, "Pa^2", ("power", None)),
    "scaled by 2": (lambda s: s * 2, "Pa", None),
    # A loudness has no level to wandas, nor its square: named by its unit as a metric (was Power).
    "loudness -> power(2)": (lambda s: s.loudness_zwtv().power(2), "sone^2", None),
    # wandas names a level in dB itself, of a power too (was no unit and an unknown quantity).
    "rms_trend(dB)": (lambda s: s.rms_trend(dB=True), "dB SPL re 2e-05 Pa", ("rms", None)),
    "power(2) -> rms_trend(dB)": (
        lambda s: s.power(2).rms_trend(dB=True),
        "dB re 4.0000000000000007e-10 Pa^2",
        ("rms", None),
    ),
    # wandas keeps the unit through a normalisation and multiplies the units of two signals (was no unit, unknown).
    "normalize": (lambda s: s.normalize(), "Pa", None),
    "power(2) -> normalize": (lambda s: s.power(2).normalize(), "Pa^2", ("power", None)),
    "a product of two signals": (lambda s: s * s, "Pa^2", ("power", None)),
}


@pytest.mark.parametrize("chain", sorted(_UNIT_CHAINS))
def test_the_unit_of_a_signal_after_operations_is_wandas_own(chain: str) -> None:
    # R4: the backend sends the unit of a step's values (view.unit) as wandas names it on the channel (channel_unit);
    # the webview writes it as given.
    make, unit, measure = _UNIT_CHAINS[chain]
    view = stage_view(make(_PA_TONE))
    sent = view.get("unit")
    assert sent == unit, (
        f"{chain}: the unit sent is {sent!r}, not {unit!r} (R4). It is wandas' unit of the channel "
        "(stage_view.channel_unit): never edit it in the app."
    )
    sent_measure = (view["measure"], view.get("measureExponent")) if "measure" in view else None
    assert sent_measure == measure, (
        f"{chain}: the quantity sent is {sent_measure!r}, not {measure!r} (R4). stage_view.measure_of takes it from "
        "wandas' level kind (power, none) and the step that measured (rms_trend, sound_level)."
    )


def test_a_spectrums_channels_are_power_averaged_before_their_level_is_rounded(signal: wd.ChannelFrame) -> None:
    """Rounding only what is written: two channels at 50.0051 and 49.9951 dB (written 50.01 and 50.00) power-average to
    50.0001, kept as it is (the webview writes 50.0) — not 50.01, the power mean of their written levels. Checked
    against numpy over the Frame's own dB."""
    import dask.array as da

    stereo = signal.fft()
    xs = np.asarray(stereo.freqs, dtype=np.float64)
    at = int(np.argmin(np.abs(xs - 3000)))
    data = np.array(stereo.data, dtype=np.complex128)

    def made(values: np.ndarray) -> wd.SpectralFrame:
        return wd.SpectralFrame(
            data=da.from_array(values),
            sampling_rate=stereo.sampling_rate,
            n_fft=stereo.n_fft,
            window=stereo.window,
            channel_metadata=list(stereo.channels),
        )

    # A unit bin's level, then each channel's bin scaled from it (a silent bin reads wandas' floor, not its level).
    data[:, at] = 1.0
    unit = np.asarray(made(data).dB, dtype=np.float64)[:, at]
    for channel, level in enumerate((50.0051, 49.9951)):
        data[channel, at] = 10 ** ((level - unit[channel]) / 20)
    frame = made(data)
    raw = np.asarray(frame.dB, dtype=np.float64)[:, at]
    assert raw == pytest.approx([50.0051, 49.9951], abs=1e-9)
    expected = float(10 * np.log10(np.mean(10 ** (raw / 10))))
    reading = _read(frame)
    assert reading.xs[at] == float(xs[at])
    # Kept unrounded (only the text the webview writes rounds it, to 50.0): the power mean of the Frame's own dB.
    assert float(reading.values[at]) == pytest.approx(expected, abs=1e-9) == pytest.approx(50.0001, abs=1e-4)


def test_a_cross_spectrum_of_two_units_is_named_by_its_pairs_reference_never_a_channels() -> None:
    # Reference V7: a recording against the base slot's is a pair of two units: its level is re the pair's reference
    # (wandas' pair domain), so the stage names that, not the compared channel's dB SPL.
    # Unitless pairs keep the channel's.
    noise = np.random.default_rng(5).standard_normal(48_000)
    mixed = wd.from_numpy(np.vstack([noise, 0.5 * noise]), sampling_rate=48_000, ch_units=["V", "Pa"])
    view = _checked(mixed.csd(n_fft=1024))
    assert view["quantity"] == "level"
    assert view["unit"] == mixed.csd(n_fft=1024).select_pair(1, 0).channels[0].level_reference.label
    assert "SPL" not in view["unit"]
    plain = wd.from_numpy(np.vstack([noise, 0.5 * noise]), sampling_rate=48_000)
    assert "unit" not in _checked(plain.csd(n_fft=1024))
