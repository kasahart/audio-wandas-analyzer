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
from stage_combine import read_points, stage_data
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


def test_an_images_cells_are_its_own_around_the_place_read() -> None:
    xs, ys = np.arange(50) * 0.01, np.array([100.0, 200.0, 300.0, 400.0, 500.0, 600.0])
    matrix = np.random.default_rng(3).normal(-50, 10, (ys.size, xs.size))
    points = read_cells(xs, ys, lambda rows, columns: matrix[rows, columns], {"x": [0.2], "y": [310.0], "beyond": 2})
    assert points["xs"] == pytest.approx(xs[18:23].tolist())
    assert points["ys"] == pytest.approx(ys[0:5].tolist())
    assert np.asarray(points["matrix"]) == pytest.approx(matrix[0:5, 18:23])
    assert first_violation(DEFINITIONS["StagePoints"], points) is None


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
    assert points["values"] == pytest.approx(data.values[at - 4 : at + 5].tolist())


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
        audio, start_norm=0.0, end_norm=1.0, point_count=1, read={"x": [at / (count - 1)], "beyond": 2}
    )
    points = ranged["points"]
    assert points["xs"] == pytest.approx([(at + offset) / (count - 1) for offset in range(-2, 3)])
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
