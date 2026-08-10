"""Persistent newline-delimited JSON backend for Audio Wandas Analyzer."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService

_PERF_ENABLED = os.environ.get("AWA_PERF_LOG", "1") != "0"
_HEARTBEAT_INTERVAL: float = 5.0

Command = dict[str, Any]
CommandHandler = Callable[[AnalysisService, Command], dict[str, object]]


def _perf(phase: str, started: float, **extra: object) -> None:
    if not _PERF_ENABLED:
        return
    ms = (time.perf_counter() - started) * 1000.0
    parts = [f"phase={phase}", f"ms={ms:.2f}"]
    parts.extend(f"{key}={value}" for key, value in extra.items())
    print("[perf] " + " ".join(parts), file=sys.stderr, flush=True)


def _stft_options(command: Command) -> Mapping[str, object] | None:
    raw = command.get("stftOptions")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("stftOptions must be an object")
    return raw


def handle_analyze(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.analyze(
        str(command["filePath"]),
        peak_count=int(command.get("peakCount", 5)),
        stft_options=_stft_options(command),
    )


def handle_track_detail(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.track_detail(
        str(command["filePath"]),
        track_index=int(command.get("trackIndex", -1)),
        analysis_id=command.get("analysisId"),
        settings_signature=command.get("settingsSignature"),
        peak_count=int(command.get("peakCount", 5)),
        stft_options=_stft_options(command),
    )


def handle_spectrum_slice(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.spectrum_slice(
        str(command["filePath"]),
        cursor_norm=float(command.get("cursorNorm", command.get("trackLocalNorm", 0.0))),
        track_index=int(command.get("trackIndex", -1)),
        channel_index=int(command.get("channelIndex", 0)),
        analysis_id=command.get("analysisId"),
        settings_signature=command.get("settingsSignature"),
        stft_options=_stft_options(command),
    )


def handle_range(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.waveform_range(
        str(command["filePath"]),
        start_norm=float(command["startNorm"]),
        end_norm=float(command["endNorm"]),
        point_count=int(command.get("points", 2000)),
    )


def handle_export_wav_loop(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.export_wav_loop(
        str(command["filePath"]),
        start_norm=float(command["startNorm"]),
        end_norm=float(command["endNorm"]),
    )


def handle_release_track_detail(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.release_track_detail(str(command["filePath"]))


COMMANDS: dict[str, CommandHandler] = {
    "analyze": handle_analyze,
    "range": handle_range,
    "track-detail": handle_track_detail,
    "release-track-detail": handle_release_track_detail,
    "spectrum-slice": handle_spectrum_slice,
    "export-wav-loop": handle_export_wav_loop,
}


def dispatch(command: Command, service: AnalysisService) -> dict[str, object]:
    name = command.get("cmd")
    handler = COMMANDS.get(name)
    if handler is None:
        raise ValueError(f"unknown cmd: {name!r}")
    return handler(service, command)


def _heartbeat_loop() -> None:
    while True:
        time.sleep(_HEARTBEAT_INTERVAL)
        print(json.dumps({"type": "heartbeat", "ts": time.time()}), flush=True)


def main(service: AnalysisService | None = None) -> None:
    active_service = service or AnalysisService(AnalysisEngine())
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    print(json.dumps({"type": "ready"}), flush=True)
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id = ""
        try:
            command: Command = json.loads(line)
            request_id = str(command.get("requestId", ""))
            started = time.perf_counter()
            result = dispatch(command, active_service)
            name = command.get("cmd")
            _perf(f"cmd_{name}", started, file=Path(str(command.get("filePath", ""))).name)
            print(json.dumps({**result, "requestId": request_id}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({"requestId": request_id, "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
