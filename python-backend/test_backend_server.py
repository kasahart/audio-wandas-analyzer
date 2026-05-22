from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np
import pytest

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
