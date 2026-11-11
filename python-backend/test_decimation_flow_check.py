"""scripts/check_decimation_flow.py: it passes on the backend as it is, and fails on each kind of number made of drawn
points when one is put into the backend's real code (a headline, a median, a Δ, an order, a range, a readout)."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_decimation_flow.py"
_spec = importlib.util.spec_from_file_location("check_decimation_flow", SCRIPT)
assert _spec is not None and _spec.loader is not None
check = importlib.util.module_from_spec(_spec)
sys.modules["check_decimation_flow"] = check
_spec.loader.exec_module(check)


@pytest.fixture(scope="module")
def backend() -> dict[str, str]:
    return check.backend_sources()


def _new_problems(sources: dict[str, str]) -> list[str]:
    return [problem for problem in check.problems(check.find_flows(sources)) if "KNOWN_FLOWS" not in problem]


def _mutated(backend: dict[str, str], module: str, old: str, new: str) -> dict[str, str]:
    assert backend[module].count(old) == 1, f"{module}: the line to change is not there once: {old}"
    return {**backend, module: backend[module].replace(old, new)}


def test_the_backend_as_it_is_passes(backend: dict[str, str]) -> None:
    assert list(check.problems(check.find_flows(backend))) == []


def test_the_thinning_functions_are_the_contract_tables(backend: dict[str, str]) -> None:
    listed = check.contract_decimators(check.VALUES_TS.read_text(encoding="utf-8"))
    assert listed == set(check.SOURCES) - check.BUCKET_RULE


# Each mutation is a bug of the class the check stands for, written as it would be written in the real code.
MUTATIONS = {
    "headline from the drawn Δ": (
        "stage_combine",
        "    peak = difference_peak(drawn, difference, _on_screen(detail))\n",
        '    peak = {"x": 0.0, "value": float(np.max(result["diff"]["values"]))}\n',
        "stage_combine:combine: np.max(",
    ),
    "headline searched in the drawn Δ (through a call)": (
        "stage_combine",
        "    peak = difference_peak(drawn, difference, _on_screen(detail))\n",
        '    peak = difference_peak(drawn, np.asarray(result["diff"]["values"]), _on_screen(detail))\n',
        "stage_combine:difference_peak: np.argmax(",
    ),
    "median of the recordings' drawn lines": (
        "stage_combine",
        "    median = _median(base) if len(base) > 1 else",
        '    median = np.median(np.stack([item.view["values"] for item in base]), axis=0) if len(base) > 1 else',
        "stage_combine:combine: np.median(",
    ),
    "Δ of two drawn lines": (
        "stage_combine",
        "        else _f64(compare.values) - median\n",
        '        else np.asarray(compare.view["values"]) - np.asarray(first.view["values"])\n',
        "stage_combine:combine: Δ ",
    ),
    "overlay order from the drawn line": (
        "stage_combine",
        "    xs, values = data.xs, _f64(data.values)\n",
        "    xs, values = sv.spectrum_line(\n"
        "        data.xs, _f64(data.values), [1.0, data.nyquist], sv.SPECTRUM_LINE_BUCKETS\n"
        "    )\n",
        "stage_combine:level_bins: field 'power' = drawn points",
    ),
    "colour range from the block-averaged image": (
        "stage_view",
        "    centres, matrix = _log_points(columns.T, freqs, HEATMAP_FREQUENCIES, nyquist)\n",
        "    centres, matrix = _log_points(columns.T, freqs, HEATMAP_FREQUENCIES, nyquist)\n"
        "    _range = float(np.percentile(columns, 99))\n",
        "stage_view:_spectrogram_view: np.percentile(",
    ),
    "peak readout from the cut cursor spectrum": (
        "analysis_service",
        '                    "minDb": ends[channel_index][0],\n',
        '                    "minDb": ends[channel_index][0],\n'
        '                    "peakHz": float(frequencies_hz[int(np.argmax(row))]) if bands is None else 0.0,\n',
        "analysis_service:AnalysisService.spectrum_slice: np.argmax(",
    ),
    "Δ field sent from the drawn line": (
        "stage_view",
        '        "values": _json(floored_db(values)),\n',
        '        "values": _json(floored_db(values)),\n        "delta": _json(values),\n',
        "stage_view:_channel_view: field 'delta'",
    ),
}


@pytest.mark.parametrize("name", sorted(MUTATIONS))
def test_a_number_made_of_drawn_points_fails(backend: dict[str, str], name: str) -> None:
    module, old, new, expected = MUTATIONS[name]
    found = _new_problems(_mutated(backend, module, old, new))
    where, rest = expected.split(":", 1)
    function, what = rest.split(": ", 1)
    pattern = re.compile(rf"^python-backend/{where}\.py:\d+ {re.escape(function)}: {re.escape(what)}")
    assert any(pattern.search(problem) for problem in found), f"{name}: no problem names {expected}: {found}"


def test_a_known_flow_that_is_fixed_must_leave_the_list(backend: dict[str, str]) -> None:
    # The spectrogram's colour range was taken of its drawn cells, and is now every cell's: listed still, it fails.
    known = {**check.KNOWN_FLOWS, "analyzer:_build_spectrogram: np.min(spectrogram)": "fixed"}
    stale = [problem for problem in check.problems(check.find_flows(backend), known) if "KNOWN_FLOWS" in problem]
    assert any("analyzer:_build_spectrogram: np.min(spectrogram)" in problem for problem in stale), stale


def _toy(body: str) -> list[str]:
    """Flows in a module of the given body, beside a stand-in for stage_view's thinning functions."""
    thinning = (
        "def min_max_line(xs, values, buckets, log, span=None):\n    return xs, values\n\n"
        "def _time_blocks(count):\n    return [slice(0, count)]\n"
    )
    flows = check.Program({"stage_view": thinning, "toy": "import numpy as np\nimport stage_view as sv\n" + body}).run()
    return [flow.key for flow in flows]


