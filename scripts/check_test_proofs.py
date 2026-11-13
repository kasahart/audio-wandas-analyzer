"""Check that a pytest named as proof that code computes from the full data really shows it (plot contracts, R1/R7).

The contract table (src/test/plotContracts) names tests that tell the full data from the drawn points. For a pytest,
this script checks, by its code and not its words, that the test:

- reaches the code: it calls a backend function (imported from its module) that is, or calls, one of the row's
  backend functions (followed through the backend's own calls, and the test module's own helpers);
- asserts that code's answer outright (``==``, ``pytest.approx``, ``np.testing.assert_allclose`` …);
- and asserts it is not the answer the drawn points give, the one way: ``assert_not_drawn(answer, drawn)``
  (conftest.py). The call is known by the test module's import of it, so another function of that name is not it.
  The code's answer comes first; second comes something worked out in the test: never ``None``, a number, a name
  holding a constant, or the first argument again;
- and does both of the same value: the expression stated outright is the one told apart.

What this cannot see: whether ``drawn`` really is what the thinned points would give, and whether the answer asserted
is the value the row is about. Those are for the reviewer (docs/plot-contracts-guide.md).

A pytest is named as pytest collects it, by ``tests_of`` (the one discovery, which src/test/namedTest.ts asks too):
``test_y`` for a test function of the module, ``TestX::test_y`` for a test method of a test class (classes nested
in it joined the same way). A name that is not a test of its file is a problem, whatever def of that name is in it.

Input (stdin): JSON ``[{"targets": ["python-backend/mod.py:func", ...], "file": "python-backend/test_x.py",
"name": "test_..."}]``. Output: JSON, a problem (text) or null for each.

``--tests`` instead reads JSON ``[source text, ...]`` and writes, for each, every test of it (``tests_of``) and every
def (by its name in its module, ``Class.method`` for a method) with its lines: the discovery the TypeScript checks
use, so a name is a test for both or for neither.
"""

from __future__ import annotations

import ast
import json
import sys
from dataclasses import dataclass
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
#: The one helper that tells an answer from the drawn points': ``assert_not_drawn`` of conftest.py. A call counts
#: only when the name it calls is bound to this by the test module's imports (``Proof.not_drawn``), not by its spelling.
NOT_DRAWN = ("conftest", "assert_not_drawn")
#: A call of a method by its name alone (see ``resolve``).
METHOD = "<method>"
#: Method names of built-in containers and files: never taken for a backend def of the same name.
COMMON_METHODS = frozenset(
    {"get", "items", "keys", "values", "append", "extend", "update", "copy", "read", "write", "close", "add", "pop"}
    | {"join", "split", "format", "index", "count", "sort", "setdefault", "clear", "remove", "insert", "tolist"}
)
CONSTANT_NAMES = frozenset({"None", "True", "False", "inf", "nan", "pi"})

Def = ast.FunctionDef | ast.AsyncFunctionDef


@dataclass(frozen=True)
class Found:
    """A def of a test file: its node, and the decorators above it and above each class it is in, outermost first."""

    node: Def
    decorators: tuple[ast.expr, ...]


def _collected_class(node: ast.ClassDef) -> bool:
    """Whether pytest collects ``node`` as a test class: named ``Test…`` and with no ``__init__`` of its own."""
    return node.name.startswith("Test") and not any(
        isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == "__init__" for item in node.body
    )


def tests_of(tree: ast.Module) -> dict[str, Found]:
    """Every test pytest collects of a module (its default rules: ``test…`` functions of the module, ``test…``
    methods of ``Test…`` classes without ``__init__``, nested ones too), by the name it collects it under:
    ``test_y`` or ``TestX::test_y``. The one test discovery of the repository: check() and src/test/namedTest.ts both
    name a pytest by it."""
    found: dict[str, Found] = {}

    def walk(body: list[ast.stmt], prefix: str, decorators: tuple[ast.expr, ...]) -> None:
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test"):
                found.setdefault(f"{prefix}{node.name}", Found(node, (*decorators, *node.decorator_list)))
            elif isinstance(node, ast.ClassDef) and _collected_class(node):
                walk(node.body, f"{prefix}{node.name}::", (*decorators, *node.decorator_list))

    walk(tree.body, "", ())
    return found


