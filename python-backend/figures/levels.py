"""The one silent floor of the figure service (docs/display-rules.md R2, R7, R9).

A level (or a gain) in dB at or below this is silence: no value to draw (a gap), to read or to put in a range.
A Δ and other plain values have no floor. ranges.py, thinning.py and pick.py read it from here so the three
rules cannot drift apart. The value is frames/analysis_spec.py's (the answers' extents are taken above it
too, services/tracks_answers.py).
"""

from frames.analysis_spec import SILENT_DB as SILENT_DB

#: The lowest level there is (wandas' silence is −240 dB re 1; −300 dB stands in for NaN and −inf only): an averaged
#: drawn cell is never under it (analysis_spec.MIN_LEVEL_DB).
FLOOR_DB = -300.0
