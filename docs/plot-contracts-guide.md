# Plot contracts: what the tests will ask of you

This is for someone changing a chart for the first time. The contract tests fail on purpose when a number or a
drawing appears that nothing accounts for. Each failure message names the rule and the fix; this page gives the
background once.

The rule behind all of it (docs/display-rules.md R1, R2, R7): **a number the user reads is computed from the full
data, never from the points thinned to draw it.**

Run the checks with `npm run verify` (or only `node --test dist/test/plotContracts.test.js` after `npm run compile`,
and `python scripts/check_decimation_flow.py`).

## Where things live

| File | What it holds |
| --- | --- |
| `src/test/plotContracts/charts/<chart>.ts` | One file per chart: the chart, and a row for every value a user reads off it (where it is computed, from what, which tests hold it). |
| `src/test/plotContracts/values.ts` | `VALUE_HELPERS`, `NOT_CHART_VALUES`: how the functions that write a number are classified. |
| `src/shared/provenance.ts` | The types `Whole` (a value of the full data) and `Drawn` (a point thinned to be drawn). |
| `src/test/provenanceBoundary.test.ts` | What the compiler cannot check of those types: who may mint, who may unwrap, casts and coercions. |
| `python-backend/drawn_points_contract.json` | The backend functions that thin data, and those that compute with thinned points. Read by the Python checker and the TS table. |
| `src/test/plotContracts/surfaces.ts` | `SURFACES`: every function outside the plot component that makes a canvas or SVG, and whose it is. |
| `src/test/plotContracts.test.ts` | The checks, run on the repository. They are written in `src/test/plotContracts/checks.ts` (and the figure layer's in `src/test/figureSites.ts`) as functions of the code and the table, so `src/test/guideExamples.test.ts` runs the same checks on this page's worked example in memory. |
| `scripts/check_decimation_flow.py` | Follows thinned values through the backend and fails where one becomes a number. |
| `scripts/check_test_proofs.py` | Checks a pytest named as proof (see "Proof tests"). |
| `src/test/fullNotDrawn.ts`, `python-backend/conftest.py` | The shared proof helpers `assertNotDrawn` / `assert_not_drawn`. |
| `docs/plot-contracts.md` | The table rendered. Regenerate with `npm run compile && node dist/test/plotContracts/render.js`. |

## The checklist: every place a new chart or a new number goes

Each line is a step, when it applies, what you add, and the check that fails (with a message naming the fix) when
you leave it out. The worked examples below follow every step. `src/test/guideExamples.test.ts` builds them from this
page's own code blocks (the ones marked `guide-example`), runs the checks of the first table on them in memory, and
leaves out each step in turn: the example must pass with all of them, and fail naming the step without any one.
A step added here without a case there, or a case there without its line here, fails that test.

<!-- guide-checklist in-memory -->
| Step | When | What you add | What fails without it |
| --- | --- | --- | --- |
| `painted-by` | a new chart | its file `src/test/plotContracts/charts/<id>.ts`, whose `paintedBy` names every function that calls the plot component (`paintOverlay`, `paintStage`, `paintSideAxis`, `paintTimeAxis`) | `plotContracts.test.ts` › every call of the plot component, and every plot plotRegistry.ts lists, is a chart of the table |
| `index` | a new chart | the chart in `CONTRACTS` (`src/test/plotContracts/index.ts`) | `plotContracts.test.ts` › every chart's file in plotContracts/charts is gathered by index.ts |
| `rows` | every value the chart shows; a new number too | a row of each kind in the chart's `requires` (a new number: `headline` in `requires`, and its row) | `plotContracts.test.ts` › every row has its own id, on a chart the table lists, and every chart has a row of each kind it shows |
| `figure-rows` | a row of value `axis`, `range` or `count` | in its `computedIn`, the `figureModel.ts` function that makes it (`stageNames`, `dataRange`) | `figureModel.test.ts` › every chart's level axis, range and file count row says it is computed in figureModel.ts |
| `functions` | every row | each `computedIn` entry spelled as the function is in its file (`src/…ts:function`, `python-backend/….py:def`) | `plotContracts.test.ts` › every function the table names exists |
| `tests` | every row | each test a row names, under its title as written, asserting something | `plotContracts.test.ts` › every test the table names runs and asserts something |
| `tt` | a row `from: 'full'` | one of its tests named with `tt(...)`: the test that tells the full data from the drawn points | `plotContracts.test.ts` › every gap is in its chart's knownGaps at its severity |
| `not-drawn` | a `tt(...)` test | in it, the row's answer asserted outright and `assertNotDrawn(answer, drawnAnswer)` ("Proof tests") | `plotContracts.test.ts` › every test a row says tells full data from drawn points proves it |
| `number-writer` | a function that writes a number a user reads | the function in its row's `computedIn` (or in `VALUE_HELPERS` / `NOT_CHART_VALUES`, `values.ts`) | `plotContracts.test.ts` › every function that writes a number in the webview is in the table |
| `axis-namer` | a function that calls `stageNames` or `levelAxes` | `ALLOWED['<file under src/>']['axis-namer']` in `src/test/figureModel.test.ts`, with a comment saying why it names one picture by itself | `figureModel.test.ts` › outside figureModel.ts nothing builds an axis name … but the exact list |
| `answer-writes` | a module's `let`, or an object's field, that keeps what the plot drew (a `StagePlot`) or another answer | its entry in `NOT_ANSWER_WRITES` (`src/test/answerBoundaryAllowlist.ts`), saying what it holds | `answerStoreBoundary.test.ts` › outside the answer store, no host answer is written into a field of an object or a lasting let |
| `readers` | a backend function that thins a picture (calls a decimator) or computes with thinned points | its entry under `readers` in `python-backend/drawn_points_contract.json`, use `draws` ("Reading thinned points") | `plotContracts.test.ts` › every backend function that computes with thinned points says what it does with them |
| `schema-fields` | a number the protocol sends | each of its fields in `SCHEMA_FIELDS` (`src/test/plotContracts/schema.ts`), mapped to the rows it is a value of | `plotContracts.test.ts` › every number the backend's protocol sends back is a value of a row |
| `doc` | any change to the table | `docs/plot-contracts.md` regenerated (`npm run compile && node dist/test/plotContracts/render.js`) | `plotContracts.test.ts` › docs/plot-contracts.md is the table as plotContracts renders it |

These apply too, each when its condition holds. They are checked by the tests named, not by the in-memory example:

| When | What you add | What fails without it |
| --- | --- | --- |
| a number the backend sends | the field in the backend's TypedDict of the answer (`stage_view.py` `StageView`), and in `python-backend/protocol_schema.py`, then `node scripts/generate-protocol-types.mjs --write`; an array of numbers says `x-drawn`, `x-whole` or `x-place` | `npm run verify` › pyright, generated protocol types; `python-backend/test_protocol_schema.py`; and for the example, `guideExamples.test.ts` › the guide's backend example type-checks |
| that number is shown | an adapter in `wholeAnswers.ts` that mints it (`mint.field`) | `provenanceBoundary.test.ts` (a mint anywhere else); the compiler where the text function takes `Whole` |
| a new chart | a UI test that shows it, so the canvas audit sees what was drawn ("Adding a canvas or an SVG") | `npm run test:ui` |
| a `ticks` row | a test of `TICK_PLACES` (`model.ts`) in it | `plotContracts.test.ts` › every chart with a level, value or row axis names in its ticks row a test … |
| a plot with a `tap` | a `click` row (`CLICK_READ`, `CLICK_TEST`) and a case in `plotContract.spec.ts` `CLICK_CASES` | `plotContracts.test.ts` › every plot's click is a click row of the table … |
| a canvas or SVG made outside the plot component | its function in `SURFACES` (`surfaces.ts`) | `plotContracts.test.ts` › every drawing surface of the webview … |
| a module that unwraps `Drawn` to draw, or calls `layoutLine` | it in `DRAWING_MODULES` / `LAYOUT_MODULES` (`provenanceBoundary.test.ts`) | `provenanceBoundary.test.ts` |
| a row that takes an exception or breaks a rule | `exception` / `breaks` quoting `docs/display-rules.md` word for word | `plotContracts.test.ts` › every exception a row takes is one docs/display-rules.md approves … |
| a pytest named as a proof | the pytest written as "Proof tests" says | `scripts/check_test_proofs.py`, through the proof test above |

## Adding a chart

1. Draw it with the plot component (`paintOverlay` in `src/webview/runtime/stagePanes.ts`). A new canvas or SVG
   made anywhere else is found by the surface scan and fails until it is listed.
2. Add `src/test/plotContracts/charts/<id>.ts` (copy a small one such as `spectrum-csv.ts`) and add it to
   `index.ts`. List the functions that call the plot component in `paintedBy` (steps `painted-by`, `index`).
3. Add a row for every value the chart shows: the kinds in `requires` must each have one (`rows`, and for each row
   `functions`, `tests`, `tt`, `not-drawn`, `figure-rows`).
4. Enter the registries your code reaches (`axis-namer`, `answer-writes`, `readers`): the checklist above.
5. Regenerate `docs/plot-contracts.md` (`doc`).

### Worked example: a new chart

Say you add a "kurtosis over time" chart to the comparison. The backend sends a `StageView` for it.

Drawing it is one call. Reading it with the pointer is not automatic: you wire it, in three steps.

**1. Draw, and keep what was drawn.**

<!-- guide-example file=src/webview/runtime/kurtosisPane.ts -->
```ts
// src/webview/runtime/kurtosisPane.ts
import type { UiStrings } from '../../shared/i18n/strings';
import type { StageView } from '../../shared/protocol/backendProtocol';
import { dataRange, stageNames } from './figureModel';
import { paintOverlay, type StageLayer, type StagePlot } from './stagePanes';
import type { StageReader } from './stageReader';

let drawn: StagePlot | null = null;   // where the lines are: the pointer needs it
export const kurtosisPlot = (): StagePlot | null => drawn;

export function paintKurtosis(canvas: HTMLCanvasElement, view: StageView, reader: StageReader, strings: UiStrings): void {
    const layer: StageLayer = { view, color: '#36c', full: reader.of(view) };  // full data: required
    drawn = paintOverlay(canvas, { layers: [layer] }, dataRange([view]), stageNames(strings, view, undefined));
}
```

- `dataRange` and `stageNames` come from the figure model: `paintOverlay` takes no other range or names.
- `reader.of(view)` is the layer's full data (a `FullSource`). `full` cannot be left out. A caller with no full
  data says so by name, `full: NO_FULL_DATA` (`fullRead.ts`): the plot marks such a layer and every UI test fails
  on it, so it is a placeholder, not a way out. `reader.of` answers `NO_FULL_DATA` itself for a picture the
  backend gave no key for.
- `paintOverlay` returns the `StagePlot` (or null when nothing is drawn). Keep the latest one. The answer
  store's check finds a lasting `let` by its type, and a `StagePlot` holds the pictures the backend answered, so
  the `let` that keeps it is listed with what it holds (step `answer-writes`, `src/test/answerBoundaryAllowlist.ts`):

  <!-- guide-example entries=NOT_ANSWER_WRITES -->
  ```ts
  'src/webview/runtime/kurtosisPane.ts#let drawn': notAnswer('what the kurtosis plot drew last, for its pointer readout (made again on each paint)'),
  ```
- `stageNames(strings, view, undefined)` names the axes by this one picture. A plot of one picture may; the place
  that does is listed (step `axis-namer`, `ALLOWED` in `src/test/figureModel.test.ts`):

  <!-- guide-example entries=ALLOWED -->
  ```ts
  // The kurtosis plot draws one picture: its axes are named by it.
  'webview/runtime/kurtosisPane.ts': { 'axis-namer': ['paintKurtosis'] },
  ```

**2. Give the pointer and the arrow keys to the shared interaction.** Nothing reads the plot until you do this.

<!-- guide-check file=src/webview/runtime/kurtosisPane.ts
import { createPlotHoverLayer } from './plotHoverLayer';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotInteractionDeps, type PlotWindow } from './plotInteraction';
import type { StagePlot } from './stagePanes';
import type { UiStrings } from '../../shared/i18n/strings';
declare const drawn: StagePlot | null;
declare const strings: UiStrings;
declare const container: HTMLElement;
declare const readoutElement: HTMLElement;
declare let zoomWindow: PlotWindow;
declare const repaint: () => void;
declare const locate: PlotInteractionDeps['locate'];
declare const pointOn: PlotInteractionDeps['pointOn'];
declare const showBox: PlotInteractionDeps['showBox'];
declare const hideBox: PlotInteractionDeps['hideBox'];
declare const openAxisRange: PlotInteractionDeps['openAxisRange'];
-->
```ts
const marks = createPlotHoverLayer(document, { noValue: strings.plotNoValue });  // the cursor marks and the readout text, with the words over a gap (R7)
attachPlotInteraction(container, document, '[data-kurtosis]', {  // the canvas's selector
    locate,                                                       // the canvas under the pointer and the point on it, or null
    pointOn,                                                      // the same point for a drag that left the canvas
    window: () => zoomWindow,
    setWindow(_plot, next) { zoomWindow = next ?? FULL_PLOT_WINDOW; repaint(); },
    hover(event, hit) { if (hit && drawn) marks.show(hit.plot, drawn, event.clientX, event.clientY, readoutElement); else marks.hide(); },
    clearHover() { marks.hide(); },
    stepFrom: (plot, delta, arrived) => marks.stepFrom(plot, drawn, delta, arrived),   // ← / →
    showBox, hideBox, openAxisRange,                              // the zoom box and the axis range dialog
});
```

