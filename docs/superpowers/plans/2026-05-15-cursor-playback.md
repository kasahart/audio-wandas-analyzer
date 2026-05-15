# カーソルと再生機能 再設計 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** グローバルカーソルモデル・A/B再生引き継ぎ・ループ区間選択・キーボードナッジを実装して信号処理専門家の複数トラック比較ワークフローを改善する

**Architecture:** `ComparisonPanel.ts` の `renderScript()` 内インライン JS を中心に変更する。`cursorNorm` を常に `number` 型にし `playbackStartNorm` でA/B引き継ぎ位置を管理する。ドラッグを Shift キーで分岐させデフォルトをループ区間選択に割り当てる。ループ区間描画は `waveformRenderer.ts` に `paintLoopRegion()` として追加（unit test 可能）し、Webview では同等の `drawLoopRegionOnCanvas()` を renderScript 内に定義する。

**Tech Stack:** TypeScript, Webview inline JS（renderScript テンプレート文字列）, Canvas 2D API, node:test

---

## ファイル構造

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `src/panels/ComparisonPanel.ts` | Modify | renderScript() 内 state 変数・マウスハンドラー・再生関数・描画関数・HTML/CSS |
| `src/panels/waveformRenderer.ts` | Modify | `CanvasCtx` インターフェース拡張、`paintLoopRegion()` 追加 |
| `media/comparisonWaveform.js` | Modify | `paintLoopRegion()` 追加（waveformRenderer.ts と同じアルゴリズム） |
| `src/test/waveformRenderer.test.ts` | Modify | `paintLoopRegion()` のユニットテスト追加 |
| `src/test/renderScript.integration.test.ts` | Modify | cursorNorm 初期値チェックの統合テスト追加 |

---

### Task 1: cursorNorm null 廃止・hoverNorm 追加・playbackStartNorm 追加（基盤）

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (renderScript 内)
- Modify: `src/test/renderScript.integration.test.ts`

後続タスクの全基盤。`cursorNorm` を常に `number` 型にし、ホバープレビュー用に `hoverNorm`、再生引き継ぎ用に `playbackStartNorm` を追加する。

- [ ] **Step 1: 統合テストに cursorNorm 初期値チェックを追加**

`src/test/renderScript.integration.test.ts` の末尾に追加する（既存テストを壊さない）。

```typescript
test('renderScript: cursorNorm initializes as number (not null)', async () => {
    // cursorNorm が null ではなく 0 で初期化されることを、
    // canvas-tooltip 要素の存在で間接的に確認（後続タスクで追加される）。
    // 現時点ではスクリプトがエラーなく実行されることを確認する。
    // loadWebviewScript() は既存のヘルパー関数を使用すること。
    const { window } = await loadWebviewScript();
    assert.ok(window.document.body !== null);
});
```

- [ ] **Step 2: テストが通ること（現状でも pass）を確認**

```bash
npm run compile && node --test dist/test/renderScript.integration.test.js
```

Expected: PASS（既存テスト含む）

- [ ] **Step 3: renderScript 内の変数定義を変更**

`src/panels/ComparisonPanel.ts` の `renderScript()` メソッド内、`let cursorNorm = null;` の行を変更する。

```diff
- let cursorNorm = null;        // null = free, number = fixed
+ let cursorNorm = 0;           // グローバルカーソル（常に number）
+ let hoverNorm = null;         // ホバープレビュー位置（null = 非表示）
+ let playbackStartNorm = 0;    // 再生開始位置の記憶
  let dragState = null;
```

- [ ] **Step 4: drawCursorOnCanvas の null チェックを削除**

```diff
  function drawCursorOnCanvas(ctx, W, H) {
-     if (cursorNorm === null) { return; }
      const x = (cursorNorm - zoomStart) / (zoomEnd - zoomStart) * W;
```

- [ ] **Step 5: drawHoverLineOnCanvas 関数を drawCursorOnCanvas の直後に追加**

```javascript
function drawHoverLineOnCanvas(ctx, W, H) {
    if (hoverNorm === null) { return; }
    const x = (hoverNorm - zoomStart) / (zoomEnd - zoomStart) * W;
    if (x < 0 || x > W) { return; }
    ctx.save();
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.restore();
}
```

