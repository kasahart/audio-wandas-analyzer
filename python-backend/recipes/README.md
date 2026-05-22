# Recipes

Each `*.json` file in this directory is a self-contained wandas analysis recipe
consumed by `python-backend/recipe_runner.py`. The runner is invoked by the
VS Code command **Audio Wandas Analyzer: Run wandas recipe**.

A recipe has three top-level keys:

| key | meaning |
|---|---|
| `inputs`  | List of `{ "name": "sig", "file": "relative/or/abs.wav" }`. Relative paths are resolved against the recipe file's directory. |
| `steps`   | Sequential `{ "as": "bindingName", "expr": "<wandas call>" }`. Later steps may reference any earlier `as` name (and `inputs` names). |
| `display` | List of `{ "name": "bindingName", "title": "<chart title>" }` (string shorthand is also accepted). Each entry is adapted into a ChartSpec. |

The expression language is a strict subset of Python — see the module
docstring in `recipe_runner.py` for the exact AST whitelist. In short:
method chains, keyword arguments, numeric/string/bool/None literals, list
and tuple literals, and arithmetic on literals are allowed; everything else
(subscript, lambda, imports, comprehensions, dunder access, ...) is not.

## Replacing inputs from the comparison panel

When the runner is invoked via the comparison panel's **Run wandas recipe**
button, the file paths currently checked in the panel are substituted for
the `file` fields of any input whose `file` value is exactly the string
`"{{selection}}"`. The extension fills as many slots as there are checked
files, in order.