`PlotInteractionDeps` (`src/webview/runtime/plotInteraction.ts`) lists every member, and the compiler tells you
which ones you left out. `src/webview/runtime/entryDistributionPane.ts` is a complete small example (search for
`attachPlotInteraction`); `trackStageGestures.ts` is the comparison's.

**3. Let the full data arrive.** A `FullSource` from a `StageReader` asks the backend and answers later. Pass the
host's messages to `reader.handle(message)` where your screen handles messages, and repaint when a read is in
(the reader's owner does this for the existing screens: see `createStageReader` in `stageReader.ts` and its callers).
Until the answer is in, the readout shows its marks and no number; that is the designed state, not a bug.

What you did not write: a readout, a step rule, a range rule or an axis name. The hover layer reads the value
under the pointer and the next real point for ← / → from the layer's `FullSource`.

The backend makes the picture: it thins the line to draw it, so the function that does is a reader of thinned points
and says it only draws (step `readers`). It also takes the headline's number before thinning, for the next worked
example:

<!-- guide-example file=python-backend/kurtosis_view.py -->
```python
"""The kurtosis-over-time picture."""

from __future__ import annotations

import numpy as np

from stage_view import StageKurtosisPeak, StageView, min_max_line


def kurtosis_peak(times: np.ndarray, values: np.ndarray) -> StageKurtosisPeak | None:
    """The largest kurtosis and when, found among every frame before thinning."""
    if not values.size:
        return None
    at = int(np.nanargmax(values))
    return {"x": float(times[at]), "value": float(values[at])}


def kurtosis_view(times: np.ndarray, values: np.ndarray, points: int) -> StageView:
    """The picture: the line thinned to ``points`` buckets to draw; its range and its peak taken before, of every frame."""
    xs, drawn = min_max_line(times, values, points, False)
    view: StageView = {"frame": "ChannelFrame", "kind": "line", "x": "time", "xs": xs.tolist(), "values": drawn.tolist()}
    # The axis's range is set from every value, never the points drawn (R9): without it the plot keeps its default.
    view["valueRange"] = {"min": float(np.nanmin(values)), "max": float(np.nanmax(values))}
    peak = kurtosis_peak(times, values)
    if peak:
        view["kurtosisPeak"] = peak
    return view
```

<!-- guide-example entries=readers -->
```json
"python-backend/kurtosis_view.py:kurtosis_view": {
  "use": "draws",
  "why": "thins the kurtosis line to draw it (min_max_line); its headline is of every frame (kurtosis_peak)"
}
```

Then the table (`src/test/plotContracts/charts/kurtosis.ts`, added to `CONTRACTS` in `index.ts`). The readout, the
arrow keys, the range and the axis names are the plot component's and the figure model's, so their rows name that
code and the tests that already prove it; the range and the axis name their `figureModel.ts` function (step
`figure-rows`). The headline row is the next worked example's:

<!-- guide-example file=src/test/plotContracts/charts/kurtosis.ts -->
```ts
import { SP, t, tt, type ChartContract } from '../model';

export const kurtosis: ChartContract = {
    chart: { id: 'kurtosis', name: '尖度の時間変化', paintedBy: ['src/webview/runtime/kurtosisPane.ts:paintKurtosis'], requires: ['readout', 'step', 'range', 'axis', 'headline'] },
    rows: [
        { id: 'kurtosis.readout', value: 'readout', what: '読み値', computedIn: [`${SP}:lineRead`, 'python-backend/full_read.py:read_line'],
          from: 'full', trace: 'full_read が全サンプルから返す点を読む。', tests: [tt('python-backend/test_full_read.py', 'test_a_recordings_spectrum_is_read_at_its_own_bins_not_its_picture')] },
        { id: 'kurtosis.step', value: 'step', what: '← / → で進む先', computedIn: [`${SP}:stageStep`],
          from: 'full', trace: '読み値と同じ全データの次の点。', tests: [tt('src/test/entryHeldPlot.test.ts', '← / → on a held slot\'s Δ step to the next of every bin, not the next point drawn of the Δ thinned to the plot\'s width (R7)')] },
        { id: 'kurtosis.range', value: 'range', what: '値の軸の範囲', computedIn: [`${SP}:stageRange`, 'src/webview/runtime/figureModel.ts:dataRange'],
          from: 'full', trace: '全データの valueRange から決める。', tests: [tt('src/test/stagePanes.test.ts', 'every range is set from the full data\'s lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)')] },
        { id: 'kurtosis.axis', value: 'axis', what: '軸の名前', computedIn: ['src/webview/runtime/figureModel.ts:stageNames'],
          from: 'words', trace: '量と単位を書く。', tests: [t('src/test/axisNames.test.ts', 'every axis a picture is drawn on names its quantity and unit, whatever it measures, with or without a unit, Δ or not (R4)')], names: { quantity: true, unit: true } },
        { id: 'kurtosis.headline', value: 'headline', what: '尖度の最大とその時刻', computedIn: ['src/webview/runtime/kurtosisPane.ts:kurtosisHeadline', 'python-backend/kurtosis_view.py:kurtosis_peak'],
          from: 'full', trace: 'バックエンドが間引く前の全フレームから最大を探して送る。', tests: [tt('src/test/kurtosisPane.test.ts', 'the kurtosis headline writes the backend\'s largest value, found before thinning, not the largest point drawn')] },
    ],
    knownGaps: {},
};
```

Then regenerate the document (step `doc`) and run the checks: `npm run compile && node dist/test/plotContracts/render.js && npm run verify`.

## Adding a number a user reads

The scan finds a number written by a formatter (`toFixed`, a `VALUE_HELPERS` call), by rounding arithmetic, or by
type: a number given to `textContent`, `value`, `title`, `setAttribute`, `fillText`, `dataset.*`, or text made of one
(`String(n)`, a template, `n + ' Hz'`). The failure lists the function and the line. Choose one:

- It is a chart's value: add the function to `computedIn` of its row (or add a row).
- It only formats or computes for other functions: add it to `VALUE_HELPERS`.
- It is not a chart's value (a setting's field, a test attribute, a CSS size): add it to `NOT_CHART_VALUES` with one
  sentence saying why.

