"""Generate the entry100 fixture and print every file's scan result: ``python scan.py <out-dir>``.

Prints a JSON list of ``{"filePath", "result"}`` in file-name order, the shape the entry table receives
from the host, so the TS model and UI tests run on real backend numbers without committing them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[3] / "python-backend"
sys.path[:0] = [str(HERE), str(BACKEND)]

from analysis_engine import AnalysisEngine  # noqa: E402
from analysis_service import AnalysisService  # noqa: E402
from generate import generate  # noqa: E402

if __name__ == "__main__":
    files = sorted(generate(Path(sys.argv[1])))
    recipe = json.loads((BACKEND / "recipes" / "entry-scan.recipe.json").read_text())
    service = AnalysisService(AnalysisEngine())
    rows = [{"filePath": str(path), "result": service.scan(str(path), recipe=recipe)} for path in files]
    json.dump(rows, sys.stdout)
