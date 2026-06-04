"""Persistent Python backend server for the Audio Wandas Analyzer.

Newline-delimited JSON IPC over stdin/stdout. Prints {"type":"ready"} once
wandas is loaded, then reads commands forever.

Commands:
    {"cmd":"analyze","requestId":"...","filePath":"...","peakCount":5,
     "stftOptions":{"nFft":2048,"hopSize":96,"window":"hann"}}
    {"cmd":"range","requestId":"...","filePath":"...",
     "startNorm":0.2,"endNorm":0.4,"points":1600}
    {"cmd":"track-detail","requestId":"...","filePath":"...","trackIndex":0,
     "stftOptions":{"nFft":2048,"hopSize":96,"window":"hann"}}
    {"cmd":"spectrum-slice","requestId":"...","filePath":"...","trackIndex":0,
     "cursorNorm":0.5,"stftOptions":{"nFft":2048,"hopSize":96,"window":"hann"}}

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
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from scipy.signal import ShortTimeFFT, get_window

from analyzer import (
    SPECTROGRAM_FREQUENCY_BIN_LIMIT,
    _build_waveform_envelope,
    _resample_frequency_bins,
    _resolve_stft_params,
    analyze_from_frame,
    load_audio_frame,
)

_PERF_ENABLED = os.environ.get("AWA_PERF_LOG", "1") != "0"


def _perf(phase: str, started: float, **extra: object) -> None:
    if not _PERF_ENABLED:
        return
    ms = (time.perf_counter() - started) * 1000.0
    parts = [f"phase={phase}", f"ms={ms:.2f}"]
    parts.extend(f"{k}={v}" for k, v in extra.items())
    print("[perf] " + " ".join(parts), file=sys.stderr, flush=True)


_cache_limit_bytes = int(os.environ.get("AWA_CACHE_MB", "1024")) * 1024 * 1024


@dataclass(slots=True)
class CachedFile:
    sample_rate_hz: int
    sample_count: int
    channel_count: int
    duration_seconds: float

    def nbytes(self) -> int:
        return 128


_cache: OrderedDict[str, CachedFile] = OrderedDict()


def _get_cached(file_path: str) -> CachedFile:
    if file_path in _cache:
        _cache.move_to_end(file_path)
        return _cache[file_path]
    t = time.perf_counter()
    info = sf.info(file_path)
    entry = CachedFile(
        sample_rate_hz=int(info.samplerate),
        sample_count=int(info.frames),
        channel_count=int(info.channels),
        duration_seconds=float(info.duration),
    )
    _perf("cache_metadata", t, file=Path(file_path).name, frames=entry.sample_count, channels=entry.channel_count)
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
    frame, resolved_path = load_audio_frame(file_path)
    _get_cached(str(resolved_path))
    return analyze_from_frame(
        frame,
        resolved_path,
        peak_count=int(cmd.get("peakCount", 5)),
        stft_options=_stft_options_from_payload(cmd),
        include_spectrogram=False,
    )


def handle_track_detail(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    frame, resolved_path = load_audio_frame(file_path)
    _get_cached(str(resolved_path))
    result = analyze_from_frame(
        frame,
        resolved_path,
        peak_count=int(cmd.get("peakCount", 5)),
        stft_options=_stft_options_from_payload(cmd),
        include_spectrogram=True,
    )
    return {
        "trackIndex": int(cmd.get("trackIndex", -1)),
        "analysisId": cmd.get("analysisId"),
        "settingsSignature": cmd.get("settingsSignature"),
        "filePath": str(resolved_path),
        "channels": result["channels"],
    }


def _spectrum_slice_values(
    file_path: str,
    entry: CachedFile,
    cursor_norm: float,
    stft_options: dict | None,
) -> dict[str, object]:
    window_size, hop_size, window_name = _resolve_stft_params(entry.sample_count, stft_options)
    sft = ShortTimeFFT(
        win=get_window(window_name, window_size),
        hop=hop_size,
        fs=entry.sample_rate_hz,
        mfft=window_size,
        scale_to="magnitude",
    )
    time_bins = int(sft.p_num(entry.sample_count))
    if time_bins <= 0:
        raise ValueError("no spectrogram available for spectrum slice")

    clipped_norm = max(0.0, min(1.0, cursor_norm))
    time_index = int(np.floor(clipped_norm * time_bins))
    if time_index >= time_bins:
        time_index = time_bins - 1

    center_sample = time_index * hop_size
    start_sample = center_sample - window_size // 2
    read_start = max(0, start_sample)
    read_stop = min(entry.sample_count, max(read_start, start_sample + window_size))
    frame, _resolved_path = load_audio_frame(file_path)
    sliced_frame = frame[0, read_start:read_stop]
    spectrum = sliced_frame.fft(n_fft=window_size, window=window_name)
    values = np.asarray(spectrum.dB, dtype=np.float64)
    if values.ndim == 2:
        values = values[0]
    values_2d = _resample_frequency_bins(values.reshape(1, -1), SPECTROGRAM_FREQUENCY_BIN_LIMIT)
    row = values_2d[0]
    return {
        "values": row.tolist(),
        "frequencyBins": int(row.shape[0]),
        "maxFrequencyHz": float(entry.sample_rate_hz / 2),
        "minDb": float(np.min(row)),
        "maxDb": float(np.max(row)),
    }


def handle_spectrum_slice(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    entry = _get_cached(file_path)
    cursor_norm = float(cmd.get("cursorNorm", cmd.get("trackLocalNorm", 0.0)))
    slice_data = _spectrum_slice_values(file_path, entry, cursor_norm, _stft_options_from_payload(cmd))
    return {
        "trackIndex": int(cmd.get("trackIndex", -1)),
        "analysisId": cmd.get("analysisId"),
        "settingsSignature": cmd.get("settingsSignature"),
        "filePath": file_path,
        **slice_data,
    }


def handle_range(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    start_norm = float(cmd["startNorm"])
    end_norm = float(cmd["endNorm"])
    point_count = int(cmd.get("points", 2000))

    entry = _get_cached(file_path)
    n_total = entry.sample_count
    start_idx = max(0, int(start_norm * n_total))
    end_idx = min(n_total, int(end_norm * n_total))

    channels: list[dict] = []
    if end_idx > start_idx:
        with sf.SoundFile(file_path) as f:
            f.seek(start_idx)
            data = f.read(end_idx - start_idx, dtype="float64", always_2d=True)
        for ch_idx in range(data.shape[1]):
            channels.append(
                _build_waveform_envelope(
                    data[:, ch_idx],
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
    n_frames = end_sample - start_sample

    if n_frames <= 0:
        raise ValueError(
            f"Loop region produces 0 frames (startNorm={start_norm}, endNorm={end_norm}, "
            f"total_frames={info.frames}). Ensure startNorm < endNorm and the file is not empty."
        )

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
    "track-detail": handle_track_detail,
    "spectrum-slice": handle_spectrum_slice,
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
