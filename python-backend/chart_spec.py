"""ChartSpec JSON-Schema dump.

The TS side mirrors the ChartSpec union in ``src/shared/chartSpec.ts``.
A drift check (``src/test/chartSpecSchema.test.ts``) spawns this module
as ``python -m chart_spec`` and diffs the output against a checked-in
snapshot, so the two languages stay in lockstep without a code
generator.

Each ``oneOf`` branch covers one ``kind``:

* ``line``    — x/y line plot, one or more series.
* ``heatmap`` — 2D matrix indexed by xs and ys.
* ``bar``     — categorical bars, one or more series.
* ``scalar``  — small label/value/unit table.
"""

from __future__ import annotations

import json
import sys


def dump_schema() -> dict:
    """Return the Draft 2020-12 JSON Schema describing the ChartSpec union."""
    line = {
        "type": "object",
        "required": ["kind", "title", "xLabel", "yLabel", "xs", "series"],
        "properties": {
            "kind": {"const": "line"},
            "title": {"type": "string"},
            "xLabel": {"type": "string"},
            "yLabel": {"type": "string"},
            "xs": {"type": "array", "items": {"type": "number"}},
            "series": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["name", "ys"],
                    "properties": {
                        "name": {"type": "string"},
                        "ys": {"type": "array", "items": {"type": "number"}},
                        "unit": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
            },
            "xScale": {"enum": ["linear", "log"]},
            "yScale": {"enum": ["linear", "log", "db"]},
        },
        "additionalProperties": False,
    }
    heatmap = {
        "type": "object",
        "required": ["kind", "title", "xLabel", "yLabel", "xs", "ys", "matrix"],
        "properties": {
            "kind": {"const": "heatmap"},
            "title": {"type": "string"},
            "xLabel": {"type": "string"},
            "yLabel": {"type": "string"},
            "xs": {"type": "array", "items": {"type": "number"}},
            "ys": {"type": "array", "items": {"type": "number"}},
            "matrix": {
                "type": "array",
                "items": {"type": "array", "items": {"type": "number"}},
            },
            "unit": {"type": "string"},
            "colormap": {"type": "string"},
            "vmin": {"type": "number"},
            "vmax": {"type": "number"},
        },
        "additionalProperties": False,
    }
    bar = {
        "type": "object",
        "required": ["kind", "title", "xLabel", "yLabel", "categories", "series"],
        "properties": {
            "kind": {"const": "bar"},
            "title": {"type": "string"},
            "xLabel": {"type": "string"},
            "yLabel": {"type": "string"},
            "categories": {"type": "array", "items": {"type": "string"}},
            "series": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["name", "values"],
                    "properties": {
                        "name": {"type": "string"},
                        "values": {"type": "array", "items": {"type": "number"}},
                        "unit": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
            },
        },
        "additionalProperties": False,
    }
    scalar = {
        "type": "object",
        "required": ["kind", "title", "rows"],
        "properties": {
            "kind": {"const": "scalar"},
            "title": {"type": "string"},
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["label", "value"],
                    "properties": {
                        "label": {"type": "string"},
                        "value": {"type": ["number", "string"]},
                        "unit": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
            },
        },
        "additionalProperties": False,
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "ChartSpec",
        "oneOf": [line, heatmap, bar, scalar],
    }


if __name__ == "__main__":
    json.dump(dump_schema(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
