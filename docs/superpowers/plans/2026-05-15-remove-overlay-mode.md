# Remove Overlay Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** オーバーレイモードを廃止し、縦積みのみに固定する。

**Architecture:** 3ファイルを編集する: `ComparisonPanel.ts`（型定義・CSS・DOM・JS全削除）、`renderScript.integration.test.ts`（overlayテスト削除）、`e2e/suite/index.ts`（overlay型フィールドとアサーション削除）。

**Tech Stack:** TypeScript, Node.js test runner (`node:test`)

---

### Task 1: Remove overlay integration test

**Files:**
- Modify: `src/test/renderScript.integration.test.ts:466-486`

- [ ] **Step 1: Delete the overlay clearRect test**

`src/test/renderScript.integration.test.ts` の末尾にある以下のテスト全体を削除する。

```
test('overlay 表示ではキャンバス全体の clearRect は 1 回だけで各トラックが積み重なる', async () => {
    const { dom, domCanvasContexts } = setupEnv();
    await nextAnimationFrame(dom);

    const overlayButton = dom.window.document.querySelector('[data-action="view-overlay"]');
    assert.ok(overlayButton instanceof dom.window.HTMLButtonElement);

    overlayButton.click();
    await nextAnimationFrame(dom);

    const overlayCtx = domCanvasContexts.get('overlay-canvas');
    assert.ok(overlayCtx, 'overlay-canvas のコンテキストが作成されること');
    overlayCtx.clearRectCalls = 0;
    overlayCtx.strokeCalls = 0;

    overlayButton.click();
    await nextAnimationFrame(dom);

    assert.equal(overlayCtx.clearRectCalls, 1, 'オーバーレイ描画は先頭で 1 回だけ clearRect すること');
    assert.ok(overlayCtx.strokeCalls >= 4, '2 トラック分のゼロラインと波形 stroke が積み重なって描画されること');
});
```

- [ ] **Step 2: Compile and run tests to establish baseline**

```bash
npm run compile && node --test dist/test/renderScript.integration.test.js
```

Expected: 削除したテスト以外が全件 `pass`。

---

### Task 2: Update E2E test types and assertions

**Files:**
- Modify: `src/e2e/suite/index.ts:17-40` (TestSnapshot interface)
- Modify: `src/e2e/suite/index.ts:69-113` (assertions)

- [ ] **Step 1: Remove overlay fields from TestSnapshot interface**

`src/e2e/suite/index.ts` の `TestSnapshot` インターフェースの `renderedUi` から以下3フィールドを削除する。

削除対象:
```typescript
        hasOverlayCanvas: boolean;
        viewMode: 'stacked' | 'overlay';
        stackedWrapVisible: boolean;
        overlayWrapVisible: boolean;
```

置き換え後（該当4行をまとめて削除、残すものなし）。

- [ ] **Step 2: Remove overlay assertions from run()**

`src/e2e/suite/index.ts` の `run()` 内で以下の変更を行う。

**行69を削除:**
```typescript
        assert.equal(snapshot.renderedUi.hasOverlayCanvas, true);
```

**toolbarActions の deepEqual から `'view-stacked'` と `'view-overlay'` の2行を削除:**
```typescript
        assert.deepEqual(snapshot.renderedUi.toolbarActions, [
            'open-file',
            'open-folder',
            'view-stacked',
            'view-overlay',
            'content-waveform',
            'content-spectrogram',
            'zoom-out',
            'zoom-in',
        ]);
```
↓ 変更後:
```typescript
        assert.deepEqual(snapshot.renderedUi.toolbarActions, [
            'open-file',
            'open-folder',
            'content-waveform',
            'content-spectrogram',
            'zoom-out',
            'zoom-in',
        ]);
```

**overlaySnapshot テストブロック（5行）を削除:**
```typescript
        const overlaySnapshot = await runViewModeScenario(['view-overlay']);
        assert.ok(overlaySnapshot.renderedUi, 'Rendered UI snapshot should exist after overlay switch');
        assert.equal(overlaySnapshot.renderedUi.viewMode, 'overlay');
        assert.equal(overlaySnapshot.renderedUi.stackedWrapVisible, false);
        assert.equal(overlaySnapshot.renderedUi.overlayWrapVisible, true);
```

**spectrogramSnapshot の overlay/stacked アサーション3行を削除:**
```typescript
        assert.equal(spectrogramSnapshot.renderedUi.viewMode, 'stacked');
        assert.equal(spectrogramSnapshot.renderedUi.stackedWrapVisible, true);
        assert.equal(spectrogramSnapshot.renderedUi.overlayWrapVisible, false);
```

---

### Task 3: Remove overlay TypeScript interfaces from ComparisonPanel.ts

