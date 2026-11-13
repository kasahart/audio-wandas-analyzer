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
    return proofs.Proof(proofs.backend_index(), file, "test_it", targets or TARGET).check()


def test_a_proof_that_asserts_the_answer_and_tells_it_from_the_drawn_points_passes(tmp_path: Path) -> None:
    body = (
        '    assert result["absolutePeak"] == 0.95\n'
        "    averaged = np.abs(samples.reshape(50, -1).mean(axis=1))\n"
        '    assert_not_drawn(result["absolutePeak"], float(averaged.max()))\n'
    )
    assert _problem(tmp_path, body) is None
    # One form only, so every proof reads the same way: another negative assertion, or a margin, is not the helper.
    for other in (
        body.replace("assert_not_drawn(", "assert not np.allclose("),
        body.rsplit("\n", 2)[0] + '\n    assert result["absolutePeak"] - float(averaged.max()) > 0.5\n',
    ):
        problem = _problem(tmp_path, other)
        assert problem is not None and "asserts no case where the full data and the drawn points" in problem, other
    # The answer comes first: the drawn points' answer told apart from something else proves nothing of the code.
    swapped = body.replace(
        'assert_not_drawn(result["absolutePeak"], float(averaged.max()))',
        "assert_not_drawn(float(averaged.max()), 0.5 * samples[0] + 3)",
    )
    assert _problem(tmp_path, swapped) is not None


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


def test_the_helper_is_known_by_its_import_not_its_spelling(tmp_path: Path) -> None:
    body = (
        '    assert result["absolutePeak"] == 0.95\n'
        "    averaged = np.abs(samples.reshape(50, -1).mean(axis=1))\n"
        '    assert_not_drawn(result["absolutePeak"], float(averaged.max()))\n'
    )
    file = tmp_path / "test_injected.py"

    def problem(head: str, text: str = body) -> str | None:
        file.write_text(head + SETUP + text, encoding="utf-8")
        return proofs.Proof(proofs.backend_index(), file, "test_it", TARGET).check()

    renamed = HEAD.replace("import assert_not_drawn", "import assert_not_drawn as apart")
    assert problem(renamed, body.replace("assert_not_drawn(", "apart(")) is None
    through_module = HEAD.replace("from conftest import assert_not_drawn", "import conftest")
    assert problem(through_module, body.replace("assert_not_drawn(", "conftest.assert_not_drawn(")) is None
    # A function of the same name that is not conftest's, defined here or imported from elsewhere.
    own = HEAD + "def assert_not_drawn(*_):\n    pass\n\n\n"
    not_imported = HEAD.replace(
        "from conftest import assert_not_drawn\n", "from numpy.testing import assert_equal as assert_not_drawn\n"
    )
    for head in (own, not_imported):
        found = problem(head)
        assert found is not None and "asserts no case where the full data and the drawn points" in found, head


def test_the_value_stated_and_the_value_told_apart_are_the_same_one(tmp_path: Path) -> None:
    body = (
        '    assert result["absolutePeak"] == 0.95\n'
        "    averaged = np.abs(samples.reshape(50, -1).mean(axis=1))\n"
        '    assert_not_drawn(len(result["min"]), float(averaged.max()))\n'
    )
    found = _problem(tmp_path, body)
    assert found is not None and "states one value outright and tells another apart" in found


def test_reach_follows_a_function_re_exported_from_another_module() -> None:
    backend = proofs.Backend.__new__(proofs.Backend)
    backend.calls = {"core:compute": set(), "facade:run": {"facade:compute"}}
    backend.exports = {"facade": {"compute": "core:compute"}, "core": {}}
    assert backend.canonical("facade:compute") == "core:compute"
    assert "facade:run" in backend.reachers({"core:compute"})


# ── One discovery of pytests, class-qualified, for this check and src/test/namedTest.ts (#777) ──

PROVEN = (
    '    assert result["absolutePeak"] == 0.95\n'
    "    averaged = np.abs(samples.reshape(50, -1).mean(axis=1))\n"
    '    assert_not_drawn(result["absolutePeak"], float(averaged.max()))\n'
)


def _held_in_a_class(tmp_path: Path) -> Path:
    """The passing proof moved into a pytest class, as a method."""
    lines = (SETUP + PROVEN).replace("(", "(self", 1).split("\n")
    method = "\n".join(f"    {line}" if line else line for line in lines)
    file = tmp_path / "test_held.py"
    file.write_text(HEAD + "class TestHeld:\n" + method, encoding="utf-8")
    return file


def test_a_proof_moved_into_a_pytest_class_is_named_by_its_class_and_accepted(tmp_path: Path) -> None:
    file = _held_in_a_class(tmp_path)
    assert proofs.Proof(proofs.backend_index(), file, "TestHeld::test_it", TARGET).check() is None
    # Named without its class, it is not a test of the file, and the problem names the name that is (the fix passes).
    problem = proofs.Proof(proofs.backend_index(), file, "test_it", TARGET).check()
    assert problem == "is not a test of its file: name it 'TestHeld::test_it'"


def test_the_discovery_names_tests_as_pytest_collects_them() -> None:
    import ast

    source = (
        "def test_a():\n    pass\n\ndef helper():\n    pass\n\n"
        "class TestGroup:\n    def test_b(self):\n        pass\n\n    class TestInner:\n        def test_c(self):\n"
        "            pass\n\n"
        "class TestWithInit:\n    def __init__(self):\n        pass\n\n    def test_d(self):\n        pass\n\n"
        "class Helper:\n    def test_e(self):\n        pass\n\n"
        "def outer():\n    def test_f():\n        pass\n"
    )
    assert sorted(proofs.tests_of(ast.parse(source))) == ["TestGroup::TestInner::test_c", "TestGroup::test_b", "test_a"]
    found = proofs.discovery(source)
    assert found["tests"]["TestGroup::test_b"] == {"line": 8, "end": 9, "declared": []}
    assert "Helper.test_e" in found["defs"] and "outer" in found["defs"] and "test_f" not in found["defs"]


def test_every_checker_script_is_under_the_same_ruff_and_pyright_commands() -> None:
    # Ruff runs on the paths verify.mjs gives it; pyright on pyproject.toml's include. check_test_proofs.py was in
    # neither, check_decimation_flow.py only in Ruff's.
    import tomllib

    root = SCRIPT.parents[1]
    verify = (root / "scripts" / "verify.mjs").read_text(encoding="utf-8")
    ruff = [line for line in verify.splitlines() if "'-m', 'ruff'" in line]
    include = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))["tool"]["pyright"]["include"]
    checkers = sorted(f"scripts/{path.name}" for path in (root / "scripts").glob("check_*.py"))
    assert checkers == ["scripts/check_decimation_flow.py", "scripts/check_test_proofs.py"]
    for script in checkers:
        assert len(ruff) == 2 and all(f"'{script}'" in line for line in ruff), script
        assert script in include, script
