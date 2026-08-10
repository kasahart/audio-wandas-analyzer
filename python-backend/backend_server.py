"""Persistent Python backend server for the Audio Wandas Analyzer.

Newline-delimited JSON IPC over stdin/stdout. Prints {"type":"ready"} once
wandas is loaded, then reads commands forever.

Analysis commands may include a versioned ``calibrationProfile``. The server
validates that profile against the current channel order, applies it through
Wandas, and echoes the resolved calibration signature. WAV export always uses
the original full-scale source frame.
"""

from __future__ import annotations

import base64
import io as _io
import json
import os
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from analysis_engine import AnalysisEngine
from analyzer import (
    SPECTROGRAM_FREQUENCY_BIN_LIMIT,
    _build_waveform_envelope,
    _channels_first,
    _resample_frequency_bins,
    _resolve_stft_params,
    analyze_from_frame,
)
from calibration_profile import level_scale_metadata, measurement_metadata

_PERF_ENABLED = os.environ.get("AWA_PERF_LOG", "1") != "0"


def _perf(phase: str, started: float, **extra: object) -> None:
    if not _PERF_ENABLED:
        return
    ms = (time.perf_counter() - started) * 1000.0
    parts = [f"phase={phase}", f"ms={ms:.2f}"]
    parts.extend(f"{k}={v}" for k, v in extra.items())
    print("[perf] " + " ".join(parts), file=sys.stderr, flush=True)


_engine = AnalysisEngine()


def _stft_options_from_payload(payload: dict) -> dict | None:
    raw = payload.get("stftOptions")
    if not raw:
        return None
    return {
        "n_fft": int(raw["nFft"]),
        "hop_size": int(raw["hopSize"]),
        "window": str(raw.get("window", "hann")),
    }


def _calibration_profile_from_payload(payload: dict) -> object:
    return payload.get("calibrationProfile")


def _analysis_revision(payload: dict) -> int:
    raw = payload.get("analysisRevision", 0)
    if isinstance(raw, bool):
        raise TypeError("analysisRevision must be an integer")
    return int(raw)


def handle_analyze(cmd: dict) -> dict:
    cached, analysis_frame, resolved = _engine.get_analysis(
        str(cmd["filePath"]),
        _calibration_profile_from_payload(cmd),
    )
    result = analyze_from_frame(
        analysis_frame,
        cached.path,
        peak_count=int(cmd.get("peakCount", 5)),
        raw_frame=cached.frame,
        calibration_profile=resolved,
        stft_options=_stft_options_from_payload(cmd),
        include_spectrogram=False,
    )
    result["analysisRevision"] = _analysis_revision(cmd)
    return result


def handle_track_detail(cmd: dict) -> dict:
    calibration_profile = _calibration_profile_from_payload(cmd)
    cached, analysis_frame, resolved = _engine.get_analysis(str(cmd["filePath"]), calibration_profile)
    stft_options = _stft_options_from_payload(cmd)
    n_fft, hop_length, window = _resolve_stft_params(analysis_frame.n_samples, stft_options)
    spectrogram = _engine.get_spectrogram(
        cached.path,
        n_fft,
        hop_length,
        window,
        calibration_profile,
    )
    result = analyze_from_frame(
        analysis_frame,
        cached.path,
        peak_count=int(cmd.get("peakCount", 5)),
        raw_frame=cached.frame,
        calibration_profile=resolved,
        stft_options=stft_options,
        spectrogram_frame=spectrogram,
        include_spectrogram=True,
    )
    return {
        "trackIndex": int(cmd.get("trackIndex", -1)),
        "analysisId": cmd.get("analysisId"),
        "analysisRevision": _analysis_revision(cmd),
        "settingsSignature": cmd.get("settingsSignature"),
        "calibrationSignature": resolved.signature,
        "filePath": str(cached.path),
        "channels": result["channels"],
    }