**Files:**
- Modify: `src/panels/ComparisonPanel.ts:35-55` (first interface)
- Modify: `src/panels/ComparisonPanel.ts:60-80` (second interface)

- [ ] **Step 1: Remove overlay fields from first interface**

`ComparisonPanel.ts` に2つの似た型定義がある（行 35〜55 付近と行 60〜80 付近）。両方から以下フィールドを削除する。

削除対象（各インターフェースにある）:
```typescript
        hasOverlayCanvas: boolean;
        viewMode: 'stacked' | 'overlay';
        stackedWrapVisible: boolean;
        overlayWrapVisible: boolean;
```

- [ ] **Step 2: Compile to verify no TypeScript errors**

```bash
npm run compile 2>&1 | head -30
```

Expected: エラーなし（またはoverlay関連以外のエラーがないこと）。

---

### Task 4: Remove overlay CSS

**Files:**
- Modify: `src/panels/ComparisonPanel.ts:418-425`

- [ ] **Step 1: Delete overlay CSS block**

以下のCSS7行とコメントを削除する:

```
        /* ── Overlay mode ── */
        #overlay-wrap { flex: 1; display: none; flex-direction: column; }
        #overlay-wrap.is-visible { display: flex; }
        #overlay-legend { display: flex; gap: 12px; padding: 4px 10px; font-size: 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
        .overlay-legend-item { display: flex; align-items: center; gap: 4px; }
        .overlay-swatch { width: 12px; height: 2px; border-radius: 1px; }
        #overlay-canvas-wrap { flex: 1; position: relative; overflow: hidden; background: var(--track-bg); }
        #overlay-canvas { display: block; width: 100%; cursor: crosshair; }
```

---

### Task 5: Remove overlay DOM and toolbar buttons

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (buildContent and buildToolbar functions)

- [ ] **Step 1: Remove overlay-wrap DOM from buildContent()**

`buildContent()` 内の以下3行を削除する:
```javascript
                    + '  <div id="overlay-wrap">'
                    + '    <div id="overlay-legend"></div>'
                    + '    <div id="overlay-canvas-wrap"><canvas id="overlay-canvas"></canvas></div>'
                    + '  </div>'
```

- [ ] **Step 2: Remove view-stacked / view-overlay buttons from buildToolbar()**

`buildToolbar()` 内の「表示:」セクション（`tb-sep`〜`view-overlay`まで）を削除する:
```javascript
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">表示:</span>'
                    + '<button class="tb-btn is-active" data-action="view-stacked">縦積み</button>'
                    + '<button class="tb-btn" data-action="view-overlay">オーバーレイ</button>'
```

---

### Task 6: Remove overlay JS state and simplify renderAll()

**Files:**
- Modify: `src/panels/ComparisonPanel.ts:580,600,944-948`

- [ ] **Step 1: Remove viewMode and hoverTrackIndex variables**

以下2行を削除する:
```javascript
            let viewMode = 'stacked';     // 'stacked' | 'overlay'
```
```javascript
            let hoverTrackIndex = -1;     // overlay hit-test highlight
```

- [ ] **Step 2: Simplify renderAll() — remove viewMode branch**

```javascript
            function renderAll() {
                resizeAllCanvases();
                renderRuler();
                if (viewMode === 'stacked') {
                    renderStackedTracks();
                } else {
                    renderOverlay();
                }
                updateVisibility();
                updateOffsetDisplays();
                if (contentType === 'waveform') { scheduleRangeRequests(); }
            }
```
↓ 変更後:
```javascript
            function renderAll() {
                resizeAllCanvases();
                renderRuler();
                renderStackedTracks();
                updateVisibility();
                updateOffsetDisplays();
                if (contentType === 'waveform') { scheduleRangeRequests(); }
            }
```

---

### Task 7: Remove overlay canvas resize and event listeners

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (resizeAllCanvases and init event listener block)

- [ ] **Step 1: Remove overlay canvas section from resizeAllCanvases()**

以下のブロックを削除する:
```javascript
                const overlayCanvas = document.getElementById('overlay-canvas');
                if (overlayCanvas) {
                    const wrap = document.getElementById('overlay-canvas-wrap');
                    if (wrap) {
                        const newW = wrap.clientWidth || 800;
                        if (canvasWidthCache['overlay'] !== newW) {
                            canvasWidthCache['overlay'] = newW;
                            overlayCanvas.width = newW;
                            overlayCanvas.height = 160;
                        }
                    }
                }
```

- [ ] **Step 2: Remove overlay event listener block from init section**

