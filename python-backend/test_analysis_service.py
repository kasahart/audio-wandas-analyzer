from __future__ import annotations

import base64
import io
import math
import wave
from pathlib import Path

import dask.array as da
import numpy as np
import pytest
import soundfile as sf
import wandas as wd
from scipy.signal import ShortTimeFFT, get_window

from analysis_engine import AnalysisEngine, compute_spectrogram
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


@pytest.mark.parametrize("n_fft", [512, 1024, 2048, 4096])
def test_known_tones_keep_physical_frequency_in_live_fft_and_cached_stft(tmp_path: Path, n_fft: int) -> None:
    from browser_service import create_service

    rate = 16000
    tones = np.array([440, 880, 3000])
    samples = 0.5 * np.sin(2 * np.pi * np.arange(rate)[:, None] / rate * tones)
    audio = tmp_path / "tones.wav"
    # The Web prototype supports two channels; verify the third tone with the desktop engine below.
    sf.write(audio, samples[:, :2], rate, subtype="PCM_16")
    browser = create_service()
    browser.engine.load(audio.name, audio.read_bytes())
    native = AnalysisService(AnalysisEngine())
    options = {"nFft": n_fft, "hopSize": n_fft // 4, "window": "hann"}
    for service, path in [(native, audio), (browser, Path("/sources/tones.wav"))]:
        for cached in [False, True]:
            if cached:
                detail = service.track_detail(path, stft_options=options)
                for tone, channel in zip(tones, detail["channels"], strict=False):
                    spec = channel["spectrogram"]
                    peak = np.argmax(spec["values"][len(spec["values"]) // 2])
                    assert abs(peak * spec["maxFrequencyHz"] / (spec["frequencyBins"] - 1) - tone) <= (
                        rate / 2 / 191 / 2 + rate / n_fft
                    )
            result = service.spectrum_slice(path, cursor_norm=0.5, stft_options=options)
            assert result["frequencyBins"] == 192
            for tone, channel in zip(tones, result["channels"], strict=False):
                peak = np.argmax(channel["values"])
                assert abs(peak * result["maxFrequencyHz"] / 191 - tone) <= rate / 2 / 191 / 2 + rate / n_fft

    sf.write(audio, samples[:, 2], rate, subtype="PCM_16")
    third = AnalysisService(AnalysisEngine()).spectrum_slice(audio, cursor_norm=0.5, stft_options=options)
    assert abs(np.argmax(third["channels"][0]["values"]) * third["maxFrequencyHz"] / 191 - tones[2]) <= (
        rate / 2 / 191 / 2 + rate / n_fft
    )


def test_service_exposes_all_use_cases_without_server_loop(tmp_path: Path) -> None:
    audio = tmp_path / "tone.wav"
    _write_sine_wav(audio)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    service = AnalysisService(engine)
    stft_options = {"nFft": 256, "hopSize": 128, "window": "hann"}

    overview = service.analyze(audio, stft_options=stft_options)
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
    assert spectrum["frequencyBins"] == len(spectrum["channels"][0]["values"])
    assert waveform_range["channels"]
    exported, sample_rate = sf.read(io.BytesIO(base64.b64decode(wav_loop["wavBase64"])))
    assert sample_rate == wav_loop["sampleRate"]
    assert exported.size > 0
    assert cached.spectrograms
    assert service.release_track_detail(audio) == {}
    assert cached.spectrograms


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


@pytest.mark.parametrize("n_fft", [65, 255, 16383])
@pytest.mark.parametrize("keys", [("nFft", "hopSize"), ("n_fft", "hop_size")])
def test_odd_stft_sizes_are_rejected_at_normalization(n_fft: int, keys: tuple[str, str]) -> None:
    with pytest.raises(ValueError, match="n_fft must be even"):
        normalize_stft_options({keys[0]: n_fft, keys[1]: 32, "window": "hann"})
    assert normalize_stft_options({"nFft": 254, "hopSize": 32, "window": "hann"}) == {
        "n_fft": 254,
        "hop_size": 32,
        "window": "hann",
    }


@pytest.mark.parametrize("n_fft", [64, 256])
@pytest.mark.parametrize("window", ["hann", "boxcar"])
def test_sparse_stft_time_axes_and_amplitudes_match_scipy(n_fft: int, window: str) -> None:
    rate = 8000
    hop = n_fft * 3 + 1
    t = np.arange(n_fft * 15)
    samples = 0.2 + 0.3 * np.sin(2 * np.pi * 7 * t / n_fft) + 0.1 * (-1.0) ** t
    frame = wd.ChannelFrame(
        da.from_array(np.stack([samples, samples * 0.5])), sampling_rate=rate, source_time_offset=[1.25, -0.5]
    )
    frame = frame.with_calibration({0: wd.ChannelCalibration(factor=2.0, unit="Pa", ref=2e-5)})
    transform = ShortTimeFFT(get_window(window, n_fft), hop=hop, fs=rate, mfft=n_fft, scale_to="magnitude")
    expected = transform.stft(np.asarray(frame.data))
    expected[:, 1:-1, :] *= 2
    local_times = np.arange(expected.shape[-1]) * hop / rate
    source_times = frame.source_time_offset[:, None] + local_times[None, :]
    centers = frame.source_time_offset[:, None] + transform.t(frame.n_samples)[None, :]

    sparse = compute_spectrogram(frame, n_fft, hop, window)
    for result in [sparse, sparse.astype(np.complex64), sparse.cache(), sparse.astype(np.complex64).cache()]:
        assert result.hop_length == hop
        np.testing.assert_allclose(result.times, local_times)
        np.testing.assert_allclose(result.source_times, source_times)
        np.testing.assert_allclose(result.frame_center_times, centers)
        np.testing.assert_allclose(np.asarray(result.data), expected, rtol=1e-6, atol=1e-7)
        assert result.channels[0].unit == "Pa"
        assert result.channels[0].calibration.factor == 1.0
    assert frame.channels[0].calibration.factor == 2.0


def test_recipe_uses_calibrated_frames_and_recipe_relative_paths_in_both_hosts(tmp_path):
    from browser_service import create_service

    wav = tmp_path / "selected.wav"
    _write_sine_wav(wav)
    desktop = AnalysisService(AnalysisEngine(cache_limit_bytes=16 * 1024 * 1024))
    browser = create_service()
    browser.engine.load(wav.name, wav.read_bytes())
    labels = list(desktop.engine.get_file(wav).frame.labels)
    profile = {
        "schemaVersion": 1,
        "channels": [
            {
                "channelIndex": 0,
                "expectedLabel": labels[0],
                "status": "calibrated",
                "source": "manual",
                "factor": 10.0,
                "unit": "Pa",
                "referenceValue": 2e-5,
            }
        ],
    }
    recipe = {
        "inputs": [{"name": "sig", "file": "selected.wav"}],
        "steps": [
            {"as": "spectrum", "expr": "sig.fft()"},
            {"as": "octave", "expr": "sig.noct_spectrum(fmin=125, fmax=4000, n=3)"},
            {"as": "stft", "expr": "sig.stft()"},
        ],
        "display": ["sig", "spectrum", "octave", "stft"],
    }
    contexts = {"sig": {"calibrationProfile": profile, "analysisRevision": 3}}
    native = desktop.run_recipe(recipe, recipe_path=str(tmp_path / "custom.json"), input_contexts=contexts)
    web = browser.run_recipe(recipe, recipe_path="/sources/custom.json", input_contexts=contexts)
    assert native == web
    assert native["charts"][0]["series"][0]["unit"] == "Pa"
    assert "Pa" in native["charts"][1]["series"][0]["unit"]
    assert "Pa" in native["charts"][2]["series"][0]["unit"]
    assert "Pa" in native["charts"][3]["unit"]
    raw = desktop.run_recipe(recipe, recipe_path=str(tmp_path / "custom.json"))
    assert raw["charts"][2]["series"][0]["unit"] == "dBFS"
    assert raw["charts"][3]["unit"] == "dBFS"
    np.testing.assert_allclose(
        native["charts"][0]["series"][0]["ys"], np.array(raw["charts"][0]["series"][0]["ys"]) * 10
    )
    cached = desktop.engine.get_file(wav)
    desktop.run_recipe(recipe, recipe_path=str(tmp_path / "custom.json"), input_contexts=contexts)
    assert desktop.engine.get_file(wav) is cached
    assert cached.frame.channels[0].unit != "Pa"
