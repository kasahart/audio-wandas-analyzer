"""Check that a pytest named as proof that code computes from the full data really shows it (plot contracts, R1/R7).

The contract table (src/test/plotContracts) names tests that tell the full data from the drawn points. For a pytest,
this script checks, by its code and not its words, that the test:

- reaches the code: it calls a backend function (imported from its module) that is, or calls, one of the row's
  backend functions (followed through the backend's own calls, and the test module's own helpers);
- asserts that code's answer outright (``==``, ``pytest.approx``, ``np.testing.assert_allclose`` …);
- and asserts it is not the answer the drawn points give: ``assert_not_drawn(answer, drawn)`` (conftest.py), or
  ``!=``, ``<``/``>``, ``answer - drawn > margin``, ``not np.allclose(...)``, ``pytest.raises(AssertionError)``
  around an equality. One side is the code's answer, the other is made of the test's inputs too: never ``None``, a
  number, or a name holding a constant, and never the same expression.

Input (stdin): JSON ``[{"targets": ["python-backend/mod.py:func", ...], "file": "python-backend/test_x.py",
"name": "test_..."}]``. Output: JSON, a problem (text) or null for each.
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "python-backend"

POSITIVE_CALLS = frozenset(
    {
        "assert_allclose",
        "assert_array_equal",
        "assert_equal",
        "assert_almost_equal",
        "assert_array_almost_equal",
        "allclose",
        "array_equal",
        "isclose",
        "approx",
    }
)
EQUALITY_CALLS = frozenset({"allclose", "array_equal", "isclose", "array_equiv"})
#: conftest.py's helper: ``assert_not_drawn(answer, drawn)``.
NOT_DRAWN = "assert_not_drawn"
#: A call of a method by its name alone (see ``resolve``).
METHOD = "<method>"
#: Method names of built-in containers and files: never taken for a backend def of the same name.
COMMON_METHODS = frozenset(
    {"get", "items", "keys", "values", "append", "extend", "update", "copy", "read", "write", "close", "add", "pop"}
    | {"join", "split", "format", "index", "count", "sort", "setdefault", "clear", "remove", "insert", "tolist"}
)
CONSTANT_NAMES = frozenset({"None", "True", "False", "inf", "nan", "pi"})


class Backend:
    """The backend's defs by ``module:function`` and what each calls (resolved through its module's imports)."""

    def __init__(self) -> None:
        self.calls: dict[str, set[str]] = {}
        self.modules: set[str] = set()
        for path in sorted(BACKEND.glob("*.py")):
            if path.name.startswith("test_") or path.name == "conftest.py":
                continue
            self.modules.add(path.stem)
        for module in sorted(self.modules):
            self.index(module, ast.parse((BACKEND / f"{module}.py").read_text(encoding="utf-8")))

    def imports(self, tree: ast.Module) -> tuple[dict[str, str], dict[str, str]]:
        """The names a module binds to backend functions (``from mod import f``) and to backend modules."""
        names: dict[str, str] = {}
        aliases: dict[str, str] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module in self.modules:
                for alias in node.names:
                    names[alias.asname or alias.name] = f"{node.module}:{alias.name}"
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name in self.modules:
                        aliases[alias.asname or alias.name] = alias.name
        return names, aliases

    def index(self, module: str, tree: ast.Module) -> None:
        names, aliases = self.imports(tree)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            here = f"{module}:{node.name}"
            called = self.calls.setdefault(here, set())
            for inner in ast.walk(node):
                target = resolve(inner, module, names, aliases) if isinstance(inner, ast.Call) else None
                if target:
                    called.add(target)

    def reachers(self, targets: set[str]) -> set[str]:
        reach = set(targets)
        reach |= {f"{METHOD}:{target.split(':')[1]}" for target in targets}
        grown = True
        while grown:
            grown = False
            for caller, called in self.calls.items():
                if caller not in reach and called & reach:
                    reach.add(caller)
                    reach.add(f"{METHOD}:{caller.split(':')[1]}")
                    grown = True
        return reach


def resolve(call: ast.Call, module: str, names: dict[str, str], aliases: dict[str, str]) -> str | None:
    func = call.func
    if isinstance(func, ast.Name):
        return names.get(func.id, f"{module}:{func.id}")
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id in aliases:
        return f"{aliases[func.value.id]}:{func.attr}"
    if isinstance(func, ast.Attribute) and func.attr not in COMMON_METHODS:
        # A method of some object (``service.analyze(...)``, ``self.engine.analyze(...)``): any backend def of that
        # name. The object's class is not followed, so this may reach more than it should, never less.
        return f"{METHOD}:{func.attr}"
    return None


def callee_name(call: ast.Call) -> str:
    func = call.func
    return func.attr if isinstance(func, ast.Attribute) else func.id if isinstance(func, ast.Name) else ""


def names_in(node: ast.AST) -> set[str]:
    return {inner.id for inner in ast.walk(node) if isinstance(inner, ast.Name)}


def targets_of(target: ast.AST) -> list[str]:
    return [inner.id for inner in ast.walk(target) if isinstance(inner, ast.Name)]


class Proof:
    """One test's body: what its answers are, and what it asserts of them."""

    def __init__(self, backend: Backend, file: Path, name: str, targets: set[str]) -> None:
        tree = ast.parse(file.read_text(encoding="utf-8"))
        self.module = f"<test>:{file.stem}"
        names, aliases = backend.imports(tree)
        self.names, self.aliases = names, aliases
        # The test module's own helpers are followed as the backend's are.
        local: dict[str, set[str]] = {}
        self.test: ast.FunctionDef | None = None
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                called = set()
                for inner in ast.walk(node):
                    if isinstance(inner, ast.Call):
                        target = resolve(inner, file.stem, names, aliases)
                        if target:
                            called.add(target)
                local[f"{file.stem}:{node.name}"] = called
                if node.name == name and isinstance(node, ast.FunctionDef):
                    self.test = node
        graph = Backend.__new__(Backend)
        graph.calls = {**backend.calls, **local}
        self.reach = graph.reachers(targets)
        self.file_stem = file.stem

    def reaching(self, node: ast.AST) -> bool:
        return any(
            isinstance(inner, ast.Call) and resolve(inner, self.file_stem, self.names, self.aliases) in self.reach
            for inner in ast.walk(node)
        )

    def check(self) -> str | None:
        test = self.test
        if test is None:
            return "is not a test of its file"
        if not self.reaching(test):
            return f'"{test.name}" never reaches it'
        answers: set[str] = set()
        constants = set(CONSTANT_NAMES)
        grown = True
        while grown:
            grown = False
            for node in ast.walk(test):
                value, bound = None, []
                if isinstance(node, ast.Assign):
                    value, bound = node.value, [name for target in node.targets for name in targets_of(target)]
                elif isinstance(node, (ast.AnnAssign, ast.AugAssign)) and node.value is not None:
                    value, bound = node.value, targets_of(node.target)
                elif isinstance(node, (ast.For, ast.comprehension)):
                    value, bound = node.iter, targets_of(node.target)
                elif isinstance(node, ast.withitem) and node.optional_vars is not None:
                    value, bound = node.context_expr, targets_of(node.optional_vars)
                if value is None:
                    continue
                if self.reaching(value) or names_in(value) & answers:
                    new = set(bound) - answers
                    if new:
                        answers |= new
                        grown = True
                elif not (names_in(value) - constants) and isinstance(node, ast.Assign):
                    new = set(bound) - constants
                    if new:
                        constants |= new
                        grown = True

        def answer(node: ast.AST) -> bool:
            return self.reaching(node) or bool(names_in(node) & answers)

        def constant(node: ast.AST) -> bool:
            return not (names_in(node) - constants - {"np", "math", "pytest", "float", "int", "abs"})

        def told_apart(left: ast.AST, right: ast.AST) -> bool:
            return (
                not constant(left)
                and not constant(right)
                and (answer(left) or answer(right))
                and ast.dump(left) != ast.dump(right)
            )

        positive = negative = False
        for node in ast.walk(test):
            if isinstance(node, ast.Assert):
                test_expr = node.test
                negated = isinstance(test_expr, ast.UnaryOp) and isinstance(test_expr.op, ast.Not)
                inner = test_expr.operand if negated else test_expr
                if isinstance(inner, ast.Compare) and len(inner.ops) == 1:
                    left, right, op = inner.left, inner.comparators[0], inner.ops[0]
                    # ``answer - drawn > 3`` (or ``abs(answer - drawn) > 3``): the two are apart by more than a margin.
                    gap = (
                        left.args[0]
                        if isinstance(left, ast.Call) and callee_name(left) == "abs" and left.args
                        else left
                    )
                    if (
                        not negated
                        and isinstance(op, (ast.Gt, ast.GtE))
                        and isinstance(gap, ast.BinOp)
                        and isinstance(gap.op, ast.Sub)
                        and told_apart(gap.left, gap.right)
                    ):
                        negative = True
                        continue
                    unequal = isinstance(op, (ast.NotEq, ast.Lt, ast.Gt, ast.LtE, ast.GtE, ast.IsNot))
                    equal = isinstance(op, (ast.Eq, ast.Is))
                    if negated:
                        unequal, equal = equal, unequal
                    if unequal and isinstance(op, (ast.LtE, ast.GtE)) and not negated:
                        unequal = False  # ≤ / ≥ allow the two to be equal
                    if unequal and told_apart(left, right):
                        negative = True
                    elif equal and (answer(left) or answer(right)):
                        positive = True
                elif isinstance(inner, ast.Call) and callee_name(inner) in EQUALITY_CALLS and len(inner.args) >= 2:
                    if negated and told_apart(inner.args[0], inner.args[1]):
                        negative = True
                    elif not negated and any(answer(arg) for arg in inner.args[:2]):
                        positive = True
            elif isinstance(node, ast.Call) and callee_name(node) == NOT_DRAWN and len(node.args) >= 2:
                if told_apart(node.args[0], node.args[1]):
                    negative = True
            elif isinstance(node, ast.Call) and callee_name(node) in POSITIVE_CALLS and callee_name(node) != "approx":
                asserted = callee_name(node).startswith("assert_") and any(answer(arg) for arg in node.args[:2])
                if asserted and not self.inside_raises(test, node):
                    positive = True
            if isinstance(node, ast.With) and self.raises_assertion(node):
                for statement in node.body:
                    for call in ast.walk(statement):
                        if (
                            isinstance(call, ast.Call)
                            and callee_name(call).startswith("assert_")
                            and len(call.args) >= 2
                            and told_apart(call.args[0], call.args[1])
                        ):
                            negative = True
        if not (positive and negative):
            return f'"{test.name}" asserts no case where the full data and the drawn points give different answers'
        return None

    @staticmethod
    def raises_assertion(node: ast.With) -> bool:
        """Whether ``node`` is ``with pytest.raises(AssertionError):``."""
        for item in node.items:
            expr = item.context_expr
            if not (isinstance(expr, ast.Call) and callee_name(expr) == "raises" and expr.args):
                continue
            if isinstance(expr.args[0], ast.Name) and expr.args[0].id == "AssertionError":
                return True
        return False

    def inside_raises(self, test: ast.FunctionDef, call: ast.Call) -> bool:
        blocks = [node for node in ast.walk(test) if isinstance(node, ast.With) and self.raises_assertion(node)]
        return any(inner is call for block in blocks for statement in block.body for inner in ast.walk(statement))


def check(items: list[dict[str, object]]) -> list[str | None]:
    backend = Backend()
    out: list[str | None] = []
    for item in items:
        targets = {
            str(target).removeprefix("python-backend/").replace(".py:", ":", 1)
            for target in item["targets"]  # type: ignore[union-attr]
            if ".py:" in str(target)
        }
        file = ROOT / str(item["file"])
        if not targets:
            out.append(f'"{item["name"]}" is a pytest, but the row computes nothing in the backend')
            continue
        if not file.exists():
            out.append(f"no file {item['file']}")
            continue
        out.append(Proof(backend, file, str(item["name"]), targets).check())
    return out


if __name__ == "__main__":
    print(json.dumps(check(json.load(sys.stdin))))
