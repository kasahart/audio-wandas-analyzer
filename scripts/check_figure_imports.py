"""Check the figure service's folder rules (docs/figure-design.md 第 2 節 A, B, F and 第 8 節).

By the files' import statements and names alone (ast), never their behaviour:

- A: ``python-backend/figures/`` imports only the standard library, ``figures``, ``frames``, ``wandas`` and
  ``wandas_extras``; ``numpy`` only in the five rule files (members, ranges, thinning, pick, headline: 計算ア〜オ).
  So figures/ never imports ``services/``, ``transport/`` or an entry (backend_server, browser_service).
- B: the names ``Drawn`` and ``DrawnImage`` (an image lane's) appear only in ``figures/thinning.py`` (which makes
  them) and ``figures/picture.py`` (the only receiver); ``wire_points``, the one way out of either, likewise, and
  so do the fields that hold their points (``_xs``, ``_values``, ``_cells`` …, read off the two classes), so a
  thinning function's result cannot be opened anywhere else. No file outside figures/ names any of them.
- R: a Frame's arrays (``data``, ``freqs``, ``times``, ``dB``, ``dBA``) are read only by ``frames/stage_view.py``
  (``read_frame``) and by the services listed in ``FRAME_READERS`` with what they read them for
  (docs/plot-layers.md, "The backend reads a Frame in one place"). By attribute name: an expression named like one
  that is not a Frame's is listed in ``NOT_FRAME_ARRAYS``.
- F: the dependency goes one way. ``frames/`` imports no other folder of the backend; ``services/`` imports only
  ``frames``; ``transport/`` imports ``frames``, ``services`` and ``figures``; none of them imports an entry
  (``backend_server``, ``browser_service``: the only modules of python-backend/ itself).

figures/ is every file under it, in a folder of its own too. numpy is imported as numpy only: a file of figures/
that takes ``np`` or ``numpy`` from another module (``from figures.thinning import np``) fails rule A.

What it cannot see: what a function does with an array it may hold (review and the deliberately wrong
implementations of 第 9 節 catch that); a class reached without its name (``type(drawn_line(...))``); an import
made by ``importlib`` or ``__import__`` outside figures/ (none is allowed in figures/, and this script fails on
either name there; services/ uses importlib to ask which optional packages are installed, so it is not refused
there).

Run: ``python scripts/check_figure_imports.py`` (exit 1 naming every problem). verify runs it in its Python lane.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "python-backend"
FIGURES = BACKEND / "figures"
#: The five rule files, the only ones of figures/ that may import numpy (rule A).
NUMPY_FILES = frozenset({"members.py", "ranges.py", "thinning.py", "pick.py", "headline.py"})
#: Packages figures/ may import besides the standard library and numpy (第 8 節).
FIGURE_IMPORTS = frozenset({"figures", "frames", "wandas", "wandas_extras"})
#: Where the drawn points' type and its one way out may be named (rule B).
DRAWN_FILES = frozenset({"thinning.py", "picture.py"})
DRAWN_NAMES = frozenset({"Drawn", "DrawnImage", "wire_points"})
#: The backend's folders below the entries, each with the folders of the backend it may import (rule F).
BELOW = {
    "frames": frozenset({"frames"}),
    "services": frozenset({"frames", "services"}),
    "transport": frozenset({"frames", "services", "figures", "transport"}),
}
#: A Frame's arrays: read only by frames/stage_view.py's read_frame, and by FRAME_READERS (rule R).
FRAME_ARRAYS = frozenset({"data", "freqs", "times", "dB", "dBA"})
#: The services that read their own Frames for answers outside the comparison and the figure service (rule R).
FRAME_READERS = {
    "frames/stage_view.py": "read_frame: the one reading for the comparison and the figure service",
    "services/analysis_service.py": "the Tracks rows' samples and STFT levels, the region peak, the WAV export",
    "services/analyzer.py": "a recording's summary: each channel's peak, raw and calibrated",
    "services/calibration_profile.py": "the calibration's peak check of the source samples",
    "services/scan_service.py": "the scan's power mean of a step's channels",
}
#: Expressions named like a Frame's array that are not a Frame's (rule R).
NOT_FRAME_ARRAYS = {"events.times": "an EventsAnswer's event times (transport/figure_answers.py), already read"}
#: Every folder and entry of the backend a module could import: what rule F is about.
OWN = frozenset({"frames", "services", "figures", "transport", "backend_server", "browser_service"})


def _imported(tree: ast.AST, package: str) -> list[tuple[int, str]]:
    """Every module a file imports, by its top-level name (a relative import is of its own ``package``)."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found += [(node.lineno, alias.name.split(".")[0]) for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            found.append((node.lineno, package if node.level else (node.module or "").split(".")[0]))
    return found


