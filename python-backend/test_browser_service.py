from pathlib import Path

import numpy as np
import pytest

from browser_service import BrowserService, create_service
from command_dispatch import dispatch, validate_request

FIXTURE = Path(__file__).resolve().parents[1] / "src/test/fixtures/short-stereo.wav"


def test_browser_source_bounds_release_and_stale_identity() -> None:
    service = create_service()
    assert isinstance(service, BrowserService)
    with pytest.raises(ValueError, match="non-empty"):
        service.engine.load("selected.wav", b"")
    with pytest.raises(ValueError, match="WAV only"):
        service.engine.load("selected.wav", b"not a wav")
    service.engine.load("selected.wav", FIXTURE.read_bytes())
    source = service.engine.get_file("/sources/selected.wav")
    assert service.engine.get_file(source.path.as_posix()) is source
    service.track_detail(source.path, stft_options={"nFft": 256, "hopSize": 64, "window": "hann"})
    assert source.spectrograms
    service.release_track_detail(source.path)
    assert not source.spectrograms
    assert service.engine.get_file(source.path) is source
    with pytest.raises(ValueError, match="too short"):
        service.engine.get_spectrogram(source.path, 16384, 1024, "hann")
    with pytest.raises(ValueError, match="memory budget"):
        service.engine.get_spectrogram(source.path, 1024, 1, "hann")
    service.engine.clear()
    with pytest.raises(ValueError, match="no longer selected"):
        service.engine.get_file(source.path)


def test_cursor_selects_nearest_actual_frame_center() -> None:
    service = create_service()
    changing_fixture = FIXTURE.with_name("changing-stereo.wav")
    service.engine.load("selected.wav", changing_fixture.read_bytes())
    path = "/sources/selected.wav"
    spec = service.engine.get_spectrogram(path, 256, 64, "hann")
    cursor = 0.437
    centers = np.asarray(spec.frame_center_times[0])
    expected_index = int(np.argmin(np.abs(centers - cursor * 2.5)))
    assert centers[expected_index] > 1.0
    expected = np.asarray(spec.get_frame_at(expected_index).dB)
    result = service.spectrum_slice(
        path, cursor_norm=cursor, stft_options={"nFft": 256, "hopSize": 64, "window": "hann"}
    )
    np.testing.assert_allclose(result["channels"][0]["values"], expected[0], atol=1e-5)


def test_multiple_sources_add_failure_remove_and_recompute() -> None:
    service = create_service()
    service.engine.load("first.wav", FIXTURE.read_bytes())
    service.engine.load("second.wav", FIXTURE.with_name("changing-stereo.wav").read_bytes())
    first = service.engine.get_file("/sources/first.wav")
    second = service.engine.get_file("/sources/second.wav")
    with pytest.raises(ValueError, match="WAV only"):
        service.engine.load("bad.wav", b"not a wav")
    with pytest.raises(ValueError, match="already loaded"):
        service.engine.load("first.wav", FIXTURE.read_bytes())
    assert service.engine.get_file(first.path) is first
    service.engine.get_spectrogram(first.path, 256, 64, "hann")
    service.engine.cache_limit_bytes = first.frame_nbytes + second.frame_nbytes
    service.engine.get_spectrogram(second.path, 256, 64, "hann")
    assert service.engine.get_file(first.path) is first
    assert service.engine.get_file(second.path) is second
    assert not first.spectrograms
    service.engine.discard(first.path)
    with pytest.raises(ValueError, match="no longer selected"):
        service.engine.get_file(first.path)
    assert service.engine.get_file(second.path) is second
    service.engine.load("third.wav", FIXTURE.read_bytes())
    assert service.engine.get_file("/sources/third.wav").frame.n_samples == 8000


def test_aggregate_bounds_reject_before_decode_and_preserve_sources(monkeypatch) -> None:
    import browser_service as browser

    service = create_service()
    payload = FIXTURE.read_bytes()
    for index in range(8):
        service.engine.load(f"source-{index}.wav", payload)
    with pytest.raises(ValueError, match="8 WAV"):
        service.engine.load("ninth.wav", payload)
    service.engine.discard("/sources/source-0.wav")
    monkeypatch.setattr(browser, "MAX_TOTAL_INPUT_BYTES", len(payload) * 7)
    with pytest.raises(ValueError, match="total input"):
        service.engine.load("over-input.wav", payload)
    monkeypatch.setattr(browser, "MAX_TOTAL_INPUT_BYTES", len(payload) * 9)
    monkeypatch.setattr(browser, "MAX_TOTAL_DECODED_BYTES", 7 * 8000 * 2 * 4)
    with pytest.raises(ValueError, match="decoded audio"):
        service.engine.load("over-decoded.wav", payload)
    monkeypatch.setattr(browser, "MAX_TOTAL_DECODED_BYTES", 9 * 8000 * 2 * 4)
    monkeypatch.setattr(browser, "MAX_ESTIMATED_BYTES", 1)
    with pytest.raises(ValueError, match="memory budget"):
        service.engine.load("over-working.wav", payload)
    assert len(service.engine._files) == 7
    assert service.engine.get_file("/sources/source-1.wav").frame.n_samples == 8000


