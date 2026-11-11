"""Answer a plot's reads with the backend's own read path: ``python answer.py '<StageRead JSON>'...``.

A spectrum of eight bins (100 Hz apart) whose levels sit where rounding to what is written would change what the plot
reads: −10.004 and −9.996 dB (both written −10.0) side by side, and −249.999 dB (−250.00 rounded: the silent
floor) alone between silent bins. Each read is answered by stage_combine.read_points (full_read.py), as the backend
serves a comparison's read, one JSON answer per line.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "python-backend"))

import numpy as np  # noqa: E402

from stage_combine import StageData, read_points  # noqa: E402

XS = np.arange(1.0, 9.0) * 100.0
LEVELS = np.array([-300.0, -10.004, -9.996, -300.0, -249.999, -300.0, -300.0, -20.0])
VIEW = {"frame": "SpectralFrame", "kind": "line", "x": "frequency", "xScale": "linear", "quantity": "level"}


def main() -> None:
    data = StageData(mode="spectrum", view=VIEW, xs=XS, values=LEVELS, nyquist=float(XS[-1]))  # type: ignore[arg-type]
    for raw in sys.argv[1:]:
        print(json.dumps(read_points([data], None, json.loads(raw))))


if __name__ == "__main__":
    main()
