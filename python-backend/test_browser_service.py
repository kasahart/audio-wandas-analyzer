from pathlib import Path

import numpy as np
import pytest

from browser_service import BrowserService, create_service

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
