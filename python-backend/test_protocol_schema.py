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
    assert unsupported_keyword({"oneOf": []}, "x") == "x.oneOf"
    assert unsupported_keyword({"$ref": "#/$defs/Missing"}, "x") == "x.$ref"
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


def test_schema_commands_agree_with_jsonschema_on_the_protocol_fixtures() -> None:
    Draft202012Validator.check_schema(dump_schema())
    checked = 0
    for case in FIXTURES["validRequests"] + FIXTURES["invalidRequests"]:
        command = case.get("command")
        if command not in protocol_schema.COMMANDS:
            continue
        reference = _reference_validator({"$ref": f"#/$defs/{protocol_schema.COMMANDS[command]['payload']}"})
        assert reference.is_valid(case["request"]) == (payload_violation(command, case["request"]) is None), case
        checked += 1
    for case in FIXTURES["validResponses"]:
        if case["command"] not in protocol_schema.COMMANDS:
            continue
        reference = _reference_validator({"$ref": f"#/$defs/{protocol_schema.COMMANDS[case['command']]['result']}"})
        assert reference.is_valid(case["response"]) == (result_violation(case["command"], case["response"]) is None)
        checked += 1
    assert checked > 0
