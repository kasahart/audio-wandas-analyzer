"""The answers of the Tracks screen's figures, kept by key for the figure service.

- The cursor spectrum: each channel's spectrum (every bin) or 1/N-octave band levels (every band) at the cursor.
- The pair figure: from the reference channel to each other channel, the gain (dB), the phase (degrees) and the
  coherence, every bin.
- A row's lanes: each channel's samples (the waveform lane) and its STFT's levels, every cell (the spectrogram lane).

Nothing is computed here. ``analysis_service`` asks wandas (``AnalysisService.slice_rows``, ``pair_rows``), and this
file names each line by a key and keeps it in the process's one holder (services/answer_store.py), where the figure
service finds it (transport/figure_answers.py). A key is a hash of everything the line is of (the file as read, the
calibration, the channel, the window's samples and name, the bands; for a pair, both channels, their offsets, the range
and the STFT), so the answer under a key never changes: its version is the key itself.

Three rules of every kept answer hold here:

- A level is never under MIN_LEVEL_DB (stage_view.floored_db: silence is at the floor, as in every kept answer).
- A phase is in degrees (設計書 第 9 節: layer 1 converts; the webview multiplies nothing).
- Nothing is cut to be drawn: the figure service thins a line for the width it draws (figures/thinning.py).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, NotRequired, TypedDict

import numpy as np

from frames import analysis_spec as spec
from frames.level_identity import LevelIdentity, level_identity
from frames.stage_view import floored_db
from services.answer_store import EXTENTS, STORE

XScale = Literal["log", "linear"]


@dataclass(frozen=True)
class LineData:
    """One line layer 1 keeps as it is drawn from: a value at every point of its axis (a bin's frequency, a band's
    centre), and what the values are. Unlike a scan's step (stage_combine.StageData) it is of one channel and has no
    description beside it."""

    xs: np.ndarray
    values: np.ndarray
    #: The unit, reference value and reference label its levels are in (level_identity.py).
    identity: LevelIdentity
    #: "level" or "gain" (dB), "phase" (degrees), "coherence".
    quantity: str
    #: The unit the values are written in, where the quantity alone does not say it ("deg").
    unit: str | None
    #: "frequency" (a value a bin) or "band" (a value a 1/N-octave band, at its centre).
    x_kind: str
    x_scale: XScale
    #: The axis's ends across where the figure specifies none.
    x_limits: tuple[float, float]

    @property
    def nbytes(self) -> int:
        return int(self.xs.nbytes + self.values.nbytes)


@dataclass(frozen=True)
class SignalData:
    """One channel's samples layer 1 keeps for a Tracks row's waveform lane: every sample, in the channel's unit
    (calibrated where the profile says so). Sample ``n`` is ``n / rate`` seconds into the file."""

    rate: float
    values: np.ndarray
    identity: LevelIdentity
    #: The unit the samples are in ("" where it has none, "Pa" once calibrated).
    unit: str

    @property
    def nbytes(self) -> int:
        return int(self.values.nbytes)


@dataclass(frozen=True)
class ImageData:
    """One channel's STFT levels layer 1 keeps for a Tracks row's spectrogram lane: every cell (rows of frequency ×
    columns of frames), never averaged to be drawn."""

    #: Each frame's centre, s into the file.
    xs: np.ndarray
    #: Each row's frequency, Hz.
    ys: np.ndarray
    values: np.ndarray
    identity: LevelIdentity
    y_scale: XScale
    #: The axes' ends where the figure specifies none: across, the recording; up, the frequencies drawn.
    x_limits: tuple[float, float]
    y_limits: tuple[float, float]
    #: The lowest and highest level of the whole recording's STFT (above the silent floor), which the lane's colour
    #: range is decided from: a time window's own STFT is coloured as the whole file's is, so a zoom keeps the
    #: colours. None for a recording that is silent throughout.
    extent: tuple[float, float] | None = None

    @property
    def nbytes(self) -> int:
        return int(self.xs.nbytes + self.ys.nbytes + self.values.nbytes)


def level_extent(levels_db: np.ndarray) -> tuple[float, float] | None:
    """The lowest and highest of ``levels_db`` above the silent floor (analysis_spec.SILENT_DB); None with none."""
    levels = np.asarray(levels_db)
    keep = (levels > spec.SILENT_DB) & (levels < np.inf)
    if not bool(keep.any()):
        return None
    return float(levels.min(where=keep, initial=np.inf)), float(levels.max(where=keep, initial=-np.inf))


def answer_key(*parts: object) -> str:
    """The key of an answer made of ``parts`` (everything it depends on)."""
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()


def _keep(key: str, line: LineData | SignalData | ImageData) -> bool:
    """Keeps ``line`` under ``key``; whether the store holds it (a line over its budget is refused)."""
    STORE.put(key, line)
    return STORE.has(key)


def _limits(scale: XScale, nyquist: float) -> tuple[float, float]:
    """A frequency axis's ends where nothing is specified: 20 Hz (log; a linear axis: 0) to the Nyquist frequency."""
    return (spec.SPECTRUM_MIN_HZ if scale == "log" else 0.0, float(nyquist))


