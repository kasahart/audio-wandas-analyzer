"""Persistent newline-delimited JSON backend for Audio Wandas Analyzer."""

from __future__ import annotations

import importlib
import json
import os
import sys
import threading
import time
import traceback
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import TYPE_CHECKING

from backend_errors import InputError, error_payload
from command_dispatch import Command, dispatch, validate_request
from perf import perf_log
from protocol_schema import DEFINITIONS, first_violation

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


class _Job:
    __slots__ = ("barrier", "cancelled", "interactive", "lanes", "request_id", "run", "started")

    def __init__(
        self,
        request_id: str,
        lanes: frozenset[str],
        run: Callable[[_Job], None],
        barrier: bool,
        interactive: bool,
    ) -> None:
        self.request_id = request_id
        self.lanes = lanes
        self.run = run
        self.barrier = barrier
        self.interactive = interactive
        self.started = False
        self.cancelled = False


class _Lanes:
    """Runs requests at once, except that a state-changing request keeps its place among those for its files.

    A barrier waits for every earlier request on its files, and every later request on them waits for it.
    Interactive requests are started before the other ready ones, so a cursor never queues behind a long STFT.
    A request that reads several files holds the lane of each.
    """

    def __init__(self, workers: int) -> None:
        self._changed = threading.Condition(threading.Lock())
        self._jobs: list[_Job] = []
        self._closing = False
        for index in range(workers):
            threading.Thread(target=self._work, name=f"awa-request-{index}", daemon=True).start()

    def submit(
        self,
        request_id: str,
        lanes: frozenset[str],
        run: Callable[[_Job], None],
        *,
        barrier: bool = False,
        interactive: bool = False,
    ) -> None:
        with self._changed:
            self._jobs.append(_Job(request_id, lanes, run, barrier, interactive))
            self._changed.notify_all()

    def cancel(self, request_ids: Iterable[str]) -> None:
        """Drops the queued requests among ``request_ids``; a running one finishes without a reply."""
        wanted = set(request_ids)
        with self._changed:
            for job in self._jobs:
                job.cancelled = job.cancelled or job.request_id in wanted
            self._jobs = [job for job in self._jobs if job.started or not job.cancelled]
            self._changed.notify_all()

    def _ready(self, index: int) -> bool:
        job = self._jobs[index]
        return not job.started and not any(
            (earlier.barrier or job.barrier) and not earlier.lanes.isdisjoint(job.lanes)
            for earlier in self._jobs[:index]
        )

    def _take(self) -> _Job | None:
        ready = [job for index, job in enumerate(self._jobs) if self._ready(index)]
        job = next((job for job in ready if job.interactive), ready[0] if ready else None)
        if job is not None:
            job.started = True
        return job

    def _work(self) -> None:
        while True:
            with self._changed:
                while (job := self._take()) is None:
                    if self._closing:
                        return
                    self._changed.wait()
            try:
                job.run(job)
            except Exception:  # noqa: BLE001 - one broken request must not take a worker with it.
                traceback.print_exc(file=sys.stderr)
            finally:
                with self._changed:
                    self._jobs.remove(job)
                    self._changed.notify_all()

    def close(self, *, drain: bool) -> None:
        """Stops the workers once idle; ``drain`` answers the queued requests first instead of dropping them."""
        with self._changed:
            self._closing = True
            if not drain:
                self._jobs = [job for job in self._jobs if job.started]
            self._changed.notify_all()
            while drain and self._jobs:
                self._changed.wait()


# These change what later requests for their files see: dropping a track's STFT, or a file a scan opened.
_BARRIER_COMMANDS = frozenset({"release-track-detail", "scan"})
_INTERACTIVE_COMMANDS = frozenset({"range", "spectrum-slice"})


def _lane(path: str) -> str:
    # The engine caches by resolved path, so two spellings of one file must share a lane.
    return str(Path(path).expanduser().resolve())


def _lanes_of(command: Command) -> frozenset[str]:
    """The files a request reads; one shared lane for a request without any."""
    paths: list[str] = []
    sources = [command, command.get("reference"), *(command.get("responses") or [])]
    for source in sources:
        if isinstance(source, dict) and isinstance(source.get("filePath"), str):
            paths.append(source["filePath"])
    inputs = command.get("inputs")
    if isinstance(inputs, dict):
        paths.extend(path for path in inputs.values() if isinstance(path, str))
    return frozenset(_lane(path) for path in paths) or frozenset({""})


def _run(command: Command, job: _Job, service: AnalysisService) -> None:
    # The host has given up on a cancelled request; its reply would only be an orphan there.
    try:
        started = time.perf_counter()
        result = dispatch(command, service)
        name = command.get("cmd")
        perf_log(f"cmd_{name}", started, file=Path(str(command.get("filePath", ""))).name)
        if not job.cancelled:
            _emit({**result, "requestId": job.request_id})
    except Exception as error:
        if not job.cancelled:
            _emit({"requestId": job.request_id, "error": error_payload(error)}, ensure_ascii=True)


def _cancelled_ids(parsed: dict[str, object]) -> list[str]:
    violation = first_violation(DEFINITIONS["BackendCancelControl"], parsed)
    if violation is not None:
        raise InputError(f"invalid cancel control field {violation!r}")
    return [str(request_id) for request_id in parsed["requestIds"]]  # type: ignore[union-attr]


def main(service: AnalysisService | None = None, workers: int | None = None, *, drain: bool = False) -> None:
    """Serves stdin until EOF; the host is gone then, so queued requests are dropped unless ``drain``."""
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
                if isinstance(parsed, dict) and parsed.get("cmd") == "cancel":
                    lanes.cancel(_cancelled_ids(parsed))
                    continue
                if isinstance(parsed, dict) and isinstance(parsed.get("requestId"), str):
                    request_id = parsed["requestId"]
                command = validate_request(parsed)
                request_lanes = _lanes_of(command)
            except Exception as error:
                _emit({"requestId": request_id, "error": error_payload(error)}, ensure_ascii=True)
                continue
            lanes.submit(
                request_id,
                request_lanes,
                lambda job, command=command: _run(command, job, active_service),
                barrier=command["cmd"] in _BARRIER_COMMANDS,
                interactive=command["cmd"] in _INTERACTIVE_COMMANDS,
            )
    finally:
        lanes.close(drain=drain)


if __name__ == "__main__":
    # The extension speaks UTF-8; the locale encoding (cp932 on Japanese Windows) would garble non-ASCII paths.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    main()
