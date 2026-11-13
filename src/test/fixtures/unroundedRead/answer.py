"""Answer a plot's reads with the backend's own read path: ``python answer.py '<StageRead JSON>'...``.

A spectrum of eight bins (100 Hz apart) whose levels sit where rounding to what is written would change what the plot
reads: −10.004 and −9.996 dB (both written −10.0) side by side, and −249.999 dB (−250.00 rounded: the silent
floor) alone between silent bins. Each read is answered by stage_combine.read_points (full_read.py), as the backend
serves a comparison's read, one JSON answer per line. A compared recording is the same but 260 dB under it at
300 Hz (−269.996 dB): its difference (``"of": "diff"``) is 0 dB everywhere but −260 dB there, a Δ, not silence.

A read with ``"fixture": "signal"`` is of three signals of eight samples at 1 kHz instead: a base group of 0.5 and
0.5 + 2⁻²⁴ (a float32 step apart; their median 0.5 + 2⁻²⁵ is no float32) and a compared one at 0.5 + 2⁻²⁴, whose
difference from the median is 2⁻²⁵ at every sample. With ``"fixture": "dense"``: one signal of 20 000 samples at
1 kHz (``sin(0.37 n) cos(0.011 n) 0.9``), too many for a hover's window to be sent whole. With ``"fixture": "zoomed"``:
20 000 samples of ``0.1 sin(0.37 n)`` at 1 kHz but 0.95 at n = 5003 and 0.8 at n = 5010.
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
        fixture = read.pop("fixture", None)
        if fixture == "zoomed":
            values = np.sin(np.arange(20_000) * 0.37) * 0.1
            values[5003], values[5010] = 0.95, 0.8
            zoomed = StageData(mode="signal", view=signal, xs=np.empty(0), values=values, rate=1000.0)  # type: ignore[arg-type]
            print(json.dumps(read_points([zoomed], None, read)))
        elif fixture == "dense":
            index = np.arange(20_000)
            dense = StageData(mode="signal", view=signal, xs=np.empty(0), values=np.sin(index * 0.37) * np.cos(index * 0.011) * 0.9, rate=1000.0)  # type: ignore[arg-type]
            print(json.dumps(read_points([dense], None, read)))
        elif fixture == "signal":
            print(json.dumps(read_points([samples(0.5), samples(0.5 + step)], samples(0.5 + step) if diff else None, read)))
        else:
            print(json.dumps(read_points([data], compared if diff else None, read)))


if __name__ == "__main__":
    main()