- [ ] **Step 6: drawTrackWaveform と drawSpectrogram 内でホバーラインを追加**

両関数で `drawCursorOnCanvas(ctx, W, H);` の直後に追加する。

```diff
  drawCursorOnCanvas(ctx, W, H);
+ drawHoverLineOnCanvas(ctx, W, H);
```

- [ ] **Step 7: renderWithCursorAt を renderWithHoverAt と clearHover に置き換え**

既存の `renderWithCursorAt` 関数を削除して以下に置き換える。

```javascript
function renderWithHoverAt(norm) {
    hoverNorm = norm;
    scheduleRender();
    updateCursorDisplay(norm);
}

function clearHover() {
    if (hoverNorm === null) { return; }
    hoverNorm = null;
    scheduleRender();
    updateCursorDisplay(cursorNorm);
}
```

- [ ] **Step 8: handleCanvasMouseMove 内の renderWithCursorAt 呼び出しを変更**

```diff
- renderWithCursorAt(norm);
+ renderWithHoverAt(norm);
```

- [ ] **Step 9: mouseleave イベントを各キャンバスに登録**

キャンバスへのイベント登録箇所（`canvas.addEventListener('mousedown', ...)` の近く）に追加する。

```javascript
canvas.addEventListener('mouseleave', clearHover);
```

オーバーレイキャンバスにも同様に追加する。

- [ ] **Step 10: renderOverlay 内の cursorNorm !== null ガードを削除**

`renderOverlay` 内で `if (cursorNorm !== null) {` を探し、ガードを除去して常にカーソルを描画する。

- [ ] **Step 11: コンパイルしてテストが全通ることを確認**

```bash
npm run compile && npm test
```

Expected: 全テスト PASS

- [ ] **Step 12: コミット**

```bash
git add src/panels/ComparisonPanel.ts src/test/renderScript.integration.test.ts
git commit -m "refactor: remove cursorNorm null state, add hoverNorm and playbackStartNorm"
```

---

### Task 2: 再生引き継ぎ（UC-1）— togglePlayback と stopPlayback の変更

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (renderScript 内の togglePlayback, stopPlayback)

トラック A を再生中にトラック B の ▶ を押すと、カーソルが A の再生開始位置に戻り B がそこから始まる。

- [ ] **Step 1: togglePlayback 内のトラック切り替えブロックを変更**

`if (playbackTrackIndex !== null && playbackTrackIndex !== idx) {` のブロックを変更する。

```diff
  if (playbackTrackIndex !== null && playbackTrackIndex !== idx) {
+     // 再生開始位置にカーソルを戻してからトラックを切り替え
+     cursorNorm = playbackStartNorm;
+     updateCursorDisplay(cursorNorm);
      stopPlayback(playbackTrackIndex, { keepCursor: true });
  }
```

- [ ] **Step 2: 再生開始時に playbackStartNorm を記録**

`try { audio.currentTime = startTime; } catch (_err) { }` の直後に追加する。

```diff
  try { audio.currentTime = startTime; } catch (_err) { }
+ playbackStartNorm = cursorNorm;
```

- [ ] **Step 3: togglePlayback 内の cursorNorm null チェックを除去**

```diff
- let startTime = trackTimeFromGlobalNorm(idx, cursorNorm !== null ? cursorNorm : trackStartNorm(idx));
+ let startTime = trackTimeFromGlobalNorm(idx, cursorNorm);
```

- [ ] **Step 4: stopPlayback のカーソルリセット先を playbackStartNorm に変更**

```diff
  if (idx === playbackTrackIndex) {
      if (!options || options.keepCursor !== true) {
-         cursorNorm = idx === null || idx === undefined ? null : trackStartNorm(idx);
-         if (cursorNorm !== null) { updateCursorDisplay(cursorNorm); }
+         cursorNorm = playbackStartNorm;
+         updateCursorDisplay(cursorNorm);
      }
      clearPlaybackState();
```

- [ ] **Step 5: コンパイルしてテストが全通ることを確認**

```bash
npm run compile && npm test
```

- [ ] **Step 6: コミット**

```bash
git add src/panels/ComparisonPanel.ts
git commit -m "feat(uc1): implement A/B playback handoff via playbackStartNorm"
```

---