A row says what its value is computed from (`from`). `from: 'full'` needs a proof test (next section). `from:
'thinned'` or `'extremes'` is recorded as a gap, and the number of gaps (`GAP_CEILING`) only goes down: compute from
the full data instead.

### Worked example: a new number

Say the kurtosis chart should show "max 7.3 at 1.20 s" above the plot.

The tempting version takes the largest point of the line drawn. It does not compile:

<!-- guide-check file=src/webview/runtime/kurtosisTop.ts
import type { StageView } from '../../shared/protocol/backendProtocol';
declare const view: StageView & { values: NonNullable<StageView['values']> };
-->
```ts
export const top = Math.max(...view.values);   // error TS2345: 'Drawn' is not assignable to 'number'
```

That is the point of the type: the line was thinned to a few hundred points, and its largest is not the data's
largest. Do it in three steps instead.

1. **Backend**: take the number of every value and send it as a plain number, beside the picture
   (`kurtosis_peak` above; `stage_combine.py` does this for `peak` and `valueRange`). The backend's own type of the
   picture says it has the field, or pyright (`npm run verify`) refuses `view["kurtosisPeak"] = peak`
   (`python-backend/stage_view.py`):

   <!-- guide-example patch=python-backend/stage_view.py -->
   ```python
   class StageView(TypedDict):
       # ... its fields, and:
       kurtosisPeak: NotRequired[StageKurtosisPeak]


   class StageKurtosisPeak(TypedDict):
       """The largest kurtosis and when (kurtosis_view.kurtosis_peak), of every frame before thinning."""

       x: float
       value: float
   ```

   Add the field to `python-backend/protocol_schema.py`, on `StageView`:

   ```python
   "kurtosisPeak": {"type": "object", "required": ["x", "value"], "properties": {"x": _NUMBER, "value": _NUMBER}},
   ```

   and regenerate the types (`node scripts/generate-protocol-types.mjs --write`), which adds to
   `backendProtocolSchema.ts`:

   <!-- guide-example file=src/shared/protocol/generated/backendProtocolSchema.ts -->
   ```ts
   export interface StageView { kurtosisPeak?: { x: number; value: number } }
   ```

   Every number the protocol sends is a value of a row or says why it is not shown (step `schema-fields`,
   `SCHEMA_FIELDS` in `src/test/plotContracts/schema.ts`):

   <!-- guide-example entries=SCHEMA_FIELDS -->
   ```ts
   'StageView.kurtosisPeak.x': ['kurtosis.headline'],
   'StageView.kurtosisPeak.value': ['kurtosis.headline'],
   ```
