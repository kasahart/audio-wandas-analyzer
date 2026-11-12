"""A Frame's reading is float64, whatever dtype its recording was read in (docs/display-rules.md R1).

A 16-bit WAV is read as float32. ``stage_view.read_frame`` converts every number it takes of a Frame to float64
before it averages channels, so no median, difference, range or readout is computed in float32.

If one of these fails: convert the Frame's data with ``_f64`` (or ``_rows`` / ``_plane``) in its branch of
``stage_view._read_frame`` before computing with it. A new number field of ``FrameReading`` goes into
``stage_view.READING_NUMBER_FIELDS``.
"""

from __future__ import annotations

from dataclasses import fields

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
    assert set(arrays) - {"whole"} <= set(sv.READING_NUMBER_FIELDS), (
        f"FrameReading has an array field not in stage_view.READING_NUMBER_FIELDS: {sorted(arrays)}. Add it there, "
        "so read_frame checks its dtype."
    )
    for name, array in arrays.items():
        expected = np.bool_ if name == "whole" else np.float64
        assert array.dtype == expected, (
            f"{kind}: the reading's {name} is {array.dtype}, not {np.dtype(expected)}. Convert the Frame's data "
            "with _f64 in its branch of stage_view._read_frame before computing with it."
        )


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
