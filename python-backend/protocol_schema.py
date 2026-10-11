"""Backend protocol JSON Schema: the single definition of request payloads and results.

``python protocol_schema.py`` prints the schema; ``scripts/generate-protocol-types.mjs``
turns it into ``src/shared/protocol/generated/backendProtocolSchema.ts`` (TS types plus
the same schema for runtime checks), and ``command_dispatch.validate_request`` checks
requests against it here. Only ``SUPPORTED_KEYWORDS`` may be used: they are the ones
``first_violation`` and its TS mirror in ``schemaValidation.ts`` enforce, and
``unsupported_keyword`` (run by ``dump_schema`` and the generator) rejects anything else so a
keyword can never shape the TS types without also being checked at runtime.

This module must stay importable without numpy so the generator runs on a bare Python.

Commands move into ``COMMANDS`` one at a time; the rest still use the hand-written
validators in ``command_dispatch`` and ``backendProtocol.ts``.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any

Schema = dict[str, Any]

MAX_WAVEFORM_POINTS = 8192

SUPPORTED_KEYWORDS = frozenset({"$ref", "type", "minimum", "maximum", "required", "properties", "items", "x-tsType"})

_NUMBER: Schema = {"type": "number"}
_NUMBERS: Schema = {"type": "array", "items": _NUMBER}

DEFINITIONS: dict[str, Schema] = {
    # Deep calibration validation stays in calibration_profile.py / calibrationModel.ts.
    # No ``type`` so ``null`` keeps meaning "no profile", as for the other commands.
    "CalibrationProfile": {"x-tsType": "CalibrationProfile"},
    "AnalysisRevision": {"type": "integer"},
    "WaveformEnvelope": {
        "type": "object",
        "required": ["min", "max", "samples", "absolutePeak"],
        "properties": {
            "min": _NUMBERS,
            "max": _NUMBERS,
            "minT": _NUMBERS,
            "maxT": _NUMBERS,
            "samples": _NUMBERS,
            "absolutePeak": _NUMBER,
        },
    },
    "RangePayload": {
        "type": "object",
        "required": ["filePath", "startNorm", "endNorm", "points"],
        "properties": {
            "filePath": {"type": "string"},
            "startNorm": _NUMBER,
            "endNorm": _NUMBER,
            "points": {"type": "integer", "minimum": 1, "maximum": MAX_WAVEFORM_POINTS},
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
        },
    },
    "RangeResult": {
        "type": "object",
        "required": ["startNorm", "endNorm", "channels"],
        "properties": {
            "startNorm": _NUMBER,
            "endNorm": _NUMBER,
            "channels": {"type": "array", "items": {"$ref": "#/$defs/WaveformEnvelope"}},
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
        },
    },
}

COMMANDS: dict[str, dict[str, str]] = {
    "range": {"payload": "RangePayload", "result": "RangeResult"},
}


def unsupported_keyword(schema: object = None, path: str = "$defs") -> str | None:
    """Path of the first keyword outside ``SUPPORTED_KEYWORDS`` (all definitions by default), or None."""
    if schema is None:
        for name, definition in DEFINITIONS.items():
            found = unsupported_keyword(definition, f"$defs.{name}")
            if found is not None:
                return found
        return None
    if not isinstance(schema, dict):
        return None
    for key, child in schema.items():
        if key not in SUPPORTED_KEYWORDS:
            return f"{path}.{key}"
        nested = child.items() if key == "properties" else [(key, child)] if key == "items" else []
        for name, node in nested:
            found = unsupported_keyword(node, f"{path}.{name}")
            if found is not None:
                return found
    return None


def dump_schema() -> Schema:
    unsupported = unsupported_keyword()
    if unsupported is not None:
        raise ValueError(f"protocol schema uses an unsupported keyword at {unsupported}")
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": DEFINITIONS,
        "x-commands": COMMANDS,
    }


def _resolve(schema: Schema) -> Schema:
    while "$ref" in schema:
        schema = DEFINITIONS[schema["$ref"].removeprefix("#/$defs/")]
    return schema


def _matches_type(expected: str, value: object) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, int):
        return True  # Python ints are exact; math.isfinite would overflow on huge ones.
    # JSON Schema: a float with no fractional part (2000.0) is an integer, as in schemaValidation.ts.
    return math.isfinite(value) and (expected == "number" or value.is_integer())


def first_violation(schema: Schema, value: object, path: str = "") -> str | None:
    """Return the dotted path of the first value that breaks ``schema`` (``""`` for the root), or None."""
    schema = _resolve(schema)
    if "type" in schema and not _matches_type(schema["type"], value):
        return path
    if "minimum" in schema and value < schema["minimum"]:  # type: ignore[operator]
        return path
    if "maximum" in schema and value > schema["maximum"]:  # type: ignore[operator]
        return path
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                return f"{path}.{key}" if path else key
        for key, child in properties.items():
            if key in value:
                found = first_violation(child, value[key], f"{path}.{key}" if path else key)
                if found is not None:
                    return found
    if isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            found = first_violation(schema["items"], item, f"{path}[{index}]")
            if found is not None:
                return found
    return None


def payload_violation(command: str, value: object) -> str | None:
    """Path of the first invalid payload field for a schema-defined command, or None when valid."""
    return first_violation(DEFINITIONS[COMMANDS[command]["payload"]], value)


def result_violation(command: str, value: object) -> str | None:
    """Path of the first result field that breaks the schema-defined command's result, or None."""
    return first_violation(DEFINITIONS[COMMANDS[command]["result"]], value)


if __name__ == "__main__":
    json.dump(dump_schema(), sys.stdout, indent=2)
    sys.stdout.write("\n")
