from __future__ import annotations

import json
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import wandas as wd

from backend_errors import AnalysisSettingsError, UnreadableFileError
from calibration_profile import ResolvedCalibrationProfile, finite_source_channel_peaks, resolve_calibration_profile

StftKey = tuple[str, int, int, str]
SpectrumSliceKey = tuple[str, int, str, int, int, int | None]
PairSpectrumKey = tuple[object, ...]
AUDIO_CACHE_DTYPE = np.dtype("float32")
SPECTROGRAM_CACHE_DTYPE = np.dtype("complex64")


def compute_spectrogram(frame: wd.ChannelFrame, n_fft: int, hop_length: int, window: str) -> wd.SpectrogramFrame:
    # Auto display sampling can leave gaps between windows on long desktop files; Wandas then computes only the
    # kept frames, at their physical centres, rather than a dense STFT whose frames would be discarded.
    # wandas annotates its transform mixin's self as TransformFrameProtocol, which ChannelFrame does not satisfy.
    return frame.stft(  # pyright: ignore[reportAttributeAccessIssue]
        n_fft=n_fft, hop_length=hop_length, window=window, allow_sparse=hop_length > n_fft
    )


@dataclass(slots=True)
class CachedAnalysis:
    path: Path
    frame: wd.ChannelFrame
    identity: tuple[int, int]
    frame_nbytes: int
    source_peaks: tuple[float, ...] = ()
    # Names the input in scan condition IDs: path, size and mtime here, the content hash in the browser.
    input_id: str = ""
    spectrograms: dict[StftKey, wd.SpectrogramFrame] = field(default_factory=dict)
    spectrogram_nbytes: dict[StftKey, int] = field(default_factory=dict)
    spectrum_slices: OrderedDict[SpectrumSliceKey, tuple[np.ndarray, float]] = field(default_factory=OrderedDict)
    pair_spectra: OrderedDict[PairSpectrumKey, object] = field(default_factory=OrderedDict)

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
        # file is read once even when two requests for it arrive together.
        self._lock = threading.RLock()
        # One read lock per path while requests for it are in flight; the last request out removes it.
        self._loading: dict[Path, _LoadSlot] = {}

    def get_file(self, file_path: str | Path) -> CachedAnalysis:
        path = Path(file_path).expanduser().resolve()
        if not path.exists():
            raise UnreadableFileError(f"Audio file not found: {path}")
        stat = path.stat()
        identity = (stat.st_mtime_ns, stat.st_size)
        with self._lock:
            slot = self._loading.setdefault(path, _LoadSlot())
            slot.users += 1
        try:
            return self._load_file(path, identity, stat, slot.lock)
        finally:
            with self._lock:
                slot.users -= 1
                if slot.users == 0:
                    del self._loading[path]

    def _load_file(
        self, path: Path, identity: tuple[int, int], stat: os.stat_result, loading: threading.Lock
    ) -> CachedAnalysis:
        with loading:
            with self._lock:
                cached = self._files.get(path)
                if cached is not None and cached.identity == identity:
                    self._files.move_to_end(path)
                    return cached
            frame = wd.read(path, dtype=AUDIO_CACHE_DTYPE).cache()
            source_peaks = finite_source_channel_peaks(frame)
            cached = CachedAnalysis(
                path=path,
                frame=frame,
                identity=identity,
                frame_nbytes=int(np.prod(frame.shape)) * AUDIO_CACHE_DTYPE.itemsize,
                source_peaks=source_peaks,
                input_id=json.dumps([str(path), stat.st_size, stat.st_mtime_ns // 1_000_000]),
            )
            with self._lock:
                self._files[path] = cached
                self._evict(path)
            return cached

    def get_analysis(
        self,
        file_path: str | Path,
        calibration_profile: object = None,
    ) -> tuple[CachedAnalysis, wd.ChannelFrame, ResolvedCalibrationProfile]:
        cached = self.get_file(file_path)
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
    ) -> wd.SpectrogramFrame:
        cached, analysis_frame, resolved = self.get_analysis(file_path, calibration_profile)
        if analysis_frame.n_samples < n_fft // 2:
            # SciPy's padded STFT needs at least half a window of samples.
            raise AnalysisSettingsError("Audio is too short for this STFT window; choose a smaller window")
        key = (resolved.signature, n_fft, hop_length, window)
        spectrogram = cached.spectrograms.get(key)
        if spectrogram is None:
            spectrogram = (
                compute_spectrogram(analysis_frame, n_fft, hop_length, window).astype(SPECTROGRAM_CACHE_DTYPE).cache()
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
    ) -> wd.SpectrogramFrame | None:
        cached, _analysis_frame, resolved = self.get_analysis(file_path, calibration_profile)
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
