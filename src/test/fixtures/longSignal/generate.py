"""Write the long-signal fixture: ``python generate.py <out-dir>``.

Two 2 s, 16 kHz, one-channel recordings of a 1 kHz tone (the second 6 dB louder): long enough that its pictures over time are thinned (a
spectrogram's STFT frames averaged into fewer columns), so the first and last drawn points are not the source's ends.
The whole view must still span the source data (docs/display-rules.md R2). The WAVs are not committed: the UI test
writes them each run.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 16000
SECONDS = 2


def generate(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    t = np.arange(SECONDS * SAMPLE_RATE) / SAMPLE_RATE
    written = []
    for name, amplitude in (("base.wav", 0.1), ("compare.wav", 0.2)):
        path = out_dir / name
        sf.write(path, (amplitude * np.sin(2 * np.pi * 1000.0 * t)).astype(np.float32), SAMPLE_RATE, subtype="FLOAT")
        written.append(path)
    return written


if __name__ == "__main__":
    for path in generate(Path(sys.argv[1])):
        print(path)
