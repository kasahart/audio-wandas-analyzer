# Plot layers: who decides what on a chart

Every chart on screen is a Figure of the figure path: the chart's declaration (`src/webview/charts/`) goes to the
figure service (`python-backend/figures/`), which answers with one picture, and the Figure (`src/webview/figure/`)
draws it and writes the point the service read. That path, its rules and its tests are described in
[figure-design.md](figure-design.md) and `python-backend/figures/README.md`; which chart is
declared where is in [figure-list.md](figure-list.md). There is no other way a
chart is drawn: the old plot component, the webview's reads of full data and the backend's own step pictures are
gone (stages 6 and 8 of the redesign).

This page describes the parts around the Figure that every screen still shares. If you know which part owns a
decision, you know which file to change and which test will stop you from deciding it somewhere else.

The rules the parts exist to keep are in [display-rules.md](display-rules.md). The table of the values shown outside
a figure (headers, the entry table, the report) is [plot-contracts.md](plot-contracts.md); how to change it is in
[plot-contracts-guide.md](plot-contracts-guide.md).

## The parts

| Part | File | Decides | Does not |
| --- | --- | --- | --- |
| 1. Answer store | `src/webview/runtime/answerStore.ts`, `answerTypes.ts` | What the host answered, under which key, and whether it is still right: pending, ready, empty, failed, missing. How long a failure stands and when it is asked again. | Decide what a figure draws of an answer. |
| 2. Figure model | `src/webview/runtime/figureModel.ts` | The words the screens write outside a figure: a heading's count and why a recording was left out (as the figure service counted them), a median's calibration, a CSV column's title, a typed range's ends. | Keep anything between calls, or hold an answer. Decide which recordings a figure counts, its axes or its ranges: those are the figure service's. |
| 3. Figure | `src/webview/figure/`, `python-backend/figures/` | What a picture holds (the service) and how it is drawn, read and zoomed (the Figure). | Hold a value: the Figure draws points and writes the one point the service read. |
| 4. Drawn points | `python-backend/figures/thinning.py`, `FigureDrawn` in the generated protocol types | Which numbers are points thinned to be drawn: they are made in one file and drawn in one folder. | Reach a readout, a range, a count or a file. |

## Layer 1: the answer store

All answers from the host are kept in the answer store and nowhere else. An answer's key (`answerKey`) is the
file's version and calibration, the full recipe, the region and the analysis condition, plus what was asked. Two
answers share a key only when every part is the same.

This is the rule for new code, and it is not yet true of all the old code. The move onto the store is still in
progress: `src/test/answerBoundaryAllowlist.ts` lists every collection outside the store that outlives a call, and
marks the ones that still keep answers with their own key rules as `unmigrated`. Their number is
`UNMIGRATED_CEILING` in that file (the file is the place to read the current count), and it only goes down: a new
holder of answers outside the store fails `src/test/answerStoreBoundary.test.ts`, and moving a listed one onto the
store lowers the ceiling. Until the ceiling is 0, an answer read from one of the `unmigrated` places follows that
place's own rules for keys, pauses and retries, not the store's.

For new code: outside the store, keep no `Map`, `Set` or array of answers that outlives a call, and write no pause or
retry of your own after a failure. The test finds such a holder by the type of what it holds and fails.

When a failed answer is asked again is the store's alone. A reader that wants to read a failed answer again subscribes
with `whenFailureEnds(key, ready)`: the store tells every subscriber of that key at the moment its hold
(`FAILED_RETRY_MS`) ends, once, from one timer of its own, and the read made then asks again. A reader waiting on an
answer on its way subscribes with `whenSettled`; an ask replaced before it was sent hands its readers on
(`supersede`). So an answer source (a file that calls a maker of `answerStore.ts`) keeps no timer, no list of waiting readers and no wake of its own. The test
"no answer source schedules with a timer of its own" in `src/test/answerStoreBoundary.test.ts` finds any
`setTimeout`, `setInterval`, `requestAnimationFrame`, `setImmediate` or `requestIdleCallback` in an answer source by
what the call resolves to (an alias or `window.setTimeout` too), not by its name, and fails. A screen that is also an
answer source and times its own drawing or gathering (not a failure) is listed in `SCHEDULING_OWNERS` with what its
timers are for; that list only shrinks. The behaviour is held by `answerStore.test.ts` › "a failed answer's readers
are told exactly when its hold ends…". If the test
names your new collection and it holds no answers (a gesture's state, a canvas's drawing), list it in
`src/test/answerBoundaryAllowlist.ts` as `notAnswer` with what it holds. Never add an `unmigrated` entry.

## Layer 2: the figure model