def defs_of(tree: ast.Module) -> dict[str, Def]:
    """Every def of a module at its top or in its classes, by ``function`` or ``Class.method`` (nested classes
    joined by dots); a def inside a def is part of that def's body."""
    found: dict[str, Def] = {}

    def walk(body: list[ast.stmt], prefix: str) -> None:
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                found.setdefault(f"{prefix}{node.name}", node)
            elif isinstance(node, ast.ClassDef):
                walk(node.body, f"{prefix}{node.name}.")

    walk(tree.body, "")
    return found


def not_a_test(tree: ast.Module, name: str) -> str:
    """Why ``name`` is not a test of ``tree``, naming the test it may mean (a def of that name in a test class)."""
    meant = sorted(test for test in tests_of(tree) if test.rsplit("::", 1)[-1] == name.rsplit("::", 1)[-1])
    hint = f": name it {' or '.join(repr(test) for test in meant)}" if meant and name not in meant else ""
    return f"is not a test of its file{hint}"


def _lines(node: Def) -> tuple[int, int]:
    return node.lineno, node.end_lineno or node.lineno


def discovery(text: str) -> dict[str, object]:
    """``text``'s tests and defs, as src/test/namedTest.ts reads them: each with its def's first and last line and
    the first line of its decorators (and of those of the classes it is in)."""
    tree = ast.parse(text)
    tests = {}
    for name, found in tests_of(tree).items():
        first, last = _lines(found.node)
        tests[name] = {
            "line": first,
            "end": last,
            "declared": [ast.get_source_segment(text, decorator) or "" for decorator in found.decorators],
        }
    defs = {name: dict(zip(("line", "end"), _lines(node), strict=True)) for name, node in defs_of(tree).items()}
    return {"tests": tests, "defs": defs}


