"""Backend protocol JSON Schema: the single definition of request payloads and results.

``python protocol_schema.py`` prints the schema; ``scripts/generate-protocol-types.mjs``
turns it into ``src/shared/protocol/generated/backendProtocolSchema.ts`` (TS types plus
the same schema for runtime checks), and ``command_dispatch.validate_request`` checks
requests against it here. Only ``SUPPORTED_KEYWORDS`` may be used: they are the ones
``first_violation`` and its TS mirror in ``schemaValidation.ts`` enforce, and
``unsupported_keyword`` (run by ``dump_schema`` and the generator) rejects anything else so a
keyword can never shape the TS types without also being checked at runtime.

This module must stay importable without numpy so the generator runs on a bare Python.

Every command is in ``COMMANDS``.
The error envelope, the backend notifications, the native ``cancel`` control and the browser Worker's
``limits`` reply are definitions without a command.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any

Schema = dict[str, Any]


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
        "x-drawn",
        "x-whole",
        "x-place",
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
    "maxChannels",
    "minSampleRateHz",
    "maxSampleRateHz",
    "maxSources",
    "maxTotalInputBytes",
    "maxExportBytes",
)

_NUMBER: Schema = {"type": "number"}
# Every array of numbers says which of three things it holds, so no array of thinned points can pass for data
# (test_protocol_schema.py fails on an array that says none, or more than one):
#
# - ``x-drawn``: points thinned to be drawn (a line's buckets, an image's pooled cells, a signal's band). Only a
#   figure's picture has them (the ``Figure…`` definitions; the generator refuses the marker anywhere else). It makes
#   the generated TypeScript type ``FigureDrawn``, which no code can compute with or write as text and only
#   src/webview/figure/ may import, so a number a user reads is never taken of these arrays.
# - ``x-whole``: every value of the data, none left out: a scan's every bin and band, a number taken per channel of
#   every sample.
# - ``x-place``: not data values at all: where points sit along an axis (a picture's ``xs``), an axis's limits,
#   band centres, bin edges, a request's window in pixels.
#
# The markers carry no constraint on the wire. When you add an array, choose by asking: did anything upstream pick
# some of the values and drop others (``x-drawn``), or is this every one (``x-whole``)?
_DRAWN: Schema = {"type": "number", "x-drawn": True}
_DRAWN_LINE: Schema = {"type": "array", "items": _DRAWN}
_DRAWN_GAPPED: Schema = {"type": "array", "items": {"anyOf": [_DRAWN, _NULL]}}
_WHOLE: Schema = {"type": "number", "x-whole": True}
_WHOLE_LINE: Schema = {"type": "array", "items": _WHOLE}
_WHOLE_GAPPED: Schema = {"type": "array", "items": {"anyOf": [_WHOLE, _NULL]}}
_PLACE: Schema = {"type": "number", "x-place": True}
_PLACES: Schema = {"type": "array", "items": _PLACE}
_FIGURE_AXIS: dict[str, Schema] = {
    # ``value``: a time signal's own values (a band lane). ``count``: table rows counted (a bins lane).
    "quantity": {"type": "string", "enum": ["level", "delta", "value", "count"]},
    "unit": {"type": "string"},
    "reference": _NUMBER,
    "referenceLabel": {"type": "string"},
    "calibration": {"type": "string", "enum": ["calibrated", "uncalibrated", "unknown"]},
    "xScale": {"type": "string", "enum": ["log", "linear"]},
    "yScale": {"type": "string", "enum": ["log", "linear"]},
    # A lane of lines says what its axes are named of (the words are layer 3's): what is across, what the values
    # measure (of a Δ lane: what the Δ is of), the unit they are written in, the measure of a series over time
    # (stage_view.measure_of) and the channel pair of a cross-channel answer.
    # (A band lane's: "time", or "triggerTime" for a trigger's events, over the time from their trigger.)
    "x": {"type": "string", "enum": ["frequency", "time", "quefrency", "lag", "band", "triggerTime"]},
    "of": {
        "type": "string",
        "enum": ["level", "gain", "value", "coherence", "phase", "cepstrum", "correlation", "roughness"],
    },
    # An image lane says what its rows are over (a spectrogram's frequencies, a roughness's Bark bands, a
    # cepstrogram's quefrencies).
    "y": {"type": "string", "enum": ["frequency", "bark", "quefrency"]},
    "valueUnit": {"type": "string"},
    "measure": {"type": "string", "enum": ["amplitude", "rms", "timeWeightedRms", "power", "unknown"]},
    "measureExponent": {"type": "number"},
    "pair": {
        "type": "object",
        "required": ["output", "input"],
        "properties": {
            "output": {"type": "integer", "minimum": 1},
            "input": {"type": "integer", "minimum": 1},
            "base": {"type": "boolean"},
        },
    },
}

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
    "ChannelSummary": {
        "type": "object",
        "required": [
            "label",
            "peakAbsolute",
            "fullScale",
            "sourceUnit",
            "sourceLevelReferenceLabel",
        ],
        "properties": {
            "label": {"type": "string"},
            "unit": {"anyOf": [{"type": "string"}, _NULL]},
            "peakAbsolute": _NUMBER,
            "measurement": {"$ref": "#/$defs/ChannelMeasurementContext"},
            "peakLevelDb": _NUMBER,
            "rawPeakFullScale": _NUMBER,
            # false: the source (a CSV) holds raw input units, so uncalibrated levels are dB re 1 input unit, not dBFS.
            "fullScale": {"type": "boolean"},
            # wandas' unit and level label for the source as read, before calibration:
            # "FS" / "dBFS" for audio, "" / "dB re 1 input unit" for a CSV.
            "sourceUnit": {"type": "string"},
            "sourceLevelReferenceLabel": {"type": "string"},
            # null: the source (a CSV) has no full scale to clip against.
            "clipped": {"anyOf": [{"type": "boolean"}, _NULL]},
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
            "sourceVersion": {"type": "string"},
            # The STFT the answer is taken with (window/hop/window name): not read over an analysis of another.
            "stftSignature": {"type": "string"},
            # Compatibility metadata for results whose channels share one reference.
            "units": {"$ref": "#/$defs/AnalysisUnits"},
            "channels": {"type": "array", "items": {"$ref": "#/$defs/ChannelSummary"}},
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
            # The version of the file the asking track was drawn from: a file changed since is refused (stale-source).
            "sourceVersion": {"type": "string"},
        },
    },
    # The largest |sample| of the channels named, each over its own stretch (the file's 0..1, both ends in): one
    # answer of every sample (a new trigger's level starts at half of it). ``channels`` empty: every channel.
    "RegionPeakSource": {
        "type": "object",
        "required": ["filePath", "channels", "startNorm", "endNorm"],
        "properties": {
            "filePath": {"type": "string"},
            "channels": {"type": "array", "items": {"type": "integer", "minimum": 0}},
            "startNorm": _NUMBER,
            "endNorm": _NUMBER,
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
            # The version of the file the asking track was drawn from: a file changed since is refused (stale-source).
            "sourceVersion": {"type": "string"},
        },
    },
    "RegionPeakPayload": {
        "type": "object",
        "required": ["sources"],
        "properties": {"sources": {"type": "array", "items": {"$ref": "#/$defs/RegionPeakSource"}}},
    },
    "RegionPeakResult": {"type": "object", "required": ["peak"], "properties": {"peak": _NUMBER}},
    # Averages the reference against each response over their overlap on the global timeline,
    # narrowed to [startSeconds, endSeconds] when given.
    # The cursor spectrum's answers kept for the figure service (tracks_answers.py): the request names the file, the
    # cursor and how the frequency axis is drawn; the reply names each channel's
    # kept line by its key and says the window it is of. No value is sent: the Figure draws and reads them by key.
    "CursorAnswersPayload": {
        "type": "object",
        "required": ["filePath", "cursorNorm"],
        "properties": {
            "filePath": {"type": "string"},
            "cursorNorm": _NUMBER,
            # Absent for the FFT spectrum; 1 or 3 asks for 1/1 or 1/3 octave bands of the same samples instead.
            "bandsPerOctave": {"type": "integer", "enum": [1, 3]},
            # How the frequency axis is drawn (log when absent); bands are always on a log axis.
            "scale": {"type": "string", "enum": ["log", "linear"]},
            "stftOptions": {"$ref": "#/$defs/StftOptions"},
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
            # The version of the file the asking track was drawn from: a file changed since is refused (stale-source).
            "sourceVersion": {"type": "string"},
        },
    },
    # A Tracks row's answers kept for the figure service (tracks_answers.py): the request names the file, how the
    # spectrogram's frequency axis is drawn and, for a zoomed row, the time on screen; the reply names each channel's
    # kept samples and kept STFT levels by their keys. No value is sent: the Figure draws and reads them by key.
    "TrackAnswersPayload": {
        "type": "object",
        "required": ["filePath"],
        "properties": {
            "filePath": {"type": "string"},
            # How the spectrogram's frequency axis is drawn (linear when absent).
            "scale": {"type": "string", "enum": ["log", "linear"]},
            # The time on screen (fractions of the file): with the automatic STFT settings the levels are of this
            # window's own STFT (R3); absent for the whole file.
            "startNorm": _NUMBER,
            "endNorm": _NUMBER,
            # false: the samples alone (the row shows no spectrogram).
            "spectrogram": {"type": "boolean"},
            # true: the whole file's extents alone (``signalExtent``, ``imageExtent``), for a recording that takes
            # part in the rows' linked scale and is not on screen: its samples and levels are not kept.
            "extents": {"type": "boolean"},
            "stftOptions": {"$ref": "#/$defs/StftOptions"},
            "calibrationProfile": {"$ref": "#/$defs/CalibrationProfile"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
            # The version of the file the asking track was drawn from: a file changed since is refused (stale-source).
            "sourceVersion": {"type": "string"},
        },
    },
    "TrackAnswersResult": {
        "type": "object",
        "required": [
            "filePath",
            "channels",
            "sampleRateHz",
            "durationSeconds",
            "windowSize",
            "hopSize",
            "windowed",
            "calibrationSignature",
            "analysisRevision",
            "sourceVersion",
            "stftSignature",
        ],
        "properties": {
            "filePath": {"type": "string"},
            "channels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["channelIndex", "level", "unit"],
                    "properties": {
                        "channelIndex": {"type": "integer"},
                        # What the channel's levels are in (the spectrogram's colour).
                        "level": {"$ref": "#/$defs/FigureLevel"},
                        # The unit the samples are in ("" where it has none).
                        "unit": {"type": "string"},
                        # The kept answers' keys (each one's version is the key itself); absent when the store
                        # refused it (over the budget) or the row asked for no spectrogram.
                        "signal": {"type": "string"},
                        "image": {"type": "string"},
                        # The keys of the channel's extents (the least and the most of its samples; of its
                        # whole-file STFT's levels): what the other rows' lanes share their scale with.
                        "signalExtent": {"type": "string"},
                        "imageExtent": {"type": "string"},
                    },
                },
            },
            "sampleRateHz": _NUMBER,
            "durationSeconds": _NUMBER,
            # The STFT the levels are of; windowed: of the time window asked for alone.
            "windowSize": {"type": "integer"},
            "hopSize": {"type": "integer"},
            "windowed": {"type": "boolean"},
            # Why no channel names levels though they were asked for (the recording is shorter than half the STFT's
            # window). Without it, a channel with no key was refused by the store (too large to keep).
            "noLevels": {"type": "string", "enum": ["too-short"]},
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/AnalysisRevision"},
            "sourceVersion": {"type": "string"},
            "stftSignature": {"type": "string"},
        },
    },
    "CursorAnswersResult": {
        "type": "object",
        "required": [
            "filePath",
            "channels",
            "windowStartNorm",
            "windowEndNorm",
            "window",
            "calibrationSignature",
            "analysisRevision",
            "sourceVersion",
            "stftSignature",
        ],
        "properties": {
            "filePath": {"type": "string"},
            "channels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["channelIndex", "level"],
                    "properties": {
                        "channelIndex": {"type": "integer"},
                        # What the channel's levels are in: the spec puts the lines of one identity on one lane.
                        "level": {"$ref": "#/$defs/FigureLevel"},
                        # The kept line's key (its version is the key itself); absent when the store refused it.
                        "key": {"type": "string"},
                    },
                },
            },
            "windowStartNorm": _NUMBER,
            "windowEndNorm": _NUMBER,
            "window": {"type": "string", "enum": ["hann", "hamming", "blackman", "boxcar"]},
            "bandsPerOctave": {"type": "integer", "enum": [1, 3]},
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
            "sourceVersion": {"type": "string"},
            "stftSignature": {"type": "string"},
        },
    },
    # The pair figure's answers kept for the figure service: each response that can
    # be averaged names its three kept lines (gain in dB, phase in degrees, coherence) by key.
    "PairAnswersPayload": {
        "type": "object",
        "required": ["reference", "responses"],
        "properties": {
            "reference": {"$ref": "#/$defs/PairSource"},
            "responses": {"type": "array", "items": {"$ref": "#/$defs/PairSource"}},
            "startSeconds": _NUMBER,
            "endSeconds": _NUMBER,
            "scale": {"type": "string", "enum": ["log", "linear"]},
            "stftOptions": {"$ref": "#/$defs/StftOptions"},
        },
    },
    "PairAnswersResponse": {
        "type": "object",
        "required": [
            "filePath",
            "channelIndex",
            "status",
            "startSeconds",
            "endSeconds",
            "averages",
            "resampled",
            "calibrationStatus",
            "calibrationSignature",
            "analysisRevision",
            "sourceVersion",
        ],
        "properties": {
            "filePath": {"type": "string"},
            "channelIndex": {"type": "integer"},
            # No keys unless "ok": the tracks do not overlap, or the overlap is shorter than one window.
            "status": {"type": "string", "enum": ["ok", "no-overlap", "too-short"]},
            "startSeconds": _NUMBER,
            "endSeconds": _NUMBER,
            "averages": {"type": "integer", "minimum": 0},
            "resampled": {"type": "boolean"},
            "keys": {
                "type": "object",
                "required": ["gain", "phase", "coherence"],
                "properties": {
                    "gain": {"type": "string"},
                    "phase": {"type": "string"},
                    "coherence": {"type": "string"},
                },
            },
            # The pair's calibration: calibrated only when both the reference channel and the response channel are.
            "calibrationStatus": {"type": "string", "enum": ["uncalibrated", "calibrated"]},
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
            "sourceVersion": {"type": "string"},
        },
    },
    "PairAnswersResult": {
        "type": "object",
        "required": [
            "filePath",
            "channelIndex",
            "nFft",
            "hopLength",
            "window",
            "calibrationSignature",
            "analysisRevision",
            "sourceVersion",
            "stftSignature",
            "responses",
        ],
        "properties": {
            "filePath": {"type": "string"},
            "channelIndex": {"type": "integer"},
            "nFft": {"type": "integer"},
            "hopLength": {"type": "integer"},
            "window": {"type": "string", "enum": ["hann", "hamming", "blackman", "boxcar"]},
            "calibrationSignature": {"type": "string"},
            "analysisRevision": {"$ref": "#/$defs/ResultAnalysisRevision"},
            "sourceVersion": {"type": "string"},
            "stftSignature": {"type": "string"},
            "responses": {"type": "array", "items": {"$ref": "#/$defs/PairAnswersResponse"}},
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
    # One step (``stage``) of ``recipe`` over one file's ``region`` (null = the whole file). ``recipe`` is
    # ``RecipePlan.to_dict()``.
    "ScanPayload": {
        "type": "object",
        "required": ["filePath", "recipe", "stage"],
        "properties": {
            "filePath": {"type": "string"},
            "recipe": {"type": "object"},
            "region": {"anyOf": [{"$ref": "#/$defs/ScanRegion"}, _NULL]},
            "channels": {"anyOf": [{"type": "array", "items": {"type": "integer", "minimum": 0}}, _NULL]},
            "calibration": {"$ref": "#/$defs/CalibrationProfile"},
            # The step of the Recipe (its node id) whose Frame the result carries as ``stage``.
            "stage": {"type": "string"},
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
    # What one step's result is, in words (stage_view.describe): the kind of figure, its axes, quantity and unit,
    # and the key of its kept values. "none" is a Frame not drawn. It carries no point: figures are the figure
    # service's.
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
            "yAxis": {"type": "string", "enum": ["frequency", "bark", "quefrency"]},
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
            # The sound itself (every sample), not a metric or a level over time.
            "signal": {"type": "boolean"},
            # What a time signal's values are when steps made them from the sound (stage_view.measure_of, from
            # the walk that makes its unit): a windowed RMS, a time-weighted RMS, the squared signal, the amplitude
            # or an RMS raised to measureExponent, or not known ("unknown": the axis claims no quantity or unit).
            "measure": {"type": "string", "enum": ["amplitude", "rms", "timeWeightedRms", "power", "unknown"]},
            # The power measure is raised to (3 after power(3)); absent when it is 1.
            "measureExponent": {"type": "number"},
            # The key the step's full-resolution values are kept under, for the figure service's answers.
            "data": {"type": "string"},
            # A trigger's events, by number and time (their lines are the figure service's).
            "events": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["id", "time"],
                    "properties": {
                        # wandas' event ID, from 0: it stays the same when other events are dropped.
                        "id": {"type": "integer", "minimum": 0},
                        # When it triggered, seconds into the file.
                        "time": _NUMBER,
                    },
                },
            },
        },
    },
    # --- The figure service (python-backend/figures/, docs/figure-design.md 第 5, 6 節) ------------
    # The figure spec (図の宣言): data only. Lanes in order, lines in their declared order (the draw order and the
    # order a tie of the pick goes by); every key it names listed once with the state and version answers/ gave it.
    "FigureLevel": {
        "type": "object",
        "required": ["unit", "ref", "label"],
        "properties": {"unit": {"type": "string"}, "ref": _NUMBER, "label": {"type": "string"}},
    },
    "FigureKey": {
        "type": "object",
        "required": ["key", "state", "version"],
        "properties": {
            "key": {"type": "string"},
            "state": {"type": "string", "enum": ["usable", "pending", "stale", "failed", "evicted", "too-large"]},
            "version": {"type": "string"},
            # The key's level identity where answers/ knows it before its answer is usable (its track's input).
            "level": {"$ref": "#/$defs/FigureLevel"},
            "calibrated": {"type": "boolean"},
            # The channel it is compared as (1 is the first; absent: its channels together) and its file's channel
            # count, where answers/ knows them: a recording without that channel is counted no-channel (計算ア).
            "channel": {"type": "integer", "minimum": 1},
            "channels": {"type": "integer", "minimum": 1},
        },
    },
    # Exactly one of key, median, delta (figures/spec.py checks it).
    "FigureLineOf": {
        "type": "object",
        "properties": {
            "key": {"type": "string"},
            "median": {"type": "array", "items": {"type": "string"}},
            "delta": {
                "type": "object",
                "required": ["compare", "base"],
                "properties": {"compare": {"type": "string"}, "base": {"type": "array", "items": {"type": "string"}}},
            },
        },
    },
    "FigureLine": {
        "type": "object",
        "required": ["id", "of"],
        "properties": {"id": {"type": "string"}, "of": {"$ref": "#/$defs/FigureLineOf"}, "role": {"type": "string"}},
    },
    "FigureLane": {
        "type": "object",
        "required": ["id", "kind", "lines"],
        "properties": {
            "id": {"type": "string"},
            # ``lines``: a line per declared line. ``image``: one recording's image (a spectrogram), of one line of
            # a key. ``band``: each recording's time signal (its lowest and highest samples), lines of a key each.
            # ``bins``: one group of a distribution: a table column's values of the group's rows, counted per
            # bin; its lines are the rows holding a role (a key each: a table row's), and it may have none.
            "kind": {"type": "string", "enum": ["lines", "image", "band", "bins"]},
            "lines": {"type": "array", "items": {"$ref": "#/$defs/FigureLine"}},
            # A lines lane on a value axis of its own (a gain above a phase above a coherence; a lane a unit and
            # reference): what its lines are matched against is decided among its own keys (figures/spec.py).
            "axis": {"type": "string", "enum": ["own"]},
            # A band or image lane's: the keys (listed in the spec's keys) of other figures' answers its automatic
            # scale is shared with (the Tracks rows' linked scales); the service takes those of its unit and reference.
            "scaleWith": {"type": "array", "items": {"type": "string"}},
            # A bins lane's column (its key, listed in the spec's keys) and its group's table rows.
            "column": {"type": "string"},
            "rows": {"type": "array", "items": {"type": "string"}},
            # A band lane that shows a recording as a trigger takes it: the trigger (the key of its events of this
            # recording, listed in the spec's keys; its level; an event's start before its firing and its length, s;
            # the events left out). The figure service makes the lane's guide lines of it.
            "trigger": {
                "type": "object",
                "required": ["events", "threshold", "pre", "duration"],
                "properties": {
                    "events": {"type": "string"},
                    "threshold": _NUMBER,
                    "pre": _NUMBER,
                    "duration": _NUMBER,
                    "out": {"type": "array", "items": {"type": "integer", "minimum": 0}},
                },
            },
        },
    },
    # A number column of the user's table as answers/ hands it: a value per table row (null: left blank).
    "FigureColumn": {
        "type": "object",
        "required": ["key", "version", "rows", "values"],
        "properties": {
            "key": {"type": "string"},
            "version": {"type": "string"},
            "rows": {"type": "array", "items": {"type": "string"}},
            "values": _WHOLE_GAPPED,
        },
    },
    "FigureSpec": {
        "type": "object",
        "required": ["lanes", "keys"],
        "properties": {
            "lanes": {"type": "array", "items": {"$ref": "#/$defs/FigureLane"}},
            "keys": {"type": "array", "items": {"$ref": "#/$defs/FigureKey"}},
        },
    },
    # The specified range (指定範囲): layer 3's ends (fieldWindow), used exactly; an end not specified is null.
    "FigureView": {
        "type": "object",
        "properties": {
            "x": {"type": "array", "items": {"anyOf": [_PLACE, _NULL]}},
            "lanes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["lane", "y"],
                    "properties": {
                        "lane": {"type": "string"},
                        "y": {"type": "array", "items": {"anyOf": [_PLACE, _NULL]}},
                        # An image lane's colour ends (dB).
                        "colour": {"type": "array", "items": {"anyOf": [_PLACE, _NULL]}},
                    },
                },
            },
        },
    },
    "FigureDrawPayload": {
        "type": "object",
        "required": ["figureId", "generation", "requestNumber", "spec", "width", "height"],
        "properties": {
            "figureId": {"type": "string"},
            "generation": {"type": "integer", "minimum": 0},
            "requestNumber": {"type": "integer", "minimum": 0},
            "spec": {"$ref": "#/$defs/FigureSpec"},
            "view": {"anyOf": [{"$ref": "#/$defs/FigureView"}, _NULL]},
            # A distribution's selected value range; none on a line figure. It takes the values from its low end up
            # to, not including, its high end; ``selectionClosed``: those on its high end too (a range picked up
            # to the top of the axis).
            "selection": {"anyOf": [_PLACES, _NULL]},
            "selectionClosed": {"type": "boolean"},
            # The table columns the spec names, handed with the request (kept by key: a later request names them by
            # key alone, until the figure counts one ``evicted``).
            "columns": {"type": "array", "items": {"$ref": "#/$defs/FigureColumn"}},
            # The frame in CSS px.
            "width": _NUMBER,
            "height": _NUMBER,
            # Each lane's own frame height (CSS px), where its drawn points depend on it (an image's rows); a lane
            # not listed takes an equal share of ``height``.
            "laneHeights": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["lane", "height"],
                    "properties": {"lane": {"type": "string"}, "height": _NUMBER},
                },
            },
            # How much of the range's length a time lane (a band, an image) is drawn past each end, so a moved range
            # has its picture at once (the confirmed range and every read are of the range itself). None where absent.
            "ahead": _NUMBER,
        },
    },
    "FigureExcluded": {
        "type": "object",
        "required": ["key", "reason"],
        "properties": {
            "key": {"type": "string"},
            "reason": {
                "type": "string",
                "enum": [
                    "pending",
                    "stale",
                    "failed",
                    "evicted",
                    "too-large",
                    "version",
                    "no-identity",
                    "other-reference",
                    "other-axis",
                    "other-channels",
                    "no-channel",
                ],
            },
        },
    },
    "FigureMemberSet": {
        "type": "object",
        "required": ["used", "n", "excluded"],
        "properties": {
            "used": {"type": "array", "items": {"type": "string"}},
            "n": {"type": "integer", "minimum": 0},
            "excluded": {"type": "array", "items": {"$ref": "#/$defs/FigureExcluded"}},
        },
    },
    # 計算ア: the shown set (載せる集まり), the set a median and a Δ are of, and each line's members.
    "FigureMembers": {
        "type": "object",
        "required": ["shown", "combined", "calibration", "lines"],
        "properties": {
            "shown": {"$ref": "#/$defs/FigureMemberSet"},
            "combined": {"$ref": "#/$defs/FigureMemberSet"},
            "calibration": {"type": "string", "enum": ["calibrated", "uncalibrated", "unknown"]},
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["line", "drawn", "used", "excluded"],
                    "properties": {
                        "line": {"type": "string"},
                        "drawn": {"type": "boolean"},
                        "used": {"type": "array", "items": {"type": "string"}},
                        "excluded": {"type": "array", "items": {"$ref": "#/$defs/FigureExcluded"}},
                        "calibration": {"type": "string", "enum": ["calibrated", "uncalibrated", "unknown"]},
                    },
                },
            },
        },
    },
    "FigureAxis": {
        "type": "object",
        "required": ["quantity", "unit", "reference", "referenceLabel", "calibration", "xScale", "yScale"],
        "properties": {
            **_FIGURE_AXIS,
        },
    },
    # 計算オ: the headline's point, in a read's shape (its name, place, data step and unrounded answer).
    "FigureHeadline": {
        "type": "object",
        "required": ["lane", "line", "index", "x", "value"],
        "properties": {
            "lane": {"type": "string"},
            "line": {"type": "string"},
            "index": {"type": "integer", "minimum": 0},
            "x": _NUMBER,
            "xStep": _NUMBER,
            "value": _NUMBER,
        },
    },
    "FigureDrawnLine": {
        "type": "object",
        "required": ["id", "xs", "values"],
        "properties": {
            "id": {"type": "string"},
            "role": {"type": "string"},
            "key": {"type": "string"},
            "xs": _PLACES,
            "values": _DRAWN_GAPPED,
            # A line of bands (the axis's ``x`` is "band"): the edges its bars are drawn between (配置), one more
            # than its points; bar i is from edges[i] to edges[i + 1].
            "edges": _PLACES,
        },
    },
    # An image lane's cells as drawn (計算ウ) with where they are (配置): column c is between columnEdges[c] and
    # [c + 1] across, row r between rowEdges[r] and [r + 1] up; ``cells`` is rows of columns (dB, a null: no value).
    "FigureDrawnImage": {
        "type": "object",
        "required": ["line", "key", "columnEdges", "rowEdges", "cells"],
        "properties": {
            "line": {"type": "string"},
            "role": {"type": "string"},
            "key": {"type": "string"},
            "columnEdges": _PLACES,
            "rowEdges": _PLACES,
            "cells": {"type": "array", "items": _DRAWN_GAPPED},
        },
    },
    # A bins lane (one group of a distribution): its placement and counts. Nothing here is thinned. ``edges``:
    # the bins' edges over the whole value axis (bin b is from edges[b] up to, not including, edges[b + 1]);
    # ``counts``: rows per bin (absent: so few rows that each is drawn as a dot, at its ``level``);
    # ``countsPicked`` and a member's ``picked``: what the selected range takes (absent: none selected);
    # ``members``: the rows shown, by value then key; ``blank``: rows of the group with no number (counted, not
    # drawn); ``marks``: the rows holding a role, each a line at its value. ``bars`` and ``rows`` are the line
    # ids a read names a bar (its point's index is the bin) and a row (its index is the member) by.
    "FigureBins": {
        "type": "object",
        "required": ["column", "bars", "rows", "edges", "step", "members", "n", "blank", "marks"],
        "properties": {
            "column": {"type": "string"},
            "bars": {"type": "string"},
            "rows": {"type": "string"},
            "edges": _PLACES,
            # A bin's width: the step a readout takes its digits from.
            "step": _NUMBER,
            "counts": {"type": "array", "items": {"type": "integer", "minimum": 0}},
            "countsPicked": {"type": "array", "items": {"type": "integer", "minimum": 0}},
            "members": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["key", "value"],
                    "properties": {
                        "key": {"type": "string"},
                        "value": _NUMBER,
                        # Where up the count axis its dot is (a group of few rows: stacked so each can be pointed at).
                        "at": _NUMBER,
                        "picked": {"type": "boolean"},
                    },
                },
            },
            # The group's rows with a number, and of them those a selected range takes.
            "n": {"type": "integer", "minimum": 0},
            "nPicked": {"type": "integer", "minimum": 0},
            "blank": {"type": "integer", "minimum": 0},
            "marks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["id", "key", "value"],
                    "properties": {
                        "id": {"type": "string"},
                        "role": {"type": "string"},
                        "key": {"type": "string"},
                        "value": _NUMBER,
                    },
                },
            },
        },
    },
    "FigureLanePicture": {
        "type": "object",
        "required": ["id", "axis", "lines"],
        "properties": {
            "id": {"type": "string"},
            # Absent on a lane of lines. A band's ``lines`` are each signal's drawn samples in time order. A bins
            # lane has none: what it draws is in ``bins``.
            "kind": {"type": "string", "enum": ["lines", "image", "band", "bins"]},
            "axis": {"$ref": "#/$defs/FigureAxis"},
            # 計算イ: the confirmed range. None while there is no answer to range over. ``colour``: an image's.
            "range": {
                "type": "object",
                "required": ["x", "y"],
                "properties": {"x": _PLACES, "y": _PLACES, "colour": _PLACES},
            },
            "image": {"$ref": "#/$defs/FigureDrawnImage"},
            "bins": {"$ref": "#/$defs/FigureBins"},
            # The confirmed range with nothing specified (these answers' whole axes): what a typed range or a zoom is
            # a part of, the picture's own (never an earlier picture's, whose answers may be others).
            "whole": {
                "type": "object",
                "required": ["x", "y"],
                "properties": {"x": _PLACES, "y": _PLACES, "colour": _PLACES},
            },
            "lines": {"type": "array", "items": {"$ref": "#/$defs/FigureDrawnLine"}},
            # 目安の線 (guide lines): lines at a place of one axis (a trigger's firing times across, its threshold up),
            # drawn and never read, apart from the mark the Figure puts on the point it reads (印).
            "guides": {"type": "array", "items": {"$ref": "#/$defs/FigureGuide"}},
            # A lane that shows a recording as a trigger takes it: the stretches its events used were cut over, and
            # how many events are used of how many.
            "spans": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["start", "end"],
                    "properties": {"start": _NUMBER, "end": _NUMBER},
                },
            },
            "events": {
                "type": "object",
                "required": ["used", "total"],
                "properties": {
                    "used": {"type": "integer", "minimum": 0},
                    "total": {"type": "integer", "minimum": 0},
                    # No events' answer is held, and why (its key's state; ``evicted``: let go): the counts are of
                    # nothing then, and the screen says so instead of 0 of 0.
                    "missing": {"enum": ["pending", "stale", "failed", "evicted", "too-large"]},
                },
            },
        },
    },
    # ``id`` names a guide for the screen (a trigger's level: ``threshold``; an event's firing: ``event:<number>``);
    # ``out``: its event is left out.
    "FigureGuide": {
        "type": "object",
        "required": ["axis", "at"],
        "properties": {
            "axis": {"type": "string", "enum": ["x", "y"]},
            "at": _NUMBER,
            "id": {"type": "string"},
            "out": {"type": "boolean"},
        },
    },
    # ``picture`` carries the picture; ``too-large`` refused before computing (over the process's budget alone);
    # ``busy``: it does not fit beside the requests running now (the Figure asks once more, a little later);
    # ``superseded``: a newer generation began, or the Figure was released, before this one was held (no picture);
    # ``pending`` and ``failed`` as the design names them.
    "FigureDrawResult": {
        "type": "object",
        "required": ["status", "figureId", "generation", "requestNumber"],
        "properties": {
            "status": {"type": "string", "enum": ["picture", "too-large", "busy", "superseded", "pending", "failed"]},
            "figureId": {"type": "string"},
            "generation": {"type": "integer", "minimum": 0},
            "requestNumber": {"type": "integer", "minimum": 0},
            "pictureId": {"type": "string"},
            "dataId": {"type": "string"},
            "lanes": {"type": "array", "items": {"$ref": "#/$defs/FigureLanePicture"}},
            "headlines": {"type": "array", "items": {"$ref": "#/$defs/FigureHeadline"}},
            "members": {"$ref": "#/$defs/FigureMembers"},
        },
    },
    # A read asks by exactly one of: (a) ``pointer`` (its place on the axes, px per axis unit across and up; on a
    # log axis px per natural-log unit), (b) ``step`` (the arrow keys: from the selected point, named by its lane,
    # line, recording key, answer version and index, a signed count of points on), (c) ``name`` (a line's point at a
    # place, of its recording key: the selected point read again after a redraw). A step carries the data id and the
    # generation its point was read from: a point of another answer is ``no-point``, never moved on this one.
    "FigureReadPayload": {
        "type": "object",
        "required": ["figureId", "pictureId", "requestNumber"],
        "properties": {
            "figureId": {"type": "string"},
            "pictureId": {"type": "string"},
            "requestNumber": {"type": "integer", "minimum": 0},
            "dataId": {"type": "string"},
            "generation": {"type": "integer", "minimum": 0},
            "pointer": {
                "type": "object",
                # ``scale`` (px per axis unit) is used by a lane of lines' reads; an image's cell is read by its place.
                "required": ["lane", "x", "y", "scale"],
                "properties": {"lane": {"type": "string"}, "x": _NUMBER, "y": _NUMBER, "scale": _PLACES},
            },
            "step": {
                "type": "object",
                "required": ["lane", "line", "version", "index", "steps"],
                "properties": {
                    "lane": {"type": "string"},
                    "line": {"type": "string"},
                    "key": {"type": "string"},
                    "version": {"type": "string"},
                    "index": {"type": "integer", "minimum": 0},
                    "steps": {"type": "integer"},
                    # An image's cell: its row, and a signed count of rows on (up the axis).
                    "row": {"type": "integer", "minimum": 0},
                    "rows": {"type": "integer"},
                },
            },
            "name": {
                "type": "object",
                "required": ["line", "x"],
                "properties": {
                    "lane": {"type": "string"},
                    "line": {"type": "string"},
                    "key": {"type": "string"},
                    "x": _NUMBER,
                    # An image's cell: its place up the axis too.
                    "y": _NUMBER,
                },
            },
        },
    },
    "FigurePoint": {
        "type": "object",
        "required": ["index", "x", "value"],
        "properties": {
            "index": {"type": "integer", "minimum": 0},
            "x": _NUMBER,
            "value": _NUMBER,
            "xStep": _NUMBER,
            # An image's cell: its row, its place up the axis and the data step there.
            "row": {"type": "integer", "minimum": 0},
            "y": _NUMBER,
            "yStep": _NUMBER,
            "key": {"type": "string"},
        },
    },
    # ``point``: the one point read (never its neighbours: the arrow keys ask a step each time), with its line's
    # answer version (a step names it). ``no-value``: over a gap of a line; ``outside``: over no line (or past the
    # plot's side for a step); ``no-point``: no point of that name here (another recording, answer or picture);
    # ``no-picture``: nothing held for this Figure and picture.
    "FigureReadResult": {
        "type": "object",
        "required": ["status", "figureId", "pictureId", "requestNumber"],
        "properties": {
            "status": {
                "type": "string",
                "enum": ["point", "no-value", "outside", "no-point", "no-picture", "pending", "failed"],
            },
            "figureId": {"type": "string"},
            "pictureId": {"type": "string"},
            "requestNumber": {"type": "integer", "minimum": 0},
            "lane": {"type": "string"},
            "line": {"type": "string"},
            "role": {"type": "string"},
            "version": {"type": "string"},
            "point": {"$ref": "#/$defs/FigurePoint"},
            # A pointer's read: the pointer is on the point itself (within the radius), not only over its place across.
            "near": {"type": "boolean"},
            # A pointer's read of no point on a bins lane: the bin under the pointer (what a click there picks).
            "bin": {
                "type": "object",
                "required": ["index", "low", "high"],
                "properties": {"index": {"type": "integer", "minimum": 0}, "low": _NUMBER, "high": _NUMBER},
            },
        },
    },
    "FigureExportPayload": {
        "type": "object",
        "required": ["spec", "dataId"],
        "properties": {
            "spec": {"$ref": "#/$defs/FigureSpec"},
            "view": {"anyOf": [{"$ref": "#/$defs/FigureView"}, _NULL]},
            "selection": {"anyOf": [_PLACES, _NULL]},
            "selectionClosed": {"type": "boolean"},
            # The table columns the spec names, handed with the request (kept by key: a later request names them by
            # key alone, until the figure counts one ``evicted``).
            "columns": {"type": "array", "items": {"$ref": "#/$defs/FigureColumn"}},
            "dataId": {"type": "string"},
            "requestNumber": {"type": "integer", "minimum": 0},
        },
    },
    # Every point of every line drawn (never thinned), with the axes, headline and sets the draw gives.
    "FigureExportResult": {
        "type": "object",
        "required": ["status"],
        "properties": {
            "status": {"type": "string", "enum": ["rows", "no-picture", "too-large"]},
            "dataId": {"type": "string"},
            "requestNumber": {"type": "integer", "minimum": 0},
            "axes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": [
                        "lane",
                        "quantity",
                        "unit",
                        "reference",
                        "referenceLabel",
                        "calibration",
                        "xScale",
                        "yScale",
                    ],
                    "properties": {"lane": {"type": "string"}, **_FIGURE_AXIS},
                },
            },
            "columns": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["lane", "line", "quantity", "xs", "values"],
                    "properties": {
                        "lane": {"type": "string"},
                        "line": {"type": "string"},
                        "role": {"type": "string"},
                        "key": {"type": "string"},
                        "quantity": {"type": "string", "enum": ["level", "delta", "value"]},
                        "xs": _PLACES,
                        "values": _WHOLE_GAPPED,
                    },
                },
            },
            "headlines": {"type": "array", "items": {"$ref": "#/$defs/FigureHeadline"}},
            "members": {"$ref": "#/$defs/FigureMembers"},
        },
    },
    "FigureReleasePayload": {
        "type": "object",
        "required": ["figureId"],
        "properties": {"figureId": {"type": "string"}},
    },
    "FigureReleaseResult": {"type": "object", "properties": {}},
    # The members part of a spec (its lanes and keys): 計算ア alone, no picture.
    "FigureCountPayload": {
        "type": "object",
        "required": ["spec"],
        "properties": {
            "spec": {"$ref": "#/$defs/FigureSpec"},
            # The table columns the spec names, handed with the request (kept by key: a later request names them by
            # key alone, until the figure counts one ``evicted``).
            "columns": {"type": "array", "items": {"$ref": "#/$defs/FigureColumn"}},
        },
    },
    "FigureCountResult": {
        "type": "object",
        "required": ["members"],
        "properties": {"members": {"$ref": "#/$defs/FigureMembers"}},
    },
    "ScanInput": {
        "type": "object",
        "required": [
            "id",
            "fs",
            "channels",
            "durationS",
            "unit",
            "ref",
            "levelReferenceLabel",
            "calibrationStatus",
            "fullScale",
        ],
        "properties": {
            "id": {"type": "string"},
            "fs": {"type": "integer", "minimum": 1},
            "channels": {"type": "array", "items": {"type": "integer", "minimum": 0}},
            "durationS": _NUMBER,
            # wandas' linear unit: "FS" for audio, "" for an uncalibrated CSV, the calibration's unit otherwise.
            "unit": {"type": "string"},
            "ref": _NUMBER,
            # wandas' name for the level reference: "dBFS", "dB re 1 input unit", "dB SPL re 20 µPa"…
            "levelReferenceLabel": {"type": "string"},
            "calibrationStatus": {"type": "string", "enum": ["uncalibrated", "calibrated"]},
            # false: the source (a CSV) holds raw input units, so an uncalibrated level is dB re 1 input unit.
            "fullScale": {"type": "boolean"},
            # Each channel's own calibration status, in ``channels``' order: a channel taken alone names its own.
            "channelCalibration": {
                "type": "array",
                "items": {"type": "string", "enum": ["uncalibrated", "calibrated"]},
            },
            # Scanned against the base slot's recording: the status of the base channel it is paired with, since
            # a pair's values are calibrated only when both of its sides are.
            "baseCalibrationStatus": {"type": "string", "enum": ["uncalibrated", "calibrated"]},
            # The region the scan was asked for, its ends exactly as sent (null = the whole file).
            "region": {"anyOf": [{"$ref": "#/$defs/ScanRegion"}, _NULL]},
        },
    },
    # A file that cannot be scanned answers ``ok: false`` with a one-line ``reason`` and nothing else;
    # an ``ok`` result carries the step's picture (``stage``) and what it is of.
    "ScanResult": {
        "type": "object",
        "required": ["ok"],
        "properties": {
            "ok": {"type": "boolean"},
            "reason": {"type": "string"},
            "input": {"$ref": "#/$defs/ScanInput"},
            "specVersion": {"type": "integer", "minimum": 1},
            "wandasVersion": {"type": "string"},
            "elapsedMs": _NUMBER,
            "stage": {"$ref": "#/$defs/StageView"},
            # With ``stage``: its full-resolution values are over the store's budget and not kept (no ``data``).
            "stageDataTooLarge": {"type": "boolean"},
            # With ``ok: false``: the Recipe step (node id) that failed on this file.
            "failedStep": {"type": "string"},
            # With ``ok: false``: the request does not fit this file (region, channels, Recipe); asking again for
            # the same file version, calibration, Recipe and region fails the same way, so it is not asked again.
            "lasting": {"type": "boolean"},
        },
    },
    # Codes and kinds from backend_errors.py; hosts branch on the code and word the user's summary from the
    # kind, never from the message text, which they show as the detail.
    "BackendErrorPayload": {
        "type": "object",
        "required": ["code", "kind", "message"],
        "properties": {
            "code": {"type": "string", "enum": ["input-error", "stale-calibration", "stale-source", "internal-error"]},
            "kind": {
                "type": "string",
                "enum": ["analysis-settings", "unreadable-file", "out-of-memory", "invalid-input", "analysis-failed"],
            },
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
    # Native backend → host when a worker begins a request; the host starts that request's timeout then.
    "BackendStartedNotification": {
        "type": "object",
        "required": ["type", "requestId"],
        "properties": {"type": {"type": "string", "const": "started"}, "requestId": {"type": "string"}},
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
    "cursor-answers": {"payload": "CursorAnswersPayload", "result": "CursorAnswersResult"},
    "track-answers": {"payload": "TrackAnswersPayload", "result": "TrackAnswersResult"},
    "pair-answers": {"payload": "PairAnswersPayload", "result": "PairAnswersResult"},
    "region-peak": {"payload": "RegionPeakPayload", "result": "RegionPeakResult"},
    "export-wav-loop": {"payload": "ExportWavLoopPayload", "result": "ExportWavLoopResult"},
    "release-track-detail": {"payload": "ReleaseTrackDetailPayload", "result": "ReleaseTrackDetailResult"},
    "build-recipe": {"payload": "BuildRecipePayload", "result": "BuildRecipeResult"},
    "scan": {"payload": "ScanPayload", "result": "ScanResult"},
    "figure-draw": {"payload": "FigureDrawPayload", "result": "FigureDrawResult"},
    "figure-read": {"payload": "FigureReadPayload", "result": "FigureReadResult"},
    "figure-export": {"payload": "FigureExportPayload", "result": "FigureExportResult"},
    "figure-release": {"payload": "FigureReleasePayload", "result": "FigureReleaseResult"},
    "figure-count": {"payload": "FigureCountPayload", "result": "FigureCountResult"},
}


def _is_literal(value: object, declared_type: object) -> bool:
    """A JSON scalar that survives the trip to a JS number and matches the node's ``type``, if any."""
    if not isinstance(value, _SCALAR_TYPES):
        return False
    if isinstance(value, float) and not math.isfinite(value):
        return False  # json.dump would emit NaN/Infinity, which JSON.parse rejects.
    number = value if isinstance(value, (int, float)) and not isinstance(value, bool) else None
    integral = isinstance(number, int) or (isinstance(number, float) and number.is_integer())
    if (
        number is not None and integral and abs(number) > _MAX_SAFE_INTEGER
    ):  # Compared exactly; float(10**400) would overflow.
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
        if key == "properties" and not isinstance(child, dict):
            return f"{path}.properties"
        if key == "properties" and isinstance(child, dict):
            nested = list(child.items())
        elif key == "items":
            nested = [(key, child)]
        elif key == "anyOf" and isinstance(child, list):
            nested = [("anyOf[0]", child[0])]
        else:
            nested = []
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
