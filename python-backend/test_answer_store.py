"""The process's one holder of answers (services/answer_store.py): the table's columns are kept within their own
bytes, and the figure service and the old comparison read one store."""

from __future__ import annotations

from services import stage_combine
from services.answer_store import COLUMNS, STORE, Columns
from transport import figure_answers


def _column(key: str, rows: int) -> dict[str, object]:
    return {
        "key": key,
        "version": "v1",
        "rows": [f"r{row}" for row in range(rows)],
        "values": [float(row) for row in range(rows)],
    }


def test_the_columns_kept_stay_within_their_bytes_the_oldest_handed_let_go_first() -> None:
    probe = Columns()
    probe.keep([_column("a", 100)])
    size = probe.nbytes()
    columns = Columns(budget=int(size * 2.5))
    columns.keep([_column("a", 100), _column("b", 100)])
    assert columns.get("a") is not None and columns.get("b") is not None
    columns.keep([_column("c", 100)])
    assert columns.get("a") is None, "the oldest handed is let go when a third does not fit"
    assert columns.get("b") is not None and columns.get("c") is not None
    assert columns.nbytes() <= int(size * 2.5)


def test_a_column_over_the_budget_alone_is_not_kept_and_takes_no_other_with_it() -> None:
    probe = Columns()
    probe.keep([_column("a", 100)])
    columns = Columns(budget=probe.nbytes() + 10)
    columns.keep([_column("a", 100)])
    columns.keep([_column("huge", 5000)])
    assert columns.get("huge") is None
    assert columns.get("a") is not None


def test_a_column_handed_again_takes_the_place_of_the_one_kept_under_its_key() -> None:
    columns = Columns()
    columns.keep([_column("a", 3)])
    columns.keep([{**_column("a", 2), "version": "v2"}])
    kept = columns.get("a")
    assert kept is not None and kept.version == "v2" and kept.rows == ("r0", "r1")


def test_the_old_comparison_and_the_figure_service_read_the_one_store() -> None:
    assert stage_combine.STORE is STORE
    assert figure_answers.COLUMNS is COLUMNS
    # The one budget counts what both keep.
    assert figure_answers.BUDGET.kept() == STORE.nbytes() + COLUMNS.nbytes()
