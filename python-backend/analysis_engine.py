from __future__ import annotations

import hashlib
import json
import os
import threading
from collections import OrderedDict
from collections.abc import Hashable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf
import wandas as wd

from backend_errors import AnalysisSettingsError, StaleSourceError, UnreadableFileError
from calibration_profile import ResolvedCalibrationProfile, finite_source_channel_peaks, resolve_calibration_profile

StftKey = tuple[str, int, int, str]
SpectrumSliceKey = tuple[str, int, str, int, int, int | None]
PairSpectrumKey = tuple[object, ...]
#: A source's samples are cached in a dtype that holds every one of them exactly (source_dtype): float32 where the
#: source's own format fits in it, float64 otherwise. Every readout, median and Δ is of these samples (R1).
FLOAT32 = np.dtype("float32")
FLOAT64 = np.dtype("float64")
#: The STFT is computed of float64 samples and cached in complex128: the lane's readout and the cursor spectrum read
#: their numbers from it, so it is never cut to single precision first (R1).
SPECTROGRAM_CACHE_DTYPE = np.dtype("complex128")
#: Sample formats (libsndfile subtypes) whose every value a float32 holds exactly: PCM of up to 24 bits, float32, and
#: the codecs libsndfile decodes in single precision. Any other (64-bit float, 32-bit PCM, a CSV) is read as float64.
_FLOAT32_EXACT_SUBTYPES = frozenset(
    {
        *("PCM_S8", "PCM_U8", "PCM_16", "PCM_24", "FLOAT", "ULAW", "ALAW", "IMA_ADPCM", "MS_ADPCM", "GSM610"),
        *("VOX_ADPCM", "G721_32", "G723_24", "G723_40", "DWVW_12", "DWVW_16", "DWVW_24", "DPCM_8", "DPCM_16"),
        *("VORBIS", "OPUS", "ALAC_16", "ALAC_20", "ALAC_24", "MPEG_LAYER_I", "MPEG_LAYER_II", "MPEG_LAYER_III"),
    }
)


def source_dtype(source: str | Path | bytes, file_type: str | None = None) -> np.dtype:
    """The dtype that holds every sample of ``source`` exactly: float32 for a format that fits in it (16- or 24-bit
    PCM convert to float32 exactly, a float32 WAV is one), float64 for any other (a 64-bit float WAV, 32-bit PCM, a
    CSV's decimal values). A source whose format cannot be told is read in float64."""
    suffix = (file_type or (Path(source).suffix if isinstance(source, str | Path) else "")).lower()
    if suffix == ".csv":
        return FLOAT64
    try:
        subtype = wd.inspect(source, file_type=file_type).get("subtype")
    except (sf.LibsndfileError, OSError, RuntimeError, ValueError):
        return FLOAT64
    return FLOAT32 if subtype in _FLOAT32_EXACT_SUBTYPES else FLOAT64


def compute_spectrogram(frame: wd.ChannelFrame, n_fft: int, hop_length: int, window: str) -> wd.SpectrogramFrame:
    # Auto display sampling can leave gaps between windows on long desktop files; Wandas then computes only the
    # kept frames, at their physical centres, rather than a dense STFT whose frames would be discarded.
    # Of float64 samples, so the STFT is complex128: its cells are read as numbers (the lane's readout, R1).
    # (A float64 frame's cast is the same Dask array; a float32 one's is cast block by block as the STFT reads it.)
    samples = frame.astype(FLOAT64)
    # wandas annotates its transform mixin's self as TransformFrameProtocol, which ChannelFrame does not satisfy.
    return samples.stft(  # pyright: ignore[reportAttributeAccessIssue]
        n_fft=n_fft, hop_length=hop_length, window=window, allow_sparse=hop_length > n_fft
    )


def file_version(stat: os.stat_result) -> tuple[int, int, int, int]:
    """What one version of a file on disk is: its size, its modification and status-change times to the
    nanosecond, and its inode. A file rewritten within the same millisecond, or replaced by a copy that keeps its
    modification time (``cp -p``, ``rsync -t``), changes at least one of them; nothing is truncated."""
    return (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino)


