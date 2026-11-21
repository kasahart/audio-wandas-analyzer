"""A Frame's reading is float64, whatever dtype its recording was read in (docs/display-rules.md R1).

A 16-bit WAV is read as float32. ``stage_view.read_frame`` takes every number of a Frame as float64 (complex128 for
complex values) with ``stage_view._taken`` before it averages channels, so no median, difference, range or readout is
computed in float32, and it checks every array field of the reading, a field added later included.

If one of these fails: take the Frame's array with ``stage_view._taken`` in its branch of ``stage_view._read_frame``
before any arithmetic on it. Do not convert later, in a view or in stage_combine.py: by then a channel mean may have
been taken in float32. A new array field of flags (not numbers) goes into ``stage_view.READING_FLAG_FIELDS``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import fields, replace

import numpy as np
import pytest
import wandas as wd

from frames import stage_view as sv
from services.stage_combine import stage_data

RATE = 16000


def _recording(seconds: float, seed: int = 3) -> wd.ChannelFrame:
    """Two channels of a 1 kHz tone in bursts with a little noise, the second channel noisier: enough for every kind."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(RATE * seconds)) / RATE
    gate = (((t - 0.02) % 0.15) < 0.05).astype(float)
    tone = 0.5 * np.sin(2 * np.pi * 1000 * t) * gate + 0.01 * rng.standard_normal(t.size)
    return wd.from_numpy(np.stack([tone, tone + 0.02 * rng.standard_normal(t.size)]), sampling_rate=RATE)


#: Every Frame kind the comparison draws, by a name for the test's id, made from a recording.
_KINDS: dict[str, Callable[[wd.ChannelFrame], object]] = {
    "signal": lambda s: s,
    "metric series": lambda s: s.rms_trend(frame_length=64, hop_length=16),
    "level series": lambda s: s.rms_trend(frame_length=64, hop_length=16, dB=True),
    "spectrum": lambda s: s.fft(),
    "bands": lambda s: s.noct_spectrum(fmin=50, fmax=5000, n=3),
    "spectrogram": lambda s: s.stft(n_fft=256, hop_length=64),
    "cepstrum": lambda s: s.cepstrum(),
    "cepstrogram": lambda s: s.stft(n_fft=256, hop_length=64).cepstrum(),
    "coherence": lambda s: s.coherence(n_fft=4096),
    "cross spectrum": lambda s: s.csd(n_fft=4096),
    "transfer function": lambda s: s.transfer_function(n_fft=4096),
    "cross-correlation": lambda s: s.cross_correlation(),
    "roughness": lambda s: s.roughness_dw_spec(),
    "trigger events": lambda s: s.trigger(threshold=0.3, duration=0.04, pre=0.005),
}


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
    # What is kept for the figure service is that mean too.
    data = stage_data(events, sv.stage_view(events))
    assert data is not None and data.rows is not None
    assert float(data.rows[0].max()) == mean
