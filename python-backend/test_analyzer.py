from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from analyzer import _build_spectrogram, analyze_audio, analyze_from_frame, analyze_range


def _mean_power_db(values_db: list[float]) -> float:
    return float(10.0 * np.log10(np.mean(np.power(10.0, np.asarray(values_db) / 10.0))))


def _write_sine_wav(path: Path, freq_hz: float = 440.0, seconds: float = 1.0, sr: int = 16000) -> None:
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * freq_hz * t) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())


def test_analyze_audio_defaults(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    result = analyze_audio(wav)
    ch = result["channels"][0]
    spec = ch["spectrogram"]
    assert spec["windowSize"] > 0
    assert spec["hopSize"] > 0
    assert ch["unit"] == "FS"
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


def test_analyze_from_frame_includes_channel_unit(tmp_path: Path) -> None:
    frame = wd.ChannelFrame.from_numpy(
        np.array([[0.1, -0.5, 0.25]], dtype=np.float64),
        sampling_rate=1000,
        ch_units=["Pa"],
    )

    result = analyze_from_frame(frame, tmp_path / "pressure.wav", include_spectrogram=False)

    assert result["channels"][0]["unit"] == "Pa"
    assert result["channels"][0]["waveform"]["absolutePeak"] == pytest.approx(0.5)


def test_analyze_from_frame_defaults_to_summary_without_spectrogram(tmp_path: Path) -> None:
    frame = wd.from_numpy(np.array([0.0, 0.5, -0.5]), sampling_rate=1000)
    result = analyze_from_frame(frame, tmp_path / "summary.wav")
    assert result["channels"][0]["spectrogram"] is None


def test_analyze_from_frame_summary_skips_rms_and_full_file_fft(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    frame = wd.from_numpy(np.array([0.0, 0.5, -0.5]), sampling_rate=1000)

    def fail(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("summary analysis must not compute RMS or a full-file FFT")

    monkeypatch.setattr(type(frame), "rms", property(fail))
    monkeypatch.setattr(type(frame), "fft", fail)

    result = analyze_from_frame(frame, tmp_path / "summary.wav")

    assert result["channels"][0]["peakAbsolute"] == pytest.approx(0.5)


def test_analyze_from_frame_reports_wandas_db_for_representative_sine(tmp_path: Path) -> None:
    sample_rate = 1024
    sample_count = 1024
    amplitude = 0.5
    frequency_hz = 128.0
    time = np.arange(sample_count, dtype=np.float64) / sample_rate
    samples = amplitude * np.sin(2 * math.pi * frequency_hz * time)
    frame = wd.ChannelFrame.from_numpy(samples, sampling_rate=sample_rate)
    spectrogram = frame.stft(n_fft=256, hop_length=128, window="boxcar")

    result = analyze_from_frame(
        frame,
        tmp_path / "sine.wav",
        stft_options={"n_fft": 256, "hop_size": 128, "window": "boxcar"},
        spectrogram_frame=spectrogram,
        include_spectrogram=True,
    )

    expected_db = 20 * math.log10(amplitude)
    channel = result["channels"][0]
    assert channel["spectrogram"]["maxDb"] == pytest.approx(expected_db, abs=0.01)
    assert channel["spectrogram"]["axisLabel"] == "STFT amplitude level [dB re 1 input unit]"


def test_analyze_range_uses_same_pcm_scale_as_overview(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav, seconds=1.0)

    overview = analyze_audio(wav)["channels"][0]["waveform"]
    range_result = analyze_range(wav, 0.25, 0.75, point_count=128)
    range_waveform = range_result["channels"][0]

    assert overview["absolutePeak"] == pytest.approx(0.5, abs=0.01)
    assert range_waveform["absolutePeak"] == pytest.approx(0.5, abs=0.01)
    assert range_waveform["absolutePeak"] == pytest.approx(overview["absolutePeak"], rel=0.05)
    assert min(range_waveform["minT"]) >= 0.24
    assert max(range_waveform["maxT"]) >= 0.74
    assert max(range_waveform["maxT"]) <= 0.76


def test_analyze_audio_accepts_flac_from_supported_ui_formats(tmp_path: Path) -> None:
    flac = tmp_path / "tone.flac"
    sr = 16000
    seconds = 0.5
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * 440.0 * t)).astype(np.float32)
    sf.write(flac, samples, sr, format="FLAC")

    result = analyze_audio(flac)

    assert result["fileName"] == "tone.flac"
    assert result["sampleRateHz"] == sr
    assert result["channelCount"] == 1
    assert result["channels"][0]["waveform"]["absolutePeak"] == pytest.approx(0.5, abs=0.01)


def test_analyze_audio_with_stft_options(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    result = analyze_audio(
        wav,
        stft_options={"n_fft": 512, "hop_size": 128, "window": "hamming"},
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


def test_spectrogram_reduction_clamps_silent_power_to_finite_db() -> None:
    spec = _build_spectrogram(
        np.full((2, 2), -np.inf, dtype=np.float64),
        sample_rate_hz=48_000,
        window_size=512,
        hop_size=128,
        time_bin_limit=1,
        frequency_bin_limit=1,
    )

    value = spec["values"][0][0]
    assert np.isfinite(value)
    assert value == pytest.approx(-120.0)
    assert spec["minDb"] == pytest.approx(-120.0)
    assert spec["maxDb"] == pytest.approx(-120.0)
    assert spec["unit"] == "dB"
    assert spec["axisLabel"] == "Spectrum amplitude level [dB]"


def test_analyze_audio_rejects_bad_options(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    with pytest.raises(ValueError):
        analyze_audio(wav, stft_options={"n_fft": 0, "hop_size": 1, "window": "hann"})
    with pytest.raises(ValueError):
        analyze_audio(wav, stft_options={"n_fft": 256, "hop_size": 512, "window": "hann"})


def test_analyze_audio_summary_omits_rms_and_full_file_spectrum(tmp_path: Path) -> None:
    wav = tmp_path / "tone440.wav"
    _write_sine_wav(wav, freq_hz=440.0, seconds=2.0, sr=44100)
    result = analyze_audio(wav)
    ch = result["channels"][0]
    assert "rms" not in ch
    assert "rmsLevelDb" not in ch
    assert "dominantFrequencies" not in ch
    assert "peaks" not in ch


def test_analyze_audio_keeps_multichannel_peak_amplitudes_separate(tmp_path: Path) -> None:
    wav = tmp_path / "stereo.wav"
    sr = 16000
    seconds = 1.0
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    left = 0.2 * np.sin(2 * math.pi * 440.0 * t)
    right = 0.8 * np.sin(2 * math.pi * 880.0 * t)
    sf.write(wav, np.column_stack([left, right]).astype(np.float32), sr)

    result = analyze_audio(wav)

    assert result["channelCount"] == 2
    assert len(result["channels"]) == 2
    left_ch, right_ch = result["channels"]
    assert left_ch["label"] in {"Channel 1", "Left", "L", "ch0"}
    assert right_ch["label"] in {"Channel 2", "Right", "R", "ch1"}
    assert left_ch["peakAbsolute"] < right_ch["peakAbsolute"]
