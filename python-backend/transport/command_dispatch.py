"""Transport-independent analysis command validation and dispatch."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING, Any

from services.backend_errors import InputError
from transport.protocol_schema import COMMANDS as SCHEMA_COMMANDS
from transport.protocol_schema import payload_violation

if TYPE_CHECKING:
    from services.analysis_service import AnalysisService

Command = dict[str, Any]
CommandHandler = Callable[[Any, Command], Mapping[str, object]]
FieldValidator = Callable[[object], bool]


def _is_string(value: object) -> bool:
    return isinstance(value, str)


def _is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


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
    if name not in SCHEMA_COMMANDS:
        raise InputError(f"unknown cmd: {name!r}")
    violation = payload_violation(name, value)
    if violation is not None:
        raise InputError(f"invalid request field {violation!r} for command {name!r}")
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


def _source_version(command: Command) -> object:
    # The version of the file the asking track was drawn from (sourceVersion of its analysis); absent asks of
    # the file as it is now.
    return command.get("sourceVersion")


def handle_analyze(service: AnalysisService, command: Command) -> Mapping[str, object]:
    return service.analyze(
        str(command["filePath"]),
        stft_options=_stft_options(command),
        calibration_profile=_calibration_profile(command),
        analysis_revision=_analysis_revision(command),
    )


def handle_cursor_answers(service: AnalysisService, command: Command) -> Mapping[str, object]:
    return service.cursor_answers(
        str(command["filePath"]),
        cursor_norm=float(command["cursorNorm"]),
        scale="linear" if command.get("scale") == "linear" else "log",
        stft_options=_stft_options(command),
        calibration_profile=_calibration_profile(command),
        analysis_revision=_analysis_revision(command),
        source_version=_source_version(command),
        bands_per_octave=int(command["bandsPerOctave"]) if "bandsPerOctave" in command else None,
    )


def handle_track_answers(service: AnalysisService, command: Command) -> Mapping[str, object]:
    return service.track_answers(
        str(command["filePath"]),
        scale="log" if command.get("scale") == "log" else "linear",
        stft_options=_stft_options(command),
        calibration_profile=_calibration_profile(command),
        analysis_revision=_analysis_revision(command),
        source_version=_source_version(command),
        time_window=(
            (float(command["startNorm"]), float(command["endNorm"]))
            if "startNorm" in command and "endNorm" in command
            else None
        ),
        spectrogram=command.get("spectrogram") is not False,
        extents=command.get("extents") is True,
    )


def handle_pair_answers(service: AnalysisService, command: Command) -> Mapping[str, object]:
    return service.pair_answers(
        command["reference"],
        command["responses"],
        scale="linear" if command.get("scale") == "linear" else "log",
        start_seconds=float(command["startSeconds"]) if "startSeconds" in command else None,
        end_seconds=float(command["endSeconds"]) if "endSeconds" in command else None,
        stft_options=_stft_options(command),
    )


def handle_region_peak(service: AnalysisService, command: Command) -> Mapping[str, object]:
    return service.region_peak(command["sources"])


def handle_export_wav_loop(service: AnalysisService, command: Command) -> Mapping[str, object]:
    return service.export_wav_loop(
        str(command["filePath"]),
        start_norm=float(command["startNorm"]),
        end_norm=float(command["endNorm"]),
    )


def handle_release_track_detail(service: AnalysisService, command: Command) -> Mapping[str, object]:
    return service.release_track_detail(str(command["filePath"]))


def handle_build_recipe(service: AnalysisService, command: Command) -> Mapping[str, object]:
    return service.build_recipe(
        str(command["filePath"]),
        stft_options=_stft_options(command),
        bands_per_octave=int(command["bandsPerOctave"]) if "bandsPerOctave" in command else None,
        reference_channel=int(command["referenceChannel"]) if "referenceChannel" in command else None,
        responses=command.get("responses", []),
    )


def handle_scan(service: AnalysisService, command: Command) -> Mapping[str, object]:
    return service.scan(
        str(command["filePath"]),
        recipe=command["recipe"],
        region=command.get("region"),
        channels=command.get("channels"),
        calibration_profile=command.get("calibration"),
        stage=str(command["stage"]),
        reference=command.get("reference"),
    )


def _figure(request: Callable[[Any], Mapping[str, object]], command: Command) -> Mapping[str, object]:
    """One request of the figure service (figures/service.py), through its one instance and its answers from the old
    path's store (transport/figure_answers.py: the adapter that implements figures/answers.py). A request the
    service cannot take is an input error, as a payload the schema refuses is."""
    from figures.service import FigureRequestError

    try:
        return request(command)
    except FigureRequestError as error:
        raise InputError(str(error)) from error


def handle_figure_draw(_service: AnalysisService, command: Command) -> Mapping[str, object]:
    from transport.figure_answers import COLUMNS, FIGURES

    COLUMNS.keep(command.get("columns"))
    return _figure(FIGURES.draw, command)


def handle_figure_read(_service: AnalysisService, command: Command) -> Mapping[str, object]:
    from transport.figure_answers import FIGURES

    return _figure(FIGURES.read, command)


def handle_figure_export(_service: AnalysisService, command: Command) -> Mapping[str, object]:
    from transport.figure_answers import COLUMNS, FIGURES

    COLUMNS.keep(command.get("columns"))
    return _figure(FIGURES.export, command)


def handle_figure_release(_service: AnalysisService, command: Command) -> Mapping[str, object]:
    from transport.figure_answers import FIGURES

    return _figure(FIGURES.release, command)


def handle_figure_count(_service: AnalysisService, command: Command) -> Mapping[str, object]:
    from transport.figure_answers import COLUMNS, FIGURES

    COLUMNS.keep(command.get("columns"))
    return _figure(FIGURES.count, command)


COMMANDS: dict[str, CommandHandler] = {
    "analyze": handle_analyze,
    "release-track-detail": handle_release_track_detail,
    "cursor-answers": handle_cursor_answers,
    "track-answers": handle_track_answers,
    "pair-answers": handle_pair_answers,
    "region-peak": handle_region_peak,
    "export-wav-loop": handle_export_wav_loop,
    "build-recipe": handle_build_recipe,
    "scan": handle_scan,
    "figure-draw": handle_figure_draw,
    "figure-read": handle_figure_read,
    "figure-export": handle_figure_export,
    "figure-release": handle_figure_release,
    "figure-count": handle_figure_count,
}


def dispatch(command: Command, service: AnalysisService) -> Mapping[str, object]:
    name = command.get("cmd")
    handler = COMMANDS.get(name) if isinstance(name, str) else None
    if handler is None:
        raise InputError(f"unknown cmd: {name!r}")
    return handler(service, command)
