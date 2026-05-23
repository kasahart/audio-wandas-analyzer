from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np
import pytest

from analyzer import analyze_audio


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
        assert "freqHz" in peak, "each peak must have freq_hz"
        assert "amplitudeDb" in peak, "each peak must have amplitude_db"
    # At least one peak should be near 440 Hz
    freq_values = [p["freqHz"] for p in peaks]
    assert any(abs(f - 440.0) <= 20.0 for f in freq_values), f"Expected a peak near 440 Hz, got: {freq_values}"
