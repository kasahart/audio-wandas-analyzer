from __future__ import annotations

import hashlib
import json
import math
import numbers
from dataclasses import dataclass
from typing import Literal

import wandas as wd

CalibrationStatus = Literal["uncalibrated", "calibrated"]
CalibrationSource = Literal["default", "manual", "derived", "embedded"]

_ALLOWED_STATUSES = frozenset({"uncalibrated", "calibrated"})
_ALLOWED_SOURCES = frozenset({"default", "manual", "derived", "embedded"})


@dataclass(frozen=True, slots=True)
class ResolvedChannelCalibration:
    channel_index: int
    expected_label: str
    status: CalibrationStatus
    source: CalibrationSource
    factor: float
    unit: str
    reference_value: float

    def to_dict(self) -> dict[str, object]:
        return {
            "channelIndex": self.channel_index,
            "expectedLabel": self.expected_label,
            "status": self.status,
            "source": self.source,
            "factor": self.factor,
            "unit": self.unit,
            "referenceValue": self.reference_value,
        }

    def to_wandas(self) -> wd.ChannelCalibration:
        return wd.ChannelCalibration(
            factor=self.factor,
            unit=self.unit,
            ref=self.reference_value,
        )


@dataclass(frozen=True, slots=True)
class ResolvedCalibrationProfile:
    schema_version: int
    channels: tuple[ResolvedChannelCalibration, ...]
    signature: str

    @property
    def is_identity(self) -> bool:
        return all(channel.status == "uncalibrated" for channel in self.channels)

    def apply(self, frame: wd.ChannelFrame) -> wd.ChannelFrame:
        if self.is_identity:
            return frame
        return frame.with_calibration([channel.to_wandas() for channel in self.channels])

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": self.schema_version,
            "channels": [channel.to_dict() for channel in self.channels],
        }


