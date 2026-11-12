"""Every drawn point is at the x of the data it shows (docs/display-rules.md R2, "A drawn point is at its own x").

The backend thins a step's output to draw it. Whatever the Frame kind and whichever thinning routine draws it, a
drawn point must sit where its source value is: at the time of that sample, the frequency of that bin, the lag of
that coefficient. An image's column, which is several frames averaged, must sit inside the frames it averages. And
the point the pointer then reads (stage_combine.read_points) must have that same x.

Each test here works out the source's x itself, straight from the wandas Frame (``_source``), and compares the
picture with it. So a picture whose x was computed some other way than from the source's own axis fails here.

If one of these fails:
- A drawn x that is no source x: some code made the x itself (scaled a fraction, rebuilt a time from a count).
  Take it from ``stage_view.x_at(reading, index)`` instead, with the index of the value drawn.
- A new Frame kind is missing from ``_KINDS``: add it there and to ``_source`` below (``test_every_drawn_frame_kind
  is_covered`` names it).
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pytest
import wandas as wd

import analysis_spec as spec
import stage_view as sv
from decimator import bucket_edges, decimated_waveform
from stage_combine import combine, read_points, stage_data
from stage_view import stage_view

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

#: Long enough that every thinning routine thins (more samples, bins, lags and columns than a picture draws).
LONG_S = 2.0
#: Short enough that nothing is thinned: every source value is drawn, so the picture's xs are the source's.
SHORT_S = 0.06
#: The kinds that need other settings to be made of so short a recording, or a longer one (wandas' roughness needs
#: half a second; it then still has fewer columns than an image draws): the recording's length and how it is made.
_UNTHINNED: dict[str, tuple[float, Callable[[wd.ChannelFrame], object]]] = {
    "coherence": (SHORT_S, lambda s: s.coherence(n_fft=256)),
    "cross spectrum": (SHORT_S, lambda s: s.csd(n_fft=256)),
    "transfer function": (SHORT_S, lambda s: s.transfer_function(n_fft=256)),
    "roughness": (0.5, _KINDS["roughness"]),
    "trigger events": (0.5, lambda s: s.trigger(threshold=0.3, duration=0.02, pre=0.005)),
}


def _source(frame: object) -> tuple[np.ndarray, np.ndarray | None]:
    """A Frame's own x of every value, worked out here from wandas (never by the code under test), and for an image
    its rows' y. Times are seconds into the file."""
    if isinstance(frame, wd.ChannelFrame):
        if frame.operation_history and frame.operation_history[-1]["operation"].endswith("rms_trend"):
            return np.asarray(frame.source_time, dtype=np.float64).reshape(frame.n_channels, -1)[0], None
        return np.arange(frame.n_samples) / frame.sampling_rate, None
    name = type(frame).__name__
    if name == "ChannelFrameSegments":
        samples = frame.to_numpy().shape[-1]  # type: ignore[attr-defined]
        return np.arange(samples) / frame[0].sampling_rate - frame.pre, None  # type: ignore[index,attr-defined]
    if name in ("SpectralFrame", "CoherenceFrame", "CrossSpectralFrame", "TransferFunctionFrame"):
        return np.asarray(frame.freqs, dtype=np.float64), None  # type: ignore[attr-defined]
    if name == "NOctFrame":
        return np.asarray(frame.freqs, dtype=np.float64), None  # type: ignore[attr-defined]
    if name == "CepstralFrame":
        return np.asarray(frame.quefrencies, dtype=np.float64), None  # type: ignore[attr-defined]
    if name == "CrossCorrelationFrame":
        return np.asarray(frame.lags, dtype=np.float64), None  # type: ignore[attr-defined]
    if name == "SpectrogramFrame":
        return np.asarray(frame.times, dtype=np.float64), None  # type: ignore[attr-defined]
    if name == "CepstrogramFrame":
        return (
            np.asarray(frame.times, dtype=np.float64),  # type: ignore[attr-defined]
            np.asarray(frame.quefrencies, dtype=np.float64),  # type: ignore[attr-defined]
        )
    if name == "RoughnessFrame":
        return (
            np.asarray(frame.time, dtype=np.float64),  # type: ignore[attr-defined]
            np.asarray(frame.bark_axis, dtype=np.float64),  # type: ignore[attr-defined]
        )
    raise AssertionError(f"_source does not know the Frame kind {name}: add it here and to _KINDS")