2. **`wholeAnswers.ts`**: add one function that names the field and why it is full data. `mint` is that module's
   own (`const mint = claimMint('wholeAnswers')`, at its top); `mint.field(answer, name)` takes the answer and the
   field's name, so the call shows which answer the number came from:

   <!-- guide-example file=src/webview/runtime/wholeAnswers.ts -->
   ```ts
   /** The largest kurtosis and where it is (kurtosis_view.kurtosis_peak): found among every frame before thinning. */
   export function backendKurtosisPeak(view: StageView): { at: Whole; value: Whole } | undefined {
       const peak = view.kurtosisPeak;
       return peak ? { at: mint.field(peak, 'x'), value: mint.field(peak, 'value') } : undefined;
   }
   ```
3. **The chart**: write it with the plot's own text functions, in the pane's module:

   <!-- guide-example file=src/webview/runtime/kurtosisPane.ts -->
   ```ts
   import { amountText, secondsText } from '../plot/plotText';
   import { backendKurtosisPeak } from './wholeAnswers';

   /** "max 7.30 at 1.20 s": the backend's largest kurtosis, found before thinning. */
   export function kurtosisHeadline(view: StageView): string {
       const peak = backendKurtosisPeak(view);
       return peak ? `max ${amountText(peak.value)} at ${secondsText(peak.at)}` : '';
   }
   ```

   and give it its row: `headline` in the chart's `requires`, and a `headline` row naming the function that writes
   it and the Python function that computes it (steps `rows`, `number-writer`, `functions`; the table above has
   it). The row is `from: 'full'`, so it names a proof test with `tt(...)` (steps `tt`, `not-drawn`; next section):

   <!-- guide-example file=src/test/kurtosisPane.test.ts -->
   ```ts
   import assert from 'node:assert/strict';
   import test from 'node:test';
   import type { StageView } from '../shared/protocol/backendProtocol';
   import { drawableLine } from '../shared/drawnPoints';
   import { kurtosisHeadline } from '../webview/runtime/kurtosisPane';
   import { assertNotDrawn } from './fullNotDrawn';

   test('the kurtosis headline writes the backend\'s largest value, found before thinning, not the largest point drawn', () => {
       // The drawn points top out at 4.1; the full data's peak (kurtosis_peak) is 7.3 at 1.2 s.
       const view: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', xs: [0, 1, 2], values: [2.0, 4.1, 3.0], kurtosisPeak: { x: 1.2, value: 7.3 } };
       const headline = kurtosisHeadline(view);
       assert.equal(headline, 'max 7.30 at 1.20 s');
       assertNotDrawn(headline, `max ${Math.max(...drawableLine(view.values ?? []).map(Number))}`);
   });
   ```

   The text functions of `plotText.ts` take plain numbers, so nothing but this step makes the headline go through
   `backendKurtosisPeak`: `amountText(view.kurtosisPeak.value)` compiles too. Read the field through the adapter
   anyway; it is where a reviewer looks for what the number is taken of.