The figure model is pure. It turns what the backend answered into the words a screen writes outside a figure:
`FigureSet` (the count of a figure's set and who was left out with why, made by `countedSet` from the counts the
figure service returned, `python-backend/figures/members.py`), the calibration of a median, and the title of a CSV
column. Which recordings are counted is not decided here, and a figure's own axis names and ranges are not made here: the figure service decides the ranges
from the answers before any thinning (`python-backend/figures/ranges.py`) and the Figure names the axes from the
picture's quantity, unit and reference (`src/webview/figure/axisNames.ts`). `src/test/figureModel.test.ts` follows
the axis builders, the range rules and the level-identity functions from every use to their declaration (so an import
under another name is found) and keeps a short list of code shapes that have been bugs. Each place that may still do
one of these is listed by name in its `ALLOWED`, with why; a new place fails and the message says what to do. The
code shapes are matched as text and can be written around: they are a net for known mistakes, not a proof.

## Layer 3: the Figure

One component draws every chart (`src/webview/figure/figure.ts`), from one picture of the figure service. The points
of a picture are **points thinned to be drawn**; the readout under the pointer, the point an arrow key steps to and a
Δ headline are answers of the service (`python-backend/figures/pick.py`, `headline.py`), read from the answers before
any thinning. The Figure holds no list of points and picks none. Its header comment lists the rules it follows.

### The gestures' clean-up promise

