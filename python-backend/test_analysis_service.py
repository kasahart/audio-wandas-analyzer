from __future__ import annotations

import base64
import io
import math
import wave
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from analyzer import normalize_stft_options


def _write_sine_wav(path: Path, seconds: float = 0.5, sample_rate: int = 16000) -> None:
    time_axis = np.linspace(0, seconds, int(seconds * sample_rate), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * 440 * time_axis) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(samples.tobytes())


def test_service_exposes_all_use_cases_without_server_loop(tmp_path: Path) -> None:
    audio = tmp_path / "tone.wav"
    _write_sine_wav(audio)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    service = AnalysisService(engine)
    stft_options = {"nFft": 256, "hopSize": 128, "window": "hann"}

    overview = service.analyze(audio, peak_count=3, stft_options=stft_options)
    detail = service.track_detail(
        audio,
        track_index=2,
        analysis_id="analysis-1",
        settings_signature="settings-1",
        stft_options=stft_options,
    )
    spectrum = service.spectrum_slice(
        audio,
        cursor_norm=0.5,
        track_index=2,
        analysis_id="analysis-1",
        settings_signature="settings-1",
        stft_options=stft_options,
    )
    waveform_range = service.waveform_range(audio, start_norm=0.25, end_norm=0.75, point_count=128)
    wav_loop = service.export_wav_loop(audio, start_norm=0.25, end_norm=0.75)
    cached = engine.get_file(audio)

    assert overview["filePath"] == str(audio.resolve())
    assert detail["channels"][0]["spectrogram"] is not None
    assert spectrum["frequencyBins"] == len(spectrum["values"])
    assert waveform_range["channels"]
    exported, sample_rate = sf.read(io.BytesIO(base64.b64decode(wav_loop["wavBase64"])))
    assert sample_rate == wav_loop["sampleRate"]
    assert exported.size > 0
    assert cached.spectrograms
    assert service.release_track_detail(audio) == {}
    assert cached.spectrograms == {}


def test_service_uses_the_injected_analysis_engine(tmp_path: Path) -> None:
    audio = tmp_path / "tone.wav"
    _write_sine_wav(audio)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    service = AnalysisService(engine)

    service.analyze(audio)

    assert service.engine is engine
    assert list(engine._files) == [audio.resolve()]


def test_stft_options_share_one_normalization_and_validation_api() -> None:
    assert normalize_stft_options({"nFft": 512, "hopSize": 128, "window": "hann"}) == {
        "n_fft": 512,
        "hop_size": 128,
        "window": "hann",
    }
    assert normalize_stft_options({"n_fft": 512, "hop_size": 128, "window": "hann"}) == {
        "n_fft": 512,
        "hop_size": 128,
        "window": "hann",
    }
    with pytest.raises(ValueError, match="hop_size"):
        normalize_stft_options({"nFft": 128, "hopSize": 256, "window": "hann"})
