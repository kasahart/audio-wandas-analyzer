from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from analysis_engine import AnalysisEngine, compute_spectrogram
from analysis_service import AnalysisService
from analyzer import (
    SPECTRUM_DISPLAY_POINT_LIMIT,
    AnalysisResult,
    ChannelSummary,
    MeasurementMetadata,
    SpectrogramPayload,
    _build_spectrogram,
    level_scale_metadata,
    min_max_spectrum,
    resample_frequency_bins,
    spectrogram_frame_centers,
    spectrogram_window_frames,
)
from stage_view import log_buckets, min_max_indices, rows_bucket_count

_SCALE = level_scale_metadata(wd.from_numpy(np.zeros((1, 8)), sampling_rate=8).channels[0].level_reference, "STFT")


@pytest.fixture
def service() -> AnalysisService:
    return AnalysisService(AnalysisEngine(cache_limit_bytes=64 * 1024 * 1024))


def _mean_power_db(values_db: list[float]) -> float:
    return float(10.0 * np.log10(np.mean(np.power(10.0, np.asarray(values_db) / 10.0))))


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
    spec = service.track_detail(wav)["channels"][0]["spectrogram"]
    assert spec["windowSize"] > 0
    assert spec["hopSize"] > 0
    assert ch["unit"] == "FS"
    assert set(result) == _typed_dict_keys(AnalysisResult)
    assert set(ch) == _typed_dict_keys(ChannelSummary)
    assert set(ch["measurement"]) == _typed_dict_keys(MeasurementMetadata)
    assert set(spec) == _typed_dict_keys(SpectrogramPayload)
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
    assert result["channels"][0]["waveform"]["absolutePeak"] == pytest.approx(0.5)


def test_service_defaults_to_summary_without_spectrogram(
    tmp_path: Path, service: AnalysisService, monkeypatch: pytest.MonkeyPatch
) -> None:
    frame = wd.from_numpy(np.array([0.0, 0.5, -0.5]), sampling_rate=1000)
    path = tmp_path / "summary.wav"
    path.touch()
    monkeypatch.setattr(wd, "read", _read_as(frame))
    result = service.analyze(path)
    assert result["channels"][0]["spectrogram"] is None


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


def test_service_reports_wandas_db_for_representative_sine(
    tmp_path: Path, service: AnalysisService, monkeypatch: pytest.MonkeyPatch
) -> None:
    sample_rate = 1024
    sample_count = 1024
    amplitude = 0.5
    frequency_hz = 128.0
    time = np.arange(sample_count, dtype=np.float64) / sample_rate
    samples = amplitude * np.sin(2 * math.pi * frequency_hz * time)
    frame = wd.ChannelFrame.from_numpy(samples, sampling_rate=sample_rate)
    path = tmp_path / "sine.wav"
    path.touch()
    monkeypatch.setattr(wd, "read", _read_as(frame))

    result = service.track_detail(
        path,
        stft_options={"n_fft": 256, "overlap_percent": 50, "window": "boxcar"},
    )

    expected_db = 20 * math.log10(amplitude)
    channel = result["channels"][0]
    assert channel["spectrogram"]["maxDb"] == pytest.approx(expected_db, abs=0.01)
    assert channel["spectrogram"]["axisLabel"] == "STFT amplitude level [dB re 1 input unit]"


def test_service_waveform_range_uses_same_pcm_scale_as_overview(tmp_path: Path, service: AnalysisService) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav, seconds=1.0)

    overview = service.analyze(wav)["channels"][0]["waveform"]
    range_result = service.waveform_range(wav, start_norm=0.25, end_norm=0.75, point_count=128)
    range_waveform = range_result["channels"][0]

    assert overview["absolutePeak"] == pytest.approx(0.5, abs=0.01)
    assert range_waveform["absolutePeak"] == pytest.approx(0.5, abs=0.01)
    assert range_waveform["absolutePeak"] == pytest.approx(overview["absolutePeak"], rel=0.05)
    assert min(range_waveform["minT"]) >= 0.24
    assert max(range_waveform["maxT"]) >= 0.74
    assert max(range_waveform["maxT"]) <= 0.76


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
    assert result["channels"][0]["waveform"]["absolutePeak"] == pytest.approx(0.5, abs=0.01)