# --- The cursor spectrum ---------------------------------------------------------------------------------------------


class LevelWords(TypedDict):
    unit: str
    ref: float
    label: str


class CursorChannelAnswer(TypedDict):
    channelIndex: int
    #: What the channel's levels are in (its unit, reference value and reference label): the figure spec puts the
    #: lines of one identity on one lane (仕様 2). A name, never a value of the line.
    level: LevelWords
    #: The kept line's key; absent when the store refused it.
    key: NotRequired[str]


class CursorAnswersResult(TypedDict):
    filePath: str
    channels: list[CursorChannelAnswer]
    #: The window the answer is of, as parts of the file.
    windowStartNorm: float
    windowEndNorm: float
    window: str
    bandsPerOctave: NotRequired[int]
    calibrationSignature: str
    analysisRevision: int
    sourceVersion: str
    stftSignature: str


@dataclass(frozen=True)
class SliceRows:
    """What wandas answered for one file at the cursor (AnalysisService.slice_rows): a row a channel."""

    input_id: str
    signature: str
    #: A row a channel: every bin's level (dB), or every band's.
    rows: np.ndarray
    #: A row's axis: every bin's frequency, or every band's nominal centre.
    xs: np.ndarray
    identities: tuple[LevelIdentity, ...]
    sampling_rate: float
    start_sample: int
    window_size: int
    window: str
    #: None for a spectrum; else (bands per octave, the lower edge of the lowest nominal band, the upper edge of
    #: the highest): every file's bands are on one axis whatever its sample rate.
    bands: tuple[int, float, float] | None


def keep_cursor_lines(found: SliceRows, scale: XScale) -> list[CursorChannelAnswer]:
    """Keeps each channel's line of ``found`` and answers their keys, in channel order. ``scale``: how the frequency
    axis is drawn (the display setting); 1/N-octave bands are always on a log axis."""
    banded = found.bands is not None
    x_scale: XScale = "log" if banded else scale
    limits = (found.bands[1], found.bands[2]) if found.bands is not None else _limits(x_scale, found.sampling_rate / 2)
    channels: list[CursorChannelAnswer] = []
    for index, row in enumerate(found.rows):
        key = answer_key(
            "cursor",
            found.input_id,
            found.signature,
            index,
            found.start_sample,
            found.window_size,
            found.window,
            found.bands[0] if found.bands is not None else None,
            x_scale,
        )
        line = LineData(
            xs=found.xs,
            values=floored_db(row),
            identity=found.identities[index],
            quantity="level",
            unit=None,
            x_kind="band" if banded else "frequency",
            x_scale=x_scale,
            x_limits=limits,
        )
        unit, ref, label = found.identities[index]
        kept: CursorChannelAnswer = {"channelIndex": index, "level": {"unit": unit, "ref": ref, "label": label}}
        if _keep(key, line):
            kept["key"] = key
        channels.append(kept)
    return channels


# --- The pair figure -------------------------------------------------------------------------------------------------


class PairLineKeys(TypedDict):
    gain: str
    phase: str
    coherence: str