def test_export_plan_is_bounded_and_releases_only_recomputable_detail(monkeypatch) -> None:
    import json

    import browser_service as browser

    service = create_service()
    monkeypatch.setattr(browser, "service", service)
    service.engine.load("first.wav", FIXTURE.read_bytes())
    service.engine.load("second.wav", FIXTURE.with_name("changing-stereo.wav").read_bytes())
    first = service.engine.get_file("/sources/first.wav")
    service.engine.get_spectrogram(first.path, 256, 64, "hann")
    commands = [
        {"cmd": "export-wav-loop", "filePath": "/sources/first.wav", "startNorm": 0.5, "endNorm": 1},
        {"cmd": "export-wav-loop", "filePath": "/sources/second.wav", "startNorm": 0.2, "endNorm": 0.6},
    ]
    assert browser.prepare_export_json(json.dumps(commands)) == "{}"
    assert not first.spectrograms
    assert service.engine.get_file(first.path) is first
    with pytest.raises(ValueError, match="8 sources"):
        browser.prepare_export_json("[]")
    with pytest.raises(ValueError, match="Invalid export"):
        browser.prepare_export_json("[null]")
    monkeypatch.setattr(browser, "MAX_ESTIMATED_BYTES", 1)
    with pytest.raises(ValueError, match="Export exceeds"):
        browser.prepare_export_json(json.dumps(commands))
    assert len(service.engine._files) == 2


def test_auto_stft_valid_high_rate_wav_matches_native(tmp_path) -> None:
    import soundfile as sf

    from analysis_engine import AnalysisEngine
    from analysis_service import AnalysisService
    from analyzer import resolve_stft_params

    rate = 96000
    samples = np.sin(2 * np.pi * 500 * np.arange(16 * rate) / rate) * 0.4
    file_path = tmp_path / "auto-96k.wav"
    sf.write(file_path, samples, rate, subtype="PCM_16")
    browser = create_service()
    browser.engine.load("auto-96k.wav", file_path.read_bytes())
    native = AnalysisService(AnalysisEngine())
    assert resolve_stft_params(len(samples), None) == (2048, 2134, "hann")
    browser_result = browser.track_detail("/sources/auto-96k.wav")
    native_result = native.track_detail(file_path)
    browser_spec = browser_result["channels"][0]["spectrogram"]
    native_spec = native_result["channels"][0]["spectrogram"]
    assert browser_spec["hopSize"] == native_spec["hopSize"] == 2134
    assert browser_spec["timeBins"] <= 720
    assert browser_spec == native_spec


@pytest.mark.parametrize("payload", [b"", b"not a WAV", b"RIFF" + b"\0" * 4 + b"WAVE"])
def test_expected_browser_input_rejection_has_no_traceback(monkeypatch, payload) -> None:
    import json

    import browser_service

    monkeypatch.setattr(browser_service, "service", create_service())
    result = json.loads(browser_service.load_source("bad.wav", payload))
    assert isinstance(result["inputError"], str) and result["inputError"]
    assert "Traceback" not in result["inputError"]
    assert "\n" not in result["inputError"]
    assert not browser_service.service.engine._files


def test_browser_unexpected_load_failure_is_not_hidden(monkeypatch) -> None:
    import browser_service

    def fail(*args):
        raise RuntimeError("unexpected internal failure")

    monkeypatch.setattr(browser_service.service.engine, "load", fail)
    with pytest.raises(RuntimeError, match="unexpected internal failure"):
        browser_service.load_source("selected.wav", FIXTURE.read_bytes())


def test_run_recipe_uses_loaded_sources_and_rejects_paths() -> None:
    service = create_service()
    service.engine.load("selected.wav", FIXTURE.read_bytes())
    path = "/sources/selected.wav"
    service.track_detail(path, stft_options={"nFft": 256, "hopSize": 64, "window": "hann"})
    recipe = {
        "inputs": [{"name": "sig", "file": path}],
        "steps": [{"as": "w", "expr": "sig.welch(n_fft=256)"}],
        "display": [{"name": "w", "title": "PSD"}],
    }
    result = dispatch(validate_request({"cmd": "run-recipe", "requestId": "r", "recipe": recipe}), service)
    assert [chart["kind"] for chart in result["charts"]] == ["line"]
    assert result["charts"][0]["title"] == "PSD"
    assert not service.engine.get_file(path).spectrograms, "recipe execution releases recomputable detail"
    with pytest.raises(ValueError, match="not a loaded source"):
        service.run_recipe({**recipe, "inputs": [{"name": "sig", "file": str(FIXTURE)}]})
    with pytest.raises(ValueError, match="recipe error"):
        service.run_recipe({**recipe, "steps": [{"as": "w", "expr": "sig[0]"}]})
