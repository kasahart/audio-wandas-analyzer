"""Write the channel-pair fixture: ``python generate.py <out-dir>``.

Two 2 s, 16 kHz, two-channel recordings, for the figures of a pair of channels (coherence, transfer function, cross
spectrum, cross-correlation):

- channel 1: white noise;
- channel 2: channel 1 delayed and scaled, plus noise of its own, so the pair is partly coherent, has a gain and
  a peak of correlation at the delay.

``base.wav`` and ``compare.wav`` differ in the delay (2 ms, 5 ms), the gain (0.5, 0.8) and the share of channel 2's
own noise, so every pair figure of the two differs. The seed is fixed and the WAVs are not committed: the UI test
writes them each run.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 16000
SECONDS = 2.0


def generate(out_dir: Path) -> list[Path]:
    rng = np.random.default_rng(20261115)
    out_dir.mkdir(parents=True, exist_ok=True)
    count = int(SECONDS * SAMPLE_RATE)
    written = []
    for name, delay_s, gain, own in (("base.wav", 0.002, 0.5, 0.02), ("compare.wav", 0.005, 0.8, 0.05)):
        first = 0.1 * rng.standard_normal(count)
        second = gain * np.roll(first, int(delay_s * SAMPLE_RATE)) + own * rng.standard_normal(count)
        path = out_dir / name
        sf.write(path, np.stack([first, second], axis=1).astype(np.float32), SAMPLE_RATE, subtype="FLOAT")
        written.append(path)
    return written


if __name__ == "__main__":
    for path in generate(Path(sys.argv[1])):
        print(path)