def test_thinning_an_image_by_its_blocks_is_drawing_and_one_number_of_it_is_a_flow() -> None:
    body = (
        "def picture(plane):\n"
        "    blocks = sv._time_blocks(plane.shape[1])\n"
        "    columns = np.stack([np.mean(plane[:, block], axis=1) for block in blocks], axis=1)\n"
        "    return {'matrix': columns.tolist()}\n\n"
        "def ranged(plane):\n"
        "    picture_ = picture(plane)\n"
        "    return {'minDb': float(np.min(picture_['matrix']))}\n"
    )
    assert _toy(body) == ["toy:ranged: field 'minDb' = drawn points", "toy:ranged: np.min(picture_['matrix'])"]


def test_drawn_points_kept_in_a_store_are_followed_to_where_they_are_read() -> None:
    body = (
        "CACHE = {}\n\n"
        "class Lane:\n"
        "    def draw(self, xs, values):\n"
        "        self.line = sv.min_max_line(xs, values, 10, False)\n"
        "        CACHE['line'] = self.line\n\n"
        "    def readout(self):\n"
        "        return {'value': float(self.line[1][0])}\n\n"
        "def headline():\n"
        "    return np.argmax(CACHE['line'][1])\n"
    )
    assert _toy(body) == ["toy:Lane.readout: field 'value' = drawn points", "toy:headline: np.argmax(CACHE['line'][1])"]


def test_a_picture_s_other_fields_and_its_full_data_stay_clean() -> None:
    body = (
        "def view(xs, values):\n"
        "    line_xs, line = sv.min_max_line(xs, values, 10, False)\n"
        "    return {'xs': line_xs, 'values': line, 'peak': float(np.max(values)), 'unit': 'Pa'}\n\n"
        "def use(xs, values):\n"
        "    shown = view(xs, values)\n"
        "    return {'unit': shown['unit'], 'peak': shown['peak'], 'values': shown['values']}\n"
    )
    assert _toy(body) == []
