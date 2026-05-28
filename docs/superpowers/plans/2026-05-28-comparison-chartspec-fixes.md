# ComparisonPanel / ChartSpecPanel Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four bugs in ComparisonPanel and ChartSpecPanel: remove dead mute/solo UI (#99), separate axis/waveform canvases (#100), fix dblclick coordinate scaling (#101), add button feedback (#102).

**Architecture:** All changes are within `src/webview/comparisonRenderScript.ts`, `src/webview/chartSpecRenderScript.ts`, `src/shared/i18n/strings.ts`, `src/shared/gui/guiTriggerabilityInventory.ts`, and their test counterparts. No new files are created.

**Tech Stack:** TypeScript, node:test (unit), Playwright (ui-smoke). Build: `npm run compile`. Verify: `npm run verify`. UI tests: `npm run test:ui`.

---

## File Map

| File | Changes |
|---|---|
| `src/webview/comparisonRenderScript.ts` | #99: remove mute/solo state/functions/buttons/shortcuts; #100: add AXIS_W const, split canvas; #102: add announce/show-info in export fns |
| `src/shared/i18n/strings.ts` | #99: remove mute/solo strings from interface + both locales; #102: add 6 new announce strings |
| `src/shared/gui/guiTriggerabilityInventory.ts` | #99: remove `toggle-mute`, `toggle-solo`, `M / S` entries |
| `src/webview/chartSpecRenderScript.ts` | #101: add `toCanvasCoords` helper, patch 3 dblclick handlers |
| `src/webview/panels/ChartSpecPanel.ts` | #101: add `canvas { max-width: 100%; }` CSS |
| `src/test/uiSmoke/allButtons.spec.ts` | #99: remove mute/solo assertions; #102: add announce assertions |
| `src/e2e/suite/index.ts` | #99: remove spectrum-mute test block |
| `src/test/chartSpecRangeControl.test.ts` | #101: add narrow-viewport dblclick test |

---

## Task 1: #99 — Remove mute/solo from strings and inventory

**Files:**
- Modify: `src/shared/i18n/strings.ts`
- Modify: `src/shared/gui/guiTriggerabilityInventory.ts`
- Modify: `src/webview/comparisonRenderScript.ts` (SHORTCUT_ROWS only)

- [ ] **Step 1: Remove mute/solo keys from `UiStrings` interface**

In `src/shared/i18n/strings.ts`, remove these lines from the `UiStrings` interface (lines ~112–113 and ~137–140):

```ts
// DELETE these lines from interface UiStrings:
ariaToggleMute: string;
ariaToggleSolo: string;
helpRowMuteSolo: string;
announceMuted: string;
announceUnmuted: string;
announceSoloed: string;
announceUnsoloed: string;
```

- [ ] **Step 2: Remove mute/solo values from English locale**

In `src/shared/i18n/strings.ts`, delete these lines from the `en:` block (lines ~247–248, ~210, ~272–275):

```ts
// DELETE from en: block:
helpRowMuteSolo: 'mute / solo active track (focused, last played, or first)',
ariaToggleMute: 'Toggle mute',
ariaToggleSolo: 'Toggle solo',
announceMuted: 'Track {n} muted',
announceUnmuted: 'Track {n} unmuted',
announceSoloed: 'Track {n} solo',
announceUnsoloed: 'Track {n} solo off',
```

- [ ] **Step 3: Remove mute/solo values from Japanese locale**

In `src/shared/i18n/strings.ts`, delete these lines from the `ja:` block (lines ~343, ~380–381, ~405–408):

```ts
// DELETE from ja: block:
helpRowMuteSolo: 'アクティブなトラックをミュート / ソロ（フォーカス中・最後に再生・先頭）',
ariaToggleMute: 'ミュート切替',
ariaToggleSolo: 'ソロ切替',
announceMuted: 'トラック{n}ミュート',
announceUnmuted: 'トラック{n}ミュート解除',
announceSoloed: 'トラック{n}ソロ',
announceUnsoloed: 'トラック{n}ソロ解除',
```

