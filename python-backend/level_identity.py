"""What a recording's levels are in, for whether they compare (display-rules R1, R4).

One definition for the backend and the webview (src/webview/runtime/comparePanes.ts levelIdentityOf; both are held
to src/test/fixtures/levelIdentityCases.json): the channel's unit, its reference value and its level reference's label.
Calibration status is not part of it: a gain-corrected file in FS and a raw one are both in dBFS and compare; each
still says its own status where it is read.
"""

from __future__ import annotations

LevelIdentity = tuple[str, float, str]


def level_identity(unit: str | None, ref: float | int | str | None, label: str | None) -> LevelIdentity:
    """The identity of levels in ``unit`` at ``ref``, under the level reference named ``label``."""
    return (str(unit or ""), float(ref if ref is not None else 1.0), str(label or ""))
