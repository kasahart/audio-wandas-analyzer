import json
import math
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

import protocol_schema
from protocol_schema import (
    DEFINITIONS,
    MAX_WAVEFORM_POINTS,
    dump_schema,
    first_violation,
    payload_violation,
    result_violation,
    unsupported_keyword,
)

BACKEND = Path(__file__).resolve().parent
FIXTURES = json.loads(
    (BACKEND.parent / "src" / "test" / "fixtures" / "backendProtocol.json").read_text(encoding="utf-8")
)
RANGE = {"filePath": "tone.wav", "startNorm": 0, "endNorm": 1, "points": 2000}


def test_integer_matches_json_schema_semantics() -> None:
    assert payload_violation("range", {**RANGE, "points": 2000.0}) is None
    assert payload_violation("range", {**RANGE, "points": 2000.5}) == "points"
    assert payload_violation("range", {**RANGE, "points": math.inf}) == "points"
    assert payload_violation("range", {**RANGE, "points": True}) == "points"


def test_huge_integers_are_violations_not_crashes() -> None:
    assert payload_violation("range", {**RANGE, "points": 10**400}) == "points"
    assert payload_violation("range", {**RANGE, "analysisRevision": 10**400}) is None


def test_range_payload_bounds_and_optional_fields() -> None:
    assert payload_violation("range", {**RANGE, "points": 0}) == "points"
    assert payload_violation("range", {**RANGE, "points": MAX_WAVEFORM_POINTS}) is None
    assert payload_violation("range", {**RANGE, "calibrationProfile": None}) is None
    assert payload_violation("range", {**RANGE, "analysisRevision": -1}) is None


def test_unsupported_keywords_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    assert unsupported_keyword() is None
    assert unsupported_keyword({"type": "string", "enum": ["a", "b"]}, "x") is None
    assert unsupported_keyword({"type": "string", "enum": []}, "x") == "x.enum"
    assert unsupported_keyword({"enum": [["a"]]}, "x") == "x.enum"
    nested = {"type": "object", "properties": {"mode": {"const": {"a": 1}}}}
    assert unsupported_keyword(nested, "x") == "x.mode.const"
    assert unsupported_keyword({"type": "float"}, "x") == "x.type"
    assert unsupported_keyword({"type": ["string", "null"]}, "x") == "x.type"
    assert unsupported_keyword({"$ref": "#/$defs/AnalysisRevision", "const": 1}, "x") == "x.$ref"
    assert unsupported_keyword({"type": "string", "enum": ["hann", 1]}, "x") == "x.enum"
    assert unsupported_keyword({"type": "integer", "const": 1.5}, "x") == "x.const"
    assert unsupported_keyword({"const": 2**53}, "x") == "x.const"
    assert unsupported_keyword({"const": 2**53 - 1}, "x") is None
    assert unsupported_keyword({"const": 9007199254740992.0}, "x") == "x.const"
    assert unsupported_keyword({"enum": [10**400]}, "x") == "x.enum"
    assert unsupported_keyword({"type": "integer", "enum": [1, 2], "minimum": 2}, "x") == "x.enum"
    assert unsupported_keyword({"type": "number", "const": 2, "maximum": 1}, "x") == "x.const"
    assert unsupported_keyword({"enum": [math.nan]}, "x") == "x.enum"
    assert unsupported_keyword({"const": math.inf}, "x") == "x.const"
    assert unsupported_keyword({"type": "string", "enum": ["hann"], "const": "hamming"}, "x") == "x.const"
    assert unsupported_keyword({"oneOf": []}, "x") == "x.oneOf"
    assert unsupported_keyword({"type": "object", "properties": ["mode"]}, "x") == "x.properties"
    assert unsupported_keyword({"anyOf": [{"type": "string"}, {"type": "null"}]}, "x") is None
    assert unsupported_keyword({"anyOf": [{"type": "string"}, {"type": "integer"}]}, "x") == "x.anyOf"
    assert unsupported_keyword({"anyOf": [{"type": "null"}, {"type": "string"}]}, "x") == "x.anyOf"
    assert unsupported_keyword({"anyOf": [{"type": "string"}, {"type": "null"}], "type": "string"}, "x") == "x.anyOf"
    assert unsupported_keyword({"anyOf": [{"type": "string"}]}, "x") == "x.anyOf"
    assert unsupported_keyword({"anyOf": [{"oneOf": []}, {"type": "null"}]}, "x") == "x.anyOf[0].oneOf"
    assert unsupported_keyword({"$ref": "#/$defs/Missing"}, "x") == "x.$ref"
    closed = {"type": "object", "properties": {"a": {"type": "number"}}, "additionalProperties": False}
    assert unsupported_keyword(closed, "x") is None
    assert unsupported_keyword({**closed, "additionalProperties": True}, "x") == "x.additionalProperties"
    assert unsupported_keyword({"type": "object", "additionalProperties": False}, "x") == "x.additionalProperties"
    monkeypatch.setitem(DEFINITIONS, "Bad", {"type": "array", "items": {"oneOf": []}})
    with pytest.raises(ValueError, match=r"\$defs\.Bad\.items\.oneOf"):
        dump_schema()


