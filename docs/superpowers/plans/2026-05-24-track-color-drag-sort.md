# Track Color & Drag Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** トラックヘッダーにカラーピッカー（固定パレットポップオーバー）とドラッグハンドルを追加し、波形/スペクトル描画色の変更と表示順ドラッグ並び替えを実現する。

**Architecture:** `displayOrder: number[]`（表示位置→state.results添え字）をランタイム状態に追加し、描画ループをこの配列経由に統一する。色は`trackRuntime[i].color`（null=デフォルト色にフォールバック）で管理。DOM IDは`state.results`添え字で固定のまま。

**Tech Stack:** TypeScript、HTML5 Drag and Drop API、CSS flexbox DOM 並び替え、既存ポップオーバーパターン

---

## File Structure

| ファイル | 変更種別 |
|---------|---------|
| `src/test/trackOrder.test.ts` | Create — reorderInPlace純粋関数のユニットテスト |
| `src/shared/i18n/strings.ts` | Modify — 4 キー追加 |
| `src/webview/panels/ComparisonPanel.ts` | Modify — CSS追加 |
| `src/webview/comparisonRenderScript.ts` | Modify — メイン実装 |
| `src/e2e/suite/index.ts` | Modify — スナップショットにdisplayOrder追加 |

---

## Task 1: ブランチとworktreeを作成

**Files:**
- None (git setup)

- [ ] **Step 1: worktreeを作成してブランチに移動**

```bash
cd /workspaces/audio-wandas-analyzer
bash scripts/worktree-new.sh feat-track-color-sort main
cd .worktrees/feat-track-color-sort
```

Expected: `.worktrees/feat-track-color-sort/` が作成され、そこに移動する

---

## Task 2: reorderInPlace ユニットテスト → 実装

**Files:**
- Create: `src/test/trackOrder.test.ts`

- [ ] **Step 1: テストファイルを作成（まず失敗することを確認）**

`src/test/trackOrder.test.ts` を作成：

```typescript
/**
 * displayOrder 配列の並び替え純粋関数のユニットテスト。
 * reorderInPlace は comparisonRenderScript.ts のテンプレートリテラル内で
 * 定義されるため、同一ロジックをここに複製して検証する。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/** displayOrder 配列を破壊的に並び替えて返す */
function reorderInPlace(order: number[], fromStateIdx: number, toStateIdx: number): number[] {
    const fromPos = order.indexOf(fromStateIdx);
    const toPos   = order.indexOf(toStateIdx);
    if (fromPos === -1 || toPos === -1) { return order; }
    order.splice(fromPos, 1);
    order.splice(toPos, 0, fromStateIdx);
    return order;
}

test('先頭から末尾に移動', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 0, 3), [1,2,3,0]);
});

test('末尾から先頭に移動', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 3, 0), [3,0,1,2]);
});

test('隣接要素の交換', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 1, 2), [0,2,1,3]);
});

test('同一要素は変化なし', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 2, 2), [0,1,2,3]);
});

test('fromStateIdx が存在しない場合は変化なし', () => {
    assert.deepEqual(reorderInPlace([0,1,2], 5, 1), [0,1,2]);
});

test('toStateIdx が存在しない場合は変化なし', () => {
    assert.deepEqual(reorderInPlace([0,1,2], 0, 5), [0,1,2]);
});

test('2要素の交換', () => {
    assert.deepEqual(reorderInPlace([0,1], 0, 1), [1,0]);
});
```

- [ ] **Step 2: テストを実行してパスすることを確認**

```bash
node --test src/test/trackOrder.test.ts
```

Expected: 7 tests pass（ロジックはテストファイル内に自己完結しているため初回からパス）

- [ ] **Step 3: コミット**

```bash
git add src/test/trackOrder.test.ts
git commit -m "test: reorderInPlace unit tests for displayOrder manipulation"
```

---

## Task 3: i18n キーを追加

**Files:**
- Modify: `src/shared/i18n/strings.ts`

- [ ] **Step 1: UiStrings インターフェースに4キー追加**

`src/shared/i18n/strings.ts` の `reportExportedPrefix: string;` の直後（`}` の前）に追記：

```typescript
    trackPickColor: string;
    trackColorReset: string;
    ariaDragHandle: string;
    ariaPickColor: string;
```