def _tolerance(source: np.ndarray) -> float:
    """How far apart two x that are the same point may be written: a millionth of the source's smallest step."""
    steps = np.diff(source)
    return float(np.min(steps[steps > 0])) * 1e-6 if steps.size and np.any(steps > 0) else 1e-12


def _indices_in_source(drawn: np.ndarray, source: np.ndarray, what: str) -> np.ndarray:
    """The index in ``source`` of every drawn x, failing when one is not a source x."""
    nearest = np.clip(np.searchsorted(source, drawn), 1, max(1, source.size - 1))
    nearest = np.where(np.abs(source[nearest - 1] - drawn) <= np.abs(source[nearest] - drawn), nearest - 1, nearest)
    off = np.abs(source[nearest] - drawn)
    worst = int(np.argmax(off))
    assert off[worst] <= _tolerance(source), (
        f"{what}: drawn x {drawn[worst]!r} (point {worst}) is not the x of any source value; the nearest is "
        f"{source[nearest[worst]]!r}. A drawn point must be at its source value's own x: take it from "
        "stage_view.x_at(reading, index), never from a fraction or a count scaled to a span "
        "(docs/display-rules.md R2)."
    )
    return nearest


def _inside(source: np.ndarray, bounds: list[float] | None) -> np.ndarray:
    return source if bounds is None else source[(source >= min(bounds)) & (source <= max(bounds))]


def _check_line(xs: list[float], source: np.ndarray, what: str, log: bool = False) -> None:
    """A drawn line: every x a source x, in order; all of the source when no more than is drawn; else its ends in
    the source's first and last bucket (on a linear axis, whose buckets hold equal counts of values; a ``log``
    axis's buckets are equal widths of the log axis, so only the membership and the order are checked there)."""
    if not xs:
        return
    drawn = np.asarray(xs, dtype=np.float64)
    index = _indices_in_source(drawn, source, what)
    assert np.all(np.diff(index) > 0), f"{what}: the drawn points are not in the source's order, each once"
    if drawn.size == source.size or log:
        return  # every source value drawn is at its own x: the first and the last too
    # Thinned: at most two points a bucket, so a bucket holds no more than this many source values.
    bucket = int(np.ceil(2 * source.size / drawn.size)) + 1
    assert index[0] < bucket and index[-1] >= source.size - bucket, (
        f"{what}: the line starts at source value {index[0]} and ends at {index[-1]} of {source.size}; its first and "
        f"last point must be in the source's first and last bucket (about {bucket} values each)."
    )


def _check_columns(xs: list[float], source: np.ndarray, what: str) -> None:
    """An image's drawn columns: each inside the frames it holds (the one bucket rule, decimator.bucket_edges), so
    the first and last never reach past the source's; one frame a column is at that frame's own time."""
    drawn = np.asarray(xs, dtype=np.float64)
    edges = bucket_edges(source.size, drawn.size)
    assert edges.size == drawn.size + 1, f"{what}: {drawn.size} columns drawn of {source.size} frames"
    tolerance = _tolerance(source)
    for column, (start, end) in enumerate(zip(edges[:-1], edges[1:], strict=True)):
        assert source[start] - tolerance <= drawn[column] <= source[end - 1] + tolerance, (
            f"{what}: column {column} is drawn at {drawn[column]!r}, outside the frames it holds "
            f"({source[start]!r} to {source[end - 1]!r}). A column's x is the mean of its frames' own times "
            "(docs/display-rules.md R2)."
        )


def _check_source_axes(view: dict, source_xs: np.ndarray, source_ys: np.ndarray | None, what: str) -> None:
    """The picture says where its source data's axes start and end (``xSource``, an image's ``ySource``): the whole
    source's, whatever part is drawn and however it was thinned. The whole view's range and the axis identity come
    from these, never from the drawn points (docs/display-rules.md R2)."""
    for field, source in (("xSource", source_xs), ("ySource", source_ys if view["kind"] == "heatmap" else None)):
        if source is None:
            continue
        sent = view.get(field)
        assert sent is not None, (
            f"{what}: the picture has no {field}. Every picture sent must carry its source axes: call "
            "stage_view.with_source_axes(view, reading) where the picture is finished."
        )
        tolerance = _tolerance(source)
        assert (
            sent["count"] == source.size
            and abs(sent["first"] - source[0]) <= tolerance
            and abs(sent["last"] - source[-1]) <= tolerance
        ), (
            f"{what}: {field} is {sent}, but the source data has {source.size} values from {source[0]!r} to "
            f"{source[-1]!r}. It must be the whole source axis (stage_view.source_axis), not the drawn points' or "
            "the zoomed part's."
        )


