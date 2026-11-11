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
| `src/test/plotContracts/values.ts` | `VALUE_HELPERS`, `NOT_CHART_VALUES`, `DRAWN_READERS`, `PY_DECIMATORS`: how the scanned functions are classified. |
| `src/test/plotContracts/surfaces.ts` | `SURFACES`: every function outside the plot component that makes a canvas or SVG, and whose it is. |
| `src/test/plotContracts.test.ts` | The checks. |
| `scripts/check_decimation_flow.py` | Follows thinned values through the backend and fails where one becomes a number. |
| `scripts/check_test_proofs.py` | Checks a pytest named as proof (see "Proof tests"). |
| `src/test/fullNotDrawn.ts`, `python-backend/conftest.py` | The shared proof helpers `assertNotDrawn` / `assert_not_drawn`. |
| `docs/plot-contracts.md` | The table rendered. Regenerate with `npm run compile && node dist/test/plotContracts/render.js`. |

## Adding a chart

1. Draw it with the plot component (`paintOverlay` in `src/webview/runtime/stagePanes.ts`). A chart drawn its own
   way is found by the surface scan and fails.
2. Add `src/test/plotContracts/charts/<id>.ts` (copy a small one such as `spectrum-csv.ts`) and add it to
   `index.ts`. List the functions that call the plot component in `paintedBy`.
3. Add a row for every value the chart shows: the kinds in `requires` must each have one.
4. Regenerate `docs/plot-contracts.md`.

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

## Proof tests

A row computed from the full data names at least one test with `tt(file, name)`. That test must:

1. call the row's code: one of its `computedIn` functions, or an exported function of that file that calls it (a
   pytest: a backend function it imports that calls it). A UI smoke spec counts as reaching the app;
2. assert the answer outright (`assert.equal(answer, expected)`, pytest `assert answer == expected`);
3. assert it is **not** the answer the drawn points would give:

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

   The second argument is worked out in the test from the thinned data (the view's points, an envelope, an averaged
   line). `null`, a literal, a local used only in assertions, or the same expression twice does not count.
   `fullNotDrawn.ts` has helpers for the usual drawn answers: `nearestOf`, `nthAfter`, `averagedInto`, `peaksInto`.

A test that supports a row but cannot do this is listed with `t(...)`, and the row needs another `tt(...)` test.

## Adding a canvas or an SVG

Every context taken from a canvas, every canvas or SVG element created, and every `<canvas>` / `<svg>` in markup is
found. Outside `stagePanes.ts`, the function that does it must be:

- in a chart's `paintedBy`, or
- in `SURFACES` as `{ charts: [...] }` (it holds those charts' canvases), or
- in `SURFACES` with one sentence saying why it is no chart (an icon, a cursor layer).

## Reading thinned points

A function that reads a picture's drawn arrays (`view.values`, a waveform envelope; in the backend, a decimator's
result) is listed in `DRAWN_READERS`:

- `draws`: it only draws them. Checked by data flow in both languages: returning, writing or keeping a number made
  of them fails.
- `value`: it makes a number of them. Its row is then a gap.
- `whole`: it is given full data; it names a proof test as above.
