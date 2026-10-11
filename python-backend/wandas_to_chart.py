"""Adapt wandas frame objects (and numpy scalars) into ChartSpec dicts.

Frames are dispatched with ``isinstance`` against the wandas frame classes, so
subclasses adapt like their base. An unknown type falls back to a best-effort
scalar representation rather than raising.

Wandas frame surface used here::

    ChannelFrame       .time, .data, .labels, .sampling_rate, .n_channels
    SpectralFrame      .freqs, .magnitude, .dB, .phase, .labels, .n_channels
    CoherenceFrame     .freqs, .coherence, .labels, .n_channels
    CrossSpectralFrame .freqs, .level_db, .phase, .labels, .n_channels
    TransferFunctionFrame .freqs, .gain_db, .phase, .labels, .n_channels
    SpectrogramFrame   .freqs, .times, .dB[ch, freq, time]
    NOctFrame          .freqs, .dB, .labels
    RoughnessFrame     2D data; treated as heatmap on (freq × time)
    np.ndarray         per-channel scalar metrics → scalar table
"""

from __future__ import annotations

from typing import Any

import numpy as np
from wandas.frames import (
    ChannelFrame,
    CoherenceFrame,
    CrossSpectralFrame,
    NOctFrame,
    RoughnessFrame,
    SpectralFrame,
    SpectrogramFrame,
    TransferFunctionFrame,
)

from decimator import decimated_waveform

# A ChannelFrame line chart keeps at most this many min/max buckets per channel (two points each),
# so a long recording does not serialize every sample into the Recipe result.
CHANNEL_FRAME_BUCKET_LIMIT = 4096

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


def _level_axis_label(frame: Any, quantity: str) -> str:
    """Axis label in the main display's notation when every channel shares one level reference."""
    references = [channel.level_reference for channel in getattr(frame, "channels", [])]
    if references and all(reference == references[0] for reference in references[1:]):
        return f"{quantity} [{references[0].label}]"
    return f"{quantity} [dB]"


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


