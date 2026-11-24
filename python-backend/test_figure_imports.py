"""scripts/check_figure_imports.py (rules A, B, F of figure-design.md 第 2 節): the backend passes it, and each
deliberately wrong edit fails it (第 9 節 誤った実装 1: drawn points handed to the range, headline or counts)."""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "check_figure_imports.py"
spec = importlib.util.spec_from_file_location("check_figure_imports", SCRIPT)
assert spec is not None and spec.loader is not None
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def test_the_backend_follows_the_figure_folder_rules() -> None:
    assert checker.check() == []
    done = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, check=False)
    assert done.returncode == 0, done.stderr


WRONG = {
    "numpy outside the rule files": ("figures/service.py", "import numpy as np\n", "numpy outside the five rule files"),
    "a kept answer taken in figures/": (
        "figures/members.py",
        "from services.stage_combine import STORE\n",
        "imports services",
    ),
    "a Frame read in figures/": ("figures/headline.py", "def _x(frame):\n    return frame.freqs\n", "reads .freqs"),
    "a Frame read in transport/": (
        "transport/figure_answers.py",
        "def _v(frame):\n    return frame.data\n",
        "reads .data",
    ),
    "services/ from figures/": ("figures/pick.py", "from services import combine_ops\n", "imports services"),
    "transport/ from figures/": ("figures/headline.py", "import transport\n", "imports transport"),
    "drawn points handed to the range": (
        "figures/ranges.py",
        "from figures.thinning import Drawn\n",
        "names Drawn",
    ),
    "drawn points read by the pick": (
        "figures/pick.py",
        "def _peek(line):\n    return line.wire_points()\n",
        "names wire_points",
    ),
    "a thinned line's points opened without naming their type": (
        "figures/headline.py",
        "def _mean(thinned):\n    return float(thinned._values.mean())\n",
        "reads _values",
    ),
    "a thinned image's cells opened in services/": (
        "services/combine_ops.py",
        "def _peak(image):\n    return image._cells.max()\n",
        "reads _cells",
    ),
    "numpy taken from a rule file": (
        "figures/service.py",
        "from figures.thinning import np\n",
        "takes numpy from another module",
    ),
    "services/ from a folder inside figures/": (
        "figures/inner/layout.py",
        "from services import combine_ops\n",
        "imports services",
    ),
    "numpy in a folder inside figures/": (
        "figures/inner/layout.py",
        "import numpy\n",
        "numpy outside the five rule files",
    ),
    "Drawn named outside figures/": ("transport/figure_answers.py", "Drawn = None\n", "names Drawn"),
    "figures/ from services/": ("services/combine_ops.py", "import figures.members\n", "imports figures"),
    "an import by a name taken from importlib": (
        "figures/spec.py",
        "from importlib import import_module\n",
        "imports only by import statements",
    ),
    "an import by name": ("figures/spec.py", "import importlib\n", "imports only by import statements"),
    "transport/ from services/": ("services/scan_service.py", "import transport.figure_answers\n", "imports transport"),
    "services/ from frames/": ("frames/stage_view.py", "from services import combine_ops\n", "imports services"),
    "an entry from transport/": ("transport/command_dispatch.py", "import backend_server\n", "imports backend_server"),
}


@pytest.mark.parametrize("name", sorted(WRONG))
def test_a_wrong_import_or_name_fails_the_check(tmp_path: Path, name: str) -> None:
    backend = tmp_path / "python-backend"
    for folder in ("figures", "frames", "services", "transport"):
        shutil.copytree(ROOT / "python-backend" / folder, backend / folder)
    file, line, said = WRONG[name]
    target = backend / file
    target.parent.mkdir(exist_ok=True)
    target.write_text((target.read_text(encoding="utf-8") if target.exists() else "") + "\n" + line, encoding="utf-8")
    problems = checker.check(backend)
    assert any(said in problem and file in problem for problem in problems), problems
