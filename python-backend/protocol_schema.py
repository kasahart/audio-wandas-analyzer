"""Backend protocol JSON Schema: the single definition of request payloads and results.

``python protocol_schema.py`` prints the schema; ``scripts/generate-protocol-types.mjs``
turns it into ``src/shared/protocol/generated/backendProtocolSchema.ts`` (TS types plus
the same schema for runtime checks), and ``command_dispatch.validate_request`` checks
requests against it here. Only ``SUPPORTED_KEYWORDS`` may be used: they are the ones
``first_violation`` and its TS mirror in ``schemaValidation.ts`` enforce, and
``unsupported_keyword`` (run by ``dump_schema`` and the generator) rejects anything else so a
keyword can never shape the TS types without also being checked at runtime.

This module must stay importable without numpy so the generator runs on a bare Python.

Every command except ``run-recipe`` is in ``COMMANDS``. ``run-recipe`` keeps its hand-written
validators in ``command_dispatch`` and ``backendProtocol.ts``: its payload embeds a wandas Recipe
document and its result is a list of ChartSpecs, and both have schemas of their own
(``chart_spec.py`` needs ``oneOf``, which this subset leaves out).
The error envelope, the backend notifications, the native ``cancel`` control and the browser Worker's
``limits`` reply are definitions without a command.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any

Schema = dict[str, Any]

MAX_WAVEFORM_POINTS = 8192

SUPPORTED_KEYWORDS = frozenset(
    {
        "$ref",
        "type",
        "enum",
        "const",
        "minimum",
        "maximum",
        "required",
        "properties",
        "additionalProperties",
        "items",
        "anyOf",
        "x-tsType",
    }
)
# ``anyOf`` is limited to the nullable form ``{"anyOf": [schema, {"type": "null"}]}`` with no siblings, so
# both validators can report the inner path of a non-null value instead of choosing between branches.
_NULL: Schema = {"type": "null"}
# enum/const values are limited to JSON scalars so both validators can compare them without deep equality.
_SCALAR_TYPES = (str, int, float, bool, type(None))
_TYPES = frozenset({"object", "array", "string", "number", "integer", "boolean", "null"})
_MAX_SAFE_INTEGER = 2**53 - 1  # Number.MAX_SAFE_INTEGER: larger integers change value in the generated TS.

_BROWSER_LIMIT_KEYS = (
    "maxInputBytes",
    "maxDurationSeconds",
    "maxChannels",
    "minSampleRateHz",
    "maxSampleRateHz",
    "maxSources",
    "maxTotalInputBytes",
    "maxExportBytes",
)

_NUMBER: Schema = {"type": "number"}
_NUMBERS: Schema = {"type": "array", "items": _NUMBER}
_NULLABLE_NUMBERS: Schema = {"type": "array", "items": {"anyOf": [_NUMBER, _NULL]}}

DEFINITIONS: dict[str, Schema] = {
    # Deep calibration validation stays in calibration_profile.py / calibrationModel.ts.
    # No ``type`` so ``null`` keeps meaning "no profile", as for the other commands.
    "CalibrationProfile": {"x-tsType": "CalibrationProfile"},
    # Requests accept any integer like the other commands; results keep the non-negative
    # guarantee hasCalibrationResultMetadata enforces for every other result.
    # Same bounds as isSafeCalibrationValue / calibration_profile._MIN/_MAX_SAFE_CALIBRATION_VALUE.
    "SafeCalibrationValue": {"type": "number", "minimum": 1e-150, "maximum": 1e150},
    "AnalysisRevision": {"type": "integer"},
    "ResultAnalysisRevision": {"type": "integer", "minimum": 0},
    # Ranges and evenness of nFft/overlapPercent stay in analyzer.normalize_stft_options.
    "StftOptions": {
        "type": "object",
        "required": ["nFft", "overlapPercent", "window"],
        "properties": {
            "nFft": {"type": "integer"},
            "overlapPercent": {"type": "number"},
            "window": {"type": "string", "enum": ["hann", "hamming", "blackman", "boxcar"]},
        },
    },
    "WaveformEnvelope": {
        "type": "object",
        "required": ["min", "max", "samples", "absolutePeak"],
        "properties": {
            "min": _NUMBERS,
            "max": _NUMBERS,
            "minT": _NUMBERS,
            "maxT": _NUMBERS,
            "samples": _NUMBERS,
            "absolutePeak": _NUMBER,
        },
    },
    "DbScaleMetadata": {
        "type": "object",
        "required": ["unit", "axisLabel"],
        "properties": {
            "unit": {"type": "string"},
            "axisLabel": {"type": "string"},
            "referenceValue": {"$ref": "#/$defs/SafeCalibrationValue"},
            "referenceUnit": {"type": "string"},
            "levelReferenceLabel": {"type": "string"},
        },
    },
    "AnalysisUnits": {
        "type": "object",
        "required": ["amplitudeLevel", "spectrumLevel", "spectrogramLevel"],
        "properties": {
            "amplitudeLevel": {"$ref": "#/$defs/DbScaleMetadata"},
            "spectrumLevel": {"$ref": "#/$defs/DbScaleMetadata"},
            "spectrogramLevel": {"$ref": "#/$defs/DbScaleMetadata"},
        },
    },
    "ChannelMeasurementContext": {
        "type": "object",
        "required": [
            "calibrationStatus",
            "calibrationSource",
            "factor",
            "linearUnit",
            "referenceValue",
            "referenceUnit",
            "levelUnit",
            "levelReferenceLabel",
        ],
        "properties": {
            "calibrationStatus": {"type": "string", "enum": ["uncalibrated", "calibrated"]},
            "calibrationSource": {"type": "string", "enum": ["default", "manual", "derived", "embedded"]},
            "factor": {"$ref": "#/$defs/SafeCalibrationValue"},
            "linearUnit": {"type": "string"},
            "referenceValue": {"$ref": "#/$defs/SafeCalibrationValue"},
            "referenceUnit": {"type": "string"},
            "levelUnit": {"type": "string"},
            "levelReferenceLabel": {"type": "string"},
        },
    },
    # values must hold timeBins rows of frequencyBins values; that invariant is checked in code.
    "SpectrogramData": {
        "type": "object",
        "required": [
            "values",
            "timeBins",
            "frequencyBins",
            "windowSize",
            "hopSize",
            "maxFrequencyHz",
            "minDb",
            "maxDb",
        ],
        "properties": {
            "values": {"type": "array", "items": _NUMBERS},
            "timeBins": {"type": "integer"},
            "frequencyBins": {"type": "integer"},
            "windowSize": {"type": "integer"},
            "hopSize": {"type": "integer"},
            "maxFrequencyHz": _NUMBER,
            "minDb": _NUMBER,
            "maxDb": _NUMBER,
            "unit": {"type": "string"},
            "axisLabel": {"type": "string"},
            "referenceValue": {"$ref": "#/$defs/SafeCalibrationValue"},
            "referenceUnit": {"type": "string"},
            "levelReferenceLabel": {"type": "string"},
            "timeCentersSec": _NUMBERS,
        },
    },
    "ChannelSummary": {
        "type": "object",
        "required": ["label", "peakAbsolute", "waveform", "spectrogram"],
        "properties": {
            "label": {"type": "string"},
            "unit": {"anyOf": [{"type": "string"}, _NULL]},
            "peakAbsolute": _NUMBER,
            "measurement": {"$ref": "#/$defs/ChannelMeasurementContext"},
            "peakLevelDb": _NUMBER,
            "rawPeakFullScale": _NUMBER,
            "clipped": {"type": "boolean"},
            "waveform": {"$ref": "#/$defs/WaveformEnvelope"},
            # null until track-detail computes it.
            "spectrogram": {"anyOf": [{"$ref": "#/$defs/SpectrogramData"}, _NULL]},
        },
    },
    "AnalyzePayload": {
        "type": "object",
        "required": ["filePath"],
        "properties": {
            "filePath": {"type": "string"},
            "stftOptions": {"$ref": "#/$defs/StftOptions"},
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
        },
    },
    # channels.length === channelCount and the calibration profile's own checks stay in code.
    "AnalysisResult": {
        "type": "object",
        "required": [
            "filePath",
            "fileName",
            "sampleRateHz",
            "durationSeconds",
            "channelCount",
            "sampleCount",
            "channels",
        ],
        "properties": {
            "schemaVersion": {"type": "integer", "const": 2},
            "filePath": {"type": "string"},
            "fileName": {"type": "string"},
            "sampleRateHz": _NUMBER,
            "durationSeconds": _NUMBER,
            "channelCount": {"type": "integer"},
            "sampleCount": {"type": "integer"},
            "calibrationSignature": {"type": "string"},
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
            # Compatibility metadata for results whose channels share one reference.
            "units": {"$ref": "#/$defs/AnalysisUnits"},
            "channels": {"type": "array", "items": {"$ref": "#/$defs/ChannelSummary"}},
        },
    },
    "TrackDetailPayload": {
        "type": "object",
        "required": ["filePath", "trackIndex", "analysisId", "settingsSignature"],
        "properties": {
            "filePath": {"type": "string"},
            "trackIndex": {"type": "integer"},
            "analysisId": {"type": "string"},
            "settingsSignature": {"type": "string"},
            "stftOptions": {"$ref": "#/$defs/StftOptions"},
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
        },
    },
    "TrackDetailResult": {
        "type": "object",
        "required": ["trackIndex", "analysisId", "settingsSignature", "filePath", "channels"],
        "properties": {
            "trackIndex": {"type": "integer"},
            "analysisId": {"type": "string"},
            "settingsSignature": {"type": "string"},
            "filePath": {"type": "string"},
            "channels": {"type": "array", "items": {"$ref": "#/$defs/ChannelSummary"}},
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
        },
    },
    "RangePayload": {
        "type": "object",
        "required": ["filePath", "startNorm", "endNorm", "points"],
        "properties": {
            "filePath": {"type": "string"},
            "startNorm": _NUMBER,
            "endNorm": _NUMBER,
            "points": {"type": "integer", "minimum": 1, "maximum": MAX_WAVEFORM_POINTS},
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
        },
    },
    "SpectrumSlicePayload": {
        "type": "object",
        "required": ["filePath", "trackIndex", "analysisId", "settingsSignature", "cursorNorm"],
        "properties": {
            "filePath": {"type": "string"},
            "trackIndex": {"type": "integer"},
            "analysisId": {"type": "string"},
            "settingsSignature": {"type": "string"},
            "cursorNorm": _NUMBER,
            # Absent for the FFT spectrum; 1 or 3 asks for 1/1 or 1/3 octave bands of the same samples instead.
            "bandsPerOctave": {"type": "integer", "enum": [1, 3]},
            "stftOptions": {"$ref": "#/$defs/StftOptions"},
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
        },
    },
    "RangeResult": {
        "type": "object",
        "required": ["startNorm", "endNorm", "channels"],
        "properties": {
            "startNorm": _NUMBER,
            "endNorm": _NUMBER,
            "channels": {"type": "array", "items": {"$ref": "#/$defs/WaveformEnvelope"}},
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
        },
    },
    "SpectrumSliceChannel": {
        "type": "object",
        "required": ["channelIndex", "values", "minDb", "maxDb"],
        "properties": {
            "channelIndex": {"type": "integer"},
            "values": _NUMBERS,
            "minDb": _NUMBER,
            "maxDb": _NUMBER,
            "unit": {"type": "string"},
            "axisLabel": {"type": "string"},
            "referenceValue": {"$ref": "#/$defs/SafeCalibrationValue"},
            "referenceUnit": {"type": "string"},
            "levelReferenceLabel": {"type": "string"},
        },
    },
    "SpectrumSliceResult": {
        "type": "object",
        "required": [
            "trackIndex",
            "analysisId",
            "settingsSignature",
            "filePath",
            "channels",
            "frequencyBins",
            "maxFrequencyHz",
            "windowStartNorm",
            "windowEndNorm",
            "window",
            "computeMs",
        ],
        "properties": {
            "trackIndex": {"type": "integer"},
            "analysisId": {"type": "string"},
            "settingsSignature": {"type": "string"},
            "filePath": {"type": "string"},
            "channels": {"type": "array", "items": {"$ref": "#/$defs/SpectrumSliceChannel"}},
            "frequencyBins": {"type": "integer"},
            "maxFrequencyHz": _NUMBER,
            # Octave-band results only: the bands' nominal centres and the fixed log axis lower edge.
            "bandsPerOctave": {"type": "integer", "enum": [1, 3]},
            "bandCentersHz": _NUMBERS,
            "minFrequencyHz": _NUMBER,
            "windowStartNorm": _NUMBER,
            "windowEndNorm": _NUMBER,
            "window": {"type": "string", "enum": ["hann", "hamming", "blackman", "boxcar"]},
            "computeMs": _NUMBER,
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
        },
    },
    "PairSource": {
        "type": "object",
        "required": ["filePath", "channelIndex", "offsetSeconds"],
        "properties": {
            "filePath": {"type": "string"},
            "channelIndex": {"type": "integer", "minimum": 0},
            "offsetSeconds": _NUMBER,
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
        },
    },
    # Averages the reference against each response over their overlap on the global timeline,
    # narrowed to [startSeconds, endSeconds] when given.
    "PairSpectrumPayload": {
        "type": "object",
        "required": ["analysisId", "settingsSignature", "reference", "responses"],
        "properties": {
            "analysisId": {"type": "string"},
            "settingsSignature": {"type": "string"},
            "reference": {"$ref": "#/$defs/PairSource"},
            "responses": {"type": "array", "items": {"$ref": "#/$defs/PairSource"}},
            "startSeconds": _NUMBER,
            "endSeconds": _NUMBER,
            "stftOptions": {"$ref": "#/$defs/StftOptions"},
        },
    },
    "PairSpectrumResponse": {
        "type": "object",
        "required": [
            "filePath",
            "channelIndex",
            "status",
            "startSeconds",
            "endSeconds",
            "averages",
            "resampled",
            "gainDb",
            "phaseRad",
            "coherence",
            "unit",
            "axisLabel",
        ],
        "properties": {
            "filePath": {"type": "string"},
            "channelIndex": {"type": "integer"},
            # Empty value arrays unless "ok": the tracks do not overlap, or the overlap is shorter than one window.
            "status": {"type": "string", "enum": ["ok", "no-overlap", "too-short"]},
            "startSeconds": _NUMBER,
            "endSeconds": _NUMBER,
            "averages": {"type": "integer", "minimum": 0},
            "resampled": {"type": "boolean"},
            # null where a quantity is undefined, e.g. the gain where the reference has no power.
            "gainDb": _NULLABLE_NUMBERS,
            "phaseRad": _NULLABLE_NUMBERS,
            "coherence": _NULLABLE_NUMBERS,
            "unit": {"type": "string"},
            "axisLabel": {"type": "string"},
            "referenceValue": {"$ref": "#/$defs/SafeCalibrationValue"},
            "referenceUnit": {"type": "string"},
            "levelReferenceLabel": {"type": "string"},
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
        },
    },
    "PairSpectrumResult": {
        "type": "object",
        "required": [
            "analysisId",
            "settingsSignature",
            "filePath",
            "channelIndex",
            "frequencyBins",
            "maxFrequencyHz",
            "nFft",
            "hopLength",
            "window",
            "computeMs",
            "responses",
        ],
        "properties": {
            "analysisId": {"type": "string"},
            "settingsSignature": {"type": "string"},
            "filePath": {"type": "string"},
            "channelIndex": {"type": "integer"},
            "frequencyBins": {"type": "integer"},
            "maxFrequencyHz": _NUMBER,
            "nFft": {"type": "integer"},
            "hopLength": {"type": "integer"},
            "window": {"type": "string", "enum": ["hann", "hamming", "blackman", "boxcar"]},
            "computeMs": _NUMBER,
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
            "responses": {"type": "array", "items": {"$ref": "#/$defs/PairSpectrumResponse"}},
        },
    },
    "ExportWavLoopPayload": {
        "type": "object",
        "required": ["filePath", "startNorm", "endNorm"],
        "properties": {"filePath": {"type": "string"}, "startNorm": _NUMBER, "endNorm": _NUMBER},
    },
    "ExportWavLoopResult": {
        "type": "object",
        "required": ["wavBase64", "sampleRate"],
        "properties": {"wavBase64": {"type": "string"}, "sampleRate": {"type": "integer"}},
    },
    "ReleaseTrackDetailPayload": {
        "type": "object",
        "required": ["filePath"],
        "properties": {"filePath": {"type": "string"}},
    },
    # Nothing to report; the reply only settles the request.
    "ReleaseTrackDetailResult": {"type": "object", "properties": {}},
    "RecipeChannel": {
        "type": "object",
        "required": ["filePath", "channelIndex"],
        "properties": {"filePath": {"type": "string"}, "channelIndex": {"type": "integer", "minimum": 0}},
    },
    # The bottom panel's analysis: every channel's spectrum of ``filePath`` (octave bands when
    # ``bandsPerOctave`` is set), or with ``referenceChannel`` its transfer function to ``responses``.
    # ``filePath`` also pins the auto STFT size the panel shows.
    "BuildRecipePayload": {
        "type": "object",
        "required": ["filePath"],
        "properties": {
            "filePath": {"type": "string"},
            "stftOptions": {"$ref": "#/$defs/StftOptions"},
            "bandsPerOctave": {"type": "integer", "enum": [1, 3]},
            "referenceChannel": {"type": "integer", "minimum": 0},
            "responses": {"type": "array", "items": {"$ref": "#/$defs/RecipeChannel"}},
        },
    },
    # ``recipe`` is ``RecipePlan.to_dict()``; wandas validates it whenever it is loaded.
    "BuildRecipeResult": {
        "type": "object",
        "required": ["name", "recipe"],
        "properties": {"name": {"type": "string"}, "recipe": {"type": "object"}},
    },
    # Seconds into the file; ``end`` is exclusive like ``ChannelFrame.trim``.
    "ScanRegion": {
        "type": "object",
        "required": ["start", "end"],
        "properties": {"start": {"type": "number", "minimum": 0}, "end": {"type": "number", "minimum": 0}},
    },
    # One file of the entry table: the analysis-spec metrics (analysis_spec.py) of ``region`` (null =
    # the whole file) after ``recipe`` up to its time slice. ``recipe`` is ``RecipePlan.to_dict()``.
    "ScanPayload": {
        "type": "object",
        "required": ["filePath", "recipe"],
        "properties": {
            "filePath": {"type": "string"},
            "recipe": {"type": "object"},
            "region": {"anyOf": [{"$ref": "#/$defs/ScanRegion"}, _NULL]},
            "channels": {"anyOf": [{"type": "array", "items": {"type": "integer", "minimum": 0}}, _NULL]},
            "calibration": {"$ref": "#/$defs/CalibrationProfile"},
            # A step of the Recipe (its node id) whose Frame the result carries as ``stage``.
            "stage": {"anyOf": [{"type": "string"}, _NULL]},
            # The part of the step's picture on screen, drawn from the Frame's full resolution (a zoomed comparison).
            "detail": {"anyOf": [{"$ref": "#/$defs/StageDetail"}, _NULL]},
            # Another recording a cross-channel step (``step``) pairs this one with, and that recording's own Recipe.
            "reference": {"anyOf": [{"$ref": "#/$defs/ScanReference"}, _NULL]},
        },
    },
    "ScanReference": {
        "type": "object",
        "required": ["filePath", "step", "recipe"],
        "properties": {
            "filePath": {"type": "string"},
            "step": {"type": "string"},
            "recipe": {"type": "object"},
            # The reference recording's own calibration, as the host keeps it for that file.
            "calibration": {"$ref": "#/$defs/CalibrationProfile"},
        },
    },
    # A zoomed picture's request: its horizontal (and for an image, vertical) range in the axis's own units
    # (Hz, s, Bark), and how many points across it the screen can show.
    "StageDetail": {
        "type": "object",
        "required": ["x", "points"],
        "properties": {
            "x": {"type": "array", "items": _NUMBER},
            "y": {"type": "array", "items": _NUMBER},
            "points": {"type": "integer", "minimum": 2, "maximum": 8000},
        },
    },
    # One step's Frame as the comparison draws it (stage_view.py). Line and bar give ``values`` over
    # ``xs``; a heatmap gives ``matrix`` rows over ``ys``, columns over ``xs``; "none" is a Frame not drawn.
    "StageView": {
        "type": "object",
        "required": ["frame", "kind"],
        "properties": {
            "frame": {"type": "string"},
            "kind": {"type": "string", "enum": ["line", "bar", "heatmap", "none"]},
            "x": {"type": "string", "enum": ["frequency", "time", "band", "quefrency", "lag"]},
            "xScale": {"type": "string", "enum": ["log", "linear"]},
            "quantity": {
                "type": "string",
                "enum": ["level", "gain", "coherence", "value", "roughness", "cepstrum", "correlation"],
            },
            "unit": {"type": "string"},
            "xs": _NUMBERS,
            "ys": _NUMBERS,
            "yAxis": {"type": "string", "enum": ["frequency", "bark", "quefrency"]},
            "values": _NULLABLE_NUMBERS,
            "matrix": {"type": "array", "items": _NULLABLE_NUMBERS},
            "whole": {"type": "array", "items": {"type": "boolean"}},
            # A cross-channel Frame's one drawn pair: the compared channel (output) over the reference (input), from 1.
            "pair": {
                "type": "object",
                "required": ["output", "input"],
                "properties": {
                    "output": {"type": "integer", "minimum": 1},
                    "input": {"type": "integer", "minimum": 1},
                    # The recording over the base slot's recording (a step measured against it), not two channels.
                    "base": {"type": "boolean"},
                },
            },
            # Set on a picture of only part of its axes (StageDetail): the range it covers.
            "detail": {"type": "boolean"},
            # A time signal's waveform as the lanes draw it: per bucket min and max at the times they occurred.
            "waveform": {
                "type": "object",
                "required": ["min", "max", "minT", "maxT", "absolutePeak", "unit", "ref"],
                "properties": {
                    "min": _NULLABLE_NUMBERS,
                    "max": _NULLABLE_NUMBERS,
                    "minT": _NULLABLE_NUMBERS,
                    "maxT": _NULLABLE_NUMBERS,
                    "absolutePeak": _NUMBER,
                    "unit": {"type": "string"},
                    "ref": _NUMBER,
                },
            },
        },
    },
    "ScanInput": {
        "type": "object",
        "required": ["id", "fs", "channels", "durationS", "unit", "ref"],
        "properties": {
            "id": {"type": "string"},
            "fs": {"type": "integer", "minimum": 1},
            "channels": {"type": "array", "items": {"type": "integer", "minimum": 0}},
            "durationS": _NUMBER,
            "unit": {"type": "string"},
            "ref": _NUMBER,
        },
    },
    # A file that cannot be scanned answers ``ok: false`` with a one-line ``reason`` and nothing else;
    # an ``ok`` result carries every other key. Per-channel arrays follow ``input.channels``.
    "ScanResult": {
        "type": "object",
        "required": ["ok"],
        "properties": {
            "ok": {"type": "boolean"},
            "reason": {"type": "string"},
            "conditionId": {"type": "string"},
            "input": {"$ref": "#/$defs/ScanInput"},
            "leqDbA": _NUMBERS,
            "peakHz": {"type": "array", "items": {"type": "integer"}},
            "spectrumDb": {"type": "array", "items": _NUMBERS},
            "thirdOctDb": {"type": "array", "items": _NULLABLE_NUMBERS},
            "crest": _NUMBERS,
            "specVersion": {"type": "integer", "minimum": 1},
            "wandasVersion": {"type": "string"},
            "elapsedMs": _NUMBER,
            # The type of the Frame the Recipe's chain ends in, e.g. "SpectralFrame".
            "endFrame": {"type": "string"},
            "stage": {"$ref": "#/$defs/StageView"},
            # With ``ok: false``: the Recipe step (node id) that failed on this file.
            "failedStep": {"type": "string"},
        },
    },
    # Codes from backend_errors.py; hosts branch on them, never on the message text.
    "BackendErrorPayload": {
        "type": "object",
        "required": ["code", "message"],
        "properties": {
            "code": {"type": "string", "enum": ["input-error", "stale-calibration", "internal-error"]},
            "message": {"type": "string"},
        },
    },
    "BackendReadyNotification": {
        "type": "object",
        "required": ["type"],
        "properties": {"type": {"type": "string", "const": "ready"}},
    },
    "BackendHeartbeatNotification": {
        "type": "object",
        "required": ["type", "ts"],
        "properties": {"type": {"type": "string", "const": "heartbeat"}, "ts": _NUMBER},
    },
    # Native host → backend: drop these queued requests and send no reply for the running ones. No reply of its own.
    "BackendCancelControl": {
        "type": "object",
        "required": ["cmd", "requestIds"],
        "properties": {
            "cmd": {"type": "string", "const": "cancel"},
            "requestIds": {"type": "array", "items": {"type": "string"}},
        },
    },
    # browser_service.browser_limits(); bounded so a skewed Worker cannot disable the host's pre-checks.
    "BrowserLimits": {
        "type": "object",
        # The host's file and export pre-checks read these four; the rest are published for the README.
        "required": ["maxInputBytes", "maxSources", "maxTotalInputBytes", "maxExportBytes"],
        "properties": {
            key: {"type": "integer", "minimum": 1, "maximum": _MAX_SAFE_INTEGER} for key in _BROWSER_LIMIT_KEYS
        },
    },
}


def _close_objects(schema: Schema) -> None:
    """Give every object that lists its ``properties`` ``additionalProperties: false`` (#224).

    Both sides ship together, so a key one side sends and the other does not define is a bug, not a
    newer peer. ``CalibrationProfile`` lists no properties and stays open for its own validator.
    """
    if "properties" in schema:
        schema["additionalProperties"] = False
        for child in schema["properties"].values():
            _close_objects(child)
    if "items" in schema:
        _close_objects(schema["items"])
    if "anyOf" in schema:
        _close_objects(schema["anyOf"][0])


for _definition in DEFINITIONS.values():
    _close_objects(_definition)

COMMANDS: dict[str, dict[str, str]] = {
    "analyze": {"payload": "AnalyzePayload", "result": "AnalysisResult"},
    "track-detail": {"payload": "TrackDetailPayload", "result": "TrackDetailResult"},
    "range": {"payload": "RangePayload", "result": "RangeResult"},
    "spectrum-slice": {"payload": "SpectrumSlicePayload", "result": "SpectrumSliceResult"},
    "pair-spectrum": {"payload": "PairSpectrumPayload", "result": "PairSpectrumResult"},
    "export-wav-loop": {"payload": "ExportWavLoopPayload", "result": "ExportWavLoopResult"},
    "release-track-detail": {"payload": "ReleaseTrackDetailPayload", "result": "ReleaseTrackDetailResult"},
    "build-recipe": {"payload": "BuildRecipePayload", "result": "BuildRecipeResult"},
    "scan": {"payload": "ScanPayload", "result": "ScanResult"},
}


def _is_literal(value: object, declared_type: object) -> bool:
    """A JSON scalar that survives the trip to a JS number and matches the node's ``type``, if any."""
    if not isinstance(value, _SCALAR_TYPES):
        return False
    if isinstance(value, float) and not math.isfinite(value):
        return False  # json.dump would emit NaN/Infinity, which JSON.parse rejects.
    integral = (isinstance(value, int) and not isinstance(value, bool)) or (
        isinstance(value, float) and value.is_integer()
    )
    if integral and abs(value) > _MAX_SAFE_INTEGER:  # Compared exactly; float(10**400) would overflow.
        return False
    return declared_type is None or _matches_type(declared_type, value)  # type: ignore[arg-type]


def unsupported_keyword(schema: object = None, path: str = "$defs") -> str | None:
    """Path of the first keyword the validators cannot enforce exactly (all definitions by default), or None.

    Besides keywords outside ``SUPPORTED_KEYWORDS`` that covers unresolvable ``$ref``s, ``$ref`` with
    sibling keywords (resolution would drop them), unknown type names, ``additionalProperties`` other
    than ``false`` beside ``properties``, ``anyOf`` other than the nullable
    form, ``enum`` together with ``const``, enum/const beside ``minimum``/``maximum``, and enum/const values
    that are not finite JSON scalars, lose precision as JS numbers, or contradict the node's ``type``.
    """
    if schema is None:
        for name, definition in DEFINITIONS.items():
            found = unsupported_keyword(definition, f"$defs.{name}")
            if found is not None:
                return found
        return None
    if not isinstance(schema, dict):
        return None
    declared_type = schema.get("type")
    # Literal types are emitted as-is, so bounds beside enum/const would make them wider than validation.
    bounded = "minimum" in schema or "maximum" in schema
    for key, child in schema.items():
        if key not in SUPPORTED_KEYWORDS:
            return f"{path}.{key}"
        if key == "$ref" and (
            len(schema) > 1
            or not isinstance(child, str)
            or not child.startswith("#/$defs/")
            or child.removeprefix("#/$defs/") not in DEFINITIONS
        ):
            return f"{path}.$ref"
        if key == "additionalProperties" and (child is not False or "properties" not in schema):
            return f"{path}.additionalProperties"
        if key == "type" and (not isinstance(child, str) or child not in _TYPES):
            return f"{path}.type"
        if key == "const" and ("enum" in schema or bounded or not _is_literal(child, declared_type)):
            return f"{path}.const"
        if key == "enum" and (
            bounded
            or not isinstance(child, list)
            or not child
            or not all(_is_literal(item, declared_type) for item in child)
        ):
            return f"{path}.enum"
        if key == "anyOf" and (
            len(schema) > 1
            or not isinstance(child, list)
            or len(child) != 2
            or child[1] != _NULL
            or not isinstance(child[0], dict)
            or "anyOf" in child[0]
            or child[0] == _NULL
        ):
            return f"{path}.anyOf"
        nested = (
            child.items()
            if key == "properties"
            else [(key, child)]
            if key == "items"
            else [("anyOf[0]", child[0])]
            if key == "anyOf"
            else []
        )
        for name, node in nested:
            found = unsupported_keyword(node, f"{path}.{name}")
            if found is not None:
                return found
    return None


def dump_schema() -> Schema:
    unsupported = unsupported_keyword()
    if unsupported is not None:
        raise ValueError(f"protocol schema uses an unsupported keyword or unknown $ref at {unsupported}")
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": DEFINITIONS,
        "x-commands": COMMANDS,
        "x-requestEnvelopeKeys": sorted(REQUEST_ENVELOPE_KEYS),
        "x-responseEnvelopeKeys": sorted(RESPONSE_ENVELOPE_KEYS),
    }


