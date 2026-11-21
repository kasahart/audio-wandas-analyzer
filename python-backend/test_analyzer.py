from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from conftest import assert_not_drawn
from services.analysis_engine import AnalysisEngine, compute_spectrogram
from services.analysis_service import AnalysisService
from services.analyzer import (
    AnalysisResult,
    ChannelSummary,
    MeasurementMetadata,
    level_scale_metadata,
    spectrogram_frame_centers,
    spectrogram_window_frames,
)

_SCALE = level_scale_metadata(wd.from_numpy(np.zeros((1, 8)), sampling_rate=8).channels[0].level_reference, "STFT")


@pytest.fixture
def service() -> AnalysisService:
    return AnalysisService(AnalysisEngine(cache_limit_bytes=64 * 1024 * 1024))


def _typed_dict_keys(typed_dict: type) -> set[str]:
    return set(typed_dict.__required_keys__ | typed_dict.__optional_keys__)


def _write_sine_wav(path: Path, freq_hz: float = 440.0, seconds: float = 1.0, sr: int = 16000) -> None:
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * freq_hz * t) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())


def _read_as(frame: wd.ChannelFrame):
    """A ``wd.read`` stand-in that returns ``frame`` in the dtype it is asked for, as the reader does."""
    return lambda _path, dtype=None, **_kwargs: frame if dtype is None else frame.astype(dtype)


def test_service_analyze_defaults(tmp_path: Path, service: AnalysisService) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    result = service.analyze(wav)
    ch = result["channels"][0]
    assert ch["unit"] == "FS"
    assert set(result) == _typed_dict_keys(AnalysisResult)
    assert set(ch) == _typed_dict_keys(ChannelSummary)
    assert set(ch["measurement"]) == _typed_dict_keys(MeasurementMetadata)
    assert result["units"]["spectrumLevel"] == {
        "unit": "dBFS",
        "axisLabel": "Spectrum amplitude level [dBFS]",
        "referenceValue": 1.0,
        "referenceUnit": "FS",
        "levelReferenceLabel": "dBFS",
    }
    assert result["units"]["spectrogramLevel"] == {
        "unit": "dBFS",
        "axisLabel": "STFT amplitude level [dBFS]",
        "referenceValue": 1.0,
        "referenceUnit": "FS",
        "levelReferenceLabel": "dBFS",
    }
    assert result["units"]["amplitudeLevel"] == {
        "unit": "dBFS",
        "axisLabel": "Amplitude level [dBFS]",
        "referenceValue": 1.0,
        "referenceUnit": "FS",
        "levelReferenceLabel": "dBFS",
    }


def test_service_includes_channel_unit(
    tmp_path: Path, service: AnalysisService, monkeypatch: pytest.MonkeyPatch
) -> None:
    frame = wd.ChannelFrame.from_numpy(
        np.array([[0.1, -0.5, 0.25]], dtype=np.float64),
        sampling_rate=1000,
        ch_units=["Pa"],
    )

    path = tmp_path / "pressure.wav"
    path.touch()
    monkeypatch.setattr(wd, "read", _read_as(frame))
    result = service.analyze(path)

    assert result["channels"][0]["unit"] == "Pa"
    assert result["channels"][0]["peakAbsolute"] == pytest.approx(0.5)


def test_service_analyze_sends_no_picture(
    tmp_path: Path, service: AnalysisService, monkeypatch: pytest.MonkeyPatch
) -> None:
    frame = wd.from_numpy(np.array([0.0, 0.5, -0.5]), sampling_rate=1000)
    path = tmp_path / "summary.wav"
    path.touch()
    monkeypatch.setattr(wd, "read", _read_as(frame))
    result = service.analyze(path)
    # A row's waveform and spectrogram are figures (figures/service.py), never part of the analysis.
    assert "waveform" not in result["channels"][0] and "spectrogram" not in result["channels"][0]


