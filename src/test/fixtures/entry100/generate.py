"""Synthesize the 100-file entry-table fixture: ``python generate.py <out-dir>``.

The WAVs are not committed; tests regenerate them (the seed is fixed, so every run writes the same
files). The set covers what the entry table has to cope with:

- 66 files named ``L<line>_<rpm>rpm_run<NNN>.wav``: lines L1–L3 × 900/1200/1500 rpm, 7 or 8 per group.
  Three of them are outliers whose 3150 Hz band is at least 10 dB above their group.
- 2 files at 1800 rpm, a group too small to judge outliers in.
- 30 files named ``run0<NN>.wav`` with no condition in the name.
- 1 broken WAV (a RIFF header without a data chunk).
- 1 file at 48 kHz with one channel.
- ``motor.csv``, the folder's metadata in asd-insight's form (UTF-8 with BOM): sample_id, audio_file,
  line, rpm, temp_c, load_pct for the 98 readable 2 s recordings, so the ``run0<NN>`` files get their
  line and rpm from it.

Everything else is 2 s, 16 kHz, 2 channels. ``generate`` returns the recordings, not the CSV.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SEED = 20261021
SAMPLE_RATE = 16000
SECONDS = 2.0
LINES = ("L1", "L2", "L3")
RPMS = (900, 1200, 1500)
# 66 files over the 9 line × rpm groups: the first 3 groups get 8, the rest 7.
GROUP_SIZES = (8, 8, 8, 7, 7, 7, 7, 7, 7)
OUTLIER_RUNS = (18, 43, 60)
RESONANCE_HZ = 3150.0


def _motor(
    rng: np.random.Generator, rpm: float, line_gain_db: float, rate: int, channels: int, resonance: float = 0.01
) -> np.ndarray:
    t = np.arange(int(SECONDS * rate)) / rate
    rotation_hz = rpm / 60.0
    signal = np.zeros_like(t)
    # Shaft harmonics, a gear-mesh tone that follows rpm, and a fixed housing resonance.
    for order, level in ((1, 0.20), (2, 0.10), (3, 0.05)):
        signal += level * np.sin(2 * np.pi * order * rotation_hz * t + rng.uniform(0, 2 * np.pi))
    signal += 0.04 * np.sin(2 * np.pi * 24 * rotation_hz * t + rng.uniform(0, 2 * np.pi))
    signal += resonance * np.sin(2 * np.pi * RESONANCE_HZ * t + rng.uniform(0, 2 * np.pi))
    gain = 10 ** ((line_gain_db + rng.normal(0, 0.3)) / 20)
    rows = [gain * signal + 0.01 * rng.standard_normal(t.size) for _ in range(channels)]
    return np.stack(rows, axis=1)


def generate(out_dir: Path) -> list[Path]:
    rng = np.random.default_rng(SEED)
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    def write(name: str, samples: np.ndarray, rate: int = SAMPLE_RATE) -> None:
        path = out_dir / name
        sf.write(path, samples.astype(np.float32), rate, subtype="PCM_16")
        written.append(path)

    metadata: list[tuple[str, str, int]] = []
    run = 0
    groups = [(line, rpm) for line in LINES for rpm in RPMS]
    for (line, rpm), size in zip(groups, GROUP_SIZES, strict=True):
        line_gain_db = {"L1": 0.0, "L2": -1.5, "L3": 1.5}[line]
        for _ in range(size):
            run += 1
            # Outliers ring the resonance 5x (+14 dB), well over 10 dB above their group's band.
            resonance = 0.05 if run in OUTLIER_RUNS else 0.01
            samples = _motor(rng, rpm, line_gain_db, SAMPLE_RATE, 2, resonance)
            write(f"{line}_{rpm}rpm_run{run:03d}.wav", samples)
            metadata.append((f"{line}_{rpm}rpm_run{run:03d}.wav", line, rpm))
    for line in ("L1", "L2"):
        run += 1
        write(f"{line}_1800rpm_run{run:03d}.wav", _motor(rng, 1800, 0.0, SAMPLE_RATE, 2))
        metadata.append((f"{line}_1800rpm_run{run:03d}.wav", line, 1800))
    for index in range(30):
        rpm = int(rng.choice(RPMS))
        write(f"run0{index:02d}.wav", _motor(rng, float(rpm), 0.0, SAMPLE_RATE, 2))
        # Their motors run at line L1's gain, so L1 is their line.
        metadata.append((f"run0{index:02d}.wav", "L1", rpm))
    broken = out_dir / "Rec_0012.wav"
    broken.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt ")
    written.append(broken)
    write("mono_48k.wav", _motor(rng, 1200, 0.0, 48000, 1), rate=48000)
    # Its own generator, so the recordings above stay the same bytes.
    extra = np.random.default_rng(SEED + 1)
    lines = ["sample_id,audio_file,line,rpm,temp_c,load_pct"]
    for index, (name, line, rpm) in enumerate(metadata, start=1):
        lines.append(f"S{index:03d},{name},{line},{rpm},{extra.uniform(20, 35):.1f},{int(extra.integers(50, 101))}")
    (out_dir / "motor.csv").write_text("\ufeff" + "\n".join(lines) + "\n", encoding="utf-8")
    return written


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "out"
    files = generate(target)
    print(f"wrote {len(files)} files to {target}")