def _min_max_envelope(data: np.ndarray, time: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Reduce (channels, samples) to two points per bucket via ``decimated_waveform``.

    Each bucket contributes its minimum and maximum in time order, so peaks survive. The shared x
    positions are the bucket's first and last sample times, matching the decimator's bucket split.
    """
    n = data.shape[-1]
    width, remainder = divmod(n, CHANNEL_FRAME_BUCKET_LIMIT)
    sizes = np.full(CHANNEL_FRAME_BUCKET_LIMIT, width)
    sizes[:remainder] += 1
    starts = np.concatenate(([0], np.cumsum(sizes[:-1])))
    xs = np.column_stack((time[starts], time[starts + sizes - 1])).reshape(-1)
    rows = []
    for samples in data:
        bucket = decimated_waveform(samples, CHANNEL_FRAME_BUCKET_LIMIT, 0, n)
        minima, maxima = np.asarray(bucket["min"]), np.asarray(bucket["max"])
        min_first = np.asarray(bucket["minT"]) <= np.asarray(bucket["maxT"])
        first = np.where(min_first, minima, maxima)
        second = np.where(min_first, maxima, minima)
        rows.append(np.column_stack((first, second)).reshape(-1))
    return np.asarray(rows), xs


def _adapt_channel_frame(frame: Any, *, title: str) -> dict[str, Any]:
    data = np.asarray(frame.data, dtype=np.float64)
    if data.ndim == 1:
        data = data[np.newaxis, :]
    time = np.asarray(getattr(frame, "time", np.arange(data.shape[-1])), dtype=np.float64)
    if data.shape[-1] > 2 * CHANNEL_FRAME_BUCKET_LIMIT:
        data, time = _min_max_envelope(data, time)
    series = _series_2d(data, _labels(frame))
    for item, channel in zip(series, getattr(frame, "channels", []), strict=False):
        if channel.unit:
            item["unit"] = channel.unit
    return {
        "kind": "line",
        "title": title,
        "xLabel": "Time [s]",
        "yLabel": "Amplitude",
        "xs": _as_list(time),
        "series": series,
    }


def _adapt_spectral_frame(
    frame: Any,
    *,
    title: str,
    value: str = "dB",
    y_label: str | None = None,
    y_scale: str | None = None,
) -> dict[str, Any]:
    """SpectralFrame → line. ``value`` picks which attribute is plotted.

    ``dB`` (default) yields a dB-scale magnitude line; ``magnitude`` and
    ``phase`` are available alternatives. Dedicated coherence, cross-spectral,
    and transfer-function frames use the same frequency-series adapter.
    """
    freqs = np.asarray(frame.freqs, dtype=np.float64)
    raw = getattr(frame, value)
    arr = np.asarray(raw, dtype=np.float64)
    if arr.ndim == 1:
        arr = arr[np.newaxis, :]
    y_label = y_label or {
        "dB": _level_axis_label(frame, "Level"),
        "magnitude": "Magnitude",
        "phase": "Phase [rad]",
    }.get(value, value)
    y_scale = y_scale or ("db" if value == "dB" else "linear")
    series = _series_2d(arr, _labels(frame))
    for item, channel in zip(series, getattr(frame, "channels", []), strict=False):
        if value in {"dB", "level_db", "transfer_level_db"}:
            item["unit"] = channel.level_reference.label
        elif value in {"magnitude", "gain"} and channel.unit:
            item["unit"] = channel.unit
    return {
        "kind": "line",
        "title": title,
        "xLabel": "Frequency [Hz]",
        "yLabel": y_label,
        "xs": _as_list(freqs),
        "series": series,
        "xScale": "linear",
        "yScale": y_scale,
    }


def _adapt_spectrogram_frame(frame: Any, *, title: str, channel: int = 0) -> dict[str, Any]:
    freqs = np.asarray(frame.freqs, dtype=np.float64)
    db = np.asarray(frame.dB, dtype=np.float64)
    # dB shape is (channels, freqs, time).
    ch = 0
    if db.ndim == 2:
        plane = db
    else:
        ch = max(0, min(channel, db.shape[0] - 1))
        plane = db[ch]
    n_freq, n_time = plane.shape
    channels = getattr(frame, "channels", [])
    unit = channels[ch].level_reference.label if channels else "dB"
    times = np.asarray(frame.times, dtype=np.float64)
    return {
        "kind": "heatmap",
        "title": title,
        "xLabel": "Time [s]",
        "yLabel": "Frequency [Hz]",
        "xs": _as_list(times[:n_time]),
        "ys": _as_list(freqs[:n_freq]),
        "matrix": [_as_list(plane[i]) for i in range(n_freq)],
        "unit": unit,
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
    for item, channel in zip(series, getattr(frame, "channels", []), strict=False):
        item["unit"] = channel.level_reference.label
    return {
        "kind": "bar",
        "title": title,
        "xLabel": "Band centre [Hz]",
        "yLabel": _level_axis_label(frame, "Level"),
        "categories": categories,
        "series": series,
    }


def _adapt_roughness_frame(frame: Any, *, title: str, channel: int = 0) -> dict[str, Any]:
    data = np.asarray(frame.data, dtype=np.float64)
    if data.ndim == 3:
        ch = max(0, min(channel, data.shape[0] - 1))
        data = data[ch]
    elif data.ndim != 2:
        data = np.atleast_2d(data)
    n_bark, n_time = data.shape
    bark_axis = np.asarray(frame.bark_axis, dtype=np.float64)
    times = np.asarray(getattr(frame, "time", np.arange(n_time)), dtype=np.float64)
    return {
        "kind": "heatmap",
        "title": title,
        "xLabel": "Time [s]",
        "yLabel": "Critical-band rate [Bark]",
        "xs": _as_list(times[:n_time]),
        "ys": _as_list(bark_axis[:n_bark]),
        "matrix": [_as_list(data[i]) for i in range(n_bark)],
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

    Unknown types fall back to a scalar table representation that at least
    surfaces ``repr(obj)``.
    """
    title = title or type(obj).__name__

    if isinstance(obj, ChannelFrame):
        return _adapt_channel_frame(obj, title=title)
    if isinstance(obj, SpectralFrame):
        value = kwargs.get("value", "dB")
        return _adapt_spectral_frame(obj, title=title, value=value)
    if isinstance(obj, CoherenceFrame):
        return _adapt_spectral_frame(obj, title=title, value="coherence", y_label="Coherence", y_scale="linear")
    if isinstance(obj, CrossSpectralFrame):
        value = kwargs.get("value", "level_db")
        labels = {
            "level_db": _level_axis_label(obj, "Cross-spectral level"),
            "magnitude": "Cross-spectral magnitude",
            "phase": "Phase [rad]",
        }
        return _adapt_spectral_frame(
            obj,
            title=title,
            value=value,
            y_label=labels.get(value, value),
            y_scale="db" if value == "level_db" else "linear",
        )
    if isinstance(obj, TransferFunctionFrame):
        default_value = "transfer_level_db" if any(domain.unit != "1" for domain in obj.pair_domains) else "gain_db"
        value = kwargs.get("value", default_value)
        labels = {
            "gain_db": "Gain [dB]",
            "transfer_level_db": _level_axis_label(obj, "Transfer level"),
            "gain": "Gain",
            "phase": "Phase [rad]",
        }
        return _adapt_spectral_frame(
            obj,
            title=title,
            value=value,
            y_label=labels.get(value, value),
            y_scale="db" if value in {"gain_db", "transfer_level_db"} else "linear",
        )
    if isinstance(obj, SpectrogramFrame):
        return _adapt_spectrogram_frame(obj, title=title, channel=int(kwargs.get("channel", 0)))
    if isinstance(obj, NOctFrame):
        return _adapt_noct_frame(obj, title=title)
    if isinstance(obj, RoughnessFrame):
        return _adapt_roughness_frame(obj, title=title, channel=int(kwargs.get("channel", 0)))
    if isinstance(obj, np.ndarray):
        return _adapt_ndarray(obj, title=title, unit=kwargs.get("unit"))
    if isinstance(obj, int | float | np.floating | np.integer):
        return {"kind": "scalar", "title": title, "rows": [{"label": "value", "value": float(obj)}]}

    return {"kind": "scalar", "title": title, "rows": [{"label": "repr", "value": repr(obj)[:200]}]}