def _resolve(schema: Schema) -> Schema:
    while "$ref" in schema:
        schema = DEFINITIONS[schema["$ref"].removeprefix("#/$defs/")]
    return schema


def _matches_type(expected: str, value: object) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, int):
        return True  # Python ints are exact; math.isfinite would overflow on huge ones.
    # JSON Schema: a float with no fractional part (2000.0) is an integer, as in schemaValidation.ts.
    return math.isfinite(value) and (expected == "number" or value.is_integer())


def _json_equal(left: object, right: object) -> bool:
    """JSON Schema scalar equality: ``1`` equals ``1.0`` but ``true`` never equals ``1``."""
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    return left == right


def first_violation(schema: Schema, value: object, path: str = "") -> str | None:
    """Return the dotted path of the first value that breaks ``schema`` (``""`` for the root), or None."""
    schema = _resolve(schema)
    if "anyOf" in schema:
        return None if value is None else first_violation(schema["anyOf"][0], value, path)
    if "type" in schema and not _matches_type(schema["type"], value):
        return path
    if "const" in schema and not _json_equal(value, schema["const"]):
        return path
    if "enum" in schema and not any(_json_equal(value, item) for item in schema["enum"]):
        return path
    numeric = isinstance(value, (int, float)) and not isinstance(value, bool)
    if numeric and "minimum" in schema and value < schema["minimum"]:  # type: ignore[operator]
        return path
    if numeric and "maximum" in schema and value > schema["maximum"]:  # type: ignore[operator]
        return path
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in properties:
                    return f"{path}.{key}" if path else key
        for key in schema.get("required", []):
            if key not in value:
                return f"{path}.{key}" if path else key
        for key, child in properties.items():
            if key in value:
                found = first_violation(child, value[key], f"{path}.{key}" if path else key)
                if found is not None:
                    return found
    if isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            found = first_violation(schema["items"], item, f"{path}[{index}]")
            if found is not None:
                return found
    return None


