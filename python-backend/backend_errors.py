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

# Where a ValueError means an operation's parameters do not fit this signal: wandas' operations check
# cutoffs, bands and lengths against it; scipy's ShortTimeFFT ("Parameter n must be >= ceil(m_num/2)")
# and Welch, CSD and coherence ("noverlap must be less than nperseg") check the window and hop, its
# window functions the window name, and its zero-phase filters the length ("must be greater than
# padlen"). Other scipy.signal modules are left as faults.
_SETTINGS_MODULES = (
    "wandas.processing",
    "scipy.signal._short_time_fft",
    "scipy.signal._spectral_py",
    "scipy.signal.windows",
    "scipy.signal._signaltools",
)


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
    """The analysis settings do not fit this file, e.g. an STFT window longer than the audio."""

    kind = ANALYSIS_SETTINGS


class UnreadableFileError(InputError):
    """Reading the file failed: it is missing, unsupported or not decodable. Raised only where a file is read."""

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
