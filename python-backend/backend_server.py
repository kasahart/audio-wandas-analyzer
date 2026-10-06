"""Persistent newline-delimited JSON backend for Audio Wandas Analyzer."""

from __future__ import annotations

import importlib
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING

from command_dispatch import dispatch, validate_request

if TYPE_CHECKING:
    from analysis_service import AnalysisService

_PROCESS_STARTED = time.perf_counter()
_PERF_ENABLED = os.environ.get("AWA_PERF_LOG", "1") != "0"
_HEARTBEAT_INTERVAL: float = 5.0


def _perf(phase: str, started: float, **extra: object) -> None:
    if not _PERF_ENABLED:
        return
    ms = (time.perf_counter() - started) * 1000.0
    parts = [f"phase={phase}", f"ms={ms:.2f}"]
    parts.extend(f"{key}={value}" for key, value in extra.items())
    print("[perf] " + " ".join(parts), file=sys.stderr, flush=True)


def _load_default_service() -> AnalysisService:
    started = time.perf_counter()
    analysis_engine = importlib.import_module("analysis_engine")
    _perf("startup_import_analysis_engine", started)

    started = time.perf_counter()
    analysis_service = importlib.import_module("analysis_service")
    _perf("startup_import_analysis_service", started)

    started = time.perf_counter()
    service = analysis_service.AnalysisService(analysis_engine.AnalysisEngine())
    _perf("startup_create_service", started)
    return service


def _heartbeat_loop() -> None:
    while True:
        time.sleep(_HEARTBEAT_INTERVAL)
        print(json.dumps({"type": "heartbeat", "ts": time.time()}), flush=True)


def main(service: AnalysisService | None = None) -> None:
    _perf("startup_begin", _PROCESS_STARTED, pid=os.getpid(), python=sys.executable)
    active_service = service or _load_default_service()
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    _perf("startup_ready", _PROCESS_STARTED)
    print(json.dumps({"type": "ready"}), flush=True)
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id = ""
        try:
            parsed: object = json.loads(line)
            if isinstance(parsed, dict) and isinstance(parsed.get("requestId"), str):
                request_id = parsed["requestId"]
            command = validate_request(parsed)
            started = time.perf_counter()
            result = dispatch(command, active_service)
            name = command.get("cmd")
            _perf(f"cmd_{name}", started, file=Path(str(command.get("filePath", ""))).name)
            print(json.dumps({**result, "requestId": request_id}, ensure_ascii=False, allow_nan=False), flush=True)
        except Exception as error:
            print(json.dumps({"requestId": request_id, "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