# Envelope keys travel beside the payload or result fields but belong to no schema. Replies carry
# only ``requestId``, so a ``cmd`` in a reply is reported as an unknown result field.
REQUEST_ENVELOPE_KEYS = frozenset({"cmd", "requestId"})
RESPONSE_ENVELOPE_KEYS = frozenset({"requestId"})


def payload_violation(command: str, value: object) -> str | None:
    """Path of the first invalid payload field for a schema-defined command, or None when valid.

    ``value`` may be the whole request: its ``cmd`` and ``requestId`` are not payload fields.
    """
    if isinstance(value, dict):
        value = {key: item for key, item in value.items() if key not in REQUEST_ENVELOPE_KEYS}
    return first_violation(DEFINITIONS[COMMANDS[command]["payload"]], value)


def result_violation(command: str, value: object) -> str | None:
    """Path of the first result field that breaks the schema-defined command's result, or None.

    ``value`` may be the whole reply line: the backend emits ``requestId`` beside the result fields.
    """
    if isinstance(value, dict):
        value = {key: item for key, item in value.items() if key not in RESPONSE_ENVELOPE_KEYS}
    return first_violation(DEFINITIONS[COMMANDS[command]["result"]], value)


if __name__ == "__main__":
    json.dump(dump_schema(), sys.stdout, indent=2)
    sys.stdout.write("\n")
