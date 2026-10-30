"""Persistent newline-delimited JSON backend for Audio Wandas Analyzer."""

from __future__ import annotations

import importlib
import json
import os
import sys
import threading
import time
from collections import deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TYPE_CHECKING

from backend_errors import InputError, error_payload
from command_dispatch import Command, dispatch, validate_request
from perf import perf_log

if TYPE_CHECKING:
    from analysis_service import AnalysisService

_PROCESS_STARTED = time.perf_counter()
_STDOUT_LOCK = threading.Lock()
_HEARTBEAT_INTERVAL: float = 5.0


def _emit(message: dict[str, object], *, ensure_ascii: bool = False) -> None:
    line = json.dumps(message, ensure_ascii=ensure_ascii, allow_nan=False)
    with _STDOUT_LOCK:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def _load_default_service() -> AnalysisService:
    started = time.perf_counter()
    analysis_engine = importlib.import_module("analysis_engine")
    perf_log("startup_import_analysis_engine", started)

    started = time.perf_counter()
    analysis_service = importlib.import_module("analysis_service")
    perf_log("startup_import_analysis_service", started)

    started = time.perf_counter()
    service = analysis_service.AnalysisService(analysis_engine.AnalysisEngine())
    perf_log("startup_create_service", started)
    return service


def _heartbeat_loop() -> None:
    while True:
        time.sleep(_HEARTBEAT_INTERVAL)
        _emit({"type": "heartbeat", "ts": time.time()})


def _start_heartbeat() -> None:
    threading.Thread(target=_heartbeat_loop, daemon=True).start()


def _worker_count() -> int:
    configured = os.environ.get("AWA_BACKEND_WORKERS", "")
    if configured.isdigit() and int(configured) > 0:
        return int(configured)
    # One core is left for the extension host and the webview.
    return max(1, min(4, (os.cpu_count() or 2) - 1))


class _Lanes:
    """Runs requests for different files at once and the requests for one file in the order they came."""

    def __init__(self, workers: int) -> None:
        self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="awa-request")
        self._lock = threading.Lock()
        self._queued: dict[str, deque[Callable[[], None]]] = {}

    def submit(self, lane: str, job: Callable[[], None]) -> None:
        with self._lock:
            queued = self._queued.get(lane)
            if queued is not None:
                queued.append(job)
                return
            self._queued[lane] = deque()
        self._executor.submit(self._drain, lane, job)

    def _drain(self, lane: str, job: Callable[[], None]) -> None:
        while True:
            job()
            with self._lock:
                queued = self._queued[lane]
                if not queued:
                    del self._queued[lane]
                    return
                job = queued.popleft()

    def close(self) -> None:
        self._executor.shutdown(wait=True)


def _run(command: Command, request_id: str, service: AnalysisService) -> None:
    try:
        started = time.perf_counter()
        result = dispatch(command, service)
        name = command.get("cmd")
        perf_log(f"cmd_{name}", started, file=Path(str(command.get("filePath", ""))).name)
        _emit({**result, "requestId": request_id})
    except Exception as error:
        _emit({"requestId": request_id, "error": error_payload(error)}, ensure_ascii=True)


def main(service: AnalysisService | None = None, workers: int | None = None) -> None:
    perf_log("startup_begin", _PROCESS_STARTED, pid=os.getpid(), python=sys.executable)
    active_service = service or _load_default_service()
    _start_heartbeat()
    lanes = _Lanes(workers or _worker_count())
    perf_log("startup_ready", _PROCESS_STARTED)
    _emit({"type": "ready"})
    try:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            request_id = ""
            try:
                try:
                    parsed: object = json.loads(line)
                except json.JSONDecodeError as error:
                    raise InputError(f"request is not valid JSON: {error}") from error
                if isinstance(parsed, dict) and isinstance(parsed.get("requestId"), str):
                    request_id = parsed["requestId"]
                command = validate_request(parsed)
            except Exception as error:
                _emit({"requestId": request_id, "error": error_payload(error)}, ensure_ascii=True)
                continue
            # A request without a file (a Recipe build, a pair of files) keeps to one lane of its own.
            lane = str(command.get("filePath", ""))
            lanes.submit(lane, lambda command=command, request_id=request_id: _run(command, request_id, active_service))
    finally:
        lanes.close()


if __name__ == "__main__":
    main()