- [ ] **Step 2: EN辞書に追加**

`en` オブジェクトの `reportExportedPrefix: 'Report exported → ',` の直後に追記：

```typescript
        trackPickColor: 'Change color',
        trackColorReset: 'Reset to default',
        ariaDragHandle: 'Drag to reorder track',
        ariaPickColor: 'Change track color',
```

- [ ] **Step 3: JA辞書に追加**

`ja` オブジェクトの `reportExportedPrefix: 'レポートを書き出しました → ',` の直後に追記：

```typescript
        trackPickColor: '色を変更',
        trackColorReset: 'デフォルトに戻す',
        ariaDragHandle: 'ドラッグしてトラックを並び替え',
        ariaPickColor: 'トラック色を変更',
```

- [ ] **Step 4: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/shared/i18n/strings.ts
git commit -m "feat(i18n): add track color and drag handle keys"
```

---

## Task 4: CSS を ComparisonPanel.ts に追加

**Files:**
- Modify: `src/webview/panels/ComparisonPanel.ts`

- [ ] **Step 1: CSS を追加**

`ComparisonPanel.ts` の `.metrics-swatch { width: 8px; height: 8px; border-radius: 50%; }` の直後に追記：

```css
        .track-title-row { display: flex; align-items: center; gap: 4px; overflow: hidden; }
        .track-drag-handle { cursor: grab; color: var(--muted); font-size: 12px; user-select: none; flex-shrink: 0; padding: 0 2px; line-height: 1; }
        .track-drag-handle:active { cursor: grabbing; }
        .track-color-swatch { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; cursor: pointer; border: 1px solid var(--line); }
        .track-color-swatch:hover, .track-color-swatch:focus { outline: 2px solid var(--accent); }
        .color-palette-swatch { width: 20px; height: 20px; border-radius: 3px; cursor: pointer; border: 1px solid var(--line); flex-shrink: 0; }
        .color-palette-swatch:hover, .color-palette-swatch:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
        .track-row.drag-over { outline: 2px solid var(--accent); outline-offset: -2px; }
```

- [ ] **Step 2: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/webview/panels/ComparisonPanel.ts
git commit -m "feat(css): add drag handle and color swatch styles"
```

---

## Task 5: displayOrder・trackRuntime.color・trackColor() をランタイム状態に追加

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: TRACK_COLORS 拡張と trackColor ヘルパーを追加**

`comparisonRenderScript.ts` の以下の箇所を置換：

```javascript
            const TRACK_COLORS = ['#4ec994','#ff8c4a','#4a9eff','#e8637a','#c084fc'];
```

↓

```javascript
            const TRACK_COLORS = ['#4ec994','#ff8c4a','#4a9eff','#e8637a','#c084fc',
                                   '#f0c040','#40b0d0','#d09060','#80c080','#a0a0ff'];
```

- [ ] **Step 2: trackRuntime に color フィールドを追加、displayOrder と trackColor() を追加**

以下の箇所を置換：

```javascript
            const trackRuntime = state.results.map(function() {
                return { offsetSeconds: 0, hidden: false };
            });
```

↓

```javascript
            const trackRuntime = state.results.map(function() {
                return { offsetSeconds: 0, hidden: false, color: null };
            });

            let displayOrder = state.results.map(function(_, i) { return i; });

            function trackColor(i) {
                return (trackRuntime[i] && trackRuntime[i].color) || TRACK_COLORS[i % TRACK_COLORS.length];
            }
```

