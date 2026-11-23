"""The optional packages wandas imports for some operations, and which of them this runtime can import.

An operation that needs one of them (the step bar's catalog lists which, from operation_probe.needs) is
offered only where the package imports: the Web version's Pyodide runtime reports what it lacks when it
boots, so an operation becomes available there once its package does.
"""

from __future__ import annotations

import importlib.util

# Import name, and the distribution name runtime/lock.json and the catalog use (lower case, `_` for `-`).
OPTIONAL_MODULES: tuple[tuple[str, str], ...] = (
    ("librosa", "librosa"),
    ("mosqito", "mosqito"),
    ("h5netcdf", "h5netcdf"),
    ("sklearn", "scikit_learn"),
    ("torch", "torch"),
    ("tensorflow", "tensorflow"),
)


def lacking() -> list[str]:
    """The optional packages (distribution names) this runtime cannot import."""
    missing: list[str] = []
    for module, distribution in OPTIONAL_MODULES:
        try:
            found = importlib.util.find_spec(module) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            missing.append(distribution)
    return missing
