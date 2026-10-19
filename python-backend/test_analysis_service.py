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
    options = {"nFft": n_fft, "overlapPercent": 75, "window": "hann"}
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
    stft_options = {"nFft": 256, "overlapPercent": 50, "window": "hann"}

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
    assert normalize_stft_options({"nFft": 512, "overlapPercent": 75, "window": "hann"}) == {
        "n_fft": 512,
        "hop_size": 128,
        "window": "hann",
    }
    assert normalize_stft_options({"n_fft": 512, "overlap_percent": 75, "window": "hann"}) == {
        "n_fft": 512,
        "hop_size": 128,
        "window": "hann",
    }
    for overlap_percent in (-1, 100):
        with pytest.raises(ValueError, match="overlap_percent"):
            normalize_stft_options({"nFft": 128, "overlapPercent": overlap_percent, "window": "hann"})
    with pytest.raises(ValueError, match="overlap_percent"):
        normalize_stft_options({"nFft": 128, "hopSize": 32, "window": "hann"})


@pytest.mark.parametrize(("overlap_percent", "hop_size"), [(0, 1024), (50, 512), (67, 338), (75, 256)])
def test_overlap_percent_sets_the_hop_from_n_fft(overlap_percent: float, hop_size: int) -> None:
    normalized = normalize_stft_options({"nFft": 1024, "overlapPercent": overlap_percent, "window": "hann"})
    assert normalized is not None
    assert normalized["hop_size"] == hop_size


