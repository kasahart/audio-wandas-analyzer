from __future__ import annotations

import base64
import io
import math

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

import backend_server
from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
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


def test_unitless_numpy_profile_keeps_wandas_input_unit_reference() -> None:
    source = wd.from_numpy(
        np.array([[0.25, -0.25]], dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["input"],
    )
    resolved = resolve_calibration_profile(None, source)
    result = analyze_from_frame(source, "fixture.wav", raw_frame=source, calibration_profile=resolved)
    channel = result["channels"][0]

    assert channel["unit"] == ""
    assert channel["measurement"] == {
        "calibrationStatus": "uncalibrated",
        "calibrationSource": "default",
        "factor": 1.0,
        "linearUnit": "",
        "referenceValue": 1.0,
        "referenceUnit": "",
        "levelUnit": "dB",
        "levelReferenceLabel": "dB re 1 input unit",
    }
    assert math.isclose(channel["rmsLevelDb"], 20.0 * math.log10(0.25))
    assert result["units"]["spectrumLevel"]["axisLabel"] == "Spectrum amplitude level [dB re 1 input unit]"


def test_full_scale_frame_fallback_is_uncalibrated_not_embedded_calibration() -> None:
    source = wd.from_numpy(
        np.array([[0.25, -0.25]], dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["input"],
        ch_units=["FS"],
    )

    result = analyze_from_frame(source, "fixture.wav")
    measurement = result["channels"][0]["measurement"]

    assert measurement["calibrationStatus"] == "uncalibrated"
    assert measurement["calibrationSource"] == "default"
    assert measurement["linearUnit"] == "FS"
    assert measurement["levelUnit"] == "dBFS"


@pytest.mark.parametrize(
    ("factor", "reference_value"),
    [
        (1e151, 1.0),
        (1e-151, 1.0),
        (1.0, 1e151),
        (1.0, 1e-151),
    ],
)
def test_calibration_values_are_bounded_before_wandas_analysis(
    factor: float,
    reference_value: float,
) -> None:
    source = wd.from_numpy(
        np.array([[0.25, -0.25]], dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["input"],
    )

    with pytest.raises(ValueError, match="between 1e-150 and 1e150"):
        resolve_calibration_profile(
            _profile(["input"], [factor], ["Pa"], [reference_value]),
            source,
        )


def test_calibration_factor_is_bounded_by_source_peak() -> None:
    source = wd.from_numpy(
        np.array([[1e10, -1e10]], dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["input"],
    )

    resolve_calibration_profile(_profile(["input"], [1e24], ["Pa"], [1.0]), source)
    with pytest.raises(ValueError, match="safe limit.*source peak"):
        resolve_calibration_profile(_profile(["input"], [1.1e24], ["Pa"], [1.0]), source)


def test_calibration_rejects_non_finite_source_samples() -> None:
    source = wd.from_numpy(
        np.array([[0.0, np.inf]], dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["input"],
    )

    with pytest.raises(ValueError, match="contains non-finite samples"):
        resolve_calibration_profile(_profile(["input"], [1.0], ["Pa"], [1.0]), source)


def test_mixed_level_references_omit_aggregate_units() -> None:
    source = wd.from_numpy(
        np.array([[0.25, -0.25], [0.5, -0.5]], dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["microphone", "raw"],
    )
    payload = _profile(
        ["microphone", "raw"],
        [2.0, 1.0],
        ["Pa", "FS"],
        [2e-5, 1.0],
    )
    payload["channels"][1] = {
        "channelIndex": 1,
        "expectedLabel": "raw",
        "status": "uncalibrated",
        "source": "default",
        "factor": 1.0,
        "unit": "",
        "referenceValue": 1.0,
    }
    resolved = resolve_calibration_profile(payload, source)

    result = analyze_from_frame(
        resolved.apply(source),
        "fixture.wav",
        raw_frame=source,
        calibration_profile=resolved,
    )

    assert "units" not in result
    assert result["channels"][0]["measurement"]["levelUnit"] == "dB SPL"
    assert result["channels"][1]["measurement"]["levelUnit"] == "dB"


def test_real_wav_preserves_uncalibrated_domains_for_none_full_and_partial_profiles(tmp_path) -> None:
    file_path = tmp_path / "stereo.wav"
    samples = np.array(
        [
            [0.25, 0.5],
            [-0.25, -0.5],
            [0.125, 0.25],
            [-0.125, -0.25],
        ],
        dtype=np.float64,
    )
    sf.write(file_path, samples, 8_000, subtype="DOUBLE")
    engine = AnalysisEngine(cache_limit_bytes=16 * 1024 * 1024)
    service = AnalysisService(engine)
    cached = engine.get_file(file_path)
    labels = list(cached.frame.labels)

    uncalibrated = service.analyze(file_path)
    assert [channel["measurement"]["levelUnit"] for channel in uncalibrated["channels"]] == ["dBFS", "dBFS"]

    full_profile = _profile(labels, [2.0, 4.0], ["Pa", "Pa"], [2e-5, 20 * 1e-6])
    fully_calibrated = service.analyze(file_path, calibration_profile=full_profile)
    assert [channel["measurement"]["levelUnit"] for channel in fully_calibrated["channels"]] == [
        "dB SPL",
        "dB SPL",
    ]

    partial_profile = _profile(labels, [2.0, 1.0], ["Pa", "FS"], [2e-5, 1.0])
    partial_profile["channels"][1] = {
        "channelIndex": 1,
        "expectedLabel": labels[1],
        "status": "uncalibrated",
        "source": "default",
        "factor": 1.0,
        "unit": "",
        "referenceValue": 1.0,
    }
    _cached, partial_frame, resolved = engine.get_analysis(file_path, partial_profile)
    partially_calibrated = service.analyze(file_path, calibration_profile=partial_profile)

    assert partial_frame.channels[1].calibration == cached.frame.channels[1].calibration
    assert resolved.channels[1].status == "uncalibrated"
    assert resolved.channels[1].unit == cached.frame.channels[1].unit
    assert [channel["measurement"]["levelUnit"] for channel in partially_calibrated["channels"]] == [
        "dB SPL",
        "dBFS",
    ]


def test_micro_reference_prefix_attaches_to_non_pascal_unit() -> None:
    source = wd.from_numpy(
        np.array([[0.25, -0.25]], dtype=np.float64),
        sampling_rate=8_000,
        ch_labels=["voltage"],
    )
    resolved = resolve_calibration_profile(_profile(["voltage"], [1.0], ["V"], [2e-5]), source)
    result = analyze_from_frame(resolved.apply(source), "fixture.wav", raw_frame=source, calibration_profile=resolved)

    assert result["channels"][0]["measurement"]["levelReferenceLabel"] == "dB re 2e-05 V"


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
    engine = AnalysisEngine(cache_limit_bytes=16 * 1024 * 1024)
    service = AnalysisService(engine)
    cached = engine.get_file(file_path)
    labels = list(cached.frame.labels)
    profile = _profile(labels, [2.0], ["Pa"], [2e-5])

    range_result = backend_server.handle_range(
        service,
        {
            "filePath": str(file_path),
            "startNorm": 0.0,
            "endNorm": 1.0,
            "points": 16,
            "calibrationProfile": profile,
            "analysisRevision": 4,
        },
    )
    assert range_result["analysisRevision"] == 4
    assert math.isclose(range_result["channels"][0]["absolutePeak"], 1.0)

    wav_result = backend_server.handle_export_wav_loop(
        service,
        {"filePath": str(file_path), "startNorm": 0.0, "endNorm": 1.0},
    )
    exported, sample_rate = sf.read(io.BytesIO(base64.b64decode(wav_result["wavBase64"])), dtype="float64")
    assert sample_rate == 8_000
    np.testing.assert_allclose(exported, samples, atol=1.0 / 32768.0)