For an **array** the backend takes of every value (every bin of a spectrum, every band), mark the field's items
`x-whole` in the schema (`_WHOLE_LINE`); the generator then lists it in `WholeFields`, and an adapter reads it with
`mint.every('ScanResult', result, 'thirdOctDb')` (see `scanWhole`, `pairWhole`). A field that is not marked whole
does not compile there. Every array of numbers in the schema says which it is: `x-drawn` (points thinned to be
drawn), `x-whole` (every value) or `x-place` (where values sit: frequencies, times, edges);
`python-backend/test_protocol_schema.py` fails on an array that says none.

If the webview already holds every value (a band table, every bin of a scan), no backend change is needed: hold it
with `localLine(xs, line)`, or cells with `localCells(xs, ys, cells)`. `line` must be a `WholeLine` and `cells`
`WholeCells` (`src/shared/provenance.ts`): every value of the line, every row of the cells, which is a stronger
claim than "each value (each row) is whole". Only the producers make one (display rules R7, "a whole collection is
made only by its producers"): the adapters above, and three functions of `fullRead.ts` that take a whole one and a
function written at the call:

- `computedLine(from, (value, index) => …)` maps every value of one whole line (a level in degrees, a Δ of two
  spectra, a median over recordings). The line made is exactly as long as `from`: there is no length to give and
  no array of values to hand in. Other lines it is computed of are read at `index` inside the function.
- `computedCells(from, (value, row, column) => …)` does the same for cells, keeping every row and column.
- `computedWhole([a, b], (a, b) => …)` makes one number (`Derived`) of at least one whole value: the function is
  handed those values and its answer is the number.

`provenanceBoundary.test.ts` refuses a function that is passed in rather than written at the call, or that leaves
unused the value it is handed (rule `computed-unused`), so the result cannot be a plain array read by index or a
constant beside the whole values it names. Plain numbers, a picture's points, and a filtered or sliced array of whole
values (or rows) do not compile:

<!-- guide-check file=src/webview/runtime/kurtosisHeld.ts
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { Whole } from '../../shared/provenance';
import type { Derived, WholeLine } from '../../shared/provenance';
import type { WholeCells } from '../../shared/provenance';
import { computedLine, computedWhole, localCells, localLine } from './fullRead';
declare const xs: number[];
declare const ys: number[];
declare const base: WholeLine<Whole>;
declare const compared: WholeLine<Whole>;
declare const cells: WholeCells;
declare const view: StageView & { values: NonNullable<StageView['values']> };
-->
```ts
export const delta = localLine(xs, computedLine(compared, (level, bin) => level - base[bin]));
export const first: Derived = computedWhole([compared[0], base[0]], (a, b) => a - b);
export const image = localCells(xs, ys, cells);
export const plain = localLine(xs, [1, 2, 3]);                     // error: plain numbers are not a WholeLine
export const points = localLine(xs, view.values);                  // error: drawn points are not a WholeLine
export const some = localLine(xs, base.filter(value => value > 0)); // error: a filtered line is no longer every value
export const half = computedLine(base, base.slice(0, 3));          // error: a line is mapped, never handed in
export const thin = computedLine([base], i => base[i * 2], 3);     // error: no length of its own (as long as `from`)
export const rows = localCells(xs, ys, cells.filter((_, row) => row % 2 === 0)); // error: filtered rows are not every row
export const none = computedWhole([], () => 123);                  // error: computed of nothing
export const aside = computedWhole([base[0]], 123);                // error: a number beside the value, not computed of it
```

### The value's type says where it came from

A readout, a headline and the point an arrow key steps to take only `Whole` (`src/shared/provenance.ts`): a number
of the full data. A plain `number` is not a `Whole`, so this does not compile:

<!-- guide-check file=src/webview/runtime/kurtosisReadout.ts
import type { StageLayer } from './stagePanes';
declare const layer: StageLayer;
declare const index: number;
declare const xs: number[];
declare const values: number[];
-->
```ts
layer.readout?.(index, { x: xs[index], value: values[index] });  // error: number is not Whole
```

Read the value through the layer's `FullSource` instead (`layer.full.line(...)` answers `FullPoints`, whose values
are `Whole`). Arithmetic on whole values gives a plain number: a Δ or a mean that a user reads is computed by the
backend, or in the webview from whole values and then named whole with `computedWhole` (above).