- [ ] **Step 4: Remove M/S from SHORTCUT_ROWS in comparisonRenderScript.ts**

In `src/webview/comparisonRenderScript.ts`, delete this line from `SHORTCUT_ROWS` (line ~7):

```ts
// DELETE:
{ shortcut: 'M / S', labelKey: 'helpRowMuteSolo' },
```

- [ ] **Step 5: Remove mute/solo from guiTriggerabilityInventory.ts**

In `src/shared/gui/guiTriggerabilityInventory.ts`:

Delete from `GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS` (lines ~62–63):
```ts
// DELETE:
'toggle-mute',
'toggle-solo',
```

Delete from `GUI_TRIGGERABILITY_SCOPED_SHORTCUTS` (line ~75):
```ts
// DELETE:
'M / S',
```

Update the `track-visual-controls` feature entry (line ~198) — change `triggers` to remove the deleted IDs:
```ts
{
    id: 'track-visual-controls',
    label: 'Control track color, visibility, and ordering aids',
    entryPoints: ['track-control', 'keyboard'],
    triggers: ['pick-color', 'remove-track'],
    regressionLayers: ['node:test', 'planned'],
},
```

- [ ] **Step 6: Compile and verify no TypeScript errors**

```bash
npm run compile 2>&1 | tail -20
```

Expected: exit 0, no type errors about missing `ariaToggleMute` etc.

- [ ] **Step 7: Commit**

```bash
git add src/shared/i18n/strings.ts src/shared/gui/guiTriggerabilityInventory.ts src/webview/comparisonRenderScript.ts
git commit -m "refactor(#99): remove mute/solo strings and inventory entries"
```

---

## Task 2: #99 — Remove mute/solo from comparisonRenderScript render body

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: Delete `soloTrackIndex` variable**

Find and delete this line (line ~115):
```ts
// DELETE:
let soloTrackIndex = null; // null = solo off, number = solo track
```

- [ ] **Step 2: Delete M/S button HTML from `buildTrackRow`**

In `buildTrackRow` (line ~679–680), delete these two lines:
```ts
// DELETE:
+ '    <button class="track-btn" data-action="toggle-mute" data-track-index="' + i + '" aria-label="' + escHtml(STR.ariaToggleMute) + '" aria-pressed="false">M</button>'
+ '    <button class="track-btn" data-action="toggle-solo" data-track-index="' + i + '" aria-label="' + escHtml(STR.ariaToggleSolo) + '" aria-pressed="false">S</button>'
```

- [ ] **Step 3: Remove solo filter from `renderStackedTracks`**

Find and delete (line ~798):
```ts
// DELETE:
if (soloTrackIndex !== null && soloTrackIndex !== i) { return; }
```

- [ ] **Step 4: Remove solo filter from `updateVisibility`**

In `updateVisibility` (lines ~1137–1139), change:
```ts
// BEFORE:
var isMuted = trackRuntime[idx].hidden;
var isSoloFiltered = soloTrackIndex !== null && soloTrackIndex !== idx;
row.style.display = (isMuted || isSoloFiltered) ? 'none' : 'flex';

// AFTER:
var isMuted = trackRuntime[idx].hidden;
row.style.display = isMuted ? 'none' : 'flex';
```

- [ ] **Step 5: Remove mute/solo click dispatch from tracks-wrapper click handler**

In the `tracks-wrapper` click handler (lines ~1420–1421), delete:
```ts
// DELETE:
if (action === 'toggle-mute' && !isNaN(idx)) { toggleMute(idx); }
if (action === 'toggle-solo' && !isNaN(idx)) { toggleSolo(idx); }
```

- [ ] **Step 6: Remove M/S keyboard handler**

Find and delete the two keyboard branches (lines ~1632–1643):
```ts
// DELETE this entire block:
if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    const tidx = resolveActiveTrackIndex(active);
    if (tidx !== null) { toggleMute(tidx); }
    return;
}
if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    const tidx = resolveActiveTrackIndex(active);
    if (tidx !== null) { toggleSolo(tidx); }
    return;
}
```

- [ ] **Step 7: Remove solo filters from export functions**

