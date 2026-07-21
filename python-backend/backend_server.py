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
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import wandas as wd

from analysis_engine import AnalysisEngine
from analyzer import (
    DB_UNIT,
    SPECTROGRAM_FREQUENCY_BIN_LIMIT,
    SPECTRUM_LEVEL_AXIS_LABEL,
    _resample_frequency_bins,
    _resolve_stft_params,
    analyze_audio,
    analyze_track_detail,
)
from range_analyzer import analyze_range

_PERF_ENABLED = os.environ.get("AWA_PERF_LOG", "1") != "0"


def _perf(phase: str, started: float, **extra: object) -> None:
    if not _PERF_ENABLED:
        return
    ms = (time.perf_counter() - started) * 1000.0
    parts = [f"phase={phase}", f"ms={ms:.2f}"]
    parts.extend(f"{k}={v}" for k, v in extra.items())
    print("[perf] " + " ".join(parts), file=sys.stderr, flush=True)


_engine = AnalysisEngine()


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
    return analyze_audio(str(cmd["filePath"]), peak_count=int(cmd.get("peakCount", 5)))


def handle_track_detail(cmd: dict) -> dict:
    stft_options = _stft_options_from_payload(cmd)
    result = analyze_track_detail(str(cmd["filePath"]), stft_options=stft_options)
    return {
        "trackIndex": int(cmd.get("trackIndex", -1)),
        "analysisId": cmd.get("analysisId"),
        "settingsSignature": cmd.get("settingsSignature"),
        "filePath": result["filePath"],
        "channels": result["channels"],
    }


def _spectrum_slice_values(
    file_path: str | Path,
    cursor_norm: float,
    channel_index: int,
    stft_options: dict | None,
) -> dict[str, object]:
    clipped_norm = max(0.0, min(1.0, cursor_norm))
    target = Path(file_path).expanduser().resolve()
    with sf.SoundFile(target) as audio_file:
        sample_count = len(audio_file)
        channel_count = audio_file.channels
        sample_rate = audio_file.samplerate
    if channel_index < 0 or channel_index >= channel_count:
        raise ValueError(f"channelIndex out of range: {channel_index}")
    window_size, _hop_size, window_name = _resolve_stft_params(sample_count, stft_options)
    center_sample = min(int(clipped_norm * sample_count), sample_count - 1)
    start_sample = max(0, center_sample - window_size // 2)
    end_sample = min(sample_count, start_sample + window_size)
    start_sample = max(0, end_sample - window_size)
    frame = wd.read(
        target,
        channel=channel_index,
        start=start_sample / sample_rate,
        end=end_sample / sample_rate,
    )
    spectrum = frame.fft(n_fft=window_size, window=window_name)
    max_frequency_hz = float(spectrum.freqs[-1])
    values = np.asarray(spectrum.dB, dtype=np.float64)
    if values.ndim == 2:
        values = values[0]
    values_2d = _resample_frequency_bins(values.reshape(1, -1), SPECTROGRAM_FREQUENCY_BIN_LIMIT)
    row = values_2d[0]
    return {
        "values": row.tolist(),
        "frequencyBins": int(row.shape[0]),
        "maxFrequencyHz": max_frequency_hz,
        "minDb": float(np.min(row)),
        "maxDb": float(np.max(row)),
        "unit": DB_UNIT,
        "axisLabel": SPECTRUM_LEVEL_AXIS_LABEL,
    }


def handle_spectrum_slice(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    cursor_norm = float(cmd.get("cursorNorm", cmd.get("trackLocalNorm", 0.0)))
    channel_index = int(cmd.get("channelIndex", 0))
    slice_data = _spectrum_slice_values(file_path, cursor_norm, channel_index, _stft_options_from_payload(cmd))
    return {
        "trackIndex": int(cmd.get("trackIndex", -1)),
        "channelIndex": channel_index,
        "analysisId": cmd.get("analysisId"),
        "settingsSignature": cmd.get("settingsSignature"),
        "filePath": str(Path(file_path).expanduser().resolve()),
        **slice_data,
    }


def handle_range(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    start_norm = float(cmd["startNorm"])
    end_norm = float(cmd["endNorm"])
    point_count = int(cmd.get("points", 2000))

    return analyze_range(file_path, start_norm, end_norm, point_count)


def handle_export_wav_loop(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    start_norm = float(cmd["startNorm"])
    end_norm = float(cmd["endNorm"])

    target = Path(file_path).expanduser().resolve()
    with sf.SoundFile(target) as audio_file:
        sample_rate = audio_file.samplerate
        sample_count = len(audio_file)
    start_sample = max(0, int(start_norm * sample_count))
    end_sample = min(sample_count, int(end_norm * sample_count))
    n_frames = end_sample - start_sample

    if n_frames <= 0:
        raise ValueError(
            f"Loop region produces 0 frames (startNorm={start_norm}, endNorm={end_norm}, "
            f"total_frames={sample_count}). Ensure startNorm < endNorm and the file is not empty."
        )

    with sf.SoundFile(target) as audio_file:
        audio_file.seek(start_sample)
        data = audio_file.read(n_frames, dtype="float32", always_2d=True)

    buf = _io.BytesIO()
    sf.write(buf, data, sample_rate, format="WAV", subtype="PCM_16")
    wav_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return {"wavBase64": wav_b64, "sampleRate": sample_rate}


def handle_release_track_detail(cmd: dict) -> dict:
    _engine.discard_spectrograms(str(cmd["filePath"]))
    return {}


COMMANDS: dict[str, Callable[[dict], dict]] = {
    "analyze": handle_analyze,
    "range": handle_range,
    "track-detail": handle_track_detail,
    "release-track-detail": handle_release_track_detail,
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
