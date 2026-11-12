"""Write the trigger-default fixture: ``python generate.py <out-dir>``; prints the two paths, one per line.

Two 4 s, 8 kHz, one-channel recordings for the level a new trigger starts at (half the region's peak, display rules
R1). Both are a quiet tone (±0.05). Over the region 1.0–1.5 s:

- sample 11 999 (1.499875 s, inside the region) is 0.32 in ``base.wav`` and 0.20 in ``compare.wav``: the region's
  true peak is 0.32, so the trigger starts at 0.16;
- sample 12 001 (1.500125 s, just outside it) is 0.70 in both.

The two samples are two apart, so they fall in one bucket of the envelope a lane draws, which keeps only that
bucket's largest (0.70, outside the region). The envelope therefore does not hold 0.32: a peak taken from it is wrong
(0.05, or 0.70), and only a read of every sample gives 0.32. The WAVs are not committed: the UI test writes them.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 8000
SAMPLES = 32_000
INSIDE, OUTSIDE = 11_999, 12_001


def generate(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    tone = 0.05 * np.sin(np.arange(SAMPLES) * 0.37)
    written = []
    for name, inside in (("base.wav", 0.32), ("compare.wav", 0.20)):
        samples = tone.copy()
        samples[INSIDE], samples[OUTSIDE] = inside, 0.70
        path = out_dir / name
        sf.write(path, samples, SAMPLE_RATE, subtype="DOUBLE")
        written.append(path)
    return written


if __name__ == "__main__":
    for written_path in generate(Path(sys.argv[1])):
        print(written_path)