@dataclass(slots=True)
class CachedAnalysis:
    path: Path
    frame: wd.ChannelFrame
    #: What tells this read of the file from another: its full stat locally (file_version), a load count in the browser.
    identity: tuple[int, ...]
    frame_nbytes: int
    source_peaks: tuple[float, ...] = ()
    # Names the input in scan condition IDs: the path and its file_version here, the content hash in the browser.
    input_id: str = ""
    spectrograms: dict[StftKey, wd.SpectrogramFrame] = field(default_factory=dict)
    spectrogram_nbytes: dict[StftKey, int] = field(default_factory=dict)
    spectrum_slices: OrderedDict[SpectrumSliceKey, tuple[np.ndarray, float]] = field(default_factory=OrderedDict)
    pair_spectra: OrderedDict[PairSpectrumKey, object] = field(default_factory=OrderedDict)

    @property
    def version(self) -> str:
        """The version of the file this read is of (sourceVersion): every answer of the file names it, and a
        request naming another is refused (StaleSourceError) instead of answered from the file as it is now."""
        return hashlib.sha256(self.input_id.encode()).hexdigest()[:16]

    @property
    def nbytes(self) -> int:
        """Bytes this file holds in the cache: its frame, STFTs, spectrum slices and pair spectra."""
        return (
            self.frame_nbytes
            + sum(self.spectrogram_nbytes.values())
            + sum(_array_nbytes(value) for value in self.spectrum_slices.values())
            + sum(_array_nbytes(value) for value in self.pair_spectra.values())
        )


def _array_nbytes(value: object) -> int:
    """Sum the NumPy arrays held in a cached value, including inside (named) tuples."""
    if isinstance(value, np.ndarray):
        return int(value.nbytes)
    if isinstance(value, tuple):
        return sum(_array_nbytes(item) for item in value)
    return 0


@dataclass(slots=True)
class _LoadSlot:
    lock: threading.Lock = field(default_factory=threading.Lock)
    users: int = 0