### Task 3: ドラッグ判定変更・loopRegion 状態追加（UC-4）

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (renderScript 内のイベントハンドラー)

素のドラッグ → ループ区間設定、Shift+ドラッグ → トラックオフセット調整（従来の動作）。クリック → カーソル移動 + ループ区間解除。

- [ ] **Step 1: loopRegion 状態変数と dragState 型コメントを追加**

`dragState` の定義行を更新する。

```diff
- let dragState = null;         // { trackIndex, startClientX, startOffset, canvasWidth, isDrag }
+ let dragState = null;         // { trackIndex, startClientX, startOffset, canvasWidth, isDrag, isShift, startNorm, dragType }
+ let loopRegion = null;        // null or { start: number, end: number }（正規化グローバル時間）
```

- [ ] **Step 2: getGripType ヘルパー関数を handleCanvasMouseDown の直前に追加**

```javascript
function getGripType(norm) {
    if (!loopRegion) { return null; }
    const GRIP_THRESH = (zoomEnd - zoomStart) * 0.015;
    if (Math.abs(norm - loopRegion.start) < GRIP_THRESH) { return 'gripStart'; }
    if (Math.abs(norm - loopRegion.end) < GRIP_THRESH) { return 'gripEnd'; }
    return null;
}
```

- [ ] **Step 3: handleCanvasMouseDown を置き換え**

```javascript
function handleCanvasMouseDown(e) {
    const canvas = e.target;
    if (!canvas.classList.contains('track-canvas')) { return; }
    const idx = parseInt(canvas.getAttribute('data-track-index'), 10);
    if (isNaN(idx)) { return; }
    if (e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
        const gripType = getGripType(norm);
        dragState = {
            trackIndex: idx,
            startClientX: e.clientX,
            startOffset: trackRuntime[idx].offsetSeconds,
            canvasWidth: canvas.width,
            isDrag: false,
            isShift: e.shiftKey,
            startNorm: norm,
            dragType: gripType || (e.shiftKey ? 'offset' : 'loop'),
        };
        canvas.focus();
    }
}
```

- [ ] **Step 4: handleDocMouseMove を置き換え**

```javascript
function handleDocMouseMove(e) {
    if (!dragState) { return; }
    const dx = e.clientX - dragState.startClientX;
    if (Math.abs(dx) > 3) { dragState.isDrag = true; }
    if (!dragState.isDrag) { return; }

    if (dragState.dragType === 'offset') {
        const gs = computeGlobalSpan();
        const secsPerPx = (zoomEnd - zoomStart) * gs.spanSec / dragState.canvasWidth;
        trackRuntime[dragState.trackIndex].offsetSeconds = dragState.startOffset + dx * secsPerPx;
        updateOffsetDisplays();
    } else if (dragState.dragType === 'loop') {
        const canvasEl = document.getElementById('track-canvas-' + dragState.trackIndex);
        if (!canvasEl) { scheduleRender(); return; }
        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const norm = Math.max(0, Math.min(1, zoomStart + (x / dragState.canvasWidth) * (zoomEnd - zoomStart)));
        const s = Math.min(dragState.startNorm, norm);
        const end = Math.max(dragState.startNorm, norm);
        if (end > s) { loopRegion = { start: s, end: end }; }
    } else if (dragState.dragType === 'gripStart') {
        const canvasEl = document.getElementById('track-canvas-' + dragState.trackIndex);
        if (!canvasEl || !loopRegion) { scheduleRender(); return; }
        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const norm = Math.max(0, Math.min(loopRegion.end - 0.001, zoomStart + (x / dragState.canvasWidth) * (zoomEnd - zoomStart)));
        loopRegion = { start: norm, end: loopRegion.end };
    } else if (dragState.dragType === 'gripEnd') {
        const canvasEl = document.getElementById('track-canvas-' + dragState.trackIndex);
        if (!canvasEl || !loopRegion) { scheduleRender(); return; }
        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const norm = Math.max(loopRegion.start + 0.001, Math.min(1, zoomStart + (x / dragState.canvasWidth) * (zoomEnd - zoomStart)));
        loopRegion = { start: loopRegion.start, end: norm };
    }
    scheduleRender();
}
```

- [ ] **Step 5: handleDocMouseUp を置き換え**

