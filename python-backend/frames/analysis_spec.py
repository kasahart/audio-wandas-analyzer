"""The fixed values a scan and its pictures share (scan_service.py, stage_view.py, the figure service's adapter).

``ANALYSIS_SPEC_VERSION`` is sent with every scan (``specVersion``): bump it when a value below changes.
"""

from __future__ import annotations

ANALYSIS_SPEC_VERSION = 7

# wandas filters zero-phase (filtfilt), so a Recipe's filters ring at both ends of the file: left in, the
# entry Recipe's 20 Hz high-pass raises a pure tone's crest factor from 1.41 to 2.08. A scan skips this
# much of a region where it touches the file's start or end, which brings the tone back within 0.1 %.
EDGE_GUARD_S = 0.15
WELCH_N_FFT = 1024
# The lowest frequency a spectrum is drawn from, up to Nyquist.
SPECTRUM_MIN_HZ = 20.0
# Floor for levels of silent channels, which would otherwise be -inf and not JSON.
MIN_LEVEL_DB = -300.0
# A level (or a gain) in dB at or below this is silence: no value to draw, to read or to put in a range
# (docs/display-rules.md R2, R7, R9). The figure service reads it through figures/levels.py.
SILENT_DB = -250.0
