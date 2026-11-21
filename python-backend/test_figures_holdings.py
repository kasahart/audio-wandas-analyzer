"""The figure service's holdings are let go as they should be (docs/figure-design.md 第 6 節「取り置きの
寿命」): drawn again and again, a Figure holds its
newest picture only; the screen's Figure and a PNG's Figure hold apart, and the PNG's release leaves the screen's; a
holding dropped over the budget answers its read "no-picture", and the redraw it asks for is held again.

Two Figures of the same conditions and a Figure released mid-draw are test_figures_service.py's
(test_a_read_with_no_holding_is_no_picture_and_two_figures_hold_apart,
test_a_draw_finished_after_its_figure_was_released_or_redrawn_is_not_held); the two "no-picture" redraws at most are
src/test/figureComponent.test.ts's.
"""

from __future__ import annotations

from figures.service import FigureService
from test_figures_service import Source, _draw, _known, _read_at, _spec
from transport.figure_answers import CombineOps


def _held_bytes(service: FigureService) -> int:
    return sum(item.nbytes for item in service._holdings.values())  # noqa: SLF001 - what is held, for this test


def test_drawn_again_and_again_a_figure_holds_its_newest_picture_only() -> None:
    service = FigureService(Source(_known()), CombineOps())
    spec = _spec(["a", "b", "c"], ["d"])
    first = _draw(service, spec, generation=1)
    one = _held_bytes(service)
    last = first
    for generation in range(2, 60):
        view = {"x": [20.0 + generation, 8000.0]} if generation % 3 else None
        last = _draw(service, spec, generation=generation, width=300 + generation, view=view)
        assert service.held() == {"f": (generation, last["pictureId"])}
        assert _held_bytes(service) == one, "never more than one picture's results held"
    assert _read_at(service, first) == "no-picture" and _read_at(service, last) == "point"
    service.release({"figureId": "f"})
    assert service.held() == {} and _held_bytes(service) == 0


def test_the_screens_figure_and_a_pngs_hold_apart_and_the_pngs_release_leaves_the_screens() -> None:
    service = FigureService(Source(_known()), CombineOps())
    spec = _spec(["a", "b", "c"], ["d"])
    screen = _draw(service, spec, figure="screen", width=640, height=240)
    png = _draw(service, spec, figure="png", width=1200, height=700)
    assert screen["dataId"] == png["dataId"] and screen["pictureId"] != png["pictureId"]
    assert set(service.held()) == {"screen", "png"}
    service.release({"figureId": "png"})
    assert service.held() == {"screen": (1, screen["pictureId"])}
    assert _read_at(service, screen, "screen") == "point"
    # A PNG's draw that finishes after its release is not held either.
    assert _draw(service, spec, figure="png", generation=2, width=1200, height=700)["status"] == "superseded"
    assert set(service.held()) == {"screen"}


def test_a_holding_dropped_over_the_budget_answers_no_picture_and_its_redraw_is_held_again() -> None:
    answers = _known()
    budget = 2 * sum(answer.nbytes for answer in answers.values()) + 3 * answers["a"].nbytes
    service = FigureService(Source(answers), CombineOps(), budget=budget)
    spec = _spec(["a", "b", "c"], ["d"])
    dropped = _draw(service, spec, figure="one")
    for figure in ("two", "three", "four"):
        _draw(service, spec, figure=figure)
    assert "one" not in service.held()
    assert _read_at(service, dropped, "one") == "no-picture"
    again = _draw(service, spec, figure="one", generation=2)
    assert service.held()["one"] == (2, again["pictureId"]) and _read_at(service, again, "one") == "point"
    assert _held_bytes(service) <= budget
