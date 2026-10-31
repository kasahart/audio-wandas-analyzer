from __future__ import annotations

import base64
import io
import json
import math
import os
import struct
import subprocess
import sys
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

import backend_errors
from analysis_engine import AnalysisEngine, CachedAnalysis
from analysis_service import AnalysisService
from backend_server import dispatch, main, validate_request
from protocol_schema import DEFINITIONS, first_violation, result_violation

ROOT = Path(__file__).parent
PROTOCOL_FIXTURES = json.loads(
    (ROOT.parent / "src" / "test" / "fixtures" / "backendProtocol.json").read_text(encoding="utf-8")
)


def _dispatch(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return dispatch(command, service or AnalysisService(AnalysisEngine(cache_limit_bytes=64 * 1024 * 1024)))


def handle_analyze(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return _dispatch({"cmd": "analyze", **command}, service)


def handle_track_detail(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return _dispatch(
        {"cmd": "track-detail", "trackIndex": -1, "analysisId": "a1", "settingsSignature": "sig1", **command}, service
    )


def handle_spectrum_slice(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return _dispatch(
        {"cmd": "spectrum-slice", "trackIndex": -1, "analysisId": "a1", "settingsSignature": "sig1", **command}, service
    )


def handle_range(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return _dispatch({"cmd": "range", **command}, service)


def handle_export_wav_loop(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return _dispatch({"cmd": "export-wav-loop", **command}, service)


def handle_release_track_detail(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return _dispatch({"cmd": "release-track-detail", **command}, service)


def _write_sine_wav(path: Path, freq_hz: float = 440.0, seconds: float = 0.5, sr: int = 16000) -> None:
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * freq_hz * t) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())


def _write_sine_flac(path: Path, freq_hz: float = 440.0, seconds: float = 0.5, sr: int = 16000) -> None:
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * freq_hz * t)).astype(np.float32)
    sf.write(path, samples, sr, format="FLAC")


def _replies(out: str) -> list[dict[str, Any]]:
    """The request replies on ``out``, without the notifications around them."""
    return [message for message in map(json.loads, out.splitlines()) if "type" not in message]


class _ServerHandle:
    def __init__(self, proc: subprocess.Popen[str]) -> None:
        self.proc = proc
        self._next_id = 0

    def request(self, payload: dict, timeout: float = 30.0) -> dict:
        self._next_id += 1
        payload = {**payload, "requestId": f"r{self._next_id}"}
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                continue
            msg = json.loads(line)
            if "type" in msg:
                continue
            if msg.get("requestId") == payload["requestId"]:
                return msg
        raise TimeoutError(f"no response for {payload['requestId']}")

    def close(self) -> None:
        try:
            if self.proc.stdin is not None:
                self.proc.stdin.close()
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


@pytest.fixture(autouse=True)
def _no_heartbeat_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    # An in-process main() would otherwise leave a daemon thread writing heartbeats to stdout for the session.
    import backend_server

    monkeypatch.setattr(backend_server, "_start_heartbeat", lambda: None)


@pytest.fixture
def server() -> _ServerHandle:
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "backend_server.py")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**os.environ, "AWA_CACHE_MB": "64", "AWA_PERF_LOG": "0"},
    )
    assert proc.stdout is not None
    deadline = time.monotonic() + 30.0
    ready = False
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if not line:
            continue
        msg = json.loads(line)
        if msg.get("type") == "ready":
            ready = True
            break
    if not ready:
        proc.kill()
        raise TimeoutError("server did not become ready")
    handle = _ServerHandle(proc)
    yield handle
    handle.close()


def test_analyze_round_trip(server: _ServerHandle, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    resp = server.request({"cmd": "analyze", "filePath": str(wav)})
    assert "error" not in resp, resp
    assert result_violation("analyze", resp) is None, "the real analyze result must satisfy the shared schema"
    assert resp["fileName"] == "tone.wav"
    assert resp["channelCount"] == 1
    assert len(resp["channels"]) == 1
    assert resp["channels"][0]["spectrogram"] is None


def test_non_ascii_paths_survive_a_non_utf8_locale(tmp_path: Path) -> None:
    wav = tmp_path / "録音テイク.wav"
    _write_sine_wav(wav)
    # PYTHONIOENCODING stands in for a Windows code page such as cp932: the stdio streams start out in it.
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "backend_server.py")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env={**os.environ, "PYTHONIOENCODING": "latin-1", "AWA_PERF_LOG": "0"},
    )
    assert proc.stdin is not None and proc.stdout is not None
    try:
        request = json.dumps({"cmd": "analyze", "filePath": str(wav), "requestId": "r1"}, ensure_ascii=False)
        proc.stdin.write((request + "\n").encode("utf-8"))
        proc.stdin.flush()
        # stdin stays open until the reply: at EOF the backend drops what it has not answered.
        reply = next(
            message
            for message in (json.loads(line.decode("utf-8")) for line in proc.stdout)
            if message.get("requestId") == "r1" and "type" not in message
        )
    finally:
        proc.stdin.close()
        proc.wait(timeout=60)
    assert "error" not in reply, reply
    assert reply["fileName"] == "録音テイク.wav"


def test_analyze_round_trip_accepts_flac_from_supported_ui_formats(server: _ServerHandle, tmp_path: Path) -> None:
    flac = tmp_path / "tone.flac"
    _write_sine_flac(flac)
    resp = server.request({"cmd": "analyze", "filePath": str(flac)})
    assert "error" not in resp, resp
    assert resp["fileName"] == "tone.flac"
    assert resp["channelCount"] == 1
    assert len(resp["channels"]) == 1
    assert resp["channels"][0]["spectrogram"] is None


