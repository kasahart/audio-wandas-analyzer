from __future__ import annotations

import functools
import itertools
import json
import sys
import traceback
from collections.abc import Callable, Mapping
from pathlib import Path

import dask
import numpy as np
import soundfile as sf
import wandas as wd

from analysis_engine import AUDIO_CACHE_DTYPE, AnalysisEngine, CachedAnalysis
from analysis_service import AnalysisService, PairSpectrumResult, pair_overlap, pair_stft_params, recipe_inputs
from analyzer import resolve_stft_params, sample_range
from backend_errors import INTERNAL_ERROR, InputError, error_payload
from calibration_profile import source_channel_peaks
from command_dispatch import dispatch, validate_request

MIB = 1024 * 1024
# Browser session limits. This module is the single source; browser_limits() hands the
# user-facing subset to the TypeScript host so its pre-checks and the README agree.
MAX_INPUT_BYTES = 16 * MIB
MAX_DURATION_SECONDS = 30
MAX_CHANNELS = 2
MIN_SAMPLE_RATE_HZ = 1000
MAX_SAMPLE_RATE_HZ = 96000
MAX_TOTAL_INPUT_BYTES = 64 * MIB
MAX_SOURCES = 8
MAX_EXPORT_BYTES = 32 * MIB
MAX_TOTAL_DECODED_BYTES = 64 * MIB
MAX_ESTIMATED_BYTES = 512 * MIB
PYODIDE_BASELINE_BYTES = 192 * MIB
DISPLAY_EXPORT_RESERVE = 64 * MIB


def _mib(value: int) -> str:
    return f"{value // MIB} MiB"


def browser_limits() -> dict[str, int]:
    return {
        "maxInputBytes": MAX_INPUT_BYTES,
        "maxDurationSeconds": MAX_DURATION_SECONDS,
        "maxChannels": MAX_CHANNELS,
        "minSampleRateHz": MIN_SAMPLE_RATE_HZ,
        "maxSampleRateHz": MAX_SAMPLE_RATE_HZ,
        "maxSources": MAX_SOURCES,
        "maxTotalInputBytes": MAX_TOTAL_INPUT_BYTES,
        "maxExportBytes": MAX_EXPORT_BYTES,
    }