def _spectrum_slice_values(
    file_path: str | Path,
    cursor_norm: float,
    channel_index: int,
    stft_options: dict | None,
    calibration_profile: object,
) -> dict[str, object]:
    cached, analysis_frame, resolved = _engine.get_analysis(file_path, calibration_profile)
    window_size, hop_size, window_name = _resolve_stft_params(analysis_frame.n_samples, stft_options)
    clipped_norm = max(0.0, min(1.0, cursor_norm))
    if channel_index < 0 or channel_index >= analysis_frame.n_channels:
        raise ValueError(f"channelIndex out of range: {channel_index}")
    spectrogram = _engine.get_cached_spectrogram(
        cached.path,
        window_size,
        hop_size,
        window_name,
        calibration_profile,
    )
    if spectrogram is not None:
        time_bins = int(spectrogram.n_frames)
        if time_bins <= 0:
            raise ValueError("no spectrogram available for spectrum slice")
        time_index = min(int(np.floor(clipped_norm * time_bins)), time_bins - 1)
        spectrum = spectrogram.get_frame_at(time_index)
        max_frequency_hz = float(spectrogram.freqs[-1])
    else:
        center_sample = min(int(clipped_norm * analysis_frame.n_samples), analysis_frame.n_samples - 1)
        start_sample = max(0, center_sample - window_size // 2)
        end_sample = min(analysis_frame.n_samples, start_sample + window_size)
        start_sample = max(0, end_sample - window_size)
        spectrum = analysis_frame[:, start_sample:end_sample].fft(n_fft=window_size, window=window_name)
        max_frequency_hz = float(spectrum.freqs[-1])
    values = np.asarray(spectrum.dB, dtype=np.float64)
    if values.ndim == 2:
        values = values[channel_index]
    values_2d = _resample_frequency_bins(values.reshape(1, -1), SPECTROGRAM_FREQUENCY_BIN_LIMIT)
    row = values_2d[0]
    measurement = measurement_metadata(resolved.channels[channel_index])
    return {
        "values": row.tolist(),
        "frequencyBins": int(row.shape[0]),
        "maxFrequencyHz": max_frequency_hz,
        "minDb": float(np.min(row)),
        "maxDb": float(np.max(row)),
        "calibrationSignature": resolved.signature,
        **level_scale_metadata(measurement, "Spectrum amplitude level"),
    }


def handle_spectrum_slice(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    cursor_norm = float(cmd.get("cursorNorm", cmd.get("trackLocalNorm", 0.0)))
    channel_index = int(cmd.get("channelIndex", 0))
    slice_data = _spectrum_slice_values(
        file_path,
        cursor_norm,
        channel_index,
        _stft_options_from_payload(cmd),
        _calibration_profile_from_payload(cmd),
    )
    return {
        "trackIndex": int(cmd.get("trackIndex", -1)),
        "channelIndex": channel_index,
        "analysisId": cmd.get("analysisId"),
        "analysisRevision": _analysis_revision(cmd),
        "settingsSignature": cmd.get("settingsSignature"),
        "filePath": str(Path(file_path).expanduser().resolve()),
        **slice_data,
    }


def handle_range(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    start_norm = float(cmd["startNorm"])
    end_norm = float(cmd["endNorm"])
    point_count = int(cmd.get("points", 2000))

    cached, analysis_frame, resolved = _engine.get_analysis(
        file_path,
        _calibration_profile_from_payload(cmd),
    )
    sample_count = analysis_frame.n_samples
    start_idx = max(0, int(start_norm * sample_count))
    end_idx = min(sample_count, int(end_norm * sample_count))

    channels: list[dict] = []
    if end_idx > start_idx:
        range_frame = analysis_frame[:, start_idx:end_idx]
        data = _channels_first(range_frame.data, analysis_frame.n_channels, end_idx - start_idx)
        for channel_index in range(analysis_frame.n_channels):
            channels.append(
                _build_waveform_envelope(
                    data[channel_index],
                    point_count,
                    start_sample=start_idx,
                    total_samples=sample_count,
                )
            )

    return {
        "startNorm": start_norm,
        "endNorm": end_norm,
        "analysisRevision": _analysis_revision(cmd),
        "calibrationSignature": resolved.signature,
        "filePath": str(cached.path),
        "channels": channels,
    }


def handle_export_wav_loop(cmd: dict) -> dict:
    file_path = str(cmd["filePath"])
    start_norm = float(cmd["startNorm"])
    end_norm = float(cmd["endNorm"])

    cached = _engine.get_file(file_path)
    sample_rate = int(cached.frame.sampling_rate)
    start_sample = max(0, int(start_norm * cached.frame.n_samples))
    end_sample = min(cached.frame.n_samples, int(end_norm * cached.frame.n_samples))
    n_frames = end_sample - start_sample

    if n_frames <= 0:
        raise ValueError(
            f"Loop region produces 0 frames (startNorm={start_norm}, endNorm={end_norm}, "
            f"total_frames={cached.frame.n_samples}). Ensure startNorm < endNorm and the file is not empty."
        )

    range_frame = cached.frame[:, start_sample:end_sample]
    data = _channels_first(range_frame.data, cached.frame.n_channels, n_frames).T

    buf = _io.BytesIO()
    sf.write(buf, data, sample_rate, format="WAV", subtype="PCM_16")
    wav_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return {"wavBase64": wav_b64, "sampleRate": sample_rate}


def handle_release_track_detail(cmd: dict) -> dict:
    _engine.discard_spectrograms(str(cmd["filePath"]))
    return {}


COMMANDS: dict[str, Callable[[dict], dict]] = {
    "analyze": handle_analyze,
    "range": handle_range,
    "track-detail": handle_track_detail,
    "release-track-detail": handle_release_track_detail,
    "spectrum-slice": handle_spectrum_slice,
    "export-wav-loop": handle_export_wav_loop,
}

_HEARTBEAT_INTERVAL: float = 5.0


def _heartbeat_loop() -> None:
    while True:
        time.sleep(_HEARTBEAT_INTERVAL)
        print(json.dumps({"type": "heartbeat", "ts": time.time()}), flush=True)


def main() -> None:
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    print(json.dumps({"type": "ready"}), flush=True)
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id = ""
        try:
            cmd: dict[str, Any] = json.loads(line)
            request_id = str(cmd.get("requestId", ""))
            name = cmd.get("cmd")
            handler = COMMANDS.get(name)
            if handler is None:
                raise ValueError(f"unknown cmd: {name!r}")
            started = time.perf_counter()
            result = handler(cmd)
            _perf(f"cmd_{name}", started, file=Path(str(cmd.get("filePath", ""))).name)
            result["requestId"] = request_id
            print(json.dumps(result, ensure_ascii=False), flush=True)
        except Exception as exc:
            print(json.dumps({"requestId": request_id, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
