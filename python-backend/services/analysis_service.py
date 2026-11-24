from __future__ import annotations

import base64
import io
import math
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple, TypedDict, cast

import numpy as np
import soundfile as sf
import wandas as wd

from services.analysis_engine import AnalysisEngine, CachedAnalysis
from services.analyzer import (
    SPECTROGRAM_TIME_BIN_LIMIT,
    AnalysisResult,
    StftOptions,
    absolute_peak,
    analyze_from_frame,
    channels_first,
    normalize_stft_options,
    resolve_stft_params,
    sample_range,
    stft_signature,
    zoom_window_spectrogram,
)
from services.backend_errors import AnalysisSettingsError, InputError

if TYPE_CHECKING:
    from frames.level_identity import LevelIdentity
    from services.tracks_answers import (
        CursorAnswersResult,
        PairAnswersResult,
        PairResponseAnswer,
        TrackAnswersResult,
        TrackChannelAnswer,
        XScale,
    )


# Bounds the Web Worker's memory; longer averaging ranges use their first ten minutes.
MAX_PAIR_SECONDS = 600.0


class _PairSource(NamedTuple):
    file_path: str
    cached: CachedAnalysis
    frame: wd.ChannelFrame
    signature: str
    channel: int
    offset: float
    revision: int
    # The channel's own calibration (a pair is calibrated only when both of its channels are, R4).
    status: str = "uncalibrated"


class _PairSpectrum(NamedTuple):
    status: str
    start: float
    end: float
    averages: int
    resampled: bool
    rows: np.ndarray
    #: What the gain's dB are in (the pair's unit ratio, its reference and label), as a kept transfer function's
    #: (stage_combine._calibration).
    identity: LevelIdentity = ("", 1.0, "")


class _Slice(NamedTuple):
    """One file's answer at the cursor, as wandas gave it (AnalysisService.slice_rows)."""

    cached: CachedAnalysis
    frame: wd.ChannelFrame
    #: The calibration's signature.
    signature: str
    revision: int
    stft: str
    #: A row a channel: every bin's level in dB (float64), or every band's.
    rows: np.ndarray
    max_frequency_hz: float
    start_sample: int
    end_sample: int
    window_size: int
    window: str
    bands: OctaveBands | None


class _Pair(NamedTuple):
    """One response channel's answer against the reference (AnalysisService.pair_rows)."""

    source: _PairSource
    spectrum: _PairSpectrum
    #: Everything the answer is of (the key it is cached under, with both files as read).
    identity: tuple[object, ...]


class RegionPeakResult(TypedDict):
    #: The largest |sample| of the channels asked over their stretches, of every sample (0 with no sample at all).
    peak: float


class WavLoopExportResult(TypedDict):
    wavBase64: str
    sampleRate: int


class RecipeBuildResult(TypedDict):
    name: str
    recipe: dict[str, object]


# IEC 61260-1 nominal mid-band frequencies, which wandas (MoSQITo) uses to label its bands.
_NOMINAL_BAND_CENTERS_HZ: dict[int, tuple[float, ...]] = {
    1: (31.5, 63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0),
    3: (
        20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0, 200.0,
        250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0, 2000.0,
        2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 16000.0, 20000.0,
    ),
}  # fmt: skip


# SciPy's zero-phase decimator inside MoSQITo rejects inputs of 27 samples or fewer, so shorter
# clips are zero padded (like fft() pads to n_fft); their band levels are mostly filter transient.
_MIN_BAND_SLICE_SAMPLES = 64


class OctaveBands(NamedTuple):
    bands_per_octave: int
    centers_hz: tuple[float, ...]
    # Edges of the whole nominal range, so every file shares one axis whatever its sample rate.
    min_frequency_hz: float
    max_frequency_hz: float
    # The band filters restart on every slice, so the slice must be long enough for the lowest
    # band's start-up transient to stay small next to its steady level.
    min_duration_s: float


def octave_bands(bands_per_octave: int, sampling_rate: float) -> OctaveBands:
    """The nominal bands whose MoSQITo filters can be designed at this sample rate."""
    nominal = _NOMINAL_BAND_CENTERS_HZ.get(bands_per_octave)
    if nominal is None:
        raise InputError("bandsPerOctave must be 1 or 3")
    ratio = 10 ** (3 / (10 * bands_per_octave))
    half_band = math.sqrt(ratio)

    def exact(center: float) -> float:
        return 1000.0 * ratio ** round(math.log(center / 1000.0, ratio))

    nyquist = sampling_rate / 2
    # MoSQITo rejects centres above 0.88 * Nyquist, and scipy's band-pass design needs the upper edge below Nyquist.
    usable = tuple(c for c in nominal if exact(c) * half_band < nyquist and exact(c) <= 0.88 * nyquist)
    if not usable:
        raise InputError(f"No {bands_per_octave}-band octave filter fits below {nyquist:g} Hz")
    lowest_bandwidth_hz = exact(usable[0]) * (half_band - 1 / half_band)
    return OctaveBands(
        bands_per_octave,
        usable,
        exact(nominal[0]) / half_band,
        exact(nominal[-1]) * half_band,
        # Ten reciprocal bandwidths keep a steady tone in the lowest band within about 0.5 dB.
        10.0 / lowest_bandwidth_hz,
    )