def _check_picture(view: dict, frame: object, bounds: list[float] | None, what: str, own: bool = True) -> None:
    """``view`` (of ``frame``, over ``bounds``) against the Frame's source x. ``own``: the recording's own picture,
    whose waveform values are the Frame's samples (a median's or a difference's are not)."""
    source_xs, source_ys = _source(frame)
    _check_source_axes(view, source_xs, source_ys, what)
    if view.get("x") == "frequency" and view["kind"] == "line":
        # A spectrum is drawn from SPECTRUM_MIN_HZ to its Nyquist frequency.
        nyquist = frame.sampling_rate / 2  # type: ignore[attr-defined]
        source_xs = source_xs[(source_xs >= spec.SPECTRUM_MIN_HZ) & (source_xs <= nyquist)]
    source = _inside(source_xs, bounds)
    if view["kind"] == "heatmap":
        _check_columns(view["xs"], source, what)
        if source_ys is not None and view["ys"]:
            _indices_in_source(np.asarray(view["ys"], dtype=np.float64), source_ys, f"{what} rows")
        return
    _check_line(view["xs"], source, what, log=view.get("xScale") == "log")
    for event in view.get("events", []):
        _check_line(event["xs"], source, f"{what} event {event['id']}")
    waveform = view.get("waveform")
    if waveform:
        samples = np.asarray(frame.data, dtype=np.float64).reshape(frame.n_channels, -1).mean(axis=0)  # type: ignore[attr-defined]
        for times, values, name in (("minT", "min", "lowest"), ("maxT", "max", "highest")):
            index = _indices_in_source(np.asarray(waveform[times], dtype=np.float64), source_xs, f"{what} waveform")
            assert not own or np.array_equal(samples[index], np.asarray(waveform[values], dtype=np.float64)), (
                f"{what}: a waveform bucket's {name} sample is not the sample at the time it is drawn at "
                f"({times}). Each drawn sample must carry its own time (stage_view.samples_waveform)."
            )