A Figure attaches and removes its own listeners. The gestures of what is not a Figure (the Tracks' time ruler, the
rows' loop and move drags) are attached with `attachPlotInteraction` (plotInteraction.ts), which builds on
`attachTrackPointerListeners` (trackPointerEvents.ts) and adds key contexts with a key router's `add` (keyRouter.ts).
Each of the three returns a disposer. Calling it takes off every listener the call added (on the surface, the
document and the window) and its key context, so none of them fires again and none holds the plot. Calling it twice
does nothing.

- The owner of a surface keeps the disposer and calls it when it tears the surface down, or before it attaches the
  gestures again.
- An owner that lives as long as the page passes the disposer on as its own `dispose` (a popover, the step bar,
  the entry screen, the comparison mode). The page root holds what is left (`holdForPage` in comparisonRuntime.ts):
  the page is not torn down while it is shown.
- The key router's own two window listeners belong to the window. Every bundle of the page shares them.

Why: a listener on the document or the window outlives the element it was for. A plot rebuilt without the old
disposer called answers the pointer and the keys twice, once for a plot no longer on screen.

Tests:
- `src/test/plotGestures.test.ts` › no caller drops the disposer of attachPlotInteraction, attachTrackPointerListeners or a key router's add: each is kept or returned (clean-up promise)
- `src/test/plotGestures.test.ts` › the disposer check finds a call that drops its disposer, and passes one kept, returned or pushed
- `src/test/plotInteraction.test.ts` › after its disposer runs no listener of a plot's gestures fires: every one added on the surface, the document and the window is taken off, and its key context too (clean-up promise)
- `src/test/plotInteraction.test.ts` › a key context added to the router sees no key once its disposer runs (clean-up promise)

## Layer 4: drawn points stay where they are drawn

A point thinned to be drawn is not an answer. Two thin types keep it from being used as one, and nothing else is
needed, because drawn points no longer leave the figure path:

- **Python: `Drawn` and `DrawnImage`** (`python-backend/figures/thinning.py`). Thinning returns one of them, and only
  `figures/picture.py` takes it and puts its points into the picture (`wire_points`). The range, the pick, the
  headline and the counts are computed from the answers and never receive one. `scripts/check_figure_imports.py`
  (rule B) fails on either name, or on `wire_points`, anywhere else.
- **TypeScript: `FigureDrawn`** (generated into `src/shared/protocol/generated/backendProtocolSchema.ts` from the
  schema's `"x-drawn": True`). It is not a `number`: it cannot be added, compared or formatted. Only
  `src/webview/figure/` may import it (ESLint `no-restricted-imports`), and there it becomes a place on the canvas.

Every other number the webview holds is a plain `number` the backend answered: a readout, a headline, a confirmed
range, a count, a region's peak. None of them is computed in the webview.

### The backend reads a Frame in one place

`read_frame(frame)` in `python-backend/frames/stage_view.py` is the only function that interprets a wandas Frame for
the comparison. For each Frame kind it returns a `FrameReading`: the values at full resolution with the channels
combined, and the axes they are on (each value's x; an image's rows; for a sound signal its start time and sample
rate instead of an array of times; a trigger's events).

- `describe(frame, reading)` says in words what the step's result is (`StageView`: the Frame, the kind of figure,
  the axes, the quantity and unit, a pair, a trigger's events by number and time). A scan answers with it, and the
  screen makes the figure's declaration from it. It holds no point.
- `services/stage_combine.py` keeps the reading under a key (`StageData` in `STORE`), with the description and the
  recording's calibration. The description names the key (`data`).
- `transport/figure_answers.py` hands the kept reading to the figure service as an answer. The service draws,
  ranges and reads it (`python-backend/figures/`).

Do not read a Frame's `data`, `freqs` or `times` anywhere else, and do not compute a time or a frequency from a
count or a fraction: the reading carries each value's x.

### Adding a new Frame kind

A Frame kind is supported in three places of `python-backend/frames/stage_view.py`, and four tests ask for it. Do
the steps in this order; each test named fails until its step is done, and its message names the step.

1. **Read it.** Add a branch to `_read_frame` (called through `read_frame`) that returns its `FrameReading`: its
   values with the channels combined, and its axes. Take every array of the Frame with `_taken`, before any
   arithmetic, so it is float64. Use one of the reading modes there are (a line, bands, an image, a signal, events):
   the figure service then draws, ranges and reads it with the rules of that mode. A new mode is a change to the
   figure service (`transport/figure_answers.py` and `python-backend/figures/`), not only to this file.
2. **Describe it.** Add a branch to `describe` that returns its words: `kind` (`line`, `bar` or `heatmap`), `x`,
   `quantity`, `unit`, all taken from the Frame's names and the reading, with no point of the data.
3. **List it.** Add the class to `STAGE_FRAME_TYPES` (and to `CHART_FRAME_TYPES` when it is drawn as a line, bars or an
   image of its own values). The operation catalogue reads this list to say which steps the app draws: in
   `python-backend/`, run `python -m services.operation_catalog --write` to regenerate
   `src/shared/recipe/generated/wandasOperations.ts`. If it is drawn as an image, add its name to `IMAGE_FRAMES` in
   `src/webview/runtime/trackStageMode.ts`, so it stays in its track's lane.
4. **Write its fixture.** Add it to `_kinds` in `python-backend/test_stage_view_kinds.py` and run
   `python python-backend/test_stage_view_kinds.py --write`, which writes `src/test/fixtures/stageViewKinds.json`.
   The plot contract (`plotContract.spec.ts`) and the readout transitions (`readoutTransitions.spec.ts`) show every
   kind in it, so the new one gets the same gestures and readouts as every figure.
5. **Check its numbers.** Add it to `_KINDS` in `python-backend/test_frame_reading.py`, so every array of its reading
   is checked to be float64.

The tests that ask: `test_stage_view.py` › `test_every_wandas_frame_is_drawn` (a wandas Frame class not in
`STAGE_FRAME_TYPES`), `test_operation_catalog.py` › `test_the_generated_typescript_is_current` (the catalogue not
regenerated), `src/test/stageViewKinds.test.ts` (a kind a step can give that the fixture does not hold), and
`test_frame_reading.py` (an array of its reading not in float64).

### The backend's folders

`python-backend/` holds two entries and four folders, and a module imports only the folders below its own
(`scripts/check_figure_imports.py`, rule F, run by verify). Beside them, `batch/` (the batch runner a Recipe bundle
carries, which imports only wandas), `recipes/` (Recipe files) and `tests/` (test helpers) are outside rule F:

| Folder | Holds | May import |
| --- | --- | --- |
| `backend_server.py`, `browser_service.py` | The two entries: the extension's NDJSON server and the browser's Pyodide service. | every folder |
| `transport/` | The protocol (`protocol_schema.py`), the validation and routing of a request (`command_dispatch.py`), the figure service's answers (`figure_answers.py`). | `figures`, `services`, `frames` |
| `figures/` | The figure service: one picture of a figure from its answers. | `frames`, wandas |
| `services/` | Scans, the analysis engine and service, the kept answers, Recipes, the operation catalogue. | `frames`, wandas |
| `frames/` | Reading a wandas Frame (`stage_view.py`), level identity, the fixed values of an analysis. | wandas |

The entries stay in `python-backend/` itself because Python resolves imports from the folder of the script it is
started with: started there, they find the four folders with no path set up.

## Where to make a change

| You want to | Change | The check that will tell you if you put it elsewhere |
| --- | --- | --- |
| Cache or key an answer differently | `answerStore.ts` | `answerStoreBoundary.test.ts` |
| Change which recordings a figure counts | `python-backend/figures/members.py` | `test_figures_service.py`, `test_figures_members_*.py` |
| Change a heading's words, or a title written outside a figure | `figureModel.ts` | `figureModel.test.ts`, `figureSetOnly.test.ts` |
| Change a figure's range rule, the point a read reads, or the points drawn | `python-backend/figures/` (`ranges.py`, `pick.py`, `thinning.py`) | `test_figures_*.py`, `scripts/check_figure_imports.py` |
| Change how a picture is drawn, zoomed or written | `src/webview/figure/` | `figureComponent.test.ts`, `src/test/uiSmoke/figure*.spec.ts` |
| Show a new number read from the data | an answer of the backend's: the figure service for a figure, a command of `AnalysisService` for a single number | `test_figures_*.py`, `protocolSchema.test.ts` |
| Send a new thinned array from the backend | `figures/thinning.py` (a `Drawn`), sent by `figures/picture.py`; `x-drawn` in a `Figure…` definition of `protocol_schema.py` | `scripts/check_figure_imports.py` (rule B), ESLint (`FigureDrawn`) |
| Draw a new Frame kind in the comparison, or change how a Frame's values or axes are taken | `read_frame` and `describe` in `python-backend/frames/stage_view.py` | `test_stage_view.py`, `test_frame_reading.py` |
| Move a backend module, or import one folder from another | the table of folders above | `scripts/check_figure_imports.py` (rule F) |
