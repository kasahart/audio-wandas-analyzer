import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

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
    assert unsupported_keyword({"type": "string", "enum": ["a"]}, "x") == "x.enum"
    nested = {"type": "object", "properties": {"mode": {"const": "a"}}}
    assert unsupported_keyword(nested, "x") == "x.mode.const"
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
    assert first_violation({"type": "object", "required": ["a"]}, {}) == "a"


def test_schema_dumps_without_third_party_packages() -> None:
    # -S skips site-packages, so numpy and wandas are unavailable, as on a fresh checkout.
    output = subprocess.run(
        [sys.executable, "-S", "protocol_schema.py"], cwd=BACKEND, check=True, capture_output=True, text=True
    ).stdout
    assert json.loads(output)["x-commands"] == protocol_schema.COMMANDS
