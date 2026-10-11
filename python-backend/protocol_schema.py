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

SUPPORTED_KEYWORDS = frozenset(
    {"$ref", "type", "enum", "const", "minimum", "maximum", "required", "properties", "items", "x-tsType"}
)
# enum/const values are limited to JSON scalars so both validators can compare them without deep equality.
_SCALAR_TYPES = (str, int, float, bool, type(None))
_TYPES = frozenset({"object", "array", "string", "number", "integer", "boolean", "null"})
_MAX_SAFE_INTEGER = 2**53 - 1  # Number.MAX_SAFE_INTEGER: larger integers change value in the generated TS.

_NUMBER: Schema = {"type": "number"}
_NUMBERS: Schema = {"type": "array", "items": _NUMBER}

DEFINITIONS: dict[str, Schema] = {
    # Deep calibration validation stays in calibration_profile.py / calibrationModel.ts.
    # No ``type`` so ``null`` keeps meaning "no profile", as for the other commands.
    "CalibrationProfile": {"x-tsType": "CalibrationProfile"},
    # Requests accept any integer like the other commands; results keep the non-negative
    # guarantee hasCalibrationResultMetadata enforces for every other result.
    # Same bounds as isSafeCalibrationValue / calibration_profile._MIN/_MAX_SAFE_CALIBRATION_VALUE.
    "SafeCalibrationValue": {"type": "number", "minimum": 1e-150, "maximum": 1e150},
    "AnalysisRevision": {"type": "integer"},
    "ResultAnalysisRevision": {"type": "integer", "minimum": 0},
    # Ranges and evenness of nFft/hopSize stay in analyzer.normalize_stft_options.
    "StftOptions": {
        "type": "object",
        "required": ["nFft", "hopSize", "window"],
        "properties": {
            "nFft": {"type": "integer"},
            "hopSize": {"type": "integer"},
            "window": {"type": "string", "enum": ["hann", "hamming", "blackman", "boxcar"]},
        },
    },
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
    "SpectrumSlicePayload": {
        "type": "object",
        "required": ["filePath", "trackIndex", "analysisId", "settingsSignature", "cursorNorm"],
        "properties": {
            "filePath": {"type": "string"},
            "trackIndex": {"type": "integer"},
            "analysisId": {"type": "string"},
            "settingsSignature": {"type": "string"},
            "cursorNorm": _NUMBER,
            "stftOptions": {"$ref": "#/$defs/StftOptions"},
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
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
        },
    },
    "SpectrumSliceChannel": {
        "type": "object",
        "required": ["channelIndex", "values", "minDb", "maxDb"],
        "properties": {
            "channelIndex": {"type": "integer"},
            "values": _NUMBERS,
            "minDb": _NUMBER,
            "maxDb": _NUMBER,
            "unit": {"type": "string"},
            "axisLabel": {"type": "string"},
            "referenceValue": {"$ref": "#/$defs/SafeCalibrationValue"},
            "referenceUnit": {"type": "string"},
            "levelReferenceLabel": {"type": "string"},
        },
    },
    "SpectrumSliceResult": {
        "type": "object",
        "required": [
            "trackIndex",
            "analysisId",
            "settingsSignature",
            "filePath",
            "channels",
            "frequencyBins",
            "maxFrequencyHz",
            "computeMs",
        ],
        "properties": {
            "trackIndex": {"type": "integer"},
            "analysisId": {"type": "string"},
            "settingsSignature": {"type": "string"},
            "filePath": {"type": "string"},
            "channels": {"type": "array", "items": {"$ref": "#/$defs/SpectrumSliceChannel"}},
            "frequencyBins": {"type": "integer"},
            "maxFrequencyHz": _NUMBER,
            "computeMs": _NUMBER,
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
        },
    },
    "ExportWavLoopPayload": {
        "type": "object",
        "required": ["filePath", "startNorm", "endNorm"],
        "properties": {"filePath": {"type": "string"}, "startNorm": _NUMBER, "endNorm": _NUMBER},
    },
    "ExportWavLoopResult": {
        "type": "object",
        "required": ["wavBase64", "sampleRate"],
        "properties": {"wavBase64": {"type": "string"}, "sampleRate": {"type": "integer"}},
    },
    "ReleaseTrackDetailPayload": {
        "type": "object",
        "required": ["filePath"],
        "properties": {"filePath": {"type": "string"}},
    },
    # Nothing to report; the reply only settles the request.
    "ReleaseTrackDetailResult": {"type": "object"},
}

