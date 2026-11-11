"""A plot's readout reads the data before it was thinned to be drawn (docs/display-rules.md R7)."""

from __future__ import annotations

import math
import wave
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from full_read import READ_POINT_LIMIT, read_cells, read_line, sorted_axis, uniform_axis
from protocol_schema import DEFINITIONS, first_violation
from stage_combine import StageData, read_points, stage_data
from stage_view import stage_view

RATE = 16000


def _values(count: int) -> np.ndarray:
    index = np.arange(count)
    return 0.8 * np.sin(index * 1.37) * np.cos(index * 0.013)


def test_a_window_with_few_points_is_read_whole_with_points_past_each_end() -> None:
    values = _values(1000)
    points = read_line(uniform_axis(1000, 0.0, 0.5), lambda a, b: values[a:b], {"x": [100.0, 110.0], "beyond": 3})
    assert points["complete"] is True
    assert points["xs"] == pytest.approx([0.5 * index for index in range(197, 224)])
    assert points["values"] == pytest.approx(values[197:224].tolist())
    assert points["start"] == pytest.approx(98.5) and points["end"] == pytest.approx(111.5)
    assert first_violation(DEFINITIONS["StagePoints"], points) is None


def test_a_read_at_the_datas_ends_says_so() -> None:
    values = _values(10)
    points = read_line(sorted_axis(np.arange(10.0)), lambda a, b: values[a:b], {"x": [0.0], "beyond": 256})
    assert points["start"] is None and points["end"] is None
    assert points["values"] == pytest.approx(values.tolist())


def test_a_dense_window_gives_each_pixel_columns_real_extremes_and_the_point_nearest_the_pointer() -> None:
    count = 200_000
    values = _values(count)
    read = {"x": [1000.0, 101_000.0], "beyond": 1, "near": 0.123, "columns": 17}
    points = read_line(uniform_axis(count, 0.0, 1.0), lambda a, b: values[a:b], read)
    assert points["complete"] is False
    xs = np.asarray(points["xs"], dtype=int)
    # Every point sent is a real sample, at its own place.
    assert points["values"] == pytest.approx(values[xs].tolist())
    assert len(xs) <= 3 * 17 + 2 < READ_POINT_LIMIT
    edges = np.linspace(1000, 101_000, 18)
    for low, high in zip(edges[:-1], edges[1:], strict=True):
        block = np.arange(int(np.ceil(low)), int(np.ceil(high)))
        inside = set(xs[(xs >= block[0]) & (xs <= block[-1])].tolist())
        assert int(block[np.argmax(values[block])]) in inside
        assert int(block[np.argmin(values[block])]) in inside
        assert int(block[np.argmin(np.abs(values[block] - 0.123))]) in inside


