from __future__ import annotations

import base64
import io
import json
import math
import os
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

from analysis_engine import AnalysisEngine, CachedAnalysis
from analysis_service import AnalysisService
from backend_server import dispatch, validate_request

ROOT = Path(__file__).parent
PROTOCOL_FIXTURES = json.loads(
    (ROOT.parent / "src" / "test" / "fixtures" / "backendProtocol.json").read_text(encoding="utf-8")
)


def _dispatch(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return dispatch(command, service or AnalysisService(AnalysisEngine(cache_limit_bytes=64 * 1024 * 1024)))


def handle_analyze(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return _dispatch({"cmd": "analyze", **command}, service)


def handle_track_detail(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return _dispatch({"cmd": "track-detail", **command}, service)


def handle_spectrum_slice(command: dict, service: AnalysisService | None = None) -> dict[str, object]:
    return _dispatch({"cmd": "spectrum-slice", **command}, service)


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
            if msg.get("type") == "ready":
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
    resp = server.request({"cmd": "analyze", "filePath": str(wav), "peakCount": 3})
    assert "error" not in resp, resp
    assert resp["fileName"] == "tone.wav"
    assert resp["channelCount"] == 1
    assert len(resp["channels"]) == 1
    assert resp["channels"][0]["spectrogram"] is None


def test_analyze_round_trip_accepts_flac_from_supported_ui_formats(server: _ServerHandle, tmp_path: Path) -> None:
    flac = tmp_path / "tone.flac"
    _write_sine_flac(flac)
    resp = server.request({"cmd": "analyze", "filePath": str(flac), "peakCount": 3})
    assert "error" not in resp, resp
    assert resp["fileName"] == "tone.flac"
    assert resp["channelCount"] == 1
    assert len(resp["channels"]) == 1
    assert resp["channels"][0]["spectrogram"] is None


def test_analyze_uses_engine_frame_under_resolved_path(monkeypatch, tmp_path: Path) -> None:
    import analysis_service

    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    monkeypatch.setattr(
        analysis_service,
        "analyze_from_frame",
        lambda _frame, path, **_kwargs: {"filePath": str(path), "channels": []},
    )

    resp = handle_analyze(
        {"filePath": str(wav.parent / "." / wav.name)},
        AnalysisService(engine),
    )

    assert resp["filePath"] == str(wav.resolve())
    assert list(engine._files) == [wav.resolve()]


def test_track_detail_returns_spectrogram_for_requested_file(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)

    resp = handle_track_detail(
        {
            "filePath": str(wav),
            "trackIndex": 2,
            "analysisId": "a1",
            "settingsSignature": "sig1",
            "stftOptions": {"nFft": 256, "hopSize": 128, "window": "hann"},
        }
    )

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

    overview = handle_analyze({"filePath": str(wav), "peakCount": 3})["channels"][0]["waveform"]
    response = handle_range({"filePath": str(wav), "startNorm": 0.25, "endNorm": 0.75, "points": 128})
    waveform = response["channels"][0]

    assert waveform["absolutePeak"] == pytest.approx(overview["absolutePeak"], rel=0.05)
    assert waveform["absolutePeak"] == pytest.approx(0.5, abs=0.01)
    assert min(waveform["minT"]) >= 0.24
    assert max(waveform["maxT"]) <= 0.76


def test_handle_range_does_not_reread_cached_audio(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import analysis_service

    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav, seconds=2.0)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    engine.get_file(wav)
    service = AnalysisService(engine)

    def fail_sound_file(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("range must use the cached Wandas Frame")

    monkeypatch.setattr(analysis_service.sf, "SoundFile", fail_sound_file)
    result = handle_range(
        {"filePath": str(wav), "startNorm": 0.25, "endNorm": 0.3, "points": 128},
        service,
    )

    assert result["channels"]


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
    opts = {"nFft": 256, "hopSize": 128, "window": "hann"}
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

    assert resp["trackIndex"] == 0
    assert resp["frequencyBins"] == spec["frequencyBins"]
    assert resp["maxFrequencyHz"] == spec["maxFrequencyHz"]
    assert int(np.argmax(resp["values"])) == int(np.argmax(expected_row))
    assert abs(float(resp["maxDb"]) - float(np.max(expected_row))) < 1.0


@pytest.mark.parametrize("cursor_norm", [-1.0, 0.0, 1.0, 2.0])
def test_spectrum_slice_clamps_cursor_to_cached_stft_bounds(tmp_path: Path, cursor_norm: float) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    response = handle_spectrum_slice(
        {
            "filePath": str(wav),
            "cursorNorm": cursor_norm,
            "stftOptions": {"nFft": 256, "hopSize": 128, "window": "hann"},
        }
    )
    assert response["frequencyBins"] > 0
    assert all(np.isfinite(response["values"]))


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
            "stftOptions": {"nFft": 256, "hopSize": 128, "window": "hann"},
        },
        service,
    )

    assert resp["frequencyBins"] > 0
    assert len(resp["values"]) == resp["frequencyBins"]


def test_spectrum_slice_uses_cached_wandas_spectrogram(monkeypatch, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    service = AnalysisService(engine)

    command = {
        "filePath": str(wav),
        "trackIndex": 0,
        "cursorNorm": 0.5,
        "stftOptions": {"nFft": 256, "hopSize": 128, "window": "hann"},
    }
    first = handle_spectrum_slice(command, service)
    spectrogram = engine.get_spectrogram(wav, 256, 128, "hann")
    second = handle_spectrum_slice(command, service)
    third = handle_spectrum_slice(command, service)

    assert engine.get_spectrogram(wav, 256, 128, "hann") is spectrogram
    assert first["frequencyBins"] == second["frequencyBins"]
    assert second["values"] == third["values"]


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
            "stftOptions": {"nFft": 256, "hopSize": 128, "window": "hann"},
        },
        service,
    )

    assert response["frequencyBins"] > 0


def test_spectrum_slice_uses_requested_channel(tmp_path: Path) -> None:
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
    left_resp = handle_spectrum_slice(
        {
            "filePath": str(wav),
            "trackIndex": 0,
            "cursorNorm": 0.5,
            "channelIndex": 0,
            "stftOptions": {"nFft": 256, "hopSize": 128, "window": "hann"},
        }
    )
    right_resp = handle_spectrum_slice(
        {
            "filePath": str(wav),
            "trackIndex": 0,
            "cursorNorm": 0.5,
            "channelIndex": 1,
            "stftOptions": {"nFft": 256, "hopSize": 128, "window": "hann"},
        }
    )

    assert np.argmax(left_resp["values"]) != np.argmax(right_resp["values"])


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


def test_unknown_cmd_returns_error(server: _ServerHandle) -> None:
    resp = server.request({"cmd": "nope"})
    assert "error" in resp and "nope" in resp["error"]


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
    assert "points" in response["error"]


def test_dispatch_uses_injected_service_without_creating_an_engine() -> None:
    class FakeService:
        def analyze(self, file_path: str, **options: object) -> dict[str, object]:
            return {"filePath": file_path, "peakCount": options["peak_count"]}

    result = dispatch(
        {"cmd": "analyze", "filePath": "/tmp/tone.wav", "peakCount": 7},
        FakeService(),  # type: ignore[arg-type]
    )

    assert result == {"filePath": "/tmp/tone.wav", "peakCount": 7}


def test_analyze_then_range_share_cache(server: _ServerHandle, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    server.request({"cmd": "analyze", "filePath": str(wav), "peakCount": 3})
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
    import builtins
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

    printed: list[object] = []
    monkeypatch.setattr(builtins, "print", lambda *args, **kwargs: printed.extend(args))
    monkeypatch.setattr(time, "sleep", fast_sleep)

    import contextlib

    with contextlib.suppress(SystemExit):
        backend_server._heartbeat_loop()

    assert len(printed) >= 1
    msg = _json.loads(str(printed[0]))
    assert msg["type"] == "heartbeat"
    assert "ts" in msg


def test_heartbeat_loop_emits_valid_json(monkeypatch):
    """_heartbeat_loop emits valid heartbeat JSON."""
    import builtins
    import contextlib
    import json as _json
    import time as _time

    import backend_server

    printed = []
    monkeypatch.setattr(builtins, "print", lambda *args, **kwargs: printed.extend(args))
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
    assert "wavBase64" in result
    assert "sampleRate" in result
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


def test_release_track_detail_drops_stft_but_keeps_file_frame(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    engine = AnalysisEngine(cache_limit_bytes=10_000_000)
    service = AnalysisService(engine)
    cached = engine.get_file(wav)
    engine.get_spectrogram(wav, 256, 128, "hann")

    assert handle_release_track_detail({"filePath": str(wav)}, service) == {}
    assert engine.get_file(wav) is cached
    assert cached.spectrograms == {}


def test_backend_has_no_scipy_stft_implementation() -> None:
    source = (Path(__file__).parent / "backend_server.py").read_text(encoding="utf-8")
    assert "ShortTimeFFT" not in source
    assert "get_window" not in source