COMMANDS: dict[str, dict[str, str]] = {
    "range": {"payload": "RangePayload", "result": "RangeResult"},
    "spectrum-slice": {"payload": "SpectrumSlicePayload", "result": "SpectrumSliceResult"},
    "export-wav-loop": {"payload": "ExportWavLoopPayload", "result": "ExportWavLoopResult"},
    "release-track-detail": {"payload": "ReleaseTrackDetailPayload", "result": "ReleaseTrackDetailResult"},
}


def _is_literal(value: object, declared_type: object) -> bool:
    """A JSON scalar that survives the trip to a JS number and matches the node's ``type``, if any."""
    if not isinstance(value, _SCALAR_TYPES):
        return False
    if isinstance(value, float) and not math.isfinite(value):
        return False  # json.dump would emit NaN/Infinity, which JSON.parse rejects.
    integral = (isinstance(value, int) and not isinstance(value, bool)) or (
        isinstance(value, float) and value.is_integer()
    )
    if integral and abs(value) > _MAX_SAFE_INTEGER:  # Compared exactly; float(10**400) would overflow.
        return False
    return declared_type is None or _matches_type(declared_type, value)  # type: ignore[arg-type]


def unsupported_keyword(schema: object = None, path: str = "$defs") -> str | None:
    """Path of the first keyword the validators cannot enforce exactly (all definitions by default), or None.

    Besides keywords outside ``SUPPORTED_KEYWORDS`` that covers unresolvable ``$ref``s, ``$ref`` with
    sibling keywords (resolution would drop them), unknown type names, ``enum`` together with ``const``,
    enum/const beside ``minimum``/``maximum``, and enum/const values that are not finite JSON scalars, lose
    precision as JS numbers, or contradict the node's ``type``.
    """
    if schema is None:
        for name, definition in DEFINITIONS.items():
            found = unsupported_keyword(definition, f"$defs.{name}")
            if found is not None:
                return found
        return None
    if not isinstance(schema, dict):
        return None
    declared_type = schema.get("type")
    # Literal types are emitted as-is, so bounds beside enum/const would make them wider than validation.
    bounded = "minimum" in schema or "maximum" in schema
    for key, child in schema.items():
        if key not in SUPPORTED_KEYWORDS:
            return f"{path}.{key}"
        if key == "$ref" and (
            len(schema) > 1
            or not isinstance(child, str)
            or not child.startswith("#/$defs/")
            or child.removeprefix("#/$defs/") not in DEFINITIONS
        ):
            return f"{path}.$ref"
        if key == "type" and (not isinstance(child, str) or child not in _TYPES):
            return f"{path}.type"
        if key == "const" and ("enum" in schema or bounded or not _is_literal(child, declared_type)):
            return f"{path}.const"
        if key == "enum" and (
            bounded
            or not isinstance(child, list)
            or not child
            or not all(_is_literal(item, declared_type) for item in child)
        ):
            return f"{path}.enum"
        nested = child.items() if key == "properties" else [(key, child)] if key == "items" else []
        for name, node in nested:
            found = unsupported_keyword(node, f"{path}.{name}")
            if found is not None:
                return found
    return None


def dump_schema() -> Schema:
    unsupported = unsupported_keyword()
    if unsupported is not None:
        raise ValueError(f"protocol schema uses an unsupported keyword or unknown $ref at {unsupported}")
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
    if expected == "null":
        return value is None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, int):
        return True  # Python ints are exact; math.isfinite would overflow on huge ones.
    # JSON Schema: a float with no fractional part (2000.0) is an integer, as in schemaValidation.ts.
    return math.isfinite(value) and (expected == "number" or value.is_integer())


def _json_equal(left: object, right: object) -> bool:
    """JSON Schema scalar equality: ``1`` equals ``1.0`` but ``true`` never equals ``1``."""
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    return left == right


def first_violation(schema: Schema, value: object, path: str = "") -> str | None:
    """Return the dotted path of the first value that breaks ``schema`` (``""`` for the root), or None."""
    schema = _resolve(schema)
    if "type" in schema and not _matches_type(schema["type"], value):
        return path
    if "const" in schema and not _json_equal(value, schema["const"]):
        return path
    if "enum" in schema and not any(_json_equal(value, item) for item in schema["enum"]):
        return path
    numeric = isinstance(value, (int, float)) and not isinstance(value, bool)
    if numeric and "minimum" in schema and value < schema["minimum"]:  # type: ignore[operator]
        return path
    if numeric and "maximum" in schema and value > schema["maximum"]:  # type: ignore[operator]
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