def test_analyze_uses_engine_frame_under_resolved_path(monkeypatch, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    reads = []
    original_read = wd.read

    def counted_read(path: Path, **kwargs: Any) -> wd.ChannelFrame:
        reads.append(path)
        return original_read(path, **kwargs)

    monkeypatch.setattr(wd, "read", counted_read)

    resp = handle_analyze(
        {"filePath": str(wav.parent / "." / wav.name)},
        AnalysisService(engine),
    )

    assert resp["filePath"] == str(wav.resolve())
    assert list(engine._files) == [wav.resolve()]
    assert reads == [wav.resolve()]
    assert resp["channels"][0]["peakAbsolute"] == pytest.approx(0.5, abs=0.01)


def test_track_detail_returns_spectrogram_for_requested_file(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)

    resp = handle_track_detail(
        {
            "filePath": str(wav),
            "trackIndex": 2,
            "analysisId": "a1",
            "settingsSignature": "sig1",
            "stftOptions": {"nFft": 256, "overlapPercent": 50, "window": "hann"},
        }
    )

    assert result_violation("track-detail", resp) is None
    assert resp["trackIndex"] == 2
    assert resp["analysisId"] == "a1"
    assert resp["settingsSignature"] == "sig1"
    spec = resp["channels"][0]["spectrogram"]
    assert spec["windowSize"] == 256
    assert spec["hopSize"] == 128
    assert spec["timeBins"] > 0
    assert spec["frequencyBins"] > 0


def test_handle_range_uses_same_pcm_scale_as_analysis(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav, seconds=1.0)

    overview = handle_analyze({"filePath": str(wav)})["channels"][0]["waveform"]
    response = handle_range({"filePath": str(wav), "startNorm": 0.25, "endNorm": 0.75, "points": 128})
    waveform = response["channels"][0]

    assert waveform["absolutePeak"] == pytest.approx(overview["absolutePeak"], rel=0.05)
    assert waveform["absolutePeak"] == pytest.approx(0.5, abs=0.01)
    assert min(waveform["minT"]) >= 0.24
    assert max(waveform["maxT"]) <= 0.76


def test_handle_range_does_not_reread_cached_audio(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav, seconds=2.0)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    reads = 0
    original_read = wd.read

    def counted_read(path: Path, **kwargs: Any) -> wd.ChannelFrame:
        nonlocal reads
        reads += 1
        return original_read(path, **kwargs)

    monkeypatch.setattr(wd, "read", counted_read)
    service = AnalysisService(engine)
    service.analyze(wav)
    assert reads == 1
    result = handle_range(
        {"filePath": str(wav), "startNorm": 0.25, "endNorm": 0.3, "points": 128},
        service,
    )

    assert result["channels"]
    assert reads == 1


def test_handle_range_matches_non_wav_overview_scale(tmp_path: Path) -> None:
    audio = tmp_path / "tone.flac"
    _write_sine_flac(audio, seconds=1.0)
    overview = handle_analyze({"filePath": str(audio)})["channels"][0]["waveform"]
    ranged = handle_range({"filePath": str(audio), "startNorm": 0.25, "endNorm": 0.75, "points": 128})
    assert ranged["channels"][0]["absolutePeak"] == pytest.approx(overview["absolutePeak"], rel=0.05)


def test_handle_range_matches_unsigned_8_bit_wav_overview_scale(tmp_path: Path) -> None:
    audio = tmp_path / "tone-u8.wav"
    sample_rate = 8000
    time_axis = np.arange(sample_rate, dtype=np.float64) / sample_rate
    samples = np.rint(128 + 64 * np.sin(2 * math.pi * 440 * time_axis)).astype(np.uint8)
    with wave.open(str(audio), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(1)
        output.setframerate(sample_rate)
        output.writeframes(samples.tobytes())

    overview = handle_analyze({"filePath": str(audio)})["channels"][0]["waveform"]
    ranged = handle_range({"filePath": str(audio), "startNorm": 0.25, "endNorm": 0.75, "points": 128})
    assert ranged["channels"][0]["absolutePeak"] == pytest.approx(overview["absolutePeak"], rel=0.01)


def test_spectrum_slice_matches_track_detail_shape_and_peak(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    opts = {"nFft": 256, "overlapPercent": 50, "window": "hann"}
    detail = handle_track_detail({"filePath": str(wav), "trackIndex": 0, "stftOptions": opts})
    spec = detail["channels"][0]["spectrogram"]

    cursor_norm = 0.5
    resp = handle_spectrum_slice(
        {
            "filePath": str(wav),
            "trackIndex": 0,
            "cursorNorm": cursor_norm,
            "stftOptions": opts,
        }
    )
    time_index = min(spec["timeBins"] - 1, int(np.floor(cursor_norm * spec["timeBins"])))
    expected_row = spec["values"][time_index]

    assert result_violation("spectrum-slice", resp) is None
    assert resp["trackIndex"] == 0
    assert resp["frequencyBins"] == spec["frequencyBins"]
    assert resp["maxFrequencyHz"] == spec["maxFrequencyHz"]
    channel = resp["channels"][0]
    assert int(np.argmax(channel["values"])) == int(np.argmax(expected_row))
    assert abs(float(channel["maxDb"]) - float(np.max(expected_row))) < 1.0


def test_track_detail_spectrogram_bins_stay_aligned_with_time(tmp_path: Path) -> None:
    sr, seconds, burst_start, burst_end = 16000, 10.0, 8.82, 8.93
    samples = np.zeros(int(sr * seconds), dtype=np.int16)
    t = np.arange(int(burst_start * sr), int(burst_end * sr))
    samples[t] = (0.5 * np.sin(2 * math.pi * 1000.0 * t / sr) * 32767).astype(np.int16)
    wav = tmp_path / "burst.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())
    opts = {"nFft": 256, "overlapPercent": 75, "window": "hann"}
    spec = handle_track_detail({"filePath": str(wav), "trackIndex": 0, "stftOptions": opts})["channels"][0][
        "spectrogram"
    ]
    loudest = np.asarray(spec["values"]).max(axis=1)
    loud_bins = np.nonzero(loudest > loudest.min() + 40)[0]
    bin_seconds = seconds / spec["timeBins"]

    # Many more STFT frames than display bins: every display bin must still sit at its own time.
    assert spec["timeBins"] == 720
    assert loud_bins[0] * bin_seconds == pytest.approx(burst_start, abs=2 * bin_seconds)
    assert (loud_bins[-1] + 1) * bin_seconds == pytest.approx(burst_end, abs=2 * bin_seconds)


@pytest.mark.parametrize(("cursor_norm", "expected_start"), [(0.0, 0), (1.0, 8000 - 256)])
def test_spectrum_slice_window_stays_inside_the_file_at_the_ends(
    tmp_path: Path, cursor_norm: float, expected_start: int
) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    opts = {"nFft": 256, "overlapPercent": 50, "window": "hann"}
    resp = handle_spectrum_slice({"filePath": str(wav), "cursorNorm": cursor_norm, "stftOptions": opts})
    assert resp["windowStartNorm"] * 8000 == pytest.approx(expected_start)
    assert resp["windowEndNorm"] * 8000 == pytest.approx(expected_start + 256)


@pytest.mark.parametrize("cached_detail", [False, True])
def test_spectrum_slice_reports_the_transformed_window(tmp_path: Path, cached_detail: bool) -> None:
    sample_count, impulse_at = 8000, 3200
    samples = np.zeros(sample_count, dtype=np.int16)
    samples[impulse_at] = 16000
    wav = tmp_path / "impulse.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(samples.tobytes())
    opts = {"nFft": 256, "overlapPercent": 50, "window": "boxcar"}
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=10_000_000))
    if cached_detail:
        handle_track_detail({"filePath": str(wav), "trackIndex": 0, "stftOptions": opts}, service)

    def slice_at(sample: int) -> dict:
        command = {"filePath": str(wav), "trackIndex": 0, "cursorNorm": sample / sample_count, "stftOptions": opts}
        resp = handle_spectrum_slice(command, service)
        assert result_violation("spectrum-slice", resp) is None
        assert resp["window"] == "boxcar"
        assert (resp["windowEndNorm"] - resp["windowStartNorm"]) * sample_count == pytest.approx(256)
        return resp

    def covers_impulse(resp: dict) -> bool:
        return resp["windowStartNorm"] * sample_count <= impulse_at < resp["windowEndNorm"] * sample_count

    # The reported span must be the samples the FFT saw: the impulse shows up exactly when the span covers it.
    for cursor_sample in (2900, 3000, 3200, 3400, 6000):
        resp = slice_at(cursor_sample)
        heard = float(resp["channels"][0]["maxDb"]) > -100.0
        assert heard == covers_impulse(resp)
    assert covers_impulse(slice_at(impulse_at))


def test_spectrum_slice_window_includes_fft_padding_past_a_short_file(tmp_path: Path) -> None:
    wav = tmp_path / "short.wav"
    _write_sine_wav(wav, seconds=200 / 16000)
    resp = handle_spectrum_slice(
        {"filePath": str(wav), "cursorNorm": 0.5, "stftOptions": {"nFft": 256, "overlapPercent": 50, "window": "hann"}}
    )
    assert resp["windowStartNorm"] == 0
    assert resp["windowEndNorm"] * 200 == pytest.approx(256)


@pytest.mark.parametrize("cursor_norm", [-1.0, 0.0, 1.0, 2.0])
def test_spectrum_slice_clamps_cursor_to_cached_stft_bounds(tmp_path: Path, cursor_norm: float) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    response = handle_spectrum_slice(
        {
            "filePath": str(wav),
            "cursorNorm": cursor_norm,
            "stftOptions": {"nFft": 256, "overlapPercent": 50, "window": "hann"},
        }
    )
    assert response["frequencyBins"] > 0
    assert all(np.isfinite(response["channels"][0]["values"]))


def test_spectrum_slice_does_not_build_track_detail(monkeypatch, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=10_000_000))

    def fail_track_detail(*_args: object, **_kwargs: object) -> dict:
        raise AssertionError("spectrum slice must not compute full track detail")

    monkeypatch.setattr(service, "track_detail", fail_track_detail)
    resp = handle_spectrum_slice(
        {
            "filePath": str(wav),
            "trackIndex": 0,
            "cursorNorm": 0.5,
            "stftOptions": {"nFft": 256, "overlapPercent": 50, "window": "hann"},
        },
        service,
    )

    assert resp["frequencyBins"] > 0
    assert len(resp["channels"][0]["values"]) == resp["frequencyBins"]


