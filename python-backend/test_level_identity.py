"""The backend's level identity answers the table the webview's does (src/test/levelIdentity.test.ts)."""

import json
from pathlib import Path

from level_identity import level_identity

CASES = json.loads(
    (Path(__file__).resolve().parent.parent / "src" / "test" / "fixtures" / "levelIdentityCases.json").read_text(
        encoding="utf-8"
    )
)


def test_levels_compare_in_one_unit_reference_and_label_whatever_their_calibration_status() -> None:
    assert len(CASES) >= 6
    for case in CASES:
        a, b = case["a"], case["b"]
        same = level_identity(a["unit"], a["ref"], a["label"]) == level_identity(b["unit"], b["ref"], b["label"])
        assert same == case["same"], case["why"]
