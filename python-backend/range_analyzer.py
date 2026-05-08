from __future__ import annotations

from pathlib import Path

import numpy as np
import wandas as wd

from analyzer import _channels_first, _build_waveform_envelope


def analyze_range(
    file_path: str | Path,
    start_norm: float,
    end_norm: float,
    point_count: int = 2000,
) -> dict[str, object]:
    signal = wd.read_wav(str(file_path))
    channel_count = int(signal.n_channels)
    n_total = int(signal.n_samples)
    data = _channels_first(np.asarray(signal.data), channel_count, n_total)

    start_idx = max(0, int(start_norm * n_total))
    end_idx = min(n_total, int(end_norm * n_total))

    if end_idx <= start_idx:
        return {"startNorm": start_norm, "endNorm": end_norm, "channels": []}

    channels: list[dict[str, object]] = []
    for ch_idx in range(channel_count):
        ch_slice = data[ch_idx][start_idx:end_idx]
        channels.append(_build_waveform_envelope(ch_slice, point_count))

    return {"startNorm": start_norm, "endNorm": end_norm, "channels": channels}
