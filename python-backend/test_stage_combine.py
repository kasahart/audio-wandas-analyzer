from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from command_dispatch import dispatch, validate_request
from protocol_schema import DEFINITIONS, first_violation
from stage_combine import STORE, _Store, combine, difference_line, draw, stage_data
from stage_view import stage_view

RATE = 16000
ENTRY_RECIPE = json.loads((Path(__file__).parent / "recipes" / "entry-scan.recipe.json").read_text())


@pytest.fixture(scope="module")
def signal() -> wd.ChannelFrame:
    rng = np.random.default_rng(7)
    tone = 0.5 * np.sin(2 * np.pi * 1000 * np.arange(RATE * 2) / RATE) + 0.01 * rng.standard_normal(RATE * 2)
    return wd.from_numpy(tone[np.newaxis], sampling_rate=RATE)


def _frames(signal: wd.ChannelFrame) -> dict[str, tuple[object, float | None]]:
    two = wd.from_numpy(np.stack([signal.data, np.roll(signal.data, 40)]), sampling_rate=RATE)
    return {
        "series": (signal.rms_trend(), None),
        "spectrum": (signal.welch(n_fft=1024), None),
        "fft": (signal.fft(), None),
        "coherence": (two.coherence(n_fft=1024), None),
        "bands": (signal.noct_spectrum(n=3, fmin=50, fmax=5000), None),
        "spectrogram": (signal.stft(n_fft=512), 2.0),
        "cepstrum": (signal.cepstrum(), None),
        "cepstrogram": (signal.stft(n_fft=512).cepstrum(), 2.0),
        "correlation": (two.cross_correlation(), None),
    }


def _same(drawn: dict, view: dict) -> None:
    for key in ("frame", "kind", "x", "xScale", "quantity", "yAxis", "whole", "detail"):
        assert drawn.get(key) == view.get(key), key
    assert drawn["xs"] == pytest.approx(view["xs"])
    if "matrix" in view:
        assert drawn["ys"] == pytest.approx(view["ys"])
        assert np.asarray(drawn["matrix"], dtype=float) == pytest.approx(
            np.asarray(view["matrix"], dtype=float), abs=0.11
        )
    else:
        assert np.asarray(drawn["values"], dtype=float) == pytest.approx(
            np.asarray(view["values"], dtype=float), abs=0.011
        )