以下のブロックを削除する:
```javascript
                const overlayCanvas = document.getElementById('overlay-canvas');
                if (overlayCanvas) {
                    overlayCanvas.addEventListener('mousemove', function(e) { handleOverlayMouseMove(e); });
                    overlayCanvas.addEventListener('mouseleave', clearHover);
                    overlayCanvas.addEventListener('mousedown', function(e) { handleOverlayMouseDown(e); });
                    overlayCanvas.addEventListener('click', function(e) { handleOverlayClick(e); });
                }
```

---

### Task 8: Remove handleToolbarAction overlay branches

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (handleToolbarAction function)

- [ ] **Step 1: Remove view-stacked and view-overlay action handlers**

以下のブロックを削除する:
```javascript
                } else if (action === 'view-stacked') {
                    viewMode = 'stacked';
                    document.querySelector('[data-action="view-stacked"]').classList.add('is-active');
                    document.querySelector('[data-action="view-overlay"]').classList.remove('is-active');
                    document.getElementById('stacked-wrap').style.display = '';
                    document.getElementById('overlay-wrap').classList.remove('is-visible');
                    scheduleRender();
                } else if (action === 'view-overlay') {
                    viewMode = 'overlay';
                    document.querySelector('[data-action="view-stacked"]').classList.remove('is-active');
                    document.querySelector('[data-action="view-overlay"]').classList.add('is-active');
                    document.getElementById('stacked-wrap').style.display = 'none';
                    document.getElementById('overlay-wrap').classList.add('is-visible');
                    scheduleRender();
```

- [ ] **Step 2: Remove viewMode check from content-spectrogram handler**

```javascript
                    // スペクトログラムはオーバーレイ非対応のため縦積みに切替
                    if (viewMode === 'overlay') {
                        viewMode = 'stacked';
                        document.querySelector('[data-action="view-stacked"]').classList.add('is-active');
                        document.querySelector('[data-action="view-overlay"]').classList.remove('is-active');
                        document.getElementById('stacked-wrap').style.display = '';
                        document.getElementById('overlay-wrap').classList.remove('is-visible');
                    }
```
この8行（コメント含む）を削除する。

---

### Task 9: Remove all overlay functions

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (6 functions)

- [ ] **Step 1: Remove renderOverlay() function (lines 1229-1264)**

```javascript
            function renderOverlay() {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas) { return; }
                const ctx = canvas.getContext('2d');
                const W = canvas.width;
                const H = canvas.height;
                ctx.clearRect(0, 0, W, H);

                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden || result.error) { return; }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    const isHl = (i === hoverTrackIndex);
                    ctx.save();
                    ctx.globalAlpha = isHl ? 1.0 : 0.7;
                    drawTrackWaveform(canvas, result, i, trackRuntime[i].offsetSeconds, color, {
                        clear: false,
                        drawCursor: false,
                    });
                    ctx.restore();
                });

                drawLoopRegionOnCanvas(ctx, W, H);

                const x = (cursorNorm - zoomStart) / (zoomEnd - zoomStart) * W;
                ctx.save();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.globalAlpha = 0.7;
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
                ctx.restore();

                drawHoverLineOnCanvas(ctx, W, H);

                updateOverlayLegend();
            }
```

- [ ] **Step 2: Remove updateOverlayLegend() function (lines 1266-1275)**

```javascript
            function updateOverlayLegend() {
                const legend = document.getElementById('overlay-legend');
                if (!legend) { return; }
                legend.innerHTML = state.results.map(function(result, i) {
                    if (trackRuntime[i].hidden) { return ''; }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    return '<div class="overlay-legend-item"><div class="overlay-swatch" style="background:' + color + '"></div>'
                        + '<span>' + escHtml(result.fileName) + '</span></div>';
                }).join('');
            }
```

- [ ] **Step 3: Remove hitTestOverlay() function (lines 1926-1962)**

```javascript
            function hitTestOverlay(canvas, clientX, clientY) {
                const rect = canvas.getBoundingClientRect();
                const mouseX = clientX - rect.left;
                const mouseY = clientY - rect.top;
                const W = canvas.width;
                const H = canvas.height;
                let minDist = Infinity;
                let nearest = -1;
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden || result.error) { return; }
                    const offsetSeconds = trackRuntime[i].offsetSeconds;
                    const src = resolveWaveformSource(result, i, offsetSeconds);
                    if (!src) { return; }
                    const { waveform: env, dataStart, dataEnd } = src;
                    const peak = env.absolutePeak || 1;
                    const samples = env.samples || [];
                    const minArr = env.min || [];
                    const maxArr = env.max || [];
                    const n = samples.length;
                    const dur = result.durationSeconds || 1;
                    const gs = computeGlobalSpan();
                    const trackStart = (offsetSeconds - gs.startSec) / gs.spanSec;
                    const trackDurRatio = dur / gs.spanSec;
                    const tNorm = zoomStart + (mouseX / W) * (zoomEnd - zoomStart);
                    const filePos = (tNorm - trackStart) / trackDurRatio;
                    const tInData = (filePos - dataStart) / (dataEnd - dataStart);
                    const idx = Math.floor(tInData * n);
                    if (idx < 0 || idx >= n) { return; }
                    const absMin = minArr.length > idx ? Math.abs(minArr[idx]) : 0;
                    const absMax = maxArr.length > idx ? Math.abs(maxArr[idx]) : 0;
                    const repVal = absMax >= absMin ? (maxArr[idx] ?? 0) : (minArr[idx] ?? 0);
                    const waveY = H / 2 - (repVal / peak) * (H * 0.44);
                    const dist = Math.abs(mouseY - waveY);
                    if (dist < minDist) { minDist = dist; nearest = i; }
                });
                return minDist <= 20 ? nearest : -1;
            }
```