def _analysis_revision(value: object) -> int:
    if isinstance(value, bool) or not (isinstance(value, int) or (isinstance(value, float) and value.is_integer())):
        raise InputError("analysisRevision must be an integer")
    return int(value)


def _snapped_window_center(cursor_sample: float, hop_size: int) -> int:
    """Centre of the cursor spectrum's window: the nearest STFT frame centre (a multiple of the hop), so the
    band and the spectrum match one spectrogram frame for the current n_fft and hop. Frames whose window
    passes a file end are kept so every sample stays reachable; the caller then pushes the window inside."""
    return round(cursor_sample / hop_size) * hop_size


def _kept_column(kept: wd.SpectrogramFrame | None, start_sample: int, end_sample: int, n_samples: int) -> int | None:
    """The frame of ``kept`` whose window is exactly samples ``start_sample``..``end_sample`` of the file, or None.

    The window is one of the STFT's frames when a frame is centred on it and it lies wholly inside the file (a frame
    that passes a file end is zero-padded by the STFT; the cursor's window is pushed inside instead)."""
    if kept is None or end_sample - start_sample != kept.n_fft or start_sample < 0 or end_sample > n_samples:
        return None
    origin = kept.frame_time_origin
    if origin is None:
        return None
    # Samples from the first frame's centre (wandas' frame_time_origin, before the file start) to the window's centre.
    offset = start_sample + kept.n_fft // 2 - origin * kept.sampling_rate
    index = round(offset / kept.hop_length)
    if not math.isclose(index * kept.hop_length, offset, abs_tol=1e-6) or not 0 <= index < kept.n_frames:
        return None
    return index


