from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from analysis_engine import AnalysisEngine
from backend_errors import InputError


def _write_tone(path: Path, seconds: float = 0.25, rate: int = 16000) -> Path:
    t = np.arange(int(seconds * rate)) / rate
    sf.write(path, (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), rate)
    return path


def test_cache_bytes_count_spectrum_slices_and_pair_spectra(tmp_path: Path) -> None:
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    entry = engine.get_file(_write_tone(tmp_path / "tone.wav"))
    base = entry.nbytes
    rows = np.zeros((1, 512), dtype=np.float32)
    engine.put_spectrum_slice(entry, ("sig", 512, "hann", 0, 512, None), rows, 8000.0)
    pair_rows = np.zeros((3, 256))
    engine.put_pair_spectrum(entry, ("pair",), ("ok", 0.0, 1.0, 4, False, pair_rows, {"unit": "dB"}))

    assert entry.nbytes == base + rows.nbytes + pair_rows.nbytes
    assert engine.cache_bytes == entry.nbytes


def test_cached_slices_evict_other_files_but_keep_the_file_in_use(tmp_path: Path) -> None:
    first = _write_tone(tmp_path / "first.wav")
    second = _write_tone(tmp_path / "second.wav")
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    engine.get_file(first)
    entry = engine.get_file(second)
    engine.cache_limit_bytes = engine.cache_bytes

    engine.put_spectrum_slice(entry, ("sig", 512, "hann", 0, 512, None), np.zeros((1, 4096), np.float32), 8000.0)

    assert not engine.is_cached(first)
    assert engine.is_cached(second)


def test_file_load_locks_are_released_after_each_read(tmp_path: Path) -> None:
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    paths = [_write_tone(tmp_path / f"t{index}.wav") for index in range(4)]
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(engine.get_file, paths * 3))

    assert engine._loading == {}


def test_concurrent_requests_for_one_spectrogram_compute_the_stft_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import analysis_engine

    wav = _write_tone(tmp_path / "tone.wav")
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    engine.get_file(wav)
    both_waiting = threading.Barrier(2, timeout=10)
    calls = 0
    original = analysis_engine.compute_spectrogram

    def slow_compute(*args: object, **kwargs: object):
        nonlocal calls
        calls += 1
        time.sleep(0.2)
        return original(*args, **kwargs)  # type: ignore[arg-type]

    def build(_index: int):
        both_waiting.wait()
        return engine.get_spectrogram(wav, 512, 128, "hann")

    monkeypatch.setattr(analysis_engine, "compute_spectrogram", slow_compute)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = executor.map(build, range(2))

    assert calls == 1
    assert first is second
    assert engine._loading == {}


def test_track_detail_of_a_file_shorter_than_half_a_window_is_an_input_error(tmp_path: Path) -> None:
    from analysis_service import AnalysisService
    from command_dispatch import dispatch, validate_request

    wav = tmp_path / "short.wav"
    sf.write(wav, np.zeros(20, dtype=np.float32), 16000)
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=10_000_000))
    command = {
        "cmd": "track-detail",
        "requestId": "r",
        "filePath": str(wav),
        "trackIndex": -1,
        "analysisId": "a1",
        "settingsSignature": "s1",
    }

    with pytest.raises(InputError, match="too short for this STFT window"):
        dispatch(validate_request(command), service)