@pytest.mark.parametrize("log", [False, True])
def test_a_dense_window_sends_the_point_nearest_the_pointer_on_screen_as_brute_force_finds_it(log: bool) -> None:
    # A noisy line far denser than the screen: per pixel column its extremes and its point nearest the pointer's
    # level, and the one point nearest the pointer by its true distance on screen, wherever that is.
    rng = np.random.default_rng(11)
    count = 300_000
    values = rng.normal(0.0, 1.0, count)
    values[rng.integers(0, count, 500)] = -300.0
    xs_all = np.arange(count, dtype=np.float64) + 1.0
    axis = sorted_axis(xs_all)
    for trial in range(40):
        x0, x1 = (2000.0, 250_000.0) if not log else (20.0, 280_000.0)
        at = float(rng.uniform(x0, x1)) if not log else float(np.exp(rng.uniform(np.log(x0), np.log(x1))))
        near = float(rng.normal(0.0, 1.5))
        pixels = (
            [float(rng.uniform(1e-4, 3e-3)), float(rng.uniform(5.0, 60.0))]
            if not log
            else [float(rng.uniform(20.0, 80.0)), float(rng.uniform(5.0, 60.0))]
        )
        read = {
            "x": [x0, x1],
            "beyond": 1,
            "near": near,
            "columns": 41,
            "at": at,
            "pixels": pixels,
            **({"log": True} if log else {}),
        }
        assert first_violation(DEFINITIONS["StageRead"], read) is None
        points = read_line(axis, lambda a, b: values[a:b], read)
        inside = (xs_all >= x0) & (xs_all <= x1) & (values > -250.0)
        along = (np.log(xs_all) - np.log(at)) * pixels[0] if log else (xs_all - at) * pixels[0]
        away = np.hypot(along, (values - near) * pixels[1])
        best = int(np.argmin(np.where(inside, away, np.inf)))
        sent = np.asarray(points["xs"], dtype=np.float64)
        sent_values = np.asarray(points["values"], dtype=np.float64)
        sent_along = (np.log(sent) - np.log(at)) * pixels[0] if log else (sent - at) * pixels[0]
        sent_away = np.hypot(sent_along, (sent_values - near) * pixels[1])
        readable = (sent >= x0) & (sent <= x1) & (sent_values > -250.0)
        # The nearest of the points sent is brute force's nearest of every point: at its own place, its own value.
        nearest = int(np.argmin(np.where(readable, sent_away, np.inf)))
        assert sent[nearest] == pytest.approx(xs_all[best]), f"trial {trial}"
        assert sent_values[nearest] == pytest.approx(values[best])
        assert len(sent) <= 3 * 41 + 3 < READ_POINT_LIMIT


def test_an_arrow_keys_seek_crosses_a_silence_of_any_length_to_the_next_value_as_brute_force_finds_it() -> None:
    # Three million samples, silent (−300 dB or NaN) but for a few values far apart: each seek is one read.
    count = 3_000_000
    values = np.full(count, -300.0)
    values[1_000_000:1_000_005] = np.nan
    readable = [7, 5, 1_500_000, 2_999_998]
    values[readable] = [-20.0, -21.0, -22.0, -23.0]
    calls: list[tuple[int, int]] = []

    def values_in(a: int, b: int) -> np.ndarray:
        calls.append((a, b))
        return values[a:b]

    axis = uniform_axis(count, 0.0, 0.5)
    rng = np.random.default_rng(5)
    good = np.sort(np.asarray(readable))
    for x in [*rng.uniform(0.0, count * 0.5, 30).tolist(), 2.5, 3.5, 750_000.0, 1_499_999.0]:
        for direction in (1, -1):
            read = {"x": [x], "beyond": 4, "seek": direction}
            assert first_violation(DEFINITIONS["StageRead"], read) is None
            points = read_line(axis, values_in, read)
            places = good * 0.5
            ahead = places[places > x] if direction > 0 else places[places < x]
            expected = (ahead.min() if direction > 0 else ahead.max()) if ahead.size else None
            sent = np.asarray(points["xs"], dtype=np.float64)
            sent_values = np.asarray(
                [np.nan if value is None else value for value in points.get("values", [])], dtype=np.float64
            )
            past = (sent > x) if direction > 0 else (sent < x)
            hits = sent[past & np.isfinite(sent_values) & (sent_values > -250.0)]
            found = (hits.min() if direction > 0 else hits.max()) if hits.size else None
            assert found == expected, (x, direction)
            assert points["complete"] is True
            if expected is not None:
                # The point found at its own place and value, with ``beyond`` past it: the next keys need no read.
                at = int(round(expected / 0.5))
                assert sent_values[np.flatnonzero(sent == expected)[0]] == pytest.approx(values[at])
                assert len(sent) <= 4 + 2
    # Read a chunk at a time, never the whole recording at once.
    assert max(b - a for a, b in calls) <= 1 << 16