```javascript
function handleDocMouseUp(e) {
    if (dragState && !dragState.isDrag) {
        // クリック（ドラッグなし）: カーソル移動 + ループ区間解除
        const canvasId = viewMode === 'overlay' ? 'overlay-canvas' : 'track-canvas-' + dragState.trackIndex;
        const canvas = document.getElementById(canvasId);
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
            cursorNorm = Math.max(0, Math.min(1, norm));
            loopRegion = null;
            updateCursorDisplay(cursorNorm);
            scheduleRender();
        }
    }
    dragState = null;
}
```

- [ ] **Step 6: handleOverlayClick も同様に更新**

```diff
  function handleOverlayClick(e) {
      const rect = overlayCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const norm = zoomStart + (x / overlayCanvas.width) * (zoomEnd - zoomStart);
-     cursorNorm = (cursorNorm !== null) ? null : norm;
+     cursorNorm = Math.max(0, Math.min(1, norm));
+     loopRegion = null;
+     updateCursorDisplay(cursorNorm);
      scheduleRender();
  }
```

- [ ] **Step 7: コンパイルしてテストが全通ることを確認**

```bash
npm run compile && npm test
```

- [ ] **Step 8: コミット**

```bash
git add src/panels/ComparisonPanel.ts
git commit -m "feat(uc4): add loopRegion state and remap drag to loop-select / Shift+offset"
```

---

### Task 4: paintLoopRegion を waveformRenderer.ts に追加（ユニットテスト）

**Files:**
- Modify: `src/panels/waveformRenderer.ts`
- Modify: `src/test/waveformRenderer.test.ts`

テスト可能な純粋関数として `paintLoopRegion` を実装する。

- [ ] **Step 1: paintLoopRegion 専用インターフェースを追加**

既存の `CanvasCtx` を変更すると既存テストのモックオブジェクトに TypeScript エラーが出るため、新しいインターフェースを追加する。`src/panels/waveformRenderer.ts` の `CanvasCtx` 定義の**直後**に追加する。

```typescript
export interface LoopRegionCtx {
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    globalAlpha: number;
    save(): void;
    restore(): void;
    setLineDash(segments: number[]): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
    stroke(): void;
    fill(): void;
}
```

- [ ] **Step 2: paintLoopRegion のユニットテストを先に書く**

`src/test/waveformRenderer.test.ts` の import 行と末尾に追加する。

import 行に `paintLoopRegion` を追加：

```diff
  import {
      xOfNorm, buildBucketPoints, computeAnchorX,
      makeCoordTransform, computeViewRange, decimateBuckets, paintDecimatedPoints,
+     paintLoopRegion,
  } from '../panels/waveformRenderer';
```

テスト末尾に追加：

```typescript
// ── paintLoopRegion ───────────────────────────────────────────

function makePaintCtx() {
    const fillRects: Array<{ x: number; y: number; w: number; h: number }> = [];
    const ctx = {
        lineWidth: 0,
        strokeStyle: '',
        fillStyle: '',
        globalAlpha: 1,
        savedCount: 0,
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        stroke() {},
        fill() {},
        fillRect(x: number, y: number, w: number, h: number) { fillRects.push({ x, y, w, h }); },
        save() { this.savedCount++; },
        restore() { this.savedCount--; },
        setLineDash() {},
        _fillRects: fillRects,
    };
    return ctx;
}

test('paintLoopRegion: 3つの fillRect を描画する（左暗・中青・右暗）', () => {
    const ctx = makePaintCtx();
    paintLoopRegion(ctx, 800, 100, 0.2, 0.6, 0, 1);
    assert.equal(ctx._fillRects.length, 3);
    // 左暗: x=0 から始まる
    assert.equal(ctx._fillRects[0].x, 0);
    // 右暗: W で終わる
    assert.equal(ctx._fillRects[1].x + ctx._fillRects[1].w, 800);
    // 中央: 左と右の間
    assert.ok(ctx._fillRects[2].x > 0);
    assert.ok(ctx._fillRects[2].x < ctx._fillRects[1].x);
});

test('paintLoopRegion: start >= end のとき何も描画しない', () => {
    const ctx = makePaintCtx();
    paintLoopRegion(ctx, 800, 100, 0.6, 0.2, 0, 1);
    assert.equal(ctx._fillRects.length, 0);
});

test('paintLoopRegion: ズーム範囲外のループは left >= right になり何も描画しない', () => {
    const ctx = makePaintCtx();
    // ループ区間 [0.8, 0.9]、ズーム [0, 0.5] → 全部画面外
    paintLoopRegion(ctx, 800, 100, 0.8, 0.9, 0, 0.5);
    assert.equal(ctx._fillRects.length, 0);
});

test('paintLoopRegion: save/restore がペアで呼ばれる', () => {
    const ctx = makePaintCtx();
    paintLoopRegion(ctx, 800, 100, 0.2, 0.6, 0, 1);
    assert.equal(ctx.savedCount, 0); // save と restore がペア
});
```

