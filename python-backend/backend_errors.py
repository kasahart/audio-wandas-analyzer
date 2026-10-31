"""Error codes and kinds shared by the desktop backend and the browser Worker.

Every failed request is answered with ``{"error": {"code": ..., "kind": ..., "message": ...}}`` so the hosts
branch on ``code`` and word the user's summary from ``kind`` instead of matching exception text.
"""

from __future__ import annotations

INPUT_ERROR = "input-error"
STALE_CALIBRATION = "stale-calibration"
INTERNAL_ERROR = "internal-error"

ANALYSIS_SETTINGS = "analysis-settings"
UNREADABLE_FILE = "unreadable-file"
OUT_OF_MEMORY = "out-of-memory"
INVALID_INPUT = "invalid-input"
ANALYSIS_FAILED = "analysis-failed"

# Library modules whose ValueError means the parameters do not fit the signal (scipy's
# "Parameter n must be >= ceil(m_num/2)") or the bytes are not audio wandas can read.
_SETTINGS_MODULES = ("scipy.signal", "wandas.processing")
_READER_MODULES = ("soundfile", "wandas.io")


class InputError(ValueError):
    """The request, the audio or a Recipe is invalid; the user can fix it.

    Only this class (and its subclasses) maps to ``input-error``. Any other exception, including a bare
    ``ValueError`` or ``KeyError`` from library code, is a backend fault and maps to ``internal-error``.
    """

    code = INPUT_ERROR
    kind = INVALID_INPUT


class StaleCalibrationError(InputError):
    """The stored calibration profile no longer fits the audio (channel layout or safe range)."""

    code = STALE_CALIBRATION


class AnalysisSettingsError(InputError):
    """The STFT or analysis settings do not fit this file, e.g. a window longer than the audio."""

    kind = ANALYSIS_SETTINGS


class UnreadableFileError(InputError):
    """The file is missing, unsupported or not decodable."""

    kind = UNREADABLE_FILE


class MemoryBudgetError(InputError):
    """The request would exceed a memory budget."""

    kind = OUT_OF_MEMORY


def _raised_in(error: BaseException, modules: tuple[str, ...]) -> bool:
    traceback = error.__traceback__
    if traceback is None:
        return False
    while traceback.tb_next is not None:
        traceback = traceback.tb_next
    module = str(traceback.tb_frame.f_globals.get("__name__", ""))
    return any(module == name or module.startswith(name + ".") for name in modules)


def _link_kind(error: BaseException) -> str | None:
    if isinstance(error, MemoryError):
        return OUT_OF_MEMORY
    if isinstance(error, InputError) and error.kind != INVALID_INPUT:
        return error.kind
    if _raised_in(error, _READER_MODULES):
        return UNREADABLE_FILE
    if isinstance(error, ValueError) and _raised_in(error, _SETTINGS_MODULES):
        return ANALYSIS_SETTINGS
    return None


def error_kind(error: BaseException) -> str:
    """What the user is told went wrong: the first recognised cause along the ``raise ... from`` chain."""
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        kind = _link_kind(current)
        if kind is not None:
            return kind
        current = (
            current.__cause__ if current.__cause__ is not None or current.__suppress_context__ else current.__context__
        )
    return INVALID_INPUT if isinstance(error, InputError) else ANALYSIS_FAILED


def error_payload(error: BaseException) -> dict[str, str]:
    code = error.code if isinstance(error, InputError) else INTERNAL_ERROR
    return {"code": code, "kind": error_kind(error), "message": str(error) or type(error).__name__}