In `exportCsv` (line ~2243), delete:
```ts
// DELETE:
if (soloTrackIndex !== null && soloTrackIndex !== i) { return; }
```

In `exportWavLoop` (line ~2289), delete:
```ts
// DELETE:
if (soloTrackIndex !== null && soloTrackIndex !== i) { return; }
```

Search for any remaining `soloTrackIndex` occurrences and delete those lines too:
```bash
grep -n "soloTrackIndex" src/webview/comparisonRenderScript.ts
```
Each hit (lines ~2243, ~2289, ~2852, ~2917 etc.) should be a solo-filter `if` — delete them.

- [ ] **Step 8: Delete `toggleMute` and `toggleSolo` function definitions**

Delete the entire `function toggleMute(idx)` (lines ~3116–3132) and `function toggleSolo(idx)` (lines ~3134–3155) bodies.

- [ ] **Step 9: Compile**

```bash
npm run compile 2>&1 | tail -20
```

Expected: exit 0, no references to deleted variables.

- [ ] **Step 10: Commit**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "refactor(#99): remove mute/solo state, buttons, keyboard, and export filters"
```

---

## Task 3: #99 — Remove mute/solo from tests

**Files:**
- Modify: `src/test/uiSmoke/allButtons.spec.ts`
- Modify: `src/e2e/suite/index.ts`

- [ ] **Step 1: Remove mute/solo assertions from allButtons.spec.ts**

In `src/test/uiSmoke/allButtons.spec.ts`, delete these two lines (lines ~191–195):
```ts
// DELETE:
await domClick(page, '[data-action="toggle-mute"]');
await expect(page.locator('[data-action="toggle-mute"]')).toHaveAttribute('aria-pressed', 'true');

await domClick(page, '[data-action="toggle-solo"]');
await expect(page.locator('[data-action="toggle-solo"]')).toHaveAttribute('aria-pressed', 'true');
```

- [ ] **Step 2: Remove spectrum-mute test block from e2e/suite/index.ts**

In `src/e2e/suite/index.ts`, delete the object starting with `name: 'muting a track removes it from the cursor spectrum overlay'` (lines ~375–398), including its surrounding `{` and `},`.

- [ ] **Step 3: Run full verify**

```bash
npm run verify 2>&1 | tail -30
```

Expected: all tests pass, no mute/solo references in errors.

- [ ] **Step 4: Commit**

```bash
git add src/test/uiSmoke/allButtons.spec.ts src/e2e/suite/index.ts
git commit -m "test(#99): remove mute/solo test assertions and e2e block"
```

---

## Task 4: #100 — Separate axis canvas from waveform canvas

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`
- Modify: `src/webview/panels/ComparisonPanel.ts` (CSS for axis canvas)

- [ ] **Step 1: Add AXIS_W constant and `track-axis-canvas` CSS**

In `src/webview/panels/ComparisonPanel.ts`, add to the `<style>` block after the existing `.track-canvas-wrap` rule (line ~487):

```ts
// Add after:
// .track-canvas-wrap { flex: 1; position: relative; overflow: hidden; background: var(--track-bg); }
.track-canvas-wrap { flex: 1; display: flex; position: relative; overflow: hidden; background: var(--track-bg); }
.track-axis-canvas { flex: none; display: block; }
```

(Note: add `display: flex` to `.track-canvas-wrap` and add the new `.track-axis-canvas` rule.)

- [ ] **Step 2: Add AXIS_W constant in the render script IIFE**

In `src/webview/comparisonRenderScript.ts`, inside the IIFE (after the opening `(function() {` near line ~30), add:

```ts
const AXIS_W = 32;
```

- [ ] **Step 3: Add axis canvas to ruler row HTML**

In `buildTrackRow`'s sibling `buildLayout` function that generates `ruler-row` (line ~555), change:

```ts
// BEFORE:
'  <div id="ruler-row"><div id="ruler-spacer"></div><canvas id="ruler-canvas"></canvas></div>'

// AFTER:
'  <div id="ruler-row"><div id="ruler-spacer"></div><div id="ruler-axis-spacer" style="width:' + AXIS_W + 'px;flex:none"></div><canvas id="ruler-canvas"></canvas></div>'
```

