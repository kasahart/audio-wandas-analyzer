"""Write the audio files used by docs/manual-check.ja.md.

Usage (with the Python environment the extension uses):

    python scripts/make-manual-check-files.py [OUTPUT_DIR]

OUTPUT_DIR defaults to ./manual-check-files. Every file is synthetic, so the expected
readings in the checklist are exact. Needs only numpy and soundfile.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

RATE = 48_000
RNG = np.random.default_rng(20261031)


def seconds(duration: float) -> np.ndarray:
    return np.arange(int(round(duration * RATE))) / RATE


def tone(freq: float, duration: float, rms: float) -> np.ndarray:
    return np.sqrt(2.0) * rms * np.sin(2.0 * np.pi * freq * seconds(duration))


def faded(signal: np.ndarray, fade: float = 0.01) -> np.ndarray:
    n = min(int(fade * RATE), len(signal) // 2)
    ramp = np.linspace(0.0, 1.0, n)
    out = signal.copy()
    out[:n] *= ramp
    out[len(out) - n :] *= ramp[::-1]
    return out


def write(path: Path, data: np.ndarray, rate: int = RATE, **kwargs: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, data, rate, **kwargs)  # type: ignore[arg-type]
    print(f"  {path}")


def calibration(out: Path) -> None:
    # 1 kHz (A-weighting is 0 dB there), RMS 0.1 FS: -20.0 dB uncalibrated; factor 10 Pa gives 1 Pa = 94.0 dB SPL.
    write(out / "01_校正_1kHz_RMS0.1FS.wav", tone(1000, 10, 0.1), subtype="PCM_24")
    # Two channels at different levels: ch1 RMS 0.1 FS (factor 10), ch2 RMS 0.01 FS (factor 100). Both read 94.0 dB.
    stereo = np.column_stack([tone(1000, 10, 0.1), tone(1000, 10, 0.01)])
    write(out / "02_校正_2ch_ch1は0.1FS_ch2は0.01FS.wav", stereo, subtype="PCM_24")


def playback(out: Path) -> None:
    # Left only for 0-2 s (440 Hz), right only for 2-4 s (880 Hz), both for 4-6 s (660 Hz).
    left = np.concatenate([faded(tone(440, 2, 0.2)), np.zeros(2 * RATE), faded(tone(660, 2, 0.2))])
    right = np.concatenate([np.zeros(2 * RATE), faded(tone(880, 2, 0.2)), faded(tone(660, 2, 0.2))])
    write(out / "03_再生_左→右→両方.wav", np.column_stack([left, right]))

    # One beep per second whose pitch rises each second (0 s = 400 Hz, 1 s = 500 Hz ...), so the
    # heard pitch tells which second is playing: checks loop range and cursor sync by ear.
    beeps = np.zeros(10 * RATE)
    for second in range(10):
        start = second * RATE
        beeps[start : start + RATE // 5] = faded(tone(400 + 100 * second, 0.2, 0.2), 0.005)
    write(out / "04_再生_毎秒ビープ_0秒400Hzから100Hzずつ上がる.wav", beeps)
    for ext, kwargs in (("flac", {}), ("ogg", {"format": "OGG", "subtype": "VORBIS"}), ("mp3", {"format": "MP3"})):
        write(out / "04b_形式違い" / f"毎秒ビープ.{ext}", beeps, **kwargs)


def comparison(out: Path) -> None:
    # White noise A, and B = A delayed 100 ms at half amplitude: a -100 ms offset on B lines the two
    # waveforms up, and then the transfer function reads -6.0 dB with coherence ~1.
    noise = RNG.standard_normal(10 * RATE) * 0.1
    delay = int(0.1 * RATE)
    delayed = np.concatenate([np.zeros(delay), noise[:-delay]]) * 0.5
    write(out / "05_比較_A_基準.wav", noise)
    write(out / "05_比較_B_100ms遅れ_半分の振幅.wav", delayed)
    # C = A at half amplitude with no delay: Recipes ignore track offsets, so they use this one.
    write(out / "05_比較_C_同期_半分の振幅.wav", noise * 0.5)


def errors(out: Path) -> None:
    # 1000 samples: shorter than the bundled recipes' 4096-point FFT, so Recipe runs fail with the
    # "settings don't fit this file" summary.
    write(out / "06_エラー確認_短すぎる_1000サンプル.wav", tone(1000, 1000 / RATE, 0.1))
    path = out / "07_エラー確認_壊れたファイル.wav"
    path.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt " + bytes(range(64)))
    print(f"  {path}")


def japanese_names(out: Path) -> None:
    folder = out / "08_日本語ファイル名" / "深い階層の　全角スペース入りフォルダ"
    names = [
        "テスト音声_ひらがなカタカナ漢字.wav",
        "全角　スペース　入り.wav",
        "ｶﾀｶﾅ半角と①丸数字と㈱.wav",
        "記号（括弧）＆【隅付き】～波ダッシュ.wav",
        "表・ソ・能・予（Shift_JIS で問題になりやすい字）.wav",
        "絵文字🎵入り.wav",
        "Ünïcödé_ñ_混在.flac",
    ]
    for index, name in enumerate(names):
        data = faded(tone(300 + 100 * index, 3, 0.1))
        write(folder / name, data, format="FLAC" if name.endswith(".flac") else "WAV")


def vibration_csv(out: Path) -> None:
    # CSV: first column is time. 80 Hz, RMS 1.0 in m/s^2 if calibrated with factor 1 and unit m/s^2.
    t = seconds(2)[::4]
    values = np.sqrt(2.0) * np.sin(2.0 * np.pi * 80 * t)
    path = out / "09_CSV_振動_80Hz_RMS1.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savetxt(path, np.column_stack([t, values]), delimiter=",", header="time,accel", comments="", fmt="%.8f")
    print(f"  {path}")


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "manual-check-files")
    print(f"Writing manual-check files to {out.resolve()}")
    calibration(out)
    playback(out)
    comparison(out)
    errors(out)
    japanese_names(out)
    vibration_csv(out)


if __name__ == "__main__":
    main()