@pytest.mark.parametrize("n_fft", [65, 255, 16383])
@pytest.mark.parametrize("keys", [("nFft", "overlapPercent"), ("n_fft", "overlap_percent")])
def test_odd_stft_sizes_are_rejected_at_normalization(n_fft: int, keys: tuple[str, str]) -> None:
    with pytest.raises(ValueError, match="n_fft must be even"):
        normalize_stft_options({keys[0]: n_fft, keys[1]: 75, "window": "hann"})
    assert normalize_stft_options({"nFft": 254, "overlapPercent": 75, "window": "hann"}) == {
        "n_fft": 254,
        "hop_size": 64,
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


@pytest.mark.parametrize(
    "inputs",
    [{"name": "sig"}, {}, "", 0, False, 1, [{"name": "sig"}], [{"name": "sig", "file": 3}], ["selected.wav"]],
)
def test_recipe_rejects_malformed_inputs_before_loading(inputs: object) -> None:
    from backend_errors import InputError
    from browser_service import create_service

    desktop = AnalysisService(AnalysisEngine(cache_limit_bytes=1024 * 1024))
    for service in (desktop, create_service()):
        with pytest.raises(InputError, match="recipe error"):
            service.run_recipe({"inputs": inputs, "steps": [], "display": []})


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


@pytest.mark.parametrize("transfer_value", [None, "gain"])
def test_calibrated_pairwise_recipe_matches_desktop_and_browser(tmp_path, transfer_value):
    from browser_service import create_service

    rate = 16000
    samples = 0.01 * np.sin(2 * np.pi * np.arange(rate // 4)[:, None] / rate * np.array([440, 880]))
    wav = tmp_path / "pairs.wav"
    sf.write(wav, samples, rate, subtype="PCM_16")
    desktop = AnalysisService(AnalysisEngine(cache_limit_bytes=16 * 1024 * 1024))
    browser = create_service()
    browser.engine.load(wav.name, wav.read_bytes())
    labels = desktop.engine.get_file(wav).frame.labels
    profile = {
        "schemaVersion": 1,
        "channels": [
            {
                "channelIndex": index,
                "expectedLabel": labels[index],
                "status": "calibrated",
                "source": "manual",
                "factor": factor,
                "unit": unit,
                "referenceValue": ref,
            }
            for index, (factor, unit, ref) in enumerate([(2.0, "Pa", 2e-5), (3.0, "V", 1e-6)])
        ],
    }
    recipe = {
        "inputs": [{"name": "sig", "file": wav.name}],
        "steps": [
            {"as": "cross", "expr": "sig.csd()"},
            {"as": "transfer", "expr": "sig.transfer_function()"},
        ],
        "display": ["cross", {"name": "transfer", "value": transfer_value}]
        if transfer_value
        else ["cross", "transfer"],
    }
    contexts = {"sig": {"calibrationProfile": profile}}
    native = desktop.run_recipe(recipe, recipe_path=str(tmp_path / "custom.json"), input_contexts=contexts)
    web = browser.run_recipe(recipe, recipe_path="/sources/custom.json", input_contexts=contexts)
    assert native == web
    assert [chart["yLabel"] for chart in native["charts"]] == [
        "Cross-spectral level [dB]",
        "Gain" if transfer_value else "Transfer level [dB]",
    ]
    for chart in native["charts"]:
        assert any("Pa" in series["unit"] and "V" in series["unit"] for series in chart["series"])


def _write_pair_wav(path: Path, channels: np.ndarray, rate: int) -> None:
    sf.write(path, np.asarray(channels).T, rate, subtype="FLOAT")


def _pair_source(path: Path, channel: int, offset: float = 0.0) -> dict[str, object]:
    return {"filePath": str(path), "channelIndex": channel, "offsetSeconds": offset}


_PAIR_OPTIONS = {"nFft": 1024, "overlapPercent": 50, "window": "hann"}


def test_pair_spectrum_recovers_a_known_filter(tmp_path: Path) -> None:
    from scipy.signal import butter, freqz, lfilter

    rate = 16000
    excitation = np.random.default_rng(0).standard_normal(rate * 8) * 0.1
    b, a = butter(2, 1000, fs=rate)
    audio = tmp_path / "system.wav"
    _write_pair_wav(audio, [excitation, lfilter(b, a, excitation)], rate)

    result = AnalysisService(AnalysisEngine()).pair_spectrum(
        _pair_source(audio, 0), [_pair_source(audio, 1)], stft_options=_PAIR_OPTIONS
    )

    response = result["responses"][0]
    assert response["status"] == "ok"
    # Welch segments inside 8 s: (128000 - 1024) // 512 + 1.
    assert response["averages"] == 249
    bins = np.round(np.linspace(0, 512, result["frequencyBins"])).astype(int)
    _, expected = freqz(b, a, worN=bins * rate / 1024, fs=rate)
    coherence = np.asarray(response["coherence"], dtype=float)
    reliable = coherence > 0.99
    assert reliable.sum() > 20
    gain = np.asarray(response["gainDb"], dtype=float)
    phase = np.asarray(response["phaseRad"], dtype=float)
    assert np.max(np.abs(gain[reliable] - 20 * np.log10(np.abs(expected[reliable])))) < 0.1
    phase_error = np.angle(np.exp(1j * (phase[reliable] - np.angle(expected[reliable]))))
    assert np.degrees(np.max(np.abs(phase_error))) < 1.0
    assert response["axisLabel"] == "Gain [dB]"
    assert result["nFft"] == 1024 and result["hopLength"] == 512


def test_pair_spectrum_uses_offsets_and_the_requested_range(tmp_path: Path) -> None:
    rate = 8000
    signal = np.random.default_rng(1).standard_normal(rate * 4) * 0.1
    reference = tmp_path / "reference.wav"
    response = tmp_path / "response.wav"
    _write_pair_wav(reference, [signal], rate)
    # The response recording starts 1 s later; its offset puts both on the same timeline.
    _write_pair_wav(response, [signal[rate:] * 0.5], rate)
    service = AnalysisService(AnalysisEngine())

    aligned = service.pair_spectrum(
        _pair_source(reference, 0),
        [_pair_source(response, 0, offset=1.0)],
        start_seconds=1.5,
        end_seconds=3.5,
        stft_options=_PAIR_OPTIONS,
    )["responses"][0]
    shifted = service.pair_spectrum(
        _pair_source(reference, 0), [_pair_source(response, 0)], stft_options=_PAIR_OPTIONS
    )["responses"][0]

    assert (aligned["startSeconds"], aligned["endSeconds"]) == pytest.approx((1.5, 3.5))
    assert aligned["averages"] == (2 * rate - 1024) // 512 + 1
    coherence = np.asarray(aligned["coherence"][1:-1], dtype=float)
    assert np.min(coherence) > 0.999
    assert np.asarray(aligned["gainDb"][1:-1], dtype=float) == pytest.approx(20 * np.log10(0.5), abs=0.01)
    assert np.median(np.asarray(shifted["coherence"], dtype=float)) < 0.2


def test_pair_spectrum_reports_responses_it_cannot_average(tmp_path: Path) -> None:
    rate = 8000
    audio = tmp_path / "short.wav"
    _write_pair_wav(audio, np.random.default_rng(2).standard_normal((2, rate)), rate)
    service = AnalysisService(AnalysisEngine())

    result = service.pair_spectrum(
        _pair_source(audio, 0),
        [_pair_source(audio, 1, offset=2.0), _pair_source(audio, 1, offset=0.95)],
        stft_options=_PAIR_OPTIONS,
    )

    assert [response["status"] for response in result["responses"]] == ["no-overlap", "too-short"]
    assert all(response["gainDb"] == [] and response["averages"] == 0 for response in result["responses"])
    with pytest.raises(ValueError, match="channelIndex 2"):
        service.pair_spectrum(_pair_source(audio, 0), [_pair_source(audio, 2)])


def test_pair_spectrum_resamples_responses_to_the_reference_rate(tmp_path: Path) -> None:
    from scipy.signal import resample_poly

    signal = np.random.default_rng(3).standard_normal(16000 * 2) * 0.1
    reference = tmp_path / "reference.wav"
    response = tmp_path / "response.wav"
    _write_pair_wav(reference, [signal], 16000)
    _write_pair_wav(response, [resample_poly(signal, 2, 1)], 32000)

    result = AnalysisService(AnalysisEngine()).pair_spectrum(
        _pair_source(reference, 0), [_pair_source(response, 0)], stft_options=_PAIR_OPTIONS
    )

    pair = result["responses"][0]
    assert pair["resampled"] is True
    assert result["maxFrequencyHz"] == 8000
    coherence = np.asarray(pair["coherence"], dtype=float)
    assert np.median(coherence[: len(coherence) // 2]) > 0.99


def test_pair_spectrum_reuses_cached_pairs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import analysis_service

    rate = 8000
    audio = tmp_path / "pair.wav"
    _write_pair_wav(audio, np.random.default_rng(4).standard_normal((2, rate * 2)), rate)
    service = AnalysisService(AnalysisEngine())
    calls = []
    compute = analysis_service._compute_pair
    monkeypatch.setattr(analysis_service, "_compute_pair", lambda *args: calls.append(args) or compute(*args))

    first = service.pair_spectrum(_pair_source(audio, 0), [_pair_source(audio, 1)], stft_options=_PAIR_OPTIONS)
    second = service.pair_spectrum(_pair_source(audio, 0), [_pair_source(audio, 1)], stft_options=_PAIR_OPTIONS)

    assert len(calls) == 1
    assert second["responses"] == first["responses"]


def test_pair_spectrum_labels_transfer_levels_between_units(tmp_path: Path) -> None:
    rate = 8000
    audio = tmp_path / "pair.wav"
    _write_pair_wav(audio, np.random.default_rng(5).standard_normal((2, rate * 2)) * 0.1, rate)
    labels = list(AnalysisEngine().get_file(audio).frame.labels)
    profile = {
        "schemaVersion": 1,
        "channels": [
            {
                "channelIndex": index,
                "expectedLabel": labels[index],
                "status": "calibrated",
                "factor": 1.0,
                "unit": unit,
                "referenceValue": 1.0,
            }
            for index, unit in enumerate(["m/s^2", "Pa"])
        ],
    }
    source = {**_pair_source(audio, 0), "calibrationProfile": profile}

    result = AnalysisService(AnalysisEngine()).pair_spectrum(
        source, [{**_pair_source(audio, 1), "calibrationProfile": profile}], stft_options=_PAIR_OPTIONS
    )

    response = result["responses"][0]
    assert response["status"] == "ok"
    assert response["axisLabel"].startswith("Transfer level [")
    assert "Pa" in response["axisLabel"]


def test_browser_pair_spectrum_refuses_work_beyond_the_memory_budget(tmp_path: Path) -> None:
    from browser_service import create_service

    browser = create_service()
    sources = []
    for rate, name in [(96000, "fine.wav"), (48000, "reference.wav"), (48000, "response.wav")]:
        audio = tmp_path / name
        _write_pair_wav(audio, np.random.default_rng(rate).standard_normal((1, rate * 30)) * 0.1, rate)
        browser.engine.load(name, audio.read_bytes())
        sources.append({"filePath": f"/sources/{name}", "channelIndex": 0, "offsetSeconds": 0.0})

    with pytest.raises(ValueError, match="memory budget"):
        browser.pair_spectrum(sources[0], sources[1:2])
    # A loop range bounds the work, so the same pair fits once only a few seconds are averaged.
    narrowed = browser.pair_spectrum(sources[0], sources[1:2], start_seconds=10.0, end_seconds=15.0)
    assert narrowed["responses"][0]["status"] == "ok"
    # So does an offset that leaves only a few seconds of overlap, or a single bound.
    shifted = browser.pair_spectrum(sources[0], [{**sources[1], "offsetSeconds": 25.0}])
    assert shifted["responses"][0]["status"] == "ok"
    tail = browser.pair_spectrum(sources[0], sources[1:2], start_seconds=25.0)
    assert tail["responses"][0]["status"] == "ok"
    # Thirty seconds at 48 kHz with the default settings is the common case and must fit.
    result = browser.pair_spectrum(sources[1], sources[2:])
    assert result["responses"][0]["status"] == "ok"