- [ ] **Step 4: Add axis canvas to track row HTML**

In `buildTrackRow` (line ~691–693), change the `track-canvas-wrap` inner content:

```ts
// BEFORE:
+ '<div class="track-canvas-wrap" id="track-canvas-wrap-' + i + '">'
+ '  <canvas class="track-canvas" id="track-canvas-' + i + '" data-track-index="' + i + '" tabindex="0" style="outline:none"></canvas>'
+ '</div>'

// AFTER:
+ '<div class="track-canvas-wrap" id="track-canvas-wrap-' + i + '">'
+ '  <canvas class="track-axis-canvas" id="track-axis-canvas-' + i + '" style="width:' + AXIS_W + 'px" data-track-index="' + i + '"></canvas>'
+ '  <canvas class="track-canvas" id="track-canvas-' + i + '" data-track-index="' + i + '" tabindex="0" style="outline:none;flex:1"></canvas>'
+ '</div>'
```

- [ ] **Step 5: Update `resizeAllCanvases` to size both canvases**

In `resizeAllCanvases` (lines ~732–750), change the waveform canvas sizing and add axis canvas sizing:

```ts
// BEFORE:
const newW = wrap.clientWidth || 800;
if (canvasWidthCache[i] === newW) { return; }
canvasWidthCache[i] = newW;
canvas.width = newW;
canvas.height = 80;

// AFTER:
const newW = wrap.clientWidth || 800;
if (canvasWidthCache[i] === newW) { return; }
canvasWidthCache[i] = newW;
canvas.width = Math.max(1, newW - AXIS_W);
canvas.height = 80;
const axisCanvas = document.getElementById('track-axis-canvas-' + i);
if (axisCanvas) { axisCanvas.width = AXIS_W; axisCanvas.height = 80; }
```

Also fix the ruler width calculation (line ~747):
```ts
// BEFORE:
if (row) { rulerCanvas.width = row.clientWidth - 130; }

// AFTER:
if (row) { rulerCanvas.width = Math.max(1, row.clientWidth - 130 - AXIS_W); }
```

- [ ] **Step 6: Remove waveform clip and move axis draw to axis canvas**

In `drawTrackWaveform` (or the function called at line ~836), find the clip block (line ~900–903):

```ts
// BEFORE:
ctx.save();
ctx.beginPath();
ctx.rect(32, 0, W - 32, H);
ctx.clip();
try {
    window.renderWaveformPipeline(ctx, W, H, src.waveform, { ... });
} finally {
    ctx.restore();
    ...
}
...
drawWaveformAmplitudeAxis(ctx, W, H);

// AFTER:
try {
    window.renderWaveformPipeline(ctx, W, H, src.waveform, { ... });
} finally {
    ctx.moveTo = originalMoveTo;
    ctx.lineTo = originalLineTo;
}
const axisCanvas = document.getElementById('track-axis-canvas-' + trackIndex);
if (axisCanvas) {
    const axisCtx = axisCanvas.getContext('2d');
    if (axisCtx) { drawWaveformAmplitudeAxis(axisCtx, AXIS_W, H); }
}
```

(Keep the `ctx.save()` / `ctx.restore()` wrapping the `ctx.moveTo` / `ctx.lineTo` monkey-patching, but remove the `ctx.rect` / `ctx.clip` call inside it.)

- [ ] **Step 7: Fix spectrogram canvas width calculation**

In the spectrogram rendering functions (lines ~2847 and ~2908), change the wrap width calculation:

```ts
// BEFORE (two occurrences):
const w = wrap ? wrap.clientWidth : 0;

// AFTER:
const w = wrap ? Math.max(1, wrap.clientWidth - AXIS_W) : 0;
```

Also clear the axis canvas in spectrogram mode — after those two occurrences, add:
```ts
// Clear axis canvas when in spectrogram mode (no amplitude scale needed)
const axisC = document.getElementById('track-axis-canvas-' + i);
if (axisC) { const ac = axisC.getContext('2d'); if (ac) { ac.clearRect(0, 0, axisC.width, axisC.height); } }
```

