# Plot contracts: what the tests will ask of you

This is for someone changing what the screen shows for the first time. The contract tests fail on purpose when a
number or a drawing appears that nothing accounts for. Each failure message names the rule and the fix; this page
gives the background once.

The rule behind all of it (docs/display-rules.md R1, R2, R7): **a number the user reads is computed from the full
data, never from the points thinned to draw it.**

Run the checks with `npm run verify` (or only `node --test dist/test/plotContracts.test.js` after `npm run compile`,
and `python scripts/check_figure_imports.py`).

## Two kinds of things on the screen

**Figures.** Every figure (the Tracks rows, the cursor spectrum, the pair view, the comparison's overlays and
lanes, the entry's distribution) is one picture made by the figure service (`python-backend/figures/`) and put on
the screen by the Figure component (`src/webview/figure/`). Its readout, step and
headline are the service's answers, and so is the range it shows by itself; the webview computes none of them. A
range the user types is sent as typed (`figure/fieldWindow.ts` reads the two fields) and the service confirms it. The Figure places the ticks on the range
the service confirmed (`figure/ticks.ts`) and words the axis names from the picture's quantity, unit and reference
(`figure/axisNames.ts`): where things are written, never a value. A figure is **not** a chart of the contract
table. What holds it is the figure service's own tests and the Figure's
(`docs/figure-list.md` lists every figure). To add or change one, read
[figure-kinds-guide.md](figure-kinds-guide.md) and [figure-design.md](figure-design.md).

**What the screen writes itself.** A few numbers are written by the webview outside any figure: a track header's
facts, the time ruler over the rows, the pair view's header, the entry table, the report files, the PNG of the
tracks. These are the charts of the contract table, and the rest of this page is about them.

## Where things live

| File | What it holds |
| --- | --- |
| `src/test/plotContracts/charts/<chart>.ts` | One file per chart: the chart, and a row for every value a user reads off it (where it is computed, from what, which tests hold it). |
| `src/test/plotContracts/values.ts` | `VALUE_HELPERS`, `NOT_CHART_VALUES`: how the functions that write a number are classified. |
| `python-backend/figures/thinning.py` | The one place points are thinned to be drawn (`Drawn`, `DrawnImage`). |
| `src/test/plotContracts/surfaces.ts` | `SURFACES`: every function outside the Figure that makes a canvas or SVG, and whose it is. |
| `src/test/plotContracts.test.ts` | The checks. |
| `scripts/check_figure_imports.py` | The backend's folder rules: who may import whom, and that drawn points are named only where they are made and sent. |
| `scripts/check_test_proofs.py` | Checks a pytest named as proof (see "Proof tests"). |
| `src/test/fullNotDrawn.ts`, `python-backend/conftest.py` | The shared proof helpers `assertNotDrawn` / `assert_not_drawn`. |
| `docs/plot-contracts.md` | The table rendered. Regenerate with `npm run compile && node dist/test/plotContracts/render.js`. |

## Adding a chart to the table

Only for something the screen writes itself, outside a figure. (A new figure is a chart spec under
`src/webview/charts/` and a kind of the figure service, never a new chart of this table.)

1. Add `src/test/plotContracts/charts/<id>.ts` (copy a small one such as `pair-view.ts` or `time-ruler.ts`) and
   add it to `index.ts`. List the functions that draw or write it in `paintedBy`.
2. Add a row for every value it shows: the kinds in `requires` must each have one.
3. Regenerate `docs/plot-contracts.md`.

<!-- guide-check file=src/test/plotContracts/charts/trackNote.ts
-->
```ts
import { t, type ChartContract } from '../model';

export const trackNote: ChartContract = {
    chart: { id: 'track-note', name: 'トラックの注記', paintedBy: ['src/webview/runtime/trackNote.ts:writeNote'], requires: ['summary'] },
    rows: [
        { id: 'track-note.summary', value: 'summary', what: '注記の数', computedIn: ['src/webview/runtime/trackNote.ts:noteText'],
          from: 'whole', trace: 'バックエンドが返した数をそのまま書く。', tests: [t('src/test/trackNote.test.ts', 'the note writes the number the backend sent')] },
    ],
    knownGaps: {},
};
```

Run `npm run compile && node dist/test/plotContracts/render.js && node --test dist/test/plotContracts.test.js`.

## Adding a number a user reads

The scan finds a number written by a formatter (`toFixed`, a `VALUE_HELPERS` call), by rounding arithmetic, or by
type: a number given to `textContent`, `value`, `title`, `setAttribute`, `fillText`, `dataset.*`, or text made of one
(`String(n)`, a template, `n + ' Hz'`). The failure lists the function and the line. Choose one:

- It is a chart's value: add the function to `computedIn` of its row (or add a row).
- It only formats or computes for other functions: add it to `VALUE_HELPERS`.
- It is not a chart's value (a setting's field, a test attribute, a CSS size, a view sent to the figure service):
  add it to `NOT_CHART_VALUES` with one sentence saying why.

