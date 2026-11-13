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
    listed = check.contract_decimators(check.contract())
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
        "    difference = compare.values - median\n",
        '    difference = np.asarray(compare.view["values"]) - np.asarray(first.view["values"])\n',
        "stage_combine:combine: Δ ",
    ),
    "overlay order from the drawn line": (
        "stage_combine",
        '    xs, values = data.xs, data.values\n    log = data.view.get("xScale") == "log"\n',
        "    xs, values = sv.spectrum_line(\n"
        "        data.xs, data.values, [1.0, data.nyquist], sv.SPECTRUM_LINE_BUCKETS\n"
        "    )\n"
        '    log = data.view.get("xScale") == "log"\n',
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


# Codex round 1 (P2): a drawn view returned by one function and read by another, in another module, through a dict,
# an attribute or a subscript, and a decision made of its points, each fail where they become a number sent.
FOLLOWED = {
    "a max of a returned view's values, sent": (
        {
            "scan_service": (
                "\n\ndef _peak_of(frame):\n    view = stage_view(frame)\n"
                '    return {"peakDb": float(np.max(view["values"]))}\n'
            )
        },
        " _peak_of: np.max(",
    ),
    "a helper in another module given the drawn view": (
        {
            "stage_combine": '\n\ndef _top_of(view):\n    return max(view["values"])\n',
            "scan_service": (
                "\n\nfrom stage_combine import _top_of\n\n\ndef _send_top(frame):\n"
                '    return {"peakDb": _top_of({"picture": stage_view(frame)}["picture"])}\n'
            ),
        },
        " _top_of: max(view['values'])",
    ),
    "a view kept on self and reduced later": (
        {
            "scan_service": (
                "\n\nclass _Kept:\n    def keep(self, frame):\n        self.view = stage_view(frame)\n\n"
                '    def send(self):\n        return {"peakDb": float(np.max(self.view["values"]))}\n'
            )
        },
        " _Kept.send: np.max(",
    ),
    "a comparison of drawn points sent": (
        {"scan_service": '\n\ndef _loud(frame):\n    return {"loud": bool(stage_view(frame)["values"][0] > -20)}\n'},
        " _loud: field 'loud' = decided by drawn points",
    ),
    "drawn points counted over a level": (
        {
            "scan_service": (
                '\n\ndef _count(frame):\n    return {"n": int(np.sum(np.asarray(stage_view(frame)["values"]) > -20))}\n'
            )
        },
        " _count: np.sum(",
    ),
}


@pytest.mark.parametrize("name", FOLLOWED)
def test_drawn_points_are_followed_across_functions_modules_and_decisions(backend: dict[str, str], name: str) -> None:
    added, expected = FOLLOWED[name]
    sources = {**backend, **{module: backend[module] + text for module, text in added.items()}}
    found = _new_problems(sources)
    assert any(expected in problem for problem in found), f"{name}: {found}"


def _draws(sources: dict[str, str], readers: set[str]) -> list[str]:
    return check.draws_problems(sources, readers)


def test_every_reader_the_contract_table_calls_draws_only_draws(backend: dict[str, str]) -> None:
    readers = check.contract_draws(check.contract())
    assert "stage_view:floored_db" in readers, "the table's backend 'draws' readers are read"
    assert _draws(backend, readers) == []


DRAWS_CALLER = (
    "\n\nfrom stage_combine import _floor_drawn\n\n\ndef _send_floor(frame):\n"
    '    return {"FIELD": _floor_drawn(stage_view(frame)["values"])}\n'
)
DRAWS_HELPER = "\n\ndef _floor_drawn(values):\n    return np.maximum(np.asarray(values), -120.0)\n"


def test_a_draws_reader_that_returns_a_max_into_a_headline_fails(backend: dict[str, str]) -> None:
    added = (
        "\n\ndef _drawn_headline(frame):\n    view = stage_view(frame)\n"
        '    return {"values": view["values"], "headline": float(np.max(view["values"]))}\n'
    )
    sources = {**backend, "scan_service": backend["scan_service"] + added}
    found = _draws(sources, {"scan_service:_drawn_headline"})
    assert any("scan_service.py:_drawn_headline: 'draws', but np.max(" in problem for problem in found), found


def test_a_draws_reader_whose_result_its_caller_sends_in_another_field_fails(backend: dict[str, str]) -> None:
    def sources(field: str) -> dict[str, str]:
        return {
            **backend,
            "stage_combine": backend["stage_combine"] + DRAWS_HELPER,
            "scan_service": backend["scan_service"] + DRAWS_CALLER.replace("FIELD", field),
        }

    found = _draws(sources("headline"), {"stage_combine:_floor_drawn"})
    expected = "stage_combine.py:_floor_drawn: 'draws', but its result becomes field 'headline' = drawn points"
    assert any(expected in problem for problem in found), found
    # The same result sent as the picture's drawn values is drawing.
    assert _draws(sources("values"), {"stage_combine:_floor_drawn"}) == []


def test_a_draws_reader_that_does_not_exist_fails(backend: dict[str, str]) -> None:
    assert _draws(backend, {"stage_view:no_such_reader"}) == [
        "python-backend/stage_view.py:no_such_reader: 'draws', but there is no such function"
    ]


# ── What is sent as drawn points comes from a registered thinning function ──


def test_the_drawn_fields_are_the_schemas_x_drawn_arrays_not_a_list_kept_here() -> None:
    arrays, holders = check.schema_fields(check.protocol_definitions(), "x-drawn")
    assert (arrays, holders) == (check.DRAWN_ARRAYS, check.DRAWN_HOLDERS)
    assert {"values", "matrix", "min", "max", "samples", "spectrumDb"} <= arrays
    assert "waveform" in holders
    assert list(check.schema_problems(check.protocol_definitions())) == []
    # A place of drawn points the schema does not mark x-place is told.
    assert "'xs'" in "".join(
        check.schema_problems({"View": {"properties": {"ys": {"type": "array", "items": {"x-place": True}}}}})
    )


def test_every_value_the_backend_sends_as_drawn_points_came_from_a_registered_thinning_function(
    backend: dict[str, str],
) -> None:
    assert (
        list(check.unthinned_problems(check.find_unthinned(backend), check.contract_unthinned(check.contract()))) == []
    )


def test_a_picture_thinned_by_a_function_that_is_not_registered_fails(backend: dict[str, str]) -> None:
    # The lanes' spectrogram thinned by a stepped slice written in place, instead of the registered resamplers.
    mutated = _mutated(
        backend,
        "analyzer",
        "    spectrogram = _resample_time_bins(spectrogram, time_bin_limit)\n"
        "    spectrogram = resample_frequency_bins(spectrogram, frequency_bin_limit)\n",
        "    spectrogram = spectrogram[::4, ::2]\n",
    )
    found = "\n".join(
        check.unthinned_problems(check.find_unthinned(mutated), check.contract_unthinned(check.contract()))
    )
    assert "_build_spectrogram: field 'values'" in found
    assert "add that function to both lists" in found


@pytest.mark.parametrize(
    "thinning",
    [
        "samples[::8]",
        "samples.reshape(-1, 8).max(axis=1)",
        "signal.resample(samples, 200)",
        "samples[np.linspace(0, samples.size - 1, 200).astype(int)]",
    ],
)
def test_any_way_of_thinning_is_caught_because_what_is_checked_is_where_the_value_came_from(thinning: str) -> None:
    source = (
        "import numpy as np\nfrom scipy import signal\n\n"
        f"def view(samples):\n    thin = {thinning}\n"
        '    return {"kind": "line", "values": thin.tolist()}\n'
    )
    assert check.find_unthinned({"new_view": source}) == {"python-backend/new_view.py:view#values": 6}


def test_an_empty_field_is_no_value_and_a_listed_place_needs_a_why_and_must_still_exist() -> None:
    source = 'def view():\n    return {"values": [], "matrix": None}\n'
    assert check.find_unthinned({"new_view": source}) == {}
    told = "\n".join(check.unthinned_problems({"a.py:f#values": 3}, {"a.py:f#values": " ", "a.py:gone#values": "why"}))
    assert "a.py:f#values says no why" in told
    assert "no longer found (remove its line): a.py:gone#values" in told
