from __future__ import annotations

import copy
import json
import os
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import dask
import numpy as np
import pytest
import wandas as wd
from wandas.pipeline import RecipePlan

RecipeFactory = Callable[..., dict[str, Any]]

# Marker -> the environment variable that opts in to it (see pyproject.toml).
OPT_IN = {"slow": "AWA_SLOW", "perf": "AWA_PERF"}


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--record-skips",
        metavar="PATH",
        help="write the skipped tests (runner, test, reason) as JSON to PATH (the skip gate, scripts/test-skips.mjs)",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    # Deselected, not skipped: a test of an opt-in marker is not part of a run unless its variable asks for it, and
    # in CI a skip fails verify (scripts/test-skips.mjs). The summary names what was left out and how to run it.
    off = {marker: variable for marker, variable in OPT_IN.items() if os.environ.get(variable) != "1"}
    deselected = [item for item in items if any(marker in item.keywords for marker in off)]
    if deselected:
        config.hook.pytest_deselected(items=deselected)
        items[:] = [item for item in items if item not in deselected]


_SKIPPED: list[dict[str, str]] = []  # runner, test, reason


def _record_skip(report: pytest.TestReport | pytest.CollectReport) -> None:
    if report.skipped and not hasattr(report, "wasxfail"):
        reason = report.longrepr[2] if isinstance(report.longrepr, tuple) else str(report.longrepr)
        skip = {"runner": "pytest", "test": report.nodeid, "reason": reason.removeprefix("Skipped: ")}
        if skip not in _SKIPPED:
            _SKIPPED.append(skip)


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    # A test that skips while it runs (pytest.skip, a skip or skipif mark). On the controller of a pytest-xdist run
    # too: the workers' reports reach this hook there.
    _record_skip(report)


def pytest_collectreport(report: pytest.CollectReport) -> None:
    # A whole module or class that skips while it is collected (pytest.skip(..., allow_module_level=True), a
    # module-level pytest.importorskip): it is reported here, never to pytest_runtest_logreport. pytest-xdist hands
    # the workers' skipped collection reports to the controller's hook, once each.
    _record_skip(report)


def pytest_sessionfinish(session: pytest.Session) -> None:
    path = session.config.getoption("--record-skips")
    if path and not hasattr(session.config, "workerinput"):
        Path(path).write_text(json.dumps(_SKIPPED, indent=1), encoding="utf-8")


def pytest_terminal_summary(terminalreporter: Any) -> None:
    for marker, variable in OPT_IN.items():
        if os.environ.get(variable) != "1":
            terminalreporter.write_line(f"{marker} tests deselected: set {variable}=1 to run them")
    timings = [
        f"  {report.nodeid}: {value}"
        for reports in terminalreporter.stats.values()
        for report in reports
        if getattr(report, "when", None) == "call"
        for name, value in getattr(report, "user_properties", [])
        if name == "timing"
    ]
    if timings:
        terminalreporter.write_sep("-", "timings (budgets checked only with AWA_PERF=1)")
        terminalreporter.write_line("\n".join(timings))


@pytest.fixture(autouse=True)
def _restore_dask_config() -> Iterator[None]:
    """dask's config is process-wide: a test that sets a scheduler (as the browser service does) must not
    run the rest of the suite on it, or the native threaded path is never exercised."""
    saved = copy.deepcopy(dask.config.config)
    yield
    dask.config.config.clear()
    dask.config.config.update(saved)


@pytest.fixture
def make_recipe() -> RecipeFactory:
    """Build a wandas Recipe payload the way a user would: run the workflow on stand-in frames and save its plan."""

    def build(workflow: Callable[..., Any], *names: str, channels: int = 1) -> dict[str, Any]:
        names = names or ("signal",)
        frames = [
            wd.from_numpy(
                np.zeros((channels, 16000)),
                sampling_rate=16000,
                ch_labels=[f"{name}{index}" for index in range(channels)],
            )
            for name in names
        ]
        return RecipePlan.from_frame(workflow(*frames), input_names=names).to_dict()

    return build


def assert_not_drawn(answer: Any, drawn: Any) -> None:
    """The second half of a proof that code computes from the full data (docs/plot-contracts.md): its ``answer`` is
    not the one the points thinned to draw would give (``drawn``, worked out in the test from the thinned picture).

    A proof test asserts the answer outright first (``assert answer == pytest.approx(expected)``), then calls this.
    scripts/check_test_proofs.py requires both sides to be made of the test's inputs, never a constant.
    """
    same = np.shape(answer) == np.shape(drawn) and bool(
        np.allclose(np.asarray(answer, dtype=float), np.asarray(drawn, dtype=float), equal_nan=True)
    )
    assert not same, "the answer is the one the drawn points give: it must come from the full data"
