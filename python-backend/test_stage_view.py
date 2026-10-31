from __future__ import annotations

import numpy as np
import pytest
import wandas as wd

import analysis_spec as spec
from protocol_schema import DEFINITIONS, first_violation
from stage_view import LAG_POINTS, QUEFRENCY_POINTS, TIME_POINTS, stage_view

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


def test_a_time_signal_is_its_level_over_time(signal: wd.ChannelFrame) -> None:
    view = _checked(signal)
    assert (view["kind"], view["x"], view["quantity"], len(view["xs"])) == ("line", "time", "level", TIME_POINTS)
    # A 0.5 sine is 3 dB below its peak: −9 dB re 1.
    assert np.median(view["values"]) == pytest.approx(20 * np.log10(0.5 / np.sqrt(2)), abs=0.2)
    # A region keeps the file's seconds.
    region = _checked(signal.trim(0.5, 1.0))
    assert region["xs"][0] >= 0.5 and region["xs"][-1] <= 1.0


def test_a_metric_over_time_is_drawn_as_its_values(signal: wd.ChannelFrame) -> None:
    view = _checked(signal.rms_trend())
    assert (view["kind"], view["quantity"]) == ("line", "value")


def test_spectra_bands_and_spectrograms_share_the_comparisons_log_frequency_axis(signal: wd.ChannelFrame) -> None:
    spectrum = _checked(signal.welch(n_fft=1024))
    assert (spectrum["kind"], spectrum["x"], spectrum["xScale"], len(spectrum["xs"])) == (
        "line",
        "frequency",
        "log",
        spec.SPECTRUM_POINTS,
    )
    assert spectrum["xs"][0] > spec.SPECTRUM_MIN_HZ and spectrum["xs"][-1] < RATE / 2
    bands = _checked(signal.noct_spectrum(fmin=25, fmax=6300))
    assert (bands["kind"], bands["x"], bands["xs"][0]) == ("bar", "band", 25.0)
    image = _checked(signal.stft(n_fft=512))
    assert (image["kind"], image["yAxis"]) == ("heatmap", "frequency")
    assert len(image["matrix"]) == len(image["ys"]) and {len(row) for row in image["matrix"]} == {len(image["xs"])}


def test_pairwise_frames_draw_what_they_measure(signal: wd.ChannelFrame) -> None:
    coherence = _checked(signal.coherence(n_fft=1024))
    # The pair of two channels, not each channel with itself: high at the shared tone, below 1 elsewhere.
    assert (
        coherence["quantity"] == "coherence" and min(value for value in coherence["values"] if value is not None) < 0.9
    )
    assert _checked(signal.transfer_function(n_fft=1024))["quantity"] == "gain"


def test_a_cepstrum_is_its_real_coefficients_over_quefrency_as_plot_draws_it(signal: wd.ChannelFrame) -> None:
    cepstrum = signal.cepstrum()
    view = _checked(cepstrum)
    assert (view["kind"], view["x"], view["xScale"], view["quantity"]) == ("line", "quefrency", "linear", "cepstrum")
    assert len(view["xs"]) == QUEFRENCY_POINTS
    # The whole quefrency axis, as plot() draws it, from zero.
    assert view["xs"][0] == 0.0 and view["xs"][-1] <= cepstrum.quefrencies[-1]
    # Each point is a block's largest coefficient, so the zero-quefrency one is kept as it is.
    coefficients = np.asarray(cepstrum.data).mean(axis=0)
    assert view["values"][0] == pytest.approx(coefficients[0], abs=1e-5)
    assert max(abs(v) for v in view["values"][1:]) == pytest.approx(np.abs(coefficients[40:]).max(), abs=1e-5)


def test_a_cross_correlation_is_its_coefficients_over_lag_with_the_delay_peak_kept() -> None:
    rng = np.random.default_rng(0)
    signal = rng.standard_normal(16000)
    # ch2 is ch1 80 samples (5 ms) later: the peak sits at +5 ms.
    frame = wd.from_numpy(np.vstack([signal, np.roll(signal, 80)]), sampling_rate=16000)
    correlation = frame.cross_correlation(max_lag=0.1)
    view = _checked(correlation)
    assert (view["kind"], view["x"], view["xScale"], view["quantity"]) == ("line", "lag", "linear", "correlation")
    assert view["pair"] == {"output": 2, "input": 1}
    # ±0.1 s at 16 kHz is 3,201 lags, under LAG_POINTS: every one is drawn.
    assert len(view["xs"]) == 3201 < LAG_POINTS and view["xs"][0] == pytest.approx(-0.1)
    peak = int(np.argmax(view["values"]))
    assert view["xs"][peak] == pytest.approx(0.005, abs=1 / 16000 * 2) and view["values"][peak] > 0.99
    # Zoomed in, the lags on screen at full resolution.
    detail = stage_view(correlation, detail={"x": [0.0, 0.01], "points": 400})
    assert (
        detail["detail"] is True and detail["xs"][0] == 0.0 and np.diff(detail["xs"]).min() == pytest.approx(1 / 16000)
    )
    # One channel has no pair of two: nothing to draw.
    assert stage_view(frame.get_channel(0).cross_correlation())["kind"] == "none"