def test_result_violation_checks_the_result_definition() -> None:
    envelope = {"min": [0.0], "max": [1.0], "samples": [0.5], "absolutePeak": 1.0}
    result = {"startNorm": 0.0, "endNorm": 1.0, "channels": [envelope]}
    assert result_violation("range", result) is None
    assert result_violation("range", {**result, "channels": [{**envelope, "absolutePeak": math.nan}]}) == (
        "channels[0].absolutePeak"
    )
    assert result_violation("range", {**result, "analysisRevision": -1}) == "analysisRevision"
    assert first_violation({"type": "object", "required": ["a"]}, {}) == "a"


def test_schema_dumps_without_third_party_packages() -> None:
    # -S skips site-packages, so numpy and wandas are unavailable, as on a fresh checkout.
    output = subprocess.run(
        [sys.executable, "-S", "protocol_schema.py"], cwd=BACKEND, check=True, capture_output=True, text=True
    ).stdout
    assert json.loads(output)["x-commands"] == protocol_schema.COMMANDS


def _reference_validator(schema: dict) -> Draft202012Validator:
    return Draft202012Validator({**schema, "$defs": DEFINITIONS})


@pytest.mark.parametrize("case", FIXTURES["schemaCases"], ids=lambda case: json.dumps(case["schema"])[:40])
def test_schema_cases_report_the_shared_path_and_agree_with_jsonschema(case: dict) -> None:
    assert first_violation(case["schema"], case["value"]) == case["violation"]
    assert _reference_validator(case["schema"]).is_valid(case["value"]) == (case["violation"] is None)


def test_every_listed_object_rejects_unknown_keys() -> None:
    def objects(schema: dict) -> list[dict]:
        found = [schema] if "properties" in schema else []
        for child in schema.get("properties", {}).values():
            found += objects(child)
        for key in ("items",):
            if key in schema:
                found += objects(schema[key])
        if "anyOf" in schema:
            found += objects(schema["anyOf"][0])
        return found

    listed = [node for definition in DEFINITIONS.values() for node in objects(definition)]
    assert listed and all(node.get("additionalProperties") is False for node in listed)
    assert "additionalProperties" not in DEFINITIONS["CalibrationProfile"]
    assert (
        payload_violation(
            "range", {"cmd": "range", "requestId": "r", "filePath": "a", "startNorm": 0, "endNorm": 1, "points": 2}
        )
        is None
    )
    assert result_violation("release-track-detail", {"requestId": "r"}) is None
    assert result_violation("release-track-detail", {"requestId": "r", "released": True}) == "released"
    wav = {"requestId": "r", "wavBase64": "", "sampleRate": 8000}
    assert result_violation("export-wav-loop", wav) is None
    assert result_violation("export-wav-loop", {**wav, "cmd": "export-wav-loop"}) == "cmd"


def _without_envelope(message: object, keys: frozenset[str]) -> object:
    if not isinstance(message, dict):
        return message
    return {key: value for key, value in message.items() if key not in keys}