def test_service_summary_skips_rms_and_full_file_fft(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    service: AnalysisService,
) -> None:
    frame = wd.from_numpy(np.array([0.0, 0.5, -0.5]), sampling_rate=1000)

    def fail(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("summary analysis must not compute RMS or a full-file FFT")

    monkeypatch.setattr(type(frame), "rms", property(fail))
    monkeypatch.setattr(type(frame), "fft", fail)

    path = tmp_path / "summary.wav"
    path.touch()
    monkeypatch.setattr(wd, "read", _read_as(frame))
    result = service.analyze(path)

    assert result["channels"][0]["peakAbsolute"] == pytest.approx(0.5)


def test_service_analyze_accepts_flac_from_supported_ui_formats(tmp_path: Path, service: AnalysisService) -> None:
    flac = tmp_path / "tone.flac"
    sr = 16000
    seconds = 0.5
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * 440.0 * t)).astype(np.float32)
    sf.write(flac, samples, sr, format="FLAC")

    result = service.analyze(flac)

    assert result["fileName"] == "tone.flac"
    assert result["sampleRateHz"] == sr
    assert result["channelCount"] == 1
    assert result["channels"][0]["peakAbsolute"] == pytest.approx(0.5, abs=0.01)


def test_service_analyze_rejects_bad_options(tmp_path: Path, service: AnalysisService) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    with pytest.raises(ValueError):
        service.analyze(wav, stft_options={"n_fft": 0, "overlap_percent": 50, "window": "hann"})
    with pytest.raises(ValueError):
        service.analyze(wav, stft_options={"n_fft": 256, "overlap_percent": 100, "window": "hann"})


def test_service_analyze_summary_omits_rms_and_full_file_spectrum(tmp_path: Path, service: AnalysisService) -> None:
    wav = tmp_path / "tone440.wav"
    _write_sine_wav(wav, freq_hz=440.0, seconds=2.0, sr=44100)
    result = service.analyze(wav)
    ch = result["channels"][0]
    assert "rms" not in ch
    assert "rmsLevelDb" not in ch
    assert "dominantFrequencies" not in ch
    assert "peaks" not in ch


def test_service_analyze_keeps_multichannel_peak_amplitudes_separate(tmp_path: Path, service: AnalysisService) -> None:
    wav = tmp_path / "stereo.wav"
    sr = 16000
    seconds = 1.0
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    left = 0.2 * np.sin(2 * math.pi * 440.0 * t)
    right = 0.8 * np.sin(2 * math.pi * 880.0 * t)
    sf.write(wav, np.column_stack([left, right]).astype(np.float32), sr)

    result = service.analyze(wav)

    assert result["channelCount"] == 2
    assert len(result["channels"]) == 2
    left_ch, right_ch = result["channels"]
    assert left_ch["label"] in {"Channel 1", "Left", "L", "ch0"}
    assert right_ch["label"] in {"Channel 2", "Right", "R", "ch1"}
    assert left_ch["peakAbsolute"] < right_ch["peakAbsolute"]


@pytest.mark.parametrize("factor", [1.0, 10.0])
def test_sparse_auto_stft_matches_wandas_and_bounds_long_file_frames(factor: float) -> None:
    from services.analysis_engine import compute_spectrogram
    from services.analyzer import resolve_stft_params

    sr = 48000
    samples = (0.25 * np.sin(2 * np.pi * 750 * np.arange(sr * 60) / sr)).astype(np.float32)
    frame = wd.from_numpy(samples, sampling_rate=sr).with_calibration(
        {0: wd.ChannelCalibration(factor=factor, unit="Pa", ref=2e-5)}
    )
    n_fft, hop, window = resolve_stft_params(frame.n_samples, None)
    assert hop > n_fft
    sparse = compute_spectrogram(frame, n_fft, hop, window)
    assert sparse.n_frames <= 722
    assert np.asarray(sparse.data).nbytes < 12 * 1024 * 1024
    assert sparse.frame_center_times[0][1] == pytest.approx(hop / sr)
    assert sparse.channels[0].level_reference == frame.channels[0].level_reference
    assert sparse.channels[0].calibration.factor == 1.0
    assert frame.channels[0].calibration.factor == factor
    cached = sparse.astype(np.complex64).cache()
    np.testing.assert_array_equal(cached.frame_center_times, sparse.frame_center_times)
    np.testing.assert_allclose(cached.get_frame_at(100).dB, sparse.get_frame_at(100).dB, atol=1e-4)
    # Compare against Wandas at exactly aligned centers, including boundary padding.
    short = frame[:, :sr]
    dense = short.stft(n_fft=2048, hop_length=2048, window="hann")
    spaced = compute_spectrogram(short, 2048, 8192, "hann")
    count = min(spaced.n_frames, (dense.n_frames + 3) // 4)
    np.testing.assert_allclose(
        np.asarray(spaced.data).reshape(1, 1025, -1)[:, :, :count],
        np.asarray(dense.data).reshape(1, 1025, -1)[:, :, ::4][:, :, :count],
        rtol=1e-6,
        atol=1e-8,
    )
    # One-hour planning remains bounded without allocating a one-hour test fixture.
    fft, hour_hop, _ = resolve_stft_params(sr * 3600, None)
    assert (sr * 3600) // hour_hop < 722
    assert fft == 2048


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [(0.0, 1.0, (0, 100)), (0.25, 0.505, (25, 50)), (-0.5, 1.5, (0, 100)), (0.9, 0.1, (90, 10))],
)
def test_sample_range_clamps_normalized_selection(start: float, end: float, expected: tuple[int, int]) -> None:
    from services.analyzer import sample_range

    assert sample_range(start, end, 100) == expected


