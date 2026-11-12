# Plot layers: who decides what on a chart

Every chart in the webview is made by the same four layers. Each layer decides one kind of thing and takes the rest
from the layer before it. If you know which layer owns a decision, you know which file to change and which test
will stop you from deciding it somewhere else.

The rules the layers exist to keep are in [display-rules.md](display-rules.md). The table of every value a chart
shows is [plot-contracts.md](plot-contracts.md); how to change it is in
[plot-contracts-guide.md](plot-contracts-guide.md).

## The layers

| Layer | File | Decides | Does not |
| --- | --- | --- | --- |
| 1. Answer store | `src/webview/runtime/answerStore.ts`, `answerTypes.ts` | What the host answered, under which key, and whether it is still right: pending, ready, empty, failed, missing. How long a failure stands and when it is asked again. | Decide what a figure draws of an answer. |
| 2. Figure model | `src/webview/runtime/figureModel.ts` | What a figure draws of its answers and what it writes: the axes, their names, their ranges, the calibration word, which files a figure counts. The same for the screen, the report PNGs and the CSVs. | Keep anything between calls, or hold an answer. |
| 3. Plot component | `src/webview/runtime/stagePanes.ts` (`paintOverlay`, `paintStage`) | How a picture is drawn on a canvas, and how the pointer and the arrow keys read it. | Make an axis name or a range: it takes only the figure model's (`FigureNames`, `FigureRange`). Read a number from what it draws. |
| 4. Full read | `src/webview/runtime/fullRead.ts`, `wholeAnswers.ts` | Where the numbers a user reads come from: the data before it was thinned, held by the webview (`localLine`, `localCells`) or by the backend (`fetchedSource`). | Draw. |

A chart's own module (for example `comparePanes.ts`, `pairSpectrum.ts`, `entryDistribution.ts`) sits on top: it asks
the answer store for answers, asks the figure model for names and ranges, builds the layers to draw
(`StageLayer`: a picture, a colour and its full data) and calls the plot component.

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
retry of your own after a failure. The test finds such a holder by the type of what it holds and fails. If the test
names your new collection and it holds no answers (a gesture's state, a canvas's drawing), list it in
`src/test/answerBoundaryAllowlist.ts` as `notAnswer` with what it holds. Never add an `unmigrated` entry.

## Layer 2: the figure model

The figure model is pure. It turns answers into what a figure shows: `FigureNames` (axis names with quantity, unit
and reference), `FigureRange` (an axis or colour range) and `FigureSet` (which files are in a figure and which were
left out, with why). These types are branded and made only in `figureModel.ts`, and `paintOverlay` accepts nothing
else, so an axis name or a range built elsewhere does not compile. `src/test/figureModel.test.ts` checks the rest. It follows the axis builders, the range rules and the
level-identity functions from every use to their declaration (so an import under another name is found), looks for
the level strings read off any object, and keeps a short list of code shapes that have been bugs. Each place that
may still do one of these is listed by name in its `ALLOWED`, with why; a new place fails and the message says what
to do. The code shapes are matched as text and can be written around: they are a net for known mistakes, not a proof.

A range is always set from the full data: a picture's `valueRange` (the backend takes it of every value before
thinning) or, for a picture the webview makes of values it holds whole, `heldValueRange` in `fullRead.ts`. The
points drawn never set a range.

## Layer 3: the plot component

`paintOverlay` draws `StageLayer`s. Each layer has:

- `view`: the picture (`StageView`). Its `values`, `matrix`, waveform envelope and events are **points thinned to be
  drawn**. Their type is `Drawn`.
- `full`: the layer's full data (a `FullSource`). It is required. A layer with no full data gets `NO_FULL_DATA`, reads
  no number, and is marked on its canvas so that every UI smoke test fails.

The readout under the pointer, the point an arrow key steps to, and the Δ headline are read through `full`, never
from `view`.

## Layer 4: full data, and the two number types

Two types in `src/shared/provenance.ts` say where a number came from:

- **`Whole`**: a value of the full data. Readouts, headlines and exports take only `Whole`. A plain `number` is not a
  `Whole`. It is made only in `fullRead.ts` (a full read's points; arrays the caller holds every value of) and
  `wholeAnswers.ts` (backend fields the protocol says are taken of every value).
- **`Drawn`**: a point thinned to be drawn. It is not a `number`: it cannot be added, compared, formatted or passed
  where a number is wanted. Only drawing modules turn it into a number, through `src/shared/drawnPoints.ts`, to
  place it on a canvas.

Which arrays are `Drawn` is stated once, in `python-backend/protocol_schema.py` (`"x-drawn": True`), and generated
into the TypeScript protocol types. So "a number a user reads never comes from thinned points" is checked by the
compiler for every value, and `src/test/provenanceBoundary.test.ts` checks the few things the compiler cannot (who
may mint, who may unwrap, casts and coercions).

The backend has no such types. There, `scripts/check_decimation_flow.py` follows thinned values through the Python
code and fails where one becomes a number that is sent.

### The backend reads a Frame in one place

`stage_view.read_frame(frame)` is the only function that interprets a wandas Frame for the comparison. For each
Frame kind it returns a `FrameReading`: the values at full resolution with the channels combined, and the axes they
are on (each value's x; an image's rows; for a sound signal its start time and sample rate instead of an array of
times).

- The drawn picture (`stage_view`, whole or zoomed) is thinned from that reading.
- The full data kept for readouts, medians and differences (`stage_combine.StageData`) is that reading plus the
  picture's template and the recording's calibration.
- The x of a value is asked in one place: `stage_view.reading_axis(reading)` (and `x_at(reading, index)`), which the
  drawing code and `stage_combine.read_points` both use. So a drawn point and the point read under the pointer have
  the same x.

Do not read a Frame's `data`, `freqs` or `times` in a view function or in `stage_combine.py`, and do not compute a
time or frequency from a count or a fraction: use `x_at`.
`python-backend/test_drawn_x_is_source_x.py` checks every Frame kind and every thinning routine against the Frame's
own axis (display rules R2).

### Adding a new Frame kind

A Frame kind is drawn in four places, all in `python-backend/stage_view.py`, and five tests ask for it. Do the steps
in this order; each test named fails until its step is done, and its message names the step.

1. **Read it.** Add a branch to `_read_frame` (called through `read_frame`) that returns its `FrameReading`: its
   values with the channels combined, and its axes. Take every array of the Frame with `_taken`, before any
   arithmetic, so it is float64. If its values are not one of the reading modes `reading_axis` knows, add the mode
   there too, so `x_at` gives each value's x.
2. **Draw it.** Add a branch to `_stage_view` that returns its picture (a `_<kind>_view` function): `kind` (`line`,
   `bar` or `heatmap`), `x`, `quantity`, `unit`, and the thinned points, all taken from the reading, never from the
   Frame. Thin with a function listed in `SOURCES` (`scripts/check_decimation_flow.py`) and in `decimators` of
   `python-backend/drawn_points_contract.json`; a new thinning function goes in both.
3. **List it.** Add the class to `STAGE_FRAME_TYPES` (and to `CHART_FRAME_TYPES` when it is drawn as a line, bars or an
   image of its own values). The operation catalogue reads this list to say which steps the app draws: run
   `python python-backend/operation_catalog.py --write` to regenerate `src/shared/recipe/generated/wandasOperations.ts`.
   If it is drawn as an image, add its name to `IMAGE_FRAMES` in `src/webview/runtime/trackStageMode.ts`, so it
   stays in its track's lane.
4. **Write its fixture.** Add it to `_kinds` in `python-backend/test_stage_view_kinds.py` and run
   `python python-backend/test_stage_view_kinds.py --write`, which writes `src/test/fixtures/stageViewKinds.json`.
   The plot contract (`plotContract.spec.ts`) and the readout transitions (`readoutTransitions.test.ts`) draw every
   kind in it, so the new one gets the same gestures and readouts as every plot.
5. **Check its x.** Add it to `_KINDS` and `_source` in `python-backend/test_drawn_x_is_source_x.py`, so its drawn x
   is checked against the Frame's own axis, whole, zoomed, as a median and as a Δ.

The tests that ask: `test_stage_view.py` › `test_every_wandas_frame_is_drawn` (a wandas Frame class not in
`STAGE_FRAME_TYPES`), `test_drawn_x_is_source_x.py` › `test_every_drawn_frame_kind_is_covered` (a kind missing from
`_KINDS`), `test_operation_catalog.py` › `test_the_generated_typescript_is_current` (the catalogue not regenerated),
`src/test/stageViewKinds.test.ts` (a kind a step can give that the fixture does not hold), and
`test_frame_reading.py` (an array of its reading not in float64).

## Where to make a change

| You want to | Change | The check that will tell you if you put it elsewhere |
| --- | --- | --- |
| Cache or key an answer differently | `answerStore.ts` | `answerStoreBoundary.test.ts` |
| Change an axis name, a range rule, or which files a figure counts | `figureModel.ts` | `figureModel.test.ts`, and the compiler (`FigureNames`, `FigureRange`) |
| Change how something is drawn or how the pointer picks a point | `stagePanes.ts` | `plotContracts.test.ts` (drawing surfaces) |
| Show a new number read from the data | a `FullSource` in `fullRead.ts`, or an adapter in `wholeAnswers.ts` | the compiler (`Whole`), `provenanceBoundary.test.ts` |
| Send a new thinned array from the backend | `protocol_schema.py` with `x-drawn` | the compiler (`Drawn`), `check_decimation_flow.py` |
| Draw a new Frame kind in the comparison, or change how a Frame's values or axes are taken | `read_frame` in `python-backend/stage_view.py` | `test_drawn_x_is_source_x.py` (it names a kind it does not cover) |
