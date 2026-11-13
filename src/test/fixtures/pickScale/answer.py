"""Answer a plot's reads of a dense line with the backend's own read path: ``python answer.py < request.json``.

The request is ``{"xs": [...], "values": [...], "reads": [StageRead, ...]}``: one spectrum line (its xs and values,
in full) and the reads a plot sent for it. Each read is answered by stage_combine.read_points, as the backend serves
a comparison's read (full_read.read_line, whose dense window keeps ``_nearest_on_screen``'s point, the one nearest the
pointer by the scale the read sends). One JSON answer per line.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "python-backend"))

import numpy as np  # noqa: E402

from stage_combine import StageData, read_points  # noqa: E402

VIEW = {"frame": "SpectralFrame", "kind": "line", "x": "frequency", "xScale": "linear", "quantity": "value"}


def main() -> None:
    request = json.load(sys.stdin)
    xs = np.asarray(request["xs"], dtype=np.float64)
    values = np.asarray(request["values"], dtype=np.float64)
    data = StageData(mode="spectrum", view=VIEW, xs=xs, values=values, nyquist=float(xs[-1]))  # type: ignore[arg-type]
    for read in request["reads"]:
        print(json.dumps(read_points([data], None, read)))


if __name__ == "__main__":
    main()
