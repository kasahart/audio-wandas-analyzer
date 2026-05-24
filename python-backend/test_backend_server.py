from __future__ import annotations

import base64
import io
import json
import math
import os
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np
import pytest

from backend_server import handle_export_wav_loop

ROOT = Path(__file__).parent


def _write_sine_wav(path: Path, freq_hz: float = 440.0, seconds: float = 0.5, sr: int = 16000) -> None:
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * freq_hz * t) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())


class _ServerHandle:
    def __init__(self, proc: subprocess.Popen[str]) -> None:
        self.proc = proc
        self._next_id = 0

    def request(self, payload: dict, timeout: float = 30.0) -> dict:
        self._next_id += 1
        payload = {**payload, "requestId": f"r{self._next_id}"}
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                continue
            msg = json.loads(line)
            if msg.get("type") == "ready":
                continue
            if msg.get("requestId") == payload["requestId"]:
                return msg
        raise TimeoutError(f"no response for {payload['requestId']}")

    def close(self) -> None:
        try:
            if self.proc.stdin is not None:
                self.proc.stdin.close()
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


@pytest.fixture
def server() -> _ServerHandle:
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "backend_server.py")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**os.environ, "AWA_CACHE_MB": "64", "AWA_PERF_LOG": "0"},
    )
    assert proc.stdout is not None
    deadline = time.monotonic() + 30.0
    ready = False
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if not line:
            continue
        msg = json.loads(line)
        if msg.get("type") == "ready":
            ready = True
            break
    if not ready:
        proc.kill()
        raise TimeoutError("server did not become ready")
    handle = _ServerHandle(proc)
    yield handle
    handle.close()


def test_analyze_round_trip(server: _ServerHandle, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    resp = server.request({"cmd": "analyze", "filePath": str(wav), "peakCount": 3})
    assert "error" not in resp, resp
    assert resp["fileName"] == "tone.wav"
    assert resp["channelCount"] == 1
    assert len(resp["channels"]) == 1
    assert resp["channels"][0]["spectrogram"]["windowSize"] > 0


def test_range_round_trip(server: _ServerHandle, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    resp = server.request(
        {
            "cmd": "range",
            "filePath": str(wav),
            "startNorm": 0.2,
            "endNorm": 0.6,
            "points": 200,
        }
    )
    assert "error" not in resp, resp
    assert resp["startNorm"] == 0.2
    assert len(resp["channels"]) == 1


def test_unknown_cmd_returns_error(server: _ServerHandle) -> None:
    resp = server.request({"cmd": "nope"})
    assert "error" in resp and "nope" in resp["error"]


def test_analyze_then_range_share_cache(server: _ServerHandle, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    server.request({"cmd": "analyze", "filePath": str(wav), "peakCount": 3})
    t = time.perf_counter()
    server.request(
        {
            "cmd": "range",
            "filePath": str(wav),
            "startNorm": 0.0,
            "endNorm": 1.0,
            "points": 100,
        }
    )
    elapsed = time.perf_counter() - t
    assert elapsed < 1.0, f"range after analyze took {elapsed:.3f}s — cache likely not shared"


def test_heartbeat_loop_produces_heartbeat_json(monkeypatch: pytest.MonkeyPatch) -> None:
    """_heartbeat_loop sends valid heartbeat JSON."""
    import builtins
    import json as _json
    import time

    import backend_server

    original_sleep = time.sleep
    call_count = [0]

    def fast_sleep(s: float) -> None:
        call_count[0] += 1
        if call_count[0] > 2:
            raise SystemExit  # stop the loop
        original_sleep(0.001)

    monkeypatch.setattr(backend_server, "_HEARTBEAT_INTERVAL", 0.001)

    printed: list[object] = []
    monkeypatch.setattr(builtins, "print", lambda *args, **kwargs: printed.extend(args))
    monkeypatch.setattr(time, "sleep", fast_sleep)

    import contextlib

    with contextlib.suppress(SystemExit):
        backend_server._heartbeat_loop()

    assert len(printed) >= 1
    msg = _json.loads(str(printed[0]))
    assert msg["type"] == "heartbeat"
    assert "ts" in msg


def test_heartbeat_loop_emits_valid_json(monkeypatch):
    """_heartbeat_loop emits valid heartbeat JSON."""
    import builtins
    import contextlib
    import json as _json
    import time as _time

    import backend_server

    printed = []
    monkeypatch.setattr(builtins, "print", lambda *args, **kwargs: printed.extend(args))
    monkeypatch.setattr(backend_server, "_HEARTBEAT_INTERVAL", 0.001)

    call_count = [0]
    original_sleep = _time.sleep

    def fast_sleep(s: float) -> None:
        call_count[0] += 1
        if call_count[0] > 3:
            raise SystemExit
        original_sleep(0.001)

    monkeypatch.setattr(_time, "sleep", fast_sleep)

    with contextlib.suppress(SystemExit):
        backend_server._heartbeat_loop()

    assert len(printed) >= 2
    for line in printed:
        msg = _json.loads(line)
        assert msg["type"] == "heartbeat"
        assert "ts" in msg



def test_export_wav_loop(tmp_path: Path) -> None:
    """export-wav-loop returns valid base64 WAV for the loop region."""
    # Create a 2-second 440Hz sine wave WAV
    sr = 44100
    n = int(sr * 2.0)
    samples = [int(32767 * math.sin(2 * math.pi * 440 * i / sr)) for i in range(n)]
    with wave.open(str(tmp_path / "tone.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(struct.pack("<" + "h" * n, *samples))

    result = handle_export_wav_loop(
        {
            "filePath": str(tmp_path / "tone.wav"),
            "startNorm": 0.25,
            "endNorm": 0.75,
        }
    )
    assert "wavBase64" in result
    assert "sampleRate" in result
    raw = base64.b64decode(result["wavBase64"])
    with wave.open(io.BytesIO(raw)) as w:
        assert w.getnframes() > 0
        assert w.getframerate() == result["sampleRate"]


def test_export_wav_loop_zero_frames_raises(tmp_path: Path) -> None:
    """export-wav-loop raises ValueError when the loop region produces 0 frames."""
    sr = 16000
    n = int(sr * 0.5)
    samples = [int(32767 * math.sin(2 * math.pi * 440 * i / sr)) for i in range(n)]
    wav_path = tmp_path / "short.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(struct.pack("<" + "h" * n, *samples))

    import pytest as _pytest

    with _pytest.raises(ValueError, match="0 frames"):
        handle_export_wav_loop({"filePath": str(wav_path), "startNorm": 0.5, "endNorm": 0.3})


def test_lru_evicts_oldest_when_over_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import importlib

    import backend_server

    importlib.reload(backend_server)
    monkeypatch.setattr(backend_server, "_cache_limit_bytes", 8 * 1024)
    backend_server._cache.clear()

    paths: list[str] = []
    for i in range(4):
        p = tmp_path / f"t{i}.wav"
        _write_sine_wav(p, seconds=0.2, sr=16000)
        paths.append(str(p))
        backend_server._get_cached(paths[-1])

    assert paths[-1] in backend_server._cache
    assert paths[0] not in backend_server._cache
    total = sum(e.nbytes() for e in backend_server._cache.values())
    assert total <= backend_server._cache_limit_bytes or len(backend_server._cache) == 1