@pytest.mark.parametrize("cached_detail", [False, True])
def test_spectrum_slice_window_steps_with_the_stft_frames(tmp_path: Path, cached_detail: bool) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    n_samples = 8000
    opts = {"nFft": 256, "overlapPercent": 0, "window": "hann"}
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=10_000_000))
    if cached_detail:
        handle_track_detail({"filePath": str(wav), "trackIndex": 0, "stftOptions": opts}, service)

    # Cursors between two frame centres get the nearer frame's window, so nearby cursors share one window.
    for cursor_sample, center in ((4000, 4096), (4001, 4096), (4050, 4096), (4500, 4608)):
        command = {"filePath": str(wav), "cursorNorm": cursor_sample / n_samples, "stftOptions": opts}
        resp = handle_spectrum_slice(command, service)
        assert resp["windowStartNorm"] * n_samples == pytest.approx(center - 128)
        assert resp["windowEndNorm"] * n_samples == pytest.approx(center + 128)
        assert handle_spectrum_slice(command, service)["channels"] == resp["channels"]


@pytest.mark.parametrize(
    ("bands_per_octave", "sr", "first", "last", "peak"),
    [
        (1, 8000, 31.5, 2000.0, 1000.0),
        (3, 8000, 20.0, 3150.0, 1000.0),
        (1, 16000, 31.5, 4000.0, 1000.0),
        (3, 16000, 20.0, 6300.0, 1000.0),
        (1, 44100, 31.5, 8000.0, 1000.0),
        (3, 48000, 20.0, 20000.0, 1000.0),
    ],
)
def test_spectrum_slice_octave_bands_level_the_cursor_samples(
    tmp_path: Path, bands_per_octave: int, sr: int, first: float, last: float, peak: float
) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav, freq_hz=1000.0, sr=sr)
    opts = {"nFft": 4096, "overlapPercent": 75, "window": "hann"}
    command = {"filePath": str(wav), "cursorNorm": 0.5, "stftOptions": opts, "bandsPerOctave": bands_per_octave}
    service = AnalysisService(AnalysisEngine(cache_limit_bytes=10_000_000))
    resp = handle_spectrum_slice(command, service)

    assert result_violation("spectrum-slice", resp) is None
    centers = resp["bandCentersHz"]
    assert (centers[0], centers[-1]) == (first, last)
    assert resp["frequencyBins"] == len(centers) == len(resp["channels"][0]["values"])
    # Every sample rate shares one axis, and the band filters see the samples unwindowed.
    # The lowest band's lower edge: 31.5 Hz octave, or the 20 Hz third octave (wandas 0.10 computes it).
    assert resp["minFrequencyHz"] == pytest.approx(22.39 if bands_per_octave == 1 else 17.78, abs=0.01)
    assert resp["maxFrequencyHz"] == pytest.approx(22387.2, abs=0.1)
    assert resp["window"] == "boxcar"
    assert resp["channels"][0]["axisLabel"].startswith("Band level")
    values = resp["channels"][0]["values"]
    assert centers[int(np.argmax(values))] == peak
    # A 0.5 amplitude sine has an RMS level of 20*log10(0.5/sqrt(2)) dBFS.
    assert max(values) == pytest.approx(-9.03, abs=0.5)
    assert handle_spectrum_slice(command, service)["channels"] == resp["channels"]
    fft = handle_spectrum_slice({key: value for key, value in command.items() if key != "bandsPerOctave"}, service)
    assert "bandCentersHz" not in fft and fft["window"] == "hann"


@pytest.mark.parametrize(("bands_per_octave", "freq_hz"), [(1, 31.5), (3, 25.0)])
def test_spectrum_slice_octave_bands_lengthen_short_windows_for_the_lowest_band(
    tmp_path: Path, bands_per_octave: int, freq_hz: float
) -> None:
    wav = tmp_path / "low.wav"
    sr = 48000
    _write_sine_wav(wav, freq_hz=freq_hz, seconds=4.0, sr=sr)
    opts = {"nFft": 1024, "overlapPercent": 75, "window": "hann"}
    command = {"filePath": str(wav), "cursorNorm": 0.5, "stftOptions": opts, "bandsPerOctave": bands_per_octave}
    resp = handle_spectrum_slice(command, AnalysisService(AnalysisEngine(cache_limit_bytes=10_000_000)))

    # 1024 samples are 21 ms, under one period of the lowest band, so the slice grows to fit it.
    span_s = (resp["windowEndNorm"] - resp["windowStartNorm"]) * 4.0
    assert span_s > 0.4
    assert resp["windowStartNorm"] + resp["windowEndNorm"] == pytest.approx(1.0, abs=1e-4)
    values = resp["channels"][0]["values"]
    assert resp["bandCentersHz"][int(np.argmax(values))] == freq_hz
    assert max(values) == pytest.approx(-9.03, abs=0.6)


@pytest.mark.parametrize("bands_per_octave", [1, 3])
def test_spectrum_slice_octave_bands_level_clips_shorter_than_the_decimator(
    tmp_path: Path, bands_per_octave: int
) -> None:
    wav = tmp_path / "click.wav"
    _write_sine_wav(wav, freq_hz=1000.0, seconds=20 / 48000, sr=48000)
    command = {"filePath": str(wav), "cursorNorm": 0.5, "bandsPerOctave": bands_per_octave}
    resp = handle_spectrum_slice(command, AnalysisService(AnalysisEngine(cache_limit_bytes=10_000_000)))

    assert result_violation("spectrum-slice", resp) is None
    assert (resp["windowStartNorm"], resp["windowEndNorm"]) == (0.0, 1.0)
    values = resp["channels"][0]["values"]
    assert len(values) == len(resp["bandCentersHz"]) and all(math.isfinite(value) for value in values)


