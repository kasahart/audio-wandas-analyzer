"""Adapt wandas frame objects (and numpy scalars) into ChartSpec dicts.

The dispatch is intentionally duck-typed (matches class name) so that wandas
upstream additions don't immediately break us: an unknown frame type falls
back to a best-effort scalar/line representation rather than raising.

Wandas 0.2.0 frame surface used here::

    ChannelFrame       .time, .data, .labels, .sampling_rate, .n_channels
    SpectralFrame      .freqs, .magnitude, .dB, .phase, .labels, .n_channels
    SpectrogramFrame   .freqs, .dB[ch, freq, time], hop_length, sampling_rate
    NOctFrame          .freqs, .dB, .labels
    RoughnessFrame     2D data; treated as heatmap on (freq × time)
    np.ndarray         per-channel scalar metrics → scalar table
"""

from __future__ import annotations

from typing import Any

import numpy as np

# ---- helpers ---------------------------------------------------------------


def _as_list(values: Any) -> list[float]:
    """NaN/inf-safe NumPy → JSON-friendly list[float]."""
    arr = np.asarray(values, dtype=np.float64)
    arr = np.where(np.isfinite(arr), arr, 0.0)
    return arr.tolist()


def _labels(frame: Any, default_prefix: str = "Channel") -> list[str]:
    raw = getattr(frame, "labels", None)
    if raw is None:
        n = int(getattr(frame, "n_channels", 1) or 1)
        return [f"{default_prefix} {i + 1}" for i in range(n)]
    return [str(x) for x in raw]


def _series_2d(matrix: np.ndarray, names: list[str], unit: str | None = None) -> list[dict[str, Any]]:
    """Build a list of LineSeries from a 2D (n_series, n_bins) matrix."""
    rows = []
    for i in range(matrix.shape[0]):
        item: dict[str, Any] = {
            "name": names[i] if i < len(names) else f"Series {i + 1}",
            "ys": _as_list(matrix[i]),
        }
        if unit:
            item["unit"] = unit
        rows.append(item)
    return rows


# ---- per-type adapters -----------------------------------------------------


def _adapt_channel_frame(frame: Any, *, title: str) -> dict[str, Any]:
    data = np.asarray(frame.data, dtype=np.float64)
    if data.ndim == 1:
        data = data[np.newaxis, :]
    time = np.asarray(getattr(frame, "time", np.arange(data.shape[-1])), dtype=np.float64)
    return {
        "kind": "line",
        "title": title,
        "xLabel": "Time [s]",
        "yLabel": "Amplitude",
        "xs": _as_list(time),
        "series": _series_2d(data, _labels(frame)),
    }


def _adapt_spectral_frame(frame: Any, *, title: str, value: str = "dB") -> dict[str, Any]:
    """SpectralFrame → line. ``value`` picks which attribute is plotted.

    ``dB`` (default) yields a dB-scale magnitude line; ``magnitude`` and
    ``phase`` are available alternatives. Coherence / TF return SpectralFrame
    too — the same adapter handles them transparently.
    """
    freqs = np.asarray(frame.freqs, dtype=np.float64)
    raw = getattr(frame, value)
    arr = np.asarray(raw, dtype=np.float64)
    if arr.ndim == 1:
        arr = arr[np.newaxis, :]
    y_label = {"dB": "Level [dB]", "magnitude": "Magnitude", "phase": "Phase [rad]"}.get(value, value)
    return {
        "kind": "line",
        "title": title,
        "xLabel": "Frequency [Hz]",
        "yLabel": y_label,
        "xs": _as_list(freqs),
        "series": _series_2d(arr, _labels(frame)),
        "xScale": "linear",
        "yScale": "db" if value == "dB" else "linear",
    }