@pytest.mark.parametrize("sample_count", [65, 300, 301, 511, 512])
def test_auto_stft_window_is_even_for_short_files(sample_count: int) -> None:
    from services.analyzer import resolve_stft_params

    n_fft, _, _ = resolve_stft_params(sample_count, None)
    assert n_fft % 2 == 0


def test_sparse_spectrogram_time_centers_use_the_display_hop() -> None:
    frame = wd.from_numpy(np.zeros((1, 48_000)), sampling_rate=48_000)
    sparse = compute_spectrogram(frame, 512, 2048, "hann")
    centers = spectrogram_frame_centers(sparse)
    assert centers is not None
    np.testing.assert_allclose(centers, sparse.frame_center_times[0])


@pytest.mark.parametrize("n_fft", [255, 256])
def test_sparse_stft_matches_dense_frames_for_odd_and_even_windows(n_fft: int) -> None:
    # The sparse frames are the dense STFT's every fourth frame: an odd window's last bin is not Nyquist
    # and keeps the one-sided doubling; float32 audio is transformed in double precision (its cells are read, R1).
    samples = (0.2 * np.sin(2 * np.pi * 997 * np.arange(8000) / 8000)).astype(np.float32)
    frame = wd.from_numpy(samples, sampling_rate=8000)
    dense = frame.stft(n_fft=n_fft, hop_length=n_fft, window="hann")
    sparse = compute_spectrogram(frame, n_fft, 4 * n_fft, "hann")
    count = min(sparse.n_frames, (dense.n_frames + 3) // 4)
    values = np.asarray(sparse.data)
    assert values.dtype == np.complex128
    np.testing.assert_allclose(values[..., :count], np.asarray(dense.data)[..., ::4][..., :count], rtol=1e-5, atol=1e-7)
    np.testing.assert_allclose(sparse.frame_center_times, dense.frame_center_times[:, ::4][:, :count])


def test_spectrogram_window_frames_keeps_the_frames_in_the_window_and_one_beside_each_end() -> None:
    centers = np.arange(100) * 0.01  # 0.00 .. 0.99 s in a 1 s file
    frames = spectrogram_window_frames(centers, 1.0, (0.25, 0.5))
    assert (frames.start, frames.stop) == (24, 52)
    # A window narrower than one hop still gets two frames, whose centres place the cells.
    narrow = spectrogram_window_frames(centers, 1.0, (0.995, 1.0))
    assert narrow.stop - narrow.start == 2 and narrow.stop == 100
    assert spectrogram_window_frames(centers, 1.0, (0.0, 0.001)) == slice(0, 2)


def test_channel_peak_is_every_samples_largest_magnitude(tmp_path: Path, service: AnalysisService) -> None:
    # Ten seconds of a quiet tone and one negative sample far below it: the header's peak and its level are every
    # sample's, never a thinned picture's.
    rate = 48_000
    times = np.arange(10 * rate) / rate
    samples = 0.25 * np.sin(2 * np.pi * 97 * times)
    samples[312_345] = -0.8125
    audio = tmp_path / "spike.wav"
    sf.write(audio, samples, rate, subtype="FLOAT")

    channel = service.analyze(audio)["channels"][0]

    read = sf.read(audio, dtype="float64")[0]
    assert channel["peakAbsolute"] == pytest.approx(float(np.max(np.abs(read))))
    assert channel["peakAbsolute"] == pytest.approx(0.8125)
    assert channel["peakLevelDb"] == pytest.approx(20 * math.log10(0.8125), abs=1e-6)
    # A waveform thinned by averaging to as many points as are drawn never holds the one sample.
    width = len(read) // 1200
    averaged = np.abs(read[: len(read) // width * width].reshape(-1, width).mean(axis=1))
    assert_not_drawn(channel["peakAbsolute"], float(averaged.max()))
