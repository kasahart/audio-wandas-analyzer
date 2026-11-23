"""The ui-smoke tests' figure service: the real one (figures/service.py, its five computations unchanged), whose answers
are the pictures a test posted to the page in place of a backend's scan (stub StageViews), instead of the scans the
backend keeps (transport/figure_answers.py). A test whose page shows the spectrum overlay on a stand-in host talks to it
(src/test/uiSmoke/figureStandIn.ts): what the Figure is drawn, counted and read from is layer 2's own code, never a
copy of it in the test.

One request per line on stdin, as JSON: ``{"id", "command", "payload", "answers": {key: stub}}``, each stub a
picture's ``xs``, ``values`` (null for a gap), ``identity`` ([unit, ref, label]) and ``xLimits``. One line back per
request: ``{"id", "result"}`` or ``{"id", "error"}``.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402

from figures.answers import Answer, ColumnAnswer, EventsAnswer, ImageAnswer, SignalAnswer  # noqa: E402
from figures.service import FigureRequestError, FigureService  # noqa: E402
from figures.thinning import cell_edges  # noqa: E402
from services import combine_ops  # noqa: E402
from services.answer_store import Columns  # noqa: E402


class CombineOps:
    """LayerOne by services/combine_ops.py, as transport/figure_answers.py hands it (without importing wandas)."""

    def median(self, rows: Any) -> Any:
        return combine_ops.median(rows)

    def level_delta(self, compare: Any, base: Any) -> Any:
        return combine_ops.level_delta(compare, base)

    def difference(self, compare: Any, base: Any) -> Any:
        return combine_ops.difference(compare, base)

    def common_length(self, rows: Any) -> Any:
        return combine_ops.common_length(rows)

    def signal_difference(self, compare: Any, base: Any) -> Any:
        return combine_ops.signal_difference(compare, base)


def _edges(xs: Any, log: bool) -> list[float]:
    """The axis across of a picture with no xLimits, as the recorded cases were drawn: on a log axis
    half a ratio beyond its first and last place, else its first to last place."""
    if xs.size < 2:
        return [20.0, 20000.0]
    first, second, last = float(xs[0]), float(xs[1]), float(xs[-1])
    if log and first > 0 and second > first:
        ratio = (second / first) ** 0.5
        return [first / ratio, last * ratio]
    return [first, last]


class StubAnswers:
    """The pictures a test posted, by the key the page gave each (its version is the key, as the backend's), and the
    table columns the page handed with its requests (kept as the backend keeps them: services/answer_store.py)."""

    def __init__(self) -> None:
        self.held: dict[str, Answer | SignalAnswer | ImageAnswer | EventsAnswer] = {}
        self.columns = Columns()

    def take(self, answers: Mapping[str, Mapping[str, Any] | None]) -> None:
        for key, stub in answers.items():
            if stub is None:
                # Let go, as a backend's store that made room: no answer is held under the key any more.
                self.held.pop(key, None)
                continue
            xs = np.asarray(stub.get("xs") or [], dtype=np.float64)
            values = np.asarray(
                [np.nan if value is None else value for value in stub.get("values") or []], dtype=np.float64
            )
            unit, ref, label = stub.get("identity") or ["", 1.0, ""]
            if stub.get("kind") == "heatmap":
                # An image: the picture's cells are the stand-in's answer cells (rows over ys), as the test gave them.
                ys = np.asarray(stub.get("ys") or [], dtype=np.float64)
                cells = np.asarray(
                    [[np.nan if cell is None else cell for cell in row] for row in stub.get("matrix") or []],
                    dtype=np.float64,
                )
                if xs.size < 2 or ys.size < 2 or cells.shape != (ys.size, xs.size):
                    continue
                y_kind = str(stub.get("yAxis") or "frequency")
                # A Tracks row's levels are up a linear frequency axis from 0 Hz, a cell a pixel (tracks_answers.py).
                linear = stub.get("yScale") == "linear"
                placed = ys[ys > 0] if y_kind != "bark" and not linear else ys
                edges = cell_edges(placed, y_kind == "frequency" and not linear)
                limits_up = stub.get("yLimits") or [float(edges[0]), float(edges[-1])]
                limits_across = stub.get("xLimits") or [float(xs[0]), float(xs[-1])]
                self.held[key] = ImageAnswer(
                    key=key,
                    version=key,
                    xs=xs,
                    ys=ys,
                    values=cells,
                    identity=(str(unit), float(ref), str(label)),
                    axis=f"heatmap|{y_kind}|{stub.get('quantity')}|{ys.size}|{ys[0]}|{ys[-1]}",
                    quantity=str(stub.get("quantity", "level")),
                    x_limits=(float(limits_across[0]), float(limits_across[1])),
                    y_limits=(float(limits_up[0]), float(limits_up[1])),
                    nbytes=int(cells.nbytes),
                    y_kind=y_kind,
                    unit=str(stub["unit"]) if stub.get("unit") else None,
                    y_scale="linear" if linear else "log",
                    cell_px=int(stub.get("cellPx") or 2),
                )
                continue
            if stub.get("fired") is not None:
                # When a trigger's events fired: their numbers and times, as the picture has them.
                fired = stub["fired"]
                self.held[key] = EventsAnswer(
                    key=key,
                    version=key.rpartition("#events")[0],
                    ids=tuple(int(item["id"]) for item in fired),
                    times=tuple(float(item["time"]) for item in fired),
                )
                continue
            if stub.get("event"):
                # One event of a trigger's (or their mean): the picture carries a few points over the time from the
                # trigger, so the stand-in's samples are the line through them at an even step (their closest two).
                if xs.size < 2:
                    continue
                step = float(np.min(np.diff(xs)))
                times = float(xs[0]) + np.arange(int(round((float(xs[-1]) - float(xs[0])) / step)) + 1) * step
                samples = np.interp(times, xs, np.nan_to_num(values))
                self.held[key] = SignalAnswer(
                    key=key,
                    version=key.rpartition("#event:")[0],
                    start=float(xs[0]),
                    rate=1.0 / step,
                    values=samples,
                    identity=(str(unit), float(ref), str(label)),
                    axis=f"signal|{stub.get('unit') or unit}|{1.0 / step:.9g}|{round(float(xs[0]) / step)}",
                    quantity=str(stub.get("quantity", "value")),
                    unit=str(stub.get("unit") or unit),
                    nbytes=int(samples.nbytes),
                    x_kind="triggerTime",
                )
                continue
            source = stub.get("xSource") or {}
            if stub.get("signal") and xs.size > 1 and source.get("count") and source.get("step"):
                # The sound itself: the picture carries its envelope (each bucket's lowest and highest sample at its
                # time), so the stand-in's samples are the line through those at every sample's time (the picture's
                # source axis says how many, from when, how far apart).
                start, step = float(source["first"]), float(source["step"])
                times = start + np.arange(int(source["count"])) * step
                wave = stub.get("waveform") or {}
                at = np.asarray([*wave.get("minT", []), *wave.get("maxT", [])], dtype=np.float64)
                of = np.asarray([*wave.get("min", []), *wave.get("max", [])], dtype=np.float64)
                order = np.argsort(at, kind="stable")
                samples = (
                    np.interp(times, at[order], of[order]) if at.size else np.interp(times, xs, np.nan_to_num(values))
                )
                self.held[key] = SignalAnswer(
                    key=key,
                    version=key,
                    start=start,
                    rate=1.0 / step,
                    values=samples,
                    identity=(str(unit), float(ref), str(label)),
                    axis=f"signal|{stub.get('unit') or unit}|{1.0 / step:.9g}|{round(start / step)}",
                    quantity=str(stub.get("quantity", "value")),
                    unit=str(stub.get("unit") or unit),
                    nbytes=int(samples.nbytes),
                )
                continue
            limits = stub.get("xLimits") or _edges(xs, stub.get("xScale") == "log")
            axis = (
                f"{stub.get('kind')}|{stub.get('xScale')}|{stub.get('quantity')}|{xs.size}|{xs[0] if xs.size else ''}"
            )
            self.held[key] = Answer(
                key=key,
                version=key,
                xs=xs,
                values=values,
                identity=(str(unit), float(ref), str(label)),
                axis=axis,
                quantity=str(stub.get("quantity", "level")),
                x_scale="log" if stub.get("xScale") == "log" else "linear",
                x_limits=(float(limits[0]), float(limits[1])),
                nbytes=int(xs.nbytes + values.nbytes),
                x_kind=str(stub.get("x") or "frequency"),
                unit=stub.get("unit"),
                measure=stub.get("measure"),
                measure_exponent=stub.get("measureExponent"),
                pair=dict(stub["pair"]) if stub.get("pair") else None,
            )

    def answer(self, key: str) -> Answer | SignalAnswer | ImageAnswer | EventsAnswer | ColumnAnswer | None:
        column = self.columns.get(key)
        if column is not None:
            # A kept table column, as transport/figure_answers.py column_answer_of answers it.
            return ColumnAnswer(
                key=column.key,
                version=column.version,
                rows=column.rows,
                values=column.values,
                identity=("", 1.0, ""),
                axis="column",
                nbytes=column.nbytes,
            )
        return self.held.get(key)


def main() -> None:
    answers = StubAnswers()
    service = FigureService(answers, CombineOps())
    run = {
        "figure-draw": service.draw,
        "figure-read": service.read,
        "figure-export": service.export,
        "figure-release": service.release,
        "figure-count": service.count,
    }
    for line in sys.stdin:
        if not line.strip():
            continue
        asked = json.loads(line)
        try:
            answers.take(asked.get("answers") or {})
            if asked["command"] in ("figure-draw", "figure-export", "figure-count"):
                answers.columns.keep((asked.get("payload") or {}).get("columns"))
            reply: dict[str, Any] = {"id": asked["id"], "result": run[asked["command"]](asked["payload"])}
        except (FigureRequestError, KeyError, ValueError, TypeError) as error:
            reply = {"id": asked["id"], "error": f"{type(error).__name__}: {error}"}
        sys.stdout.write(json.dumps(reply, allow_nan=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