- [ ] **Step 3: テストが失敗することを確認**

```bash
npm run compile && node --test dist/test/waveformRenderer.test.js 2>&1 | grep -E 'FAIL|Error|paintLoopRegion'
```

Expected: `paintLoopRegion is not a function` または import エラー

- [ ] **Step 4: paintLoopRegion を waveformRenderer.ts の末尾に実装**

```typescript
export function paintLoopRegion(
    ctx: LoopRegionCtx,
    W: number,
    H: number,
    loopStart: number,
    loopEnd: number,
    zoomStart: number,
    zoomEnd: number,
): void {
    const span = zoomEnd - zoomStart;
    if (span <= 0) { return; }
    const toX = (norm: number) => (norm - zoomStart) / span * W;
    const x0 = toX(loopStart);
    const x1 = toX(loopEnd);
    const left = Math.max(0, Math.min(x0, x1));
    const right = Math.min(W, Math.max(x0, x1));
    if (right <= left) { return; }

    ctx.save();
    ctx.setLineDash([]);

    // 区間外を暗く
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, left, H);
    ctx.fillRect(right, 0, W - right, H);

    // 区間内を青くハイライト
    ctx.fillStyle = 'rgba(100, 160, 255, 0.15)';
    ctx.fillRect(left, 0, right - left, H);

    // グリップハンドル（縦線）
    ctx.strokeStyle = 'rgba(100, 160, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(left, H);
    ctx.moveTo(right, 0);
    ctx.lineTo(right, H);
    ctx.stroke();

    // 三角マーカー
    const TH = 8;
    ctx.fillStyle = 'rgba(100, 160, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(left + TH, 0);
    ctx.lineTo(left, TH);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(right, 0);
    ctx.lineTo(right - TH, 0);
    ctx.lineTo(right, TH);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}
```

- [ ] **Step 5: テストが全通ることを確認**

```bash
npm run compile && node --test dist/test/waveformRenderer.test.js
```

Expected: 全テスト PASS

- [ ] **Step 6: コミット**

```bash
git add src/panels/waveformRenderer.ts src/test/waveformRenderer.test.ts
git commit -m "feat: add paintLoopRegion to waveformRenderer with unit tests"
```

---

### Task 5: ループ区間描画を Webview に統合

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (renderScript 内)
- Modify: `media/comparisonWaveform.js`

- [ ] **Step 1: media/comparisonWaveform.js に paintLoopRegion を追加**

ファイル末尾の `window.renderWaveformPipeline = renderWaveformPipeline;` の**前**に追加する。

```javascript
function paintLoopRegion(ctx, W, H, loopStart, loopEnd, zoomStart, zoomEnd) {
    const span = zoomEnd - zoomStart;
    if (span <= 0) { return; }
    const toX = function(norm) { return (norm - zoomStart) / span * W; };
    const x0 = toX(loopStart);
    const x1 = toX(loopEnd);
    const left = Math.max(0, Math.min(x0, x1));
    const right = Math.min(W, Math.max(x0, x1));
    if (right <= left) { return; }
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, left, H);
    ctx.fillRect(right, 0, W - right, H);
    ctx.fillStyle = 'rgba(100, 160, 255, 0.15)';
    ctx.fillRect(left, 0, right - left, H);
    ctx.strokeStyle = 'rgba(100, 160, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, 0); ctx.lineTo(left, H);
    ctx.moveTo(right, 0); ctx.lineTo(right, H);
    ctx.stroke();
    const TH = 8;
    ctx.fillStyle = 'rgba(100, 160, 255, 0.9)';
    ctx.beginPath(); ctx.moveTo(left, 0); ctx.lineTo(left + TH, 0); ctx.lineTo(left, TH); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(right, 0); ctx.lineTo(right - TH, 0); ctx.lineTo(right, TH); ctx.closePath(); ctx.fill();
    ctx.restore();
}
window.paintLoopRegion = paintLoopRegion;
```