def test_an_images_cells_are_its_own_around_the_place_read() -> None:
    xs, ys = np.arange(50) * 0.01, np.array([100.0, 200.0, 300.0, 400.0, 500.0, 600.0])
    matrix = np.random.default_rng(3).normal(-50, 10, (ys.size, xs.size))
    points = read_cells(xs, ys, lambda rows, columns: matrix[rows, columns], {"x": [0.2], "y": [310.0], "beyond": 2})
    assert points["xs"] == pytest.approx(xs[18:23].tolist())
    assert points["ys"] == pytest.approx(ys[0:5].tolist())
    assert np.asarray(points["matrix"]) == pytest.approx(matrix[0:5, 18:23])
    assert first_violation(DEFINITIONS["StagePoints"], points) is None
    # A hover asks for more rows either side, so a pointer moving across bins reads what came.
    wider = read_cells(xs, ys, lambda rows, columns: matrix[rows, columns], {"x": [0.2], "y": [310.0], "rows": 4})
    assert wider["ys"] == pytest.approx(ys.tolist())
    assert first_violation(DEFINITIONS["StageRead"], {"x": [0.2], "y": [310.0], "rows": 4}) is None


@pytest.fixture(scope="module")
def signal() -> wd.ChannelFrame:
    rng = np.random.default_rng(7)
    tone = 0.5 * np.sin(2 * np.pi * 1000 * np.arange(RATE * 2) / RATE) + 0.01 * rng.standard_normal(RATE * 2)
    return wd.from_numpy(tone[np.newaxis], sampling_rate=RATE)


def test_a_recordings_spectrum_is_read_at_its_own_bins_not_its_picture(signal: wd.ChannelFrame) -> None:
    frame = signal.fft()
    data = stage_data(frame, dict(stage_view(frame)))
    assert data is not None
    at = int(np.argmin(np.abs(data.xs - 3000)))
    points = read_points([data], None, {"x": [float(data.xs[at])], "beyond": 4})
    assert points is not None and points["complete"]
    assert points["xs"] == pytest.approx(data.xs[at - 4 : at + 5].tolist())
    assert points["values"] == pytest.approx(data.values[at - 4 : at + 5].tolist(), abs=1e-12)


def test_a_difference_is_read_bin_by_bin(signal: wd.ChannelFrame) -> None:
    frame = signal.fft()
    base = stage_data(frame, dict(stage_view(frame)))
    assert base is not None
    raised = base.values.copy()
    at = int(np.argmin(np.abs(base.xs - 3000)))
    raised[at] += 30
    points = read_points([base], replace(base, values=raised), {"x": [float(base.xs[at])], "beyond": 1, "of": "diff"})
    assert points is not None
    assert points["values"] == pytest.approx([0.0, 30.0, 0.0], abs=1e-6)


def test_a_signals_samples_are_read_one_by_one(signal: wd.ChannelFrame) -> None:
    data = stage_data(signal, dict(stage_view(signal)))
    assert data is not None
    points = read_points([data], None, {"x": [0.5], "beyond": 2})
    assert points is not None
    assert points["xs"] == pytest.approx([(8000 + offset) / RATE for offset in range(-2, 3)])
    assert points["values"] == pytest.approx(np.asarray(signal.data)[7998:8003].tolist(), abs=1e-6)


