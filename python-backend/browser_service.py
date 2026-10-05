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
MAX_ESTIMATED_BYTES = 512 * 1024 * 1024
MAX_TOTAL_INPUT_BYTES = 64 * 1024 * 1024
MAX_TOTAL_DECODED_BYTES = 64 * 1024 * 1024
MAX_SOURCES = 8
DISPLAY_EXPORT_RESERVE = 64 * 1024 * 1024


class BrowserEngine(AnalysisEngine):
    def __init__(self) -> None:
        super().__init__(128 * 1024 * 1024)

    def load(self, source_id: str, payload: bytes) -> dict[str, object]:
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
        if path in self._files:
            raise ValueError("Source identity is already loaded")
        frame_bytes = length * channels * AUDIO_CACHE_DTYPE.itemsize
        input_bytes = sum(entry.identity[1] for entry in self._files.values()) + len(payload)
        decoded_bytes = sum(entry.frame_nbytes for entry in self._files.values()) + frame_bytes
        if len(self._files) >= MAX_SOURCES or input_bytes > MAX_TOTAL_INPUT_BYTES:
            raise ValueError("Browser session limit: up to 8 WAV files / 64 MiB total input")
        if decoded_bytes > MAX_TOTAL_DECODED_BYTES:
            raise ValueError("Browser session exceeds 64 MiB decoded audio budget")
        estimated = (
            192 * 1024 * 1024
            + DISPLAY_EXPORT_RESERVE
            + input_bytes
            + len(payload)
            + self.retained_bytes * 2
            + frame_bytes * 8
        )
        if estimated > MAX_ESTIMATED_BYTES:
            raise ValueError("Loading exceeds browser estimated memory budget; remove another track")
        frame = wd.read(payload, file_type=".wav", source_name=source_id).astype(AUDIO_CACHE_DTYPE).cache()
        if not np.isfinite(frame.data).all():
            raise ValueError("WAV contains non-finite samples")
        self._files[path] = CachedAnalysis(
            path=path,
            frame=frame,
            identity=(0, len(payload)),
            frame_nbytes=int(np.prod(frame.shape)) * AUDIO_CACHE_DTYPE.itemsize,
            source_peaks=source_channel_peaks(frame),
        )
        return {"filePath": str(path)}

    def get_file(self, file_path: str | Path) -> CachedAnalysis:
        path = Path(file_path)
        cached = self._files.get(path)
        if cached is None:
            raise ValueError("Source is no longer selected")
        self._files.move_to_end(path)
        return cached

    def discard(self, file_path: str | Path) -> None:
        self._files.pop(Path(file_path), None)

    def discard_spectrograms(self, file_path: str | Path) -> None:
        cached = self.get_file(file_path)
        cached.spectrograms.clear()
        cached.spectrogram_nbytes.clear()
        cached.spectrum_slices.clear()

    @property
    def retained_bytes(self) -> int:
        return self.cache_bytes + sum(
            int(rows.nbytes) for entry in self._files.values() for rows, _ in entry.spectrum_slices.values()
        )

    def _evict(self, protected_path: Path) -> None:
        # Selected sources stay resident; evict recomputable detail rather than user tracks.
        for path in [p for p in self._files if p != protected_path] + [protected_path]:
            if self.retained_bytes <= self.cache_limit_bytes:
                break
            self.discard_spectrograms(path)

    def get_spectrogram(self, file_path, n_fft, hop_length, window, calibration_profile=None):
        cached = self.get_file(file_path)
        length, channels = cached.frame.n_samples, cached.frame.n_channels
        if length < n_fft // 2:
            raise ValueError("WAV is too short for this STFT window; choose a smaller window")
        key = (n_fft, hop_length, window)
        if any(old[1:] != key for old in cached.spectrograms):
            self.discard_spectrograms(file_path)
        existing = self.get_cached_spectrogram(file_path, n_fft, hop_length, window, calibration_profile)
        if existing is not None:
            return existing
        estimated = (
            192 * 1024 * 1024
            + DISPLAY_EXPORT_RESERVE
            + sum(entry.identity[1] for entry in self._files.values())
            + self.retained_bytes * 2
            + length * channels * 32
            + ((length // hop_length) + 5) * channels * (n_fft // 2 + 1) * 56
        )
        if estimated > MAX_ESTIMATED_BYTES:
            raise ValueError("STFT exceeds prototype estimated memory budget; increase hop size")
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


def release_source(file_path: str) -> str:
    service.engine.discard(file_path)
    return "{}"


def prepare_export_json(raw: str) -> str:
    commands = json.loads(raw)
    if not isinstance(commands, list) or not 1 <= len(commands) <= MAX_SOURCES:
        raise ValueError("Select up to 8 sources for export")
    if any(not isinstance(command, dict) for command in commands):
        raise ValueError("Invalid export plan")
    commands = [validate_request({**command, "requestId": f"export-{index}"}) for index, command in enumerate(commands)]
    if any(command["cmd"] != "export-wav-loop" for command in commands):
        raise ValueError("Invalid export plan")
    for cached in list(service.engine._files.values()):
        service.engine.discard_spectrograms(cached.path)
    sizes = []
    for command in commands:
        cached = service.engine.get_file(command["filePath"])
        samples = cached.frame.n_samples
        start = max(0, int(command["startNorm"] * samples))
        end = min(samples, int(command["endNorm"] * samples))
        sizes.append(max(0, end - start) * cached.frame.n_channels * 2 + 44)
    estimated = (
        192 * 1024 * 1024
        + DISPLAY_EXPORT_RESERVE
        + sum(entry.identity[1] for entry in service.engine._files.values())
        + service.engine.retained_bytes * 2
        + sum(sizes) * 4
        + max(sizes) * 6
    )
    if estimated > MAX_ESTIMATED_BYTES or sum(sizes) > 32 * 1024 * 1024:
        raise ValueError("Export exceeds browser memory budget; choose a smaller region or fewer tracks")
    return "{}"


def dispatch_json(raw: str) -> str:
    command = validate_request(json.loads(raw))
    # Resolve settings at the boundary before expensive allocation.
    resolve_stft_params(service.engine.get_file(command["filePath"]).frame.n_samples, command.get("stftOptions"))
    return json.dumps(dispatch(command, service), allow_nan=False)
