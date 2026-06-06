from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from analyzer import _build_spectrogram, analyze_audio, analyze_range


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
    spec = result["channels"][0]["spectrogram"]
    assert spec["windowSize"] > 0
    assert spec["hopSize"] > 0


def test_analyze_range_uses_same_pcm_scale_as_overview(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav, seconds=1.0)

    overview = analyze_audio(wav)["channels"][0]["waveform"]
    range_result = analyze_range(wav, 0.25, 0.75, point_count=128)
    range_waveform = range_result["channels"][0]

    assert overview["absolutePeak"] > 1000
    assert range_waveform["absolutePeak"] > 1000
    assert range_waveform["absolutePeak"] == pytest.approx(overview["absolutePeak"], rel=0.05)
    assert min(range_waveform["minT"]) >= 0.24
    assert max(range_waveform["maxT"]) <= 0.76


def test_analyze_audio_accepts_flac_from_supported_ui_formats(tmp_path: Path) -> None:
    flac = tmp_path / "tone.flac"
    sr = 16000
    seconds = 0.5
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * 440.0 * t)).astype(np.float32)
    sf.write(flac, samples, sr, format="FLAC")

    result = analyze_audio(flac, peak_count=3)

    assert result["fileName"] == "tone.flac"
    assert result["sampleRateHz"] == sr
    assert result["channelCount"] == 1
    assert len(result["channels"][0]["peaks"]) > 0


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


def test_analyze_audio_rejects_bad_options(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    with pytest.raises(ValueError):
        analyze_audio(wav, stft_options={"n_fft": 0, "hop_size": 1, "window": "hann"})
    with pytest.raises(ValueError):
        analyze_audio(wav, stft_options={"n_fft": 256, "hop_size": 512, "window": "hann"})


def test_analyze_audio_peaks_contains_440hz(tmp_path: Path) -> None:
    """peaks list should contain 440 Hz (within ±20 Hz) for a 440 Hz sine wave."""
    wav = tmp_path / "tone440.wav"
    _write_sine_wav(wav, freq_hz=440.0, seconds=2.0, sr=44100)
    result = analyze_audio(wav, peak_count=3)
    ch = result["channels"][0]
    assert "peaks" in ch, "peaks key missing from channel result"
    peaks = ch["peaks"]
    assert isinstance(peaks, list), "peaks should be a list"
    assert len(peaks) > 0, "peaks list should not be empty"
    # Every peak must have the required keys
    for peak in peaks:
        assert "freqHz" in peak, "each peak must have freqHz"
        assert "amplitudeDb" in peak, "each peak must have amplitudeDb"
    # At least one peak should be near 440 Hz
    freq_values = [p["freqHz"] for p in peaks]
    assert any(abs(f - 440.0) <= 20.0 for f in freq_values), f"Expected a peak near 440 Hz, got: {freq_values}"


def test_analyze_audio_keeps_multichannel_metrics_and_peaks_separate(tmp_path: Path) -> None:
    wav = tmp_path / "stereo.wav"
    sr = 16000
    seconds = 1.0
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    left = 0.2 * np.sin(2 * math.pi * 440.0 * t)
    right = 0.8 * np.sin(2 * math.pi * 880.0 * t)
    sf.write(wav, np.column_stack([left, right]).astype(np.float32), sr)

    result = analyze_audio(wav, peak_count=5)

    assert result["channelCount"] == 2
    assert len(result["channels"]) == 2
    left_ch, right_ch = result["channels"]
    assert left_ch["label"] in {"Channel 1", "Left", "L", "ch0"}
    assert right_ch["label"] in {"Channel 2", "Right", "R", "ch1"}
    assert left_ch["rms"] < right_ch["rms"]
    assert left_ch["peakAbsolute"] < right_ch["peakAbsolute"]

    left_freqs = [peak["freqHz"] for peak in left_ch["peaks"]]
    right_freqs = [peak["freqHz"] for peak in right_ch["peaks"]]
    assert any(abs(freq - 440.0) <= 20.0 for freq in left_freqs), left_freqs
    assert any(abs(freq - 880.0) <= 20.0 for freq in right_freqs), right_freqs
