from __future__ import annotations

import base64
import io
import math

import numpy as np
import soundfile as sf
import wandas as wd

import backend_server
from analysis_engine import AnalysisEngine
from analyzer import analyze_from_frame
from calibration_profile import resolve_calibration_profile


def _profile(labels: list[str], factors: list[float], units: list[str], refs: list[float]) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "channels": [
            {
                "channelIndex": index,
                "expectedLabel": label,
                "status": "calibrated",
                "source": "manual",
                "factor": factors[index],
                "unit": units[index],
                "referenceValue": refs[index],
            }
            for index, label in enumerate(labels)
        ],
    }


def test_channel_calibration_applies_to_linear_levels_and_raw_clipping() -> None:
    source = wd.from_numpy(
        np.array([[0.5, -0.5], [1.0, -1.0]], dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["microphone", "accelerometer"],
    )
    resolved = resolve_calibration_profile(
        _profile(
            ["microphone", "accelerometer"],
            [2.0, 0.5],
            ["Pa", "m/s^2"],
            [2e-5, 1.0],
        ),
        source,
    )

    result = analyze_from_frame(
        resolved.apply(source),
        "fixture.wav",
        raw_frame=source,
        calibration_profile=resolved,
    )

    microphone, accelerometer = result["channels"]
    assert result["schemaVersion"] == 2
    assert result["calibrationSignature"] == resolved.signature
    assert microphone["unit"] == "Pa"
    assert microphone["measurement"]["levelUnit"] == "dB SPL"
    assert microphone["measurement"]["levelReferenceLabel"] == "dB SPL re 20 µPa"
    assert microphone["rms"] == 1.0
    assert microphone["peakAbsolute"] == 1.0
    assert math.isclose(microphone["rmsLevelDb"], 20.0 * math.log10(1.0 / 2e-5))
    assert microphone["rawPeakFullScale"] == 0.5
    assert microphone["clipped"] is False

    assert accelerometer["unit"] == "m/s^2"
    assert accelerometer["rms"] == 0.5
    assert accelerometer["peakAbsolute"] == 0.5
    assert math.isclose(accelerometer["peakLevelDb"], 20.0 * math.log10(0.5))
    assert accelerometer["rawPeakFullScale"] == 1.0
    assert accelerometer["clipped"] is True


def test_uncalibrated_profile_is_explicit_full_scale() -> None:
    source = wd.from_numpy(
        np.array([[0.25, -0.25]], dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["input"],
    )
    resolved = resolve_calibration_profile(None, source)
    result = analyze_from_frame(source, "fixture.wav", raw_frame=source, calibration_profile=resolved)
    channel = result["channels"][0]

    assert channel["unit"] == "FS"
    assert channel["measurement"] == {
        "calibrationStatus": "uncalibrated",
        "calibrationSource": "default",
        "factor": 1.0,
        "linearUnit": "FS",
        "referenceValue": 1.0,
        "referenceUnit": "FS",
        "levelUnit": "dBFS",
        "levelReferenceLabel": "dBFS",
    }
    assert math.isclose(channel["rmsLevelDb"], 20.0 * math.log10(0.25))
    assert result["units"]["spectrumLevel"]["axisLabel"] == "Spectrum amplitude level [dBFS]"


def test_profile_validation_is_strict_about_channel_labels() -> None:
    source = wd.from_numpy(
        np.ones((1, 4), dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["microphone"],
    )
    payload = _profile(["other"], [1.0], ["Pa"], [2e-5])

    try:
        resolve_calibration_profile(payload, source)
    except ValueError as error:
        assert "label mismatch" in str(error)
    else:
        raise AssertionError("Expected mismatched calibration labels to fail")


def test_spectrogram_cache_is_partitioned_by_calibration_signature(tmp_path) -> None:
    file_path = tmp_path / "tone.wav"
    samples = np.sin(2.0 * np.pi * 1_000 * np.arange(512) / 8_000) * 0.25
    sf.write(file_path, samples, 8_000, subtype="DOUBLE")
    engine = AnalysisEngine(cache_limit_bytes=16 * 1024 * 1024)
    cached = engine.get_file(file_path)
    labels = list(cached.frame.labels)

    first = _profile(labels, [1.0], ["Pa"], [2e-5])
    second = _profile(labels, [2.0], ["Pa"], [2e-5])
    engine.get_spectrogram(file_path, 64, 32, "hann", first)
    engine.get_spectrogram(file_path, 64, 32, "hann", second)

    assert len(cached.spectrograms) == 2
    assert len({key[0] for key in cached.spectrograms}) == 2


def test_backend_range_is_calibrated_but_wav_export_stays_raw(tmp_path) -> None:
    file_path = tmp_path / "source.wav"
    samples = np.array([0.5, -0.5, 0.25, -0.25], dtype=np.float64)
    sf.write(file_path, samples, 8_000, subtype="DOUBLE")
    cached = backend_server._engine.get_file(file_path)
    labels = list(cached.frame.labels)
    profile = _profile(labels, [2.0], ["Pa"], [2e-5])

    range_result = backend_server.handle_range(
        {
            "filePath": str(file_path),
            "startNorm": 0.0,
            "endNorm": 1.0,
            "points": 16,
            "calibrationProfile": profile,
            "analysisRevision": 4,
        }
    )
    assert range_result["analysisRevision"] == 4
    assert math.isclose(range_result["channels"][0]["absolutePeak"], 1.0)

    wav_result = backend_server.handle_export_wav_loop({"filePath": str(file_path), "startNorm": 0.0, "endNorm": 1.0})
    exported, sample_rate = sf.read(io.BytesIO(base64.b64decode(wav_result["wavBase64"])), dtype="float64")
    assert sample_rate == 8_000
    np.testing.assert_allclose(exported, samples, atol=1.0 / 32768.0)