def test_service_analyze_with_stft_options(tmp_path: Path, service: AnalysisService) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    result = service.track_detail(
        wav,
        stft_options={"n_fft": 512, "overlap_percent": 75, "window": "hamming"},
    )
    spec = result["channels"][0]["spectrogram"]
    assert spec["windowSize"] == 512
    assert spec["hopSize"] == 128


def test_spectrogram_time_reduction_averages_linear_power() -> None:
    spec = _build_spectrogram(
        np.array([[-60.0, -20.0], [0.0, -40.0]], dtype=np.float64),
        sample_rate_hz=48_000,
        window_size=512,
        hop_size=128,
        scale=_SCALE,
        time_bin_limit=1,
        frequency_bin_limit=2,
    )

    assert spec["timeBins"] == 1
    assert spec["frequencyBins"] == 2
    assert spec["values"][0] == pytest.approx(
        [
            _mean_power_db([-60.0, 0.0]),
            _mean_power_db([-20.0, -40.0]),
        ]
    )


def test_spectrogram_frequency_reduction_averages_linear_power() -> None:
    spec = _build_spectrogram(
        np.array([[-60.0, 0.0], [-20.0, -40.0]], dtype=np.float64),
        sample_rate_hz=48_000,
        window_size=512,
        hop_size=128,
        scale=_SCALE,
        time_bin_limit=2,
        frequency_bin_limit=1,
    )

    assert spec["timeBins"] == 2
    assert spec["frequencyBins"] == 1
    assert [row[0] for row in spec["values"]] == pytest.approx(
        [
            _mean_power_db([-60.0, 0.0]),
            _mean_power_db([-20.0, -40.0]),
        ]
    )


def test_frequency_reduction_uses_bands_centered_on_display_coordinates() -> None:
    values = np.array([[-60.0, 0.0, -20.0, -40.0, -30.0, -10.0, -50.0]])
    reduced = resample_frequency_bins(values, 3)
    np.testing.assert_allclose(
        reduced[0],
        [_mean_power_db(values[0, :2]), _mean_power_db(values[0, 2:5]), _mean_power_db(values[0, 5:])],
    )


@pytest.mark.parametrize("source_bins", [257, 513, 1025, 2049])
def test_every_reduced_peak_stays_within_half_a_display_bin(source_bins: int) -> None:
    values = np.full((source_bins, source_bins), -120.0)
    np.fill_diagonal(values, 0.0)
    reduced = resample_frequency_bins(values, 192)
    peak_positions = np.argmax(reduced, axis=1) / 191
    source_positions = np.arange(source_bins) / (source_bins - 1)
    assert np.max(np.abs(peak_positions - source_positions)) <= 0.5 / 191 + 1e-12
    assert peak_positions[0] == 0.0
    assert peak_positions[-1] == 1.0


@pytest.mark.parametrize("bin_count", [2049, 4097, 8193, 32769])
@pytest.mark.parametrize("channels", [1, 2, 8])
def test_a_cut_spectrum_fits_the_budget_with_whole_low_bins(bin_count: int, channels: int) -> None:
    rows = np.random.default_rng(bin_count + channels).normal(-60.0, 10.0, size=(channels, bin_count))
    shown, frequencies = min_max_spectrum(rows, 24000.0)
    assert frequencies is not None and shown.shape == (channels, frequencies.size)
    assert frequencies.size <= SPECTRUM_DISPLAY_POINT_LIMIT and np.all(np.diff(frequencies) > 0)
    bins = np.rint(frequencies * (bin_count - 1) / 24000.0).astype(int)
    # DC and the lowest bins are all drawn (their buckets are under a bin wide); the rest are thinned.
    assert np.array_equal(bins[:40], np.arange(40))


def test_rows_within_the_display_budget_are_sent_whole() -> None:
    rows = np.zeros((2, SPECTRUM_DISPLAY_POINT_LIMIT))
    shown, frequencies = min_max_spectrum(rows, 4000.0)
    assert shown is rows and frequencies is None