class AnalysisEngine:
    def __init__(self, cache_limit_bytes: int | None = None) -> None:
        if cache_limit_bytes is None:
            cache_limit_bytes = int(os.environ.get("AWA_CACHE_MB", "1024")) * 1024 * 1024
        self.cache_limit_bytes = max(0, cache_limit_bytes)
        self._files: OrderedDict[Path, CachedAnalysis] = OrderedDict()
        self.spectrum_slice_cache_entries = 64
        # Requests for different files run on several threads: the caches change under this lock, and one
        # file is read, or one STFT built, once even when two requests for it arrive together.
        self._lock = threading.RLock()
        # One build lock per file path or STFT key while requests for it are in flight; the last one out removes it.
        self._loading: dict[Hashable, _LoadSlot] = {}

    @contextmanager
    def _single_flight(self, key: Hashable) -> Iterator[None]:
        with self._lock:
            slot = self._loading.setdefault(key, _LoadSlot())
            slot.users += 1
        try:
            with slot.lock:
                yield
        finally:
            with self._lock:
                slot.users -= 1
                if slot.users == 0:
                    del self._loading[key]

    def get_file(self, file_path: str | Path) -> CachedAnalysis:
        # The resolved path only keys the cache; replies name the file as the request spelled it.
        path = Path(file_path).expanduser().resolve()
        if not path.exists():
            raise UnreadableFileError(f"Audio file not found: {path}")
        identity = file_version(path.stat())
        with self._single_flight(path):
            with self._lock:
                cached = self._files.get(path)
                if cached is not None and cached.identity == identity:
                    self._files.move_to_end(path)
                    return cached
            try:
                dtype = source_dtype(path)
                frame = wd.read(path, dtype=dtype).cache()
            except sf.LibsndfileError as error:
                raise UnreadableFileError(f"Unable to read audio: {error.error_string}") from error
            except (OSError, RuntimeError, ValueError) as error:
                raise UnreadableFileError(f"Unable to read {path.name}: {error}") from error
            source_peaks = finite_source_channel_peaks(frame)
            cached = CachedAnalysis(
                path=path,
                frame=frame,
                identity=identity,
                frame_nbytes=int(np.prod(frame.shape)) * dtype.itemsize,
                source_peaks=source_peaks,
                input_id=json.dumps([str(path), *identity]),
            )
            with self._lock:
                self._files[path] = cached
                self._evict(path)
            return cached

    def get_analysis(
        self,
        file_path: str | Path,
        calibration_profile: object = None,
        source_version: object = None,
    ) -> tuple[CachedAnalysis, wd.ChannelFrame, ResolvedCalibrationProfile]:
        cached = self.get_file(file_path)
        if source_version is not None and source_version != cached.version:
            # The track asking was drawn from another version of the file (rewritten since it was analysed).
            raise StaleSourceError(f"{cached.path.name} changed on disk since it was analysed; analyse it again")
        resolved = resolve_calibration_profile(
            calibration_profile,
            cached.frame,
            source_peaks=cached.source_peaks,
        )
        return cached, resolved.apply(cached.frame), resolved

    def get_spectrogram(
        self,
        file_path: str | Path,
        n_fft: int,
        hop_length: int,
        window: str,
        calibration_profile: object = None,
        source_version: object = None,
    ) -> wd.SpectrogramFrame:
        # Of the version the caller read (source_version): a file written between its read and this one is refused,
        # never computed from the new content under the old version's name.
        cached, analysis_frame, resolved = self.get_analysis(file_path, calibration_profile, source_version)
        if analysis_frame.n_samples < n_fft // 2:
            # SciPy's padded STFT needs at least half a window of samples.
            raise AnalysisSettingsError("Audio is too short for this STFT window; choose a smaller window")
        key = (resolved.signature, n_fft, hop_length, window)
        # Two track-detail requests for one file run at once; the second waits for the first's STFT, not a copy.
        with self._single_flight((cached.path, key)):
            spectrogram = cached.spectrograms.get(key)
            if spectrogram is None:
                spectrogram = (
                    compute_spectrogram(analysis_frame, n_fft, hop_length, window)
                    .astype(SPECTROGRAM_CACHE_DTYPE)
                    .cache()
                )
                with self._lock:
                    cached.spectrograms[key] = spectrogram
                    cached.spectrogram_nbytes[key] = int(np.prod(spectrogram.shape)) * SPECTROGRAM_CACHE_DTYPE.itemsize
                    self._evict(cached.path)
            return spectrogram

    def get_cached_spectrogram(
        self,
        file_path: str | Path,
        n_fft: int,
        hop_length: int,
        window: str,
        calibration_profile: object = None,
        source_version: object = None,
    ) -> wd.SpectrogramFrame | None:
        cached, _analysis_frame, resolved = self.get_analysis(file_path, calibration_profile, source_version)
        return cached.spectrograms.get((resolved.signature, n_fft, hop_length, window))

    def is_cached(self, file_path: str | Path) -> bool:
        with self._lock:
            return Path(file_path).expanduser().resolve() in self._files

    def discard(self, file_path: str | Path) -> None:
        with self._lock:
            self._files.pop(Path(file_path).expanduser().resolve(), None)

    def discard_spectrograms(self, file_path: str | Path) -> None:
        with self._lock:
            cached = self._files.get(Path(file_path).expanduser().resolve())
            if cached is not None:
                cached.spectrograms.clear()
                cached.spectrogram_nbytes.clear()

    def get_spectrum_slice(
        self,
        cached: CachedAnalysis,
        key: SpectrumSliceKey,
    ) -> tuple[np.ndarray, float] | None:
        with self._lock:
            value = cached.spectrum_slices.get(key)
            if value is not None:
                cached.spectrum_slices.move_to_end(key)
            return value

    def put_spectrum_slice(
        self,
        cached: CachedAnalysis,
        key: SpectrumSliceKey,
        rows: np.ndarray,
        max_frequency_hz: float,
    ) -> None:
        with self._lock:
            cached.spectrum_slices[key] = (rows, max_frequency_hz)
            cached.spectrum_slices.move_to_end(key)
            while len(cached.spectrum_slices) > self.spectrum_slice_cache_entries:
                cached.spectrum_slices.popitem(last=False)
            self._evict(cached.path)

    def get_pair_spectrum(self, cached: CachedAnalysis, key: PairSpectrumKey) -> object | None:
        with self._lock:
            value = cached.pair_spectra.get(key)
            if value is not None:
                cached.pair_spectra.move_to_end(key)
            return value

    def put_pair_spectrum(self, cached: CachedAnalysis, key: PairSpectrumKey, value: object) -> None:
        with self._lock:
            cached.pair_spectra[key] = value
            cached.pair_spectra.move_to_end(key)
            while len(cached.pair_spectra) > self.spectrum_slice_cache_entries:
                cached.pair_spectra.popitem(last=False)
            self._evict(cached.path)

    def clear(self) -> None:
        with self._lock:
            self._files.clear()

    @property
    def cache_bytes(self) -> int:
        with self._lock:
            return sum(entry.nbytes for entry in self._files.values())

    def _evict(self, protected_path: Path) -> None:
        # Other files go first, then the file in use's spectrograms. Its frame stays even past the limit:
        # dropping it would decode the whole file again on every zoom and cursor request.
        while self.cache_bytes > self.cache_limit_bytes:
            other = next((path for path in self._files if path != protected_path), None)
            if other is not None:
                self._files.pop(other)
                continue
            protected = self._files.get(protected_path)
            if protected is None or not protected.spectrograms:
                break
            key = next(iter(protected.spectrograms))
            del protected.spectrograms[key]
            del protected.spectrogram_nbytes[key]