def test_schema_commands_agree_with_jsonschema_on_the_protocol_fixtures() -> None:
    Draft202012Validator.check_schema(dump_schema())
    checked = 0
    for case in FIXTURES["validRequests"] + FIXTURES["invalidRequests"]:
        command = case.get("command")
        if command not in protocol_schema.COMMANDS:
            continue
        reference = _reference_validator({"$ref": f"#/$defs/{protocol_schema.COMMANDS[command]['payload']}"})
        valid = payload_violation(command, case["request"]) is None
        assert reference.is_valid(_without_envelope(case["request"], protocol_schema.REQUEST_ENVELOPE_KEYS)) == valid, (
            case
        )
        checked += 1
    for case in FIXTURES["validResponses"]:
        if case["command"] not in protocol_schema.COMMANDS:
            continue
        reference = _reference_validator({"$ref": f"#/$defs/{protocol_schema.COMMANDS[case['command']]['result']}"})
        valid = result_violation(case["command"], case["response"]) is None
        assert (
            reference.is_valid(_without_envelope(case["response"], protocol_schema.RESPONSE_ENVELOPE_KEYS)) == valid
        ), case
        checked += 1
    for case in FIXTURES["invalidResponses"]:
        reference = _reference_validator({"$ref": f"#/$defs/{protocol_schema.COMMANDS[case['command']]['result']}"})
        assert result_violation(case["command"], case["response"]) == case["violation"], case
        assert not reference.is_valid(_without_envelope(case["response"], protocol_schema.RESPONSE_ENVELOPE_KEYS)), case
        checked += 1
    assert checked > 0


def _number_arrays(node: object, path: str) -> list[tuple[str, dict]]:
    """Every array of numbers under ``node`` (a list of lists counts once), as (path, the number's own schema)."""
    found: list[tuple[str, dict]] = []
    if not isinstance(node, dict):
        return found
    if node.get("type") == "array":
        item = node.get("items")
        while isinstance(item, dict) and (item.get("type") == "array" or "anyOf" in item):
            item = item["items"] if item.get("type") == "array" else item["anyOf"][0]
        if isinstance(item, dict) and item.get("type") == "number":
            return [(path, item)]
    for key, child in node.items():
        if isinstance(child, dict):
            found += _number_arrays(child, f"{path}.{key}")
        elif isinstance(child, list):
            for index, entry in enumerate(child):
                found += _number_arrays(entry, f"{path}.{key}[{index}]")
    return found


def test_every_array_of_numbers_says_whether_it_is_drawn_points_full_data_or_places() -> None:
    """Rule: an array of numbers in the protocol is exactly one of ``x-drawn`` (points thinned to be drawn),
    ``x-whole`` (every value of the data) or ``x-place`` (places along an axis, limits, edges: not data values).
    The webview reads numbers only from ``x-whole`` arrays and can only draw ``x-drawn`` ones, so an array that
    says nothing could be either. Fix: in protocol_schema.py use _DRAWN_LINE / _DRAWN_GAPPED, _WHOLE_LINE /
    _WHOLE_GAPPED or _PLACES for the field (see the comment above them for how to choose). Arrays of integers
    (counts, channel indices) and of strings are not data values and need no mark."""
    arrays = _number_arrays(DEFINITIONS, "$defs")
    assert len(arrays) > 30, "the walk finds the protocol's arrays"
    marks = ("x-drawn", "x-whole", "x-place")
    unclassified = [path for path, item in arrays if sum(1 for mark in marks if item.get(mark)) != 1]
    assert unclassified == [], f"these arrays of numbers do not say what they hold (or say two things): {unclassified}"
    # The check itself fails on an unmarked array and on one marked twice.
    plain = {"Injected": {"type": "object", "properties": {"values": {"type": "array", "items": {"type": "number"}}}}}
    assert [item for _, item in _number_arrays(plain, "$defs")] == [{"type": "number"}]
    nested = {
        "type": "array",
        "items": {"type": "array", "items": {"anyOf": [{"type": "number", "x-whole": True}, {"type": "null"}]}},
    }
    assert _number_arrays(nested, "$")[0][1].get("x-whole") is True


def test_the_waveform_envelopes_picked_samples_are_drawn_points() -> None:
    """decimator.decimated_waveform keeps one sample of each bucket in ``samples``: thinned, so never read as data."""
    assert DEFINITIONS["WaveformEnvelope"]["properties"]["samples"]["items"].get("x-drawn") is True