def test_a_level_read_takes_every_value_inside_its_window_and_none_outside(signal: wd.ChannelFrame) -> None:
    # The order of overlaid lines (R6) over a zoom: a loud bin just past the window's end is not counted, however
    # near; every bin inside is, none thinned. Worked out here from the bins themselves.
    frame = signal.fft()
    data = stage_data(frame, dict(stage_view(frame)))
    assert data is not None
    low, high = int(np.argmin(np.abs(data.xs - 2000))), int(np.argmin(np.abs(data.xs - 4000)))
    peaked = data.values.copy()
    peaked[high + 1] = 40.0
    x = [float(data.xs[low]), float(data.xs[high])]
    points = read_points([replace(data, values=peaked)], None, {"x": x, "level": "db"})
    assert points is not None and first_violation(DEFINITIONS["StagePoints"], points) is None
    inside = np.asarray(data.values[low : high + 1], dtype=np.float64)
    assert points["level"]["count"] == inside.size
    assert points["level"]["power"] == pytest.approx(float(np.mean(10.0 ** (inside / 10.0))), rel=1e-9)
    # A signal's level is its samples' mean square, over every sample of the window.
    sampled = stage_data(signal, dict(stage_view(signal)))
    assert sampled is not None
    points = read_points([sampled], None, {"x": [0.25, 0.75], "level": "square"})
    assert points is not None
    samples = np.asarray(signal.data, dtype=np.float64)[4000:12001]
    assert points["level"]["count"] == samples.size
    assert points["level"]["power"] == pytest.approx(float(np.mean(samples**2)), rel=1e-5)


def _write_sine_wav(path: Path, seconds: float = 0.5) -> np.ndarray:
    time_axis = np.linspace(0, seconds, int(seconds * RATE), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * 440 * time_axis) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(samples.tobytes())
    return samples


def test_a_lane_reads_its_files_own_samples_and_stft_cells(tmp_path: Path) -> None:
    audio = tmp_path / "tone.wav"
    _write_sine_wav(audio)
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=10_000_000))
    options = {"nFft": 256, "overlapPercent": 50, "window": "hann"}
    service.analyze(audio, stft_options=options)
    samples, _ = sf.read(audio, dtype="float64")
    count = samples.size
    at = 1234
    ranged = service.waveform_range(
        audio, start_norm=0.0, end_norm=1.0, point_count=1, read={"x": [at / count], "beyond": 2}
    )
    points = ranged["points"]
    # Placed on the file's duration (the webview's 0..1 times n / fs), each sample is at wandas' own time for it.
    frame = wd.read_wav(str(audio))
    duration = frame.n_samples / frame.sampling_rate
    assert [x * duration for x in points["xs"]] == pytest.approx(frame.time[at - 2 : at + 3].tolist(), abs=1e-12)
    assert points["values"] == pytest.approx(samples[at - 2 : at + 3].tolist(), abs=1e-6)
    detail = service.track_detail(
        audio,
        track_index=0,
        analysis_id="a",
        settings_signature="s",
        stft_options=options,
        read={"x": [0.25], "y": [440.0], "beyond": 1},
    )
    cells = detail["points"]
    stft = wd.read_wav(str(audio)).stft(n_fft=256, hop_length=128, window="hann")
    db = np.asarray(stft.dB, dtype=float)
    db = db[0] if db.ndim == 3 else db
    freqs = np.asarray(stft.freqs, dtype=float)
    rows = [int(np.argmin(np.abs(freqs - y))) for y in cells["ys"]]
    assert cells["ys"] == pytest.approx(freqs[rows].tolist())
    matrix = np.asarray(cells["matrix"], dtype=float)
    assert matrix.shape == (len(cells["ys"]), len(cells["xs"]))
    # Each cell is one frame and one bin of the STFT the lane is drawn from: a column of the full dB.
    for column in range(matrix.shape[1]):
        assert any(np.allclose(matrix[:, column], db[rows, frame], atol=1e-6) for frame in range(db.shape[1]))


def test_a_medians_read_stops_where_its_picture_was_aligned_with_the_compared_one(signal: wd.ChannelFrame) -> None:
    data = stage_data(signal, dict(stage_view(signal)))
    assert data is not None
    half = data.values.size // 2
    shorter = replace(data, values=data.values[:half])
    points = read_points([data, data], shorter, {"x": [0.75 * data.values.size / RATE], "beyond": 2, "of": "base"})
    assert points is not None
    assert max(points["xs"]) < half / RATE