class PairResponseAnswer(TypedDict):
    filePath: str
    channelIndex: int
    #: "ok", "no-overlap" or "too-short" : only an "ok" pair has lines.
    status: str
    startSeconds: float
    endSeconds: float
    averages: int
    resampled: bool
    #: The three kept lines' keys; absent when the pair has no lines, or the store refused one.
    keys: NotRequired[PairLineKeys]
    calibrationStatus: str
    calibrationSignature: str
    analysisRevision: int
    sourceVersion: str


class PairAnswersResult(TypedDict):
    filePath: str
    channelIndex: int
    nFft: int
    hopLength: int
    window: str
    calibrationSignature: str
    analysisRevision: int
    sourceVersion: str
    stftSignature: str
    responses: list[PairResponseAnswer]


def keep_pair_lines(
    identity: Mapping[str, object],
    rows: np.ndarray,
    gain_identity: LevelIdentity,
    sampling_rate: float,
    n_fft: int,
    scale: XScale,
) -> PairLineKeys | None:
    """Keeps one pair's three lines (``rows``: gain in dB, phase in radians, coherence, every bin) and answers their
    keys; None when the store refused one. ``identity``: everything the pair is of.

    A bin with no value (a gain where the reference channel is silent) stays without one (NaN): it is not a level
    at the floor.

    A gain between two units is a transfer level in dB re their ratio: its line says that unit, and the axis names it
    (a gain of one unit says none)."""
    xs = np.fft.rfftfreq(n_fft, 1.0 / sampling_rate)
    limits = _limits(scale, sampling_rate / 2)
    plain = level_identity("", 1.0, "")
    lines: dict[str, tuple[np.ndarray, str, str | None, LevelIdentity]] = {
        "gain": (rows[0], "gain", gain_identity[0] if gain_identity[0] not in ("", "1") else None, gain_identity),
        "phase": (np.degrees(rows[1]), "phase", "deg", plain),
        "coherence": (rows[2], "coherence", None, plain),
    }
    keys: dict[str, str] = {}
    for part, (values, quantity, unit, level) in lines.items():
        key = answer_key("pair", identity, part, scale)
        line = LineData(
            xs=xs,
            values=np.where(np.isfinite(values), values, np.nan),
            identity=level,
            quantity=quantity,
            unit=unit,
            x_kind="frequency",
            x_scale=scale,
            x_limits=limits,
        )
        if not _keep(key, line):
            return None
        keys[part] = key
    return {"gain": keys["gain"], "phase": keys["phase"], "coherence": keys["coherence"]}


# --- A row's lanes ------------------------------------------------------------------------------------------


class TrackChannelAnswer(TypedDict):
    """One channel's kept answers of a Tracks row. A key is absent where the store could not keep the answer (it is
    over the budget: the lane says the recording is too large), or the channel has none (no STFT)."""

    channelIndex: int
    level: LevelWords
    #: The unit the samples are in.
    unit: str
    signal: NotRequired[str]
    image: NotRequired[str]
    #: The keys of the channel's extents (``keep_track_signal_extent``, ``keep_track_image_extent``): what another
    #: row's lane names to share its scale with this channel (the spec's ``scaleWith``). Absent where there is none
    #: (no sample; no STFT asked for).
    signalExtent: NotRequired[str]
    imageExtent: NotRequired[str]


class TrackAnswersResult(TypedDict):
    filePath: str
    channels: list[TrackChannelAnswer]
    sampleRateHz: float
    durationSeconds: float
    #: The STFT the images are of, and whether they are of the time window asked for alone (automatic settings, R3).
    windowSize: int
    hopSize: int
    windowed: bool
    calibrationSignature: str
    analysisRevision: int
    sourceVersion: str
    stftSignature: str
    #: Why no channel names levels though they were asked for: "too-short" (the recording is shorter than half the
    #: STFT's window). A channel without a key and without this word was refused by the store (too large to keep).
    noLevels: NotRequired[str]


def track_signal_key(input_id: str, signature: str, channel: int) -> str:
    """The key of a channel's samples: the file as read, the calibration, the channel."""
    return answer_key("track-signal", input_id, signature, channel)


def track_image_key(input_id: str, signature: str, channel: int, stft: object, scale: XScale) -> str:
    """The key of a channel's STFT levels: the file as read, the calibration, the channel, the STFT (its window size,
    hop and window; for a time window's own STFT, the samples it was made of) and how its frequency axis is drawn."""
    return answer_key("track-image", input_id, signature, channel, stft, scale)