def test_spectrum_slice_rejects_other_band_counts(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    with pytest.raises(backend_errors.InputError):
        validate_request(
            {
                "cmd": "spectrum-slice",
                "requestId": "r",
                "filePath": str(wav),
                "trackIndex": 0,
                "analysisId": "a",
                "settingsSignature": "s",
                "cursorNorm": 0.5,
                "bandsPerOctave": 6,
            }
        )


def test_spectrum_slice_avoids_full_stft_when_detail_is_not_cached(monkeypatch, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    service = AnalysisService(engine)

    def fail_get_spectrogram(*_args: object, **_kwargs: object) -> wd.SpectrogramFrame:
        raise AssertionError("cursor spectrum must not build a full-file spectrogram")

    monkeypatch.setattr(engine, "get_spectrogram", fail_get_spectrogram)
    response = handle_spectrum_slice(
        {
            "filePath": str(wav),
            "cursorNorm": 0.5,
            "stftOptions": {"nFft": 256, "overlapPercent": 50, "window": "hann"},
        },
        service,
    )

    assert response["frequencyBins"] > 0


def test_spectrum_slice_batches_all_channels(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    t = np.linspace(0, 0.5, 8000, endpoint=False)
    left = (0.5 * np.sin(2 * math.pi * 440.0 * t) * 32767).astype(np.int16)
    right = (0.5 * np.sin(2 * math.pi * 880.0 * t) * 32767).astype(np.int16)
    stereo = np.column_stack([left, right])
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(stereo.tobytes())
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    service = AnalysisService(engine)
    command = {
        "filePath": str(wav),
        "trackIndex": 0,
        "cursorNorm": 0.5,
        "stftOptions": {"nFft": 256, "overlapPercent": 50, "window": "hann"},
    }
    response = handle_spectrum_slice(command, service)

    assert [channel["channelIndex"] for channel in response["channels"]] == [0, 1]
    assert np.argmax(response["channels"][0]["values"]) != np.argmax(response["channels"][1]["values"])
    cached = engine.get_file(wav)
    assert len(cached.spectrum_slices) == 1
    assert handle_spectrum_slice(command, service)["channels"] == response["channels"]
    assert len(cached.spectrum_slices) == 1
    revised = dict(command, analysisRevision=1)
    handle_spectrum_slice(revised, service)
    assert len(cached.spectrum_slices) == 2


def test_engine_keeps_materialized_wandas_frame(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)

    entry = AnalysisEngine(cache_limit_bytes=10_000_000).get_file(wav)

    assert isinstance(entry.frame, wd.ChannelFrame)
    assert entry.frame.sampling_rate == 16000
    assert entry.frame.n_samples == 8000
    expected = entry.frame.data.copy()
    wav.unlink()
    np.testing.assert_array_equal(entry.frame.data, expected)


def test_engine_counts_compact_wandas_cache_storage(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)

    entry = engine.get_file(wav)
    spectrogram = engine.get_spectrogram(wav, 256, 128, "hann")
    _cached, _analysis_frame, resolved = engine.get_analysis(wav)
    key = (resolved.signature, 256, 128, "hann")

    assert entry.frame_nbytes == int(np.prod(entry.frame.shape)) * np.dtype("float32").itemsize
    assert entry.spectrogram_nbytes[key] == int(np.prod(spectrogram.shape)) * np.dtype("complex64").itemsize
    assert entry.nbytes == entry.frame_nbytes + entry.spectrogram_nbytes[key]


def test_engine_reuses_cached_source_peaks_for_calibration(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import calibration_profile

    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    entry = engine.get_file(wav)
    profile = {
        "schemaVersion": 1,
        "channels": [
            {
                "channelIndex": 0,
                "expectedLabel": str(entry.frame.labels[0]),
                "status": "calibrated",
                "source": "manual",
                "factor": 2.0,
                "unit": "Pa",
                "referenceValue": 2e-5,
            }
        ],
    }

    monkeypatch.setattr(
        calibration_profile,
        "source_channel_peaks",
        lambda _frame: (_ for _ in ()).throw(AssertionError("source peaks must be cached")),
    )

    engine.get_analysis(wav, profile)


def test_engine_caches_file_frame_once(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    cache_calls = 0
    original_cache = wd.ChannelFrame.cache

    def counted_cache(self: wd.ChannelFrame) -> wd.ChannelFrame:
        nonlocal cache_calls
        cache_calls += 1
        return original_cache(self)

    monkeypatch.setattr(wd.ChannelFrame, "cache", counted_cache)
    first = engine.get_file(wav)

    assert engine.get_file(wav) is first
    assert cache_calls == 1


def test_range_round_trip(server: _ServerHandle, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    resp = server.request(
        {
            "cmd": "range",
            "filePath": str(wav),
            "startNorm": 0.2,
            "endNorm": 0.6,
            "points": 200,
        }
    )
    assert "error" not in resp, resp
    assert resp["startNorm"] == 0.2
    assert len(resp["channels"]) == 1
    assert result_violation("range", resp) is None, "the real range result must satisfy the shared schema"


def test_error_codes_match_the_shared_protocol_fixture() -> None:
    codes = {backend_errors.INPUT_ERROR, backend_errors.STALE_CALIBRATION, backend_errors.INTERNAL_ERROR}
    assert codes == set(PROTOCOL_FIXTURES["errorCodes"])
    assert codes == set(DEFINITIONS["BackendErrorPayload"]["properties"]["code"]["enum"])


def test_unknown_cmd_returns_error(server: _ServerHandle) -> None:
    resp = server.request({"cmd": "nope"})
    assert resp["error"]["code"] == "input-error"
    assert "nope" in resp["error"]["message"]


@pytest.mark.parametrize(
    "payload",
    [pytest.param(case["request"], id=case["command"]) for case in PROTOCOL_FIXTURES["validRequests"]],
)
def test_validate_request_accepts_every_command_payload(payload: dict) -> None:
    assert validate_request(payload) is payload


@pytest.mark.parametrize(
    ("payload", "message"),
    [(case["request"], case["errorField"]) for case in PROTOCOL_FIXTURES["invalidRequests"]],
)
def test_validate_request_rejects_invalid_payloads(payload: object, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        validate_request(payload)


@pytest.mark.parametrize(
    ("extra", "message"),
    [
        ({"typo": 1}, "'typo'"),
        ({"inputContexts": {"tone": {"analysisRevision": 0, "debug": True}}}, "'inputContexts'"),
    ],
)
def test_validate_request_rejects_unknown_run_recipe_keys(extra: dict, message: str) -> None:
    base = {"cmd": "run-recipe", "requestId": "r", "recipe": {"version": 1, "extension": {"open": True}}, "inputs": {}}
    validate_request({**base, "recipePath": "/r.json", "inputContexts": {"tone": {"analysisRevision": 0}}})
    with pytest.raises(ValueError, match=message):
        validate_request({**base, **extra})


def test_validate_request_rejects_non_finite_numbers() -> None:
    payload = {
        "cmd": "range",
        "requestId": "r1",
        "filePath": "tone.wav",
        "startNorm": float("nan"),
        "endNorm": 1.0,
        "points": 100,
    }

    with pytest.raises(ValueError, match="startNorm"):
        validate_request(payload)


def test_invalid_payload_returns_deterministic_error_response(server: _ServerHandle) -> None:
    response = server.request(
        {
            "cmd": "range",
            "filePath": "tone.wav",
            "startNorm": 0.0,
            "endNorm": 1.0,
            "points": "many",
        }
    )

    assert response["requestId"] == "r1"
    assert first_violation(DEFINITIONS["BackendErrorPayload"], response["error"]) is None
    assert response["error"]["code"] == "input-error"
    assert "points" in response["error"]["message"]


def test_dispatch_uses_injected_service_without_creating_an_engine() -> None:
    class FakeService:
        def analyze(self, file_path: str, **options: object) -> dict[str, object]:
            return {"filePath": file_path, "options": options}

    result = dispatch(
        {"cmd": "analyze", "filePath": "/tmp/tone.wav"},
        FakeService(),  # type: ignore[arg-type]
    )

    assert result == {
        "filePath": "/tmp/tone.wav",
        "options": {"stft_options": None, "calibration_profile": None, "analysis_revision": 0},
    }


def test_default_service_loader_reports_startup_phases(monkeypatch: pytest.MonkeyPatch) -> None:
    import backend_server

    phases: list[str] = []

    class FakeEngine:
        pass

    class FakeService:
        def __init__(self, engine: object) -> None:
            self.engine = engine

    modules = {
        "analysis_engine": type("EngineModule", (), {"AnalysisEngine": FakeEngine}),
        "analysis_service": type("ServiceModule", (), {"AnalysisService": FakeService}),
    }
    monkeypatch.setattr(backend_server.importlib, "import_module", modules.__getitem__)
    monkeypatch.setattr(backend_server, "perf_log", lambda phase, _started, **_extra: phases.append(phase))

    service = backend_server._load_default_service()

    assert isinstance(service, FakeService)
    assert isinstance(service.engine, FakeEngine)
    assert phases == [
        "startup_import_analysis_engine",
        "startup_import_analysis_service",
        "startup_create_service",
    ]


def test_non_finite_response_becomes_request_error(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    class FakeService:
        def analyze(self, _file_path: str, **_options: object) -> dict[str, object]:
            return {"rms": math.inf}

    request = {"cmd": "analyze", "requestId": "r1", "filePath": "/tmp/tone.wav"}
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(request) + "\n"))

    main(FakeService(), drain=True)  # type: ignore[arg-type]

    lines = capsys.readouterr().out.splitlines()
    response = json.loads(lines[-1])
    assert response["requestId"] == "r1"
    assert "Out of range float values" in response["error"]["message"]
    assert response["error"]["code"] == "internal-error", "a non-finite result is a backend fault, not bad input"
    assert "Infinity" not in lines[-1]


def test_malformed_request_line_is_an_input_error(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(sys, "stdin", io.StringIO("{not json\n"))

    main(object(), drain=True)  # type: ignore[arg-type]

    response = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert response["error"]["code"] == "input-error"
    assert "not valid JSON" in response["error"]["message"]


def test_analyze_then_range_share_cache(server: _ServerHandle, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    server.request({"cmd": "analyze", "filePath": str(wav)})
    t = time.perf_counter()
    server.request(
        {
            "cmd": "range",
            "filePath": str(wav),
            "startNorm": 0.0,
            "endNorm": 1.0,
            "points": 100,
        }
    )
    elapsed = time.perf_counter() - t
    assert elapsed < 1.0, f"range after analyze took {elapsed:.3f}s — cache likely not shared"


def test_heartbeat_loop_produces_heartbeat_json(monkeypatch: pytest.MonkeyPatch) -> None:
    """_heartbeat_loop sends valid heartbeat JSON."""
    import json as _json
    import time

    import backend_server

    original_sleep = time.sleep
    call_count = [0]

    def fast_sleep(s: float) -> None:
        call_count[0] += 1
        if call_count[0] > 2:
            raise SystemExit  # stop the loop
        original_sleep(0.001)

    monkeypatch.setattr(backend_server, "_HEARTBEAT_INTERVAL", 0.001)

    output = io.StringIO()
    monkeypatch.setattr(sys, "stdout", output)
    monkeypatch.setattr(time, "sleep", fast_sleep)

    import contextlib

    with contextlib.suppress(SystemExit):
        backend_server._heartbeat_loop()

    printed = output.getvalue().splitlines()
    assert len(printed) >= 1
    msg = _json.loads(str(printed[0]))
    assert first_violation(DEFINITIONS["BackendHeartbeatNotification"], msg) is None


def test_heartbeat_loop_emits_valid_json(monkeypatch):
    """_heartbeat_loop emits valid heartbeat JSON."""
    import contextlib
    import json as _json
    import time as _time

    import backend_server

    output = io.StringIO()
    monkeypatch.setattr(sys, "stdout", output)
    monkeypatch.setattr(backend_server, "_HEARTBEAT_INTERVAL", 0.001)

    call_count = [0]
    original_sleep = _time.sleep

    def fast_sleep(s: float) -> None:
        call_count[0] += 1
        if call_count[0] > 3:
            raise SystemExit
        original_sleep(0.001)

    monkeypatch.setattr(_time, "sleep", fast_sleep)

    with contextlib.suppress(SystemExit):
        backend_server._heartbeat_loop()

    printed = output.getvalue().splitlines()
    assert len(printed) >= 2
    for line in printed:
        msg = _json.loads(line)
        assert msg["type"] == "heartbeat"
        assert "ts" in msg


def test_export_wav_loop(tmp_path: Path) -> None:
    """export-wav-loop returns valid base64 WAV for the loop region."""
    # Create a 2-second 440Hz sine wave WAV
    sr = 44100
    n = int(sr * 2.0)
    samples = [int(32767 * math.sin(2 * math.pi * 440 * i / sr)) for i in range(n)]
    with wave.open(str(tmp_path / "tone.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(struct.pack("<" + "h" * n, *samples))

    result = handle_export_wav_loop(
        {
            "filePath": str(tmp_path / "tone.wav"),
            "startNorm": 0.25,
            "endNorm": 0.75,
        }
    )
    assert result_violation("export-wav-loop", result) is None
    raw = base64.b64decode(result["wavBase64"])
    with wave.open(io.BytesIO(raw)) as w:
        assert w.getnframes() > 0
        assert w.getframerate() == result["sampleRate"]
        exported = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    assert np.max(np.abs(exported)) == pytest.approx(32767, rel=0.01)
    assert np.mean(np.abs(exported) >= 32760) < 0.1


def test_export_wav_loop_preserves_stereo_orientation(tmp_path: Path) -> None:
    wav = tmp_path / "stereo.wav"
    sample_rate = 16000
    time_axis = np.arange(sample_rate, dtype=np.float64) / sample_rate
    samples = np.column_stack(
        [
            0.25 * np.sin(2 * math.pi * 440 * time_axis),
            0.75 * np.sin(2 * math.pi * 880 * time_axis),
        ]
    )
    sf.write(wav, samples, sample_rate, subtype="PCM_16")

    result = handle_export_wav_loop({"filePath": str(wav), "startNorm": 0.25, "endNorm": 0.75})
    exported, exported_rate = sf.read(io.BytesIO(base64.b64decode(result["wavBase64"])), always_2d=True)

    assert exported_rate == sample_rate
    assert exported.shape == (sample_rate // 2, 2)
    assert np.max(np.abs(exported[:, 0])) == pytest.approx(0.25, abs=0.01)
    assert np.max(np.abs(exported[:, 1])) == pytest.approx(0.75, abs=0.01)


@pytest.mark.parametrize(("suffix", "format_name", "subtype"), [(".flac", "FLAC", "PCM_16"), (".wav", "WAV", "PCM_24")])
def test_export_wav_loop_preserves_normalized_level_across_source_formats(
    tmp_path: Path,
    suffix: str,
    format_name: str,
    subtype: str,
) -> None:
    audio = tmp_path / f"tone{suffix}"
    sample_rate = 16000
    time_axis = np.arange(sample_rate, dtype=np.float64) / sample_rate
    samples = 0.4 * np.sin(2 * math.pi * 440 * time_axis)
    sf.write(audio, samples, sample_rate, format=format_name, subtype=subtype)

    result = handle_export_wav_loop({"filePath": str(audio), "startNorm": 0.0, "endNorm": 1.0})
    exported, _ = sf.read(io.BytesIO(base64.b64decode(result["wavBase64"])))

    assert np.max(np.abs(exported)) == pytest.approx(0.4, abs=0.01)


def test_export_wav_loop_recenters_unsigned_8_bit_wav(tmp_path: Path) -> None:
    audio = tmp_path / "tone-u8.wav"
    sample_rate = 8000
    time_axis = np.arange(sample_rate, dtype=np.float64) / sample_rate
    samples = np.rint(128 + 64 * np.sin(2 * math.pi * 440 * time_axis)).astype(np.uint8)
    with wave.open(str(audio), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(1)
        output.setframerate(sample_rate)
        output.writeframes(samples.tobytes())

    result = handle_export_wav_loop({"filePath": str(audio), "startNorm": 0.0, "endNorm": 1.0})
    exported, _ = sf.read(io.BytesIO(base64.b64decode(result["wavBase64"])))

    assert np.mean(exported) == pytest.approx(0.0, abs=0.01)
    assert np.max(np.abs(exported)) == pytest.approx(0.5, abs=0.02)


def test_export_wav_loop_zero_frames_raises(tmp_path: Path) -> None:
    """export-wav-loop raises ValueError when the loop region produces 0 frames."""
    sr = 16000
    n = int(sr * 0.5)
    samples = [int(32767 * math.sin(2 * math.pi * 440 * i / sr)) for i in range(n)]
    wav_path = tmp_path / "short.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(struct.pack("<" + "h" * n, *samples))

    import pytest as _pytest

    with _pytest.raises(ValueError, match="0 frames"):
        handle_export_wav_loop({"filePath": str(wav_path), "startNorm": 0.5, "endNorm": 0.3})


def test_lru_evicts_oldest_when_over_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("analysis_engine.CachedAnalysis.nbytes", property(lambda _entry: 128))
    engine = AnalysisEngine(cache_limit_bytes=256)
    paths: list[Path] = []
    for i in range(4):
        p = tmp_path / f"t{i}.wav"
        _write_sine_wav(p, seconds=0.2, sr=16000)
        paths.append(p.resolve())
        engine.get_file(p)

    assert list(engine._files) == paths[-2:]
    assert engine.cache_bytes <= engine.cache_limit_bytes


def test_a_file_larger_than_the_cache_is_read_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav = tmp_path / "long.wav"
    _write_sine_wav(wav, seconds=2.0, sr=16000)
    engine = AnalysisEngine(cache_limit_bytes=1024)
    reads = 0
    original_read = wd.read

    def counted_read(path: Path, **kwargs: Any) -> wd.ChannelFrame:
        nonlocal reads
        reads += 1
        return original_read(path, **kwargs)

    monkeypatch.setattr(wd, "read", counted_read)
    for _ in range(3):
        engine.get_file(wav)
    engine.get_spectrogram(wav, 256, 128, "hann")

    assert reads == 1
    assert engine.is_cached(wav)
    assert engine.get_cached_spectrogram(wav, 256, 128, "hann") is None


def test_a_new_file_evicts_the_oversized_one(tmp_path: Path) -> None:
    first, second = tmp_path / "a.wav", tmp_path / "b.wav"
    _write_sine_wav(first, seconds=2.0, sr=16000)
    _write_sine_wav(second, seconds=2.0, sr=16000)
    engine = AnalysisEngine(cache_limit_bytes=1024)
    engine.get_file(first)
    engine.get_file(second)

    assert not engine.is_cached(first)
    assert engine.is_cached(second)


def test_engine_reuses_frames_and_stft_by_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    calls = 0
    cache_calls = 0
    original_stft = wd.ChannelFrame.stft
    original_cache = wd.SpectrogramFrame.cache

    def counted_stft(self: wd.ChannelFrame, *args: object, **kwargs: object) -> wd.SpectrogramFrame:
        nonlocal calls
        calls += 1
        return original_stft(self, *args, **kwargs)

    def counted_cache(self: wd.SpectrogramFrame) -> wd.SpectrogramFrame:
        nonlocal cache_calls
        cache_calls += 1
        return original_cache(self)

    monkeypatch.setattr(wd.ChannelFrame, "stft", counted_stft)
    monkeypatch.setattr(wd.SpectrogramFrame, "cache", counted_cache)
    first_file = engine.get_file(wav)
    assert engine.get_file(wav) is first_file
    first_stft = engine.get_spectrogram(wav, 256, 128, "hann")
    assert engine.get_spectrogram(wav, 256, 128, "hann") is first_stft
    assert engine.get_spectrogram(wav, 512, 128, "hann") is not first_stft
    assert calls == 2
    assert cache_calls == 2


def test_engine_invalidates_file_and_stft_when_source_changes(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav, seconds=0.5)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    original = engine.get_file(wav)
    engine.get_spectrogram(wav, 256, 128, "hann")

    _write_sine_wav(wav, seconds=0.75)
    refreshed = engine.get_file(wav)

    assert refreshed is not original
    assert refreshed.frame.n_samples != original.frame.n_samples
    assert refreshed.spectrograms == {}


def test_cache_size_uses_stored_metadata_without_materializing_frames() -> None:
    class Unmaterialized:
        @property
        def data(self) -> object:
            raise AssertionError("cache sizing must not materialize wandas data")

    entry = CachedAnalysis(
        path=Path("tone.wav"),
        frame=Unmaterialized(),  # type: ignore[arg-type]
        identity=(1, 2),
        frame_nbytes=80,
        spectrograms={(256, 128, "hann"): Unmaterialized()},  # type: ignore[dict-item]
        spectrogram_nbytes={(256, 128, "hann"): 160},
    )
    assert entry.nbytes == 240


def test_release_track_detail_keeps_reusable_stft_and_file_frame(
    tmp_path: Path,
) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    service = AnalysisService(engine)
    cached = engine.get_file(wav)
    engine.get_spectrogram(wav, 256, 128, "hann")

    released = handle_release_track_detail({"filePath": str(wav)}, service)
    assert released == {}
    assert result_violation("release-track-detail", released) is None
    assert engine.get_file(wav) is cached
    assert cached.spectrograms


def test_backend_has_no_scipy_stft_implementation() -> None:
    source = (Path(__file__).parent / "backend_server.py").read_text(encoding="utf-8")
    assert "ShortTimeFFT" not in source
    assert "get_window" not in source


@pytest.mark.parametrize("points", [32768, 32769])
def test_waveform_point_limit_is_validated_before_dispatch(points: int) -> None:
    payload = {
        "cmd": "range",
        "requestId": "bounded",
        "filePath": "missing.wav",
        "startNorm": 0,
        "endNorm": 1,
        "points": points,
    }
    if points == 32768:
        assert validate_request(payload) is payload
    else:
        with pytest.raises(ValueError, match="points"):
            validate_request(payload)


@pytest.mark.parametrize("setting", [None, "0", "1", "custom"])
def test_shared_perf_preserves_backend_default_and_disable_setting(setting):
    environment = dict(os.environ)
    environment.pop("AWA_PERF_LOG", None)
    if setting is not None:
        environment["AWA_PERF_LOG"] = setting
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import time; from perf import perf_log; perf_log('probe', time.perf_counter(), channels=2)",
        ],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout == ""
    if setting == "0":
        assert result.stderr == ""
    else:
        assert result.stderr.startswith("[perf] phase=probe ms=")
        assert result.stderr.endswith(" channels=2\n")


def test_heartbeat_and_large_responses_are_serialized(monkeypatch):
    import threading

    import backend_server

    sleep = time.sleep
    output = io.StringIO()
    barrier = threading.Barrier(2)
    writes = []
    flushes = []

    class FragmentingOutput:
        def write(self, value):
            writes.append(value)
            for start in range(0, len(value), 127):
                output.write(value[start : start + 127])
                sleep(0.00001)

        def flush(self):
            flushes.append(True)

    heartbeats = 0

    def heartbeat_sleep(_interval):
        nonlocal heartbeats
        if heartbeats == 12:
            raise SystemExit
        heartbeats += 1
        sleep(0.00001)

    monkeypatch.setattr(sys, "stdout", FragmentingOutput())
    monkeypatch.setattr(backend_server.time, "sleep", heartbeat_sleep)
    errors = []

    def heartbeat():
        barrier.wait()
        try:
            backend_server._heartbeat_loop()
        except SystemExit:
            pass
        except Exception as error:
            errors.append(error)

    def responses():
        barrier.wait()
        try:
            for index in range(8):
                backend_server._emit({"requestId": str(index), "samples": [index] * 4000, "label": "音声"})
        except Exception as error:
            errors.append(error)

    threads = [threading.Thread(target=heartbeat), threading.Thread(target=responses)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
        assert not thread.is_alive()
    assert errors == []
    messages = [json.loads(line) for line in output.getvalue().splitlines()]
    assert sum(message.get("type") == "heartbeat" for message in messages) == 12
    responses = [message for message in messages if "requestId" in message]
    assert [message["requestId"] for message in responses] == [str(index) for index in range(8)]
    assert all(message["label"] == "音声" and len(message["samples"]) == 4000 for message in responses)
    assert len(writes) == len(flushes) == len(messages) == 20
    assert all(value.endswith("\n") and value.count("\n") == 1 for value in writes)


@pytest.mark.parametrize("field", ["requestId", "cmd"])
def test_surrogate_error_response_keeps_utf8_backend_alive(monkeypatch, field):
    import backend_server

    requests = [
        {"cmd": "unknown", "requestId": "invalid", field: "\ud800"},
        {"cmd": "analyze", "requestId": "next", "filePath": "tone.wav"},
    ]
    output = io.BytesIO()
    stream = io.TextIOWrapper(output, encoding="utf-8", errors="strict")
    monkeypatch.setattr(backend_server.sys, "stdin", io.StringIO("".join(json.dumps(r) + "\n" for r in requests)))
    monkeypatch.setattr(backend_server.sys, "stdout", stream)

    class FakeService:
        def analyze(self, file_path, **options):
            return {"filePath": file_path}

    main(FakeService(), drain=True)
    stream.flush()
    messages = _replies(output.getvalue().decode("utf-8"))
    assert messages[0]["requestId"] == requests[0]["requestId"]
    assert "error" in messages[0]
    assert messages[1] == {"requestId": "next", "filePath": "tone.wav"}


def test_pair_spectrum_result_satisfies_the_shared_schema(tmp_path: Path) -> None:
    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    _write_sine_wav(first, seconds=1.0)
    _write_sine_wav(second, freq_hz=880.0, seconds=1.0)
    command = validate_request(
        {
            "requestId": "pair-1",
            "cmd": "pair-spectrum",
            "analysisId": "a1",
            "settingsSignature": "sig1",
            "reference": {"filePath": str(first), "channelIndex": 0, "offsetSeconds": 0.0},
            "responses": [
                {"filePath": str(second), "channelIndex": 0, "offsetSeconds": 0.25},
                {"filePath": str(second), "channelIndex": 0, "offsetSeconds": 5.0},
            ],
            "stftOptions": {"nFft": 256, "overlapPercent": 50, "window": "hann"},
        }
    )

    resp = _dispatch(command)

    assert result_violation("pair-spectrum", resp) is None
    assert [response["status"] for response in resp["responses"]] == ["ok", "no-overlap"]


@pytest.mark.parametrize(
    ("opts", "hop"),
    [
        ({"nFft": 256, "overlapPercent": 50, "window": "hann"}, 128),
        ({"nFft": 512, "overlapPercent": 75, "window": "hamming"}, 128),
        ({"nFft": 1024, "overlapPercent": 0, "window": "hann"}, 1024),
    ],
)
def test_spectrum_slice_window_snaps_to_the_nearest_stft_frame(tmp_path: Path, opts: dict, hop: int) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    n_fft = opts["nFft"]
    service = AnalysisService(AnalysisEngine())
    spec = handle_track_detail({"filePath": str(wav), "trackIndex": 0, "stftOptions": opts}, service)["channels"][0][
        "spectrogram"
    ]
    centers_sec = np.asarray(spec["timeCentersSec"])
    for cursor_sample in (3000, 3000 + hop // 3, 3000 + 2 * hop // 3, 4100):
        resp = handle_spectrum_slice(
            {"filePath": str(wav), "trackIndex": 0, "cursorNorm": cursor_sample / 8000, "stftOptions": opts}, service
        )
        center = (resp["windowStartNorm"] + resp["windowEndNorm"]) / 2 * 8000
        # The window sits on the frame grid of the current settings, at the frame nearest the cursor.
        assert center % hop == 0
        assert abs(center - cursor_sample) <= hop / 2
        assert (resp["windowEndNorm"] - resp["windowStartNorm"]) * 8000 == pytest.approx(n_fft)
        # The same frame is a spectrogram column: its centre is one of the reported time centres (16 kHz file).
        assert np.min(np.abs(centers_sec * 16000 - center)) < 1e-6


def test_spectrum_slice_reaches_an_event_at_the_file_end(tmp_path: Path) -> None:
    # A burst in the last 200 samples sits in the spectrogram's padded end frame; the cursor spectrum must see it too.
    samples = np.zeros(8000, dtype=np.int16)
    t = np.arange(7800, 7900)
    samples[t] = (0.5 * np.sin(2 * math.pi * 3000.0 * t / 16000) * 32767).astype(np.int16)
    wav = tmp_path / "tail.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(samples.tobytes())
    opts = {"nFft": 1024, "overlapPercent": 0, "window": "hann"}
    for cursor_sample in (7850, 7999):
        resp = handle_spectrum_slice({"filePath": str(wav), "cursorNorm": cursor_sample / 8000, "stftOptions": opts})
        assert resp["windowStartNorm"] * 8000 <= cursor_sample < resp["windowEndNorm"] * 8000
        assert float(resp["channels"][0]["maxDb"]) > -60.0
    start = handle_spectrum_slice({"filePath": str(wav), "cursorNorm": 300 / 8000, "stftOptions": opts})
    assert start["windowStartNorm"] == 0


def test_requests_for_different_files_run_at_once(monkeypatch, capsys):

    both_started = threading.Barrier(2, timeout=10)
    calls: list[str] = []

    class FakeService:
        def analyze(self, file_path, **_options):
            calls.append(file_path)
            if file_path in {"a.wav", "b.wav"}:
                # Each of the first two waits for the other: this returns only when they run side by side.
                both_started.wait()
            return {"filePath": file_path}

    requests = [
        {"cmd": "analyze", "requestId": "a1", "filePath": "a.wav"},
        {"cmd": "analyze", "requestId": "a2", "filePath": "a2.wav"},
        {"cmd": "analyze", "requestId": "b1", "filePath": "b.wav"},
    ]
    monkeypatch.setattr(sys, "stdin", io.StringIO("".join(json.dumps(r) + "\n" for r in requests)))

    main(FakeService(), workers=2, drain=True)  # type: ignore[arg-type]

    responses = _replies(capsys.readouterr().out)
    assert sorted(response["requestId"] for response in responses) == ["a1", "a2", "b1"]
    assert all("error" not in response for response in responses)


def test_requests_for_one_file_are_answered_in_the_order_they_came(monkeypatch, capsys):

    class FakeService:
        def analyze(self, file_path, **_options):
            time.sleep(0.05 if file_path == "a.wav" else 0)
            return {"filePath": file_path}

        def release_track_detail(self, file_path):
            return {"released": file_path}

    requests = [
        {"cmd": "analyze", "requestId": "first", "filePath": "a.wav"},
        {"cmd": "release-track-detail", "requestId": "second", "filePath": "a.wav"},
    ]
    monkeypatch.setattr(sys, "stdin", io.StringIO("".join(json.dumps(r) + "\n" for r in requests)))

    main(FakeService(), workers=4, drain=True)  # type: ignore[arg-type]

    responses = _replies(capsys.readouterr().out)
    assert [response["requestId"] for response in responses] == ["first", "second"]


def test_two_requests_for_one_uncached_file_read_it_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav, seconds=0.5)
    engine = AnalysisEngine(cache_limit_bytes=16 * 1024 * 1024)
    reads = 0
    original_read = wd.read

    def slow_read(path: Path, **kwargs: Any) -> wd.ChannelFrame:
        nonlocal reads
        reads += 1
        time.sleep(0.1)
        return original_read(path, **kwargs)

    monkeypatch.setattr(wd, "read", slow_read)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = executor.map(lambda _: engine.get_file(wav), range(2))

    assert reads == 1
    assert first is second


def test_a_scan_against_a_reference_holds_the_reference_files_requests_until_it_ends(monkeypatch, capsys):

    spans: dict[str, tuple[float, float]] = {}

    class FakeService:
        def scan(self, file_path, **_options):
            started = time.perf_counter()
            time.sleep(0.2)
            spans["scan"] = (started, time.perf_counter())
            return {"filePath": file_path}

        def analyze(self, file_path, **_options):
            spans[file_path] = (time.perf_counter(), time.perf_counter())
            return {"filePath": file_path}

    recipe = {"schema": 3}
    requests = [
        {
            "cmd": "scan",
            "requestId": "scan",
            "filePath": "x.wav",
            "recipe": recipe,
            "reference": {"filePath": "r.wav", "step": "out", "recipe": recipe},
        },
        {"cmd": "analyze", "requestId": "panel", "filePath": "r.wav"},
    ]
    monkeypatch.setattr(sys, "stdin", io.StringIO("".join(json.dumps(r) + "\n" for r in requests)))

    main(FakeService(), workers=2, drain=True)  # type: ignore[arg-type]

    responses = _replies(capsys.readouterr().out)
    assert [response["requestId"] for response in responses] == ["scan", "panel"], responses
    assert spans["r.wav"][0] >= spans["scan"][1]


def test_a_request_holds_the_lane_of_every_file_it_reads() -> None:
    from backend_server import _lanes_of

    def lanes(*names: str) -> frozenset[str]:
        return frozenset(str(Path(name).resolve()) for name in names)

    assert _lanes_of({"cmd": "analyze", "filePath": "a.wav"}) == lanes("a.wav")
    assert _lanes_of({"cmd": "scan", "filePath": "a.wav", "reference": {"filePath": "r.wav"}}) == lanes(
        "a.wav", "r.wav"
    )
    assert _lanes_of(
        {
            "cmd": "pair-spectrum",
            "reference": {"filePath": "r.wav"},
            "responses": [{"filePath": "a.wav"}, {"filePath": "r.wav"}],
        }
    ) == lanes("r.wav", "a.wav")
    assert _lanes_of({"cmd": "run-recipe", "inputs": {"x": "a.wav", "y": "./sub/../b.wav"}}) == lanes("a.wav", "b.wav")
    assert _lanes_of({"cmd": "build-recipe"}) == frozenset({""})


def test_lanes_follow_the_resolved_file_not_its_spelling(tmp_path: Path) -> None:
    from backend_server import _lanes_of

    target = tmp_path / "tone.wav"
    target.touch()
    link = tmp_path / "link.wav"
    link.symlink_to(target)

    assert _lanes_of({"cmd": "analyze", "filePath": str(link)}) == _lanes_of(
        {"cmd": "analyze", "filePath": str(tmp_path / "." / "tone.wav")}
    )


def test_a_lane_moves_on_when_a_request_raises() -> None:
    from backend_server import _Lanes

    ran: list[str] = []

    def fails() -> None:
        raise RuntimeError("lost")

    lanes = _Lanes(1)
    lanes.submit("r1", frozenset({"a.wav"}), lambda _job: fails(), barrier=True)
    lanes.submit("r2", frozenset({"a.wav"}), lambda _job: ran.append("next"), barrier=True)
    lanes.close(drain=True)

    assert ran == ["next"]


def _stdin(monkeypatch: pytest.MonkeyPatch, *requests: dict[str, object]) -> None:
    monkeypatch.setattr(sys, "stdin", io.StringIO("".join(json.dumps(r) + "\n" for r in requests)))


def test_a_range_does_not_wait_behind_a_track_detail_for_the_same_file(monkeypatch, capsys):
    range_done = threading.Event()

    class FakeService:
        def track_detail(self, file_path, **_options):
            # Returns only once the later range for the same file has been answered beside it.
            assert range_done.wait(10)
            return {"filePath": file_path}

        def waveform_range(self, file_path, *_args, **_options):
            range_done.set()
            return {"filePath": file_path}

    detail = {"cmd": "track-detail", "requestId": "detail", "filePath": "a.wav", "trackIndex": 0}
    detail |= {"analysisId": "x", "settingsSignature": "s"}
    rng = {"cmd": "range", "requestId": "range", "filePath": "a.wav", "startNorm": 0, "endNorm": 1, "points": 10}
    _stdin(monkeypatch, detail, rng)

    main(FakeService(), workers=2, drain=True)  # type: ignore[arg-type]

    responses = _replies(capsys.readouterr().out)
    assert [response["requestId"] for response in responses] == ["range", "detail"], responses


def test_interactive_requests_start_before_other_ready_ones() -> None:
    from backend_server import _Lanes

    gate = threading.Event()
    order: list[str] = []
    lanes = _Lanes(1)
    lanes.submit("busy", frozenset({"z"}), lambda _job: gate.wait(10))
    lanes.submit("scan", frozenset({"a"}), lambda _job: order.append("scan"))
    lanes.submit("range", frozenset({"b"}), lambda _job: order.append("range"), interactive=True)
    gate.set()
    lanes.close(drain=True)

    assert order == ["range", "scan"]


def test_a_barrier_waits_for_earlier_requests_and_holds_later_ones() -> None:
    from backend_server import _Lanes

    gate = threading.Event()
    order: list[str] = []
    lanes = _Lanes(3)
    lanes.submit("detail", frozenset({"a"}), lambda _job: (gate.wait(10), order.append("detail")))
    lanes.submit("release", frozenset({"a"}), lambda _job: order.append("release"), barrier=True)
    lanes.submit("range", frozenset({"a"}), lambda _job: order.append("range"), interactive=True)
    lanes.submit("other", frozenset({"b"}), lambda _job: order.append("other"))
    deadline = time.monotonic() + 10
    while not order and time.monotonic() < deadline:
        time.sleep(0.01)
    time.sleep(0.05)
    assert order == ["other"], "only the request for another file may run while the barrier waits"
    gate.set()
    lanes.close(drain=True)

    assert order == ["other", "detail", "release", "range"]


def test_cancel_drops_a_queued_request(monkeypatch, capsys):
    calls: list[str] = []

    class FakeService:
        def analyze(self, file_path, **_options):
            calls.append(file_path)
            time.sleep(0.1)
            return {"filePath": file_path}

    _stdin(
        monkeypatch,
        {"cmd": "analyze", "requestId": "first", "filePath": "a.wav"},
        {"cmd": "analyze", "requestId": "queued", "filePath": "b.wav"},
        {"cmd": "cancel", "requestIds": ["queued"]},
    )

    main(FakeService(), workers=1, drain=True)  # type: ignore[arg-type]

    responses = _replies(capsys.readouterr().out)
    assert [response["requestId"] for response in responses] == ["first"]
    assert "b.wav" not in calls


def test_a_cancelled_running_request_sends_no_reply(capsys):
    from backend_server import _Lanes, _run

    started = threading.Event()
    proceed = threading.Event()

    class FakeService:
        def analyze(self, file_path, **_options):
            started.set()
            assert proceed.wait(10)
            return {"filePath": file_path}

    command = {"cmd": "analyze", "requestId": "r1", "filePath": "a.wav"}
    lanes = _Lanes(1)
    lanes.submit("r1", frozenset({"a"}), lambda job: _run(command, job, FakeService()))  # type: ignore[arg-type]
    assert started.wait(10)
    lanes.cancel(["r1"])
    proceed.set()
    lanes.close(drain=True)

    assert _replies(capsys.readouterr().out) == []


def test_a_request_queued_behind_a_barrier_reports_started_only_when_it_runs(monkeypatch, capsys):
    class FakeService:
        def scan(self, file_path, **_options):
            time.sleep(0.1)
            return {"filePath": file_path}

        def waveform_range(self, file_path, *_args, **_options):
            return {"filePath": file_path}

    rng = {"cmd": "range", "requestId": "range", "filePath": "a.wav", "startNorm": 0, "endNorm": 1, "points": 10}
    _stdin(monkeypatch, {"cmd": "scan", "requestId": "scan", "filePath": "a.wav", "recipe": {"schema": 3}}, rng)

    main(FakeService(), workers=2, drain=True)  # type: ignore[arg-type]

    messages = [json.loads(line) for line in capsys.readouterr().out.splitlines()[1:]]
    order = [(message.get("type", "reply"), message["requestId"]) for message in messages]
    assert order == [("started", "scan"), ("reply", "scan"), ("started", "range"), ("reply", "range")], messages
    started = [message for message in messages if message.get("type") == "started"]
    assert all(first_violation(DEFINITIONS["BackendStartedNotification"], message) is None for message in started)


def test_an_invalid_cancel_control_is_an_input_error(monkeypatch, capsys):
    _stdin(monkeypatch, {"cmd": "cancel", "requestIds": "r1"})

    main(object(), drain=True)  # type: ignore[arg-type]

    response = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert response["error"]["code"] == "input-error"


def test_stdin_eof_drops_queued_requests_instead_of_finishing_them(monkeypatch, capsys):
    calls: list[str] = []
    release = threading.Event()

    class FakeService:
        def analyze(self, file_path, **_options):
            calls.append(file_path)
            release.wait(10)
            return {"filePath": file_path}

    _stdin(
        monkeypatch,
        {"cmd": "analyze", "requestId": "running", "filePath": "a.wav"},
        {"cmd": "analyze", "requestId": "queued", "filePath": "b.wav"},
    )

    started = time.perf_counter()
    main(FakeService(), workers=1)  # type: ignore[arg-type]
    returned_after = time.perf_counter() - started
    release.set()
    time.sleep(0.1)

    assert returned_after < 5, "main must not wait for the running request once the host is gone"
    assert "b.wav" not in calls


def test_a_path_that_cannot_be_resolved_fails_only_its_own_request(monkeypatch, capsys):
    class FakeService:
        def analyze(self, file_path, **_options):
            return {"filePath": file_path}

    _stdin(
        monkeypatch,
        {"cmd": "analyze", "requestId": "bad", "filePath": "a\u0000.wav"},
        {"cmd": "analyze", "requestId": "good", "filePath": "a.wav"},
    )

    main(FakeService(), drain=True)  # type: ignore[arg-type]

    responses = {r["requestId"]: r for r in _replies(capsys.readouterr().out)}
    assert "error" in responses["bad"]
    assert responses["good"] == {"requestId": "good", "filePath": "a.wav"}
