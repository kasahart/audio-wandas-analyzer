"""Numpy reference, layer 1: the numbers the backend sends are the Frames' own full-resolution values.

Each answer here is computed independently: the Frame is made with wandas alone (the same steps over the same
samples) and the median, difference, largest difference, power and range are taken of its every value with numpy,
before any rounding. The backend is asked over its own JSON line protocol (``backend_server.py`` as a separate
process), so this module imports none of the app's code (a test below checks that) and cannot borrow its answers.

Every signal is built so that the full-data answer differs from what thinned or averaged data would give (a narrow
notch, nearby tones in a group, a one-sample spike, a one-frame burst, a rough spectrum against a smooth louder
one). Each case first checks that it is that hard: a case whose full and thinned answers agree fails by itself.

A known gap (docs/plot-contracts.md, the contract table's ``knownGaps``) is marked ``xfail(strict=True)`` with its
id: the fix makes the test pass, and the strict marker then fails until the mark is removed.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf
import wandas as wd
from scipy import signal as scipy_signal
from wandas.pipeline import RecipePlan

HERE = Path(__file__).parent
RATE = 16_000
#: The scan measures a file without its first and last 0.15 s (the analysis spec's edge guard, docs/display-rules).
EDGE_GUARD_S = 0.15
#: The spectra's x axis starts here (the analysis spec's lowest frequency drawn).
SPECTRUM_MIN_HZ = 20.0
#: Levels at or below this are silence: no power (the overlay's order, R6).
SILENT_DB = -250.0


# --- The backend, over its protocol -------------------------------------------------------------------------


#: How long one request may go unanswered. A reply takes seconds; the backend's heartbeat (every 5 s) would otherwise
#: keep a lost reply waiting for good, as it did on Windows CI with nothing in the log to say why.
REPLY_LIMIT_S = 120.0
#: Every this many seconds the backend writes all its threads' stacks to its log, so a reply that never comes shows
#: where the backend was.
STACK_DUMP_EVERY_S = 30.0


class Backend:
    """``backend_server.py`` in its own process, asked one request at a time as the extension asks it."""

    def __init__(self, log: Path) -> None:
        self._log_path = log
        self._log = log.open("w", encoding="utf-8")
        launch = (
            "import faulthandler, runpy, sys; "
            f"faulthandler.dump_traceback_later({STACK_DUMP_EVERY_S}, repeat=True, file=sys.stderr); "
            f"sys.argv = [{str(HERE / 'backend_server.py')!r}]; "
            "runpy.run_path(sys.argv[0], run_name='__main__')"
        )
        self._process = subprocess.Popen(
            [sys.executable, "-c", launch],
            cwd=HERE,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._log,
            text=True,
            encoding="utf-8",
        )
        self._count = 0
        assert self._read().get("type") == "ready", self._log_tail()

    def _log_tail(self) -> str:
        self._log.flush()
        text = self._log_path.read_text(encoding="utf-8", errors="replace")
        # From the last stack dump on (each starts with faulthandler's "Timeout (" line), else the log's end.
        start = text.rfind("Timeout (")
        return f"backend stderr, from its last stack dump:\n{text[start if start >= 0 else -6000 :]}"

    def _read(self) -> dict[str, Any]:
        assert self._process.stdout is not None
        line = self._process.stdout.readline()
        if not line:
            raise RuntimeError(f"the backend closed its output\n{self._log_tail()}")
        return json.loads(line)

    def ask(self, cmd: str, **payload: object) -> dict[str, Any]:
        assert self._process.stdin is not None
        self._count += 1
        request_id = f"ref-{self._count}"
        self._process.stdin.write(json.dumps({"cmd": cmd, "requestId": request_id, **payload}) + "\n")
        self._process.stdin.flush()
        asked = time.monotonic()
        while True:
            message = self._read()
            if message.get("requestId") != request_id or message.get("type") == "started":
                if time.monotonic() - asked > REPLY_LIMIT_S:
                    raise RuntimeError(f"{cmd}: no reply in {REPLY_LIMIT_S:.0f} s\n{self._log_tail()}")
                continue
            if "error" in message:
                raise RuntimeError(f"{cmd}: {message['error']}")
            return message

    def close(self) -> None:
        if self._process.stdin is not None:
            self._process.stdin.close()
        try:
            self._process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait()
        self._log.close()


@pytest.fixture(scope="module")
def backend(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Backend]:
    process = Backend(tmp_path_factory.mktemp("backend") / "stderr.log")
    yield process
    process.close()


# --- Recipes and the reference Frames, with wandas alone -----------------------------------------------------

_INPUT = {"id": "input-0", "name": "signal", "kind": "frame"}


def _slice(start: float, end: float | None) -> dict[str, object]:
    return {
        "id": "slice",
        "operation": "wandas.frame.time_slice",
        "version": 2,
        "inputs": ["input-0"],
        "params": {"$type": "map", "entries": [["end", end], ["start", start]]},
    }


def recipe(step: Callable[[Any], Any] | None = None) -> dict[str, Any]:
    """A Recipe that slices its input, then runs ``step`` (a wandas method chain), as the step bar builds one."""
    base = {"schema": "wandas.recipe", "version": 3, "inputs": [_INPUT]}
    if step is None:
        return {**base, "nodes": [_slice(0.0, None)], "output": "slice"}
    stand_in = wd.from_numpy(np.zeros((1, RATE)), sampling_rate=RATE, ch_labels=["signal0"])
    tail = RecipePlan.from_frame(step(stand_in), input_names=("signal",)).to_dict()
    source = tail["inputs"][0]["id"]
    nodes = [
        {**node, "inputs": ["slice" if name == source else name for name in node["inputs"]]} for node in tail["nodes"]
    ]
    return {**base, "nodes": [{**_slice(0.0, None), "inputs": [source]}, *nodes], "output": tail["output"]}


def reference_frame(path: Path, plan: dict[str, Any]) -> Any:
    """The step's Frame as wandas makes it over the region a scan measures (the file without its guarded ends)."""
    frame = wd.read_wav(str(path))
    duration = frame.n_samples / frame.sampling_rate
    nodes = [
        {**node, "params": _slice(EDGE_GUARD_S, duration - EDGE_GUARD_S)["params"]} if node["id"] == "slice" else node
        for node in plan["nodes"]
    ]
    return RecipePlan.from_dict({**plan, "nodes": nodes}).apply({"signal": frame})


