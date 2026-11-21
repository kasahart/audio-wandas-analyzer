"""A Tracks row's kept answers (tracks_answers.py): each channel's samples and its STFT's levels.

- The samples kept are the recording's own, every one, and are made once (an answer under a key never changes).
- The levels kept are every STFT cell's, never averaged to be drawn: against wandas directly.
- With the automatic settings a time window's levels are of the window's own STFT (R3); with settings given they are
  the whole file's.
- The figure service draws the two as a band lane and an image lane on a linear frequency axis from 0 Hz.
- A channel's extents are named beside them, and asked alone they are kept without the samples and levels.
- A recording shorter than the STFT's window keeps its samples and says why it names no levels.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest

from services.analysis_engine import AnalysisEngine, compute_spectrogram
from services.analysis_service import AnalysisService
from services.analyzer import resolve_stft_params
from services.answer_store import EXTENTS, STORE
from services.tracks_answers import ImageData, SignalData
from transport.command_dispatch import dispatch, validate_request

SOUND = Path(__file__).resolve().parents[1] / "src" / "test" / "fixtures" / "changing-stereo.wav"


@pytest.fixture
def service() -> AnalysisService:
    return AnalysisService(AnalysisEngine())


def test_the_samples_kept_are_the_recordings_own_and_are_made_once(service: AnalysisService) -> None:
    answers = service.track_answers(SOUND, spectrogram=False)
    _, frame, _ = service.engine.get_analysis(SOUND)
    samples = np.asarray(frame.data)
    assert [channel["channelIndex"] for channel in answers["channels"]] == [0, 1]
    assert all("image" not in channel for channel in answers["channels"])
    kept = [STORE.get(channel["signal"]) for channel in answers["channels"]]
    for index, signal in enumerate(kept):
        assert isinstance(signal, SignalData)
        assert signal.rate == frame.sampling_rate
        np.testing.assert_array_equal(signal.values, samples[index])
    assert answers["durationSeconds"] == frame.n_samples / frame.sampling_rate
    # Asked again: the same keys, and the arrays the store holds already (nothing is read or copied again).
    again = service.track_answers(SOUND, spectrogram=False)
    assert again["channels"] == answers["channels"]
    assert all(STORE.get(channel["signal"]) is kept[index] for index, channel in enumerate(again["channels"]))


def test_the_levels_kept_are_every_cell_of_the_whole_files_stft(service: AnalysisService) -> None:
    answers = service.track_answers(SOUND)
    _, frame, _ = service.engine.get_analysis(SOUND)
    n_fft, hop, window = resolve_stft_params(int(frame.n_samples), None)
    assert (answers["windowSize"], answers["hopSize"], answers["windowed"]) == (n_fft, hop, False)
    stft = compute_spectrogram(frame, n_fft, hop, window)
    levels = np.asarray(stft.dB)
    for index, channel in enumerate(answers["channels"]):
        image = STORE.get(channel["image"])
        assert isinstance(image, ImageData)
        assert image.values.shape == (n_fft // 2 + 1, stft.n_frames)
        np.testing.assert_allclose(image.values, np.maximum(levels[index], -300.0), atol=1e-4)
        np.testing.assert_allclose(image.ys, np.asarray(stft.freqs))
        assert image.xs.size == stft.n_frames
        assert (image.x_limits, image.y_limits) == ((0.0, answers["durationSeconds"]), (0.0, frame.sampling_rate / 2))


def test_a_time_windows_levels_are_of_its_own_stft_with_the_automatic_settings(service: AnalysisService) -> None:
    window = (0.4, 0.5)
    whole = service.track_answers(SOUND)
    zoomed = service.track_answers(SOUND, time_window=window)
    assert zoomed["windowed"] is True
    assert zoomed["hopSize"] < whole["hopSize"]
    # The answer names the STFT of the analysis the row shows, not the window's finer hop: the screen takes a row's
    # answer only when it is of the analysis it shows (lazyResponses.ts isOfShownVersion), and would drop this one.
    assert zoomed["stftSignature"] == whole["stftSignature"] == service.analyze(SOUND)["stftSignature"]
    assert zoomed["channels"][0]["image"] != whole["channels"][0]["image"]
    # The samples are the whole recording's either way.
    assert zoomed["channels"][0]["signal"] == whole["channels"][0]["signal"]
    for channel in zoomed["channels"]:
        image = STORE.get(channel["image"])
        assert isinstance(image, ImageData)
        # The frames in the window, and one beside each end.
        seconds = whole["durationSeconds"]
        inside = (image.xs >= window[0] * seconds) & (image.xs <= window[1] * seconds)
        assert inside[1:-1].all() and inside.sum() >= image.xs.size - 2
    # The colours are the whole recording's: the window's own STFT says the whole file's lowest and highest level.
    for index, channel in enumerate(zoomed["channels"]):
        of_whole, of_window = STORE.get(whole["channels"][index]["image"]), STORE.get(channel["image"])
        assert isinstance(of_whole, ImageData) and isinstance(of_window, ImageData)
        assert of_whole.extent == (float(of_whole.values.min()), float(of_whole.values.max()))
        assert of_window.extent == of_whole.extent
    # Asked again, with the hop the window's STFT has (not made again).
    assert service.track_answers(SOUND, time_window=window) == zoomed


def test_with_stft_settings_given_the_levels_are_the_whole_files_whatever_the_window(service: AnalysisService) -> None:
    options = {"nFft": 256, "overlapPercent": 50, "window": "hann"}
    whole = service.track_answers(SOUND, stft_options=options)
    zoomed = service.track_answers(SOUND, stft_options=options, time_window=(0.4, 0.5))
    assert zoomed["windowed"] is False
    assert zoomed["channels"] == whole["channels"]
    assert (whole["windowSize"], whole["hopSize"]) == (256, 128)


def _ask(command: str, **payload: Any) -> dict[str, Any]:
    return dict(dispatch(validate_request({"cmd": command, "requestId": "r", **payload}), None))  # type: ignore[arg-type]


def test_a_row_is_drawn_as_a_band_lane_and_an_image_lane_on_a_linear_frequency_axis(service: AnalysisService) -> None:
    answers = service.track_answers(SOUND)
    channel = answers["channels"][0]
    keys = [channel["signal"], channel["image"]]
    try:
        picture = _ask(
            "figure-draw",
            figureId="track-row-test",
            generation=1,
            requestNumber=1,
            spec={
                "lanes": [
                    {"id": "wave", "kind": "band", "lines": [{"id": "s", "of": {"key": keys[0]}}]},
                    {"id": "spec", "kind": "image", "lines": [{"id": "i", "of": {"key": keys[1]}}]},
                ],
                "keys": [{"key": key, "state": "usable", "version": key} for key in keys],
            },
            width=900,
            height=240,
            view={"x": [0.0, answers["durationSeconds"]]},
            selection=None,
        )
    finally:
        _ask("figure-release", figureId="track-row-test")
    assert picture["status"] == "picture", picture
    wave, image = picture["lanes"]
    # As fine as the old lane drew it, a cell per pixel: more rows than one per two pixels of a lane that is at most
    # half the figure's 240 px (the comparison bench's heatmaps keep one cell per two pixels).
    assert len(image["image"]["cells"]) > 240 / 2 / 2
    assert image["axis"]["yScale"] == "linear"
    assert image["range"]["y"] == [0.0, answers["sampleRateHz"] / 2]
    # A zoom or a pan keeps the colours: the colour range is of the whole recording's levels, not of the cells on
    # screen (a quiet stretch on screen is not brightened).
    try:
        zoomed = _ask(
            "figure-draw",
            figureId="track-row-zoom",
            generation=1,
            requestNumber=1,
            spec={
                "lanes": [{"id": "spec", "kind": "image", "lines": [{"id": "i", "of": {"key": keys[1]}}]}],
                "keys": [{"key": keys[1], "state": "usable", "version": keys[1]}],
            },
            width=900,
            height=240,
            view={"x": [0.0, 0.2], "lanes": [{"lane": "spec", "y": [3000.0, 4000.0]}]},
            selection=None,
        )
    finally:
        _ask("figure-release", figureId="track-row-zoom")
    assert zoomed["lanes"][0]["range"]["colour"] == image["range"]["colour"] == image["whole"]["colour"]
    # Both lanes are drawn over the time the screen asks for (the rows share one time axis).
    assert wave["range"]["x"] == image["range"]["x"] == [0.0, answers["durationSeconds"]]


def test_the_command_answers_the_keys_and_no_value(service: AnalysisService) -> None:
    asked = {"cmd": "track-answers", "requestId": "r", "filePath": str(SOUND), "startNorm": 0.4, "endNorm": 0.5}
    reply = dict(dispatch(validate_request(asked), service))
    assert reply == service.track_answers(SOUND, time_window=(0.4, 0.5))
    assert reply["windowed"] is True
    names = {"channelIndex", "level", "unit", "signal", "image", "signalExtent", "imageExtent"}
    assert all(set(channel) == names for channel in reply["channels"])
    # A row that shows no spectrogram asks for the samples alone.
    alone = dict(dispatch(validate_request({**asked, "spectrogram": False}), service))
    assert all("image" not in channel and "signal" in channel for channel in alone["channels"])


def test_a_channels_extents_are_named_beside_its_answers_and_alone_without_them(service: AnalysisService) -> None:
    STORE.clear()
    EXTENTS.clear()
    # Asked alone (a recording that is not on screen, for the rows' linked scale): no sample and no level is kept.
    alone = service.track_answers(SOUND, extents=True)
    assert STORE.nbytes() == 0
    assert all("signal" not in channel and "image" not in channel for channel in alone["channels"])
    _, frame, _ = service.engine.get_analysis(SOUND)
    samples = np.asarray(frame.data)
    n_fft, hop, window = resolve_stft_params(int(frame.n_samples), None)
    levels = np.asarray(compute_spectrogram(frame, n_fft, hop, window).dB)
    for index, channel in enumerate(alone["channels"]):
        signal, image = EXTENTS.get(channel["signalExtent"]), EXTENTS.get(channel["imageExtent"])
        assert isinstance(signal, SignalData) and isinstance(image, ImageData)
        assert list(signal.values) == [float(samples[index].min()), float(samples[index].max())]
        above = levels[index][levels[index] > -300.0]
        assert image.extent is not None
        np.testing.assert_allclose(image.extent, (above.min(), above.max()), atol=1e-4)
    # With the row's own answers the same extents are named; a window's answers name the whole file's too.
    whole = service.track_answers(SOUND)
    windowed = service.track_answers(SOUND, time_window=(0.4, 0.5))
    for reply in (whole, windowed):
        assert [(c["signalExtent"], c["imageExtent"]) for c in reply["channels"]] == [
            (c["signalExtent"], c["imageExtent"]) for c in alone["channels"]
        ]
    # Without a spectrogram, the samples' extents alone.
    plain = service.track_answers(SOUND, spectrogram=False, extents=True)
    assert all("imageExtent" not in channel and "signalExtent" in channel for channel in plain["channels"])


def test_a_recording_shorter_than_the_stft_window_keeps_its_samples_and_says_why_it_has_no_levels(
    service: AnalysisService, tmp_path: Path
) -> None:
    import soundfile as sf

    short = tmp_path / "short.wav"
    samples = (0.25 * np.sin(2 * np.pi * 440 * np.arange(1000) / 8000)).astype(np.float32)
    sf.write(short, samples, 8000, subtype="FLOAT")
    # An FFT size set by hand for longer recordings: 1000 samples are under half a window of 4096.
    options = {"nFft": 4096, "overlapPercent": 50, "window": "hann"}
    answers = service.track_answers(short, stft_options=options)
    assert answers["noLevels"] == "too-short"
    (channel,) = answers["channels"]
    assert "image" not in channel and "imageExtent" not in channel
    kept = STORE.get(channel["signal"])
    assert isinstance(kept, SignalData)
    np.testing.assert_array_equal(kept.values, samples)
    assert "signalExtent" in channel
    # Its extents alone say the same; with a window that fits, the levels are there and nothing is said.
    assert service.track_answers(short, stft_options=options, extents=True)["noLevels"] == "too-short"
    fits = service.track_answers(short, stft_options={"nFft": 256, "overlapPercent": 50, "window": "hann"})
    assert "noLevels" not in fits and "image" in fits["channels"][0]
