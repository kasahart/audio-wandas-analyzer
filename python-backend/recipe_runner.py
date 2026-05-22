"""Execute a wandas analysis recipe and emit ChartSpec JSON.

A *recipe* is a JSON document of the form::

    {
        "inputs": [
            {"name": "sig", "file": "path/to/a.wav"},
            {"name": "ref", "file": "path/to/b.wav"}
        ],
        "steps": [
            {"as": "filtered", "expr": "sig.band_pass_filter(low_cutoff=100, high_cutoff=2000)"},
            {"as": "welch",    "expr": "filtered.welch(n_fft=4096)"}
        ],
        "display": [
            {"name": "welch", "title": "Welch (100–2000 Hz)"}
        ]
    }

The runner evaluates each ``expr`` under a restricted AST whitelist (see
:func:`_validate_node`) and binds the resulting object to ``as``. Bindings
declared earlier can be referenced by later steps. Every name listed in
``display`` is then adapted via ``wandas_to_chart.adapt`` and the list of
resulting ChartSpec dicts is printed to stdout as JSON.

AST whitelist (all other nodes raise ``RecipeError``):

* ``Expression``       — the top-level wrapper for ``eval``-style code.
* ``Call``             — method/function invocation, keyword args allowed.
* ``Attribute``        — ``foo.bar`` access on bound names (used for fluent
  method chains like ``sig.filter().welch()``). The attribute string itself
  is allowed because resolution happens at runtime against trusted wandas
  objects — there is no global ``__builtins__`` exposed to ``eval``.
* ``Name``             — must resolve to a binding declared in ``inputs`` or
  an earlier ``steps[].as``. Unknown names raise.
* ``Constant``         — ``int``, ``float``, ``str``, ``bool``, ``None``.
* ``keyword``          — keyword argument passthrough.
* ``UnaryOp(USub/UAdd)`` — for negative literal arguments like ``-3.0``.
* ``BinOp(Add/Sub/Mult/Div/Pow)`` between numeric ``Constant``/``Name`` only.
* ``List`` / ``Tuple`` — for arguments like ``freqs=[100, 200]``.

Specifically *not* allowed: ``Import``, ``Subscript``, ``Lambda``, ``If``,
``Assign``, ``Comprehension``, ``Starred``, ``Yield``, ``Await``,
``GeneratorExp``, ``Dict`` (use kwargs instead), ``FormattedValue`` /
f-strings, ``Compare`` and ``BoolOp``, plus any double-underscore attribute.

This is not a security boundary against a hostile recipe author — anyone
who can write recipe files can also write ``settings.json``. It just keeps
typos from silently doing surprising things.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any

import wandas as wd

from wandas_to_chart import adapt


class RecipeError(RuntimeError):
    """Raised when a recipe is malformed or its expression is rejected."""


# ---- AST whitelist ---------------------------------------------------------

_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)
_ALLOWED_UNARY = (ast.USub, ast.UAdd)


def _validate_node(node: ast.AST, bindings: set[str]) -> None:
    """Walk the AST and raise ``RecipeError`` on any disallowed construct."""
    if isinstance(node, ast.Expression):
        _validate_node(node.body, bindings)
        return
    if isinstance(node, ast.Call):
        _validate_node(node.func, bindings)
        for a in node.args:
            _validate_node(a, bindings)
        for k in node.keywords:
            if k.arg is None:  # **kwargs splat
                raise RecipeError("**kwargs is not allowed in recipe expressions")
            _validate_node(k.value, bindings)
        return
    if isinstance(node, ast.Attribute):
        if node.attr.startswith("_"):
            raise RecipeError(f"Access to dunder/private attribute '{node.attr}' is not allowed")
        _validate_node(node.value, bindings)
        return
    if isinstance(node, ast.Name):
        if node.id not in bindings:
            raise RecipeError(f"Unknown name '{node.id}'. Declare it in inputs or an earlier step.")
        return
    if isinstance(node, ast.Constant):
        if not isinstance(node.value, int | float | str | bool | type(None)):
            raise RecipeError(f"Constant of type {type(node.value).__name__} is not allowed")
        return
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, _ALLOWED_UNARY):
        _validate_node(node.operand, bindings)
        return
    if isinstance(node, ast.BinOp) and isinstance(node.op, _ALLOWED_BINOPS):
        _validate_node(node.left, bindings)
        _validate_node(node.right, bindings)
        return
    if isinstance(node, ast.List | ast.Tuple):
        for elt in node.elts:
            _validate_node(elt, bindings)
        return
    raise RecipeError(f"AST node {type(node).__name__} is not allowed in recipe expressions")


def _eval_expr(expr: str, bindings: dict[str, Any]) -> Any:
    """Parse, whitelist-validate and evaluate a single recipe expression."""
    tree = ast.parse(expr, mode="eval")
    _validate_node(tree, set(bindings.keys()))
    # ``__builtins__`` is replaced with an empty dict so that even if a name
    # somehow slips through, it cannot reach exec/import/open.
    return eval(  # noqa: S307 — controlled by AST whitelist above
        compile(tree, filename="<recipe>", mode="eval"),
        {"__builtins__": {}},
        bindings,
    )


# ---- recipe loading & execution -------------------------------------------


def _load_recipe(path: str | None) -> dict[str, Any]:
    if path is None or path == "-":
        return json.load(sys.stdin)
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _load_inputs(inputs: list[dict[str, Any]], base_dir: Path) -> dict[str, Any]:
    bindings: dict[str, Any] = {}
    for item in inputs:
        name = str(item["name"])
        file = str(item["file"])
        resolved = Path(file)
        if not resolved.is_absolute():
            resolved = (base_dir / resolved).resolve()
        bindings[name] = wd.read_wav(str(resolved))
    return bindings


def run_recipe(recipe: dict[str, Any], base_dir: Path) -> list[dict[str, Any]]:
    inputs = recipe.get("inputs") or []
    steps = recipe.get("steps") or []
    display = recipe.get("display") or []

    bindings = _load_inputs(inputs, base_dir)

    for step in steps:
        name = str(step["as"])
        expr = str(step["expr"])
        bindings[name] = _eval_expr(expr, bindings)

    charts: list[dict[str, Any]] = []
    for entry in display:
        if isinstance(entry, str):
            name, title, kwargs = entry, entry, {}
        else:
            name = str(entry["name"])
            title = str(entry.get("title", name))
            kwargs = {k: v for k, v in entry.items() if k not in ("name", "title")}
        if name not in bindings:
            raise RecipeError(f"display target '{name}' was not produced by any step")
        charts.append(adapt(bindings[name], title=title, **kwargs))
    return charts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a wandas analysis recipe → ChartSpec JSON")
    parser.add_argument("--recipe", help="Path to the recipe JSON file (omit or '-' to read stdin)")
    args = parser.parse_args(argv)

    try:
        recipe = _load_recipe(args.recipe)
        base_dir = Path(args.recipe).resolve().parent if args.recipe and args.recipe != "-" else Path.cwd()
        charts = run_recipe(recipe, base_dir)
    except RecipeError as e:
        print(f"recipe error: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        return 1

    json.dump({"charts": charts}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