def write(path: Path, samples: np.ndarray) -> Path:
    sf.write(path, np.asarray(samples, dtype=np.float32), RATE, subtype="FLOAT")
    return path


def scan(backend: Backend, path: Path, plan: dict[str, Any]) -> dict[str, Any]:
    result = backend.ask("scan", filePath=str(path), recipe=plan, stage=plan["output"])
    assert result["ok"], result
    return result["stage"]


_FIGURES = iter(range(1, 1_000_000))


def lines_spec(base: list[str], compare: str | None = None) -> dict[str, Any]:
    """A figure of lines as the comparison declares one: the base (a recording, or its group's median) and, with
    ``compare``, the compared recording over it and compare − base in a lane of its own."""
    keys = [*base, *([compare] if compare else [])]
    overlay = [{"id": "base", "of": {"median": base}, "role": "base"}]
    lanes: list[dict[str, Any]] = [{"id": "overlay", "kind": "lines", "lines": overlay}]
    if compare:
        overlay.append({"id": "compare", "of": {"key": compare}, "role": "compare1"})
        delta = {"id": "delta", "of": {"delta": {"compare": compare, "base": base}}}
        lanes.append({"id": "delta", "kind": "lines", "lines": [delta]})
    return {"lanes": lanes, "keys": [{"key": key, "state": "usable", "version": key} for key in keys]}


def draw(backend: Backend, spec: dict[str, Any]) -> dict[str, Any]:
    """The figure service's picture of ``spec``, whole (640 × 240 px), under a figure id of its own."""
    result = backend.ask(
        "figure-draw",
        figureId=f"ref-{next(_FIGURES)}",
        generation=1,
        requestNumber=1,
        spec=spec,
        width=640,
        height=240,
        view=None,
        selection=None,
    )
    assert result["status"] == "picture", result
    return result


def drawn_line(picture: dict[str, Any], lane: str, line: str) -> tuple[np.ndarray, np.ndarray]:
    found = next(item for item in picture["lanes"] if item["id"] == lane)
    points = next(item for item in found["lines"] if item["id"] == line)
    return np.asarray(points["xs"], dtype=np.float64), _floats(points["values"])