def _finite_positive(value: object, *, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        raise TypeError(f"{name} must be a positive finite number")
    normalized = float(value)
    if not math.isfinite(normalized) or normalized <= 0.0:
        raise ValueError(f"{name} must be a positive finite number")
    return normalized


def _identity_channel(index: int, label: str) -> ResolvedChannelCalibration:
    return ResolvedChannelCalibration(
        channel_index=index,
        expected_label=label,
        status="uncalibrated",
        source="default",
        factor=1.0,
        unit="",
        reference_value=1.0,
    )


def _signature(profile_payload: dict[str, object]) -> str:
    canonical = json.dumps(profile_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def resolve_calibration_profile(
    payload: object,
    frame: wd.ChannelFrame,
) -> ResolvedCalibrationProfile:
    labels = [str(label) for label in frame.labels]
    if payload is None:
        channels = tuple(_identity_channel(index, label) for index, label in enumerate(labels))
        normalized = {"schemaVersion": 1, "channels": [channel.to_dict() for channel in channels]}
        return ResolvedCalibrationProfile(1, channels, _signature(normalized))

    if not isinstance(payload, dict):
        raise TypeError("calibrationProfile must be an object")
    if payload.get("schemaVersion") != 1:
        raise ValueError("calibrationProfile.schemaVersion must be 1")
    raw_channels = payload.get("channels")
    if not isinstance(raw_channels, list):
        raise TypeError("calibrationProfile.channels must be an array")
    if len(raw_channels) != len(labels):
        raise ValueError(
            "Calibration channel count mismatch\n"
            f"  Got: {len(raw_channels)} channels\n"
            f"  Expected: {len(labels)} channels"
        )

    resolved_by_index: dict[int, ResolvedChannelCalibration] = {}
    for raw in raw_channels:
        if not isinstance(raw, dict):
            raise TypeError("Each calibration channel must be an object")
        index = raw.get("channelIndex")
        if isinstance(index, bool) or not isinstance(index, int):
            raise TypeError("Calibration channelIndex must be an integer")
        if index < 0 or index >= len(labels):
            raise ValueError(f"Calibration channelIndex out of range: {index}")
        if index in resolved_by_index:
            raise ValueError(f"Duplicate calibration channelIndex: {index}")

        expected_label = raw.get("expectedLabel")
        if not isinstance(expected_label, str):
            raise TypeError("Calibration expectedLabel must be a string")
        if expected_label != labels[index]:
            raise ValueError(
                "Calibration channel label mismatch\n"
                f"  Channel: {index}\n"
                f"  Profile: {expected_label!r}\n"
                f"  Audio: {labels[index]!r}"
            )

        status = raw.get("status")
        if status not in _ALLOWED_STATUSES:
            raise ValueError(f"Unsupported calibration status: {status!r}")
        source = raw.get("source", "manual" if status == "calibrated" else "default")
        if source not in _ALLOWED_SOURCES:
            raise ValueError(f"Unsupported calibration source: {source!r}")

        if status == "uncalibrated":
            resolved_by_index[index] = _identity_channel(index, expected_label)
            continue

        factor = _finite_positive(raw.get("factor"), name="Calibration factor")
        unit = raw.get("unit")
        if not isinstance(unit, str):
            raise TypeError("Calibration unit must be a string")
        normalized_unit = unit.strip()
        if not normalized_unit:
            raise ValueError("Calibrated channels require a unit; use '1' for a dimensionless quantity")
        reference_value = _finite_positive(raw.get("referenceValue"), name="Calibration referenceValue")
        resolved_by_index[index] = ResolvedChannelCalibration(
            channel_index=index,
            expected_label=expected_label,
            status="calibrated",
            source=source,
            factor=factor,
            unit=normalized_unit,
            reference_value=reference_value,
        )

    channels = tuple(resolved_by_index[index] for index in range(len(labels)))
    normalized = {"schemaVersion": 1, "channels": [channel.to_dict() for channel in channels]}
    return ResolvedCalibrationProfile(1, channels, _signature(normalized))


def format_reference_value(value: float) -> str:
    if math.isclose(value, 2e-5, rel_tol=0.0, abs_tol=1e-15):
        return "20 µ"
    if value == 1.0:
        return "1"
    return f"{value:.6g}"


def measurement_metadata(channel: ResolvedChannelCalibration) -> dict[str, object]:
    if channel.status == "uncalibrated":
        linear_unit = "FS"
        reference_unit = "FS"
        level_unit = "dBFS"
        level_reference_label = "dBFS"
    else:
        linear_unit = channel.unit
        reference_unit = channel.unit
        if channel.unit == "Pa" and math.isclose(channel.reference_value, 2e-5, rel_tol=0.0, abs_tol=1e-15):
            level_unit = "dB SPL"
            level_reference_label = "dB SPL re 20 µPa"
        else:
            level_unit = "dB"
            level_reference_label = f"dB re {format_reference_value(channel.reference_value)} {channel.unit}"

    return {
        "calibrationStatus": channel.status,
        "calibrationSource": channel.source,
        "factor": channel.factor,
        "linearUnit": linear_unit,
        "referenceValue": channel.reference_value,
        "referenceUnit": reference_unit,
        "levelUnit": level_unit,
        "levelReferenceLabel": level_reference_label,
    }


def amplitude_level(value: float, reference_value: float) -> float:
    ratio = max(abs(float(value)) / float(reference_value), 1e-12)
    return 20.0 * math.log10(ratio)


def level_scale_metadata(
    measurement: dict[str, object],
    quantity_label: str,
) -> dict[str, object]:
    reference_label = str(measurement["levelReferenceLabel"])
    return {
        "unit": str(measurement["levelUnit"]),
        "axisLabel": f"{quantity_label} [{reference_label}]",
        "referenceValue": float(measurement["referenceValue"]),
        "referenceUnit": str(measurement["referenceUnit"]),
        "levelReferenceLabel": reference_label,
    }


__all__ = [
    "ResolvedCalibrationProfile",
    "ResolvedChannelCalibration",
    "amplitude_level",
    "level_scale_metadata",
    "measurement_metadata",
    "resolve_calibration_profile",
]