- [ ] **Step 2: renderScript 内に drawLoopRegionOnCanvas 関数を追加**

`drawHoverLineOnCanvas` の直後に追加する。

```javascript
function drawLoopRegionOnCanvas(ctx, W, H) {
    if (!loopRegion) { return; }
    if (typeof window.paintLoopRegion === 'function') {
        window.paintLoopRegion(ctx, W, H, loopRegion.start, loopRegion.end, zoomStart, zoomEnd);
    }
}
```

- [ ] **Step 3: drawTrackWaveform 内でループ区間をカーソルより前に描画**

`drawCursorOnCanvas(ctx, W, H);` の呼び出しの**直前**に挿入する（Layer 4 をカーソルの下に置く）。

```diff
+ drawLoopRegionOnCanvas(ctx, W, H);
  drawCursorOnCanvas(ctx, W, H);
  drawHoverLineOnCanvas(ctx, W, H);
```

- [ ] **Step 4: drawSpectrogram 内でも同様に追加**

```diff
+ drawLoopRegionOnCanvas(ctx, W, H);
  drawCursorOnCanvas(ctx, W, H);
  drawHoverLineOnCanvas(ctx, W, H);
```

- [ ] **Step 5: renderOverlay 内でも追加**

```diff
+ drawLoopRegionOnCanvas(ctx, W, H);
  drawCursorOnCanvas(ctx, W, H);
  drawHoverLineOnCanvas(ctx, W, H);
```

- [ ] **Step 6: ループ再生中バッジ用の HTML を getWebviewContent() に追加**

ツールバー内の `#cursor-display` 要素の近くに追加する。

```html
<span id="loop-badge" style="display:none; color:#64a0ff; font-size:0.85em; margin-left:8px;">🔁 ループ再生中</span>
```

- [ ] **Step 7: コンパイルしてテストが全通ることを確認**

```bash
npm run compile && npm test
```

- [ ] **Step 8: コミット**

```bash
git add src/panels/ComparisonPanel.ts media/comparisonWaveform.js
git commit -m "feat(uc4): draw loop region highlight as Layer 4 on all canvas views"
```

---

### Task 6: ループ再生（startPlaybackLoop でループジャンプ）

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (renderScript 内の startPlaybackLoop・togglePlayback・clearPlaybackState)

- [ ] **Step 1: updateLoopBadge ヘルパーを clearPlaybackState の直前に追加**

```javascript
function updateLoopBadge() {
    const badge = document.getElementById('loop-badge');
    if (!badge) { return; }
    badge.style.display = (loopRegion && playbackEl && !playbackEl.paused) ? 'inline' : 'none';
}
```

- [ ] **Step 2: startPlaybackLoop をループジャンプ対応に変更**

```javascript
function startPlaybackLoop() {
    if (playbackRafId !== null) { return; }
    function tick() {
        if (playbackEl && playbackTrackIndex !== null && !playbackEl.paused) {
            if (loopRegion) {
                const currentGlobalNorm = globalNormFromTrackTime(playbackTrackIndex, playbackEl.currentTime);
                if (currentGlobalNorm !== null && currentGlobalNorm >= loopRegion.end) {
                    const loopStartTime = trackTimeFromGlobalNorm(playbackTrackIndex, loopRegion.start);
                    if (loopStartTime !== null) {
                        try { playbackEl.currentTime = loopStartTime; } catch (_err) { }
                    }
                }
            }
            const nextCursor = globalNormFromTrackTime(playbackTrackIndex, playbackEl.currentTime);
            if (nextCursor !== null) {
                cursorNorm = nextCursor;
                updateCursorDisplay(nextCursor);
                scheduleRender();
            }
        }
        updateLoopBadge();
        playbackRafId = requestAnimationFrame(tick);
    }
    playbackRafId = requestAnimationFrame(tick);
}
```

