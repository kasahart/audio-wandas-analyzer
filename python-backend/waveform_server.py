"""Persistent waveform range server.

Communicates via newline-delimited JSON on stdin/stdout.
Prints {"type":"ready"} once wandas is loaded, then reads commands forever.

Command format:
    {"cmd":"range","requestId":"...","filePath":"...","startNorm":0.2,"endNorm":0.4,"points":1600}

Response format:
    {"requestId":"...","startNorm":0.2,"endNorm":0.4,"channels":[...]}
    {"requestId":"...","error":"message"}  # on failure
"""

from __future__ import annotations

import json
import sys

import numpy as np
import wandas as wd

from analyzer import _build_waveform_envelope, _channels_first

# file_path -> (channel_data ndarray, n_samples)
_file_cache: dict[str, tuple[np.ndarray, int]] = {}


def _load_file(file_path: str) -> tuple[np.ndarray, int]:
    if file_path not in _file_cache:
        signal = wd.read_wav(file_path)
        channel_count = int(signal.n_channels)
        n_total = int(signal.n_samples)
        data = _channels_first(np.asarray(signal.data), channel_count, n_total)
        _file_cache[file_path] = (data, n_total)
    return _file_cache[file_path]


def handle_range(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    start_norm = float(cmd["startNorm"])
    end_norm = float(cmd["endNorm"])
    point_count = int(cmd.get("points", 2000))

    data, n_total = _load_file(file_path)
    start_idx = max(0, int(start_norm * n_total))
    end_idx = min(n_total, int(end_norm * n_total))

    channels: list[dict] = []
    if end_idx > start_idx:
        for ch_data in data:
            channels.append(
                _build_waveform_envelope(
                    ch_data[start_idx:end_idx],
                    point_count,
                    start_sample=start_idx,
                    total_samples=n_total,
                )
            )

    return {
        "requestId": cmd["requestId"],
        "startNorm": start_norm,
        "endNorm": end_norm,
        "channels": channels,
    }


def main() -> None:
    # Signal that wandas is fully loaded and server is ready
    print(json.dumps({"type": "ready"}), flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id = ""
        try:
            cmd = json.loads(line)
            request_id = str(cmd.get("requestId", ""))
            if cmd.get("cmd") == "range":
                result = handle_range(cmd)
                print(json.dumps(result), flush=True)
        except Exception as exc:
            print(json.dumps({"requestId": request_id, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