def _zoom(frame: object) -> dict:
    """The middle half of the Frame's x axis (and every row), at a screen's worth of points."""
    xs, _ys = _source(frame)
    low, high = float(xs[xs.size // 4]), float(xs[3 * xs.size // 4])
    return {"x": [low, high], "points": 600}


@pytest.fixture(scope="module")
def long_recordings() -> tuple[wd.ChannelFrame, wd.ChannelFrame]:
    return _recording(LONG_S, seed=3), _recording(LONG_S, seed=4)


def test_every_drawn_frame_kind_is_covered() -> None:
    made = {type(make(_recording(0.5))).__name__ for make in _KINDS.values()}
    drawn = {kind.__name__ for kind in sv.STAGE_FRAME_TYPES}
    assert made == drawn, (
        f"_KINDS in this file makes {sorted(made)} but the comparison draws {sorted(drawn)} "
        "(stage_view.STAGE_FRAME_TYPES). Add the missing kind to _KINDS and _source, so its drawn x is checked."
    )


@pytest.mark.parametrize("kind", list(_KINDS))
def test_every_drawn_x_is_the_x_of_a_source_value_or_inside_its_bucket(
    kind: str, long_recordings: tuple[wd.ChannelFrame, wd.ChannelFrame]
) -> None:
    """Thinned by every routine: the whole picture, a zoomed part, a group's median and a difference."""
    frame, other = (_KINDS[kind](recording) for recording in long_recordings)
    whole = stage_view(frame)
    assert whole["kind"] != "none", f"{kind} is drawn"
    _check_picture(whole, frame, None, f"{kind}, whole picture")
    if whole["kind"] == "bar":
        return  # bars are whole bands: never thinned, zoomed or re-drawn
    zoom = _zoom(frame)
    _check_picture(stage_view(frame, None, zoom), frame, zoom["x"], f"{kind}, zoomed")
    data, second = stage_data(frame, whole), stage_data(other, stage_view(other))
    assert data is not None and second is not None
    for detail, bounds, where in ((None, None, "whole"), (zoom, zoom["x"], "zoomed")):
        median = combine([data, second], None, detail)  # type: ignore[arg-type]
        _check_picture(median["base"], frame, bounds, f"{kind}, a group's median, {where}", own=False)
        if kind != "trigger events":  # two recordings' events have no difference
            difference = combine([data], second, detail)  # type: ignore[arg-type]
            _check_picture(difference["diff"], frame, bounds, f"{kind}, a difference, {where}", own=False)


@pytest.mark.parametrize("kind", list(_KINDS))
def test_a_picture_that_thins_nothing_has_the_sources_own_xs_first_to_last_and_reads_back_the_same(kind: str) -> None:
    """A short recording: every source value is drawn, so the drawn xs are the source's, and reading at a drawn x
    gives a point at exactly that x."""
    seconds, make = _UNTHINNED.get(kind, (SHORT_S, _KINDS[kind]))
    frame = make(_recording(seconds))
    view = stage_view(frame)
    assert view["kind"] != "none", f"{kind} is drawn"
    source_xs, source_ys = _source(frame)
    _check_source_axes(view, source_xs, source_ys, kind)
    if kind in ("coherence", "cross spectrum", "transfer function", "spectrum"):
        # A spectrum is drawn from SPECTRUM_MIN_HZ to its Nyquist frequency.
        nyquist = frame.sampling_rate / 2  # type: ignore[attr-defined]
        source_xs = source_xs[(source_xs >= spec.SPECTRUM_MIN_HZ) & (source_xs <= nyquist)]
    drawn = np.asarray(view["xs"], dtype=np.float64)
    assert drawn.size == source_xs.size, (
        f"{kind}: {drawn.size} points drawn of {source_xs.size} source values; this recording is short enough that "
        "none is thinned. If a point limit changed, shorten SHORT_S or adjust _UNTHINNED in this file."
    )
    assert np.allclose(drawn, source_xs, rtol=0, atol=_tolerance(source_xs)), (
        f"{kind}: the drawn xs are not the source's own. The first is {drawn[0]!r} (source {source_xs[0]!r}) and the "
        f"last {drawn[-1]!r} (source {source_xs[-1]!r}). Take each x from stage_view.x_at(reading, index)."
    )
    data = stage_data(frame, view)
    assert data is not None
    for x in (drawn[0], drawn[drawn.size // 2], drawn[-1]):
        read: dict = {"x": [float(x), float(x)], "beyond": 0}
        if view["kind"] == "heatmap":
            read["y"] = [float(view["ys"][0])]
        points = read_points([data], None, read)  # type: ignore[arg-type]
        assert points is not None and float(x) in points["xs"], (
            f"{kind}: the point read at the drawn x {float(x)!r} is at {points and points['xs']}, not at that x. The "
            "picture and the read must take their x from one axis (stage_view.reading_axis)."
        )


def test_the_source_axis_tells_recordings_apart_that_thin_to_the_same_drawn_points_and_stays_the_same_zoomed() -> None:
    """Two cepstra of other lengths are both thinned to the same number of drawn points: only ``xSource`` tells
    their axes apart. Zoomed, a picture's drawn points change and its ``xSource`` does not."""
    short, long = (_recording(seconds).cepstrum() for seconds in (1.0, 2.0))
    drawn_short, drawn_long = stage_view(short), stage_view(long)
    assert len(drawn_short["xs"]) == len(drawn_long["xs"]), "both are thinned to the picture's point limit"
    assert drawn_short["xSource"]["count"] != drawn_long["xSource"]["count"]
    zoomed = stage_view(long, None, _zoom(long))
    assert zoomed["xs"] != drawn_long["xs"] and zoomed["xSource"] == drawn_long["xSource"]


#: The kinds whose x is time: recordings of other lengths are combined over the part they all have.
_TIMED = ("signal", "metric series", "level series", "spectrogram", "cepstrogram", "roughness")


@pytest.mark.parametrize("kind", _TIMED)
def test_a_median_and_a_difference_say_the_source_axis_of_the_common_part_they_were_taken_over(kind: str) -> None:
    """Over time, recordings of other lengths are combined over their common part (stage_combine._aligned): the
    picture of a median or a difference carries that part's source axis, the shorter recording's, whole or zoomed,
    never the drawn points' ends (docs/display-rules.md R2)."""
    long, short = (_KINDS[kind](_recording(seconds, seed=seed)) for seconds, seed in ((LONG_S, 5), (1.5, 6)))
    data, other = stage_data(long, stage_view(long)), stage_data(short, stage_view(short))
    assert data is not None and other is not None
    source_xs, source_ys = _source(short)
    for detail, where in ((None, "whole"), (_zoom(short), "zoomed")):
        median = combine([data, other], None, detail)  # type: ignore[arg-type]
        difference = combine([other], data, detail)  # type: ignore[arg-type]
        _check_source_axes(median["base"], source_xs, source_ys, f"{kind}, a median of two lengths, {where}")
        _check_source_axes(difference["diff"], source_xs, source_ys, f"{kind}, a difference of two lengths, {where}")


def test_four_samples_at_4_hz_are_drawn_at_0_to_0_75_s_not_squeezed_into_a_shorter_span() -> None:
    """The case that was wrong: the waveform's times were fractions i / N scaled by the span (N − 1) / fs, which
    put the last of four samples at 0.5625 s."""
    frame = wd.from_numpy(np.array([[0.0, 1.0, -1.0, 0.5]]), sampling_rate=4)
    view = stage_view(frame)
    expected = [0.0, 0.25, 0.5, 0.75]
    assert view["xs"] == expected
    assert view["xSource"] == {"count": 4, "first": 0.0, "last": 0.75, "step": 0.25}
    assert view["waveform"]["minT"] == expected and view["waveform"]["maxT"] == expected, (
        "each waveform point must be at its sample's own time, index / fs (stage_view.samples_waveform)"
    )
    data = stage_data(frame, view)
    assert data is not None
    assert read_points([data], None, {"x": [0.0, 1.0]})["xs"] == expected  # type: ignore[index]
    # The same through a combined picture (a group's median) and a zoom onto the last two samples.
    median = combine([data, data], None)["base"]
    assert median["waveform"]["maxT"] == expected
    zoomed = stage_view(frame, None, {"x": [0.5, 0.75], "points": 400})
    assert zoomed["xs"] == [0.5, 0.75] and zoomed["waveform"]["maxT"] == [0.5, 0.75]


@pytest.mark.parametrize(
    "name",
    ["_envelope", "_cepstrum_envelope", "min_max_line linear", "min_max_line log", "spectrum_line"],
)
def test_every_line_decimator_gives_source_points_each_value_with_its_own_x(name: str) -> None:
    """The routines that thin a line, called directly: every point they give is a point of the line they were given."""
    rng = np.random.default_rng(11)
    xs = np.arange(20_000) * 0.25 if name != "_cepstrum_envelope" else np.arange(20_000) * 1e-4
    xs = xs + (1.0 if name in ("min_max_line log", "spectrum_line") else 0.0)
    values = rng.standard_normal(xs.size)
    thinned = {
        "_envelope": lambda: sv._envelope(xs, values, 400),
        "_cepstrum_envelope": lambda: sv._cepstrum_envelope(xs, values, 400),
        "min_max_line linear": lambda: sv.min_max_line(xs, values, 200, False),
        "min_max_line log": lambda: sv.min_max_line(xs, values, 200, True),
        "spectrum_line": lambda: sv.spectrum_line(xs, values, [10.0, 4000.0], 200),
    }[name]()
    drawn_xs, drawn_values = thinned
    assert 0 < drawn_xs.size < xs.size, f"{name} thins the line"
    index = _indices_in_source(drawn_xs, xs, name)
    assert np.array_equal(values[index], drawn_values), f"{name}: a drawn value is not the source value at its x"


def test_the_lanes_waveform_places_are_sample_over_samples_so_times_the_duration_they_are_the_samples_times() -> None:
    """decimated_waveform's minT / maxT are fractions of the file's duration N / fs. Times the duration they are
    index / fs exactly; times the span to the last sample, (N − 1) / fs, they would not be."""
    samples = np.array([0.0, 1.0, -1.0, 0.5])
    envelope = decimated_waveform(samples, 4, 0, samples.size)
    duration = samples.size / 4.0
    assert [place * duration for place in envelope["maxT"]] == [0.0, 0.25, 0.5, 0.75]
