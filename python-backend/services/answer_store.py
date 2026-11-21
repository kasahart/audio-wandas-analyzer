"""The one holder of the answers kept in the process (第 5 節「答えの保持」「データの量」).

Three things are kept, each by key:

- ``STORE``: each recording's step at full resolution (stage_combine.StageData: what a scan computed), the least
  recently used let go first beyond its budget. The figure service reads it (transport/figure_answers.py).
- ``EXTENTS``: each recording's extents (the least and the most of its samples and of its levels), a few hundred
  bytes a channel, under a small budget of their own.
- ``COLUMNS``: the number columns of the user's table that the webview handed (a distribution draws them as they
  are), the oldest let go first beyond their own small budget.

The process's one budget (figures/budget.py, made in transport/figure_answers.py) counts what both keep
(``nbytes``) and asks ``STORE.make_room`` for room before it refuses a draw. This file knows no Frame and no
figure: it holds whatever has ``nbytes``.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Generic, Protocol, TypeVar

import numpy as np

#: What the kept steps may take together (a recording's 30 minutes at 48 kHz are 659 MiB of samples; the browser's
#: is set smaller: browser_service.py).
STAGE_DATA_BUDGET_BYTES = 768 * 1024 * 1024

#: What the kept table columns may take together. A column of 100,000 rows is under 4 MiB with its rows' keys.
COLUMNS_BUDGET_BYTES = 32 * 1024 * 1024


class _Sized(Protocol):
    @property
    def nbytes(self) -> int: ...


Kept = TypeVar("Kept", bound=_Sized)


class AnswerStore(Generic[Kept]):
    """The kept answers by key, least recently used dropped first beyond the budget. Shared by the workers."""

    def __init__(self, budget: int) -> None:
        self._budget = budget
        self._items: OrderedDict[str, Kept] = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    def resize(self, budget: int) -> None:
        with self._lock:
            self._budget = budget
            while self._bytes > self._budget and self._items:
                _, dropped = self._items.popitem(last=False)
                self._bytes -= dropped.nbytes

    def put(self, key: str, data: Kept) -> None:
        with self._lock:
            if key in self._items:
                self._items.move_to_end(key)
                return
            if data.nbytes > self._budget:
                return
            self._items[key] = data
            self._bytes += data.nbytes
            while self._bytes > self._budget:
                _, dropped = self._items.popitem(last=False)
                self._bytes -= dropped.nbytes

    @property
    def budget(self) -> int:
        return self._budget

    def nbytes(self) -> int:
        """The bytes kept now (what the process's one budget counts of the answers: figures/budget.py)."""
        with self._lock:
            return self._bytes

    def make_room(self, nbytes: int, in_use: frozenset[str]) -> int:
        """Let go of at least ``nbytes`` of what is kept, the least recently used first, never a key of ``in_use``
        (the answers a Figure's picture is of); answers how many bytes it freed."""
        freed = 0
        with self._lock:
            for key in list(self._items):
                if freed >= nbytes:
                    break
                if key in in_use:
                    continue
                freed += self._items.pop(key).nbytes
            self._bytes -= freed
        return freed

    def get(self, key: str) -> Kept | None:
        with self._lock:
            data = self._items.get(key)
            if data is not None:
                self._items.move_to_end(key)
            return data

    def has(self, key: str) -> bool:
        with self._lock:
            return key in self._items

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._bytes = 0


#: Every recording's kept step (stage_combine.StageData; typed there, where the class is).
STORE: AnswerStore[Any] = AnswerStore(STAGE_DATA_BUDGET_BYTES)

#: What the kept extents may take together: a few hundred bytes a channel, so thousands of channels' are kept.
EXTENTS_BUDGET_BYTES = 4 * 1024 * 1024

#: Each recording's extents (tracks_answers.py: a channel's lowest and highest sample, its STFT's lowest and highest
#: level), which the Tracks rows' linked scales are decided from. Kept apart from ``STORE`` so that a recording's
#: samples and levels, hundreds of MiB, never take their place: the scale all the rows share counts every recording,
#: also those whose own answers were let go.
EXTENTS: AnswerStore[Any] = AnswerStore(EXTENTS_BUDGET_BYTES)


@dataclass(frozen=True)
class TableColumn:
    """One number column of the user's table as it was handed: a value per table row (NaN where the row is blank),
    in the table's order, under a versioned key."""

    key: str
    version: str
    rows: tuple[str, ...]
    values: np.ndarray
    nbytes: int


class Columns:
    """The table's number columns the webview handed, by key (第 5 節: a CSV column is named by a versioned key and
    its values are handed once, before the figure that draws it). A draw, export or count request may carry the
    columns its spec names (``columns``); they are kept here, and a later request names them by key alone. A
    column no longer kept is answered as none: the figure counts it ``evicted`` and the webview hands it again.

    Kept within ``budget`` bytes together, the oldest handed let go first; a column over the budget alone is not
    kept (the figure says it has no such answer)."""

    def __init__(self, budget: int = COLUMNS_BUDGET_BYTES) -> None:
        self._budget = budget
        self._lock = threading.Lock()
        self._kept: OrderedDict[str, TableColumn] = OrderedDict()

    def keep(self, raw: object) -> None:
        """Keep the columns a request carries (``raw``: its ``columns``, or none)."""
        for item in raw if isinstance(raw, list) else []:
            handed: Mapping[str, Any] = item
            key = str(handed["key"])
            values = np.array([np.nan if value is None else float(value) for value in handed["values"]])
            rows = tuple(str(row) for row in handed["rows"])
            if len(rows) != values.size:
                raise ValueError(f"column {key!r}: {len(rows)} rows and {values.size} values")
            column = TableColumn(
                key=key,
                version=str(handed["version"]),
                rows=rows,
                values=values,
                nbytes=int(values.nbytes) + sum(len(row) for row in rows),
            )
            with self._lock:
                self._kept.pop(key, None)
                if column.nbytes > self._budget:
                    continue
                self._kept[key] = column
                while sum(kept.nbytes for kept in self._kept.values()) > self._budget:
                    self._kept.popitem(last=False)

    def get(self, key: str) -> TableColumn | None:
        with self._lock:
            return self._kept.get(key)

    def nbytes(self) -> int:
        with self._lock:
            return sum(column.nbytes for column in self._kept.values())

    def clear(self) -> None:
        """Lets every column go (the table is closed; the tests)."""
        with self._lock:
            self._kept.clear()


COLUMNS = Columns()
