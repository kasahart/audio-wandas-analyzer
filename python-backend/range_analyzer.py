from __future__ import annotations
from pathlib import Path
import numpy as np
import soundfile as sf
from analyzer import _build_waveform_envelope


def analyze_range(
    file_path: str | Path,
    start_norm: float,
    end_norm: float,
    point_count: int = 2000,
) -> dict[str, object]:
    data, _sr = sf.read(str(file_path), always_2d=True)
    n_total = len(data)
    start_idx = max(0, int(start_norm * n_total))
    end_idx = min(n_total, int(end_norm * n_total))

    if end_idx <= start_idx:
        return {"startNorm": start_norm, "endNorm": end_norm, "channels": []}

    channels: list[dict[str, object]] = []
    for ch_idx in range(data.shape[1]):
        ch_slice = data[start_idx:end_idx, ch_idx].astype(np.float64)
        channels.append(
            _build_waveform_envelope(
                ch_slice,
                point_count,
                start_sample=start_idx,
                total_samples=n_total,
            )
        )
    return {"startNorm": start_norm, "endNorm": end_norm, "channels": channels}