def every_value(
    backend: Backend, spec: dict[str, Any], picture: dict[str, Any], line: str
) -> tuple[np.ndarray, np.ndarray]:
    """Every value of ``line`` as the figure service writes it out (figure-export): none thinned, none rounded."""
    result = backend.ask("figure-export", spec=spec, view=None, dataId=picture["dataId"], requestNumber=2)
    assert result["status"] == "rows", result
    column = next(item for item in result["columns"] if item["line"] == line)
    return np.asarray(column["xs"], dtype=np.float64), _floats(column["values"])


def _floats(values: list[float | None]) -> np.ndarray:
    return np.asarray([np.nan if value is None else value for value in values], dtype=np.float64)


def spectrum_db(frame: Any) -> tuple[np.ndarray, np.ndarray]:
    """A one-channel spectrum's every bin in dB, unrounded, with its frequencies."""
    return np.asarray(frame.freqs, dtype=np.float64), np.asarray(frame.dB, dtype=np.float64).reshape(-1)


def drawn_band(freqs: np.ndarray) -> np.ndarray:
    """The bins the spectra are drawn over: 20 Hz to Nyquist, 0 Hz left out."""
    return (freqs >= SPECTRUM_MIN_HZ) & (freqs <= RATE / 2) & (freqs > 0)


def log_band_power_db(freqs: np.ndarray, levels: np.ndarray, bands: int = 192) -> np.ndarray:
    """``levels`` power-averaged in ``bands`` log-spaced bands from 20 Hz to Nyquist: the kind of reduction a
    picture or a 192-point spectrum makes, used only to show that a case is hard (never as an answer)."""
    edges = np.geomspace(SPECTRUM_MIN_HZ, RATE / 2, bands + 1)
    which = np.clip(np.searchsorted(edges, freqs, side="right") - 1, 0, bands - 1)
    keep = drawn_band(freqs)
    power = np.bincount(which[keep], weights=10 ** (levels[keep] / 10), minlength=bands)
    counts = np.bincount(which[keep], minlength=bands)
    return 10 * np.log10(np.divide(power, counts, out=np.full(bands, np.nan), where=counts > 0))


def log_band_max_db(freqs: np.ndarray, levels: np.ndarray, bands: int = 192) -> np.ndarray:
    """Each log band's highest bin: a peak-picked 192-point spectrum, used only to show a case is hard."""
    edges = np.geomspace(SPECTRUM_MIN_HZ, RATE / 2, bands + 1)
    which = np.clip(np.searchsorted(edges, freqs, side="right") - 1, 0, bands - 1)
    out = np.full(bands, -np.inf)
    keep = drawn_band(freqs)
    np.maximum.at(out, which[keep], levels[keep])
    return out


# --- The module itself: no app code ----------------------------------------------------------------------------

#: What this layer may import: the standard library, numpy, scipy, soundfile, wandas and pytest.
ALLOWED_IMPORTS = {"__future__", "ast", "collections", "json", "pathlib", "subprocess", "sys", "time", "typing"}
ALLOWED_PACKAGES = {"numpy", "pytest", "scipy", "soundfile", "wandas"}


def test_this_layer_imports_none_of_the_apps_code() -> None:
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            names.add((node.module or "").split(".")[0])
    app_modules = {path.stem for path in HERE.glob("*.py")}
    assert not names & app_modules
    assert names <= ALLOWED_IMPORTS | ALLOWED_PACKAGES, names - ALLOWED_IMPORTS - ALLOWED_PACKAGES


# --- A spectrum: a narrow notch, the largest difference, a group's median, the overlay's order -----------------

N_FFT = 16_384
WELCH = recipe(lambda frame: frame.welch(n_fft=N_FFT))
NOTCH_HZ = 6_000.0
#: Small tones in the compared recording, each on its own FFT bin (bins of every remainder modulo 2, 3, 4 and 6):
#: one-bin difference peaks smaller than the notch, which a line that skips points loses whatever its phase.
BUMP_BINS = tuple(
    round(hz / (RATE / N_FFT)) + offset for offset, hz in enumerate((2_000, 2_500, 3_000, 3_500, 4_500, 5_000))
)