def test_a_new_steps_cross_correlation_keeps_every_lag_so_its_peak_is_at_its_own_lag() -> None:
    signal = np.random.default_rng(1).standard_normal(48000)
    # ch2 is ch1 48 samples (1 ms) later; ±0.1 s at 48 kHz is 9,601 lags, all drawn.
    frame = wd.from_numpy(np.vstack([signal, np.roll(signal, 48)]), sampling_rate=48000)
    view = _checked(frame.cross_correlation(max_lag=0.1))
    assert len(view["xs"]) == 9601
    assert view["xs"][int(np.argmax(view["values"]))] == pytest.approx(0.001)


def test_long_cross_correlations_share_their_lags_so_they_are_compared_at_one_lag() -> None:
    signal = np.random.default_rng(1).standard_normal(64000)

    def view(delay: int) -> dict:
        frame = wd.from_numpy(np.vstack([signal, np.roll(signal, delay)]), sampling_rate=16000)
        return _checked(frame.cross_correlation(max_lag=3.0))

    # 96,001 lags over ±3 s are drawn in blocks of 10 (0.625 ms), each at its centre: 1 ms and 2 ms stay apart.
    early, late = view(16), view(32)
    assert early["xs"] == late["xs"]
    block = 3.0 * 2 / 9601
    for drawn, delay in ((early, 0.001), (late, 0.002)):
        assert abs(drawn["xs"][int(np.argmax(drawn["values"]))] - delay) <= block / 2
    assert int(np.argmax(early["values"])) != int(np.argmax(late["values"]))


def test_a_cepstrogram_is_an_image_over_time_and_quefrency(signal: wd.ChannelFrame) -> None:
    cepstrogram = signal.stft().cepstrum()
    view = _checked(cepstrogram)
    assert (view["kind"], view["x"], view["yAxis"], view["quantity"]) == ("heatmap", "time", "quefrency", "cepstrum")
    assert len(view["matrix"]) == len(view["ys"]) and len(view["matrix"][0]) == len(view["xs"])
    assert view["ys"][0] == 0.0


def test_every_wandas_frame_is_drawn() -> None:
    import inspect

    import wandas.frames
    from wandas.core.base_frame import BaseFrame

    from stage_view import STAGE_FRAME_TYPES

    found = [value for value in vars(wandas.frames).values() if inspect.isclass(value) and issubclass(value, BaseFrame)]
    assert [frame.__name__ for frame in found if not issubclass(frame, STAGE_FRAME_TYPES)] == []


def test_an_stft_column_whose_window_sticks_out_of_the_signal_is_marked(signal: wd.ChannelFrame) -> None:
    spectrogram = signal.stft()
    assert "whole" not in _checked(spectrogram)  # Without the signal's length nothing is marked.
    view = stage_view(spectrogram, 2.0)
    assert first_violation(DEFINITIONS["StageView"], view) is None
    whole = view["whole"]
    centres = np.atleast_2d(spectrogram.frame_center_times)[0]
    half = spectrogram.n_fft / 2 / RATE
    assert len(whole) == len(centres)
    assert whole == [bool(half <= centre <= 2.0 - half) for centre in centres]
    assert not whole[0] and not whole[-1] and any(whole)


def test_a_zoomed_spectrum_is_its_own_bins_in_the_range_on_screen(signal: wd.ChannelFrame) -> None:
    welch = signal.welch(n_fft=4096)
    view = stage_view(welch, None, {"x": [900.0, 1100.0], "points": 1000})
    assert first_violation(DEFINITIONS["StageView"], view) is None
    freqs = np.asarray(welch.freqs)
    # Every bin between the bounds, nothing else: the Frame's full resolution, not the 192 log points.
    assert view["detail"] is True and view["xs"] == [float(f) for f in freqs[(freqs >= 900) & (freqs <= 1100)]]
    assert view["values"][int(np.argmin(np.abs(np.array(view["xs"]) - 1000)))] == max(view["values"])


