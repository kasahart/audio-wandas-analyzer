"""Write the narrow-features fixture: ``python generate.py <out-dir>``.

Two 2 s, 16 kHz, one-channel recordings that differ in one narrow place, so a plot that thins its points has a
feature one bin wide to keep (R2) and a zoom has a feature inside its window and a louder one outside it (R3):

- ``base.wav``: a quiet noise floor and a tone at 3000 Hz, the loudest thing in both recordings.
- ``compare.wav``: the same, with a tone at 1500 Hz as well, 34 dB under the 3000 Hz one: the only difference.

Both tones sit on a bin of an 8192-point FFT at 16 kHz, so each is one bin wide in its Welch spectrum. The seed is
fixed and the WAVs are not committed: the UI test writes them each run.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 16000
SECONDS = 2.0
LOUD_HZ = 3000.0
NARROW_HZ = 1500.0


def generate(out_dir: Path) -> list[Path]:
    rng = np.random.default_rng(20261108)
    out_dir.mkdir(parents=True, exist_ok=True)
    t = np.arange(int(SECONDS * SAMPLE_RATE)) / SAMPLE_RATE
    floor = 0.002 * rng.standard_normal(t.size)
    base = floor + 0.1 * np.sin(2 * np.pi * LOUD_HZ * t)
    compare = base + 0.002 * np.sin(2 * np.pi * NARROW_HZ * t)
    written = []
    for name, samples in (("base.wav", base), ("compare.wav", compare)):
        path = out_dir / name
        sf.write(path, samples.astype(np.float32), SAMPLE_RATE, subtype="FLOAT")
        written.append(path)
    return written


if __name__ == "__main__":
    for path in generate(Path(sys.argv[1])):
        print(path)
