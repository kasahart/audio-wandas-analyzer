"""The process's one budget, and the reservation made of it before anything is computed (第 5 節「予算」「同時実行
と予約」).

One number of bytes covers three things together: the answers kept (``kept``: what the answers' store holds now),
what the Figures hold of their pictures (the service says it with each reservation) and what the requests running
now may take while they compute (``reserved``). A draw reserves its estimate before it computes and gives it back
when it ends, so requests running side by side never add up to more than the budget:

- ``too-large``: the request is over the budget alone, or does not fit with nothing else running (it would not fit
  later either). The Figure says why and does not ask again;
- ``busy``: it does not fit beside the requests running now. The Figure waits a little and asks once more.

Before either is answered, room is made of the answers no Figure uses (``make_room``: the least recently used first).
This file holds no array and decides nothing of a picture (no numpy, rule A).
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Literal

Verdict = Literal["ok", "busy", "too-large"]


class Budget:
    def __init__(
        self,
        limit: int | Callable[[], int],
        kept: Callable[[], int] | None = None,
        make_room: Callable[[int, frozenset[str]], int] | None = None,
    ) -> None:
        """``limit``: the budget in bytes (or what answers it now: the browser's is smaller). ``kept``: the bytes of
        the answers kept now. ``make_room(bytes, in_use)``: lets go of that many bytes of kept answers whose key is
        not in ``in_use`` and answers how many it freed."""
        self._limit = limit
        self._kept = kept
        self._make_room = make_room
        self._reserved = 0
        self._lock = threading.Lock()

    @property
    def limit(self) -> int:
        return self._limit() if callable(self._limit) else self._limit

    def kept(self) -> int:
        return self._kept() if self._kept is not None else 0

    def reserved(self) -> int:
        with self._lock:
            return self._reserved

    def reserve(self, nbytes: int, held: int, in_use: frozenset[str]) -> Verdict:
        """Reserve ``nbytes`` for a request about to compute, beside ``held`` bytes of the Figures' holdings and the
        answers kept (those of ``in_use`` are never let go to make room). ``release`` gives them back."""
        with self._lock:
            limit = self.limit
            if nbytes > limit:
                return "too-large"
            over = self.kept() + held + self._reserved + nbytes - limit
            if over > 0 and self._make_room is not None:
                self._make_room(over, in_use)
                over = self.kept() + held + self._reserved + nbytes - limit
            if over > 0:
                return "busy" if self._reserved > 0 else "too-large"
            self._reserved += nbytes
            return "ok"

    def release(self, nbytes: int) -> None:
        with self._lock:
            self._reserved = max(0, self._reserved - nbytes)