A number becomes a `Whole` only in `fullRead.ts` (a full read's points; `computedWhole`, `computedLine` and `computedCells`; the
places of a line or cells held whole, `localLine` / `localCells` / `heldCells`) and in `wholeAnswers.ts` (a backend field the protocol
says is taken of every value, one named function per field). There is no function that turns a number into a `Whole`: each
of these two modules claims the mint once as it loads (`claimMint`, `src/shared/wholeMint.ts`), a second claim
throws, and `src/test/provenanceBoundary.test.ts` fails on any other use of the mint, on a holder handing it on, on
a cast to `Whole` or a `value is Whole` predicate, and says what to do. A test that needs a `Whole` of a made-up
number uses `wholeValue` (`src/test/helpers/whole.ts`), which product code cannot import.

## Proof tests

A row computed from the full data names at least one test with `tt(file, name)`. A pytest is named as pytest
collects it: `test_y` for a test function, `TestX::test_y` for a method of a test class. One discovery decides it
(`tests_of` in `scripts/check_test_proofs.py`, which `src/test/namedTest.ts` asks), so a name is a test for every
check or for none (`a pytest proof moved into a test class is one test, named TestX::test_y, ...` in
`src/test/plotContracts.test.ts`). That test must:

1. use the row's code: one of its `computedIn` functions, a function of that file that calls it, or a helper of the
   test file that does (a pytest: a backend function it imports that calls it). The check follows each name to its
   declaration, so an import under another name or through a namespace counts, and a local of the same spelling
   does not. A UI smoke spec is never the proof: nothing ties what it
   reads off the page to this row's code. List it with `t(...)` as support;
2. assert that code's answer outright (`assert.equal(answer, expected)`, pytest `assert answer == expected`);
3. assert it is **not** the answer the drawn points would give, with the shared helper. This is the only form
   that counts (`assert.notEqual`, a margin such as `answer - drawn > 3`, or `not np.allclose` do not), so that
   every proof reads the same way and can be found by searching for the helper:

   <!-- guide-check file=src/test/kurtosisProof.ts
   import assert from 'node:assert/strict';
   declare const read: { at: number };
   declare const xs: number[];
   declare const bin: number;
   declare const view: { xs: number[] };
   -->
   ```ts
   import { assertNotDrawn, nearestOf } from './fullNotDrawn';
   assert.equal(read.at, xs[bin]);
   assertNotDrawn(read.at, nearestOf(view.xs, xs[bin]));
   ```

   ```python
   from conftest import assert_not_drawn
   assert spec["maxDb"] == -3.5
   assert_not_drawn(spec["maxDb"], float(drawn.max()))
   ```

   The first argument is the answer of the row's code. The second is worked out in the test from the thinned data
   (the view's points, an envelope, an averaged line). `null`, a literal, a local used only in assertions, or the same expression twice does not count.
   `fullNotDrawn.ts` has helpers for the usual drawn answers: `nearestOf`, `nthAfter`, `averagedInto`, `peaksInto`.

A test that supports a row but cannot do this is listed with `t(...)`, and the row needs another `tt(...)` test.

## When a check fails

Three failures you are likely to meet, and what each one wants.

**1. The compiler: `'Drawn' is not assignable to 'number'`** (or `toFixed does not exist on type 'Drawn'`).
You are computing with points thinned to be drawn. If the code draws them, see 2. If it shows, exports or decides
something, read the full data instead (the worked example above). Do not cast: the next check finds casts.

**2. `provenanceBoundary.test.js`: `src/webview/runtime/myPane.ts:41 unwrap: drawableLine(...)`.**
Only drawing modules may turn a `Drawn` into a number. If `myPane.ts` really draws its own marks on a canvas, add it
to `DRAWING_MODULES` in that test with one sentence saying what it draws. If it is not drawing, the answer is the
same as in 1. The other rules of that test (`mint`, `cast`, `drawn-cast`, `drawn-coerced`, ...) print their own fix.

**3. `plotContracts.test.js`: `every function that writes a number in the webview is in the table...` listing
`src/webview/runtime/myPane.ts:caption`.**
`caption` formats a number and no row accounts for it. Add `'src/webview/runtime/myPane.ts:caption'` to the
`computedIn` of the row whose value it writes, or, when it is not a chart's value (a setting's field, a CSS size),
to `NOT_CHART_VALUES` in `values.ts` with one sentence saying why.

A failure of `scripts/check_decimation_flow.py` names the Python line where a number is made of thinned points and
the decimator they came from. Take the number before the decimator is called, as `value_range` and
`difference_peak` do.

## Adding a canvas or an SVG

Every context taken from a canvas, every canvas or SVG element created, and every `<canvas>` / `<svg>` in markup is
found. Outside `stagePanes.ts`, the function that does it must be:

