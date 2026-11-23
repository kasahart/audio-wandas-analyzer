from __future__ import annotations

import copy
import json
import os
import threading
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


def _encodable(value: Any) -> Any:
    """``value`` with every string made UTF-8 encodable (a lone surrogate becomes its escape, ``\\ud800``)."""
    if isinstance(value, str):
        return value.encode("utf-8", "backslashreplace").decode("utf-8")
    if isinstance(value, dict):
        return {_encodable(key): _encodable(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return type(value)(_encodable(item) for item in value)
    return value


@pytest.hookimpl(wrapper=True)
def pytest_report_to_serializable(config: pytest.Config, report: pytest.TestReport | pytest.CollectReport) -> Any:
    # A pytest-xdist worker sends each report to the controller as UTF-8. A report that carries a lone surrogate (an
    # assertion's diff of a string the test built from one, its captured output) cannot be encoded: the worker
    # crashed with INTERNALERROR and the test's own failure was never shown. Escaped here, it is.
    serialized = yield
    return _encodable(serialized)


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


#: Threads named so are the backend's own (backend_server: "awa-request-<n>", "awa-heartbeat") or a test's that
#: drive backend code, which writes replies (a test names those "awa-test-<what>").
#: Held by _no_backend_thread_outlives_its_test.
BACKEND_THREAD_PREFIX = "awa-"
#: Bounds the wait for a backend thread that has only to return when its test ends; never one that is still working.
_THREAD_RETURN_S = 10.0


def _backend_threads() -> list[threading.Thread]:
    return [thread for thread in threading.enumerate() if thread.name.startswith(BACKEND_THREAD_PREFIX)]


@pytest.fixture(autouse=True)
def _no_backend_thread_outlives_its_test() -> Iterator[None]:
    """A backend thread writes replies into whatever reply stream is in place when it writes (backend_server._emit).
    One that outlived its test wrote into the next test's stream: on Windows CI a test that failed while its threads
    still ran made the next test read their replies, and its heartbeat thread, its sleep given back, beat for the rest
    of the session. So a test ends only when its backend threads have (else it errors at teardown), and while one
    still runs no later test starts (it errors at setup): no test reads a reply that is not its own."""
    running = [thread.name for thread in _backend_threads()]
    if running:
        pytest.fail(
            f"backend thread(s) of an earlier test still running, so this test cannot run: {running}", pytrace=False
        )
    yield
    for thread in _backend_threads():
        thread.join(timeout=_THREAD_RETURN_S)
    left = [thread.name for thread in _backend_threads()]
    assert not left, f"backend thread(s) outlived their test: {left}"


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


def with_cursor_lines(reply: Any) -> dict[str, Any]:
    """A cursor-answers reply with each kept line read back by its key, for the tests of the numbers: beside every
    channel's key its ``values`` (every bin's or band's level, dB), and the axis they are on (``frequencyBins``,
    ``maxFrequencyHz``; for bands also their centres ``bandCentersHz`` and ``minFrequencyHz``). The webview never
    reads a line: the figure service draws it by its key."""
    from services.answer_store import STORE

    found = dict(reply)
    lines = [STORE.get(channel["key"]) for channel in found["channels"]]
    found["channels"] = [
        {**channel, "values": line.values.tolist()} for channel, line in zip(found["channels"], lines, strict=True)
    ]
    first = lines[0]
    found["frequencyBins"] = int(first.xs.size)
    if first.x_kind == "band":
        found["bandCentersHz"] = first.xs.tolist()
        found["minFrequencyHz"], found["maxFrequencyHz"] = first.x_limits
    else:
        found["maxFrequencyHz"] = float(first.xs[-1])
    return found


def cursor_lines(service: Any, file_path: object, **asked: Any) -> dict[str, Any]:
    """``service.cursor_answers`` with its kept lines read back (with_cursor_lines)."""
    return with_cursor_lines(service.cursor_answers(file_path, **asked))


def with_pair_lines(reply: Any) -> dict[str, Any]:
    """A pair-answers reply with each response's three kept lines read back by their keys, for the tests of the
    numbers: ``gainDb``, ``phaseDeg`` and ``coherence`` (every bin; None where a bin has no value), what the gain's
    dB are in (``gainLevel``: unit, reference, label), and the axis (``frequencyBins``, ``maxFrequencyHz``). A
    response that could not be averaged has no lines: its three lists are empty."""
    from services.answer_store import STORE

    def listed(values: np.ndarray) -> list[float | None]:
        return [float(value) if np.isfinite(value) else None for value in values.tolist()]

    found = dict(reply)
    found["frequencyBins"] = found["nFft"] // 2 + 1
    responses = []
    for response in found["responses"]:
        keys = response.get("keys")
        lines = {part: STORE.get(keys[part]) for part in ("gain", "phase", "coherence")} if keys else None
        if lines is not None:
            found["maxFrequencyHz"] = float(lines["gain"].xs[-1])
        responses.append(
            {
                **response,
                "gainDb": listed(lines["gain"].values) if lines else [],
                "phaseDeg": listed(lines["phase"].values) if lines else [],
                "coherence": listed(lines["coherence"].values) if lines else [],
                **({"gainLevel": tuple(lines["gain"].identity)} if lines else {}),
            }
        )
    found["responses"] = responses
    return found


def pair_lines(service: Any, reference: Any, responses: Any, **asked: Any) -> dict[str, Any]:
    """``service.pair_answers`` with its kept lines read back (with_pair_lines)."""
    return with_pair_lines(service.pair_answers(reference, responses, **asked))
