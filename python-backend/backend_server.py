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
from perf import _perf

if TYPE_CHECKING:
    from analysis_service import AnalysisService

_PROCESS_STARTED = time.perf_counter()
_STDOUT_LOCK = threading.Lock()
_HEARTBEAT_INTERVAL: float = 5.0


def _emit(message: dict[str, object]) -> None:
    line = json.dumps(message, ensure_ascii=False, allow_nan=False)
    with _STDOUT_LOCK:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


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
        _emit({"type": "heartbeat", "ts": time.time()})


def main(service: AnalysisService | None = None) -> None:
    _perf("startup_begin", _PROCESS_STARTED, pid=os.getpid(), python=sys.executable)
    active_service = service or _load_default_service()
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    _perf("startup_ready", _PROCESS_STARTED)
    _emit({"type": "ready"})
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
            _emit({**result, "requestId": request_id})
        except Exception as error:
            _emit({"requestId": request_id, "error": str(error)})


if __name__ == "__main__":
    main()