- in a chart's `paintedBy`, or
- in `SURFACES` as `{ charts: [...] }` (it holds those charts' canvases), or
- in `SURFACES` with one sentence saying why it is no chart (an icon, a cursor layer).

That list is a ledger: it tells a reviewer where surfaces are made. **What guarantees that a chart is drawn by the
plot component is the audit in the real browser** (`src/test/uiSmoke/canvasAudit.ts`), which runs in every UI test
(`npm run test:ui`; specs import `test` from `canvasAudit.ts`, never from `@playwright/test`). A UI test fails when:

- a canvas is on screen that the plot component did not mark (`data-plot`) and `plotRegistry.ts` does not list
  (its lists are empty today, and only shrink);
- anything draws into a plot's canvas while the component is not painting: `fill`, `stroke`, `fillRect`,
  `strokeRect`, `fillText`, `strokeText`, `putImageData` or `drawImage` on its 2D context, whether the canvas was
  drawn before it was marked, while off the page, or just before it is exported;
- a chart is drawn as an SVG, or a plot draws a layer with no full data (`NO_FULL_DATA`).

The audit proves itself: `plotContract.spec.ts` plants each of these (a stray canvas, a hand-drawn `fillRect`, a
copied picture, a draw before the mark) and checks the audit names it. So you do not need to argue from the source
that your painter only calls `paintOverlay`: show the chart in a UI test and the audit checks what was really drawn.

What the audit cannot see: a chart no UI test puts on screen (add a spec that shows a new chart, as the
"answer the same gestures as every plot" tests of `plotContract.spec.ts` do), and a draw made from a callback that
runs while the component is painting.

## Reading thinned points

**In the webview** the compiler does this. The arrays the backend thins to draw (`StageView.values`, `matrix`, the
waveform envelope, events, a cursor-spectrum slice, the lane spectrogram, a scan's 192-point spectrum) are typed
`Drawn`. A `Drawn` is not a number, so this does not compile:

<!-- guide-check file=src/webview/runtime/kurtosisText.ts
import type { StageView } from '../../shared/protocol/backendProtocol';
declare const view: StageView & { values: NonNullable<StageView['values']> };
declare const label: HTMLElement;
declare const i: number;
-->
```ts
export const top = Math.max(...view.values);   // error: Drawn is not a number
label.textContent = view.values[i].toFixed(1); // error: toFixed does not exist on Drawn
```

- To **draw** the points, call `drawable` / `drawableLine` from `src/shared/drawnPoints.ts`. Only the modules listed
  in `DRAWING_MODULES` (`src/test/provenanceBoundary.test.ts`) may; add yours there, with what it draws, if it draws.
- To **show, compute or export a number**, do not unwrap. Read it from the full data: the layer's `FullSource`, the
  picture's `valueRange` / `peak` / `levelBins`, or an adapter in `wholeAnswers.ts`.

A new thinned array from the backend is marked in `python-backend/protocol_schema.py` (`_DRAWN_LINE`,
`_DRAWN_GAPPED`); regenerate the types with `node scripts/generate-protocol-types.mjs --write`.

**In the backend** there are no such types, so `scripts/check_decimation_flow.py` follows the data. A function that
calls a decimator, or is handed its result and computes with it, is listed in
`python-backend/drawn_points_contract.json` under `readers`:

- `draws`: it only makes the picture. The checker fails if a number made of the thinned points is returned in any
  other field, reduced (`max`, `mean`) or used in a decision.
- `value`: it makes a number of them. Its row is then a gap, and `GAP_CEILING` (0) does not allow one: the fix for
  a reader that makes a number of thinned points is to take that number from the full data it is given, before
  thinning (as `value_range` and `difference_peak` do), so it only draws. Every message of the checkers names a fix
  that passes (`test_the_fix_each_diagnostic_names_passes`).

A new decimator is added to `decimators` in that file and to `SOURCES` in the checker. You cannot forget to: the
checker reads which fields are drawn points from the schema (every array marked `x-drawn`), and fails where a value
that came from no registered decimator is put in one of them. It does not look for particular ways of thinning (a
stepped slice, a reshape and a `max`, a resample all fail alike), because what it checks is where the value came
from. The failure names the line and gives the fixes: register the function that thins; or annotate the function's
return type with the answer it builds when that answer's field of this name is not drawn points; or, when it is a
picture's field and every value is sent, none thinned (a band table), list the place under `unthinned` in
`drawn_points_contract.json` with one sentence saying why.

Which fields are drawn points is decided by module, function and field, never by the field's name alone: the dict
a function returns is the answer its return annotation names (`-> StagePoints` is a definition of the schema, whose
`values` are `x-whole`; `-> StageValueRange` is a TypedDict whose `min` is a `float`), and so is a local annotated
with such a type; their own fields are what that answer says. Every other dict (nested in an answer, sent through a
callback, a store or `json.dumps`, made in a function whose return annotation is a scalar or says nothing), and a
field that answer lacks, is taken by its field's name; a number written out (`EVENT_POINTS = 2048`) is no array
(`test_a_picture_made_inside_a_function_that_returns_no_answer_is_still_checked`). So keep the backend's return annotations exact:
they are what the check reads (`test_a_field_is_classified_by_the_answer_its_function_returns_not_by_its_name_alone`,
`test_drawn_points_put_in_a_field_of_the_same_name_in_another_answer_are_a_flow`).

The checker follows a function wherever it goes as a value: a name bound to one (`reduce = np.max`, a module-level
`REDUCE = np.median`, `from numpy import max as top`), a lambda, a local def handed on or returned in a tuple (a full
read's `x_at`), a function handed to another call (`map(np.max, rows)`, `key=`). Where it cannot finish, it fails
and names the file:line where it stopped, never passes: drawn points given to a value it cannot resolve to a function
(a parameter nothing passes a function to, `getattr`, `partial`), a statement it does not follow inside a function
(a class), a loop or recursion that does not settle, a chain of calls too deep
(`test_where_the_analysis_cannot_finish_it_fails_naming_the_file_and_line`). Write such code so it can be followed.

## When you change a rule

A pre-existing quirk you meet while fixing a rule is part of that rule's fix, or you report it as a blocker and stop.
It is never left as it is. A quirk left next to a fixed rule is the next bug of that rule: the rule now says the
quirk is wrong, and the code still does it.

Example: E3 made a trigger's events stacked by every event's samples (R6), and left the group median's level bins on
the first recording's events, noted as an existing quirk. A later review found it as a P1: the same group and the
same median line were stacked differently depending on which recording the group listed first. The fix
(`combined_picture` in `stage_combine.py`) belonged to E3.

## What these checks cannot guarantee

They close the routes we know. They do not make a wrong number impossible. Know the limits when you review a change:

- **A mint is a claim, not a proof.** `wholeAnswers.ts` says "the protocol takes this field of every value".
  Nothing checks the claim against the backend. `localLine` no longer makes such a claim itself (it takes only
  `Whole`), so the places to read are the adapters of `wholeAnswers.ts` and the schema's `x-whole` marks.
- **Inside a drawing module, an unwrapped point is a plain number.** It still cannot reach a readout (those take
  `Whole`), but it can reach text the module writes itself. Keep drawing modules few and small;
  `pictureSummary.ts` is on the list for the reason written there, not because it draws.
- **`any` hides types.** A value that passes through `any` (a `postMessage` payload, `JSON.parse`, an untyped
  callback such as `values.map(Number)`) loses its brand. The scan catches the direct forms (`Number(v)`,
  `String(v)`, a template, `typeof`, casts); it does not follow a value through an `any`-typed variable.
- **A proof test proves one case.** It shows that, for the data it builds, the row's code gives the full data's
  answer and not the drawn points'. The check confirms the test uses the row's code, asserts its answer, and calls
  the helper with that answer and something that is not a constant. It cannot confirm that the second argument
  really is what the thinned points would give, or that the value asserted is the one the row describes. That is
  the reviewer's job: read the test a row names.
- **The table lists functions, not values.** A function in a row's `computedIn` may write several numbers, so a new
  number written inside a function a row already names (a second figure in `stageHeadline`) passes the number scan
  without a row of its own. A number the backend sends is still found by its field (`schema-fields`), but one the
  webview computes is not. When you add a number, add its row even where the function is already listed; the
  types above guard each value, and the table records where to look.
- **The number scan is a ledger, not the guarantee.** It finds a function that turns a number into text directly
  (`toFixed`, a template, `String(n)`, a value helper) and makes sure the table lists it. It does not follow text
  kept in a property and written later, so a function can write a number without being listed. What keeps that
  number from being a thinned point is the type of what it was given, not this scan.
- **The surface scan finds new surfaces, not new drawing.** A function that makes a canvas or an SVG and is not
  listed fails. A function already listed can still draw by hand next to the plot component, and the static scan
  does not stop that. The real-browser audit does, for every chart a UI test shows ("Adding a canvas or an SVG"):
  that audit, not the scan, is the guarantee. A chart that no UI test shows is covered by neither.
- **`computedWhole`, `computedLine` and `computedCells` trust the arithmetic.** They take the whole value(s), line
  or cells a result is computed of, at least one, and hand them to a function written at the call that must use
  them (rule `computed-unused`); a line or cells keep the length and rows of what they map, by construction. So a
  thinned point, a plain number, nothing at all, a thinned line or a constant cannot be named whole through them.
  What is not checked is the arithmetic inside the function, nor other arrays it reads at the same index next to
  the value it is handed: those should be whole lines too, and nothing but review says so. The result's type
  (`Derived`, or a `WholeLine` / `WholeCells` they make) lets you find every call; read each one.
- **The places of a held line are the caller's.** `localLine(xs, line)` takes the line as a `WholeLine` but its
  `xs` as plain numbers (bin × spacing, the band centres): where each value sits is laid out by the caller and is
  not checked against the backend.
- **A read is judged by what it returns, not by what it does.** A source's read whose every `return` (or whose
  type, for a read passed on from elsewhere) can only be null fails the boundary test, and so does one that can only
  answer "on its way" outside `fullRead.ts`; the boundary test reads the function's returns, so typing it
  `FullAnswer` does not hide it. A layer with no full data passes `NO_FULL_DATA`; a picture that must not be read at
  all (a lane whose file changed since it was analysed) is painted with `readout: false`; a stand-in whose real
  picture is on its way passes a pending source tied to the request it waits on (`pendingSource(request)`,
  `fullRead.ts`). What is not found: a read that can answer points on some path but in practice never does (its
  condition never holds), or a fetch callback (`fetchedSource`) that always answers null.
- **Drawn points are opaque by type, their places by name.** Outside the drawing modules, the boundary test refuses
  `.length`, an index, `.at`, `for … of`, destructuring and spread of any array of `Drawn` wherever it goes (the type
  follows it), and of a picture's `xs` / `ys` (`PICTURE_PLACES`) read off the picture or through a local `const`.
  Places handed to a function as a plain `number[]` are no longer followed, and an array of lines or rows (a channel's
  line, a heatmap row picked whole) is not a point. Methods such as `map` or `filter` are not refused: what they hand
  their callback is a `Drawn`, which still cannot be computed with.
- **`layoutLine` takes plain numbers.** It exists for numbers a figure is laid out with (a histogram's counts, the
  height a dot is stacked at). Only the modules in `LAYOUT_MODULES` (`provenanceBoundary.test.ts`) may call it, and
  the list is the review point: a measured value must never go through it.
- **Whole or place is said by hand in the schema.** Every array of numbers must say `x-drawn`, `x-whole` or
  `x-place`, so none is unclassified; but nothing checks that an array marked `x-whole` really is every value.
  The Python check below covers the direction that matters most (a decimator's result reaching a field that is not
  `x-drawn`).
- **The backend has no types for this.** Its check follows data flow through the Python source and can miss a flow
  through code it does not model (dynamic attribute access, a method of a library object, a new library call). A
  lambda or local def called away from where it was made sees what its names held there, except what came from
  that function's own parameters. Its unit tests
  (`python-backend/test_decimation_flow_check.py`) show the forms it does catch.
- **`unthinned` is a list of claims.** A place listed there is not checked further: thinning added later inside a
  listed function, in the listed field, passes. Keep each entry to one field of one function and read the list when
  it changes. A value that mixes a registered decimator's result with data thinned some other way counts as
  registered. Thinned data sent in a field the schema does not mark `x-drawn` is not seen by this rule at all.