@pytest.mark.parametrize(
    "name", ["series", "spectrum", "fft", "coherence", "bands", "spectrogram", "cepstrum", "cepstrogram", "correlation"]
)
def test_one_recordings_values_draw_as_its_own_picture(signal: wd.ChannelFrame, name: str) -> None:
    # A median is drawn as the recordings' own pictures are: one recording's values draw its picture.
    frame, signal_s = _frames(signal)[name]
    view = dict(stage_view(frame, signal_s))
    data = stage_data(frame, view, signal_s)
    assert data is not None
    _same(dict(draw(data)), view)
    if view["kind"] == "bar":
        return
    x = view["xs"]
    detail = {"x": [x[len(x) // 4], x[len(x) // 2]], "points": 300}
    _same(dict(draw(data, detail)), dict(stage_view(frame, signal_s, detail)))


def test_a_difference_line_keeps_every_buckets_extremes_at_their_own_places() -> None:
    xs = np.arange(1000, dtype=float)
    values = np.zeros(1000)
    values[123], values[777] = 9.0, -4.0
    drawn_x, drawn = difference_line(xs, values, 50, log=False)
    assert drawn.size <= 100
    assert drawn.max() == 9.0 and drawn.min() == -4.0
    assert drawn_x[np.argmax(drawn)] == 123 and drawn_x[np.argmin(drawn)] == 777
    # Log-spaced buckets on a log axis; non-finite values have no point.
    values[5] = np.nan
    log_x, _ = difference_line(xs + 1, values, 50, log=True)
    assert 6.0 not in log_x


def test_a_narrow_difference_is_taken_bin_by_bin_and_kept_when_drawn(signal: wd.ChannelFrame) -> None:
    # One bin at 3 kHz as loud as the tone in the compared recording: averaged into its 192-point band first, it
    # would read less; taken bin by bin and then drawn per bucket's extremes, it reads all of it.
    base = signal.fft()
    view = dict(stage_view(base))
    base_data = stage_data(base, view)
    assert base_data is not None
    raised = base_data.values.copy()
    at = int(np.argmin(np.abs(base_data.xs - 3000)))
    raised[at] = base_data.values.max()
    rise = raised[at] - base_data.values[at]
    assert rise > 40
    result = combine([base_data], replace(base_data, values=raised))
    assert max(abs(v) for v in result["diff"]["values"] if v is not None) == pytest.approx(rise, abs=0.01)
    assert first_violation(DEFINITIONS["StageView"], result["diff"]) is None
    headline = result["headline"]
    assert headline["x"] == pytest.approx(base_data.xs[at])
    assert headline["compare"] - headline["base"] == pytest.approx(rise, abs=0.01)
    # A difference zoomed into the range on screen, from every bin there.
    zoomed = combine([base_data], replace(base_data, values=raised), {"x": [2500.0, 3500.0], "points": 200})
    assert zoomed["diff"]["detail"] is True
    assert max(zoomed["diff"]["values"]) == pytest.approx(rise, abs=0.01)
    assert "headline" not in zoomed


def test_a_groups_median_is_taken_bin_by_bin_before_it_is_drawn(signal: wd.ChannelFrame) -> None:
    data = stage_data(signal.fft(), dict(stage_view(signal.fft())))
    assert data is not None
    rng = np.random.default_rng(1)
    members = [replace(data, values=data.values + rng.normal(0, 6, data.values.size)) for _ in range(3)]
    result = combine(members, None)
    expected = draw(replace(data, values=np.median(np.stack([m.values for m in members]), axis=0)))
    assert result["base"]["values"] == expected["values"]
    # It is not the median of the members' drawn pictures.
    drawn = np.median(np.stack([np.asarray(draw(m)["values"], dtype=float) for m in members]), axis=0)
    assert not np.allclose(np.asarray(result["base"]["values"], dtype=float), drawn, atol=0.05)
    assert "diff" not in result


def test_levels_over_time_are_compared_block_by_block(signal: wd.ChannelFrame) -> None:
    louder = wd.from_numpy(signal.data[np.newaxis] * 2, sampling_rate=RATE)
    base, compare = (stage_data(frame, dict(stage_view(frame))) for frame in (signal, louder))
    assert base is not None and compare is not None
    result = combine([base], compare)
    assert len(result["diff"]["values"]) == len(stage_view(signal)["values"])
    assert np.asarray(result["diff"]["values"], dtype=float) == pytest.approx(20 * np.log10(2), abs=0.02)
    assert result["headline"]["compare"] - result["headline"]["base"] == pytest.approx(6.02, abs=0.02)
    # Of different lengths: the part both have.
    shorter = stage_data(signal.trim(0, 1.0), dict(stage_view(signal.trim(0, 1.0))))
    assert shorter is not None
    assert combine([base, shorter], None)["base"]["xs"][-1] <= 1.0


def test_pictures_on_other_axes_have_no_median_or_difference(signal: wd.ChannelFrame) -> None:
    spectrum = stage_data(signal.welch(n_fft=1024), dict(stage_view(signal.welch(n_fft=1024))))
    other = stage_data(signal.welch(n_fft=512), dict(stage_view(signal.welch(n_fft=512))))
    assert spectrum is not None and other is not None
    assert combine([spectrum], other) == {"ok": True}


def test_the_store_drops_the_least_recently_used_beyond_its_budget(signal: wd.ChannelFrame) -> None:
    data = stage_data(signal.fft(), dict(stage_view(signal.fft())))
    assert data is not None
    store = _Store(int(data.nbytes * 2.5))
    store.put("a", data)
    store.put("b", data)
    assert store.get("a") is data
    store.put("c", data)
    assert (store.has("a"), store.has("b"), store.has("c")) == (True, False, True)


def _scan(service: AnalysisService, path: str, **payload: object) -> dict:
    request = validate_request({"cmd": "scan", "requestId": "r", "filePath": path, "recipe": ENTRY_RECIPE, **payload})
    return dispatch(request, service)


def _combine(service: AnalysisService, **payload: object) -> dict:
    request = validate_request({"cmd": "stage-combine", "requestId": "r", **payload})
    result = dispatch(request, service)
    assert first_violation(DEFINITIONS["StageCombineResult"], result) is None
    return dict(result)


def test_a_scans_step_keeps_its_values_for_the_combine_command(tmp_path: Path) -> None:
    service = AnalysisService(AnalysisEngine())
    paths = []
    for index, amplitude in enumerate((0.1, 0.2, 0.4)):
        path = tmp_path / f"{index}.wav"
        sf.write(path, amplitude * np.sin(2 * np.pi * 1000 * np.arange(RATE * 2) / RATE), RATE, subtype="FLOAT")
        paths.append(str(path))
    views = [_scan(service, path, stage="node-2")["stage"] for path in paths]
    keys = [view["data"] for view in views]
    assert len(set(keys)) == 3
    # A zoomed picture of the same step names the same values.
    zoomed = _scan(service, paths[0], stage="node-2", detail={"x": [500.0, 2000.0], "points": 200})["stage"]
    assert zoomed["data"] == keys[0]
    result = _combine(service, base=keys[:2], compare=keys[2])
    assert result["ok"] is True and result["base"]["kind"] == "line"
    # The median of 0.1 and 0.2 is their mean in dB: 0.4 is 6 + 3 dB above it at 1 kHz.
    assert result["headline"]["x"] == pytest.approx(1000, rel=0.05)
    assert result["headline"]["compare"] - result["headline"]["base"] == pytest.approx(
        20 * np.log10(4 / np.sqrt(2)), abs=0.1
    )
    STORE.clear()
    assert _combine(service, base=keys[:2], compare=keys[2]) == {"ok": False, "missing": keys}


def test_levels_at_different_rates_are_compared_at_the_same_times(signal: wd.ChannelFrame) -> None:
    base = stage_data(signal, dict(stage_view(signal)))
    louder = wd.from_numpy(signal.data[np.newaxis] * 2, sampling_rate=RATE).resampling(target_sr=22050)
    compare = stage_data(louder, dict(stage_view(louder)))
    assert base is not None and compare is not None
    result = combine([base], compare)
    diff = np.asarray(result["diff"]["values"], dtype=float)
    assert diff.size > 100
    assert np.nanmedian(diff) == pytest.approx(20 * np.log10(2), abs=0.05)


def test_the_headline_names_only_frequencies_that_are_drawn(signal: wd.ChannelFrame) -> None:
    # 8 Hz is below the drawn range: a large difference there does not head the comparison.
    t = np.arange(RATE * 2) / RATE
    low = wd.from_numpy(signal.data[np.newaxis] + 0.5 * np.sin(2 * np.pi * 8 * t), sampling_rate=RATE)
    base, compare = (stage_data(f.welch(n_fft=4096), dict(stage_view(f.welch(n_fft=4096)))) for f in (signal, low))
    assert base is not None and compare is not None
    headline = combine([base], compare)["headline"]
    assert headline["x"] >= 20
    # Nor does a loud DC offset set how loud a drawn difference must be to head it.
    offset = replace(compare, values=compare.values.copy())
    offset.values[0] = compare.values.max() + 60
    assert combine([base], offset)["headline"]["x"] == pytest.approx(headline["x"])


def test_levels_already_in_db_are_headlined_where_they_can_be_heard() -> None:
    # sound_level with dB on (a step's form can set it): the headline is the audible 6 dB, not the difference
    # between one file's silence and the other's faint background before the tone.
    rate = 16000
    t = np.arange(rate * 2) / rate
    on = t >= 0.5
    rng = np.random.default_rng(7)
    quiet = np.where(on, 0.1 * np.sin(2 * np.pi * 1000 * t), 1e-9 * rng.standard_normal(t.size))
    loud = np.where(on, 0.2 * np.sin(2 * np.pi * 1000 * t), 1e-6 * rng.standard_normal(t.size))
    frames = [wd.from_numpy(x[None], sampling_rate=rate).sound_level(dB=True) for x in (quiet, loud)]
    data = [stage_data(frame, dict(stage_view(frame))) for frame in frames]
    assert all(item is not None for item in data)
    result = combine([data[0]], data[1])  # type: ignore[list-item]
    headline = result["headline"]
    assert headline["x"] >= 0.5
    assert headline["compare"] - headline["base"] == pytest.approx(6.0, abs=0.5)