- [ ] **Step 3: togglePlayback でループ区間がある場合は loopRegion.start から再生**

`let startTime = trackTimeFromGlobalNorm(idx, cursorNorm);` の行を変更する。

```diff
- let startTime = trackTimeFromGlobalNorm(idx, cursorNorm);
+ const startNorm = loopRegion ? loopRegion.start : cursorNorm;
+ let startTime = trackTimeFromGlobalNorm(idx, startNorm);
```

`playbackStartNorm` の記録も合わせる。

```diff
  try { audio.currentTime = startTime; } catch (_err) { }
- playbackStartNorm = cursorNorm;
+ playbackStartNorm = loopRegion ? loopRegion.start : cursorNorm;
```

- [ ] **Step 4: clearPlaybackState で updateLoopBadge を呼ぶ**

```diff
  function clearPlaybackState() {
      playbackEl = null;
      playbackRafId = null;
      playbackTrackIndex = null;
+     updateLoopBadge();
  }
```

- [ ] **Step 5: コンパイルしてテストが全通ることを確認**

```bash
npm run compile && npm test
```

- [ ] **Step 6: コミット**

```bash
git add src/panels/ComparisonPanel.ts
git commit -m "feat(uc4): loop playback jumps back to loopRegion.start at loopRegion.end"
```

---

### Task 7: ツールチップ

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (getWebviewContent の CSS・HTML、renderScript のイベントハンドラー)

- [ ] **Step 1: ツールチップ用 CSS を getWebviewContent() の `<style>` に追加**

```css
#canvas-tooltip {
    position: fixed;
    background: rgba(30, 30, 30, 0.92);
    color: #ccc;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    pointer-events: none;
    display: none;
    z-index: 100;
    white-space: pre;
    line-height: 1.6;
}
```

- [ ] **Step 2: ツールチップ HTML を `</body>` の直前に追加**

```html
<div id="canvas-tooltip"></div>
```

- [ ] **Step 3: renderScript にツールチップ制御関数を追加**

変数定義ブロックの後に追加する。

```javascript
const _tooltip = document.getElementById('canvas-tooltip');

function showTooltip(e, text) {
    if (!_tooltip) { return; }
    _tooltip.textContent = text;
    _tooltip.style.display = 'block';
    _tooltip.style.left = (e.clientX + 14) + 'px';
    _tooltip.style.top = (e.clientY + 14) + 'px';
}

function hideTooltip() {
    if (_tooltip) { _tooltip.style.display = 'none'; }
}
```

- [ ] **Step 4: handleCanvasMouseMove にツールチップ分岐を追加**

関数冒頭（ドラッグ中チェックの後）に追加する。

```diff
  function handleCanvasMouseMove(e) {
      if (dragState && dragState.isDrag) {
+         hideTooltip();
          return;
      }
      const canvas = e.target;
      if (!canvas.classList.contains('track-canvas')) { return; }
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);

+     const gripType = getGripType(norm);
+     if (gripType) {
+         showTooltip(e, 'ドラッグでループ区間をリサイズ');
+     } else if (loopRegion && norm >= loopRegion.start && norm <= loopRegion.end) {
+         showTooltip(e, 'クリックでループ解除');
+     } else {
+         showTooltip(e, 'ドラッグ: ループ区間を設定\nShift+ドラッグ: トラックの時間をずらす');
+     }

      renderWithHoverAt(norm);
  }
```

- [ ] **Step 5: clearHover でツールチップを非表示**

```diff
  function clearHover() {
      if (hoverNorm === null) { return; }
      hoverNorm = null;
+     hideTooltip();
      scheduleRender();
      updateCursorDisplay(cursorNorm);
  }
```

- [ ] **Step 6: カーソル時刻表示に title 属性を追加**

`getWebviewContent()` 内の `#cursor-display` 要素に追加する。

```diff
- <span id="cursor-display">--:--</span>
+ <span id="cursor-display" title="← →キーで微調整できます">--:--</span>
```

- [ ] **Step 7: コンパイルしてテストが全通ることを確認**

```bash
npm run compile && npm test
```

- [ ] **Step 8: コミット**

```bash
git add src/panels/ComparisonPanel.ts
git commit -m "feat: add tooltips for canvas hover and offset drag indicator"
```