class AnalysisService:
    def __init__(self, engine: AnalysisEngine) -> None:
        self.engine = engine

    def analyze(
        self,
        file_path: str | Path,
        *,
        stft_options: Mapping[str, object] | None = None,
        calibration_profile: object = None,
        analysis_revision: object = 0,
    ) -> AnalysisResult:
        cached, analysis_frame, resolved = self.engine.get_analysis(file_path, calibration_profile)
        result = analyze_from_frame(
            analysis_frame,
            file_path,
            raw_frame=cached.frame,
            calibration_profile=resolved,
            raw_peaks=cached.source_peaks,
        )
        result["analysisRevision"] = _analysis_revision(analysis_revision)
        result["sourceVersion"] = cached.version
        result["stftSignature"] = stft_signature(analysis_frame.n_samples, stft_options)
        return result

    def slice_rows(
        self,
        file_path: str | Path,
        *,
        cursor_norm: float,
        stft_options: Mapping[str, object] | None = None,
        calibration_profile: object = None,
        analysis_revision: object = 0,
        source_version: object = None,
        bands_per_octave: int | None = None,
    ) -> _Slice:
        """Every channel's spectrum (or 1/N-octave band levels) of the window at the cursor: the one place the
        window is placed and wandas is asked (cursor_answers keeps the lines)."""
        cached, analysis_frame, resolved = self.engine.get_analysis(file_path, calibration_profile, source_version)
        window_size, hop_size, window_name = resolve_stft_params(analysis_frame.n_samples, stft_options)
        stft = f"{window_size}/{hop_size}/{window_name}"
        clipped_norm = max(0.0, min(1.0, cursor_norm))
        revision = _analysis_revision(analysis_revision)
        bands = octave_bands(bands_per_octave, analysis_frame.sampling_rate) if bands_per_octave is not None else None
        if bands is not None:
            window_size = max(window_size, math.ceil(bands.min_duration_s * analysis_frame.sampling_rate))

        center_sample = _snapped_window_center(clipped_norm * analysis_frame.n_samples, hop_size)
        start_sample = max(0, center_sample - window_size // 2)
        end_sample = min(analysis_frame.n_samples, start_sample + window_size)
        start_sample = max(0, end_sample - window_size)
        slice_key = (resolved.signature, window_size, window_name, revision, start_sample, bands_per_octave)
        cached_slice = self.engine.get_spectrum_slice(cached, slice_key)
        if cached_slice is not None:
            rows, max_frequency_hz = cached_slice
        elif bands is not None:
            segment = analysis_frame[:, start_sample:end_sample]
            if end_sample - start_sample < _MIN_BAND_SLICE_SAMPLES:
                segment = segment.fix_length(length=_MIN_BAND_SLICE_SAMPLES)
            # wandas annotates the transform mixin's self as TransformFrameProtocol, which ChannelFrame fails.
            octave = segment.noct_spectrum(  # pyright: ignore[reportAttributeAccessIssue]
                fmin=bands.centers_hz[0], fmax=bands.centers_hz[-1], n=bands.bands_per_octave
            )
            rows = np.asarray(octave.dB, dtype=np.float64).reshape(analysis_frame.n_channels, -1)
            max_frequency_hz = bands.max_frequency_hz
            self.engine.put_spectrum_slice(cached, slice_key, rows, max_frequency_hz)
        else:
            kept = self.engine.kept_spectrogram(cached, (resolved.signature, window_size, hop_size, window_name))
            column = _kept_column(kept, start_sample, end_sample, analysis_frame.n_samples)
            if kept is not None and column is not None:
                # The window is one frame of the STFT the file already keeps (its spectrogram row): wandas reads that
                # column alone (wandas 0.14 copies only the part of a cached array that is read), not a new FFT.
                spectrum = kept[:, :, column : column + 1]
            else:
                # Of float64 samples, as the STFT is (compute_spectrogram), so both ways give the same numbers.
                spectrum = (
                    analysis_frame[:, start_sample:end_sample]
                    .astype(np.float64)
                    .fft(n_fft=window_size, window=window_name)  # pyright: ignore[reportAttributeAccessIssue]
                )
            max_frequency_hz = float(spectrum.freqs[-1])
            # float64, as wandas gives it: its level range, the overlay's order and the readout take it as it is.
            rows = np.asarray(spectrum.dB, dtype=np.float64).reshape(analysis_frame.n_channels, -1)
            self.engine.put_spectrum_slice(cached, slice_key, rows, max_frequency_hz)
        return _Slice(
            cached,
            analysis_frame,
            resolved.signature,
            revision,
            stft,
            rows,
            max_frequency_hz,
            start_sample,
            end_sample,
            window_size,
            window_name,
            bands,
        )

    def cursor_answers(
        self,
        file_path: str | Path,
        *,
        cursor_norm: float,
        scale: XScale = "log",
        stft_options: Mapping[str, object] | None = None,
        calibration_profile: object = None,
        analysis_revision: object = 0,
        source_version: object = None,
        bands_per_octave: int | None = None,
    ) -> CursorAnswersResult:
        """Keeps every channel's line at the cursor for the figure service and answers their keys
        (tracks_answers.py). ``scale``: how the frequency axis is drawn."""
        from services.stage_combine import _channel_identity
        from services.tracks_answers import SliceRows, keep_cursor_lines

        found = self.slice_rows(
            file_path,
            cursor_norm=cursor_norm,
            stft_options=stft_options,
            calibration_profile=calibration_profile,
            analysis_revision=analysis_revision,
            source_version=source_version,
            bands_per_octave=bands_per_octave,
        )
        frame, bands = found.frame, found.bands
        rate = float(frame.sampling_rate)
        channels = keep_cursor_lines(
            SliceRows(
                input_id=found.cached.input_id,
                signature=found.signature,
                rows=found.rows,
                # A spectrum's bins are at k × rate / n_fft (wandas' ``freqs``); a band is at its nominal centre.
                xs=(
                    np.asarray(bands.centers_hz, dtype=np.float64)
                    if bands is not None
                    else np.fft.rfftfreq(found.window_size, 1.0 / rate)
                ),
                identities=tuple(_channel_identity(channel) for channel in frame.channels),
                sampling_rate=rate,
                start_sample=found.start_sample,
                window_size=found.window_size,
                window=found.window,
                bands=(
                    (bands.bands_per_octave, bands.min_frequency_hz, bands.max_frequency_hz)
                    if bands is not None
                    else None
                ),
            ),
            scale,
        )
        result: CursorAnswersResult = {
            "filePath": str(file_path),
            "channels": channels,
            "windowStartNorm": found.start_sample / frame.n_samples,
            # fft() zero-pads short files to window_size before windowing, so the span may pass the file end.
            "windowEndNorm": (found.start_sample + found.window_size) / frame.n_samples,
            "window": found.window,
            "calibrationSignature": found.signature,
            "analysisRevision": found.revision,
            "sourceVersion": found.cached.version,
            "stftSignature": found.stft,
        }
        if bands is not None:
            # The band filters see the samples as they are: no window and no zero padding.
            result.update(
                bandsPerOctave=bands.bands_per_octave,
                windowEndNorm=found.end_sample / frame.n_samples,
                window="boxcar",
            )
        return result

    def pair_rows(
        self,
        reference: Mapping[str, object],
        responses: list[Mapping[str, object]],
        *,
        start_seconds: float | None = None,
        end_seconds: float | None = None,
        stft_options: Mapping[str, object] | None = None,
    ) -> tuple[_PairSource, tuple[int, int, str], list[_Pair]]:
        """From the reference channel to each response channel, the gain, phase and coherence of every bin: the one
        place wandas is asked (pair_answers keeps the lines). Answers
        the reference, the STFT (n_fft, hop, window) and a pair a response."""
        x = self._pair_source(reference)
        sources = [self._pair_source(response) for response in responses]
        n_fft, hop_length, window = pair_stft_params(x.frame.n_samples, stft_options)
        # Every bin, at its own frequency: a narrow resonance, notch or coherence dip stays; the plot joins every
        # bin it is given, so a zoom shows every bin in its range (R1-R3).
        bins = np.arange(n_fft // 2 + 1)
        pairs: list[_Pair] = []
        for y in sources:
            key = (
                "pair",
                x.signature,
                x.channel,
                x.offset,
                y.cached.path,
                y.cached.identity,
                y.signature,
                y.channel,
                y.offset,
                start_seconds,
                end_seconds,
                n_fft,
                hop_length,
                window,
            )
            pair = self.engine.get_pair_spectrum(x.cached, key)
            if not isinstance(pair, _PairSpectrum):
                pair = _compute_pair(x, y, start_seconds, end_seconds, n_fft, hop_length, window, bins)
                self.engine.put_pair_spectrum(x.cached, key, pair)
            pairs.append(_Pair(y, pair, (x.cached.input_id, x.revision, y.cached.input_id, y.revision, *key)))
        return x, (n_fft, hop_length, window), pairs

    def pair_answers(
        self,
        reference: Mapping[str, object],
        responses: list[Mapping[str, object]],
        *,
        scale: XScale = "log",
        start_seconds: float | None = None,
        end_seconds: float | None = None,
        stft_options: Mapping[str, object] | None = None,
    ) -> PairAnswersResult:
        """Keeps each pair's gain, phase (degrees) and coherence lines for the figure service and answers their
        keys (tracks_answers.py). ``scale``: how the frequency axis is drawn."""
        from services.tracks_answers import keep_pair_lines

        x, (n_fft, hop_length, window), pairs = self.pair_rows(
            reference, responses, start_seconds=start_seconds, end_seconds=end_seconds, stft_options=stft_options
        )
        replies: list[PairResponseAnswer] = []
        for y, pair, identity in pairs:
            keys = (
                keep_pair_lines({"of": identity}, pair.rows, pair.identity, float(x.frame.sampling_rate), n_fft, scale)
                if pair.status == "ok"
                else None
            )
            reply: PairResponseAnswer = {
                "filePath": y.file_path,
                "channelIndex": y.channel,
                "status": pair.status,
                "startSeconds": pair.start,
                "endSeconds": pair.end,
                "averages": pair.averages,
                "resampled": pair.resampled,
                "calibrationStatus": _pair_status(x, y),
                "calibrationSignature": y.signature,
                "analysisRevision": y.revision,
                "sourceVersion": y.cached.version,
            }
            if keys is not None:
                reply["keys"] = keys
            replies.append(reply)
        return {
            "filePath": x.file_path,
            "channelIndex": x.channel,
            "nFft": n_fft,
            "hopLength": hop_length,
            "window": window,
            "calibrationSignature": x.signature,
            "analysisRevision": x.revision,
            "sourceVersion": x.cached.version,
            "stftSignature": stft_signature(x.frame.n_samples, stft_options),
            "responses": replies,
        }

    def _pair_source(self, source: Mapping[str, object]) -> _PairSource:
        file_path = str(source["filePath"])
        cached, frame, resolved = self.engine.get_analysis(
            file_path, source.get("calibrationProfile"), source.get("sourceVersion")
        )
        channel = int(source["channelIndex"])  # type: ignore[call-overload]
        if not 0 <= channel < frame.n_channels:
            raise InputError(f"channelIndex {channel} is out of range for {cached.path.name}")
        return _PairSource(
            file_path,
            cached,
            frame,
            resolved.signature,
            channel,
            float(source["offsetSeconds"]),  # type: ignore[arg-type]
            _analysis_revision(source.get("analysisRevision", 0)),
            resolved.channels[channel].status if channel < len(resolved.channels) else "uncalibrated",
        )

    def track_answers(
        self,
        file_path: str | Path,
        *,
        scale: XScale = "linear",
        stft_options: Mapping[str, object] | None = None,
        calibration_profile: object = None,
        analysis_revision: object = 0,
        source_version: object = None,
        time_window: tuple[float, float] | None = None,
        spectrogram: bool = True,
        extents: bool = False,
    ) -> TrackAnswersResult:
        """Keeps every channel's samples and STFT levels for the figure service and answers their keys
        (tracks_answers.py): what a Tracks row's waveform lane and spectrogram lane are drawn and read from.

        ``scale``: how the spectrogram's frequency axis is drawn. ``time_window`` (fractions of the file): with the
        automatic STFT settings the levels are of the window's own STFT (``zoom_window_spectrogram``, R3: as finely
        hopped as its length allows), of the frames whose centres lie in it and one beside each end; with settings
        given they are the whole file's STFT whatever the window. ``spectrogram`` false keeps the samples alone.
        An answer the store holds already is not made again (its key says everything it is of).

        Each channel's extents are kept beside them and named too (``signalExtent``, ``imageExtent``: the least and
        the most of its samples, and of its whole-file STFT's levels), for the rows whose scales are linked.
        ``extents`` true keeps and names those alone, of the whole file: what a recording that is not on screen
        takes part in the linked scale with, without its samples and levels being kept.
        """
        from services.analyzer import spectrogram_frame_centers, spectrogram_window_frames
        from services.answer_store import STORE
        from services.stage_combine import _channel_identity
        from services.tracks_answers import (
            ImageData,
            extent_kept,
            keep_track_image,
            keep_track_image_extent,
            keep_track_signal,
            keep_track_signal_extent,
            kept,
            level_extent,
            track_image_extent_key,
            track_image_key,
            track_signal_extent_key,
            track_signal_key,
        )

        cached, frame, resolved = self.engine.get_analysis(file_path, calibration_profile, source_version)
        count, rate = int(frame.n_samples), float(frame.sampling_rate)
        channel_count = int(frame.n_channels)
        duration = count / rate
        n_fft, hop, window = resolve_stft_params(count, stft_options)
        # The STFT of the analysis the row shows (the summary's ``stftSignature``): what the screen holds this answer
        # to. A window's own STFT (R3) is hopped more finely; that hop is said in ``hopSize`` and in the image's key,
        # not here, or the screen would take the window's levels for an answer of other settings and drop them.
        analysis_stft = f"{n_fft}/{hop}/{window}"
        windowed = time_window is not None and normalize_stft_options(stft_options) is None
        identities = [_channel_identity(channel) for channel in frame.channels]
        units = [str(getattr(channel, "unit", "") or "") for channel in frame.channels]

        if extents:
            time_window, windowed = None, False
        signal_keys = [track_signal_key(cached.input_id, resolved.signature, index) for index in range(channel_count)]
        signal_extent_keys = [
            track_signal_extent_key(cached.input_id, resolved.signature, index) for index in range(channel_count)
        ]
        extents_lacking = not all(extent_kept(key) for key in signal_extent_keys)
        if extents_lacking or (not extents and not all(kept(key) for key in signal_keys)):
            data = channels_first(np.asarray(frame.data), channel_count, count)
            for index, key in enumerate(signal_keys):
                keep_track_signal_extent(signal_extent_keys[index], data[index], identities[index], units[index])
                if extents or kept(key):
                    continue
                # A channel of several is copied out of the array they share, so the store can let one go alone.
                samples = data[index] if channel_count == 1 else np.ascontiguousarray(data[index]).copy()
                keep_track_signal(key, rate, samples, identities[index], units[index])
            del data

        image_keys: list[str] = []
        image_extent_keys: list[str] = []
        # The window's samples (the whole file's without one): what its own STFT is made of.
        first = max(0, int(math.floor(min(time_window) * count))) if time_window is not None else 0
        last = min(count, int(math.ceil(max(time_window) * count))) if time_window is not None else count
        # A recording shorter than half the STFT's window has no STFT (the settings were set by hand for longer
        # ones): its samples are kept and drawn all the same, and the reply says why it names no levels.
        no_levels: str | None = None
        if spectrogram:
            try:
                if windowed and time_window is not None:
                    of: object = ("window", n_fft, window, first, last)
                else:
                    of = ("whole", n_fft, hop, window)
                image_keys = [
                    track_image_key(cached.input_id, resolved.signature, index, of, scale)
                    for index in range(channel_count)
                ]
                whole_of = ("whole", n_fft, resolve_stft_params(count, stft_options)[1], window)
                image_extent_keys = [
                    track_image_extent_key(cached.input_id, resolved.signature, index, whole_of)
                    for index in range(channel_count)
                ]
                if extents:
                    if not all(extent_kept(key) for key in image_extent_keys):
                        held = [STORE.get(key) for key in image_keys]
                        if all(isinstance(image, ImageData) for image in held):
                            found_extents = [image.extent for image in held if isinstance(image, ImageData)]
                        else:
                            whole = np.asarray(
                                self.engine.get_spectrogram(
                                    cached.path, n_fft, hop, window, calibration_profile, source_version=cached.version
                                ).dB
                            )
                            whole = whole[np.newaxis] if whole.ndim == 2 else whole
                            found_extents = [level_extent(whole[index]) for index in range(channel_count)]
                            del whole
                        for index, key in enumerate(image_extent_keys):
                            keep_track_image_extent(key, found_extents[index], identities[index])
                elif not all(kept(key) for key in image_keys):
                    if windowed and time_window is not None:
                        stft, centres, hop = zoom_window_spectrogram(frame, n_fft, window, time_window)
                        frames = spectrogram_window_frames(centres, duration, time_window)
                        stft, centres = stft[:, :, frames], centres[frames]
                    else:
                        stft = self.engine.get_spectrogram(
                            cached.path, n_fft, hop, window, calibration_profile, source_version=cached.version
                        )
                        found = spectrogram_frame_centers(stft)
                        centres = found if found is not None else np.arange(stft.n_frames) * stft.hop_length / rate
                    levels = np.asarray(stft.dB)
                    levels = levels[np.newaxis] if levels.ndim == 2 else levels
                    freqs = np.asarray(stft.freqs, dtype=np.float64)
                    # The colours are the whole recording's: a window's own STFT is coloured by the whole file's levels.
                    level_extents: list[tuple[float, float] | None]
                    if windowed and time_window is not None:
                        whole_hop = resolve_stft_params(count, stft_options)[1]
                        whole_keys = [
                            track_image_key(
                                cached.input_id, resolved.signature, index, ("whole", n_fft, whole_hop, window), scale
                            )
                            for index in range(channel_count)
                        ]
                        held = [STORE.get(key) for key in whole_keys]
                        if all(isinstance(image, ImageData) for image in held):
                            level_extents = [image.extent for image in held if isinstance(image, ImageData)]
                        else:
                            whole = np.asarray(
                                self.engine.get_spectrogram(
                                    cached.path,
                                    n_fft,
                                    whole_hop,
                                    window,
                                    calibration_profile,
                                    source_version=cached.version,
                                ).dB
                            )
                            whole = whole[np.newaxis] if whole.ndim == 2 else whole
                            level_extents = [level_extent(whole[index]) for index in range(channel_count)]
                            del whole
                    else:
                        level_extents = [level_extent(levels[index]) for index in range(channel_count)]
                    for index, key in enumerate(image_keys):
                        keep_track_image(
                            key, centres, freqs, levels[index], identities[index], scale, duration, level_extents[index]
                        )
                        keep_track_image_extent(image_extent_keys[index], level_extents[index], identities[index])
                else:
                    if windowed and time_window is not None:
                        hop = max(
                            1, int(np.ceil(max(1, last - first - n_fft) / max(1, SPECTROGRAM_TIME_BIN_LIMIT - 1)))
                        )
                    # The levels are kept already: their extents are named again where the small store let them go.
                    for index, key in enumerate(image_extent_keys):
                        if not extent_kept(key) and not windowed:
                            image = STORE.get(image_keys[index])
                            if isinstance(image, ImageData):
                                keep_track_image_extent(key, image.extent, identities[index])
            except AnalysisSettingsError:
                no_levels = "too-short"
                image_keys, image_extent_keys = [], []

        channels: list[TrackChannelAnswer] = []
        for index in range(channel_count):
            unit, ref, label = identities[index]
            channel: TrackChannelAnswer = {
                "channelIndex": index,
                "level": {"unit": unit, "ref": ref, "label": label},
                "unit": units[index],
            }
            if not extents and kept(signal_keys[index]):
                channel["signal"] = signal_keys[index]
            if not extents and image_keys and kept(image_keys[index]):
                channel["image"] = image_keys[index]
            if extent_kept(signal_extent_keys[index]):
                channel["signalExtent"] = signal_extent_keys[index]
            if image_extent_keys and extent_kept(image_extent_keys[index]):
                channel["imageExtent"] = image_extent_keys[index]
            channels.append(channel)
        answers: TrackAnswersResult = {
            "filePath": str(file_path),
            "channels": channels,
            "sampleRateHz": rate,
            "durationSeconds": duration,
            "windowSize": n_fft,
            "hopSize": hop,
            "windowed": windowed,
            "calibrationSignature": resolved.signature,
            "analysisRevision": _analysis_revision(analysis_revision),
            "sourceVersion": cached.version,
            "stftSignature": analysis_stft,
        }
        if no_levels is not None:
            answers["noLevels"] = no_levels
        return answers

    def region_peak(self, sources: Sequence[Mapping[str, object]]) -> RegionPeakResult:
        """The largest |sample| of the channels named over each one's stretch (the file's 0..1, both ends in): one
        answer of every sample of them all (figure-design.md 第 1 節: a measured value a later step's setting
        starts from, here a new trigger's level); ``channels`` empty takes every channel of the recording."""
        peak = 0.0
        for source in sources:
            _cached, frame, _resolved = self.engine.get_analysis(
                str(source["filePath"]), source.get("calibrationProfile"), source.get("sourceVersion")
            )
            count, channels = int(frame.n_samples), int(frame.n_channels)
            named = [int(channel) for channel in cast(Sequence[int], source.get("channels") or [])]
            for channel in named:
                if not 0 <= channel < channels:
                    raise InputError(f"channel {channel} is not one of the recording's {channels}")
            # Sample i is at i / count of the file; a sample on an end of the stretch is inside it.
            first = max(0, math.ceil(float(cast(float, source["startNorm"])) * count - 1e-9))
            after = min(count, math.floor(float(cast(float, source["endNorm"])) * count + 1e-9) + 1)
            if after <= first:
                continue
            samples = channels_first(frame[:, first:after].data, channels, after - first)
            for channel in named or range(channels):
                peak = max(peak, absolute_peak(samples[channel]))
        return {"peak": peak}

    def export_wav_loop(
        self,
        file_path: str | Path,
        *,
        start_norm: float,
        end_norm: float,
    ) -> WavLoopExportResult:
        cached = self.engine.get_file(file_path)
        sample_rate = max(1, round(cached.frame.sampling_rate))
        start_sample, end_sample = sample_range(start_norm, end_norm, cached.frame.n_samples)
        frame_count = end_sample - start_sample

        if frame_count <= 0:
            raise InputError(
                f"Loop region produces 0 frames (startNorm={start_norm}, endNorm={end_norm}, "
                f"total_frames={cached.frame.n_samples}). Ensure startNorm < endNorm and the file is not empty."
            )

        range_frame = cached.frame[:, start_sample:end_sample]
        data = channels_first(range_frame.data, cached.frame.n_channels, frame_count).T
        buffer = io.BytesIO()
        sf.write(buffer, data, sample_rate, format="WAV", subtype="PCM_16")
        return {
            "wavBase64": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "sampleRate": sample_rate,
        }

    def build_recipe(
        self,
        file_path: str | Path,
        *,
        stft_options: Mapping[str, object] | None = None,
        bands_per_octave: int | None = None,
        reference_channel: int | None = None,
        responses: list[Mapping[str, object]] | None = None,
    ) -> RecipeBuildResult:
        from services.recipe_builder import RecipeSource, spectrum_recipe, transfer_recipe

        cached = self.engine.get_file(file_path)
        frame = cached.frame
        # The pair view's parameters: auto mode averages half-overlapping segments like Welch.
        n_fft, hop_length, window = pair_stft_params(frame.n_samples, stft_options)
        if reference_channel is None:
            source = RecipeSource(frame.n_channels, float(frame.sampling_rate))
            if bands_per_octave is None:
                recipe = spectrum_recipe(source, n_fft=n_fft, hop_length=hop_length, window=window)
                return {"name": "spectrum", "recipe": recipe}
            bands = octave_bands(bands_per_octave, frame.sampling_rate)
            recipe = spectrum_recipe(
                source,
                n_fft=n_fft,
                hop_length=hop_length,
                window=window,
                bands=(bands.centers_hz, bands_per_octave),
            )
            return {"name": f"octave-{bands_per_octave}", "recipe": recipe}
        if not responses:
            raise InputError("A transfer function Recipe needs at least one response channel")
        files: list[CachedAnalysis] = [cached]
        pairs: list[tuple[int, int]] = []
        for channel in [{"filePath": str(file_path), "channelIndex": reference_channel}, *responses]:
            response = self.engine.get_file(str(channel["filePath"]))
            index = next((i for i, known in enumerate(files) if known.path == response.path), None)
            if index is None:
                files.append(response)
                index = len(files) - 1
            channel_index = int(channel["channelIndex"])  # type: ignore[call-overload]
            if not 0 <= channel_index < response.frame.n_channels:
                raise InputError(f"channelIndex {channel_index} is out of range for {response.path.name}")
            pairs.append((index, channel_index))
        recipe = transfer_recipe(
            [RecipeSource(known.frame.n_channels, float(known.frame.sampling_rate)) for known in files],
            pairs[0][1],
            pairs[1:],
            n_fft=n_fft,
            hop_length=hop_length,
            window=window,
        )
        return {"name": "transfer-function", "recipe": recipe}

    def scan(
        self,
        file_path: str,
        *,
        recipe: Mapping[str, object],
        region: Mapping[str, float] | None = None,
        channels: list[int] | None = None,
        calibration_profile: object = None,
        stage: str,
        reference: Mapping[str, object] | None = None,
    ) -> dict[str, object]:
        from services.scan_service import scan

        return dict(
            scan(
                self.engine,
                file_path,
                recipe=recipe,
                region=region,
                channels=channels,
                calibration_profile=calibration_profile,
                stage=stage,
                # Another recording a cross-channel step pairs this one with: its path, step and own Recipe.
                reference=(
                    (
                        str(reference["filePath"]),
                        {
                            "step": str(reference["step"]),
                            "recipe": reference["recipe"],
                            "calibration": reference.get("calibration"),
                        },  # type: ignore[typeddict-item]
                    )
                    if reference is not None
                    else None
                ),
            )
        )

    def release_track_detail(self, file_path: str | Path) -> dict[str, object]:
        return {}


def pair_stft_params(sample_count: int, stft_options: Mapping[str, object] | None) -> tuple[int, int, str]:
    n_fft, hop_length, window = resolve_stft_params(sample_count, stft_options)
    # Auto mode picks its hop for the spectrogram's time bins; Welch averaging wants the usual half overlap.
    return (n_fft, n_fft // 2, window) if stft_options is None else (n_fft, hop_length, window)


def _pair_status(x: _PairSource, y: _PairSource) -> str:
    """A pair is calibrated only when both of its channels are (R4)."""
    return "calibrated" if x.status == "calibrated" and y.status == "calibrated" else "uncalibrated"


def pair_overlap(
    x: _PairSource, y: _PairSource, start_seconds: float | None, end_seconds: float | None
) -> tuple[float, float]:
    """Global seconds both channels cover inside the requested range, capped at ``MAX_PAIR_SECONDS``."""
    start = max(x.offset, y.offset, -math.inf if start_seconds is None else start_seconds)
    end = min(
        x.offset + x.frame.n_samples / float(x.frame.sampling_rate),
        y.offset + y.frame.n_samples / float(y.frame.sampling_rate),
        math.inf if end_seconds is None else end_seconds,
    )
    return start, min(end, start + MAX_PAIR_SECONDS)


def _compute_pair(
    x: _PairSource,
    y: _PairSource,
    start_seconds: float | None,
    end_seconds: float | None,
    n_fft: int,
    hop_length: int,
    window: str,
    bins: np.ndarray,
) -> _PairSpectrum:
    rate = float(x.frame.sampling_rate)
    y_rate = float(y.frame.sampling_rate)
    start, end = pair_overlap(x, y, start_seconds, end_seconds)
    empty = np.empty((3, 0))
    if end <= start:
        return _PairSpectrum("no-overlap", start, max(start, end), 0, False, empty)
    length = int(math.floor((end - start) * rate))
    if length < n_fft:
        return _PairSpectrum("too-short", start, start + length / rate, 0, y_rate != rate, empty)
    x_start = min(int(round((start - x.offset) * rate)), x.frame.n_samples - length)
    y_start = int(round((start - y.offset) * y_rate))
    y_length = int(math.ceil((end - start) * y_rate))
    reference = x.frame.get_channel(x.channel)[:, x_start : x_start + length]
    response = y.frame.get_channel(y.channel)[:, y_start : y_start + y_length]
    resampled = y_rate != rate
    if resampled:
        response = response.resampling(target_sr=rate)
    response = response.fix_length(length=length)
    spectrogram = (
        reference.concat_frame(response, suffix_on_dup="_y")
        .stft(n_fft=n_fft, hop_length=hop_length, window=window, detrend="constant")
        .cache()
    )
    # The STFT pads the edges; averaging only frames inside the range matches Welch's segments.
    origin = spectrogram.frame_time_origin
    assert origin is not None, "an STFT of a time signal knows where its first frame is centred"
    first_center = int(round(origin * rate))
    frame_starts = np.arange(spectrogram.n_frames) * hop_length + first_center - n_fft // 2
    inside = np.flatnonzero((frame_starts >= 0) & (frame_starts + n_fft <= length))
    end = start + length / rate
    if inside.size == 0:
        return _PairSpectrum("too-short", start, end, 0, resampled, empty)
    csd = spectrogram[:, :, int(inside[0]) : int(inside[-1]) + 1].csd().cache()
    transfer = csd.transfer_function().select_pair(1, 0)
    coherence = csd.coherence().select_pair(1, 0)
    from frames.level_identity import level_identity

    domain = transfer.pair_domains[0]
    identity = level_identity(domain.unit, domain.reference, transfer.channels[0].level_reference.label)
    gain = transfer.gain_db if domain.unit == "1" else transfer.transfer_level_db
    rows = np.vstack(
        [
            np.asarray(gain, dtype=np.float64).reshape(-1)[bins],
            np.asarray(transfer.phase, dtype=np.float64).reshape(-1)[bins],
            np.asarray(coherence.coherence, dtype=np.float64).reshape(-1)[bins],
        ]
    )
    return _PairSpectrum("ok", start, end, int(inside.size), resampled, rows, identity)


__all__ = [
    "AnalysisService",
    "pair_overlap",
    "pair_stft_params",
    "RecipeBuildResult",
    "StftOptions",
    "WavLoopExportResult",
]