- [ ] **Step 8: Add node:test for non-overlap**

In `src/test/canvasDrawers.test.ts` (or create a new test in a suitable file), add:

```ts
test('#100: track-axis-canvas と track-canvas が横方向に重ならないこと', async () => {
    // jsdom 環境で buildTrackRow の出力を検証する
    // comparisonRenderScript.ts の buildTrackRow が生成する HTML を使う
    const { JSDOM } = require('jsdom');
    const { getComparisonRenderScript, SHORTCUT_ROWS } = require('../webview/comparisonRenderScript');
    // track-canvas-wrap の内側に axis-canvas と waveform-canvas が並ぶ構造を確認
    const html = `<div class="track-canvas-wrap">
      <canvas class="track-axis-canvas" id="track-axis-canvas-0" style="width:32px"></canvas>
      <canvas class="track-canvas" id="track-canvas-0" style="flex:1"></canvas>
    </div>`;
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    const axisCanvas = dom.window.document.getElementById('track-axis-canvas-0');
    const waveCanvas = dom.window.document.getElementById('track-canvas-0');
    assert.ok(axisCanvas, 'track-axis-canvas-0 が存在すること');
    assert.ok(waveCanvas, 'track-canvas-0 が存在すること');
    // axis-canvas は track-canvas より DOM 順序で前にある（左側）
    const order = axisCanvas.compareDocumentPosition(waveCanvas);
    assert.ok(order & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'axis-canvas が waveform-canvas より前にあること');
    dom.window.close();
});
```

- [ ] **Step 9: Compile and run tests**

```bash
npm run compile 2>&1 | tail -20
npm run test 2>&1 | tail -30
```

Expected: exit 0 for both. Waveform rendering tests pass.

- [ ] **Step 10: Run UI smoke tests**

```bash
npm run test:ui 2>&1 | tail -30
```

Expected: all passing.

- [ ] **Step 11: Commit**

```bash
git add src/webview/comparisonRenderScript.ts src/webview/panels/ComparisonPanel.ts src/test/canvasDrawers.test.ts
git commit -m "fix(#100): separate axis canvas from waveform canvas — AXIS_W=32"
```

---

## Task 5: #101 — Fix ChartSpec dblclick coordinate scaling

**Files:**
- Modify: `src/webview/chartSpecRenderScript.ts`
- Modify: `src/webview/panels/ChartSpecPanel.ts`
- Modify: `src/test/chartSpecRangeControl.test.ts`

- [ ] **Step 1: Write failing test — narrow viewport dblclick**

In `src/test/chartSpecRangeControl.test.ts`, add this test after the existing heatmap dblclick test (after line ~154):

```ts
test('Line チャートの Y 軸エリアを canvas が縮小表示されていてもダブルクリックで判定できる', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');

    // canvas を 360px 幅 (720px の半分) に縮小表示されているとシミュレート
    // getBoundingClientRect が縮小サイズを返すようにスタブする
    const origGetBCR = canvas.getBoundingClientRect.bind(canvas);
    (canvas as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 360, height: 120, right: 360, bottom: 120, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    // 縮小後の Y 軸エリア: plot.x=50 は canvas論理座標系。縮小比 0.5 なので CSS 座標では 25px
    // clientX=10 は CSS座標で x=10 → 論理座標 x=20 → plot.x=50 より左 → Y軸ゾーン
    const ev = new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 10, clientY: 60,
    });
    canvas.dispatchEvent(ev);

    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', '縮小表示でも Y 軸 dblclick でポップアップが開くこと');

    canvas.getBoundingClientRect = origGetBCR;
    dom.window.close();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run compile && node --test dist/test/chartSpecRangeControl.test.js 2>&1 | tail -20
```

Expected: FAIL — the new test fails because coordinate scaling is not yet implemented.

- [ ] **Step 3: Add `toCanvasCoords` helper and CSS fix**

