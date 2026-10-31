"""The wandas operations a step bar can add: one entry per Recipe operation that takes one frame.

Parameters are wandas' own description of each operation (the registry's ``describe()``): whether one
is required, its default and its choices. An operation with a required one can be added only where the
app knows how to set it (the step bar's STEP_PARAMS). The description does not say which Frame an
operation takes or gives, so both are read from the public method it is declared on: the class it
belongs to is the Frame it takes, and its return annotation the Frame it gives (a type variable gives
the Frame it took).

``python operation_catalog.py --write`` writes src/shared/recipe/generated/wandasOperations.ts, which
test_operation_catalog.py keeps equal to this module. Writing it also runs every operation on example
Frames (operation_probe.py): a Frame an operation is declared to take but fails on in every run is listed
as one it refuses, with why, so the step bar does not offer it there.
"""

from __future__ import annotations

import inspect
import json
import sys
from pathlib import Path
from typing import Any, NotRequired, TypedDict, TypeVar

from wandas.pipeline import RecipeParameterDescription, default_recipe_registry
from wandas.pipeline.registry import RecipeOperation

TS_TARGET = Path(__file__).parents[1] / "src" / "shared" / "recipe" / "generated" / "wandasOperations.ts"


class CatalogParam(TypedDict):
    name: str
    required: bool
    #: What wandas uses when a Recipe leaves it out (numbers, text and flags only).
    default: NotRequired[int | float | str | bool]
    #: The values wandas accepts, when it lists them.
    choices: NotRequired[list[str]]


class CatalogFrame(TypedDict):
    name: str
    #: The Frames it also is, so an operation on one of them takes it too.
    bases: list[str]
    #: Whether the comparison draws it (stage_view.STAGE_FRAME_TYPES).
    charted: bool


class CatalogOperation(TypedDict):
    id: str
    version: int
    #: The Frame the operation takes; "*" for every Frame (it gives the Frame it took).
    input: str
    #: The Frame it gives; "*" for the Frame it took.
    output: str
    params: list[CatalogParam]
    #: Frames it is declared to take but fails on for every example (operation_probe.py), with why.
    refuses: NotRequired[dict[str, str]]
    #: Optional packages it needs that the Web version's runtime does not carry (operation_probe.needs).
    needs: NotRequired[list[str]]


def _owners() -> list[tuple[type[Any], str]]:
    """The classes wandas declares built-in operations on, with the Frame each one's operations take."""
    from wandas.core.base_frame import BaseFrame
    from wandas.frames.cepstral import CepstralFrame
    from wandas.frames.cepstrogram import CepstrogramFrame
    from wandas.frames.channel import ChannelFrame
    from wandas.frames.mixins.channel_processing_mixin import ChannelProcessingMixin
    from wandas.frames.mixins.channel_transform_mixin import ChannelTransformMixin
    from wandas.frames.pairwise import CrossSpectralFrame, PairwiseFrame, PairwiseSpectralFrame
    from wandas.frames.spectral import SpectralFrame
    from wandas.frames.spectrogram import SpectrogramFrame

    return [
        (BaseFrame, "*"),
        (ChannelProcessingMixin, "ChannelFrame"),
        (ChannelTransformMixin, "ChannelFrame"),
        (ChannelFrame, "ChannelFrame"),
        (PairwiseFrame, "PairwiseFrame"),
        (PairwiseSpectralFrame, "PairwiseSpectralFrame"),
        (CrossSpectralFrame, "CrossSpectralFrame"),
        (CepstralFrame, "CepstralFrame"),
        (CepstrogramFrame, "CepstrogramFrame"),
        (SpectralFrame, "SpectralFrame"),
        (SpectrogramFrame, "SpectrogramFrame"),
    ]


def _output(method: Any, taken: str) -> str:
    returned = inspect.signature(method).return_annotation
    if isinstance(returned, TypeVar):
        return taken
    name = returned if isinstance(returned, str) else getattr(returned, "__name__", "")
    # A forward reference to a type variable ("PairwiseFrameT") or Any: the Frame it took.
    return name if name.endswith("Frame") else taken


