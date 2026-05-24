"""Persistent Python backend server for the Audio Wandas Analyzer.

Newline-delimited JSON IPC over stdin/stdout. Prints {"type":"ready"} once
wandas is loaded, then reads commands forever.

Commands:
    {"cmd":"analyze","requestId":"...","filePath":"...","peakCount":5,
     "stftOptions":{"nFft":2048,"hopSize":96,"window":"hann"}}
    {"cmd":"range","requestId":"...","filePath":"...",
     "startNorm":0.2,"endNorm":0.4,"points":1600}

All responses include the originating requestId. Errors come back as
{"requestId":"...","error":"<message>"}.
"""

from __future__ import annotations

import base64
import io as _io
import json
import os
import sys
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import wandas as wd

from analyzer import _build_waveform_envelope, analyze_from_frame

_PERF_ENABLED = os.environ.get("AWA_PERF_LOG", "1") != "0"


def _perf(phase: str, started: float, **extra: object) -> None:
    if not _PERF_ENABLED:
        return
    ms = (time.perf_counter() - started) * 1000.0
    parts = [f"phase={phase}", f"ms={ms:.2f}"]
    parts.extend(f"{k}={v}" for k, v in extra.items())
    print("[perf] " + " ".join(parts), file=sys.stderr, flush=True)


_cache_limit_bytes = int(os.environ.get("AWA_CACHE_MB", "1024")) * 1024 * 1024


class CachedFile:
    __slots__ = ("frame",)

    def __init__(self, frame: wd.ChannelFrame) -> None:
        self.frame = frame

    def nbytes(self) -> int:
        return int(self.frame._data.nbytes)


_cache: OrderedDict[str, CachedFile] = OrderedDict()


def _get_cached(file_path: str) -> CachedFile:
    if file_path in _cache:
        _cache.move_to_end(file_path)
        return _cache[file_path]
    t = time.perf_counter()
    frame = wd.read_wav(file_path).persist()
    # Force materialization so subsequent .data accesses are cheap and nbytes is accurate.
    _ = frame.data
    _perf("cache_load", t, file=Path(file_path).name, bytes=int(frame._data.nbytes))
    entry = CachedFile(frame)
    _cache[file_path] = entry
    _evict()
    return entry


def _evict() -> None:
    while len(_cache) > 1 and sum(e.nbytes() for e in _cache.values()) > _cache_limit_bytes:
        path, _entry = _cache.popitem(last=False)
        _perf("cache_evict", time.perf_counter(), file=Path(path).name)


def _stft_options_from_payload(payload: dict) -> dict | None:
    raw = payload.get("stftOptions")
    if not raw:
        return None
    return {
        "n_fft": int(raw["nFft"]),
        "hop_size": int(raw["hopSize"]),
        "window": str(raw.get("window", "hann")),
    }


def handle_analyze(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    entry = _get_cached(file_path)
    return analyze_from_frame(
        entry.frame,
        file_path,
        peak_count=int(cmd.get("peakCount", 5)),
        stft_options=_stft_options_from_payload(cmd),
    )


def handle_range(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    start_norm = float(cmd["startNorm"])
    end_norm = float(cmd["endNorm"])
    point_count = int(cmd.get("points", 2000))

    entry = _get_cached(file_path)
    frame = entry.frame
    n_total = int(frame.n_samples)
    start_idx = max(0, int(start_norm * n_total))
    end_idx = min(n_total, int(end_norm * n_total))

    channels: list[dict] = []
    if end_idx > start_idx:
        data = np.asarray(frame.data)
        if data.ndim == 1:
            data = data.reshape(1, -1)
        for ch_data in data:
            channels.append(
                _build_waveform_envelope(
                    ch_data[start_idx:end_idx],
                    point_count,
                    start_sample=start_idx,
                    total_samples=n_total,
                )
            )

    return {"startNorm": start_norm, "endNorm": end_norm, "channels": channels}


def handle_export_wav_loop(cmd: dict) -> dict:
    """ループ区間を WAV として base64 エンコードして返す。"""
    import soundfile as sf

    file_path = str(cmd["filePath"])
    start_norm = float(cmd["startNorm"])
    end_norm = float(cmd["endNorm"])

    info = sf.info(file_path)
    sample_rate = info.samplerate
    start_sample = max(0, int(start_norm * info.frames))
    end_sample = min(info.frames, int(end_norm * info.frames))
    n_frames = max(0, end_sample - start_sample)

    with sf.SoundFile(file_path) as f:
        f.seek(start_sample)
        data = f.read(n_frames, dtype="float32", always_2d=True)

    buf = _io.BytesIO()
    sf.write(buf, data, sample_rate, format="WAV", subtype="PCM_16")
    wav_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return {"wavBase64": wav_b64, "sampleRate": sample_rate}


COMMANDS: dict[str, Callable[[dict], dict]] = {
    "analyze": handle_analyze,
    "range": handle_range,
    "export-wav-loop": handle_export_wav_loop,
}

_HEARTBEAT_INTERVAL: float = 5.0


def _heartbeat_loop() -> None:
    """5 秒ごとに heartbeat を stdout に書く（デーモンスレッドで起動）。"""
    while True:
        time.sleep(_HEARTBEAT_INTERVAL)
        print(json.dumps({"type": "heartbeat", "ts": time.time()}), flush=True)


def main() -> None:
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    print(json.dumps({"type": "ready"}), flush=True)
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id = ""
        try:
            cmd: dict[str, Any] = json.loads(line)
            request_id = str(cmd.get("requestId", ""))
            name = cmd.get("cmd")
            handler = COMMANDS.get(name)
            if handler is None:
                raise ValueError(f"unknown cmd: {name!r}")
            t = time.perf_counter()
            result = handler(cmd)
            _perf(f"cmd_{name}", t, file=Path(str(cmd.get("filePath", ""))).name)
            result["requestId"] = request_id
            print(json.dumps(result, ensure_ascii=False), flush=True)
        except Exception as exc:
            print(json.dumps({"requestId": request_id, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
