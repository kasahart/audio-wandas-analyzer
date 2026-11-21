"""The Tracks screen's kept answers (tracks_answers.py) are the values the old replies gave.

tests/fixtures/tracks_answers_cases.json was recorded from the old replies (``AnalysisService.spectrum_slice`` and
``pair_spectrum``) before the kept answers were written; the old replies and the recorder are gone.
The recorded values stay as what the kept answers must be, by the three rules the kept lines differ by
(tracks_answers.py): a level is never under MIN_LEVEL_DB, a phase is in degrees, a bin with no value is NaN.

A new case is added by writing its expected values from wandas directly, not by recording the code under test.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf

from frames import analysis_spec as spec
from services.analysis_engine import AnalysisEngine
from services.analysis_service import AnalysisService
from services.answer_store import STORE
from services.tracks_answers import LineData
from transport import protocol_schema
from transport.command_dispatch import dispatch, validate_request
from transport.figure_answers import StoreAnswers

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).parent / "tests" / "fixtures" / "tracks_answers_cases.json"
SOUNDS = ROOT / "src" / "test" / "fixtures"
#: How far a value may be from the recorded one (dB, degrees, coherence): FFT libraries differ in the last bits.
#: The values are float32, so the last bits of a large one (a gain of -300 dB where both recordings are silent) are
#: more than the absolute part: a value may also be off by that part of itself.
TOLERANCE = 1e-6
RELATIVE = 1e-6

#: The recordings the cases are of. ``changing`` and ``short`` are the committed fixtures (8 kHz, two channels);
#: the others are written by ``sounds`` from sines alone (16-bit: the same samples on every machine).
MADE: dict[str, dict[str, Any]] = {
    # 12 kHz, so a pair with an 8 kHz reference is resampled.
    "fast": {"rate": 12000, "seconds": 2.5, "channels": [[[440, 0.3], [1250, 0.1]], [[440, 0.15], [90, 0.05]]]},
    # Its first channel is silent: a gain from it has no value.
    "silent": {"rate": 8000, "seconds": 1.0, "channels": [[], [[440, 0.3]]]},
}

CURSOR_STFT = {"nFft": 512, "overlapPercent": 75, "window": "hann"}
PAIR_STFT = {"nFft": 256, "overlapPercent": 50, "window": "hann"}

#: What each case asks. A cursor case: a recording at a part of its length. A pair case: a reference channel, a
#: response channel, their offsets (s) and the range (s).
CASES: dict[str, dict[str, Any]] = {
    "cursor-middle": {"kind": "cursor", "sound": "changing", "cursor": 0.5},
    "cursor-start": {"kind": "cursor", "sound": "changing", "cursor": 0.0},
    "cursor-end": {"kind": "cursor", "sound": "changing", "cursor": 1.0},
    "cursor-silent-channel": {"kind": "cursor", "sound": "silent", "cursor": 0.5},
    "cursor-bands": {"kind": "cursor", "sound": "changing", "cursor": 0.5, "bands": 3},
    "pair-plain": {"kind": "pair", "x": ["changing", 0, 0.0], "y": ["changing", 1, 0.0]},
    "pair-offset-range": {"kind": "pair", "x": ["short", 0, 0.0], "y": ["changing", 1, 0.25], "range": [0.3, 0.9]},
    "pair-resampled": {"kind": "pair", "x": ["changing", 0, 0.0], "y": ["fast", 1, 0.0]},
    "pair-silent-reference": {"kind": "pair", "x": ["silent", 0, 0.0], "y": ["silent", 1, 0.0]},
    "pair-too-short": {"kind": "pair", "x": ["changing", 0, 0.0], "y": ["changing", 1, 0.0], "range": [0.5, 0.51]},
}


def sounds(folder: Path) -> dict[str, str]:
    """Every recording the cases name, by name: the committed ones where they are, the made ones in ``folder``."""
    paths = {"changing": str(SOUNDS / "changing-stereo.wav"), "short": str(SOUNDS / "short-stereo.wav")}
    for name, made in MADE.items():
        time = np.arange(int(made["rate"] * made["seconds"])) / made["rate"]
        rows = [
            sum((a * np.sin(2 * math.pi * hz * time) for hz, a in tones), np.zeros(time.size))
            for tones in made["channels"]
        ]
        path = folder / f"{name}.wav"
        sf.write(path, np.stack(rows, axis=1), made["rate"], subtype="PCM_16")
        paths[name] = str(path)
    return paths


def _source(paths: dict[str, str], named: list[Any]) -> dict[str, object]:
    return {"filePath": paths[named[0]], "channelIndex": named[1], "offsetSeconds": named[2]}


def _range(case: dict[str, Any]) -> dict[str, float]:
    return {"start_seconds": case["range"][0], "end_seconds": case["range"][1]} if "range" in case else {}


RECORDED: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"] if FIXTURE.exists() else {}


def _values(recorded: list[float | None]) -> np.ndarray:
    return np.array([np.nan if value is None else value for value in recorded], dtype=np.float64)


def _same(found: np.ndarray, recorded: np.ndarray, what: str) -> None:
    assert found.shape == recorded.shape, what
    assert np.array_equal(np.isnan(found), np.isnan(recorded)), f"{what}: the bins with no value differ"
    assert np.allclose(found, recorded, rtol=RELATIVE, atol=TOLERANCE, equal_nan=True), what


#: A gain under this is the rounding of an FFT where the measured channel has nothing (a ratio of 1e-10): which
#: number it rounds to differs by machine by several dB, so there it is only held to stay under it.
GAIN_FLOOR_DB = -200.0


def _same_gain(found: np.ndarray, recorded: np.ndarray, what: str) -> None:
    assert found.shape == recorded.shape, what
    assert np.array_equal(np.isnan(found), np.isnan(recorded)), f"{what}: the bins with no value differ"
    nothing = np.nan_to_num(recorded, nan=0.0) < GAIN_FLOOR_DB
    assert np.all(found[nothing] < GAIN_FLOOR_DB), f"{what}: a bin with nothing in it is no longer under the floor"
    _same(found[~nothing], recorded[~nothing], what)


def _line(key: str) -> LineData:
    kept = STORE.get(key)
    assert isinstance(kept, LineData), "the store keeps the line under the key the reply names"
    return kept


@pytest.fixture(autouse=True)
def _empty_store() -> Any:
    STORE.clear()
    yield
    STORE.clear()


def test_every_case_is_recorded() -> None:
    assert sorted(RECORDED) == sorted(CASES), "every case needs its recorded values in the fixture"


@pytest.mark.parametrize("name", sorted(name for name, case in CASES.items() if case["kind"] == "cursor"))
def test_a_kept_cursor_line_is_the_old_reply_s_every_bin(name: str, tmp_path: Path) -> None:
    case, recorded = CASES[name], RECORDED[name]["expected"]
    path = sounds(tmp_path)[case["sound"]]
    reply = AnalysisService(AnalysisEngine()).cursor_answers(
        path, cursor_norm=case["cursor"], stft_options=CURSOR_STFT, bands_per_octave=case.get("bands")
    )

    # The window is the old reply's: pushed inside at the ends of the file, the same samples.
    for key in ("windowStartNorm", "windowEndNorm", "window"):
        assert reply[key] == recorded[key], key  # type: ignore[literal-required]
    assert [channel["channelIndex"] for channel in reply["channels"]] == list(range(len(recorded["rows"])))
    rate = sf.info(path).samplerate
    for channel, row in zip(reply["channels"], recorded["rows"], strict=True):
        line = _line(channel["key"])
        # A level is never under the floor: the old reply's −inf (a silent channel) is the floor here.
        old = np.array([spec.MIN_LEVEL_DB if value is None else max(value, spec.MIN_LEVEL_DB) for value in row])
        _same(line.values, old, f"{name} channel {channel['channelIndex']}")
        assert line.quantity == "level"
        if "bands" in case:
            assert line.xs.tolist() == recorded["bandCentersHz"]
            assert (line.x_kind, line.x_scale) == ("band", "log")
            # Every file's bands are on one axis: the whole nominal range, whatever its sample rate.
            assert line.x_limits[0] < line.xs[0] and line.x_limits[1] == recorded["maxFrequencyHz"]
        else:
            # Every bin at its own frequency: k × rate / n_fft, up to the old reply's highest.
            assert line.xs.size == len(row) and line.xs[0] == 0.0
            assert line.xs[-1] == pytest.approx(recorded["maxFrequencyHz"])
            assert line.xs[1] == pytest.approx(rate / CURSOR_STFT["nFft"])
            assert (line.x_kind, line.x_scale, line.x_limits) == ("frequency", "log", (20.0, rate / 2))


@pytest.mark.parametrize("name", sorted(name for name, case in CASES.items() if case["kind"] == "pair"))
def test_a_kept_pair_s_lines_are_the_old_reply_s_with_the_phase_in_degrees(name: str, tmp_path: Path) -> None:
    case, recorded = CASES[name], RECORDED[name]["expected"]
    paths = sounds(tmp_path)
    reply = AnalysisService(AnalysisEngine()).pair_answers(
        _source(paths, case["x"]), [_source(paths, case["y"])], stft_options=PAIR_STFT, **_range(case)
    )

    response = reply["responses"][0]
    for key in ("status", "startSeconds", "endSeconds", "averages", "resampled", "calibrationStatus"):
        assert response[key] == recorded[key], key  # type: ignore[literal-required]
    assert (reply["nFft"], reply["hopLength"]) == (recorded["nFft"], recorded["hopLength"])
    if recorded["status"] != "ok":
        # A pair that cannot be averaged has no line (and says why in its status).
        assert "keys" not in response
        return
    keys = response["keys"]
    gain, phase, coherence = _line(keys["gain"]), _line(keys["phase"]), _line(keys["coherence"])
    # A gain with no value (the reference channel silent in that bin) stays without one: it is not a level at
    # the floor.
    _same_gain(gain.values, _values(recorded["gainDb"]), f"{name} gain")
    _same(phase.values, np.degrees(_values(recorded["phaseRad"])), f"{name} phase")
    _same(coherence.values, _values(recorded["coherence"]), f"{name} coherence")
    assert (gain.quantity, phase.quantity, phase.unit, coherence.quantity) == ("gain", "phase", "deg", "coherence")
    for line in (gain, phase, coherence):
        assert line.xs.size == recorded["nFft"] // 2 + 1
        assert line.xs[-1] == pytest.approx(recorded["maxFrequencyHz"])
        assert line.x_limits == (20.0, recorded["maxFrequencyHz"])


def test_an_answer_s_key_names_everything_it_is_of(tmp_path: Path) -> None:
    path = sounds(tmp_path)["changing"]
    service = AnalysisService(AnalysisEngine())

    def keys(**asked: Any) -> list[str]:
        options = {"cursor_norm": 0.5, "stft_options": CURSOR_STFT, **asked}
        return [channel["key"] for channel in service.cursor_answers(path, **options)["channels"]]

    first = keys()
    assert len(set(first)) == 2, "a key a channel"
    # Asked again: the same answers under the same keys.
    assert keys() == first
    # A cursor inside the same STFT frame is the same window, so the same answer.
    assert keys(cursor_norm=0.5 + 1e-6) == first
    different = [
        keys(cursor_norm=0.25),
        keys(stft_options={**CURSOR_STFT, "nFft": 1024}),
        keys(stft_options={**CURSOR_STFT, "window": "hamming"}),
        keys(bands_per_octave=3),
        keys(scale="linear"),
    ]
    assert len({key for found in [first, *different] for key in found}) == 2 * (1 + len(different))


def test_the_figure_service_draws_and_reads_the_kept_lines(tmp_path: Path) -> None:
    paths = sounds(tmp_path)
    service = AnalysisService(AnalysisEngine())
    cursor = service.cursor_answers(paths["changing"], cursor_norm=0.5, stft_options=CURSOR_STFT)
    pair = service.pair_answers(
        _source(paths, ["changing", 0, 0.0]), [_source(paths, ["changing", 1, 0.0])], stft_options=PAIR_STFT
    )
    pair_keys = pair["responses"][0]["keys"]
    answers = StoreAnswers()
    spectrum_keys = [channel["key"] for channel in cursor["channels"]]
    for key in (*spectrum_keys, *pair_keys.values()):
        answer = answers.answer(key)  # type: ignore[arg-type]
        assert answer is not None and answer.version == key

    def ask(command: str, **payload: Any) -> dict[str, Any]:
        return dict(dispatch(validate_request({"cmd": command, "requestId": "r", **payload}), None))  # type: ignore[arg-type]

    def draw(figure: str, lanes: list[dict[str, Any]], height: int) -> dict[str, Any]:
        keys = [line["of"]["key"] for lane in lanes for line in lane["lines"]]
        picture = ask(
            "figure-draw",
            figureId=figure,
            generation=1,
            requestNumber=1,
            spec={"lanes": lanes, "keys": [{"key": key, "state": "usable", "version": key} for key in keys]},
            width=900,
            height=height,
            view=None,
            selection=None,
        )
        assert picture["status"] == "picture", picture
        return picture

    def lane(name: str, keys: list[str], **more: Any) -> dict[str, Any]:
        return {"id": name, "kind": "lines", "lines": [{"id": key, "of": {"key": key}} for key in keys], **more}

    try:
        spectrum = draw("tracks-answers-spectrum", [lane("spectrum", spectrum_keys)], 120)
        assert len(spectrum["lanes"][0]["lines"]) == 2
        assert spectrum["lanes"][0]["range"]["x"] == [20.0, 4000.0]
        # The pair figure: three lanes of one Figure, each on a value axis of its own (dB, degrees, 0 to 1), over
        # one frequency axis.
        pair_picture = draw(
            "tracks-answers-pair", [lane(part, [pair_keys[part]], axis="own") for part in pair_keys], 360
        )
        drawn = {found["id"]: found for found in pair_picture["lanes"]}
        assert [len(drawn[part]["lines"]) for part in ("gain", "phase", "coherence")] == [1, 1, 1]
        assert [drawn[part]["axis"]["of"] for part in ("gain", "phase", "coherence")] == ["gain", "phase", "coherence"]
        # What an axis is of is a word the protocol lists: the page drops a picture whose axis says any other (it
        # checks every answer against the schema), so a quantity kept here must be named there.
        assert {drawn[part]["axis"]["of"] for part in drawn} <= set(protocol_schema._FIGURE_AXIS["of"]["enum"])
        assert drawn["phase"]["axis"]["valueUnit"] == "deg"
        assert drawn["phase"]["range"]["y"] == [-180.0, 180.0]
        assert drawn["coherence"]["range"]["y"] == [0.0, 1.0]
        assert all(found["range"]["x"] == [20.0, 4000.0] for found in drawn.values())
        # A read on the phase lane answers a bin of the kept line itself, in degrees.
        read = ask(
            "figure-read",
            figureId="tracks-answers-pair",
            pictureId=pair_picture["pictureId"],
            requestNumber=2,
            pointer={"lane": "phase", "x": 440.0, "y": 0.0, "scale": [900 / 3980, 120 / 360]},
        )
        assert read["status"] == "point", read
        phase = _line(pair_keys["phase"])
        at = int(np.argmin(np.abs(phase.xs - read["point"]["x"])))
        assert read["point"]["x"] == phase.xs[at] and read["point"]["value"] == pytest.approx(phase.values[at])
    finally:
        for figure in ("tracks-answers-spectrum", "tracks-answers-pair"):
            ask("figure-release", figureId=figure)


def test_the_two_commands_answer_keys_and_no_value(tmp_path: Path) -> None:
    from transport.protocol_schema import COMMANDS, DEFINITIONS

    paths = sounds(tmp_path)
    service = AnalysisService(AnalysisEngine())

    def ask(command: str, **payload: Any) -> dict[str, Any]:
        reply = dict(dispatch(validate_request({"cmd": command, "requestId": "r", **payload}), service))
        declared = DEFINITIONS[COMMANDS[command]["result"]]
        # The reply is what the protocol declares: every required field, and no field it does not name.
        assert set(declared["required"]) <= set(reply) <= set(declared["properties"])
        return reply

    cursor = ask("cursor-answers", filePath=paths["changing"], cursorNorm=0.5, stftOptions=CURSOR_STFT, scale="linear")
    assert [sorted(channel) for channel in cursor["channels"]] == [["channelIndex", "key", "level"]] * 2
    # An uncalibrated recording's levels are in dBFS.
    assert cursor["channels"][0]["level"]["label"] == "dBFS"
    assert _line(cursor["channels"][0]["key"]).x_scale == "linear"
    pair = ask(
        "pair-answers",
        reference=_source(paths, ["changing", 0, 0.0]),
        responses=[_source(paths, ["changing", 1, 0.0]), _source(paths, ["short", 1, 5.0])],
        stftOptions=PAIR_STFT,
    )
    first, apart = pair["responses"]
    assert sorted(first["keys"]) == ["coherence", "gain", "phase"]
    # Recordings that do not overlap have no line.
    assert apart["status"] == "no-overlap" and "keys" not in apart