A row says what its value is computed from (`from`). `from: 'full'` needs a proof test (below). `from: 'thinned'`
or `'extremes'` is recorded as a gap, and the number of gaps (`GAP_CEILING`, 0) does not allow one: compute from the
full data instead.

### Where the number must come from

The webview holds no measured data, so a number it writes is one the backend took of every value and sent as a
plain field. Three steps:

1. **Backend**: take the number of every value and send it as a plain number. Add the field to
   `python-backend/transport/protocol_schema.py` and regenerate the types
   (`node scripts/generate-protocol-types.mjs --write`).
2. **The webview** writes the field as it came. It computes nothing of it: no median, no difference, no maximum
   over several answers.

   <!-- guide-check file=src/webview/runtime/crestText.ts
   import type { RegionPeakResult } from '../../shared/protocol/generated/backendProtocolSchema';
   // Step 1's new field, which the real schema does not have.
   declare module '../../shared/protocol/generated/backendProtocolSchema' { interface RegionPeakResult { crest?: number } }
   -->
   ```ts
   /** The region's crest factor (AnalysisService.region_peak): peak over RMS, of every sample of the channels asked. */
   export function crestText(result: Pick<RegionPeakResult, 'crest'>): string {
       return result.crest === undefined ? '' : result.crest.toFixed(1);
   }
   ```
3. **The chart**: add a row to the chart's table naming the function that writes it and the Python function that
   computes it, with a proof test (next section).

Every array of numbers in the schema says what it is: `x-drawn` (points thinned to be drawn, allowed only in a
figure's picture), `x-whole` (every value) or `x-place` (where values sit: frequencies, times, edges);
`python-backend/test_protocol_schema.py` fails on an array that says none.

If what you want is a new median, Δ, level or peak **of a figure**, stop: that is a number of layer 1 (wandas,
wandas-extras) which the figure service puts in the picture. The webview does not compute it, and
`src/test/figureImportRules.test.ts` and the ESLint rules of `src/webview/figure/` refuse the usual ways to.

### A drawn point is not a number

The points of a figure's picture are typed `FigureDrawn`, which only `src/webview/figure/` may import. It is not a
`number`, so it cannot be computed with or written as text without a cast, and ESLint refuses the import elsewhere:

<!-- guide-check file=src/webview/figure/drawnText.ts
import type { FigureDrawn } from '../../shared/protocol/generated/backendProtocolSchema';
declare const point: FigureDrawn;
-->
```ts
export const shown: number = point;   // error: FigureDrawn is not a number
```

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

   <!-- guide-check file=src/test/crestProof.ts
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

**1. The compiler: `'FigureDrawn' is not assignable to 'number'`** (or `toFixed does not exist on type
'FigureDrawn'`). You are computing with points thinned to be drawn. Only the Figure turns a picture's points into
pixels (`src/webview/figure/picturePoints.ts`). If the code shows, exports or decides something, the number is the
backend's to send (the three steps above). Do not cast.

**2. ESLint: `a figure picture's drawn point (FigureDrawn) is drawn by src/webview/figure/ alone`** (or another
`no-restricted-imports` message naming a folder). A file imports what its folder may not
(`docs/figure-design.md` 第 8 節). Move the code to the folder that owns it, or ask its owner for the
value: a screen asks the Figure, the Figure asks `answers/`.

**3. `plotContracts.test.js`: `every function that writes a number in the webview is in the table...` listing
`src/webview/runtime/myPane.ts:caption`.**
`caption` formats a number and no row accounts for it. Add `'src/webview/runtime/myPane.ts:caption'` to the
`computedIn` of the row whose value it writes, or, when it is not a chart's value (a setting's field, a CSS size),
to `NOT_CHART_VALUES` in `values.ts` with one sentence saying why.

A failure of `scripts/check_figure_imports.py` names the Python line. Rule B: `Drawn`, `DrawnImage` or
`wire_points` is named outside `figures/thinning.py` and `figures/picture.py`; take the number from the answer,
before thinning. Rules A and F: a folder imports one it may not (the table of folders in
[plot-layers.md](plot-layers.md)).