def _adapt_spectrogram_frame(frame: Any, *, title: str, channel: int = 0) -> dict[str, Any]:
    freqs = np.asarray(frame.freqs, dtype=np.float64)
    db = np.asarray(frame.dB, dtype=np.float64)
    # dB shape from wandas 0.2.0 is (channels, freqs, time).
    if db.ndim == 2:
        plane = db
    else:
        ch = max(0, min(channel, db.shape[0] - 1))
        plane = db[ch]
    n_freq, n_time = plane.shape
    sr = float(getattr(frame, "sampling_rate", 0) or 0)
    hop = float(getattr(frame, "hop_length", 0) or 0)
    times = np.arange(n_time) * (hop / sr) if sr > 0 and hop > 0 else np.arange(n_time, dtype=np.float64)
    return {
        "kind": "heatmap",
        "title": title,
        "xLabel": "Time [s]",
        "yLabel": "Frequency [Hz]",
        "xs": _as_list(times),
        "ys": _as_list(freqs[:n_freq]),
        "matrix": [_as_list(plane[i]) for i in range(n_freq)],
        "unit": "dB",
        "colormap": "viridis",
    }


def _adapt_noct_frame(frame: Any, *, title: str) -> dict[str, Any]:
    freqs = np.asarray(frame.freqs, dtype=np.float64)
    db = np.asarray(frame.dB, dtype=np.float64)
    if db.ndim == 1:
        db = db[np.newaxis, :]
    categories = [f"{f:g}" for f in freqs]
    series = []
    for i, name in enumerate(_labels(frame)):
        if i >= db.shape[0]:
            break
        series.append({"name": name, "values": _as_list(db[i]), "unit": "dB"})
    return {
        "kind": "bar",
        "title": title,
        "xLabel": "Band centre [Hz]",
        "yLabel": "Level [dB]",
        "categories": categories,
        "series": series,
    }


def _adapt_roughness_frame(frame: Any, *, title: str) -> dict[str, Any]:
    data = np.asarray(frame.data, dtype=np.float64)
    if data.ndim != 2:
        data = np.atleast_2d(data)
    n_freq, n_time = data.shape
    freqs = np.asarray(getattr(frame, "freqs", np.arange(n_freq)), dtype=np.float64)
    times = np.asarray(getattr(frame, "time", np.arange(n_time)), dtype=np.float64)
    return {
        "kind": "heatmap",
        "title": title,
        "xLabel": "Time [s]",
        "yLabel": "Modulation frequency [Hz]",
        "xs": _as_list(times),
        "ys": _as_list(freqs),
        "matrix": [_as_list(data[i]) for i in range(n_freq)],
        "unit": "asper",
        "colormap": "magma",
    }


def _adapt_ndarray(arr: np.ndarray, *, title: str, unit: str | None = None) -> dict[str, Any]:
    flat = np.asarray(arr, dtype=np.float64).reshape(-1)
    rows = []
    for i, v in enumerate(flat.tolist()):
        item: dict[str, Any] = {"label": f"Channel {i + 1}", "value": float(v)}
        if unit:
            item["unit"] = unit
        rows.append(item)
    return {"kind": "scalar", "title": title, "rows": rows}


# ---- public entry ----------------------------------------------------------


def adapt(obj: Any, *, title: str | None = None, **kwargs: Any) -> dict[str, Any]:
    """Adapt a wandas frame (or ndarray scalar metric) to a ChartSpec dict.

    The dispatch is by class name so that wandas may add new frame types
    without forcing this module to import them. Unknown types fall back to
    a scalar table representation that at least surfaces ``repr(obj)``.
    """
    cls = type(obj).__name__
    title = title or cls

    if cls == "ChannelFrame":
        return _adapt_channel_frame(obj, title=title)
    if cls == "SpectralFrame":
        value = kwargs.get("value", "dB")
        return _adapt_spectral_frame(obj, title=title, value=value)
    if cls == "SpectrogramFrame":
        return _adapt_spectrogram_frame(obj, title=title, channel=int(kwargs.get("channel", 0)))
    if cls == "NOctFrame":
        return _adapt_noct_frame(obj, title=title)
    if cls == "RoughnessFrame":
        return _adapt_roughness_frame(obj, title=title)
    if isinstance(obj, np.ndarray):
        return _adapt_ndarray(obj, title=title, unit=kwargs.get("unit"))
    if isinstance(obj, int | float | np.floating | np.integer):
        return {"kind": "scalar", "title": title, "rows": [{"label": "value", "value": float(obj)}]}

    return {"kind": "scalar", "title": title, "rows": [{"label": "repr", "value": repr(obj)[:200]}]}
