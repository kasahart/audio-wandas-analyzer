"""Chart-spec IR: a small union of plot primitives that the TS webview can render.

The goal is to keep the TypeScript side analysis-agnostic. Every wandas frame
type gets adapted into one of four ``kind`` values:

* ``line``    — x/y line plot, one or more series (FFT, Welch, coherence, TF
  magnitude/phase, time-varying loudness, etc.)
* ``heatmap`` — 2-D matrix indexed by x and y axes (STFT, roughness spectrum)
* ``bar``     — categorical bars (octave / 1/N-octave bands)
* ``scalar``  — small key/value table (single-number metrics like Zwicker
  stationary loudness, DIN sharpness)

The TypedDict definitions below intentionally use plain ``list`` of ``float``
because the values are produced for JSON serialization. A NumPy → list cast
happens in ``wandas_to_chart``.

A JSON-Schema dump is produced by ``dump_schema()`` so the TS side can
keep a checked-in snapshot for cross-language type-drift detection. See
``src/test/chartSpecSchema.test.ts``.
"""

from __future__ import annotations

import json
import sys
from typing import Literal, TypedDict


class LineSeries(TypedDict, total=False):
    name: str
    ys: list[float]
    unit: str


class LineChart(TypedDict, total=False):
    kind: Literal["line"]
    title: str
    xLabel: str
    yLabel: str
    xs: list[float]
    series: list[LineSeries]
    xScale: Literal["linear", "log"]
    yScale: Literal["linear", "log", "db"]


class HeatmapChart(TypedDict, total=False):
    kind: Literal["heatmap"]
    title: str
    xLabel: str
    yLabel: str
    xs: list[float]
    ys: list[float]
    matrix: list[list[float]]
    unit: str
    colormap: str
    vmin: float
    vmax: float


class BarSeries(TypedDict, total=False):
    name: str
    values: list[float]
    unit: str


class BarChart(TypedDict, total=False):
    kind: Literal["bar"]
    title: str
    xLabel: str
    yLabel: str
    categories: list[str]
    series: list[BarSeries]


class ScalarRow(TypedDict, total=False):
    label: str
    value: float | str
    unit: str


class ScalarTable(TypedDict, total=False):
    kind: Literal["scalar"]
    title: str
    rows: list[ScalarRow]


# A ChartSpec is one of the four discriminated unions above. Python's typing
# is loose here on purpose — at runtime each adapter constructs a plain dict
# with the appropriate ``kind`` field, and the JSON Schema below is the
# authoritative wire contract.
ChartSpec = dict


def dump_schema() -> dict:
    """Return a JSON Schema (Draft 2020-12) describing the ChartSpec union.

    Kept hand-written (rather than generated from typing) so that the schema
    stays terse and the TS-side snapshot diff stays meaningful.
    """
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
