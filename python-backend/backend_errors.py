"""Error codes shared by the desktop backend and the browser Worker.

Every failed request is answered with ``{"error": {"code": ..., "message": ...}}`` so the hosts
branch on ``code`` instead of matching exception text.
"""

from __future__ import annotations

INPUT_ERROR = "input-error"
STALE_CALIBRATION = "stale-calibration"
INTERNAL_ERROR = "internal-error"


class StaleCalibrationError(ValueError):
    """The stored calibration profile no longer fits the audio (channel layout or safe range)."""

    code = STALE_CALIBRATION


def error_payload(error: BaseException) -> dict[str, str]:
    if isinstance(error, StaleCalibrationError):
        code = STALE_CALIBRATION
    elif isinstance(error, (ValueError, TypeError, LookupError)):
        code = INPUT_ERROR
    else:
        code = INTERNAL_ERROR
    if isinstance(error, KeyError) and error.args:
        message = f"Missing field: {error.args[0]}"
    else:
        message = str(error) or type(error).__name__
    return {"code": code, "message": message}