def _noise(seed: int, seconds: float, sigma: float = 0.05) -> np.ndarray:
    return sigma * np.random.default_rng(seed).standard_normal(int(seconds * RATE))


@pytest.fixture(scope="module")
def notch(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """Three base recordings of noise, and a compared one whose noise has a notch some 20 bins wide at 6 kHz and
    six small one-bin tones from 2 to 5 kHz: its difference from the base dips far deeper than it rises, over far
    fewer bins than a 192-point spectrum has in one band there."""
    folder = tmp_path_factory.mktemp("notch")
    paths = {f"base{index}": write(folder / f"base{index}.wav", _noise(index, 16)) for index in range(3)}
    b, a = scipy_signal.iirnotch(NOTCH_HZ, Q=300, fs=RATE)
    noise = scipy_signal.filtfilt(b, a, scipy_signal.filtfilt(b, a, _noise(9, 16)))
    t = np.arange(noise.size) / RATE
    bumps = sum(0.004 * np.sin(2 * np.pi * k * (RATE / N_FFT) * t) for k in BUMP_BINS)
    paths["compare"] = write(folder / "compare.wav", noise + bumps)
    return paths


def _notch_answer(notch: dict[str, Path]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The frequencies, the base's median and compare − median, bin by bin, from the reference Frames."""
    spectra = [spectrum_db(reference_frame(notch[name], WELCH)) for name in ("base0", "base1", "base2", "compare")]
    freqs = spectra[0][0]
    median = np.median(np.stack([levels for _, levels in spectra[:3]]), axis=0)
    return freqs, median, spectra[3][1] - median


def test_the_notch_case_is_hard(notch: dict[str, Path]) -> None:
    freqs, median, delta = _notch_answer(notch)
    keep = drawn_band(freqs)
    # Bin by bin, the notch is the largest difference, and far below anything else.
    at = int(np.flatnonzero(keep)[np.argmax(np.abs(delta[keep]))])
    assert abs(freqs[at] - NOTCH_HZ) < 15 and delta[at] < -25
    # A 192-point spectrum (each band's power, or each band's highest bin) all but loses it.
    compare = spectrum_db(reference_frame(notch["compare"], WELCH))[1]
    banded = log_band_power_db(freqs, compare) - log_band_power_db(freqs, median)
    with np.errstate(invalid="ignore"):  # bands with no bin are -inf in both
        picked = log_band_max_db(freqs, compare) - log_band_max_db(freqs, median)
    assert np.nanmin(banded) > delta[at] + 20
    assert picked[np.isfinite(picked)].min() > delta[at] + 20


def _notch_figure(backend: Backend, notch: dict[str, Path]) -> tuple[dict[str, Any], dict[str, Any]]:
    keys = [scan(backend, notch[name], WELCH)["data"] for name in ("base0", "base1", "base2", "compare")]
    spec = lines_spec(keys[:3], keys[3])
    return spec, draw(backend, spec)


def test_the_difference_headline_is_the_notch_at_its_bin_with_its_unrounded_depth(
    backend: Backend, notch: dict[str, Path]
) -> None:
    freqs, _, delta = _notch_answer(notch)
    _, picture = _notch_figure(backend, notch)
    keep = drawn_band(freqs)
    at = int(np.flatnonzero(keep)[np.argmax(np.abs(delta[keep]))])
    (peak,) = picture["headlines"]
    assert (peak["lane"], peak["line"]) == ("delta", "delta")
    assert peak["x"] == pytest.approx(freqs[at], abs=1e-9)
    # The Frame's unrounded difference itself (to the reference's own float32 arithmetic).
    assert peak["value"] == pytest.approx(delta[at], abs=5e-4)


def test_the_drawn_difference_keeps_the_notch_and_every_bump_at_their_own_bins_depth_and_height(
    backend: Backend, notch: dict[str, Path]
) -> None:
    freqs, _, delta = _notch_answer(notch)
    _, picture = _notch_figure(backend, notch)
    xs, values = drawn_line(picture, "delta", "delta")
    assert xs.size < drawn_band(freqs).sum()  # thinned: fewer points than bins
    keep = drawn_band(freqs)
    # Thinning keeps each bucket's extremes (the rounding of drawn points only: the next test reads every value).
    at = int(np.flatnonzero(keep)[np.argmin(delta[keep])])
    assert np.nanmin(values) == pytest.approx(delta[at], abs=0.02)
    assert xs[np.nanargmin(values)] == pytest.approx(freqs[at], abs=1e-9)
    for k in BUMP_BINS:
        # Hard: the bump is one bin, its neighbours some 6 dB lower.
        assert delta[k] > max(delta[k - 1], delta[k + 1]) + 3
        near = np.abs(xs - freqs[k]) <= 3 * RATE / N_FFT
        # Drawn at its own bin, at its height.
        assert np.nanmax(values[near]) == pytest.approx(delta[k], abs=0.02)
        assert xs[near][np.nanargmax(values[near])] == pytest.approx(freqs[k], abs=1e-9)


def test_every_value_of_the_difference_is_the_frames_unrounded_difference_bin_by_bin(
    backend: Backend, notch: dict[str, Path]
) -> None:
    freqs, _, delta = _notch_answer(notch)
    spec, picture = _notch_figure(backend, notch)
    xs, values = every_value(backend, spec, picture, "delta")
    window = [NOTCH_HZ - 200, NOTCH_HZ + 200]
    inside = (freqs >= window[0]) & (freqs <= window[1])
    sent = (xs >= window[0]) & (xs <= window[1])
    np.testing.assert_allclose(xs[sent], freqs[inside], atol=1e-9)
    # The Frame's unrounded difference itself (to the reference's own float32 arithmetic): only the text the webview
    # writes rounds it, never the values (two levels 0.008 dB apart stay apart, not both at the same 0.01 dB).
    np.testing.assert_allclose(values[sent], delta[inside], rtol=0, atol=5e-4)
    assert np.mean(np.abs(values[sent] - np.round(values[sent], 2)) > 1e-3) > 0.5


@pytest.fixture(scope="module")
def nearby_tones(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """Three recordings of noise, each with a loud tone a few bins from the others' at about 6 kHz: in every bin
    at most one of them has its tone, so the median has none, though each band of a 192-point spectrum there
    holds all three tones."""
    folder = tmp_path_factory.mktemp("nearby")
    bin_hz = RATE / N_FFT
    paths = {}
    for index in range(3):
        noise = _noise(20 + index, 16, sigma=0.01)
        t = np.arange(noise.size) / RATE
        tone_hz = (round(NOTCH_HZ / bin_hz) + 8 * index) * bin_hz
        paths[f"base{index}"] = write(folder / f"{index}.wav", noise + 0.3 * np.sin(2 * np.pi * tone_hz * t))
    return paths


def test_a_groups_median_is_taken_bin_by_bin_so_tones_in_other_bins_do_not_make_one(
    backend: Backend, nearby_tones: dict[str, Path]
) -> None:
    spectra = [spectrum_db(reference_frame(nearby_tones[f"base{index}"], WELCH)) for index in range(3)]
    freqs = spectra[0][0]
    median = np.median(np.stack([levels for _, levels in spectra]), axis=0)
    window = [NOTCH_HZ - 100, NOTCH_HZ + 100]
    inside = (freqs >= window[0]) & (freqs <= window[1])
    # Hard: each band's highest bin, then the median, shows a tone some 40 dB over the bin-by-bin median.
    picked = np.median(np.stack([log_band_max_db(freqs, levels) for _, levels in spectra]), axis=0)
    band = int(np.searchsorted(np.geomspace(SPECTRUM_MIN_HZ, RATE / 2, 193), NOTCH_HZ, side="right") - 1)
    assert picked[band] > median[inside].max() + 30

    keys = [scan(backend, nearby_tones[f"base{index}"], WELCH)["data"] for index in range(3)]
    spec = lines_spec(keys)
    picture = draw(backend, spec)
    xs, drawn = drawn_line(picture, "overlay", "base")
    near = (xs >= window[0]) & (xs <= window[1])
    # The drawn median keeps the bins' highest median there, and nothing like the tones.
    assert np.nanmax(drawn[near]) == pytest.approx(median[inside].max(), abs=0.01)
    every_x, every = every_value(backend, spec, picture, "base")
    sent = (every_x >= window[0]) & (every_x <= window[1])
    np.testing.assert_allclose(every_x[sent], freqs[inside], atol=1e-9)
    np.testing.assert_allclose(every[sent], median[inside], atol=5e-4)


ORDER_WINDOW = (1_000.0, 4_000.0)
ORDER_LOUDER_DB = 1.0


@pytest.fixture(scope="module")
def rough_and_smooth(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """A rough spectrum (one and a half seconds: one Welch segment, bins scattered by several dB) and a smooth
    one 1 dB louder (sixteen seconds): every bin's power says the smooth one is louder; each stretch's highest
    and lowest bins (what a thinned line keeps) say the rough one is."""
    folder = tmp_path_factory.mktemp("order")
    return {
        "rough": write(folder / "rough.wav", _noise(31, 1.5 + 2 * EDGE_GUARD_S)),
        "smooth": write(folder / "smooth.wav", _noise(32, 16, sigma=0.05 * 10 ** (ORDER_LOUDER_DB / 20))),
    }


def _mean_power(levels: np.ndarray) -> float:
    return float(np.mean(np.where(levels <= SILENT_DB, 0.0, 10 ** (levels / 10))))


def test_the_order_case_is_hard(rough_and_smooth: dict[str, Path]) -> None:
    true, extremes = {}, {}
    for name, path in rough_and_smooth.items():
        freqs, levels = spectrum_db(reference_frame(path, WELCH))
        inside = (freqs >= ORDER_WINDOW[0]) & (freqs <= ORDER_WINDOW[1])
        true[name] = _mean_power(levels[inside])
        blocks = np.array_split(levels[inside], 200)
        extremes[name] = _mean_power(np.concatenate([[block.min(), block.max()] for block in blocks]))
    assert true["smooth"] > true["rough"]
    assert extremes["rough"] > extremes["smooth"]


# --- A time signal: a one-sample spike ------------------------------------------------------------------------

SIGNAL = recipe()
SPIKE_S = 4.321
SPIKE = 0.9


@pytest.fixture(scope="module")
def spike(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """A base of noise, and the same noise with a little more and one sample 0.9 higher: their sample difference
    is a single spike that any averaged bucket of samples drowns."""
    folder = tmp_path_factory.mktemp("spike")
    base = _noise(41, 10, sigma=0.1)
    compare = base + _noise(42, 10, sigma=0.001)
    compare[int(round(SPIKE_S * RATE))] += SPIKE
    return {"base": write(folder / "base.wav", base), "compare": write(folder / "compare.wav", compare)}


def _samples(frame: Any) -> np.ndarray:
    return np.asarray(frame.data, dtype=np.float64).reshape(-1)


def test_a_time_signals_one_sample_spike_is_drawn_at_its_height_and_read_as_its_own_sample(
    backend: Backend, spike: dict[str, Path]
) -> None:
    """The comparison draws each recording's own samples (a time signal has no Δ lane): the spike is one sample of
    the compared recording, which a bucket of averaged samples would drown."""
    samples = _samples(reference_frame(spike["compare"], SIGNAL))
    at = int(np.argmax(np.abs(samples)))
    # The Frame's time starts at its slice; the plot's axis is the file's time.
    start = EDGE_GUARD_S
    assert at == int(round((SPIKE_S - start) * RATE))
    # Hard: 640 averaged buckets (one a pixel column) leave nothing of the spike's height.
    assert np.abs(np.array([block.mean() for block in np.array_split(samples, 640)])).max() < samples[at] / 20

    key = scan(backend, spike["compare"], SIGNAL)["data"]
    line = {"id": "sound", "role": "compare1", "of": {"key": key}}
    spec = {
        "lanes": [{"id": "sound", "kind": "band", "lines": [line]}],
        "keys": [{"key": key, "state": "usable", "version": key}],
    }
    picture = draw(backend, spec)
    xs, drawn = drawn_line(picture, "sound", "sound")
    assert drawn.size < samples.size
    assert np.nanmax(drawn) == pytest.approx(samples[at], abs=1e-6)
    assert xs[int(np.nanargmax(drawn))] == pytest.approx(start + at / RATE, abs=0.5 / RATE)
    # A pointer a pixel column beside the spike, at its height, reads the spike's own sample.
    (lane,) = picture["lanes"]
    x0, x1 = lane["range"]["x"]
    y0, y1 = lane["range"]["y"]
    scale = [640 / (x1 - x0), 240 / (y1 - y0)]
    pointer = {"lane": "sound", "x": start + at / RATE + 1 / scale[0], "y": float(samples[at]), "scale": scale}
    read = backend.ask(
        "figure-read", figureId=picture["figureId"], pictureId=picture["pictureId"], requestNumber=2, pointer=pointer
    )
    assert read["status"] == "point", read
    assert read["point"]["index"] == at
    assert read["point"]["value"] == pytest.approx(samples[at], abs=1e-6)
    assert read["point"]["x"] == pytest.approx(start + at / RATE, abs=0.5 / RATE)


# --- A spectrogram: a one-frame burst in a long recording ------------------------------------------------------

STFT_N_FFT, STFT_HOP = 512, 128
STFT = recipe(lambda frame: frame.stft(n_fft=STFT_N_FFT, hop_length=STFT_HOP))
BURST_S, BURST_HZ = 17.0, 4_000.0


@pytest.fixture(scope="module")
def burst(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """Thirty seconds of quiet noise, and the same with a 4 kHz burst 128 samples long: in the STFT a few frames
    hold it; a picture's cells average some thirty frames each and lose most of it."""
    folder = tmp_path_factory.mktemp("burst")
    base = _noise(51, 30, sigma=0.001)
    compare = base.copy()
    first = int(BURST_S * RATE)
    t = np.arange(STFT_HOP) / RATE
    compare[first : first + STFT_HOP] += 0.5 * np.sin(2 * np.pi * BURST_HZ * t)
    return {"base": write(folder / "base.wav", base), "compare": write(folder / "compare.wav", compare)}


def _plane_db(frame: Any) -> np.ndarray:
    return np.asarray(frame.dB, dtype=np.float64).reshape(-1, *np.shape(frame.dB)[-2:]).mean(axis=0)


def test_a_spectrograms_one_frame_burst_is_drawn_at_its_height_and_read_as_its_own_cell(
    backend: Backend, burst: dict[str, Path]
) -> None:
    """The comparison draws one recording's spectrogram (an image has no Δ): a drawn column stands for some thirty
    frames and still shows the burst, and the cell a pointer reads is the STFT's own, unrounded."""
    frame = reference_frame(burst["compare"], STFT)
    freqs = np.asarray(frame.freqs, dtype=np.float64)
    times = np.asarray(frame.times, dtype=np.float64)
    plane = _plane_db(frame)
    rows = (freqs >= SPECTRUM_MIN_HZ) & (freqs > 0)
    part = plane[np.ix_(rows, np.arange(times.size))]
    row, column = np.unravel_index(int(np.argmax(part)), part.shape)
    row = int(np.flatnonzero(rows)[row])
    # Hard: thirty frames power-averaged put the burst far under its own cell.
    thirty = 10 * np.log10(np.convolve(10 ** (plane[row] / 10), np.ones(30) / 30, mode="valid"))
    assert plane[row, column] - thirty.max() > 6

    key = scan(backend, burst["compare"], STFT)["data"]
    spec = {
        "lanes": [{"id": "image", "kind": "image", "lines": [{"id": "sound", "of": {"key": key}}]}],
        "keys": [{"key": key, "state": "usable", "version": key}],
    }
    picture = draw(backend, spec)
    (lane,) = picture["lanes"]
    cells = np.asarray([[np.nan if v is None else v for v in line] for line in lane["image"]["cells"]])
    assert cells.shape[1] < times.size, "the picture averages frames into its columns"
    # Its drawn cell keeps the burst's height (a drawn point, rounded to a tenth), not the thirty frames' average.
    assert np.nanmax(cells) == pytest.approx(plane[row, column], abs=0.05)
    pointer = {"lane": "image", "x": EDGE_GUARD_S + float(times[column]), "y": float(freqs[row]), "scale": [1.0, 1.0]}
    read = backend.ask(
        "figure-read", figureId=picture["figureId"], pictureId=picture["pictureId"], requestNumber=2, pointer=pointer
    )
    assert read["status"] == "point", read
    assert read["point"]["y"] == pytest.approx(freqs[row], abs=1e-9)
    assert read["point"]["x"] == pytest.approx(EDGE_GUARD_S + times[column], abs=STFT_HOP / RATE / 2)
    assert read["point"]["value"] == pytest.approx(plane[row, column], abs=5e-4)
