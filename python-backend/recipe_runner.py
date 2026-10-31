"""Replay a wandas Recipe on loaded frames and emit ChartSpec JSON.

A recipe is a wandas ``RecipePlan`` payload, as written by ``RecipePlan.save()``
or ``to_dict()``. Only operations registered with wandas can run, so the
analyzer evaluates no expressions of its own.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import PurePath
from typing import Any

from wandas.frames.pairwise import TransferFunctionFrame
from wandas.pipeline import (
    RecipeExecutionError,
    RecipePlan,
    RecipeSerializationError,
    RecipeValidationError,
)

from chart_spec import ChartSpec
from wandas_to_chart import CHART_FRAME_TYPES, adapt


class RecipeError(RuntimeError):
    """Raised when a recipe is malformed or cannot run on the given frames."""


def load_plan(recipe: Mapping[str, Any]) -> RecipePlan:
    try:
        return RecipePlan.from_dict(dict(recipe))
    except (RecipeSerializationError, RecipeValidationError, TypeError, ValueError) as error:
        raise RecipeError(str(error)) from error


def frame_input_names(plan: RecipePlan) -> list[str]:
    names = []
    for item in plan.inputs:
        if item.kind != "frame":
            raise RecipeError(f"input {item.name!r} needs an array, which the analyzer cannot supply")
        names.append(item.name)
    return names


def recipe_title(recipe_path: str | None) -> str:
    if not recipe_path:
        return "Recipe"
    name = PurePath(recipe_path.replace("\\", "/")).name
    for suffix in (".recipe.json", ".json"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def evaluate_recipe(plan: RecipePlan, frames: Mapping[str, Any], *, title: str) -> list[ChartSpec]:
    try:
        result = plan.apply(frames)
        if not isinstance(result, CHART_FRAME_TYPES):
            raise RecipeError(f"the analyzer cannot chart a {type(result).__name__} output")
        # Frames are lazy, so an operation that rejects the input (e.g. an octave band above
        # this file's Nyquist) only fails here, while the chart computes it.
        charts = [adapt(result, title=title)]
        if isinstance(result, TransferFunctionFrame):
            # Gain alone hides whether the path delays or inverts, so a transfer function also gets its phase.
            charts.append(adapt(result, title=f"{title} (phase)", value="phase"))
    except (RecipeExecutionError, RecipeValidationError, ValueError) as error:
        raise RecipeError(str(error)) from error
    except (TypeError, KeyError, IndexError) as error:
        # wandas names the operation when one fails as it is applied; a lazy one that rejects its input fails
        # while the chart computes the output, with no node attached, so name the output's operation.
        raise RecipeError(f"{_output_operation(plan)} failed: {type(error).__name__}: {error}") from error
    return charts


def _output_operation(plan: RecipePlan) -> str:
    operation = next((node.operation for node in plan.nodes if node.id == plan.output), None)
    return f"operation {operation!r}" if operation is not None else "the recipe"