class Backend:
    """The backend's defs by ``module:function`` and what each calls (resolved through its module's imports)."""

    def __init__(self) -> None:
        self.calls: dict[str, set[str]] = {}
        self.modules: set[str] = set()
        #: Each module's names bound by ``from mod import f``: what a name re-exported from it really is.
        self.exports: dict[str, dict[str, str]] = {}
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

    def canonical(self, target: str | None) -> str | None:
        """``mod:f`` followed through re-exports (``mod`` only imports ``f`` from another backend module) to its def."""
        seen: set[str] = set()
        while target and target not in self.calls and target not in seen:
            seen.add(target)
            module, _, name = target.partition(":")
            target = self.exports.get(module, {}).get(name, target)
        return target

    def index(self, module: str, tree: ast.Module) -> None:
        names, aliases = self.imports(tree)
        self.exports[module] = names
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
        targets = {self.canonical(target) or target for target in targets}
        calls = {
            caller: {self.canonical(called) or called for called in all_called}
            for caller, all_called in self.calls.items()
        }
        reach = set(targets)
        reach |= {f"{METHOD}:{target.split(':')[1]}" for target in targets}
        grown = True
        while grown:
            grown = False
            for caller, called in calls.items():
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
        # A method of a class is a helper too (``self.helper()`` is a call of a method by its name): its key's
        # part after the colon is its own name, as for any method (``reachers``).
        local: dict[str, set[str]] = {}
        for qualified, node in defs_of(tree).items():
            cls, _, own = qualified.rpartition(".")
            called = set()
            for inner in ast.walk(node):
                if isinstance(inner, ast.Call):
                    target = resolve(inner, file.stem, names, aliases)
                    if target:
                        called.add(target)
            local[f"{file.stem}{'.' + cls if cls else ''}:{own}"] = called
        found = tests_of(tree).get(name)
        self.test: Def | None = found.node if found else None
        self.tree = tree
        self.name = name
        graph = Backend.__new__(Backend)
        graph.calls = {**backend.calls, **local}
        graph.exports = backend.exports
        self.graph = graph
        # The names this module binds to conftest's helper (``from conftest import assert_not_drawn [as x]``), and
        # to conftest itself (``import conftest [as c]``). A def or an assignment of the same name later in the
        # module takes the name away: it is no longer the helper.
        helper_module, helper = NOT_DRAWN
        self.not_drawn: set[str] = set()
        self.helper_modules: set[str] = set()
        for node in tree.body:
            if isinstance(node, ast.ImportFrom) and node.module == helper_module:
                self.not_drawn |= {alias.asname or alias.name for alias in node.names if alias.name == helper}
            elif isinstance(node, ast.Import):
                self.helper_modules |= {
                    alias.asname or alias.name for alias in node.names if alias.name == helper_module
                }
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.not_drawn.discard(node.name)
            elif isinstance(node, ast.Assign):
                self.not_drawn -= {name for target in node.targets for name in targets_of(target)}
        self.reach = graph.reachers(targets)
        self.file_stem = file.stem

    def reaching(self, node: ast.AST) -> bool:
        return any(
            isinstance(inner, ast.Call)
            and self.graph.canonical(resolve(inner, self.file_stem, self.names, self.aliases)) in self.reach
            for inner in ast.walk(node)
        )

    def is_not_drawn(self, call: ast.Call) -> bool:
        """Whether ``call`` calls conftest's ``assert_not_drawn``, by what the name is bound to in this module."""
        func = call.func
        if isinstance(func, ast.Name):
            return func.id in self.not_drawn
        named = isinstance(func, ast.Attribute) and func.attr == NOT_DRAWN[1] and isinstance(func.value, ast.Name)
        return named and func.value.id in self.helper_modules  # type: ignore[union-attr]

    def check(self) -> str | None:
        test = self.test
        if test is None:
            return not_a_test(self.tree, self.name)
        if not self.reaching(test):
            return f'"{self.name}" never reaches it'
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

        # The value stated outright and the value told apart from the drawn points must be the same one: the same
        # expression (``result["absolutePeak"]`` in both), not two answers of the same code.
        stated: set[str] = set()
        told: list[str] = []

        def state(*sides: ast.AST) -> None:
            for side in sides:
                # ``x == pytest.approx(y)``: what is stated is x and y, not the approx call.
                inner = (
                    side.args[0] if isinstance(side, ast.Call) and callee_name(side) == "approx" and side.args else side
                )
                if answer(inner):
                    stated.add(ast.dump(inner))

        for node in ast.walk(test):
            if isinstance(node, ast.Assert):
                inner = node.test
                if (
                    isinstance(inner, ast.Compare)
                    and len(inner.ops) == 1
                    and isinstance(inner.ops[0], (ast.Eq, ast.Is))
                ):
                    state(inner.left, inner.comparators[0])
                elif isinstance(inner, ast.Call) and callee_name(inner) in EQUALITY_CALLS and len(inner.args) >= 2:
                    state(*inner.args[:2])
            elif isinstance(node, ast.Call) and self.is_not_drawn(node) and len(node.args) >= 2:
                mine, drawn = node.args[0], node.args[1]
                if answer(mine) and not constant(drawn) and ast.dump(mine) != ast.dump(drawn):
                    told.append(ast.dump(mine))
            elif isinstance(node, ast.Call) and callee_name(node) in POSITIVE_CALLS and callee_name(node) != "approx":
                if callee_name(node).startswith("assert_") and not self.inside_raises(test, node):
                    state(*node.args[:2])
        if not stated or not told:
            return f'"{self.name}" asserts no case where the full data and the drawn points give different answers'
        if not any(value in stated for value in told):
            return (
                f'"{self.name}" states one value outright and tells another apart from the drawn points: '
                "`assert X == expected` and `assert_not_drawn(X, drawn)` must be of the same expression X"
            )
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

    def inside_raises(self, test: Def, call: ast.Call) -> bool:
        blocks = [node for node in ast.walk(test) if isinstance(node, ast.With) and self.raises_assertion(node)]
        return any(inner is call for block in blocks for statement in block.body for inner in ast.walk(statement))


_backend: Backend | None = None


def backend_index() -> Backend:
    """The backend's index, built once in a run: every module is parsed to follow calls, which is the slow part."""
    global _backend
    if _backend is None:
        _backend = Backend()
    return _backend


def check(items: list[dict[str, object]]) -> list[str | None]:
    backend = backend_index()
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


def main(argv: list[str]) -> int:
    data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if argv == ["--tests"]:
        print(json.dumps([discovery(str(text)) for text in data]))
    else:
        print(json.dumps(check(data)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
