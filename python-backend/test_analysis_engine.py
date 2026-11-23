from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from services.analysis_engine import AnalysisEngine
from services.backend_errors import InputError


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
    from services import analysis_engine

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


def test_the_stft_of_a_file_shorter_than_half_a_window_is_an_input_error_and_its_row_keeps_the_samples(
    tmp_path: Path,
) -> None:
    from services.analysis_service import AnalysisService
    from services.analyzer import resolve_stft_params
    from transport.command_dispatch import dispatch, validate_request

    wav = tmp_path / "short.wav"
    sf.write(wav, np.zeros(20, dtype=np.float32), 16000)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    n_fft, hop, window = resolve_stft_params(20, None)
    with pytest.raises(InputError, match="too short for this STFT window"):
        engine.get_spectrogram(wav, n_fft, hop, window)

    # The row's answers are no error: the samples are kept, and the reply says why it names no levels.
    command = {"cmd": "track-answers", "requestId": "r", "filePath": str(wav), "scale": "log"}
    reply = dispatch(validate_request(command), AnalysisService(engine))
    assert reply["noLevels"] == "too-short"
    assert all("signal" in channel and "image" not in channel for channel in reply["channels"])


def test_every_lazy_answer_names_the_file_version_and_one_asked_of_another_is_refused(tmp_path: Path) -> None:
    """A row's lazy answers (its kept answers, slice, pair) are of the version its track was analysed from: a
    file rewritten since is refused with stale-source, never answered from the new samples under the old picture."""
    from services.analysis_service import AnalysisService
    from services.backend_errors import STALE_SOURCE, StaleSourceError, error_payload
    from transport.command_dispatch import dispatch, validate_request

    wav = _write_tone(tmp_path / "a.wav")
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=50_000_000))
    pair_source = {"filePath": str(wav), "channelIndex": 0, "offsetSeconds": 0.0}
    commands = [
        {"cmd": "track-answers", "filePath": str(wav), "scale": "log"},
        {"cmd": "track-answers", "filePath": str(wav), "scale": "linear", "startNorm": 0.1, "endNorm": 0.2},
        {"cmd": "cursor-answers", "filePath": str(wav), "cursorNorm": 0.5},
    ]
    analysed = dispatch(validate_request({"cmd": "analyze", "requestId": "r", "filePath": str(wav)}), service)
    version = analysed["sourceVersion"]
    assert isinstance(version, str) and version
    for command in commands:
        reply = dispatch(validate_request({**command, "requestId": "r", "sourceVersion": version}), service)
        assert reply["sourceVersion"] == version, command["cmd"]
    pair = {"cmd": "pair-answers", "requestId": "r"}
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
    from services.analysis_service import AnalysisService
    from transport.command_dispatch import dispatch, validate_request

    wav = _write_tone(tmp_path / "a.wav", seconds=1.0)
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=50_000_000))
    small = {"nFft": 256, "overlapPercent": 50, "window": "hann"}
    large = {"nFft": 1024, "overlapPercent": 50, "window": "hann"}
    source = {"filePath": str(wav), "channelIndex": 0, "offsetSeconds": 0.0}

    def answers(stft: dict[str, object] | None) -> list[object]:
        options = {"stftOptions": stft} if stft else {}
        replies = [
            dispatch(validate_request({"cmd": "analyze", "requestId": "r", "filePath": str(wav), **options}), service),
            dispatch(
                validate_request({"cmd": "track-answers", "requestId": "r", "filePath": str(wav), **options}), service
            ),
            dispatch(
                validate_request(
                    {"cmd": "cursor-answers", "requestId": "r", "filePath": str(wav), "cursorNorm": 0.5, **options}
                ),
                service,
            ),
            dispatch(
                validate_request(
                    {
                        "cmd": "pair-answers",
                        "requestId": "r",
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


def test_a_rows_answers_read_their_stft_from_the_version_they_checked_a_file_written_in_between_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The row's STFT is of the version its first read checked: written between that read and the STFT's, the
    file is refused (stale-source), never answered from the new samples under the old version's name (V8)."""
    from services.analysis_service import AnalysisService
    from services.backend_errors import StaleSourceError
    from transport.command_dispatch import dispatch, validate_request

    wav = _write_tone(tmp_path / "a.wav")
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=50_000_000))
    analysed = dispatch(validate_request({"cmd": "analyze", "requestId": "r", "filePath": str(wav)}), service)
    version = analysed["sourceVersion"]
    original = service.engine.get_analysis
    calls = {"n": 0}

    def racing(*args: object, **kwargs: object) -> object:
        answer = original(*args, **kwargs)  # type: ignore[arg-type]
        calls["n"] += 1
        if calls["n"] == 1:
            _write_tone(wav, seconds=0.5)  # recorded again just after the row's answers checked their version
        return answer

    monkeypatch.setattr(service.engine, "get_analysis", racing)
    command = {"cmd": "track-answers", "requestId": "r", "filePath": str(wav), "sourceVersion": version}
    with pytest.raises(StaleSourceError):
        dispatch(validate_request(command), service)