## Adding a canvas or an SVG

Every context taken from a canvas, every canvas or SVG element created, and every `<canvas>` / `<svg>` in markup is
found. Outside the Figure (`src/webview/figure/`, where ESLint lets only the Figure make a canvas), the function that
does it must be:

- in a chart's `paintedBy`, or
- in `SURFACES` as `{ charts: [...] }` (it holds those charts' canvases), or
- in `SURFACES` with one sentence saying why it is no chart (an icon, a layer of cursors over a figure).

That list is a ledger: it tells a reviewer where surfaces are made. **What guarantees that nothing else draws a
chart is the audit in the real browser** (`src/test/uiSmoke/canvasAudit.ts`), which runs in every UI test
(`npm run test:ui`; specs import `test` from `canvasAudit.ts`, never from `@playwright/test`). A UI test fails when
a canvas is on screen that is not the Figure's (`data-figure`), not a layer listed in `PLOT_LAYERS`
(`src/test/uiSmoke/plotRegistry.ts`: the cursor and playhead layers over a figure) and not the time ruler's; when a
chart is drawn as an SVG; when a readout is shown over a figure; or when an axis name is drawn outside its canvas.
`plotContract.spec.ts` plants such cases and checks the audit names each.

What the audit cannot see: something no UI test puts on screen. Add a spec that shows what you add.

## Reading thinned points

Nothing reads them. Thinning happens in one file, `python-backend/figures/thinning.py`, whose results (`Drawn`,
`DrawnImage`) only `figures/picture.py` receives and sends. A range (`ranges.py`), a read (`pick.py`), a headline
(`headline.py`) and a count (`members.py`) are computed from the answers, which hold every value.
`scripts/check_figure_imports.py` checks this by names and imports alone, and
`python-backend/test_figure_imports.py` shows that each wrong edit fails it.

A new way of thinning is a new function of `thinning.py` that returns a `Drawn`; its tests go beside
`python-backend/test_figures_thinning.py` (a line), `test_figures_heatmap.py` (an image) or
`test_figures_signal.py` (a signal's band).

## When you change a rule

A pre-existing quirk you meet while fixing a rule is part of that rule's fix, or you report it as a blocker and stop.
It is never left as it is. A quirk left next to a fixed rule is the next bug of that rule: the rule now says the
quirk is wrong, and the code still does it.

Example: E3 made a trigger's events stacked by every event's samples (R6), and left the group median's level bins on
the first recording's events, noted as an existing quirk. A later review found it as a P1: the same group and the
same median line were stacked differently depending on which recording the group listed first. The fix belonged
to E3.

## What these checks cannot guarantee

They close the routes we know. They do not make a wrong number impossible. Know the limits when you review a change:

- **The folder check sees names and imports, not behaviour.** A function of `figures/` that holds an answer could
  still compute a range from too few of its values. The figure service's tests with known answers and the
  deliberately wrong implementations (`docs/figure-design.md` 第 9 節) are what catch that.
- **`any` hides types.** A value that passes through `any` (a `postMessage` payload, `JSON.parse`, an untyped
  callback) loses its type, `FigureDrawn` too.
- **A proof test proves one case.** It shows that, for the data it builds, the row's code gives the full data's
  answer and not the drawn points'. The check confirms the test uses the row's code, asserts its answer, and calls
  the helper with that answer and something that is not a constant. It cannot confirm that the second argument
  really is what the thinned points would give, or that the value asserted is the one the row describes. That is
  the reviewer's job: read the test a row names.
- **The table lists functions, not values.** A function in a row's `computedIn` may write several numbers. The
  proof test of its row guards the value; the table records where to look.
- **The number scan is a ledger, not the guarantee.** It finds a function that turns a number into text directly
  (`toFixed`, a template, `String(n)`, a value helper) and makes sure the table lists it. It does not follow text
  kept in a property and written later, so a function can write a number without being listed. What keeps that
  number from being a thinned point is that the webview is given none outside the Figure, not this scan.
- **The surface scan finds new surfaces, not new drawing.** A function that makes a canvas or an SVG and is not
  listed fails. A function already listed can still draw something else by hand, and the static scan does not stop
  that. The real-browser audit covers what a UI test shows ("Adding a canvas or an SVG"); what no UI test shows is
  covered by neither.
- **Whole or place is said by hand in the schema.** Every array of numbers must say `x-drawn`, `x-whole` or
  `x-place`, so none is unclassified; but nothing checks that an array marked `x-whole` really is every value.
