from __future__ import annotations

import os
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import wandas as wd

StftKey = tuple[int, int, str]
AUDIO_CACHE_DTYPE = np.dtype("float32")
SPECTROGRAM_CACHE_DTYPE = np.dtype("complex64")


@dataclass(slots=True)
class CachedAnalysis:
    path: Path
    frame: wd.ChannelFrame
    identity: tuple[int, int]
    frame_nbytes: int
    spectrograms: dict[StftKey, wd.SpectrogramFrame] = field(default_factory=dict)
    spectrogram_nbytes: dict[StftKey, int] = field(default_factory=dict)

    @property
    def nbytes(self) -> int:
        return self.frame_nbytes + sum(self.spectrogram_nbytes.values())


class AnalysisEngine:
    def __init__(self, cache_limit_bytes: int | None = None) -> None:
        if cache_limit_bytes is None:
            cache_limit_bytes = int(os.environ.get("AWA_CACHE_MB", "1024")) * 1024 * 1024
        self.cache_limit_bytes = max(0, cache_limit_bytes)
        self._files: OrderedDict[Path, CachedAnalysis] = OrderedDict()

    def get_file(self, file_path: str | Path) -> CachedAnalysis:
        path = Path(file_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {path}")
        stat = path.stat()
        identity = (stat.st_mtime_ns, stat.st_size)
        cached = self._files.get(path)
        if cached is not None and cached.identity == identity:
            self._files.move_to_end(path)
            return cached
        frame = wd.read(path).astype(AUDIO_CACHE_DTYPE).cache()
        cached = CachedAnalysis(
            path=path,
            frame=frame,
            identity=identity,
            frame_nbytes=int(np.prod(frame.shape)) * AUDIO_CACHE_DTYPE.itemsize,
        )
        self._files[path] = cached
        self._evict(path)
        return cached

    def get_spectrogram(
        self,
        file_path: str | Path,
        n_fft: int,
        hop_length: int,
        window: str,
    ) -> wd.SpectrogramFrame:
        cached = self.get_file(file_path)
        key = (n_fft, hop_length, window)
        spectrogram = cached.spectrograms.get(key)
        if spectrogram is None:
            spectrogram = (
                cached.frame.stft(n_fft=n_fft, hop_length=hop_length, window=window)
                .astype(SPECTROGRAM_CACHE_DTYPE)
                .cache()
            )
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
    ) -> wd.SpectrogramFrame | None:
        cached = self.get_file(file_path)
        return cached.spectrograms.get((n_fft, hop_length, window))

    def discard(self, file_path: str | Path) -> None:
        self._files.pop(Path(file_path).expanduser().resolve(), None)

    def discard_spectrograms(self, file_path: str | Path) -> None:
        cached = self._files.get(Path(file_path).expanduser().resolve())
        if cached is not None:
            cached.spectrograms.clear()
            cached.spectrogram_nbytes.clear()

    def clear(self) -> None:
        self._files.clear()

    @property
    def cache_bytes(self) -> int:
        return sum(entry.nbytes for entry in self._files.values())

    def _evict(self, protected_path: Path) -> None:
        while self._files and self.cache_bytes > self.cache_limit_bytes:
            oldest = next(iter(self._files))
            if oldest == protected_path and len(self._files) > 1:
                self._files.move_to_end(oldest)
                oldest = next(iter(self._files))
            self._files.pop(oldest)
            if oldest == protected_path:
                break