def test_more_bins_than_the_screen_shows_keep_each_buckets_minimum_and_maximum(signal: wd.ChannelFrame) -> None:
    welch = signal.welch(n_fft=4096)
    view = stage_view(welch, None, {"x": [20.0, 8000.0], "points": 100})
    assert len(view["xs"]) == 100
    # The 1 kHz peak survives the decimation, as a waveform's peaks do on the lanes.
    assert max(view["values"]) == pytest.approx(
        max(stage_view(welch, None, {"x": [20.0, 8000.0], "points": 8000})["values"])
    )


def test_a_zoomed_image_is_only_its_time_and_frequency_on_screen(signal: wd.ChannelFrame) -> None:
    view = stage_view(signal.stft(), None, {"x": [0.5, 1.0], "y": [500.0, 2000.0], "points": 400})
    assert view["kind"] == "heatmap" and view["detail"] is True
    assert min(view["xs"]) >= 0.5 and max(view["xs"]) <= 1.0
    assert min(view["ys"]) >= 500 and max(view["ys"]) <= 2000
    assert len(view["matrix"]) == len(view["ys"]) and len(view["matrix"][0]) == len(view["xs"])


def test_without_detail_the_picture_is_as_before(signal: wd.ChannelFrame) -> None:
    assert stage_view(signal.welch(n_fft=1024)) == stage_view(signal.welch(n_fft=1024), None, None)
    assert "detail" not in stage_view(signal.welch(n_fft=1024))


def test_a_time_signal_carries_its_own_waveform_as_the_lanes_decimate_it(signal: wd.ChannelFrame) -> None:
    from decimator import decimated_waveform

    view = stage_view(signal)
    waveform = view["waveform"]
    samples = np.asarray(signal.data).mean(axis=0)
    # The lanes' overview: 1200 buckets of min and max, from the same routine.
    expected = decimated_waveform(samples, 1200, 0, samples.size)
    assert waveform["min"] == pytest.approx(expected["min"]) and waveform["max"] == pytest.approx(expected["max"])
    assert waveform["minT"][0] >= 0 and waveform["maxT"][-1] <= 2.0
    # The level over time stays for the headline and Δ.
    assert view["quantity"] == "level" and len(view["values"]) == TIME_POINTS
    # Zoomed into 10 ms: every sample there (160 at 16 kHz), not buckets.
    detail = stage_view(signal, None, {"x": [0.5, 0.51], "points": 2000})
    assert len(detail["waveform"]["min"]) == 161 and detail["waveform"]["min"] == detail["waveform"]["max"]


def test_a_pairwise_frame_draws_one_named_pair_of_two_channels_never_a_channel_with_itself() -> None:
    noise = np.random.default_rng(3).standard_normal((2, 48_000))
    # ch1 and ch2 are the same signal (coherent at every frequency), ch3 is unrelated to both.
    stereo = wd.from_numpy(np.vstack([noise[0], noise[0], noise[1]]), sampling_rate=48_000)
    # Every pair: ch2 over the reference ch1, which are the same signal.
    view = _checked(stereo.coherence(n_fft=1024))
    assert view["pair"] == {"output": 2, "input": 1}
    assert min(value for value in view["values"] if value is not None) > 0.99
    # The pair a select_pair step leaves: ch3 over ch1, unrelated.
    picked = _checked(stereo.coherence(n_fft=1024).select_pair(2, 0))
    assert picked["pair"] == {"output": 3, "input": 1}
    assert np.median([value for value in picked["values"] if value is not None]) < 0.1
    zoomed = stage_view(stereo.coherence(n_fft=1024).select_pair(2, 0), None, {"x": [100, 1000], "points": 400})
    assert zoomed["pair"] == {"output": 3, "input": 1} and max(zoomed["values"]) < 0.5
    gain = _checked(stereo.transfer_function(n_fft=1024).select_pair(1, 0))
    assert gain["pair"] == {"output": 2, "input": 1} and abs(np.median(gain["values"])) < 0.1
    # One channel has only itself to be compared with: coherence 1, gain 0 dB, which say nothing.
    mono = wd.from_numpy(noise[:1], sampling_rate=48_000)
    for frame in (mono.coherence(n_fft=1024), mono.transfer_function(n_fft=1024), mono.csd(n_fft=1024)):
        assert _checked(frame)["kind"] == "none"
