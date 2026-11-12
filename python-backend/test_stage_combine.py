from __future__ import annotations

import json
import tracemalloc
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from command_dispatch import dispatch, validate_request
from conftest import assert_not_drawn
from protocol_schema import DEFINITIONS, first_violation
from stage_combine import (
    STORE,
    StageData,
    _aligned,
    _Store,
    combine,
    difference_line,
    difference_peak,
    draw,
    level_bins,
    read_points,
    stage_data,
    time_axis,
    value_range,
)
from stage_view import stage_view

RATE = 16000
ENTRY_RECIPE = json.loads((Path(__file__).parent / "recipes" / "entry-scan.recipe.json").read_text())


@pytest.fixture(scope="module")
def signal() -> wd.ChannelFrame:
    rng = np.random.default_rng(7)
    tone = 0.5 * np.sin(2 * np.pi * 1000 * np.arange(RATE * 2) / RATE) + 0.01 * rng.standard_normal(RATE * 2)
    return wd.from_numpy(tone[np.newaxis], sampling_rate=RATE)


def _frames(signal: wd.ChannelFrame) -> dict[str, tuple[object, float | None]]:
    two = wd.from_numpy(np.stack([signal.data, np.roll(signal.data, 40)]), sampling_rate=RATE)
    return {
        "series": (signal.rms_trend(), None),
        "spectrum": (signal.welch(n_fft=1024), None),
        "fft": (signal.fft(), None),
        "coherence": (two.coherence(n_fft=1024), None),
        "bands": (signal.noct_spectrum(n=3, fmin=50, fmax=5000), None),
        "spectrogram": (signal.stft(n_fft=512), 2.0),
        "cepstrum": (signal.cepstrum(), None),
        "cepstrogram": (signal.stft(n_fft=512).cepstrum(), 2.0),
        "correlation": (two.cross_correlation(), None),
    }


def _same(drawn: dict, view: dict) -> None:
    for key in ("frame", "kind", "x", "xScale", "quantity", "yAxis", "whole", "detail"):
        assert drawn.get(key) == view.get(key), key
    assert drawn["xs"] == pytest.approx(view["xs"])
    if "matrix" in view:
        assert drawn["ys"] == pytest.approx(view["ys"])
        assert np.asarray(drawn["matrix"], dtype=float) == pytest.approx(
            np.asarray(view["matrix"], dtype=float), abs=0.11
        )
    else:
        assert np.asarray(drawn["values"], dtype=float) == pytest.approx(
            np.asarray(view["values"], dtype=float), abs=0.011
        )


