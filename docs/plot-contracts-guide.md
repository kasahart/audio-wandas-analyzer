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
| `src/test/plotContracts.test.ts` | The checks. |
| `scripts/check_decimation_flow.py` | Follows thinned values through the backend and fails where one becomes a number. |
| `scripts/check_test_proofs.py` | Checks a pytest named as proof (see "Proof tests"). |
| `src/test/fullNotDrawn.ts`, `python-backend/conftest.py` | The shared proof helpers `assertNotDrawn` / `assert_not_drawn`. |
| `docs/plot-contracts.md` | The table rendered. Regenerate with `npm run compile && node dist/test/plotContracts/render.js`. |

## Adding a chart

1. Draw it with the plot component (`paintOverlay` in `src/webview/runtime/stagePanes.ts`). A new canvas or SVG
   made anywhere else is found by the surface scan and fails until it is listed.
2. Add `src/test/plotContracts/charts/<id>.ts` (copy a small one such as `spectrum-csv.ts`) and add it to
   `index.ts`. List the functions that call the plot component in `paintedBy`.
3. Add a row for every value the chart shows: the kinds in `requires` must each have one.
4. Regenerate `docs/plot-contracts.md`.

### Worked example: a new chart

Say you add a "kurtosis over time" chart to the comparison. The backend sends a `StageView` for it.

Drawing it is one call. Reading it with the pointer is not automatic: you wire it, in three steps.

**1. Draw, and keep what was drawn.**

```ts
// src/webview/runtime/kurtosisPane.ts
let drawn: StagePlot | null = null;   // where the lines are: the pointer needs it

export function paintKurtosis(canvas: HTMLCanvasElement, view: StageView, reader: StageReader, strings: UiStrings): void {
    const layer: StageLayer = { view, color: '#36c', full: reader.of(view) ?? NO_FULL_DATA };  // full data: required
    drawn = paintOverlay(canvas, { layers: [layer] }, dataRange([view]), stageNames(strings, view, undefined));
}
```

- `dataRange` and `stageNames` come from the figure model: `paintOverlay` takes no other range or names.
- `reader.of(view)` is the layer's full data (a `FullSource`). `NO_FULL_DATA` means "nothing to read": the plot
  marks such a layer and every UI test fails on it, so it is a placeholder, not a way out.
- `paintOverlay` returns the `StagePlot` (or null when nothing is drawn). Keep the latest one.

**2. Give the pointer and the arrow keys to the shared interaction.** Nothing reads the plot until you do this.

