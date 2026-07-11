from __future__ import annotations

import os
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import wandas as wd

StftKey = tuple[int, int, str]


@dataclass(slots=True)
class CachedAnalysis:
    path: Path
    frame: wd.ChannelFrame
    spectrograms: dict[StftKey, wd.SpectrogramFrame] = field(default_factory=dict)

    @property
    def nbytes(self) -> int:
        total = np.asarray(self.frame.data).nbytes
        total += sum(np.asarray(spectrogram.data).nbytes for spectrogram in self.spectrograms.values())
        return total


class AnalysisEngine:
    def __init__(self, cache_limit_bytes: int | None = None) -> None:
        if cache_limit_bytes is None:
            cache_limit_bytes = int(os.environ.get("AWA_CACHE_MB", "1024")) * 1024 * 1024
        self.cache_limit_bytes = max(0, cache_limit_bytes)
        self._files: OrderedDict[Path, CachedAnalysis] = OrderedDict()

    def get_file(self, file_path: str | Path) -> CachedAnalysis:
        path = Path(file_path).expanduser().resolve()
        cached = self._files.get(path)
        if cached is not None:
            self._files.move_to_end(path)
            return cached
        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {path}")
        cached = CachedAnalysis(path=path, frame=wd.read(path))
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
            spectrogram = cached.frame.stft(n_fft=n_fft, hop_length=hop_length, window=window)
            cached.spectrograms[key] = spectrogram
            self._evict(cached.path)
        return spectrogram

    def get_range_frame(self, file_path: str | Path, start_norm: float, end_norm: float) -> wd.ChannelFrame:
        frame = self.get_file(file_path).frame
        start = max(0, int(start_norm * frame.n_samples))
        end = min(frame.n_samples, int(end_norm * frame.n_samples))
        return frame[:, start:end]

    def discard(self, file_path: str | Path) -> None:
        self._files.pop(Path(file_path).expanduser().resolve(), None)

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
