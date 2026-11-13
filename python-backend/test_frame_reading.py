"""A Frame's reading is float64, whatever dtype its recording was read in (docs/display-rules.md R1).

A 16-bit WAV is read as float32. ``stage_view.read_frame`` takes every number of a Frame as float64 (complex128 for
complex values) with ``stage_view._taken`` before it averages channels, so no median, difference, range or readout is
computed in float32, and it checks every array field of the reading, a field added later included.

If one of these fails: take the Frame's array with ``stage_view._taken`` in its branch of ``stage_view._read_frame``
before any arithmetic on it. Do not convert later, in a view or in stage_combine.py: by then a channel mean may have
been taken in float32. A new array field of flags (not numbers) goes into ``stage_view.READING_FLAG_FIELDS``.
"""

from __future__ import annotations

from dataclasses import fields, replace

import numpy as np
import pytest
import wandas as wd

import stage_view as sv
from stage_combine import read_points, stage_data
from test_drawn_x_is_source_x import _KINDS, _recording


def _float32(recording: wd.ChannelFrame) -> wd.ChannelFrame:
    frame = wd.from_numpy(np.asarray(recording.data, dtype=np.float32), sampling_rate=recording.sampling_rate)
    assert np.asarray(frame.data).dtype == np.float32, "the test needs a float32 recording"
    return frame


@pytest.mark.parametrize("kind", list(_KINDS))
def test_every_array_of_a_reading_is_float64_whatever_the_recordings_dtype(kind: str) -> None:
    frame = _KINDS[kind](_float32(_recording(0.5)))
    reading = sv.read_frame(frame)
    assert reading is not None, f"{kind} is drawn"
    arrays = {item.name: getattr(reading, item.name) for item in fields(reading)}
    arrays = {name: value for name, value in arrays.items() if isinstance(value, np.ndarray)}
    for name, array in arrays.items():
        expected = (np.bool_,) if name in sv.READING_FLAG_FIELDS else (np.float64, np.complex128)
        assert array.dtype in [np.dtype(item) for item in expected], (
            f"{kind}: the reading's {name} is {array.dtype}, not float64 (R1). Take the Frame's array with "
            "stage_view._taken in its branch of stage_view._read_frame, before any arithmetic on it."
        )


def test_read_frame_refuses_a_reading_with_any_array_not_in_float64(monkeypatch: pytest.MonkeyPatch) -> None:
    """The check is of every array field of the reading, so a field added without the conversion fails at once,
    naming read_frame's rule, whatever the field is called."""
    frame = _KINDS["spectrum"](_recording(0.5))
    reading = sv.read_frame(frame)
    assert reading is not None
    for name in ("xs", "values", "ys", "rows"):
        bad = replace(reading, **{name: np.zeros(3, dtype=np.float32)})
        monkeypatch.setattr(sv, "_read_frame", lambda *_args, bad=bad: bad)
        with pytest.raises(TypeError, match=rf"read_frame: .* has {name} in float32.*stage_view\._taken"):
            sv.read_frame(frame)
    # complex values are held in complex128, which is a reading's dtype too.
    monkeypatch.setattr(sv, "_read_frame", lambda *_args: replace(reading, values=reading.values.astype(np.complex128)))
    assert sv.read_frame(frame) is not None
    monkeypatch.setattr(sv, "_read_frame", lambda *_args: replace(reading, values=reading.values.astype(np.complex64)))
    with pytest.raises(TypeError, match="complex64"):
        sv.read_frame(frame)


def test_a_float32_trigger_events_channel_mean_is_taken_in_float64() -> None:
    """Two channels a float32 step apart: their mean lies between them, which float32 cannot hold (it gives 1.0)."""
    low, high = np.float32(1.0), np.float32(1.0 + 2.0**-23)
    samples = np.zeros((2, 2000), dtype=np.float32)
    samples[0, 500:600], samples[1, 500:600] = low, high
    events = wd.from_numpy(samples, sampling_rate=1000).trigger(threshold=0.5, duration=0.05, pre=0.01)
    assert len(events) == 1 and events.to_numpy().dtype == np.float32
    mean = 1.0 + 2.0**-24
    assert float(np.mean(np.array([low, high]))) != mean, "the float32 mean differs, or this test shows nothing"
    reading = sv.read_frame(events)
    assert reading is not None and reading.rows is not None
    assert float(reading.rows[0].max()) == mean and float(reading.values.max()) == mean
    # What the picture draws and what the pointer reads are that mean too.
    view = sv.stage_view(events)
    assert max(view["events"][0]["values"]) == mean
    data = stage_data(events, view)
    assert data is not None
    read = read_points([data], None, {"x": [0.0, 0.02], "event": int(events.event_ids[0])})
    assert read is not None and max(read["values"]) == mean