@pytest.mark.parametrize(
    "name", ["series", "spectrum", "fft", "coherence", "bands", "spectrogram", "cepstrum", "cepstrogram", "correlation"]
)
def test_one_recordings_values_draw_as_its_own_picture(signal: wd.ChannelFrame, name: str) -> None:
    # A median is drawn as the recordings' own pictures are: one recording's values draw its picture.
    frame, signal_s = _frames(signal)[name]
    view = dict(stage_view(frame, signal_s))
    data = stage_data(frame, view, signal_s)
    assert data is not None
    _same(dict(draw(data)), view)
    if view["kind"] == "bar":
        return
    x = view["xs"]
    detail = {"x": [x[len(x) // 4], x[len(x) // 2]], "points": 300}
    _same(dict(draw(data, detail)), dict(stage_view(frame, signal_s, detail)))


def test_a_difference_line_keeps_every_buckets_extremes_at_their_own_places() -> None:
    xs = np.arange(1000, dtype=float)
    values = np.zeros(1000)
    values[123], values[777] = 9.0, -4.0
    drawn_x, drawn = difference_line(xs, values, 50, log=False)
    assert drawn.size <= 100
    assert drawn.max() == 9.0 and drawn.min() == -4.0
    assert drawn_x[np.argmax(drawn)] == 123 and drawn_x[np.argmin(drawn)] == 777
    # Log-spaced buckets on a log axis; non-finite values have no point.
    values[5] = np.nan
    log_x, _ = difference_line(xs + 1, values, 50, log=True)
    assert 6.0 not in log_x


def test_a_narrow_difference_is_taken_bin_by_bin_and_kept_when_drawn(signal: wd.ChannelFrame) -> None:
    # One bin at 3 kHz as loud as the tone in the compared recording: averaged into its 192-point band first, it
    # would read less; taken bin by bin and then drawn per bucket's extremes, it reads all of it.
    base = signal.fft()
    view = dict(stage_view(base))
    base_data = stage_data(base, view)
    assert base_data is not None
    raised = base_data.values.copy()
    at = int(np.argmin(np.abs(base_data.xs - 3000)))
    raised[at] = base_data.values.max()
    rise = raised[at] - base_data.values[at]
    assert rise > 40
    result = combine([base_data], replace(base_data, values=raised))
    largest = max(abs(v) for v in result["diff"]["values"] if v is not None)
    assert largest == pytest.approx(rise, abs=0.01)
    # Averaged into the picture's points first and then subtracted, the one bin's rise would read far less.
    thinned = np.array_split(raised - base_data.values, len(result["diff"]["values"]))
    assert_not_drawn(largest, max(abs(float(np.mean(chunk))) for chunk in thinned))
    assert first_violation(DEFINITIONS["StageView"], result["diff"]) is None
    # A difference zoomed into the range on screen, from every bin there.
    zoomed = combine([base_data], replace(base_data, values=raised), {"x": [2500.0, 3500.0], "points": 200})
    assert zoomed["diff"]["detail"] is True
    assert max(zoomed["diff"]["values"]) == pytest.approx(rise, abs=0.01)


def _at_levels(frame: wd.SpectralFrame, levels: dict[int, float]) -> wd.SpectralFrame:
    """``frame`` with the bins ``levels`` names set to those dB (as wandas reads them), the rest as they are."""
    import dask.array as da

    data = np.array(frame.data, dtype=np.complex128).reshape(1, -1)
    db = np.asarray(frame.dB, dtype=np.float64).reshape(-1)
    for bin_at, level in levels.items():
        data[0, bin_at] *= 10 ** ((level - db[bin_at]) / 20)
    made = wd.SpectralFrame(
        data=da.from_array(data),
        sampling_rate=frame.sampling_rate,
        n_fft=frame.n_fft,
        window=frame.window,
        label=frame.label,
        metadata=dict(frame.metadata),
        channel_metadata=list(frame.channels),
    )
    assert np.asarray(made.dB).reshape(-1)[list(levels)] == pytest.approx(list(levels.values()), abs=1e-9)
    return made


def test_a_difference_median_level_and_readout_are_taken_before_rounding_only_their_numbers_are_rounded(
    signal: wd.ChannelFrame,
) -> None:
    """Levels that round alike still differ (R1): −10.004 and −9.996 dB both write −10.00, but their Δ is 0.008
    (written 0.01 by the webview), and a group's median, the Δ's headline, the readout and a level are all taken from
    the Frame's unrounded dB and sent unrounded: only the text the webview writes rounds them. Checked against numpy
    over the Frames' own dB."""
    plain = signal.fft()
    xs = np.asarray(plain.freqs, dtype=np.float64)
    at = int(np.argmin(np.abs(xs - 3000)))
    # A base of one recording, compared with one 0.008 dB louder at one bin.
    base_frame, compare_frame = _at_levels(plain, {at: -10.004}), _at_levels(plain, {at: -9.996})
    view = dict(stage_view(plain))
    base, compare = stage_data(base_frame, view), stage_data(compare_frame, view)
    assert base is not None and compare is not None
    raw = {
        name: np.asarray(frame.dB, dtype=np.float64).reshape(-1)
        for name, frame in (("b", base_frame), ("c", compare_frame))
    }
    delta = raw["c"] - raw["b"]
    assert np.flatnonzero(delta).tolist() == [at]
    result = combine([base], compare)
    peak = result["diff"]["peak"]
    assert peak["x"] == pytest.approx(xs[at])
    assert peak["value"] == pytest.approx(float(delta[at]), abs=1e-12) == pytest.approx(0.008, abs=1e-9)
    assert max(abs(v) for v in result["diff"]["values"] if v is not None) == pytest.approx(0.008, abs=1e-9)
    read = read_points([base], compare, {"x": [float(xs[at])], "beyond": 0, "of": "diff"})
    assert read is not None and read["values"] == pytest.approx([float(delta[at])], abs=1e-12)
    # The level the overlay orders lines by: every bin's power, from the unrounded dB.
    window = [float(xs[at - 3]), float(xs[at + 3])]
    level = read_points([base], None, {"x": window, "level": "db"})
    assert level is not None
    expected = np.mean(10 ** (raw["b"][at - 3 : at + 4] / 10))
    assert level["level"]["power"] == pytest.approx(expected, rel=1e-12)
    # A group of three, its median −10.004 (written −10.01, −10.00, −10.00), against −9.9951 (written −10.00).
    members = [stage_data(_at_levels(plain, {at: level}), view) for level in (-10.006, -10.004, -9.996)]
    louder_frame = _at_levels(plain, {at: -9.9951})
    louder = stage_data(louder_frame, view)
    assert all(member is not None for member in members) and louder is not None
    member_db = np.stack(
        [
            np.asarray(_at_levels(plain, {at: level}).dB, dtype=np.float64).reshape(-1)
            for level in (-10.006, -10.004, -9.996)
        ]
    )
    median = np.median(member_db, axis=0)
    expected_delta = np.asarray(louder_frame.dB, dtype=np.float64).reshape(-1) - median
    grouped = combine(members, louder)  # type: ignore[arg-type]
    assert grouped["diff"]["peak"]["x"] == pytest.approx(xs[at])
    assert grouped["diff"]["peak"]["value"] == pytest.approx(float(expected_delta[at]), abs=1e-12)
    read = read_points(members, louder, {"x": [float(xs[at])], "beyond": 0, "of": "base"})  # type: ignore[arg-type]
    assert read is not None and read["values"] == pytest.approx([float(median[at])], abs=1e-12)


def test_a_dense_readout_picks_its_points_from_unrounded_levels(signal: wd.ChannelFrame) -> None:
    """A window too dense to send whole sends each pixel column's lowest point: the lowest of the Frame's own dB,
    not the first of two that round alike (−200.001 and −200.004 both write −200.00)."""
    plain = signal.fft()
    xs = np.asarray(plain.freqs, dtype=np.float64)
    first, lowest = int(np.argmin(np.abs(xs - 2000))), int(np.argmin(np.abs(xs - 6000)))
    frame = _at_levels(plain, {first: -200.001, lowest: -200.004})
    data = stage_data(frame, dict(stage_view(plain)))
    assert data is not None
    raw = np.asarray(frame.dB, dtype=np.float64).reshape(-1)
    window = [float(xs[1]), float(xs[-1])]
    read = read_points([data], None, {"x": window, "near": 0.0, "columns": 1, "beyond": 0})
    assert read is not None and not read["complete"]
    inside = np.flatnonzero((xs >= window[0]) & (xs <= window[1]))
    true_low = int(inside[np.argmin(raw[inside])])
    assert true_low == lowest
    low_at = int(np.argmin([v if v is not None else np.inf for v in read["values"]]))
    assert read["xs"][low_at] == pytest.approx(xs[lowest])
    assert read["values"][low_at] == pytest.approx(float(raw[lowest]), abs=1e-12)


def test_a_groups_median_is_taken_bin_by_bin_before_it_is_drawn(signal: wd.ChannelFrame) -> None:
    data = stage_data(signal.fft(), dict(stage_view(signal.fft())))
    assert data is not None
    rng = np.random.default_rng(1)
    members = [replace(data, values=data.values + rng.normal(0, 6, data.values.size)) for _ in range(3)]
    result = combine(members, None)
    expected = draw(replace(data, values=np.median(np.stack([m.values for m in members]), axis=0)))
    assert result["base"]["values"] == expected["values"]
    # It is not the median of the members' drawn pictures.
    drawn = np.median(np.stack([np.asarray(draw(m)["values"], dtype=float) for m in members]), axis=0)
    assert_not_drawn(result["base"]["values"], drawn)
    assert "diff" not in result


def test_a_time_signals_difference_is_compare_minus_base_sample_by_sample(signal: wd.ChannelFrame) -> None:
    """The sound's Δ is the ChannelFrame subtraction compare − base, from every sample, and is only thinned to be
    drawn (R1, R2): drawn as a waveform, as the recordings are, whole and zoomed."""
    louder = wd.from_numpy(signal.data[np.newaxis] * 2, sampling_rate=RATE)
    base, compare = (stage_data(frame, dict(stage_view(frame))) for frame in (signal, louder))
    assert base is not None and compare is not None
    expected = np.asarray((louder - signal).data, dtype=float)
    result = combine([base], compare)
    diff = result["diff"]
    assert diff["quantity"] == "value" and first_violation(DEFINITIONS["StageView"], diff) is None
    assert max(diff["waveform"]["max"]) == pytest.approx(expected.max(), abs=1e-5)
    assert min(diff["waveform"]["min"]) == pytest.approx(expected.min(), abs=1e-5)
    assert max(diff["values"]) == pytest.approx(expected.max(), abs=1e-5)
    # Zoomed into 10 ms: every sample of the difference there.
    zoomed = combine([base], compare, {"x": [0.5, 0.51], "points": 2000})["diff"]
    inside = expected[int(0.5 * RATE) : int(0.51 * RATE) + 1]
    assert zoomed["detail"] is True and len(zoomed["waveform"]["min"]) == inside.size
    assert zoomed["waveform"]["min"] == pytest.approx(inside, abs=1e-5)
    # A group's base is its median sample by sample; of different lengths, the samples both have.
    shorter = stage_data(signal.trim(0, 1.0), dict(stage_view(signal.trim(0, 1.0))))
    assert shorter is not None
    grouped = combine([base, shorter], compare)
    assert grouped["diff"]["waveform"]["maxT"][-1] <= 1.0


def test_a_time_signal_at_another_rate_has_no_sample_difference(signal: wd.ChannelFrame) -> None:
    # Samples at other times are not one another's: no Δ (the comparison says why), never a resampled guess.
    base = stage_data(signal, dict(stage_view(signal)))
    other = wd.from_numpy(signal.data[np.newaxis] * 2, sampling_rate=RATE).resampling(target_sr=22050)
    compare = stage_data(other, dict(stage_view(other)))
    assert base is not None and compare is not None
    assert combine([base], compare) == {"ok": True, "noDelta": "rate"}


def test_time_signals_in_other_units_or_calibrations_have_no_sample_difference(signal: wd.ChannelFrame) -> None:
    # Samples are subtracted as they are, so only in one unit against one reference: Pa against an uncalibrated
    # recording has no Δ (the comparison says why), and no group median either.
    calibrated = wd.from_numpy(signal.data[np.newaxis], sampling_rate=RATE, ch_units="Pa")
    base = stage_data(calibrated, dict(stage_view(calibrated)))
    compare = stage_data(signal, dict(stage_view(signal)))
    assert base is not None and compare is not None
    assert combine([base], compare) == {"ok": True, "noDelta": "unit"}
    assert combine([base, compare], None) == {"ok": True, "noDelta": "unit"}


def test_a_transfer_functions_difference_is_gated_by_its_pairs_unit_ratio_not_its_channels_level() -> None:
    # Two recordings' gains (one unit over itself) compare though one is in Pa and the other in V: a gain is re 1
    # either way. Two transfer levels compare only in one ratio: Pa/V against V/V has no Δ.
    noise = np.random.default_rng(11).standard_normal(48_000)

    def transfer(units: list[str], gain: float) -> object:
        frame = wd.from_numpy(np.vstack([noise, gain * noise]), sampling_rate=48_000, ch_units=units)
        transfer = frame.transfer_function(n_fft=1024)
        item = stage_data(transfer, dict(stage_view(transfer)))
        assert item is not None
        return item

    pa, volt = transfer(["Pa", "Pa"], 0.5), transfer(["V", "V"], 0.25)
    result = combine([pa], volt)
    assert "noDelta" not in result and result.get("diff") is not None
    assert np.median([value for value in result["diff"]["values"] if value is not None]) == pytest.approx(
        20 * np.log10(0.5), abs=0.3
    )
    # What its values are in is the drawn pair's (ch2 / ch1) ratio, never the Frame's first row (ch1 / ch1, always 1).
    assert transfer(["V", "Pa"], 0.5).calibration == ("Pa/V", pytest.approx(2e-5), "dB re 2e-05 Pa/V")
    assert pa.calibration == volt.calibration == ("1", 1.0, "dB re 1 1")
    assert combine([transfer(["V", "Pa"], 0.5)], transfer(["V", "V"], 0.5)) == {"ok": True, "noDelta": "unit"}
    assert "noDelta" not in combine([transfer(["V", "Pa"], 0.5)], transfer(["V", "Pa"], 0.25))


def _level(bins: dict, low: float = -np.inf, high: float = np.inf) -> float:
    edges, power, count = np.asarray(bins["edges"]), np.asarray(bins["power"]), np.asarray(bins["count"])
    middle = (edges[:-1] + edges[1:]) / 2
    inside = (middle >= low) & (middle <= high) & (count > 0)
    return float(10 * np.log10(np.sum(power[inside] * count[inside]) / np.sum(count[inside])))


def test_a_signals_level_bins_are_its_samples_mean_square_whole_and_zoomed(signal: wd.ChannelFrame) -> None:
    # R6 orders overlaid lines by every sample's power, never the drawn envelope: whole, zoomed in to a few samples,
    # and for a DC signal (whose envelope's max − min is zero).
    view = dict(stage_view(signal))
    samples = np.asarray(signal.data, dtype=float)
    assert _level(view["levelBins"]) == pytest.approx(10 * np.log10(np.mean(samples**2)), abs=0.01)
    zoomed = dict(stage_view(signal, None, {"x": [0.5, 0.5 + 3 / RATE], "points": 2000}))
    inside = samples[int(0.5 * RATE) : int(0.5 * RATE) + 4]
    assert sum(zoomed["levelBins"]["count"]) == inside.size
    assert _level(zoomed["levelBins"]) == pytest.approx(10 * np.log10(np.mean(inside**2)), abs=0.01)
    dc = wd.from_numpy(np.full((1, RATE), 0.25), sampling_rate=RATE)
    assert _level(dict(stage_view(dc))["levelBins"]) == pytest.approx(10 * np.log10(0.0625), abs=0.01)


def test_a_spectrums_level_bins_are_every_bins_power_not_the_drawn_points(signal: wd.ChannelFrame) -> None:
    spectrum = signal.welch(n_fft=4096)
    view = dict(stage_view(spectrum))
    data = stage_data(spectrum, view)
    assert data is not None
    inside = (data.xs >= 20) & (data.xs <= RATE / 2)
    full = 10 * np.log10(np.mean(10 ** (data.values[inside] / 10)))
    assert _level(view["levelBins"]) == pytest.approx(full, abs=0.01)
    assert len(view["xs"]) < int(inside.sum())  # the line is thinned, its level is not
    points = np.asarray(view["values"], dtype=float)[
        (np.asarray(view["xs"]) >= 20) & (np.asarray(view["xs"]) <= RATE / 2)
    ]
    assert_not_drawn(_level(view["levelBins"]), 10 * np.log10(np.mean(10 ** (points / 10))))


@pytest.mark.parametrize("name", ["series", "spectrum", "fft", "bands"])
def test_every_compared_level_line_carries_level_bins_whole_zoomed_and_as_a_median(
    signal: wd.ChannelFrame, name: str
) -> None:
    frame, _ = _frames(signal)[name]
    view = dict(stage_view(frame))
    assert first_violation(DEFINITIONS["StageView"], view) is None
    data = stage_data(frame, view)
    assert data is not None
    if view.get("quantity") not in ("level", "gain") and data.mode != "signal":
        assert "levelBins" not in view
        return
    assert "levelBins" in view, name
    xs = view["xs"]
    zoom = {"x": [xs[len(xs) // 4], xs[len(xs) // 2]], "points": 400}
    assert "levelBins" in dict(stage_view(frame, None, zoom)), name
    median = combine([data, data], None)["base"]
    assert "levelBins" in median and first_violation(DEFINITIONS["StageView"], median) is None, name
    assert level_bins(data) is not None


@pytest.mark.parametrize("samples", [16, 2048, 2049])
def test_a_short_time_signal_is_a_signal_whatever_its_length(signal: wd.ChannelFrame, samples: int) -> None:
    # A signal is told from a metric by the operation that made it, never by how many samples it has: a short
    # recording is drawn as its waveform, checked for its unit like any other, and compared with a long one.
    short = wd.from_numpy(signal.data[np.newaxis, :samples], sampling_rate=RATE)
    view = dict(stage_view(short))
    assert "waveform" in view and len(view["waveform"]["min"]) == min(samples, 1200)
    item = stage_data(short, view)
    assert item is not None and item.mode == "signal"
    calibrated = wd.from_numpy(signal.data[np.newaxis, :samples], sampling_rate=RATE, ch_units="Pa")
    other = stage_data(calibrated, dict(stage_view(calibrated)))
    assert other is not None
    assert combine([item], other) == {"ok": True, "noDelta": "unit"}
    long = stage_data(signal, dict(stage_view(signal)))
    assert long is not None
    diff = combine([item], long)["diff"]
    expected = np.asarray(signal.data[:samples], dtype=float) - np.asarray(signal.data[:samples], dtype=float)
    assert max(diff["waveform"]["max"]) == pytest.approx(expected.max(), abs=1e-6)


def test_values_in_other_units_have_no_difference_whatever_the_frame(signal: wd.ChannelFrame) -> None:
    # The unit check is the combine's, not one Frame type's: a metric or spectrum in Pa against one uncalibrated
    # has no Δ and no median either, and says why.
    calibrated = wd.from_numpy(signal.data[np.newaxis], sampling_rate=RATE, ch_units="Pa")
    for name, (frame, _) in _frames(signal).items():
        if name in ("coherence", "correlation"):
            continue  # a pair's quantity has no unit of its own
        other = _frames(calibrated)[name][0]
        first, second = stage_data(other, dict(stage_view(other))), stage_data(frame, dict(stage_view(frame)))
        assert first is not None and second is not None
        assert combine([first], second) == {"ok": True, "noDelta": "unit"}, name
        assert combine([first, second], None) == {"ok": True, "noDelta": "unit"}, name
        # Calibrated alike, they have their Δ.
        assert "diff" in combine([first], stage_data(other, dict(stage_view(other)))), name


def test_a_small_signal_difference_keeps_its_significant_figures() -> None:
    # A difference of 1e-7 Pa is drawn as it is (six significant figures), never rounded to zero by decimals.
    view = {"frame": "ChannelFrame", "kind": "line", "x": "time", "xScale": "linear", "quantity": "value", "unit": "Pa"}
    level = np.full(4096, 1e-4, dtype=np.float32)
    base = StageData("signal", view, np.empty(0), level, start=0.0, rate=48_000.0)  # type: ignore[arg-type]
    compare = replace(base, values=level + np.float32(1e-7))
    diff = combine([base], compare)["diff"]
    assert min(diff["values"]) == pytest.approx(1e-7, rel=1e-2)
    assert diff["waveform"]["absolutePeak"] == pytest.approx(1e-7, rel=1e-2)


def test_a_long_signals_difference_needs_no_array_of_times_or_float64_copy() -> None:
    # A minute at 48 kHz, kept float64 (stage_data): the Δ is one float64 subtraction, and drawing it (whole or zoomed)
    # takes each bucket's extremes by index, so the memory beyond the kept samples stays near the difference's own 8
    # bytes a sample: no copy of the samples, no array of their times.
    count, rate = 48_000 * 60, 48_000.0
    view = {"frame": "ChannelFrame", "kind": "line", "x": "time", "xScale": "linear", "quantity": "value", "unit": "Pa"}
    rng = np.random.default_rng(5)

    def recording() -> StageData:
        samples = rng.standard_normal(count)
        return StageData("signal", view, np.empty(0), samples, start=0.0, rate=rate)  # type: ignore[arg-type]

    base, compare = recording(), recording()
    for detail in (None, {"x": [10.0, 10.01], "points": 800}):
        tracemalloc.start()
        result = combine([base], compare, detail)  # type: ignore[arg-type]
        peak = tracemalloc.get_traced_memory()[1]
        tracemalloc.stop()
        assert peak < 12 * count, f"{peak / count:.1f} bytes a sample"
        assert result["diff"]["xs"]


def test_a_long_lines_extremes_are_each_buckets_first_lowest_and_last_highest() -> None:
    # The path for a line of finite values on a linear axis (no index arrays as long as the line) keeps what every
    # line keeps: per bucket of decimator.bucket_starts (as np.array_split) its first lowest and last highest value.
    from stage_view import min_max_indices

    values = np.round(np.random.default_rng(6).standard_normal(10_007), 1)  # rounded: many ties
    xs = np.arange(values.size, dtype=np.float64)
    for buckets in (1, 7, 300, 5003, 6000):
        expected: set[int] = set()
        if values.size <= 2 * buckets:
            expected = set(range(values.size))
        else:
            for chunk in np.array_split(np.arange(values.size), buckets):
                block = values[chunk]
                expected |= {int(chunk[np.flatnonzero(block == block.min())[0]])}
                expected |= {int(chunk[np.flatnonzero(block == block.max())[-1]])}
        assert min_max_indices(xs, values, buckets, False).tolist() == sorted(expected)


def test_pictures_on_other_axes_have_no_median_or_difference(signal: wd.ChannelFrame) -> None:
    spectrum = stage_data(signal.welch(n_fft=1024), dict(stage_view(signal.welch(n_fft=1024))))
    other = stage_data(signal.welch(n_fft=512), dict(stage_view(signal.welch(n_fft=512))))
    assert spectrum is not None and other is not None
    assert combine([spectrum], other) == {"ok": True}


def test_the_store_drops_the_least_recently_used_beyond_its_budget(signal: wd.ChannelFrame) -> None:
    data = stage_data(signal.fft(), dict(stage_view(signal.fft())))
    assert data is not None
    store = _Store(int(data.nbytes * 2.5))
    store.put("a", data)
    store.put("b", data)
    assert store.get("a") is data
    store.put("c", data)
    assert (store.has("a"), store.has("b"), store.has("c")) == (True, False, True)


def _scan(service: AnalysisService, path: str, **payload: object) -> dict:
    request = validate_request({"cmd": "scan", "requestId": "r", "filePath": path, "recipe": ENTRY_RECIPE, **payload})
    return dispatch(request, service)


def _combine(service: AnalysisService, **payload: object) -> dict:
    request = validate_request({"cmd": "stage-combine", "requestId": "r", **payload})
    result = dispatch(request, service)
    assert first_violation(DEFINITIONS["StageCombineResult"], result) is None
    return dict(result)


def test_a_scans_step_keeps_its_values_for_the_combine_command(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    paths = []
    for index, amplitude in enumerate((0.1, 0.2, 0.4)):
        path = tmp_path / f"{index}.wav"
        sf.write(path, amplitude * np.sin(2 * np.pi * 1000 * np.arange(RATE * 2) / RATE), RATE, subtype="FLOAT")
        paths.append(str(path))
    views = [_scan(service, path, stage="node-2")["stage"] for path in paths]
    keys = [view["data"] for view in views]
    assert len(set(keys)) == 3
    # A zoomed picture of the same step names the same values.
    zoomed = _scan(service, paths[0], stage="node-2", detail={"x": [500.0, 2000.0], "points": 200})["stage"]
    assert zoomed["data"] == keys[0]
    result = _combine(service, base=keys[:2], compare=keys[2])
    assert result["ok"] is True and result["base"]["kind"] == "line"
    # The median of 0.1 and 0.2 is their mean in dB: 0.4 is 6 + 3 dB above it at 1 kHz.
    diff = np.asarray(result["diff"]["values"], dtype=float)
    xs = np.asarray(result["diff"]["xs"], dtype=float)
    assert diff[int(np.argmin(np.abs(xs - 1000)))] == pytest.approx(20 * np.log10(4 / np.sqrt(2)), abs=0.1)
    STORE.clear()
    assert _combine(service, base=keys[:2], compare=keys[2]) == {"ok": False, "missing": keys}


@pytest.mark.parametrize("name", ["coherence", "correlation", "cepstrum", "series", "events"])
def test_every_line_keeps_a_one_point_dip_and_peak_when_drawn(signal: wd.ChannelFrame, name: str) -> None:
    """R2: a line with more points than the screen keeps each bucket's lowest and highest value, at its own x (a
    trigger's events' mean too): a one-bin coherence dip, a one-lag correlation peak or a one-sample hit of either
    sign is never averaged away, interpolated past, moved to its bucket's edge or dropped for the other sign's
    extreme."""
    frames = _frames(signal)
    frames["events"] = (signal.segment([0.5], duration=0.5), None)
    frames["series"] = (signal.rms_trend(frame_length=64, hop_length=8), None)
    frame, signal_s = frames[name]
    data = stage_data(frame, dict(stage_view(frame, signal_s)), signal_s)
    assert data is not None
    values = data.values.copy()
    inside = np.flatnonzero((data.xs >= 20) & (data.xs <= data.nyquist)) if name == "coherence" else None
    span = inside if inside is not None else np.arange(1, values.size)
    # Side by side, so in one bucket.
    low_at = int(span[span.size // 3])
    high_at = low_at + 1
    floor, top = np.nanmin(values) - 1.0, np.nanmax(values) + 1.0
    if name == "coherence":
        floor, top = 0.0, float(np.nanmax(values))
    values[low_at] = floor
    if name != "coherence":
        values[high_at] = top
    drawn = draw(replace(data, values=values))
    xs, line = np.asarray(drawn["xs"], dtype=float), np.asarray(drawn["values"], dtype=float)
    assert xs.size < values.size
    assert np.nanmin(line) == pytest.approx(floor, abs=1e-3)
    if name != "coherence":
        assert np.nanmax(line) == pytest.approx(top, abs=1e-3)
    assert xs[int(np.nanargmin(line))] == pytest.approx(data.xs[low_at])
    if name != "coherence":
        assert xs[int(np.nanargmax(line))] == pytest.approx(data.xs[high_at])


def test_each_event_of_a_trigger_is_its_own_line_with_its_extremes_at_their_own_times() -> None:
    """R2: a trigger's events are drawn as every line is (stage_view._envelope), each its own series: its own xs,
    each bucket's lowest and highest sample at the time from the trigger it occurred. One event's hit is never moved
    to the edge of a bucket shared with another event, nor given the other's times."""
    from stage_view import EVENT_POINTS, _envelope

    count = RATE
    samples = np.zeros(count)
    # Two events cut at 0.1 s and 0.6 s: a positive hit inside the first, a negative one elsewhere in the second.
    samples[1600 + 1000], samples[9600 + 2345] = 0.9, -0.7
    frame = wd.from_numpy(samples[np.newaxis], sampling_rate=RATE).segment([0.1, 0.6], duration=0.3)
    view = stage_view(frame, None)
    events = view["events"]
    rows = frame.to_numpy().reshape(len(events), -1)
    times = np.arange(rows.shape[1]) / RATE - float(frame.pre)
    for event, row in zip(events, rows, strict=True):
        xs, values = _envelope(times, row, EVENT_POINTS)
        np.testing.assert_allclose(event["xs"], xs)
        np.testing.assert_allclose(np.asarray(event["values"], dtype=float), values)
        assert len(event["xs"]) == len(event["values"]) < row.size
    first, second = (np.asarray(event["xs"]) for event in events)
    one, two = (np.asarray(event["values"], dtype=float) for event in events)
    # Each hit at the time its own sample is from its trigger (brute force over its own samples).
    assert one.max() == pytest.approx(0.9) and first[int(one.argmax())] == pytest.approx(times[int(rows[0].argmax())])
    assert two.min() == pytest.approx(-0.7) and second[int(two.argmin())] == pytest.approx(times[int(rows[1].argmin())])
    # Each its own series: the second's xs are not the first's.
    assert not np.array_equal(first, second)


def test_a_triggers_events_carry_their_samples_power_so_a_quiet_recordings_events_are_drawn_over_a_loud_ones() -> None:
    """A44, R6: a trigger's events are ordered among the overlaid recordings by their samples' mean square, as a
    signal is: their view has levelBins, the quieter recording's lower."""
    rng = np.random.default_rng(4)

    def events(scale: float) -> dict:
        frame = wd.from_numpy(scale * rng.standard_normal((1, RATE)), sampling_rate=RATE).segment(
            [0.1, 0.6], duration=0.3
        )
        return dict(stage_view(frame, None))

    quiet, loud = events(0.01), events(0.5)
    for view, scale in ((quiet, 0.01), (loud, 0.5)):
        bins = view["levelBins"]
        power, count = np.asarray(bins["power"]), np.asarray(bins["count"])
        mean_square = float(np.sum(power * count) / np.sum(count))
        assert 10 * np.log10(mean_square) == pytest.approx(20 * np.log10(scale), abs=0.5)
    assert sum(quiet["levelBins"]["power"]) < sum(loud["levelBins"]["power"])


@pytest.mark.parametrize(
    "name", ["series", "spectrum", "fft", "coherence", "bands", "spectrogram", "cepstrum", "cepstrogram", "correlation"]
)
def test_the_headlines_largest_difference_is_found_among_every_value_at_its_own_place(
    signal: wd.ChannelFrame, name: str
) -> None:
    """R2: the Δ pane's headline (``peak``) is the largest |compare − base| among every value before thinning, at
    that value's own x (and row): never a drawn bucket's place (a block's mean time, a band's centre)."""
    frame, signal_s = _frames(signal)[name]
    data = stage_data(frame, dict(stage_view(frame, signal_s)), signal_s)
    assert data is not None
    raised = _f64(data.values).copy()
    if raised.ndim == 2:
        low = 50 if data.mode == "spectrogram" else 0
        rows = np.flatnonzero((data.ys > low) & (data.ys < 0.9 * (data.nyquist or np.inf)))
        columns = np.flatnonzero(data.whole) if data.whole is not None else np.arange(raised.shape[1])
        row, column = int(rows[rows.size // 3]), int(columns[columns.size // 2 + 1])
        raised[row, column] += 7.0
        where = {"x": data.xs[column], "y": data.ys[row]}
    else:
        inside = np.flatnonzero((data.xs > 50) & (data.xs < 0.9 * data.nyquist)) if data.nyquist else None
        span = inside if inside is not None and inside.size else np.arange(1, raised.size)
        at = int(span[span.size // 3 + 1])
        raised[at] += 0.4 if name in ("coherence", "correlation", "cepstrum") else 7.0
        where = {"x": data.xs[at]}
    result = combine([data], replace(data, values=raised))
    peak = result["diff"]["peak"]
    assert first_violation(DEFINITIONS["StageView"], result["diff"]) is None
    assert peak["x"] == pytest.approx(where["x"])
    if "y" in where:
        assert peak["y"] == pytest.approx(where["y"])
    assert abs(peak["value"]) == pytest.approx(
        0.4 if name in ("coherence", "correlation", "cepstrum") else 7.0, abs=0.06
    )
    # A difference thinned by averaging before its largest value is looked for would read far less.
    every = np.nan_to_num(np.abs(raised - _f64(data.values))).reshape(-1)
    assert_not_drawn(
        abs(peak["value"]), max(float(np.mean(chunk)) for chunk in np.array_split(every, max(1, every.size // 8)))
    )


def test_the_headline_leaves_out_padding_columns_the_zero_quefrency_and_whatever_is_off_screen(
    signal: wd.ChannelFrame,
) -> None:
    frames = _frames(signal)
    stft, signal_s = frames["spectrogram"]
    data = stage_data(stft, dict(stage_view(stft, signal_s)), signal_s)
    assert data is not None and data.whole is not None and not data.whole[-1]
    values = np.zeros_like(_f64(data.values))
    row = int(np.argmin(np.abs(data.ys - 1000)))
    values[row, -1] = 30.0  # reads padding: drawn, never the headline
    values[row, 10] = 3.0
    assert difference_peak(data, values)["x"] == pytest.approx(data.xs[10])
    # Zoomed to where it is not, the headline is the largest there.
    values[row, 40] = 1.0
    zoomed = difference_peak(data, values, {"x": [data.xs[35], data.xs[45]], "points": 200})
    assert zoomed is not None and zoomed["x"] == pytest.approx(data.xs[40]) and zoomed["value"] == pytest.approx(1.0)
    ceps, _ = frames["cepstrum"]
    cdata = stage_data(ceps, dict(stage_view(ceps)))
    assert cdata is not None
    line = np.zeros_like(_f64(cdata.values))
    line[0], line[5] = 9.0, 0.2
    assert difference_peak(cdata, line)["x"] == pytest.approx(cdata.xs[5])


def test_the_headline_is_found_before_rounding(signal: wd.ChannelFrame) -> None:
    """Two differences that round to the same drawn digits still name the larger one; only its value is rounded."""
    frames = _frames(signal)
    for name in ("series", "spectrum", "spectrogram"):
        frame, source = frames[name]
        data = stage_data(frame, dict(stage_view(frame, *([source] if source is not None else []))), source)
        assert data is not None
        values = np.zeros_like(_f64(data.values))
        if values.ndim == 1:
            values[20], values[30] = 7.0001, 7.0004
            want = {"x": data.xs[30]}
        else:
            row = int(np.argmin(np.abs(data.ys - 1000)))
            values[row, 5], values[row, 8] = 7.0001, 7.0004
            want = {"x": data.xs[8]}
        peak = difference_peak(data, values)
        assert peak is not None and peak["x"] == pytest.approx(want["x"]), name
        assert peak["value"] == pytest.approx(7.0, abs=0.01), name


def test_a_time_signals_headline_is_its_largest_sample_difference_at_that_samples_time(
    signal: wd.ChannelFrame,
) -> None:
    view = dict(stage_view(signal))
    data = stage_data(signal, view)
    assert data is not None and data.mode == "signal"
    raised = data.values.copy()
    raised[12345] += 0.75
    peak = combine([data], replace(data, values=raised))["diff"]["peak"]
    assert peak["x"] == pytest.approx(data.start + 12345 / RATE)
    assert peak["value"] == pytest.approx(0.75, abs=1e-3)
    assert peak["xStep"] == pytest.approx(1 / RATE)


def _f64(values: object) -> np.ndarray:
    return np.asarray(values, dtype=np.float64)


def test_an_images_headline_copies_only_the_part_on_screen() -> None:
    """A long spectrogram's Δ headline, whole or zoomed, takes no more than one copy of the part on screen beyond
    the difference itself: never the whole plane again and again."""
    rows, columns = 513, 8000
    view = {"frame": "SpectrogramFrame", "kind": "heatmap", "x": "time", "xScale": "linear", "quantity": "level"}
    rng = np.random.default_rng(3)
    plane = rng.standard_normal((rows, columns))
    data = StageData(
        "spectrogram",
        view,  # type: ignore[arg-type]
        np.arange(columns) * 0.01,
        plane,
        np.linspace(0, 8000, rows),
        np.ones(columns, dtype=bool),
        nyquist=8000.0,
    )
    plane[200, 4321] = 99.0
    for detail in (None, {"x": [40.0, 42.0], "points": 400}):
        tracemalloc.start()
        peak = difference_peak(data, plane, detail)  # type: ignore[arg-type]
        used = tracemalloc.get_traced_memory()[1]
        tracemalloc.stop()
        assert peak is not None
        assert used < plane.nbytes * 0.1, f"{used / plane.nbytes:.2f} planes"
    assert difference_peak(data, plane)["x"] == pytest.approx(43.21)  # type: ignore[index]


def test_a_median_and_a_difference_carry_their_full_datas_value_range(signal: wd.ChannelFrame) -> None:
    """The Δ pane's ± and the base median's axis are set from every bin's value (R1, R9): the valueRange of the
    unrounded Δ over the part drawn, checked against numpy over the Frames' own dB."""
    plain = signal.fft()
    xs = np.asarray(plain.freqs, dtype=np.float64)
    at, dip = int(np.argmin(np.abs(xs - 3000))), int(np.argmin(np.abs(xs - 5000)))
    view = dict(stage_view(plain))
    base_frame, compare_frame = _at_levels(plain, {at: -10.004}), _at_levels(plain, {at: 7.25, dip: -95.5})
    base, compare = stage_data(base_frame, view), stage_data(compare_frame, view)
    assert base is not None and compare is not None

    def db(frame: object) -> np.ndarray:
        return np.asarray(frame.dB, dtype=np.float64).reshape(-1)  # type: ignore[attr-defined]

    delta = db(compare_frame) - db(base_frame)
    drawn = (xs >= 20) & (xs <= RATE / 2) & (xs > 0)
    result = combine([base], compare)
    expected = {"min": float(delta[drawn].min()), "max": float(delta[drawn].max())}
    assert result["diff"]["valueRange"] == pytest.approx(expected)
    zoomed = combine([base], compare, {"x": [2500.0, 3500.0], "points": 200})
    inside = (xs >= 2500.0) & (xs <= 3500.0)
    assert zoomed["diff"]["valueRange"]["max"] == pytest.approx(float(delta[inside].max()))
    members = [stage_data(_at_levels(plain, {at: level}), view) for level in (-12.0, -10.0, 4.5)]
    grouped = combine(members, None)  # type: ignore[arg-type]
    median = np.median(np.stack([db(_at_levels(plain, {at: level})) for level in (-12.0, -10.0, 4.5)]), axis=0)
    shown = median[drawn]
    expected = {"min": float(shown[shown > -250].min()), "max": float(shown.max())}
    assert grouped["base"]["valueRange"] == pytest.approx(expected)


def test_zoomed_the_headlines_peak_is_looked_for_in_the_window_on_screen_alone_not_its_margin() -> None:
    # A detail reaches past the screen (2–4 s on screen, 0–8 s asked): the Δ of 0.5 at 7 s is in the margin, the
    # largest on screen is 0.03 at 3 s. The headline names that one (A21, C4), from every sample.
    rate = 1000.0
    view = {"frame": "ChannelFrame", "kind": "line", "x": "time", "xScale": "linear", "quantity": "value", "unit": "Pa"}
    base_samples = np.zeros(10_000, dtype=np.float32)
    compare_samples = base_samples.copy()
    compare_samples[3000], compare_samples[7000] = -0.03, 0.5
    base = StageData("signal", view, np.empty(0), base_samples, start=0.0, rate=rate)  # type: ignore[arg-type]
    compare = StageData("signal", view, np.empty(0), compare_samples, start=0.0, rate=rate)  # type: ignore[arg-type]
    margin = combine([base], compare, {"x": [0.0, 8.0], "points": 400})  # type: ignore[arg-type]
    assert margin["diff"]["peak"]["x"] == pytest.approx(7.0)
    shown = combine([base], compare, {"x": [0.0, 8.0], "points": 400, "peakX": [2.0, 4.0]})  # type: ignore[arg-type]
    assert shown["diff"]["peak"]["x"] == pytest.approx(3.0)
    assert shown["diff"]["peak"]["value"] == pytest.approx(-0.03)
    # The line drawn is still the whole detail's.
    assert shown["diff"]["xs"] == margin["diff"]["xs"]


def test_a_time_axis_key_agrees_with_what_aligned_combines() -> None:
    """The webview counts time lines on one axis by ``timeAxis`` (pictureAxis): exactly those ``_aligned`` combines,
    other lengths alike, another step or start apart (class sweep 4, aggregation V6)."""
    view = {"frame": "ChannelFrame", "kind": "line", "x": "time", "xScale": "linear", "quantity": "level"}

    def line(step: float, n: int, start: float = 0.0) -> StageData:
        return StageData("line", view, start + np.arange(n) * step, np.zeros(n))  # type: ignore[arg-type]

    hop48, hop44 = 512 / 48_000, 512 / 44_100
    same = [line(hop48, 10), line(hop48, 12)]
    assert _aligned(same) is not None
    assert time_axis(same[0]) == time_axis(same[1])
    for other in (line(hop44, 10), line(hop48, 10, start=hop48 / 2)):
        assert _aligned([same[0], other]) is None
        assert time_axis(same[0]) != time_axis(other)
    signal = StageData("signal", view, np.empty(0), np.zeros(4), start=0.0, rate=48_000.0)  # type: ignore[arg-type]
    assert time_axis(signal) == {"start": 0.0, "step": 1 / 48_000}


def test_a_difference_has_no_silent_floor_its_range_and_reads_hold_a_delta_of_minus_260_db() -> None:
    """Only a level has a silent floor (SILENT_DB and below): a Δ of −260 dB is a Δ, in its range and its readout,
    while a level's silence (−300 dB) stays out of the level's range."""
    xs = np.arange(1.0, 9.0) * 100.0
    base_levels = np.array([-300.0, -10.0, -9.996, -300.0, -20.0, -30.0, -40.0, -50.0])
    compared = base_levels.copy()
    compared[2] = -269.996
    view = {"frame": "SpectralFrame", "kind": "line", "x": "frequency", "xScale": "linear", "quantity": "level"}
    base = StageData(mode="spectrum", view=view, xs=xs, values=base_levels, nyquist=float(xs[-1]))  # type: ignore[arg-type]
    compare = StageData(mode="spectrum", view=view, xs=xs, values=compared, nyquist=float(xs[-1]))  # type: ignore[arg-type]
    result = combine([base], compare, {"x": [100.0, 800.0], "points": 64})
    assert result["diff"]["valueRange"]["min"] == pytest.approx(-260.0)
    # A level's own range leaves out its silence (−300 dB, and −269.996 dB too): the floor is a level's only.
    assert value_range(compare, {"x": [100.0, 800.0], "points": 64})["min"] == pytest.approx(-50.0)  # type: ignore[index]
    seek = read_points([base], compare, {"x": [100.0], "seek": 1, "beyond": 1, "of": "diff", "plain": True})
    assert seek is not None and seek["values"][seek["xs"].index(300.0)] == pytest.approx(-260.0)


def test_a_median_and_a_difference_are_taken_and_kept_in_float64() -> None:
    """Values a float32 step apart (0.5 and 0.5 + 2⁻²⁴) have a median between them (0.5 + 2⁻²⁵, no float32) and a Δ
    from it of 2⁻²⁵: computed and kept in float64, in the picture's range and peak and in a read alike."""
    view = {"frame": "ChannelFrame", "kind": "line", "x": "time", "xScale": "linear", "quantity": "value"}
    step = 2.0**-24

    def samples(value: float) -> StageData:
        return StageData(mode="signal", view=view, xs=np.empty(0), values=np.full(8, value), rate=1000.0)  # type: ignore[arg-type]

    base, compare = [samples(0.5), samples(0.5 + step)], samples(0.5 + step)
    result = combine(base, compare)
    assert result["base"]["valueRange"] == {"min": 0.5 + step / 2, "max": 0.5 + step / 2}
    assert result["diff"]["peak"]["value"] == step / 2
    assert result["diff"]["valueRange"] == {"min": step / 2, "max": step / 2}
    read = read_points(base, compare, {"x": [0.0, 0.007], "beyond": 0, "of": "diff"})
    assert read is not None and read["values"] == [step / 2] * 8


def test_every_full_resolution_picture_is_kept_in_float64(signal: wd.ChannelFrame) -> None:
    """The kept values (stage_data) are float64 whatever the Frame's dtype: a signal's channel mean, a spectrogram's
    power-averaged plane, a cepstrogram's and a roughness plane alike."""
    for frame in (signal, signal.stft(n_fft=512, hop_length=256)):
        data = stage_data(frame, dict(stage_view(frame)))
        assert data is not None and data.values.dtype == np.float64, type(frame).__name__