In `src/webview/chartSpecRenderScript.ts`, add the helper function before the `drawLine` function (around line ~270):

```ts
    function toCanvasCoords(e, canvas, cv) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = cv.width / (rect.width || cv.width);
        var scaleY = cv.height / (rect.height || cv.height);
        return {
            cx: (e.clientX - rect.left) * scaleX,
            cy: (e.clientY - rect.top)  * scaleY,
        };
    }
```

- [ ] **Step 4: Apply `toCanvasCoords` to the `drawLine` dblclick handler**

In `drawLine` (lines ~363–383), change:

```ts
// BEFORE:
cv.canvas.addEventListener('dblclick', function(e) {
    const rect = cv.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

// AFTER:
cv.canvas.addEventListener('dblclick', function(e) {
    var coords = toCanvasCoords(e, cv.canvas, cv);
    var cx = coords.cx;
    var cy = coords.cy;
```

- [ ] **Step 5: Apply `toCanvasCoords` to the `drawBar` dblclick handler**

In `drawBar` (lines ~482–499), change:

```ts
// BEFORE:
cv.canvas.addEventListener('dblclick', function(e) {
    const rect = cv.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

// AFTER:
cv.canvas.addEventListener('dblclick', function(e) {
    var coords = toCanvasCoords(e, cv.canvas, cv);
    var cx = coords.cx;
    var cy = coords.cy;
```

- [ ] **Step 6: Apply `toCanvasCoords` to the `drawHeatmap` dblclick handler**

In `drawHeatmap` (lines ~590–600), change:

```ts
// BEFORE:
cv.canvas.addEventListener('dblclick', function(e) {
    const rect = cv.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;

// AFTER:
cv.canvas.addEventListener('dblclick', function(e) {
    var coords = toCanvasCoords(e, cv.canvas, cv);
    var cx = coords.cx;
```

Also update `cy` in the heatmap handler if present — find `e.clientY - rect.top` in that block and replace with `coords.cy`.

- [ ] **Step 7: Add `canvas { max-width: 100%; }` to ChartSpecPanel**

In `src/webview/panels/ChartSpecPanel.ts`, find the existing `canvas { display: block; }` CSS rule (line ~51) and change to:

```ts
// BEFORE:
canvas { display: block; }

// AFTER:
canvas { display: block; max-width: 100%; }
```

- [ ] **Step 8: Compile and run tests**

```bash
npm run compile && node --test dist/test/chartSpecRangeControl.test.js 2>&1 | tail -20
```

Expected: all tests pass including the new narrow-viewport test.

- [ ] **Step 9: Run full verify**

```bash
npm run verify 2>&1 | tail -20
```

Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/webview/chartSpecRenderScript.ts src/webview/panels/ChartSpecPanel.ts src/test/chartSpecRangeControl.test.ts
git commit -m "fix(#101): normalize dblclick coords via toCanvasCoords — fixes narrow-panel regression"
```

---

## Task 6: #102 — Add i18n strings for export feedback

**Files:**
- Modify: `src/shared/i18n/strings.ts`

- [ ] **Step 1: Add 6 new keys to `UiStrings` interface**

In `src/shared/i18n/strings.ts`, add to the `UiStrings` interface (after `announceTrackRemoved: string;`, line ~136):

```ts
announceSpecCopied: string;
announceSpecCopyFailed: string;
announceExportPngStarted: string;
announceExportPngFailed: string;
announceExportCsvStarted: string;
announceExportCsvFailed: string;
```

- [ ] **Step 2: Add English values**

In the `en:` block, add after `announceTrackRemoved: 'Track {n} removed',` (line ~271):

```ts
announceSpecCopied: 'Spec copied to clipboard',
announceSpecCopyFailed: 'Copy failed: clipboard not available',
announceExportPngStarted: 'PNG export started',
announceExportPngFailed: 'PNG export failed: no visible canvases',
announceExportCsvStarted: 'CSV export started',
announceExportCsvFailed: 'CSV export failed: no spectrum data at cursor',
```

- [ ] **Step 3: Add Japanese values**

In the `ja:` block, add after `announceTrackRemoved: 'トラック{n}を削除',` (line ~404):

```ts
announceSpecCopied: 'スペックをクリップボードにコピーしました',
announceSpecCopyFailed: 'コピー失敗：クリップボードが利用できません',
announceExportPngStarted: 'PNG 出力を開始しました',
announceExportPngFailed: 'PNG 出力失敗：表示中のキャンバスがありません',
announceExportCsvStarted: 'CSV 出力を開始しました',
announceExportCsvFailed: 'CSV 出力失敗：カーソル位置にスペクトルデータがありません',
```

- [ ] **Step 4: Compile**

```bash
npm run compile 2>&1 | tail -10
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/i18n/strings.ts
git commit -m "feat(#102): add i18n strings for export button feedback"
```

---

## Task 7: #102 — Wire feedback into export functions and add tests

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`
- Modify: `src/test/uiSmoke/allButtons.spec.ts`

