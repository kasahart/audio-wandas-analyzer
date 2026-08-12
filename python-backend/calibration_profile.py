from __future__ import annotations

import hashlib
import json
import math
import numbers
from dataclasses import dataclass
from typing import Literal

import numpy as np
import wandas as wd

CalibrationStatus = Literal["uncalibrated", "calibrated"]
CalibrationSource = Literal["default", "manual", "derived", "embedded"]

_ALLOWED_STATUSES = frozenset({"uncalibrated", "calibrated"})
_ALLOWED_SOURCES = frozenset({"default", "manual", "derived", "embedded"})
_MIN_SAFE_CALIBRATION_VALUE = 1e-150
_MAX_SAFE_CALIBRATION_VALUE = 1e150
# The largest supported STFT has 16384 samples and is cached as complex64.
_MAX_SAFE_CALIBRATED_SAMPLE = 1e34


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
        return frame.with_calibration(
            {channel.channel_index: channel.to_wandas() for channel in self.channels if channel.status == "calibrated"}
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": self.schema_version,
            "channels": [channel.to_dict() for channel in self.channels],
        }


def _finite_positive(value: object, *, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        raise TypeError(f"{name} must be a positive finite number")
    normalized = float(value)
    if (
        not math.isfinite(normalized)
        or normalized < _MIN_SAFE_CALIBRATION_VALUE
        or normalized > _MAX_SAFE_CALIBRATION_VALUE
    ):
        raise ValueError(f"{name} must be between 1e-150 and 1e150")
    return normalized


def _uncalibrated_channel(
    frame: wd.ChannelFrame,
    index: int,
    label: str,
) -> ResolvedChannelCalibration:
    calibration = frame.channels[index].calibration
    return ResolvedChannelCalibration(
        channel_index=index,
        expected_label=label,
        status="uncalibrated",
        source="default",
        factor=float(calibration.factor),
        unit=str(calibration.unit),
        reference_value=float(calibration.ref),
    )


def _validate_factor_for_source(
    factor: float,
    channel_index: int,
    source_peak: float,
) -> None:
    if not math.isfinite(source_peak):
        raise ValueError(f"Source channel {channel_index} contains non-finite samples")
    if source_peak == 0.0:
        return
    maximum = min(_MAX_SAFE_CALIBRATION_VALUE, _MAX_SAFE_CALIBRATED_SAMPLE / source_peak)
    if factor > maximum:
        raise ValueError(
            f"Calibration factor for channel {channel_index} exceeds the safe limit "
            f"{maximum:.6g} for source peak {source_peak:.6g}"
        )


def source_channel_peaks(frame: wd.ChannelFrame) -> tuple[float, ...]:
    return tuple(
        float(np.max(np.abs(np.asarray(frame[index].data, dtype=np.float64)), initial=0.0))
        for index in range(int(frame.n_channels))
    )


def _signature(profile_payload: dict[str, object]) -> str:
    canonical = json.dumps(profile_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def resolve_calibration_profile(
    payload: object,
    frame: wd.ChannelFrame,
    *,
    source_peaks: tuple[float, ...] | None = None,
) -> ResolvedCalibrationProfile:
    labels = [str(label) for label in frame.labels]
    if payload is None:
        channels = tuple(_uncalibrated_channel(frame, index, label) for index, label in enumerate(labels))
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
    peaks = (
        source_peaks if source_peaks is not None and len(source_peaks) == len(labels) else source_channel_peaks(frame)
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
            resolved_by_index[index] = _uncalibrated_channel(frame, index, expected_label)
            continue

        factor = _finite_positive(raw.get("factor"), name="Calibration factor")
        _validate_factor_for_source(factor, index, peaks[index])
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


__all__ = [
    "ResolvedCalibrationProfile",
    "ResolvedChannelCalibration",
    "resolve_calibration_profile",
    "source_channel_peaks",
]
