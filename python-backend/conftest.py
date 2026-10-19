from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
import wandas as wd
from wandas.pipeline import RecipePlan

RecipeFactory = Callable[..., dict[str, Any]]


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