def kept(key: str) -> bool:
    """Whether the store holds ``key`` already: an answer under a key never changes, so it is not made again."""
    return STORE.has(key)


# --- A recording's extents: what the rows' linked scales count (Link scales) ---------------------------------------
#
# A row's lane shares its automatic scale with the other rows by naming their answers (the spec's ``scaleWith``), and
# the figure service takes the range of them all (figures/service.py). Naming every recording's samples and levels
# would need them all kept at once, which forty long recordings are not. So each channel's extent is kept too, as the
# smallest answer of the same kind with the same extent, under a key of its own and in a store of its own
# (answer_store.EXTENTS): the figure service reads it as it reads any signal or image, and decides the same scale.


def track_signal_extent_key(input_id: str, signature: str, channel: int) -> str:
    """The key of the extent of a channel's samples: the file as read, the calibration, the channel."""
    return answer_key("track-signal-extent", input_id, signature, channel)


def track_image_extent_key(input_id: str, signature: str, channel: int, stft: object) -> str:
    """The key of the extent of a channel's whole-file STFT levels: as its levels' key, without how the axis is
    drawn (the levels are the same on either axis)."""
    return answer_key("track-image-extent", input_id, signature, channel, stft)


def extent_kept(key: str) -> bool:
    return EXTENTS.has(key)


def keep_track_signal_extent(key: str, samples: np.ndarray, identity: LevelIdentity, unit: str) -> bool:
    """Keeps the extent of a channel's ``samples`` as a signal of two samples: its lowest and its highest (so the
    range up of it is the range up of the channel). False with no finite sample."""
    values = np.asarray(samples)
    if not values.size:
        return False
    low, high = float(np.fmin.reduce(values, axis=None)), float(np.fmax.reduce(values, axis=None))
    if not (np.isfinite(low) and np.isfinite(high)):
        return False
    EXTENTS.put(key, SignalData(rate=1.0, values=np.array([low, high], dtype=np.float64), identity=identity, unit=unit))
    return EXTENTS.has(key)


def keep_track_image_extent(key: str, extent: tuple[float, float] | None, identity: LevelIdentity) -> bool:
    """Keeps the extent of a channel's whole-file STFT levels (``level_extent``; None: silent throughout) as an
    image of four cells that carries it (``ImageData.extent``); a silent recording's cells are at the floor, and
    count for no colour range."""
    cells = np.array([[extent[0], extent[1]], [extent[0], extent[1]]]) if extent else np.full((2, 2), spec.SILENT_DB)
    EXTENTS.put(
        key,
        ImageData(
            xs=np.array([0.0, 1.0]),
            ys=np.array([0.0, 1.0]),
            values=floored_db(cells),
            identity=identity,
            y_scale="linear",
            x_limits=(0.0, 1.0),
            y_limits=(0.0, 1.0),
            extent=extent,
        ),
    )
    return EXTENTS.has(key)


def keep_track_signal(key: str, rate: float, values: np.ndarray, identity: LevelIdentity, unit: str) -> bool:
    return _keep(key, SignalData(rate=rate, values=values, identity=identity, unit=unit))


def keep_track_image(
    key: str,
    centres: np.ndarray,
    freqs: np.ndarray,
    levels_db: np.ndarray,
    identity: LevelIdentity,
    scale: XScale,
    duration: float,
    extent: tuple[float, float] | None,
) -> bool:
    """Keeps a channel's STFT levels (``levels_db``: rows of frequency × columns of frames). Across, the lane is the
    recording's own length (the first and last cells reach half a frame past it); up, as a spectrum's axis is.
    ``extent``: the whole recording's lowest and highest level (``ImageData.extent``)."""
    nyquist = float(freqs[-1]) if freqs.size else 0.0
    return _keep(
        key,
        ImageData(
            xs=np.asarray(centres, dtype=np.float64),
            ys=np.asarray(freqs, dtype=np.float64),
            values=floored_db(levels_db),
            identity=identity,
            y_scale=scale,
            x_limits=(0.0, float(duration)),
            y_limits=_limits(scale, nyquist),
            extent=extent,
        ),
    )