def _names(tree: ast.AST) -> list[tuple[int, str]]:
    """Every identifier a file uses or defines (names, attributes, imported names, classes, functions)."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            found.append((node.lineno, node.id))
        elif isinstance(node, ast.Attribute):
            found.append((node.lineno, node.attr))
        elif isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            found.append((node.lineno, node.name))
        elif isinstance(node, ast.alias):
            found += [(0, part) for part in (node.name.split(".")[-1], node.asname or "")]
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in DRAWN_NAMES:
            # A string annotation ("Drawn") names the type too.
            found.append((node.lineno, node.value))
    return found


def _drawn_fields(thinning: Path) -> frozenset[str]:
    """The fields of ``Drawn`` and ``DrawnImage`` (figures/thinning.py) that hold the thinned points (the arrays)."""
    if not thinning.exists():
        return frozenset()
    fields: set[str] = set()
    for node in ast.walk(ast.parse(thinning.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ClassDef) and node.name in ("Drawn", "DrawnImage"):
            fields |= {
                item.target.id
                for item in node.body
                if isinstance(item, ast.AnnAssign)
                and isinstance(item.target, ast.Name)
                and "ndarray" in ast.unparse(item.annotation)
            }
    return frozenset(fields)


def _numpy_from_elsewhere(tree: ast.AST) -> list[int]:
    """Lines that take ``np`` or ``numpy`` from a module that is not numpy."""
    return [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] != "numpy"
        for alias in node.names
        if alias.name in ("np", "numpy") or alias.asname in ("np", "numpy")
    ]


def check(backend: Path = BACKEND) -> list[str]:
    figures = backend / "figures"
    problems: list[str] = []
    stdlib = set(sys.stdlib_module_names)
    drawn_fields = _drawn_fields(figures / "thinning.py")
    for path in sorted(backend.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        relative = path.relative_to(backend)
        where = f"python-backend/{relative.as_posix()}"
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        in_figures = figures in path.parents
        drawn_file = path.parent == figures and path.name in DRAWN_FILES
        if in_figures:
            problems += [
                f"{where}:{line}: takes numpy from another module (import numpy itself; rule A)"
                for line in _numpy_from_elsewhere(tree)
            ]
            for line, module in _imported(tree, "figures"):
                if module == "importlib":
                    problems.append(f"{where}:{line}: imports importlib: figures/ imports only by import statements")
                    continue
                if module in stdlib or module in FIGURE_IMPORTS:
                    continue
                if module == "numpy" and path.parent == figures and path.name in NUMPY_FILES:
                    continue
                why = "numpy outside the five rule files" if module == "numpy" else "not figures' to import"
                problems.append(f"{where}:{line}: imports {module} ({why}; rule A/F)")
            for line, name in _names(tree):
                if name in ("importlib", "__import__"):
                    problems.append(f"{where}:{line}: {name}: figures/ imports only by import statements")
        if not drawn_file and not path.name.startswith("test_"):
            for line, name in _names(tree):
                if name in DRAWN_NAMES:
                    problems.append(f"{where}:{line}: names {name} (only figures/thinning.py, picture.py may; rule B)")
            for node in ast.walk(tree):
                if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Load) and node.attr in drawn_fields:
                    problems.append(
                        f"{where}:{node.lineno}: reads {node.attr}, a field of the drawn points "
                        "(only figures/thinning.py, picture.py may; take the number of the answer instead; rule B)"
                    )
        frame_reader = relative.as_posix() in FRAME_READERS or relative.parts[0] in ("tests", "batch")
        if not frame_reader and not path.name.startswith("test_"):
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Attribute)
                    and isinstance(node.ctx, ast.Load)
                    and node.attr in FRAME_ARRAYS
                    and ast.unparse(node) not in NOT_FRAME_ARRAYS
                ):
                    problems.append(
                        f"{where}:{node.lineno}: reads .{node.attr} of a Frame (only frames/stage_view.py read_frame "
                        "reads a Frame for the comparison and the figure service; take its FrameReading; rule R)"
                    )
        allowed = BELOW.get(relative.parts[0])
        if allowed is not None and not path.name.startswith("test_"):
            for line, module in _imported(tree, relative.parts[0]):
                if module in OWN and module not in allowed:
                    may = ", ".join(sorted(allowed - {relative.parts[0]})) or "no other folder"
                    problems.append(f"{where}:{line}: imports {module} ({relative.parts[0]}/ imports {may}; rule F)")
    return problems


def main() -> int:
    problems = check()
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        print(f"check_figure_imports: {len(problems)} problem(s)", file=sys.stderr)
        print(
            "Rules: docs/figure-design.md 第 2 節 (A: numpy only in the five rule files; B: Drawn only where it "
            "is made and sent; F: a folder imports only the folders below it, 第 8 節 table). Fix: move the code to "
            "the folder or rule file that owns it, or ask the answer from the layer below; never widen the lists "
            "in this script without changing that doc. R: a Frame is read by frames/stage_view.py read_frame "
            "(docs/plot-layers.md, 'The backend reads a Frame in one place'); a service that reads its own Frames "
            "for an answer outside the comparison is listed in FRAME_READERS with what for.",
            file=sys.stderr,
        )
        return 1
    print("check_figure_imports: figures/ imports, Drawn names and Frame reads follow rules A, B, F and R")
    return 0


if __name__ == "__main__":
    sys.exit(main())