- [ ] **Step 4: Remove handleOverlayMouseMove() function**

```javascript
            function handleOverlayMouseMove(e) {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas || dragState) { return; }
                const newHover = hitTestOverlay(canvas, e.clientX, e.clientY);
                if (newHover !== hoverTrackIndex) {
                    hoverTrackIndex = newHover;
                    canvas.style.cursor = newHover >= 0 ? 'ew-resize' : 'crosshair';
                    renderOverlay();
                }
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                renderWithHoverAt(norm);
            }
```

- [ ] **Step 5: Remove handleOverlayMouseDown() function**

```javascript
            function handleOverlayMouseDown(e) {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas) { return; }
                const idx = hitTestOverlay(canvas, e.clientX, e.clientY);
                if (idx >= 0) {
                    dragState = {
                        trackIndex: idx,
                        startClientX: e.clientX,
                        startOffset: trackRuntime[idx].offsetSeconds,
                        canvasWidth: canvas.width,
                        isDrag: false,
                        dragType: 'offset',
                    };
                }
            }
```

- [ ] **Step 6: Remove handleOverlayClick() function**

```javascript
            function handleOverlayClick(e) {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas) { return; }
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                cursorNorm = Math.max(0, Math.min(1, norm));
                loopRegion = null;
                updateCursorDisplay(cursorNorm);
                scheduleRender();
            }
```

---

### Task 10: Fix handleDocMouseUp and update publishTestSnapshot

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (handleDocMouseUp, publishTestSnapshot)

- [ ] **Step 1: Fix canvas ID selection in handleDocMouseUp()**

```javascript
                    const canvasId = viewMode === 'overlay' ? 'overlay-canvas' : 'track-canvas-' + dragState.trackIndex;
```
↓ 変更後:
```javascript
                    const canvasId = 'track-canvas-' + dragState.trackIndex;
```

- [ ] **Step 2: Clean up publishTestSnapshot()**

`publishTestSnapshot()` 内の以下を削除する:

削除: `const overlayWrap = document.getElementById('overlay-wrap');`

削除: snapshotオブジェクト内の以下フィールド:
```javascript
                        hasOverlayCanvas: !!document.getElementById('overlay-canvas'),
                        viewMode: viewMode,
                        stackedWrapVisible: !!stackedWrap && stackedWrap.style.display !== 'none',
                        overlayWrapVisible: !!overlayWrap && overlayWrap.classList.contains('is-visible'),
```

また `stackedWrap` 変数も `stacked-wrap` の `display` チェックに使われていたが、`overlayWrapVisible` 削除後は参照されなくなる。`stackedWrap` 変数自体（`const stackedWrap = document.getElementById('stacked-wrap');`）も削除する。

---

### Task 11: Final compile, full test run, and commit

**Files:** なし（検証のみ）

- [ ] **Step 1: Compile**

```bash
npm run compile 2>&1
```

Expected: エラーなし。

- [ ] **Step 2: Run all unit tests**

```bash
node --test dist/test/waveformRenderer.test.js dist/test/rangeRequestPolicy.test.js dist/test/renderScript.integration.test.js
```

Expected: 全件 `pass`、`overlay` 関連の行が残っていないこと。

- [ ] **Step 3: Verify no overlay identifiers remain in source**

```bash
grep -rn "overlay\|viewMode\|hoverTrackIndex" src/panels/ComparisonPanel.ts src/test/renderScript.integration.test.ts src/e2e/suite/index.ts
```

Expected: 出力なし（ゼロヒット）。

- [ ] **Step 4: Commit**

```bash
git add src/panels/ComparisonPanel.ts src/test/renderScript.integration.test.ts src/e2e/suite/index.ts
git commit -m "feat: remove overlay view mode, fix to stacked-only display"
```
