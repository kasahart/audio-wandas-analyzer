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

## Where to make a change

| You want to | Change | The check that will tell you if you put it elsewhere |
| --- | --- | --- |
| Cache or key an answer differently | `answerStore.ts` | `answerStoreBoundary.test.ts` |
| Change an axis name, a range rule, or which files a figure counts | `figureModel.ts` | `figureModel.test.ts`, and the compiler (`FigureNames`, `FigureRange`) |
| Change how something is drawn or how the pointer picks a point | `stagePanes.ts` | `plotContracts.test.ts` (drawing surfaces) |
| Show a new number read from the data | a `FullSource` in `fullRead.ts`, or an adapter in `wholeAnswers.ts` | the compiler (`Whole`), `provenanceBoundary.test.ts` |
| Send a new thinned array from the backend | `protocol_schema.py` with `x-drawn` | the compiler (`Drawn`), `check_decimation_flow.py` |