def test_every_lazy_answer_names_the_file_version_and_one_asked_of_another_is_refused(tmp_path: Path) -> None:
    """A lane's lazy answers (range, detail, slice, pair, reads) are of the version its track was analysed from: a
    file rewritten since is refused with stale-source, never answered from the new samples under the old picture."""
    from analysis_service import AnalysisService
    from backend_errors import STALE_SOURCE, StaleSourceError, error_payload
    from command_dispatch import dispatch, validate_request

    wav = _write_tone(tmp_path / "a.wav")
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=50_000_000))
    track = {"filePath": str(wav), "trackIndex": 0, "analysisId": "a1", "settingsSignature": "s1"}
    pair_source = {"filePath": str(wav), "channelIndex": 0, "offsetSeconds": 0.0}
    commands = [
        {"cmd": "range", "filePath": str(wav), "startNorm": 0.0, "endNorm": 1.0, "points": 8},
        {
            "cmd": "range",
            "filePath": str(wav),
            "startNorm": 0.0,
            "endNorm": 1.0,
            "points": 1,
            "read": {"x": [0.1, 0.2], "y": [0.0, 1.0], "channel": 0},
        },
        {"cmd": "track-detail", **track},
        {"cmd": "spectrum-slice", **track, "cursorNorm": 0.5},
    ]
    analysed = dispatch(validate_request({"cmd": "analyze", "requestId": "r", "filePath": str(wav)}), service)
    version = analysed["sourceVersion"]
    assert isinstance(version, str) and version
    for command in commands:
        reply = dispatch(validate_request({**command, "requestId": "r", "sourceVersion": version}), service)
        assert reply["sourceVersion"] == version, command["cmd"]
    pair = {"cmd": "pair-spectrum", "requestId": "r", "analysisId": "a1", "settingsSignature": "s1"}
    sourced = {**pair_source, "sourceVersion": version}
    paired = dispatch(validate_request({**pair, "reference": sourced, "responses": [sourced]}), service)
    assert paired["sourceVersion"] == version and paired["responses"][0]["sourceVersion"] == version

    _write_tone(wav, seconds=0.5)  # recorded again: another version of the same path
    for command in commands:
        with pytest.raises(StaleSourceError) as raised:
            dispatch(validate_request({**command, "requestId": "r", "sourceVersion": version}), service)
        assert error_payload(raised.value)["code"] == STALE_SOURCE
    with pytest.raises(StaleSourceError):
        dispatch(validate_request({**pair, "reference": pair_source, "responses": [sourced]}), service)
    again = dispatch(validate_request({"cmd": "analyze", "requestId": "r", "filePath": str(wav)}), service)
    assert again["sourceVersion"] != version
    reply = dispatch(
        validate_request({**commands[0], "requestId": "r", "sourceVersion": again["sourceVersion"]}), service
    )
    assert reply["sourceVersion"] == again["sourceVersion"]


def test_every_spectral_answer_names_the_stft_it_is_taken_with_not_the_one_asked_for(tmp_path: Path) -> None:
    """The analysis, a lane's spectrogram, a cursor slice and a pair name the STFT they were computed with
    (stftSignature), derived here from the settings used: a lazy answer under other settings than the analysis
    drawn names another STFT, whatever settingsSignature the request carried (that one is only echoed)."""
    from analysis_service import AnalysisService
    from command_dispatch import dispatch, validate_request

    wav = _write_tone(tmp_path / "a.wav", seconds=1.0)
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=50_000_000))
    track = {"filePath": str(wav), "trackIndex": 0, "analysisId": "a1", "settingsSignature": "same"}
    small = {"nFft": 256, "overlapPercent": 50, "window": "hann"}
    large = {"nFft": 1024, "overlapPercent": 50, "window": "hann"}
    source = {"filePath": str(wav), "channelIndex": 0, "offsetSeconds": 0.0}

    def answers(stft: dict[str, object] | None) -> list[object]:
        options = {"stftOptions": stft} if stft else {}
        replies = [
            dispatch(validate_request({"cmd": "analyze", "requestId": "r", "filePath": str(wav), **options}), service),
            dispatch(validate_request({"cmd": "track-detail", "requestId": "r", **track, **options}), service),
            dispatch(
                validate_request({"cmd": "spectrum-slice", "requestId": "r", **track, "cursorNorm": 0.5, **options}),
                service,
            ),
            dispatch(
                validate_request(
                    {
                        "cmd": "pair-spectrum",
                        "requestId": "r",
                        "analysisId": "a1",
                        "settingsSignature": "same",
                        "reference": source,
                        "responses": [source],
                        **options,
                    }
                ),
                service,
            ),
        ]
        return [reply["stftSignature"] for reply in replies]

    for stft in (None, small, large):
        signatures = answers(stft)
        assert len(set(signatures)) == 1, (stft, signatures)
    assert answers(small)[0] == "256/128/hann"
    assert len({answers(None)[0], answers(small)[0], answers(large)[0]}) == 3
