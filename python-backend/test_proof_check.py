"""scripts/check_test_proofs.py: a pytest named as proof that a row is computed from the full data must reach the
row's code, assert its answer, and assert it is not the drawn points' answer. Each kind of weak proof fails."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_test_proofs.py"
_spec = importlib.util.spec_from_file_location("check_test_proofs", SCRIPT)
assert _spec is not None and _spec.loader is not None
proofs = importlib.util.module_from_spec(_spec)
sys.modules["check_test_proofs"] = proofs
_spec.loader.exec_module(proofs)

HEAD = "import numpy as np\nfrom conftest import assert_not_drawn\nfrom decimator import decimated_waveform\n\n\n"
SETUP = (
    "def test_it():\n"
    "    samples = np.sin(np.arange(5000) * 0.3)\n"
    "    samples[3210] = -0.95\n"
    "    result = decimated_waveform(samples, 50, 0, 5000)\n"
)
TARGET = {"decimator:decimated_waveform"}


def _problem(tmp_path: Path, body: str, targets: set[str] | None = None) -> str | None:
    file = tmp_path / "test_injected.py"
    file.write_text(HEAD + SETUP + body, encoding="utf-8")
    return proofs.Proof(proofs.Backend(), file, "test_it", targets or TARGET).check()


def test_a_proof_that_asserts_the_answer_and_tells_it_from_the_drawn_points_passes(tmp_path: Path) -> None:
    body = (
        '    assert result["absolutePeak"] == 0.95\n'
        "    averaged = np.abs(samples.reshape(50, -1).mean(axis=1))\n"
        '    assert_not_drawn(result["absolutePeak"], float(averaged.max()))\n'
    )
    assert _problem(tmp_path, body) is None
    # The same told apart by a plain inequality, or by a margin.
    assert _problem(tmp_path, body.replace("assert_not_drawn(", "assert not np.allclose(")) is None
    by_margin = '    assert result["absolutePeak"] - float(averaged.max()) > 0.5\n'
    assert _problem(tmp_path, body.rsplit("\n", 2)[0] + "\n" + by_margin) is None


def test_a_proof_with_no_negative_assertion_or_one_against_a_constant_fails(tmp_path: Path) -> None:
    equal_only = '    assert result["absolutePeak"] == 0.95\n'
    weak = [
        equal_only,
        equal_only + '    assert result["absolutePeak"] is not None\n',
        equal_only + '    assert result["absolutePeak"] != 0.3\n',
        equal_only + "    floor = 0.3\n" + '    assert_not_drawn(result["absolutePeak"], floor)\n',
        equal_only + '    assert_not_drawn(result["absolutePeak"], result["absolutePeak"])\n',
    ]
    for body in weak:
        problem = _problem(tmp_path, body)
        assert problem is not None and "asserts no case where the full data and the drawn points" in problem, body


def test_a_proof_that_never_calls_the_rows_code_fails(tmp_path: Path) -> None:
    body = (
        '    assert result["absolutePeak"] == 0.95\n'
        '    assert_not_drawn(result["absolutePeak"], float(np.abs(samples[::100]).max()))\n'
    )
    problem = _problem(tmp_path, body, {"stage_view:stage_view"})
    assert problem is not None and "never reaches it" in problem
