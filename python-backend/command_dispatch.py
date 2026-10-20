"""Transport-independent analysis command validation and dispatch."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING, Any

from backend_errors import InputError
from protocol_schema import COMMANDS as SCHEMA_COMMANDS
from protocol_schema import REQUEST_ENVELOPE_KEYS, payload_violation

if TYPE_CHECKING:
    from analysis_service import AnalysisService

Command = dict[str, Any]
CommandHandler = Callable[[Any, Command], dict[str, object]]
FieldValidator = Callable[[object], bool]


def _is_string(value: object) -> bool:
    return isinstance(value, str)


def _is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_object(value: object) -> bool:
    return isinstance(value, dict)


def _is_string_map(value: object) -> bool:
    return isinstance(value, dict) and all(isinstance(item, str) for item in value.values())


_REQUEST_FIELDS: dict[str, dict[str, FieldValidator]] = {
    "run-recipe": {"recipe": _is_object, "inputs": _is_string_map},
}
# ``run-recipe`` is outside the generated schema, so its keys are closed here. The nested Recipe
# document stays open; wandas validates it when loading the RecipePlan.
_RUN_RECIPE_KEYS = REQUEST_ENVELOPE_KEYS | {"recipe", "inputs", "recipePath", "inputContexts"}
_INPUT_CONTEXT_KEYS = frozenset({"calibrationProfile", "analysisRevision"})


def _validate_stft_options(value: object) -> None:
    if not isinstance(value, dict):
        raise InputError("invalid request field 'stftOptions': expected object")
    fields: dict[str, FieldValidator] = {
        "nFft": _is_integer,
        "overlapPercent": _is_number,
        "window": _is_string,
    }
    for key, validator in fields.items():
        if key not in value or not validator(value[key]):
            raise InputError(f"invalid request field 'stftOptions.{key}'")


def validate_request(value: object) -> Command:
    if not isinstance(value, dict):
        raise InputError("request must be a JSON object")
    request_id = value.get("requestId")
    if not isinstance(request_id, str):
        raise InputError("invalid request field 'requestId'")
    name = value.get("cmd")
    if not isinstance(name, str):
        raise InputError("invalid request field 'cmd'")
    if name in SCHEMA_COMMANDS:
        violation = payload_violation(name, value)
        if violation is not None:
            raise InputError(f"invalid request field {violation!r} for command {name!r}")
        fields = {}
    elif (fields := _REQUEST_FIELDS.get(name)) is None:
        raise InputError(f"unknown cmd: {name!r}")
    for key, validator in fields.items():
        if key not in value or not validator(value[key]):
            raise InputError(f"invalid request field {key!r} for command {name!r}")
    if name == "run-recipe":
        unknown = sorted(set(value) - _RUN_RECIPE_KEYS)
        if unknown:
            raise InputError(f"invalid request field {unknown[0]!r} for command {name!r}")
        if "recipePath" in value and not _is_string(value["recipePath"]):
            raise InputError("invalid request field 'recipePath'")
        if "inputContexts" in value and (
            not isinstance(value["inputContexts"], dict)
            or any(
                not isinstance(context, dict) or not set(context) <= _INPUT_CONTEXT_KEYS
                for context in value["inputContexts"].values()
            )
        ):
            raise InputError("invalid request field 'inputContexts'")
    if "stftOptions" in value:
        _validate_stft_options(value["stftOptions"])
    return value


def _stft_options(command: Command) -> Mapping[str, object] | None:
    raw = command.get("stftOptions")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise InputError("stftOptions must be an object")
    return raw


def _calibration_profile(command: Command) -> object:
    return command.get("calibrationProfile")


def _analysis_revision(command: Command) -> object:
    return command.get("analysisRevision", 0)


def handle_analyze(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.analyze(
        str(command["filePath"]),
        stft_options=_stft_options(command),
        calibration_profile=_calibration_profile(command),
        analysis_revision=_analysis_revision(command),
    )


def handle_track_detail(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.track_detail(
        str(command["filePath"]),
        track_index=int(command["trackIndex"]),
        analysis_id=command["analysisId"],
        settings_signature=command["settingsSignature"],
        stft_options=_stft_options(command),
        calibration_profile=_calibration_profile(command),
        analysis_revision=_analysis_revision(command),
    )


def handle_spectrum_slice(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.spectrum_slice(
        str(command["filePath"]),
        cursor_norm=float(command["cursorNorm"]),
        track_index=int(command["trackIndex"]),
        analysis_id=command["analysisId"],
        settings_signature=command["settingsSignature"],
        stft_options=_stft_options(command),
        calibration_profile=_calibration_profile(command),
        analysis_revision=_analysis_revision(command),
        bands_per_octave=int(command["bandsPerOctave"]) if "bandsPerOctave" in command else None,
    )


def handle_pair_spectrum(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.pair_spectrum(
        command["reference"],
        command["responses"],
        start_seconds=float(command["startSeconds"]) if "startSeconds" in command else None,
        end_seconds=float(command["endSeconds"]) if "endSeconds" in command else None,
        stft_options=_stft_options(command),
        analysis_id=command["analysisId"],
        settings_signature=command["settingsSignature"],
    )


def handle_range(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.waveform_range(
        str(command["filePath"]),
        start_norm=float(command["startNorm"]),
        end_norm=float(command["endNorm"]),
        point_count=int(command["points"]),
        calibration_profile=_calibration_profile(command),
        analysis_revision=_analysis_revision(command),
    )


def handle_export_wav_loop(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.export_wav_loop(
        str(command["filePath"]),
        start_norm=float(command["startNorm"]),
        end_norm=float(command["endNorm"]),
    )


def handle_release_track_detail(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.release_track_detail(str(command["filePath"]))


def handle_run_recipe(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.run_recipe(
        command["recipe"],
        inputs=command["inputs"],
        recipe_path=command.get("recipePath"),
        input_contexts=command.get("inputContexts"),
    )


def handle_build_recipe(service: AnalysisService, command: Command) -> dict[str, object]:
    return service.build_recipe(
        str(command["filePath"]),
        stft_options=_stft_options(command),
        bands_per_octave=int(command["bandsPerOctave"]) if "bandsPerOctave" in command else None,
        reference_channel=int(command["referenceChannel"]) if "referenceChannel" in command else None,
        responses=command.get("responses", []),
    )


COMMANDS: dict[str, CommandHandler] = {
    "analyze": handle_analyze,
    "range": handle_range,
    "track-detail": handle_track_detail,
    "release-track-detail": handle_release_track_detail,
    "spectrum-slice": handle_spectrum_slice,
    "pair-spectrum": handle_pair_spectrum,
    "export-wav-loop": handle_export_wav_loop,
    "run-recipe": handle_run_recipe,
    "build-recipe": handle_build_recipe,
}


def dispatch(command: Command, service: AnalysisService) -> dict[str, object]:
    name = command.get("cmd")
    handler = COMMANDS.get(name)
    if handler is None:
        raise InputError(f"unknown cmd: {name!r}")
    return handler(service, command)
