from __future__ import annotations

import os
import sys
import time

_PERF_ENABLED = os.environ.get("AWA_PERF_LOG", "1") != "0"


def _perf(phase: str, started: float, **extra: object) -> None:
    if not _PERF_ENABLED:
        return
    ms = (time.perf_counter() - started) * 1000.0
    parts = [f"phase={phase}", f"ms={ms:.2f}"]
    parts.extend(f"{key}={value}" for key, value in extra.items())
    print("[perf] " + " ".join(parts), file=sys.stderr, flush=True)