def test_a_seek_on_plain_values_reads_every_value_below_minus_250_and_left_and_right_agree() -> None:
    # A signal in raw counts: −300 for four samples is a value, not the silent floor of a level (StageRead ``plain``).
    values = np.array([1.0, 2.0, -300.0, -300.0, -300.0, -300.0, 10.0, 11.0])
    axis = uniform_axis(values.size, 0.0, 1.0)

    def values_in(a: int, b: int) -> np.ndarray:
        return values[a:b]

    def seek(x: float, direction: int, plain: bool) -> float:
        read = {"x": [x], "beyond": 0, "seek": direction, **({"plain": True} if plain else {})}
        assert first_violation(DEFINITIONS["StageRead"], read) is None
        points = read_line(axis, values_in, read)
        sent = [(at, value) for at, value in zip(points["xs"], points["values"], strict=True) if value is not None]
        ahead = [at for at, value in sent if (at > x if direction > 0 else at < x) and (plain or value > -250.0)]
        return min(ahead) if direction > 0 else max(ahead)

    # Plain: one sample at a time, either way.
    assert [seek(x, 1, True) for x in range(1, 6)] == [2.0, 3.0, 4.0, 5.0, 6.0]
    assert [seek(x, -1, True) for x in range(6, 1, -1)] == [5.0, 4.0, 3.0, 2.0, 1.0]
    # A level's floor is crossed in one seek, either way.
    assert seek(1, 1, False) == 6.0
    assert seek(6, -1, False) == 1.0


def test_the_point_nearest_the_pointer_on_screen_is_a_value_below_minus_250_on_plain_values_only() -> None:
    from full_read import _nearest_on_screen

    window = np.array([0.0, -400.0, 0.0])
    axis = uniform_axis(3, 0.0, 1.0)
    read = {"x": [0.0, 2.0], "at": 1.0, "pixels": [1.0, 1.0]}
    assert _nearest_on_screen(read, window, axis[1], 0, 3, -400.0, False, True) == 1
    assert _nearest_on_screen(read, window, axis[1], 0, 3, -400.0, False, False) != 1


def test_a_read_sends_the_values_unrounded_so_the_webview_picks_tells_silence_and_steps_on_them() -> None:
    """A read carries the values themselves, never rounded to what is written (R1, R7): −10.004 and −9.996 dB, which
    both write −10.0, arrive apart, so the pointer picks the one it is nearest; −249.999 dB, above the silent floor,
    arrives as −249.999 (rounded to −250.00 it would be silence), so an arrow key's seek stops on it and the webview
    reads it. Through the stage read the comparison serves (read_points) as through read_line itself."""
    xs = np.arange(1.0, 9.0) * 100.0
    levels = np.array([-300.0, -10.004, -9.996, -300.0, -249.999, -300.0, -300.0, -20.0])
    whole = read_line(sorted_axis(xs), lambda a, b: levels[a:b], {"x": [150.0, 350.0], "beyond": 1})
    assert whole["xs"] == [100.0, 200.0, 300.0, 400.0] and whole["values"] == [-300.0, -10.004, -9.996, -300.0]
    view = {"frame": "SpectralFrame", "kind": "line", "x": "frequency", "xScale": "log", "quantity": "level"}
    data = stage_data_of(xs, levels, view)
    sent = read_points([data], None, {"x": [200.0, 300.0], "beyond": 0})
    assert sent is not None and sent["values"] == [-10.004, -9.996]
    # The seek from the silence after −9.996 dB: the first readable point is −249.999 dB, sent as it is.
    seek = read_points([data], None, {"x": [400.0], "seek": 1, "beyond": 2})
    assert seek is not None and seek["complete"]
    found = seek["xs"].index(500.0)
    assert seek["values"][found] == -249.999


def stage_data_of(xs: np.ndarray, values: np.ndarray, view: dict) -> StageData:
    return StageData(mode="spectrum", view=view, xs=xs, values=values, nyquist=float(xs[-1]))  # type: ignore[arg-type]