```ts
const marks = createPlotHoverLayer(document);                    // the cursor marks and the readout text
attachPlotInteraction(container, document, '[data-kurtosis]', {  // the canvas's selector
    locate(target, clientX, clientY) { /* the canvas under the pointer and the point on it, or null */ },
    pointOn(plot, clientX, clientY) { /* the same point for a drag that left the canvas */ },
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

Then the table (`src/test/plotContracts/charts/kurtosis.ts`, added to `index.ts`):

```ts
export const kurtosis: ChartContract = {
    chart: { id: 'kurtosis', name: '尖度の時間変化', paintedBy: ['src/webview/runtime/kurtosisPane.ts:paintKurtosis'], requires: ['readout', 'step', 'range', 'axis'] },
    rows: [
        { id: 'kurtosis.readout', value: 'readout', what: '読み値', computedIn: [`${SP}:lineRead`, 'python-backend/full_read.py:read_line'],
          from: 'full', trace: 'full_read が全サンプルから返す点を読む。', tests: [tt('src/test/kurtosisPane.test.ts', 'the kurtosis readout is a real frame\'s value, not a drawn point\'s')] },
        // ... one row per kind in `requires`
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
- It is not a chart's value (a setting's field, a test attribute, a CSS size): add it to `NOT_CHART_VALUES` with one
  sentence saying why.

A row says what its value is computed from (`from`). `from: 'full'` needs a proof test (next section). `from:
'thinned'` or `'extremes'` is recorded as a gap, and the number of gaps (`GAP_CEILING`) only goes down: compute from
the full data instead.

### Worked example: a new number

Say the kurtosis chart should show "max 7.3 at 1.20 s" above the plot.

The tempting version takes the largest point of the line drawn. It does not compile:

```ts
const top = Math.max(...view.values);   // error TS2345: 'Drawn' is not assignable to 'number'
```

That is the point of the type: the line was thinned to a few hundred points, and its largest is not the data's
largest. Do it in three steps instead.

1. **Backend**: take the number of every value and send it as a plain number, beside the picture
   (`stage_combine.py` does this for `peak` and `valueRange`). Add the field to `python-backend/protocol_schema.py`
   as `_NUMBER` (not `_DRAWN`), and regenerate the types.
2. **`wholeAnswers.ts`**: add one function that names the field and why it is full data:

   ```ts
   /** The largest kurtosis and where it is (stage_view.kurtosis_peak): found among every frame before thinning. */
   export function backendKurtosisPeak(view: StageView): { at: Whole; value: Whole } | undefined {
       return view.kurtosisPeak ? { at: mintWhole(view.kurtosisPeak.x), value: mintWhole(view.kurtosisPeak.value) } : undefined;
   }
   ```
3. **The chart**: write it with the plot's own text functions, and add a `headline` row to the chart's table
   naming the function that writes it and the Python function that computes it, with a proof test (next section).

If the webview already holds every value (a band table, a histogram's bins), no backend change is needed: read it
through `localLine(xs, values)`, which is the claim "these are every value".

### The value's type says where it came from

A readout, a headline and the point an arrow key steps to take only `Whole` (`src/shared/provenance.ts`): a number
of the full data. A plain `number` is not a `Whole`, so this does not compile:

```ts
layer.readout?.(index, { x: view.xs[index], value: view.values[index] });  // error: number is not Whole
```

Read the value through the layer's `FullSource` instead (`layer.full.line(...)` answers `FullPoints`, whose values
are `Whole`). Arithmetic on whole values gives a plain number: a Δ or a mean that a user reads is computed where
the full data is read (`fullRead.ts`) or by the backend, not at the readout.

A number becomes a `Whole` only in `fullRead.ts` (a full read's points; arrays the caller holds every value of,
through `localLine` / `localCells` / `fullPointsOf`) and in `wholeAnswers.ts` (a backend field the protocol says is
taken of every value, one named function per field). There is no function that turns a number into a `Whole`: each
of these two modules claims the mint once as it loads (`claimMint`, `src/shared/wholeMint.ts`), a second claim
throws, and `src/test/provenanceBoundary.test.ts` fails on any other use of the mint, on a holder handing it on, on
a cast to `Whole` or a `value is Whole` predicate, and says what to do. A test that needs a `Whole` of a made-up
number uses `wholeValue` (`src/test/helpers/whole.ts`), which product code cannot import.

## Proof tests

A row computed from the full data names at least one test with `tt(file, name)`. That test must:

1. use the row's code: one of its `computedIn` functions, a function of that file that calls it, or a helper of the
   test file that does (a pytest: a backend function it imports that calls it). The check follows each name to its
   declaration, so an import under another name or through a namespace counts, and a local of the same spelling
   does not. A UI smoke spec is never the proof: nothing ties what it
   reads off the page to this row's code. List it with `t(...)` as support;
2. assert that code's answer outright (`assert.equal(answer, expected)`, pytest `assert answer == expected`);
3. assert it is **not** the answer the drawn points would give, with the shared helper. This is the only form
   that counts (`assert.notEqual`, a margin such as `answer - drawn > 3`, or `not np.allclose` do not), so that
   every proof reads the same way and can be found by searching for the helper:

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

## Reading thinned points

**In the webview** the compiler does this. The arrays the backend thins to draw (`StageView.values`, `matrix`, the
waveform envelope, events, a cursor-spectrum slice, the lane spectrogram, a scan's 192-point spectrum) are typed
`Drawn`. A `Drawn` is not a number, so this does not compile:

```ts
const top = Math.max(...view.values);          // error: Drawn is not a number
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
- `value`: it makes a number of them. Its row is then a gap, and `GAP_CEILING` does not go up.

A new decimator is added to `decimators` in that file and to `SOURCES` in the checker.

## What these checks cannot guarantee

They close the routes we know. They do not make a wrong number impossible. Know the limits when you review a change:

- **A mint is a claim, not a proof.** `localLine(xs, values)` says "these are every value"; `wholeAnswers.ts` says
  "the protocol takes this field of every value". Nothing checks the claim against the backend. When you review a
  new adapter or a new `localLine` caller, read where its arrays come from.
- **`x-drawn` must be set by hand.** A new thinned array sent as plain `_NUMBERS` in `protocol_schema.py` is a
  plain number in the webview, and nothing stops code from computing with it. `check_decimation_flow.py` covers
  the Python side of this (a decimator's result must stay in a picture's drawn fields).
- **Inside a drawing module, an unwrapped point is a plain number.** It still cannot reach a readout (those take
  `Whole`), but it can reach text the module writes itself. Keep drawing modules few and small;
  `envelopePeak.ts` and `pictureSummary.ts` are on the list for reasons written there, not because they draw.
- **`any` hides types.** A value that passes through `any` (a `postMessage` payload, `JSON.parse`, an untyped
  callback such as `values.map(Number)`) loses its brand. The scan catches the direct forms (`Number(v)`,
  `String(v)`, a template, `typeof`, casts); it does not follow a value through an `any`-typed variable.
- **A proof test proves one case.** It shows that, for the data it builds, the row's code gives the full data's
  answer and not the drawn points'. The check confirms the test uses the row's code, asserts its answer, and calls
  the helper with that answer and something that is not a constant. It cannot confirm that the second argument
  really is what the thinned points would give, or that the value asserted is the one the row describes. That is
  the reviewer's job: read the test a row names.
- **The table lists functions, not values.** A function in a row's `computedIn` may write several numbers. The
  types above guard each value; the table records where to look.
- **The number scan is a ledger, not the guarantee.** It finds a function that turns a number into text directly
  (`toFixed`, a template, `String(n)`, a value helper) and makes sure the table lists it. It does not follow text
  kept in a property and written later, so a function can write a number without being listed. What keeps that
  number from being a thinned point is the type of what it was given, not this scan.
- **The surface scan finds new surfaces, not new drawing.** A function that makes a canvas or an SVG and is not
  listed fails. A function already listed can still draw by hand next to the plot component, and no check stops
  that. What it draws with is still `Drawn`, and any number it writes must still be `Whole`.
- **The backend has no types for this.** Its check follows data flow through the Python source and can miss a flow
  through code it does not model (dynamic attribute access, a new library call). Its unit tests
  (`python-backend/test_decimation_flow_check.py`) show the forms it does catch.
