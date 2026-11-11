"""Answer a plot's reads with the backend's own read path: ``python answer.py '<StageRead JSON>'...``.

A spectrum of eight bins (100 Hz apart) whose levels sit where rounding to what is written would change what the plot
reads: −10.004 and −9.996 dB (both written −10.0) side by side, and −249.999 dB (−250.00 rounded: the silent
floor) alone between silent bins. Each read is answered by stage_combine.read_points (full_read.py), as the backend
serves a comparison's read, one JSON answer per line. A compared recording is the same but 260 dB under it at
300 Hz (−269.996 dB): its difference (``"of": "diff"``) is 0 dB everywhere but −260 dB there, a Δ, not silence.

A read with ``"fixture": "signal"`` is of three signals of eight samples at 1 kHz instead: a base group of 0.5 and
0.5 + 2⁻²⁴ (a float32 step apart; their median 0.5 + 2⁻²⁵ is no float32) and a compared one at 0.5 + 2⁻²⁴, whose
difference from the median is 2⁻²⁵ at every sample.
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
COMPARED = LEVELS.copy()
COMPARED[2] = -269.996
VIEW = {"frame": "SpectralFrame", "kind": "line", "x": "frequency", "xScale": "linear", "quantity": "level"}


def main() -> None:
    data = StageData(mode="spectrum", view=VIEW, xs=XS, values=LEVELS, nyquist=float(XS[-1]))  # type: ignore[arg-type]
    compared = StageData(mode="spectrum", view=VIEW, xs=XS, values=COMPARED, nyquist=float(XS[-1]))  # type: ignore[arg-type]
    signal = {"frame": "ChannelFrame", "kind": "line", "x": "time", "xScale": "linear", "quantity": "value"}
    step = 2.0**-24

    def samples(value: float) -> StageData:
        return StageData(mode="signal", view=signal, xs=np.empty(0), values=np.full(8, value), rate=1000.0)  # type: ignore[arg-type]

    for raw in sys.argv[1:]:
        read = json.loads(raw)
        diff = read.get("of") == "diff"
        if read.pop("fixture", None) == "signal":
            print(json.dumps(read_points([samples(0.5), samples(0.5 + step)], samples(0.5 + step) if diff else None, read)))
        else:
            print(json.dumps(read_points([data], compared if diff else None, read)))


if __name__ == "__main__":
    main()