---

### Task 8: キーボードナッジ + キャンバスフォーカス管理（UC-2）

**Files:**
- Modify: `src/panels/ComparisonPanel.ts` (renderScript 内のキャンバス生成・キーボードイベント)

- [ ] **Step 1: キャンバス生成時に tabIndex を設定**

キャンバス要素を生成・設定している箇所（`canvas.setAttribute('data-track-index', ...)` 付近）に追加する。

```javascript
canvas.setAttribute('tabindex', '0');
canvas.style.outline = 'none';
```

- [ ] **Step 2: キャンバスに focus / blur イベントを登録**

```javascript
canvas.addEventListener('focus', function() {
    if (_tooltip) {
        const rect = canvas.getBoundingClientRect();
        _tooltip.textContent = '← →: カーソル移動　Shift+←→: 100ms移動　Space: 再生/停止';
        _tooltip.style.display = 'block';
        _tooltip.style.left = (rect.left + 8) + 'px';
        _tooltip.style.top = (rect.bottom - 36) + 'px';
    }
    canvas.style.outline = '1px solid rgba(100, 160, 255, 0.4)';
});
canvas.addEventListener('blur', function() {
    hideTooltip();
    canvas.style.outline = 'none';
});
```

- [ ] **Step 3: document レベルの keydown ハンドラーを追加**

イベント登録ブロックの末尾に追加する。

```javascript
document.addEventListener('keydown', function(e) {
    const active = document.activeElement;
    if (!active || !active.classList.contains('track-canvas')) { return; }

    if (e.code === 'Space') {
        e.preventDefault();
        const idx = parseInt(active.getAttribute('data-track-index'), 10);
        if (!isNaN(idx)) { togglePlayback(idx); }
        return;
    }

    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const W = active.width || 800;
        let delta;
        if (e.shiftKey) {
            const gs = computeGlobalSpan();
            delta = gs.spanSec > 0 ? (0.1 / gs.spanSec) : 0.001;
        } else {
            delta = (zoomEnd - zoomStart) / W;
        }
        if (e.code === 'ArrowLeft') { delta = -delta; }
        cursorNorm = Math.max(0, Math.min(1, cursorNorm + delta));
        updateCursorDisplay(cursorNorm);
        scheduleRender();
    }
});
```

- [ ] **Step 4: コンパイルしてテストが全通ることを確認**

```bash
npm run compile && npm test
```

- [ ] **Step 5: E2E テストが通ることを確認**

```bash
npm run test:e2e:vscode
```

- [ ] **Step 6: コミット**

```bash
git add src/panels/ComparisonPanel.ts
git commit -m "feat(uc2): add keyboard nudge (arrow keys) and canvas focus management"
```

---

## 全体検証チェックリスト

- [ ] `npm run compile && npm test` — 全ユニットテスト・統合テスト PASS
- [ ] `npm run test:e2e:vscode` — E2E スモークテスト PASS
- [ ] 手動確認（2トラックをパネルで開いて実施）：
  - [ ] トラックAを再生中にBの ▶ を押すと、カーソルがAの再生開始位置に戻りBがそこから始まる
  - [ ] 波形をドラッグすると青いハイライト帯とグリップハンドルが全トラックに表示される
  - [ ] ループ区間がある状態で ▶ を押すと区間先頭から再生し、末尾でカーソルが折り返す
  - [ ] ツールバーに「🔁 ループ再生中」バッジが表示される
  - [ ] 波形クリックでカーソルが移動し、ループ区間が解除される
  - [ ] グリップをドラッグすると区間の端点のみが移動してリサイズできる
  - [ ] Shift+ドラッグでトラックのオフセット調整が従来通り動作する
  - [ ] 波形クリック後に ← → キーでカーソルが 1px 単位で移動する
  - [ ] ズームイン後は ← → の移動量が細かくなる
  - [ ] Shift+← → で 100ms 単位で移動する
  - [ ] Space キーで再生 / 一時停止がトグルする
  - [ ] 波形ホバー時にツールチップが正しく表示される（区間内外・グリップで内容が変わる）
  - [ ] キャンバスにフォーカスが当たると青いアウトラインとキーボードヒントが表示される