- [ ] **Step 1: Write failing tests for announce behavior**

In `src/test/uiSmoke/allButtons.spec.ts`, add a new test after the existing `results-toolbar buttons` test (after line ~152):

```ts
test('copy-spec / export-png / export-csv ボタンが #a11y-announce を更新する', async ({ page }) => {
    await loadResultsUi(page);
    const toolbar = page.locator('#toolbar');

    // copy-spec: クリック後に a11y-announce に成功メッセージが出る
    await toolbar.locator('[data-action="copy-spec"]').click({ force: true });
    await expect(page.locator('#a11y-announce')).not.toBeEmpty();

    // export-png: クリック後に announce が更新される
    await page.evaluate(() => {
        const el = document.getElementById('a11y-announce');
        if (el) { el.textContent = ''; }
    });
    await toolbar.locator('[data-action="export-png"]').click({ force: true });
    await expect(page.locator('#a11y-announce')).not.toBeEmpty();

    // export-csv: クリック後に announce が更新される
    await page.evaluate(() => {
        const el = document.getElementById('a11y-announce');
        if (el) { el.textContent = ''; }
    });
    await toolbar.locator('[data-action="export-csv"]').click({ force: true });
    await expect(page.locator('#a11y-announce')).not.toBeEmpty();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run compile && npx playwright test src/test/uiSmoke/allButtons.spec.ts --grep "a11y-announce" 2>&1 | tail -20
```

Expected: FAIL — announce is not yet populated by these buttons.

- [ ] **Step 3: Add feedback to `copySpecToClipboard`**

In `src/webview/comparisonRenderScript.ts`, find `copySpecToClipboard` (line ~2499). Change:

```ts
// BEFORE:
navigator.clipboard.writeText(lines.join('\\n')).catch(function() { /* permission denied or unavailable */ });

// AFTER:
navigator.clipboard.writeText(lines.join('\\n'))
    .then(function() { announce(STR.announceSpecCopied || 'Spec copied to clipboard'); })
    .catch(function() {
        vscode.postMessage({ type: 'show-info', message: STR.announceSpecCopyFailed || 'Copy failed: clipboard not available' });
    });
```

Also add an early-return guard with feedback if clipboard API is unavailable:
```ts
// BEFORE:
if (!navigator.clipboard || !navigator.clipboard.writeText) { return; }

// AFTER:
if (!navigator.clipboard || !navigator.clipboard.writeText) {
    vscode.postMessage({ type: 'show-info', message: STR.announceSpecCopyFailed || 'Copy failed: clipboard not available' });
    return;
}
```

- [ ] **Step 4: Add feedback to `exportPng`**

In `exportPng` (line ~2201):

```ts
// BEFORE (early return on no canvases):
if (canvases.length === 0) {
    console.warn('exportPng: no visible canvases found');
    return;
}

// AFTER:
if (canvases.length === 0) {
    vscode.postMessage({ type: 'show-info', message: STR.announceExportPngFailed || 'PNG export failed: no visible canvases' });
    return;
}
```