@pytest.mark.parametrize("bin_count", [2049, 8193])
def test_every_tone_keeps_its_level_and_bin_frequency_when_cut_for_display(bin_count: int) -> None:
    rows = np.full((1, bin_count), -120.0)
    tones = np.arange(3, bin_count, 97)
    rows[0, tones] = 0.0
    shown, frequencies = min_max_spectrum(rows, 6000.0)
    assert frequencies is not None and shown.shape == (1, frequencies.size)
    assert frequencies.size <= SPECTRUM_DISPLAY_POINT_LIMIT and np.all(np.diff(frequencies) > 0)
    bin_hz = 6000.0 / (bin_count - 1)
    # Each tone is drawn at its own bin's frequency with its own level.
    for tone in tones:
        index = int(np.argmin(np.abs(frequencies - tone * bin_hz)))
        assert frequencies[index] == pytest.approx(tone * bin_hz) and shown[0, index] == 0.0


def test_a_cut_row_keeps_each_buckets_lowest_and_highest_bin_as_compare_does() -> None:
    bin_count = 8193
    rng = np.random.default_rng(0)
    rows = rng.normal(-60.0, 10.0, size=(2, bin_count))
    shown, frequencies = min_max_spectrum(rows, 24000.0)
    assert frequencies is not None and shown.shape[1] == frequencies.size <= SPECTRUM_DISPLAY_POINT_LIMIT
    bins = np.rint(frequencies * (bin_count - 1) / 24000.0).astype(int)
    # Every value drawn is a real bin of that channel.
    np.testing.assert_array_equal(shown, rows[:, bins])
    # Each channel's line holds, per bucket, the bins Compare's decimation (stage_view.min_max_indices) picks.
    freqs = np.arange(bin_count) * (24000.0 / (bin_count - 1))
    buckets = rows_bucket_count(
        np.arange(bin_count, dtype=np.float64), 2, SPECTRUM_DISPLAY_POINT_LIMIT - 1, (1.0, bin_count - 1.0)
    )
    for channel in range(2):
        picked = min_max_indices(freqs, rows[channel], buckets, True, (freqs[1], freqs[-1]))
        assert np.isin(picked, bins).all()
        bucket = log_buckets(freqs[1:], buckets, (freqs[1], freqs[-1]))
        for index in np.unique(bucket)[::37]:
            inside = np.flatnonzero(bucket == index) + 1
            drawn = np.isin(bins, inside)
            assert shown[channel, drawn].min() == rows[channel, inside].min()
            assert shown[channel, drawn].max() == rows[channel, inside].max()


def test_spectrogram_reduction_clamps_silent_power_to_finite_db() -> None:
    spec = _build_spectrogram(
        np.full((2, 2), -np.inf, dtype=np.float64),
        sample_rate_hz=48_000,
        window_size=512,
        hop_size=128,
        scale=_SCALE,
        time_bin_limit=1,
        frequency_bin_limit=1,
    )

    value = spec["values"][0][0]
    assert np.isfinite(value)
    assert value == pytest.approx(-120.0)
    assert spec["minDb"] == pytest.approx(-120.0)
    assert spec["maxDb"] == pytest.approx(-120.0)
    assert spec["unit"] == "dB"


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
    from analysis_engine import compute_spectrogram
    from analyzer import resolve_stft_params

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
    from analyzer import sample_range

    assert sample_range(start, end, 100) == expected


@pytest.mark.parametrize("sample_count", [65, 300, 301, 511, 512])
def test_auto_stft_window_is_even_for_short_files(sample_count: int) -> None:
    from analyzer import resolve_stft_params

    n_fft, _, _ = resolve_stft_params(sample_count, None)
    assert n_fft % 2 == 0


