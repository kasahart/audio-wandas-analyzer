from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from decimator import decimated_waveform


def analyze_range(
    file_path: str | Path,
    start_norm: float,
    end_norm: float,
    point_count: int = 2000,
) -> dict[str, object]:
    target = Path(file_path).expanduser().resolve()
    if not target.exists():
        raise FileNotFoundError(f"Audio file not found: {target}")
    with sf.SoundFile(target) as audio_file:
        sample_count = len(audio_file)
        channel_count = audio_file.channels
        start_idx = max(0, int(start_norm * sample_count))
        end_idx = min(sample_count, int(end_norm * sample_count))
        if end_idx <= start_idx:
            return {"startNorm": start_norm, "endNorm": end_norm, "channels": []}
        audio_file.seek(start_idx)
        data = np.asarray(
            audio_file.read(end_idx - start_idx, dtype="float64", always_2d=True),
            dtype=np.float64,
        )
    channels = [
        decimated_waveform(data[:, index], point_count, start_idx, sample_count) for index in range(channel_count)
    ]
    return {"startNorm": start_norm, "endNorm": end_norm, "channels": channels}


__all__ = ["analyze_range"]