- [ ] **Step 3: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: add displayOrder, trackRuntime.color, trackColor() helper"
```

---

## Task 6: buildResultsPane を displayOrder 経由に変更、metrics に ID 付与

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: buildResultsPane の tracks/metrics ループを置換**

以下を置換：

```javascript
            function buildResultsPane(emptyMessage) {
                const tracks = state.results.map(function(result, i) {
                    return buildTrackRow(result, i);
                }).join('');
                const metrics = state.results.map(function(result, i) {
                    const ch = result.channels[0];
                    const rmsDb = ch ? (20 * Math.log10(Math.max(ch.rms, 1e-9))).toFixed(1) + ' dBFS' : '—';
                    const peakDb = ch ? (20 * Math.log10(Math.max(ch.peakAbsolute, 1e-9))).toFixed(1) + ' dBFS' : '—';
                    const domHz = ch && ch.dominantFrequencies && ch.dominantFrequencies[0]
                        ? Math.round(ch.dominantFrequencies[0].frequencyHz) + ' Hz' : '—';
                    return '<div class="metrics-item"><div class="metrics-swatch" style="background:' + TRACK_COLORS[i % TRACK_COLORS.length] + '"></div>'
                        + '<span>' + escHtml(result.fileName) + ': RMS ' + rmsDb + ' / Peak ' + peakDb + ' / ' + domHz + '</span></div>';
                }).join('');
```

↓

```javascript
            function buildResultsPane(emptyMessage) {
                const tracks = displayOrder.map(function(stateIdx) {
                    return buildTrackRow(state.results[stateIdx], stateIdx);
                }).join('');
                const metrics = displayOrder.map(function(stateIdx) {
                    const result = state.results[stateIdx];
                    const ch = result.channels[0];
                    const rmsDb = ch ? (20 * Math.log10(Math.max(ch.rms, 1e-9))).toFixed(1) + ' dBFS' : '—';
                    const peakDb = ch ? (20 * Math.log10(Math.max(ch.peakAbsolute, 1e-9))).toFixed(1) + ' dBFS' : '—';
                    const domHz = ch && ch.dominantFrequencies && ch.dominantFrequencies[0]
                        ? Math.round(ch.dominantFrequencies[0].frequencyHz) + ' Hz' : '—';
                    return '<div class="metrics-item" id="metrics-item-' + stateIdx + '"><div class="metrics-swatch" id="metrics-swatch-' + stateIdx + '" style="background:' + trackColor(stateIdx) + '"></div>'
                        + '<span>' + escHtml(result.fileName) + ': RMS ' + rmsDb + ' / Peak ' + peakDb + ' / ' + domHz + '</span></div>';
                }).join('');
```

- [ ] **Step 2: コンパイル + テスト確認**

```bash
npm run compile 2>&1 | tail -5
node --test src/test/trackOrder.test.ts
```

Expected: コンパイルエラーなし、7 tests pass

- [ ] **Step 3: コミット**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: buildResultsPane uses displayOrder, add metrics-item/swatch IDs"
```

---

## Task 7: buildTrackRow にドラッグハンドルとカラースウォッチを追加

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: buildTrackRow を置換**

以下を置換：

```javascript
            function buildTrackRow(result, i) {
                return '<div class="track-row" id="track-row-' + i + '" data-track-index="' + i + '">'
                    + '<div class="track-header">'
                    + '  <div class="track-name" title="' + escHtml(result.filePath) + '">' + escHtml(result.fileName) + '</div>'
                    + (result.channels && result.channels[0] && result.channels[0].peakAbsolute >= 0.99 ? '  <span class="clip-badge" title="' + escHtml(STR.clipBadgeTitle) + '">CLIP</span>' : '')
```

↓

```javascript
            function buildTrackRow(result, i) {
                return '<div class="track-row" id="track-row-' + i + '" data-track-index="' + i + '">'
                    + '<div class="track-header">'
                    + '  <div class="track-title-row">'
                    + '    <div class="track-drag-handle" draggable="true" data-track-index="' + i + '" aria-label="' + escHtml(STR.ariaDragHandle) + '" title="' + escHtml(STR.ariaDragHandle) + '">≡</div>'
                    + '    <div class="track-color-swatch" data-action="pick-color" data-track-index="' + i + '" style="background:' + trackColor(i) + '" role="button" tabindex="0" aria-label="' + escHtml(STR.ariaPickColor) + '" title="' + escHtml(STR.trackPickColor) + '"></div>'
                    + '    <div class="track-name" title="' + escHtml(result.filePath) + '">' + escHtml(result.fileName) + '</div>'
                    + (result.channels && result.channels[0] && result.channels[0].peakAbsolute >= 0.99 ? '    <span class="clip-badge" title="' + escHtml(STR.clipBadgeTitle) + '">CLIP</span>' : '')
                    + '  </div>'
```

- [ ] **Step 2: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: add drag handle and color swatch to track row header"
```

---

## Task 8: 描画ループの色参照を trackColor() に統一

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: renderStackedTracks を displayOrder 経由に変更**

以下を置換：

```javascript
            function renderStackedTracks() {
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden) { return; }
                    if (soloTrackIndex !== null && soloTrackIndex !== i) { return; }
```

↓

```javascript
            function renderStackedTracks() {
                displayOrder.forEach(function(i) {
                    const result = state.results[i];
                    if (trackRuntime[i].hidden) { return; }
                    if (soloTrackIndex !== null && soloTrackIndex !== i) { return; }
```

- [ ] **Step 2: renderStackedTracks 内の color 参照を置換**

```javascript
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
```

↓

```javascript
                    const color = trackColor(i);
```

- [ ] **Step 3: renderTrackSpectra の color 参照を置換**

```javascript
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    drawSpectrumAxes(ctx, W, H, slice, 32, 6, 4, 14);
                    drawSpectrumLine(ctx, W, H, slice, color, { padL: 32, padR: 6, padT: 4, padB: 14 });
```

↓

```javascript
                    const color = trackColor(i);
                    drawSpectrumAxes(ctx, W, H, slice, 32, 6, 4, 14);
                    drawSpectrumLine(ctx, W, H, slice, color, { padL: 32, padR: 6, padT: 4, padB: 14 });
```

- [ ] **Step 4: renderOverlaySpectrum を displayOrder 経由に変更**

以下を置換：

```javascript
                const slices = [];
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden) { return; }
                    if (soloTrackIndex !== null && soloTrackIndex !== i) { return; }
                    const slice = extractSpectrumAtCursor(result, trackRuntime[i].offsetSeconds, cursorNorm);
                    if (slice) { slices.push({ slice: slice, color: TRACK_COLORS[i % TRACK_COLORS.length], index: i, name: result.fileName }); }
                });
```

↓

```javascript
                const slices = [];
                displayOrder.forEach(function(i) {
                    const result = state.results[i];
                    if (trackRuntime[i].hidden) { return; }
                    if (soloTrackIndex !== null && soloTrackIndex !== i) { return; }
                    const slice = extractSpectrumAtCursor(result, trackRuntime[i].offsetSeconds, cursorNorm);
                    if (slice) { slices.push({ slice: slice, color: trackColor(i), index: i, name: result.fileName }); }
                });
```

- [ ] **Step 5: コンパイル + テスト**

```bash
npm run compile 2>&1 | tail -5
npm run verify 2>&1 | tail -10
```

Expected: verify OK（全テストパス）

- [ ] **Step 6: コミット**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: rendering loops use displayOrder and trackColor()"
```

---

## Task 9: カラーピッカーポップオーバーと色変更ハンドラを実装

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: `__buildColorPopover()` IIFE と open/close 関数を追加**

`comparisonRenderScript.ts` の `__updateSpecGearVisibility();` の直前（`__updateSpecGearVisibility();` の1行前）に以下を追加：

```javascript
            // ── Color picker popover ──
            var __colorPickTarget = null;

            function openColorPicker(stateIdx, anchorEl) {
                __colorPickTarget = stateIdx;
                var pop = document.getElementById('color-picker-popover');
                if (!pop) { return; }
                var rect = anchorEl.getBoundingClientRect();
                pop.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
                pop.style.left = (rect.left  + window.scrollX) + 'px';
                pop.removeAttribute('hidden');
            }

            function closeColorPicker() {
                var pop = document.getElementById('color-picker-popover');
                if (pop) { pop.setAttribute('hidden', ''); }
                __colorPickTarget = null;
            }

            (function __buildColorPopover() {
                var COLOR_PALETTE = [
                    '#4ec994','#ff8c4a','#4a9eff','#e8637a','#c084fc',
                    '#f0c040','#40b0d0','#d09060','#80c080','#a0a0ff'
                ];
                var swatches = COLOR_PALETTE.map(function(hex) {
                    return '<div class="color-palette-swatch" data-color="' + hex + '"'
                         + ' style="background:' + hex + '" role="button" tabindex="0"'
                         + ' aria-label="' + hex + '"></div>';
                }).join('');
                var html = '<div id="color-picker-popover" hidden'
                    + ' style="position:fixed;z-index:9999;background:var(--panel);'
                    + 'border:1px solid var(--line);padding:8px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.4);">'
                    + '<div style="display:flex;flex-wrap:wrap;gap:4px;width:148px">' + swatches + '</div>'
                    + '<button id="color-reset-btn" style="margin-top:6px;width:100%;font-size:11px;'
                    + 'background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:2px;cursor:pointer;padding:2px 0">'
                    + escHtml(STR.trackColorReset) + '</button>'
                    + '</div>';
                var container = document.createElement('div');
                container.innerHTML = html;
                document.body.appendChild(container.firstChild);

                var pop = document.getElementById('color-picker-popover');
                pop.addEventListener('click', function(e) {
                    var sw = e.target.closest ? e.target.closest('.color-palette-swatch') : null;
                    if (sw && __colorPickTarget !== null) {
                        var hex = sw.getAttribute('data-color');
                        trackRuntime[__colorPickTarget].color = hex;
                        var hs = document.querySelector('[data-action="pick-color"][data-track-index="' + __colorPickTarget + '"]');
                        if (hs) { hs.style.background = hex; }
                        var ms = document.getElementById('metrics-swatch-' + __colorPickTarget);
                        if (ms) { ms.style.background = hex; }
                        scheduleRender();
                        refreshSpectrumViews();
                        closeColorPicker();
                        return;
                    }
                    if (e.target.id === 'color-reset-btn' && __colorPickTarget !== null) {
                        trackRuntime[__colorPickTarget].color = null;
                        var def = trackColor(__colorPickTarget);
                        var hs2 = document.querySelector('[data-action="pick-color"][data-track-index="' + __colorPickTarget + '"]');
                        if (hs2) { hs2.style.background = def; }
                        var ms2 = document.getElementById('metrics-swatch-' + __colorPickTarget);
                        if (ms2) { ms2.style.background = def; }
                        scheduleRender();
                        refreshSpectrumViews();
                        closeColorPicker();
                    }
                });

                document.addEventListener('click', function(e) {
                    var pop2 = document.getElementById('color-picker-popover');
                    if (!pop2 || pop2.hasAttribute('hidden')) { return; }
                    var clickedSwatch = e.target.closest ? e.target.closest('[data-action="pick-color"]') : null;
                    if (pop2.contains(e.target) || clickedSwatch) { return; }
                    closeColorPicker();
                }, true);
            })();
```

- [ ] **Step 2: tracks-wrapper の click ハンドラに pick-color を追加**

以下の tracks-wrapper click ハンドラを置換：

```javascript
                document.getElementById('tracks-wrapper').addEventListener('click', function(e) {
                    const action = e.target.getAttribute('data-action');
                    const idx = parseInt(e.target.getAttribute('data-track-index'), 10);
                    if (action === 'toggle-mute' && !isNaN(idx)) { toggleMute(idx); }
                    if (action === 'toggle-solo' && !isNaN(idx)) { toggleSolo(idx); }
                    if (action === 'toggle-playback' && !isNaN(idx)) { togglePlayback(idx); }
                    if (action === 'stop-playback' && !isNaN(idx)) { stopPlayback(idx); }
                    if (action === 'remove-track' && !isNaN(idx)) { removeTrack(idx); }
                    if (action === 'offset-up' && !isNaN(idx)) { adjustOffset(idx, 0.01); }
                    if (action === 'offset-down' && !isNaN(idx)) { adjustOffset(idx, -0.01); }
                });
```

↓

```javascript
                document.getElementById('tracks-wrapper').addEventListener('click', function(e) {
                    const tgt = e.target;
                    const action = tgt.getAttribute ? tgt.getAttribute('data-action') : null;
                    const idx = parseInt(tgt.getAttribute ? tgt.getAttribute('data-track-index') : 'NaN', 10);
                    if (action === 'toggle-mute' && !isNaN(idx)) { toggleMute(idx); }
                    if (action === 'toggle-solo' && !isNaN(idx)) { toggleSolo(idx); }
                    if (action === 'toggle-playback' && !isNaN(idx)) { togglePlayback(idx); }
                    if (action === 'stop-playback' && !isNaN(idx)) { stopPlayback(idx); }
                    if (action === 'remove-track' && !isNaN(idx)) { removeTrack(idx); }
                    if (action === 'offset-up' && !isNaN(idx)) { adjustOffset(idx, 0.01); }
                    if (action === 'offset-down' && !isNaN(idx)) { adjustOffset(idx, -0.01); }
                    if (action === 'pick-color' && !isNaN(idx)) {
                        var anchor = tgt.closest ? tgt.closest('[data-action="pick-color"]') : tgt;
                        openColorPicker(idx, anchor);
                    }
                });
```

- [ ] **Step 3: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: color picker popover with 10-color palette and reset"
```

---

## Task 10: ドラッグ＆ドロップ並び替えを実装

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: reorderTracks 関数と reorderDragFrom 変数を追加**

`__buildColorPopover` IIFE の直前に以下を追加：

```javascript
            // ── Track drag reorder ──
            var reorderDragFrom = null;

            function reorderTracks(fromStateIdx, toStateIdx) {
                var fromPos = displayOrder.indexOf(fromStateIdx);
                var toPos   = displayOrder.indexOf(toStateIdx);
                if (fromPos === -1 || toPos === -1) { return; }
                displayOrder.splice(fromPos, 1);
                displayOrder.splice(toPos, 0, fromStateIdx);
                var wrap = document.getElementById('stacked-wrap');
                if (wrap) {
                    displayOrder.forEach(function(idx) {
                        var row = document.getElementById('track-row-' + idx);
                        if (row) { wrap.appendChild(row); }
                    });
                }
                var metricsBar = document.getElementById('metrics-bar');
                if (metricsBar) {
                    displayOrder.forEach(function(idx) {
                        var item = document.getElementById('metrics-item-' + idx);
                        if (item) { metricsBar.appendChild(item); }
                    });
                }
                scheduleRender();
                refreshSpectrumViews();
            }

            function cleanupReorderDrag() {
                if (reorderDragFrom !== null) {
                    var row = document.getElementById('track-row-' + reorderDragFrom);
                    if (row) { row.style.opacity = ''; }
                }
                document.querySelectorAll('.track-row').forEach(function(r) {
                    r.classList.remove('drag-over');
                });
                reorderDragFrom = null;
            }
```

- [ ] **Step 2: attachEvents() にドラッグイベントを追加**

`attachEvents()` 内の `window.addEventListener('resize', ...)` の直前に追加：

```javascript
                var stackedWrap = document.getElementById('stacked-wrap');
                if (stackedWrap) {
                    stackedWrap.addEventListener('dragstart', function(e) {
                        var handle = e.target.closest ? e.target.closest('.track-drag-handle') : null;
                        if (!handle) { e.preventDefault(); return; }
                        reorderDragFrom = parseInt(handle.getAttribute('data-track-index'), 10);
                        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; }
                        var row = document.getElementById('track-row-' + reorderDragFrom);
                        if (row) { row.style.opacity = '0.4'; }
                    });

                    stackedWrap.addEventListener('dragover', function(e) {
                        if (reorderDragFrom === null) { return; }
                        e.preventDefault();
                        if (e.dataTransfer) { e.dataTransfer.dropEffect = 'move'; }
                        var row = e.target.closest ? e.target.closest('.track-row') : null;
                        document.querySelectorAll('.track-row').forEach(function(r) { r.classList.remove('drag-over'); });
                        if (row) {
                            var toIdx = parseInt(row.getAttribute('data-track-index'), 10);
                            if (!isNaN(toIdx) && toIdx !== reorderDragFrom) { row.classList.add('drag-over'); }
                        }
                    });

                    stackedWrap.addEventListener('drop', function(e) {
                        if (reorderDragFrom === null) { return; }
                        e.preventDefault();
                        var row = e.target.closest ? e.target.closest('.track-row') : null;
                        if (row) {
                            var toIdx = parseInt(row.getAttribute('data-track-index'), 10);
                            if (!isNaN(toIdx) && toIdx !== reorderDragFrom) {
                                reorderTracks(reorderDragFrom, toIdx);
                            }
                        }
                        cleanupReorderDrag();
                    });

                    stackedWrap.addEventListener('dragend', function() {
                        cleanupReorderDrag();
                    });
                }
```

- [ ] **Step 3: コンパイル + verify**

```bash
npm run verify 2>&1 | tail -10
```

Expected: verify OK

- [ ] **Step 4: コミット**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: drag-and-drop track reorder with displayOrder"
```

---

## Task 11: analysis-update 時に displayOrder をリセット

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: analysis-update ハンドラを置換**

以下を置換：

```javascript
                if (msg.type === 'analysis-update' && Array.isArray(msg.results)) {
                    __setReanalyzeBusy(false);
                    state.results = msg.results.map(function(r, i) {
                        const old = state.results[i];
                        return Object.assign({}, r, { audioSource: old ? old.audioSource : '' });
                    });
                    scheduleRender();
                    refreshSpectrumViews();
                    requestAnimationFrame(function() { publishTestSnapshot(); });
                    return;
                }
```

↓

```javascript
                if (msg.type === 'analysis-update' && Array.isArray(msg.results)) {
                    __setReanalyzeBusy(false);
                    state.results = msg.results.map(function(r, i) {
                        const old = state.results[i];
                        return Object.assign({}, r, { audioSource: old ? old.audioSource : '' });
                    });
                    displayOrder = state.results.map(function(_, i) { return i; });
                    scheduleRender();
                    refreshSpectrumViews();
                    requestAnimationFrame(function() { publishTestSnapshot(); });
                    return;
                }
```

- [ ] **Step 2: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: reset displayOrder on analysis-update"
```

---

## Task 12: publishTestSnapshot と E2E スナップショットを更新

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`
- Modify: `src/e2e/suite/index.ts`

- [ ] **Step 1: publishTestSnapshot に displayOrder を追加**

`publishTestSnapshot` の `renderedUi` オブジェクト内の `tracks: trackInfo,` の直前に追加：

以下を置換：

```javascript
                        tracks: trackInfo,
                    },
                });
            }
```

↓

```javascript
                        displayOrder: displayOrder.slice(),
                        tracks: trackInfo,
                    },
                });
            }
```

- [ ] **Step 2: E2E スナップショットに displayOrder アサーションを追加**

`src/e2e/suite/index.ts` の `assert.deepEqual(snapshot.renderedUi.toolbarActions, [` ブロックの直後（`});` の後）に追加：

```typescript
                assert.deepEqual(
                    snapshot.renderedUi.displayOrder,
                    snapshot.renderedUi.tracks.map((_: unknown, i: number) => i),
                    'Initial displayOrder should be [0, 1, ..., N-1]'
                );
```

- [ ] **Step 3: コンパイル + verify**

```bash
npm run verify 2>&1 | tail -15
```

Expected: verify OK

- [ ] **Step 4: コミット**

```bash
git add src/webview/comparisonRenderScript.ts src/e2e/suite/index.ts
git commit -m "test: add displayOrder to publishTestSnapshot and E2E assertion"
```

---

## Task 13: 最終確認・PR 作成

**Files:**
- None (verification and PR)

- [ ] **Step 1: フルビルド確認**

```bash
npm run verify 2>&1 | tail -15
```

Expected:
```
# tests 207
# pass 207
# fail 0
...
44 passed in ...
verify: OK
```

- [ ] **Step 2: ブランチをプッシュして PR 作成**

```bash
git push -u origin feat-track-color-sort
gh pr create \
  --title "feat: トラック色設定とドラッグ並び替え ([28])" \
  --body "## 概要
- トラックヘッダーにカラースウォッチを追加。クリックで10色パレットポップオーバーが開き、波形・スペクトラム・メトリクスバーの色を即座に変更できる。
- 各トラック行のドラッグハンドル（≡）で表示順を並び替え可能。\`displayOrder[]\`配列で表示順を管理し、DOM IDはstate.results添え字で固定。
- 再解析時はdisplayOrderをリセット。

## 変更ファイル
- \`src/webview/comparisonRenderScript.ts\` — メイン実装
- \`src/webview/panels/ComparisonPanel.ts\` — CSS追加
- \`src/shared/i18n/strings.ts\` — 4キー追加 (EN/JA)
- \`src/e2e/suite/index.ts\` — displayOrderスナップショット追加
- \`src/test/trackOrder.test.ts\` — 純粋関数ユニットテスト (7件)

## テスト
- \`npm run verify\` パス

Closes #32

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
  --base main
```

Expected: PR URL が表示される
