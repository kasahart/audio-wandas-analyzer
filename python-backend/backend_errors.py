"""Error codes shared by the desktop backend and the browser Worker.

Every failed request is answered with ``{"error": {"code": ..., "message": ...}}`` so the hosts
branch on ``code`` instead of matching exception text.
"""

from __future__ import annotations

INPUT_ERROR = "input-error"
STALE_CALIBRATION = "stale-calibration"
INTERNAL_ERROR = "internal-error"


class InputError(ValueError):
    """The request, the audio or a Recipe is invalid; the user can fix it.

    Only this class (and its subclasses) maps to ``input-error``. Any other exception, including a bare
    ``ValueError`` or ``KeyError`` from library code, is a backend fault and maps to ``internal-error``.
    """

    code = INPUT_ERROR


class StaleCalibrationError(InputError):
    """The stored calibration profile no longer fits the audio (channel layout or safe range)."""

    code = STALE_CALIBRATION


def error_payload(error: BaseException) -> dict[str, str]:
    code = error.code if isinstance(error, InputError) else INTERNAL_ERROR
    return {"code": code, "message": str(error) or type(error).__name__}
