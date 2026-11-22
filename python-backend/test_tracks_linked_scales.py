"""The Tracks rows' linked scales (Link scales) as the figure service decides them: a row is a figure of its own, and
a lane of it says which other rows' answers its automatic scale is shared with (the spec's ``scaleWith``). Each test
keeps rows of known values and draws one through the backend's own command.

- Linked waveforms share the range up of the largest sample of them all, whatever part of each is on screen.
- Linked spectrograms share one colour range: its top the highest level of them all, at most 100 dB.
- A row of another unit or reference keeps its own scales: the service leaves it out, not the screen.
- A range the request specifies is the request's, linked or not; an answer that is not kept is left out.
- A row named by its extent alone (a recording that is not on screen) gives the same shared scales as its samples and
  levels would, and stays kept when the store lets the large answers go.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from frames.level_identity import level_identity
from services.answer_store import EXTENTS, STORE
from services.tracks_answers import (
    SignalData,
    keep_track_image,
    keep_track_image_extent,
    keep_track_signal,
    keep_track_signal_extent,
)
from transport.command_dispatch import dispatch, validate_request

FS = level_identity("FS", 1.0, "dBFS")
PA = level_identity("Pa", 2e-5, "dB SPL")
RATE = 8000.0


def _ask(command: str, **payload: Any) -> dict[str, Any]:
    return dict(dispatch(validate_request({"cmd": command, "requestId": "r", **payload}), None))  # type: ignore[arg-type]


_drawn = iter(range(1_000_000))


def _draw(kind: str, key: str, others: list[str], view: dict[str, Any] | None = None) -> dict[str, Any]:
    figure = f"linked-{next(_drawn)}"
    lane = {"id": "lane", "kind": kind, "lines": [{"id": "line", "of": {"key": key}}], "scaleWith": others}
    try:
        picture = _ask(
            "figure-draw",
            figureId=figure,
            generation=1,
            requestNumber=1,
            spec={"lanes": [lane], "keys": [{"key": k, "state": "usable", "version": k} for k in [key, *others]]},
            width=600,
            height=200,
            view=view,
            selection=None,
        )
    finally:
        _ask("figure-release", figureId=figure)
    assert picture["status"] == "picture", picture
    return picture["lanes"][0]


def _signal(key: str, peak: float, identity: Any = FS, unit: str = "") -> str:
    # One second: silence but for one sample of ``peak`` at 0.75 s.
    values = np.zeros(int(RATE), dtype=np.float32)
    values[int(RATE * 0.75)] = peak
    values[10] = 0.01
    assert keep_track_signal(key, RATE, values, identity, unit)
    return key


def _image(key: str, low: float, high: float, identity: Any = FS) -> str:
    centres = (np.arange(20) + 0.5) / 20
    freqs = np.linspace(0.0, RATE / 2, 17)
    levels = np.full((17, 20), (low + high) / 2)
    levels[3, 4], levels[5, 6] = low, high
    assert keep_track_image(key, centres, freqs, levels, identity, "linear", 1.0, (low, high))
    return key


def test_linked_waveforms_share_the_range_up_of_the_largest_sample_of_them_all() -> None:
    loud, quiet = _signal("linked-wave-loud", 0.8), _signal("linked-wave-quiet", 0.2)
    own, largest = _draw("band", quiet, [])["range"]["y"], _draw("band", loud, [])["range"]["y"]
    assert own[1] < 0.3 < 0.8 <= largest[1]
    assert _draw("band", quiet, [loud])["range"]["y"] == largest
    # The loud row is the same linked with the quiet one.
    assert _draw("band", loud, [quiet])["range"]["y"] == largest


def test_a_linked_waveform_keeps_the_shared_range_when_its_loud_part_is_off_screen() -> None:
    loud, quiet = _signal("linked-wave-pan-loud", 0.8), _signal("linked-wave-pan-quiet", 0.2)
    # Zoomed to the first half second, where neither has its peak: the shared range stays (and alone, a row keeps its
    # own whole range: R16, test_tracks_scroll_range.py).
    zoomed = {"x": [0.0, 0.5]}
    assert _draw("band", quiet, [loud], zoomed)["range"]["y"] == _draw("band", loud, [])["range"]["y"]


def test_linked_spectrograms_share_one_colour_range_of_at_most_100_db_under_the_highest_level() -> None:
    loud, quiet = _image("linked-image-loud", -90.0, 0.0), _image("linked-image-quiet", -110.0, -20.0)
    assert _draw("image", quiet, [])["range"]["colour"] == [-110.0, -20.0]
    assert _draw("image", quiet, [loud])["range"]["colour"] == [-100.0, 0.0]
    assert _draw("image", loud, [quiet])["range"]["colour"] == [-100.0, 0.0]


def test_a_row_of_another_unit_or_reference_keeps_its_own_scales_when_linked() -> None:
    loud = _signal("linked-unit-loud", 0.8)
    pascal = _signal("linked-unit-pa", 0.2, PA, "Pa")
    assert _draw("band", pascal, [loud])["range"]["y"] == _draw("band", pascal, [])["range"]["y"]
    image, other = _image("linked-unit-image", -90.0, 0.0), _image("linked-unit-image-pa", -110.0, -20.0, PA)
    assert _draw("image", other, [image])["range"]["colour"] == [-110.0, -20.0]


def test_a_specified_range_is_the_requests_and_an_answer_not_kept_is_left_out() -> None:
    loud, quiet = _signal("linked-typed-loud", 0.8), _signal("linked-typed-quiet", 0.2)
    typed = {"x": [None, None], "lanes": [{"lane": "lane", "y": [-0.5, 0.5]}]}
    assert _draw("band", quiet, [loud], typed)["range"]["y"] == [-0.5, 0.5]
    assert not STORE.has("linked-never-kept")
    assert _draw("band", quiet, ["linked-never-kept"])["range"]["y"] == _draw("band", quiet, [])["range"]["y"]


def test_a_recording_named_by_its_extent_alone_gives_the_scales_its_samples_and_levels_would() -> None:
    loud, quiet = _signal("extent-wave-loud", 0.8), _signal("extent-wave-quiet", 0.2)
    kept = STORE.get(loud)
    assert isinstance(kept, SignalData)
    assert keep_track_signal_extent("extent-wave-loud-extent", kept.values, FS, "")
    # A few bytes stand for the recording: the lane's range is the one its every sample gives.
    assert EXTENTS.get("extent-wave-loud-extent").nbytes < 64
    assert _draw("band", quiet, ["extent-wave-loud-extent"])["range"]["y"] == _draw("band", quiet, [loud])["range"]["y"]
    image, other = _image("extent-image-loud", -90.0, 0.0), _image("extent-image-quiet", -110.0, -20.0)
    assert keep_track_image_extent("extent-image-loud-extent", (-90.0, 0.0), FS)
    assert _draw("image", other, ["extent-image-loud-extent"])["range"]["colour"] == [-100.0, 0.0]
    assert _draw("image", other, [image])["range"]["colour"] == [-100.0, 0.0]
    # A silent recording's extent counts for nothing, and one of another unit or reference is left out.
    assert keep_track_image_extent("extent-image-silent", None, FS)
    assert _draw("image", other, ["extent-image-silent"])["range"]["colour"] == [-110.0, -20.0]
    assert keep_track_signal_extent("extent-wave-pa", np.array([-5.0, 5.0]), PA, "Pa")
    assert _draw("band", quiet, ["extent-wave-pa"])["range"]["y"] == _draw("band", quiet, [])["range"]["y"]


def test_the_extents_stay_kept_when_the_store_lets_the_samples_go() -> None:
    quiet = _signal("extent-stays-quiet", 0.2)
    assert keep_track_signal_extent("extent-stays-loud", np.array([-0.8, 0.3]), FS, "")
    linked = _draw("band", quiet, ["extent-stays-loud"])["range"]["y"]
    budget = STORE.budget
    try:
        STORE.resize(0)
    finally:
        STORE.resize(budget)
    assert not STORE.has(quiet) and EXTENTS.has("extent-stays-loud")
    quiet = _signal("extent-stays-quiet", 0.2)
    assert _draw("band", quiet, ["extent-stays-loud"])["range"]["y"] == linked