class BrowserEngine(AnalysisEngine):
    def __init__(self) -> None:
        super().__init__(128 * MIB)
        # Reloading a source under the same identity must not reuse pair spectra cached for the old bytes.
        self._loads = itertools.count(1)

    def load(self, source_id: str, payload: bytes) -> dict[str, object]:
        if not payload or len(payload) > MAX_INPUT_BYTES:
            raise InputError(f"Select a non-empty WAV up to {_mib(MAX_INPUT_BYTES)}")
        if payload[:4] != b"RIFF" or payload[8:12] != b"WAVE":
            raise InputError("This prototype supports RIFF WAV only")
        header = wd.inspect(payload, file_type=".wav")
        length, channels, rate = (int(header[key]) for key in ("frames", "channels", "samplerate"))
        if (
            not length >= 32
            or not 1 <= channels <= MAX_CHANNELS
            or not MIN_SAMPLE_RATE_HZ <= rate <= MAX_SAMPLE_RATE_HZ
            or length / rate > MAX_DURATION_SECONDS
        ):
            raise InputError(
                f"Prototype limits: 32+ samples, 1–{MAX_CHANNELS} channels, "
                f"{MIN_SAMPLE_RATE_HZ // 1000}–{MAX_SAMPLE_RATE_HZ // 1000} kHz, "
                f"up to {MAX_DURATION_SECONDS} seconds"
            )
        # Folder picks keep their relative path so the Web tree and the loaded track share one filePath.
        path = Path("/sources") / source_id
        if path.as_posix() != f"/sources/{source_id}" or ".." in path.parts:
            raise InputError("Invalid source identity")
        if not source_id.lower().endswith(".wav"):
            raise InputError("Invalid source identity")
        if path in self._files:
            raise InputError("Source identity is already loaded")
        frame_bytes = length * channels * AUDIO_CACHE_DTYPE.itemsize
        input_bytes = self.input_bytes + len(payload)
        decoded_bytes = sum(entry.frame_nbytes for entry in self._files.values()) + frame_bytes
        if len(self._files) >= MAX_SOURCES or input_bytes > MAX_TOTAL_INPUT_BYTES:
            raise InputError(
                f"Browser session limit: up to {MAX_SOURCES} WAV files / {_mib(MAX_TOTAL_INPUT_BYTES)} total input"
            )
        if decoded_bytes > MAX_TOTAL_DECODED_BYTES:
            raise InputError(f"Browser session exceeds {_mib(MAX_TOTAL_DECODED_BYTES)} decoded audio budget")
        if self.estimated_bytes(len(payload) * 2 + frame_bytes * 8) > MAX_ESTIMATED_BYTES:
            raise InputError("Loading exceeds browser estimated memory budget; remove another track")
        frame = wd.read(payload, file_type=".wav", source_name=source_id).astype(AUDIO_CACHE_DTYPE).cache()
        if not np.isfinite(frame.data).all():
            raise InputError("WAV contains non-finite samples")
        self._files[path] = CachedAnalysis(
            path=path,
            frame=frame,
            identity=(next(self._loads), len(payload)),
            frame_nbytes=int(np.prod(frame.shape)) * AUDIO_CACHE_DTYPE.itemsize,
            source_peaks=source_channel_peaks(frame),
        )
        return {"filePath": str(path)}

    def is_loaded(self, file_path: str | Path) -> bool:
        return Path(file_path) in self._files

    @property
    def input_bytes(self) -> int:
        return sum(entry.identity[1] for entry in self._files.values())

    def estimated_bytes(self, working_bytes: int) -> int:
        """Estimate peak Worker memory for an operation that needs ``working_bytes`` on top of the session."""
        return (
            PYODIDE_BASELINE_BYTES + DISPLAY_EXPORT_RESERVE + self.input_bytes + self.retained_bytes * 2 + working_bytes
        )

    def discard_all_spectrograms(self) -> None:
        for path in list(self._files):
            self.discard_spectrograms(path)

    def get_file(self, file_path: str | Path) -> CachedAnalysis:
        path = Path(file_path)
        cached = self._files.get(path)
        if cached is None:
            raise InputError("Source is no longer selected")
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
            raise InputError("WAV is too short for this STFT window; choose a smaller window")
        key = (n_fft, hop_length, window)
        if any(old[1:] != key for old in cached.spectrograms):
            self.discard_spectrograms(file_path)
        existing = self.get_cached_spectrogram(file_path, n_fft, hop_length, window, calibration_profile)
        if existing is not None:
            return existing
        working = length * channels * 32 + ((length // hop_length) + 5) * channels * (n_fft // 2 + 1) * 56
        if self.estimated_bytes(working) > MAX_ESTIMATED_BYTES:
            raise InputError("STFT exceeds prototype estimated memory budget; lower the overlap")
        return super().get_spectrogram(file_path, n_fft, hop_length, window, calibration_profile)


class BrowserService(AnalysisService):
    def release_track_detail(self, file_path: str | Path) -> dict[str, object]:
        self.engine.discard_spectrograms(file_path)
        return {}

    def pair_spectrum(
        self,
        reference: Mapping[str, object],
        responses: list[Mapping[str, object]],
        *,
        start_seconds: float | None = None,
        end_seconds: float | None = None,
        stft_options: Mapping[str, object] | None = None,
        **options: object,
    ) -> PairSpectrumResult:
        # Peak memory follows the two-channel STFT and its cross spectra, measured near 64 bytes per bin.
        x = self._pair_source(reference)
        n_fft, hop_length, _ = pair_stft_params(x.frame.n_samples, stft_options)
        seconds = max(
            (
                end - start
                for start, end in (pair_overlap(x, self._pair_source(y), start_seconds, end_seconds) for y in responses)
            ),
            default=0.0,
        )
        length = max(0, int(seconds * x.frame.sampling_rate))
        working = ((length // hop_length) + 5) * 2 * (n_fft // 2 + 1) * 64
        if self.engine.estimated_bytes(working) > MAX_ESTIMATED_BYTES:
            raise InputError(
                "Pair spectrum exceeds browser estimated memory budget; shorten the range or lower the overlap"
            )
        return super().pair_spectrum(
            reference,
            responses,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            stft_options=stft_options,
            **options,
        )

    def run_recipe(
        self,
        recipe: Mapping[str, object],
        *,
        recipe_path: str | None = None,
        input_contexts: Mapping[str, object] | None = None,
    ) -> dict[str, object]:
        # Recipes allocate freely; drop recomputable detail so selected sources keep their budget.
        self.engine.discard_all_spectrograms()
        for item in recipe_inputs(recipe):
            file = item["file"]
            resolved = Path(file)
            if not resolved.is_absolute():
                resolved = (Path(recipe_path).parent if recipe_path else Path.cwd()) / resolved
            if not self.engine.is_loaded(resolved):
                raise InputError(f"Recipe input {file!r} is not a loaded source")
        return super().run_recipe(recipe, recipe_path=recipe_path, input_contexts=input_contexts)


def create_service() -> AnalysisService:
    dask.config.set(scheduler="synchronous")
    return BrowserService(BrowserEngine())


service = create_service()


def _json_reply(function: Callable[..., str]) -> Callable[..., str]:
    """Worker entry points answer failures with the same ``{"error": {code, message}}`` as the desktop backend."""

    @functools.wraps(function)
    def reply(*args: object) -> str:
        try:
            return function(*args)
        except Exception as error:
            payload = error_payload(error)
            if payload["code"] == INTERNAL_ERROR:
                traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": payload})

    return reply


@_json_reply
def load_source(source_id: str, payload: object) -> str:
    try:
        return json.dumps(service.engine.load(source_id, bytes(payload)))
    except sf.LibsndfileError as error:
        raise InputError("Unable to read WAV: invalid or unsupported WAV data") from error


@_json_reply
def browser_limits_json() -> str:
    return json.dumps(browser_limits())


@_json_reply
def release_source(file_path: str) -> str:
    service.engine.discard(file_path)
    return "{}"


@_json_reply
def release_all_sources() -> str:
    service.engine.clear()
    return "{}"


@_json_reply
def prepare_export_json(raw: str) -> str:
    commands = json.loads(raw)
    if not isinstance(commands, list) or not 1 <= len(commands) <= MAX_SOURCES:
        raise InputError(f"Select up to {MAX_SOURCES} sources for export")
    if any(not isinstance(command, dict) for command in commands):
        raise InputError("Invalid export plan")
    commands = [validate_request({**command, "requestId": f"export-{index}"}) for index, command in enumerate(commands)]
    if any(command["cmd"] != "export-wav-loop" for command in commands):
        raise InputError("Invalid export plan")
    engine = service.engine
    engine.discard_all_spectrograms()
    sizes = []
    for command in commands:
        cached = engine.get_file(command["filePath"])
        start, end = sample_range(command["startNorm"], command["endNorm"], cached.frame.n_samples)
        sizes.append(max(0, end - start) * cached.frame.n_channels * 2 + 44)
    estimated = engine.estimated_bytes(sum(sizes) * 4 + max(sizes) * 6)
    if estimated > MAX_ESTIMATED_BYTES or sum(sizes) > MAX_EXPORT_BYTES:
        raise InputError("Export exceeds browser memory budget; choose a smaller region or fewer tracks")
    return "{}"


@_json_reply
def dispatch_json(raw: str) -> str:
    command = validate_request(json.loads(raw))
    # Resolve settings at the boundary before expensive allocation.
    if "filePath" in command:
        resolve_stft_params(service.engine.get_file(command["filePath"]).frame.n_samples, command.get("stftOptions"))
    return json.dumps(dispatch(command, service), allow_nan=False)
