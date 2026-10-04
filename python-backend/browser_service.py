from __future__ import annotations

import json
from pathlib import Path

import dask
import numpy as np
import wandas as wd

from analysis_engine import AUDIO_CACHE_DTYPE, AnalysisEngine, CachedAnalysis
from analysis_service import AnalysisService
from analyzer import resolve_stft_params
from backend_server import dispatch, validate_request
from calibration_profile import source_channel_peaks

MAX_INPUT_BYTES = 16 * 1024 * 1024
MAX_ESTIMATED_BYTES = 384 * 1024 * 1024


class BrowserEngine(AnalysisEngine):
    def __init__(self) -> None:
        super().__init__(128 * 1024 * 1024)
        self.source: CachedAnalysis | None = None

    def load(self, source_id: str, payload: bytes) -> dict[str, object]:
        self.clear()
        if not payload or len(payload) > MAX_INPUT_BYTES:
            raise ValueError("Select a non-empty WAV up to 16 MiB")
        if payload[:4] != b"RIFF" or payload[8:12] != b"WAVE":
            raise ValueError("This prototype supports RIFF WAV only")
        header = wd.inspect(payload, file_type=".wav")
        length, channels, rate = (int(header[key]) for key in ("frames", "channels", "samplerate"))
        if not length >= 32 or not 1 <= channels <= 2 or not 1000 <= rate <= 96000 or length / rate > 30:
            raise ValueError("Prototype limits: 32+ samples, 1–2 channels, 1–96 kHz, up to 30 seconds")
        path = Path("/sources") / source_id
        if path.name != source_id or not source_id.endswith(".wav"):
            raise ValueError("Invalid source identity")
        frame = wd.read(payload, file_type=".wav", source_name=source_id).astype(AUDIO_CACHE_DTYPE).cache()
        if not np.isfinite(frame.data).all():
            raise ValueError("WAV contains non-finite samples")
        self.source = CachedAnalysis(
            path=path,
            frame=frame,
            identity=(0, len(payload)),
            frame_nbytes=int(np.prod(frame.shape)) * AUDIO_CACHE_DTYPE.itemsize,
            source_peaks=source_channel_peaks(frame),
        )
        return {"filePath": str(path)}

    def get_file(self, file_path: str | Path) -> CachedAnalysis:
        if self.source is None or Path(file_path) != self.source.path:
            raise ValueError("Source is no longer selected")
        return self.source

    def discard_spectrograms(self, file_path: str | Path) -> None:
        cached = self.get_file(file_path)
        cached.spectrograms.clear()
        cached.spectrogram_nbytes.clear()

    def clear(self) -> None:
        self.source = None
        super().clear()

    def get_spectrogram(self, file_path, n_fft, hop_length, window, calibration_profile=None):
        cached = self.get_file(file_path)
        length, channels = cached.frame.n_samples, cached.frame.n_channels
        if length < n_fft // 2:
            raise ValueError("WAV is too short for this STFT window; choose a smaller window")
        estimated = (
            192 * 1024 * 1024 + length * channels * 32 + ((length // hop_length) + 5) * channels * (n_fft // 2 + 1) * 56
        )
        if estimated > MAX_ESTIMATED_BYTES:
            raise ValueError("STFT exceeds prototype estimated memory budget; increase hop size")
        key = (n_fft, hop_length, window)
        if any(old[1:] != key for old in cached.spectrograms):
            cached.spectrograms.clear()
            cached.spectrogram_nbytes.clear()
        return super().get_spectrogram(file_path, n_fft, hop_length, window, calibration_profile)


class BrowserService(AnalysisService):
    def release_track_detail(self, file_path: str | Path) -> dict[str, object]:
        self.engine.discard_spectrograms(file_path)
        return {}


def create_service() -> AnalysisService:
    dask.config.set(scheduler="synchronous")
    return BrowserService(BrowserEngine())


service = create_service()


def load_source(source_id: str, payload: object) -> str:
    return json.dumps(service.engine.load(source_id, bytes(payload)))


def dispatch_json(raw: str) -> str:
    command = validate_request(json.loads(raw))
    # Resolve settings at the boundary before expensive allocation.
    resolve_stft_params(service.engine.get_file(command["filePath"]).frame.n_samples, command.get("stftOptions"))
    return json.dumps(dispatch(command, service), allow_nan=False)
