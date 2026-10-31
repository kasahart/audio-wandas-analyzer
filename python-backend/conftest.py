from __future__ import annotations

import copy
import os
from collections.abc import Callable, Iterator
from typing import Any

import dask
import numpy as np
import pytest
import wandas as wd
from wandas.pipeline import RecipePlan

RecipeFactory = Callable[..., dict[str, Any]]

# Marker -> the environment variable that opts in to it (see pyproject.toml).
OPT_IN = {"slow": "AWA_SLOW", "perf": "AWA_PERF"}


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    for marker, variable in OPT_IN.items():
        if os.environ.get(variable) == "1":
            continue
        skip = pytest.mark.skip(reason=f"{marker}: set {variable}=1 to run")
        for item in items:
            if marker in item.keywords:
                item.add_marker(skip)


def pytest_terminal_summary(terminalreporter: Any) -> None:
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