def _param(parameter: RecipeParameterDescription) -> CatalogParam:
    entry: CatalogParam = {"name": parameter.name, "required": parameter.required}
    if isinstance(parameter.default, int | float | str | bool):
        entry["default"] = parameter.default
    choices = [choice for choice in parameter.choices or () if isinstance(choice, str)]
    if choices:
        entry["choices"] = choices
    return entry


def catalog() -> list[CatalogOperation]:
    """The operations a chain can hold, in the registry's order, each at its newest version.

    Left out: operations that need a second input (a Recipe chain has one), and those whose method
    takes a callable or keyword arguments, which a Recipe cannot carry as a value.
    """
    described = {
        (description.operation_id, description.version): description
        for description in default_recipe_registry().describe()
        if any(len(pattern) == 1 for pattern in description.binding_patterns)
    }
    newest: dict[str, CatalogOperation] = {}
    for owner, taken in _owners():
        for member in vars(owner).values():
            definition = getattr(member, "__wandas_recipe_operation__", None)
            if (
                not isinstance(definition, RecipeOperation)
                or (definition.operation_id, definition.version) not in described
            ):
                continue
            method = member.fget if isinstance(member, property) else member
            parameters = [
                parameter
                for parameter in described[(definition.operation_id, definition.version)].parameters
                if parameter.kind != "VAR_KEYWORD"
            ]
            if any(parameter.required and "Callable" in parameter.annotation for parameter in parameters):
                continue
            entry: CatalogOperation = {
                "id": definition.operation_id,
                "version": definition.version,
                "input": taken,
                "output": "*" if taken == "*" else _output(method, taken),
                "params": [_param(parameter) for parameter in parameters],
            }
            if definition.operation_id not in newest or newest[definition.operation_id]["version"] < definition.version:
                newest[definition.operation_id] = entry
    order = {operation.operation_id: index for index, operation in enumerate(default_recipe_registry().operations)}
    return sorted(newest.values(), key=lambda entry: order[entry["id"]])


def frames() -> list[CatalogFrame]:
    """wandas' Frame classes, each with the Frames it derives from."""
    import wandas.frames
    from wandas.core.base_frame import BaseFrame

    from stage_view import STAGE_FRAME_TYPES

    found = [
        value
        for name, value in sorted(vars(wandas.frames).items())
        if inspect.isclass(value) and issubclass(value, BaseFrame) and value.__name__ == name
    ]
    return [
        {
            "name": frame.__name__,
            "bases": [
                base.__name__ for base in frame.__mro__[1:] if issubclass(base, BaseFrame) and base is not BaseFrame
            ],
            "charted": issubclass(frame, STAGE_FRAME_TYPES),
        }
        for frame in found
    ]


def with_refusals(
    operations: list[CatalogOperation], refusals: dict[str, dict[str, str]], needs: dict[str, list[str]] | None = None
) -> list[CatalogOperation]:
    """The operations with the Frames each fails on in every probe run, and the packages each needs."""
    marked: list[CatalogOperation] = []
    for operation in operations:
        entry: CatalogOperation = {**operation}
        if refusals.get(operation["id"]):
            entry["refuses"] = refusals[operation["id"]]
        if needs and needs.get(operation["id"]):
            entry["needs"] = needs[operation["id"]]
        marked.append(entry)
    return marked


def typescript(operations: list[CatalogOperation], frame_types: list[CatalogFrame]) -> str:
    return (
        "// Generated by python-backend/operation_catalog.py from wandas' Recipe registry.\n"
        "// Do not edit; run `python python-backend/operation_catalog.py --write`.\n"
        "import type { CatalogFrame, CatalogOperation } from '../recipeCatalog';\n\n"
        f"export const WANDAS_VERSION = {json.dumps(__import__('wandas').__version__)};\n\n"
        "export const WANDAS_OPERATIONS: readonly CatalogOperation[] = "
        + json.dumps(operations, indent=4, ensure_ascii=False)
        + ";\n\n"
        "export const WANDAS_FRAMES: readonly CatalogFrame[] = "
        + json.dumps(frame_types, indent=4, ensure_ascii=False)
        + ";\n"
    )


if __name__ == "__main__":
    from operation_probe import needs, probe, refusals

    runs = probe()
    text = typescript(with_refusals(catalog(), refusals(runs), needs(runs)), frames())
    if "--write" in sys.argv:
        TS_TARGET.parent.mkdir(parents=True, exist_ok=True)
        TS_TARGET.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
