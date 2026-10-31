from __future__ import annotations

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