Add success announce before the download trigger (after `document.body.appendChild(a)` and before `a.click()`, line ~2230):
```ts
// BEFORE:
document.body.appendChild(a);
a.click();

// AFTER:
document.body.appendChild(a);
announce(STR.announceExportPngStarted || 'PNG export started');
a.click();
```

Also replace the `console.warn` for context failure:
```ts
// BEFORE:
if (!ctx) { console.warn('exportPng: could not get 2d context'); return; }

// AFTER:
if (!ctx) { vscode.postMessage({ type: 'show-info', message: STR.announceExportPngFailed || 'PNG export failed: no visible canvases' }); return; }
```

- [ ] **Step 5: Add feedback to `exportCsv`**

In `exportCsv` (line ~2235):

```ts
// BEFORE (early returns with console.warn):
if (typeof state === 'undefined' || !state.results || state.results.length === 0) {
    console.warn('exportCsv: no results available');
    return;
}
...
if (tracks.length === 0) {
    console.warn('exportCsv: no spectrum data available at cursor position');
    return;
}

// AFTER:
if (typeof state === 'undefined' || !state.results || state.results.length === 0) {
    vscode.postMessage({ type: 'show-info', message: STR.announceExportCsvFailed || 'CSV export failed: no spectrum data at cursor' });
    return;
}
...
if (tracks.length === 0) {
    vscode.postMessage({ type: 'show-info', message: STR.announceExportCsvFailed || 'CSV export failed: no spectrum data at cursor' });
    return;
}
```

Add success announce before the download trigger (after `document.body.appendChild(a)` in exportCsv, line ~2273):
```ts
// BEFORE:
document.body.appendChild(a);
a.click();

// AFTER:
document.body.appendChild(a);
announce(STR.announceExportCsvStarted || 'CSV export started');
a.click();
```

- [ ] **Step 6: Compile and run the new Playwright test**

```bash
npm run compile && npx playwright test src/test/uiSmoke/allButtons.spec.ts --grep "a11y-announce" 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 7: Run full verify**

```bash
npm run verify 2>&1 | tail -30
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/webview/comparisonRenderScript.ts src/test/uiSmoke/allButtons.spec.ts
git commit -m "feat(#102): add announce/show-info feedback to copy-spec, export-png, export-csv"
```

---

## Task 8: Final integration check and PR

**Files:** none (verify only)

- [ ] **Step 1: Run full verify**

```bash
npm run verify 2>&1 | tail -40
```

Expected: exit 0, all checks pass.

- [ ] **Step 2: Run UI smoke tests**

```bash
npm run test:ui 2>&1 | tail -40
```

Expected: all passing.

- [ ] **Step 3: Confirm no mute/solo references remain in production code**

```bash
grep -rn "toggle-mute\|toggle-solo\|soloTrackIndex\|ariaToggleMute\|ariaToggleSolo\|helpRowMuteSolo\|announceMuted\|announceSoloed" src/ --include="*.ts" | grep -v "\.test\." | grep -v "e2e"
```

Expected: no output.

- [ ] **Step 4: Create PR**

```bash
gh pr create \
  --title "fix: ComparisonPanel/ChartSpecPanel bug fixes (#99 #100 #101 #102)" \
  --body "$(cat <<'EOF'
## Summary
- **#99**: Remove unused mute/solo UI buttons, keyboard shortcuts (M/S), and all related state/strings/tests
- **#100**: Separate amplitude axis into its own 32px canvas alongside the waveform canvas — waveform start is no longer hidden
- **#101**: Fix dblclick hit detection in ChartSpecPanel via `toCanvasCoords` helper (getBoundingClientRect scaling) — works in panels narrower than 720px
- **#102**: Add user-visible feedback (aria-live announce + show-info) to Copy spec / Export PNG / Export CSV buttons

## Test plan
- [ ] `npm run verify` passes (node:test + lint + gui-triggerability audit)
- [ ] `npm run test:ui` passes (Playwright smoke)
- [ ] No `toggle-mute`/`toggle-solo` references in production TS
- [ ] dblclick narrow-viewport test passes in chartSpecRangeControl.test.ts
- [ ] announce test passes in allButtons.spec.ts

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