def test_spectrogram_time_centers_follow_stft_window_centers() -> None:
    frame = wd.from_numpy(np.zeros((1, 4800)), sampling_rate=48_000)
    spectrogram = frame.stft(n_fft=512, hop_length=128, window="hann")
    centers = spectrogram_frame_centers(spectrogram)
    assert centers is not None
    assert centers.shape == (spectrogram.n_frames,)
    # Each centre is where the window that produced that frame peaks, starting before the file start.
    assert centers[0] == pytest.approx(spectrogram.frame_time_origin)
    np.testing.assert_allclose(np.diff(centers), 128 / 48_000)

    spec = _build_spectrogram(
        np.zeros((spectrogram.n_frames, 4)),
        sample_rate_hz=48_000,
        window_size=512,
        hop_size=128,
        scale=_SCALE,
        time_bin_limit=8,
        frame_centers_sec=centers,
    )
    boundaries = (np.arange(1, 8) * spectrogram.n_frames) // 8
    expected = [float(np.mean(group)) for group in np.split(centers, boundaries)]
    assert spec["timeCentersSec"] == pytest.approx(expected)


def test_sparse_spectrogram_time_centers_use_the_display_hop() -> None:
    frame = wd.from_numpy(np.zeros((1, 48_000)), sampling_rate=48_000)
    sparse = compute_spectrogram(frame, 512, 2048, "hann")
    centers = spectrogram_frame_centers(sparse)
    assert centers is not None
    np.testing.assert_allclose(centers, sparse.frame_center_times[0])


@pytest.mark.parametrize("n_fft", [255, 256])
def test_sparse_stft_matches_dense_frames_for_odd_and_even_windows(n_fft: int) -> None:
    # The sparse frames are the dense STFT's every fourth frame: an odd window's last bin is not Nyquist
    # and keeps the one-sided doubling, and float32 audio stays single precision.
    samples = (0.2 * np.sin(2 * np.pi * 997 * np.arange(8000) / 8000)).astype(np.float32)
    frame = wd.from_numpy(samples, sampling_rate=8000)
    dense = frame.stft(n_fft=n_fft, hop_length=n_fft, window="hann")
    sparse = compute_spectrogram(frame, n_fft, 4 * n_fft, "hann")
    count = min(sparse.n_frames, (dense.n_frames + 3) // 4)
    values = np.asarray(sparse.data)
    assert values.dtype == np.complex64
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


def test_zoomed_track_detail_draws_the_window_from_every_frame_in_it(tmp_path: Path, service: AnalysisService) -> None:
    # R3: a zoomed lane asks for its window, and gets every STFT frame centred in it instead of the whole file's
    # 720 display columns stretched.
    wav = tmp_path / "long.wav"
    _write_sine_wav(wav, seconds=30.0)
    options = {"n_fft": 256, "overlap_percent": 75, "window": "hann"}
    whole = service.track_detail(wav, stft_options=options)["channels"][0]["spectrogram"]
    zoomed = service.track_detail(wav, stft_options=options, time_window=(0.4, 0.45))["channels"][0]["spectrogram"]
    hop_sec = 64 / 16000
    assert len(whole["timeCentersSec"]) == 720
    centers = np.asarray(zoomed["timeCentersSec"])
    assert centers[0] <= 12.0 <= centers[1] and centers[-2] <= 13.5 <= centers[-1]
    assert np.all(np.diff(centers) == pytest.approx(hop_sec))
    assert len(centers) == pytest.approx(1.5 / hop_sec, abs=3)


def test_a_zoom_window_costs_its_own_frames_and_samples_not_the_whole_files(
    tmp_path: Path, service: AnalysisService, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The STFT is cut before its dB conversion, and the envelope is built from the window's samples only.
    wav = tmp_path / "long.wav"
    _write_sine_wav(wav, seconds=30.0)
    options = {"n_fft": 256, "overlap_percent": 75, "window": "hann"}
    service.track_detail(wav, stft_options=options)
    converted: list[int] = []
    original = wd.SpectrogramFrame.dB.fget
    assert original is not None

    def recording_db(self: wd.SpectrogramFrame) -> np.ndarray:
        converted.append(int(self.n_frames))
        return original(self)

    monkeypatch.setattr(wd.SpectrogramFrame, "dB", property(recording_db))
    zoomed = service.track_detail(wav, stft_options=options, time_window=(0.4, 0.45))["channels"][0]
    assert converted and max(converted) < 400  # the window's ~377 frames, not the file's 7500
    waveform = zoomed["waveform"]
    assert min(waveform["minT"]) >= 0.4 - 1e-6 and max(waveform["maxT"]) <= 0.45 + 1e-6
