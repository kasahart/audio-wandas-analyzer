# パワースペクトル・波形ズーム操作追加 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** パワースペクトルに周波数軸・dB 軸の独立ズームと矩形選択ズームを追加し、波形エリアにモード切り替え式の矩形範囲ズームを追加する。

**Architecture:** `comparisonRenderScript.ts` に `specFreqStart/End`・`specDbMin/Max` 状態変数を追加し、既存の `zoomStart`/`zoomEnd` パターンを踏襲。描画関数に vis* パラメータを追加し、軸・ライン描画にズーム範囲を適用する。波形ドラッグはモード変数で loop/rect-zoom を切り替える。

**Tech Stack:** TypeScript (webview template literal)、Canvas 2D API、`src/shared/i18n/strings.ts`

---

## File Map

| ファイル | 変更内容 |
|---------|---------|
| `src/shared/i18n/strings.ts` | 9 キー追加 |
| `src/webview/comparisonRenderScript.ts` | 状態変数・描画関数・HTML・イベントハンドラ・ヘルプ行 |
| `src/webview/panels/ComparisonPanel.ts` | `ComparisonPanelRenderedUi` 型に 3 フィールド追加 |
| `src/test/renderScript.integration.test.ts` | スペクトルズームツールバー・波形モードボタン存在テスト追加 |

---

## Context: コードベース概要

- `src/webview/comparisonRenderScript.ts` — webview に注入される IIFE JS を返す TS ファイル。先頭に `SHORTCUT_ROWS` 定数（ヘルプ行）、その後に IIFE 内に module-level 変数群、描画関数、イベントハンドラが続く。
- 既存のズーム: `let zoomStart = 0`, `let zoomEnd = 1`（波形の時間軸、行 77-78）。
- `drawSpectrumLine(ctx, W, H, slice, color, opts)` — 行 2301。
- `drawSpectrumAxes(ctx, W, H, slice, padL, padR, padT, padB)` — 行 2332。
- `renderTrackSpectra()` — 行 2359。`drawSpectrumAxes` と `drawSpectrumLine` を `padL:32, padR:6, padT:4, padB:14` で呼ぶ。
- `renderOverlaySpectrum()` — 行 2422。オーバーレイは `padL=36, padR=8, padT=8, padB=18`。
- `attachSpectrumCursorEvents()` IIFE — 行 1546。スペクトルキャンバスに mousemove / mouseleave を登録。
- `handleCanvasMouseDown(e)` — 行 2133。波形キャンバスのドラッグ開始。
- `handleDocMouseMove(e)` — 行 2157。ドラッグ中のロジック。dragType === 'loop' が通常ドラッグ。
- `handleDocMouseUp(e)` — 行 2197。ドラッグ終了。
- `buildToolbar()` — 行 503。HTML を返す文字列連結関数。
- `publishTestSnapshot()` — 行 279。`renderedUi` オブジェクトを postMessage。
- `SHORTCUT_ROWS` — 行 3-16。`satisfies ReadonlyArray<{ shortcut: string; labelKey: keyof UiStrings }>` 制約あり。
- `npm run verify` = tsc + webview lint + node:test (213 テスト) + ruff + pytest。

---

## Task 1: i18n 文字列 9 キー追加

**Files:**
- Modify: `src/shared/i18n/strings.ts`

### 背景

`UiStrings` インターフェース（行 16）と EN/JA 実装に 9 キーを追加する。既存の末尾フィールド `announceUnsoloed: string;`（行 139）の直後に追加。

- [ ] **Step 1: `UiStrings` インターフェースに 9 フィールドを追加する**

`announceUnsoloed: string;` の行の直後（`}` の前）に追加：

```typescript
    spectrumZoomLabel: string;
    ariaSpecZoomIn: string;
    ariaSpecZoomOut: string;
    ariaSpecZoomReset: string;
    btnSpecZoomReset: string;
    helpRowSpectrumDrag: string;
    helpRowWaveRectZoom: string;
    waveModeLabelLoop: string;
    waveModeLabelRectZoom: string;
```

- [ ] **Step 2: EN 実装に 9 エントリを追加する**

EN ブロック（`en: {` で始まる）の末尾（`announceUnsoloed:` エントリの後）に追加：

```typescript
        spectrumZoomLabel: 'Spectrum',
        ariaSpecZoomIn: 'Spectrum zoom in',
        ariaSpecZoomOut: 'Spectrum zoom out',
        ariaSpecZoomReset: 'Spectrum zoom reset',
        btnSpecZoomReset: 'All',
        helpRowSpectrumDrag: 'drag zoom (spectrum)',
        helpRowWaveRectZoom: 'drag zoom (waveform zoom mode)',
        waveModeLabelLoop: '🔁 Loop',
        waveModeLabelRectZoom: '🔲 Zoom',
```

- [ ] **Step 3: JA 実装に 9 エントリを追加する**

JA ブロックの末尾（`announceUnsoloed:` エントリの後）に追加：

```typescript
        spectrumZoomLabel: 'スペクトル',
        ariaSpecZoomIn: 'スペクトル拡大',
        ariaSpecZoomOut: 'スペクトル縮小',
        ariaSpecZoomReset: 'スペクトルズームリセット',
        btnSpecZoomReset: '全域',
        helpRowSpectrumDrag: '矩形ズーム (スペクトル)',
        helpRowWaveRectZoom: '矩形ズーム (波形ズームモード時)',
        waveModeLabelLoop: '🔁 ループ',
        waveModeLabelRectZoom: '🔲 ズーム',
```

- [ ] **Step 4: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: all steps PASS

- [ ] **Step 5: コミットする**

```bash
git add src/shared/i18n/strings.ts
git commit -m "feat(spectrum-zoom): add i18n keys for spectrum zoom and wave mode (Issue #67)"
```

---

## Task 2: 状態変数と SHORTCUT_ROWS の追加

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

スペクトルズーム状態変数（9 個）を既存 `zoomStart`/`zoomEnd`（行 77-82）の直後に追加する。`SHORTCUT_ROWS`（行 3-16）にも 2 行追加する。

- [ ] **Step 1: 状態変数を追加する**

行 82 の `let spectrumHasMouse = false;` の直後（行 83 の前）に追加：

```js
            // ── スペクトルズーム ───────────────────────────────────
            let specFreqStart = 0;      // 0..1 正規化周波数（0=0Hz, 1=maxFreq）
            let specFreqEnd   = 1;
            let specDbMin = null;       // null = データ自動, number = dB 上書き
            let specDbMax = null;
            let _lastVisDbMin = null;   // 前回レンダリング時の visDbMin キャッシュ
            let _lastVisDbMax = null;
            let specDragAnchor  = null; // { freqNorm, dbNorm } | null
            let specDragCurrent = null; // { freqNorm, dbNorm } | null
            // ── 波形モード ────────────────────────────────────────
            let waveformMode = 'loop';  // 'loop' | 'rect-zoom'
```

- [ ] **Step 2: SHORTCUT_ROWS に 2 行追加する**

行 12 の `{ shortcut: 'Drag', labelKey: 'helpRowDrag' },` の直前に追加：

```typescript
    { shortcut: 'Drag (spectrum)', labelKey: 'helpRowSpectrumDrag' },
    { shortcut: 'Drag (zoom mode)', labelKey: 'helpRowWaveRectZoom' },
```

- [ ] **Step 3: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS（TypeScript 型チェック: `labelKey: keyof UiStrings` 制約を満たす）

- [ ] **Step 4: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum-zoom): add spectrum zoom state vars and shortcut rows (Issue #67)"
```

---

## Task 3: `drawSpectrumAxes` をズーム対応にする

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

`drawSpectrumAxes` の軸ラベルをズーム表示範囲に合わせて変更する。追加パラメータは任意（既存呼び出しは渡さなくてよい）。

- [ ] **Step 1: `drawSpectrumAxes` を書き換える**

現在の関数（行 2332-2357）を丸ごと以下に置き換える：

```js
            function drawSpectrumAxes(ctx, W, H, slice, padL, padR, padT, padB, visFreqMin, visFreqMax, visDbMin, visDbMax) {
                const _visFreqMin = (visFreqMin != null) ? visFreqMin : 0;
                const _visFreqMax = (visFreqMax != null) ? visFreqMax : slice.maxFrequencyHz;
                const _visDbMin   = (visDbMin   != null) ? visDbMin   : slice.minDb;
                const _visDbMax   = (visDbMax   != null) ? visDbMax   : slice.maxDb;
                const mutedColor = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
                const lineColor = getComputedStyle(document.body).getPropertyValue('--line').trim() || '#444';
                const plotW = W - padL - padR;
                const plotH = H - padT - padB;
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB);
                ctx.moveTo(padL, H - padB); ctx.lineTo(W - padR, H - padB);
                ctx.stroke();
                ctx.fillStyle = mutedColor;
                ctx.font = '9px monospace';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'top';
                ctx.fillText(_visDbMax.toFixed(0) + ' dB', padL - 2, padT);
                ctx.textBaseline = 'middle';
                ctx.fillText(((_visDbMax + _visDbMin) / 2).toFixed(0) + ' dB', padL - 2, padT + plotH / 2);
                ctx.textBaseline = 'bottom';
                ctx.fillText(_visDbMin.toFixed(0) + ' dB', padL - 2, H - padB);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(formatHz(_visFreqMin), padL, H - 1);
                ctx.fillText(formatHz((_visFreqMin + _visFreqMax) / 2), padL + plotW / 2, H - 1);
                ctx.fillText(formatHz(_visFreqMax), W - padR, H - 1);
            }
```

- [ ] **Step 2: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS

- [ ] **Step 3: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum-zoom): make drawSpectrumAxes zoom-aware (Issue #67)"
```

---

## Task 4: `drawSpectrumLine` をズーム対応にする

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

`drawSpectrumLine` の X・Y マッピングをズーム範囲で変更する。追加パラメータは任意。

- [ ] **Step 1: `drawSpectrumLine` を書き換える**

現在の関数（行 2301-2330）を丸ごと以下に置き換える：

```js
            function drawSpectrumLine(ctx, W, H, slice, color, opts, visFreqMin, visFreqMax, visDbMin, visDbMax) {
                const fBins = slice.frequencyBins;
                const _visFreqMin = (visFreqMin != null) ? visFreqMin : 0;
                const _visFreqMax = (visFreqMax != null) ? visFreqMax : slice.maxFrequencyHz;
                const _visDbMin   = (visDbMin   != null) ? visDbMin   : slice.minDb;
                const _visDbMax   = (visDbMax   != null) ? visDbMax   : slice.maxDb;
                const range = _visDbMax - _visDbMin;
                if (range <= 0) { return; }
                const padL = (opts && opts.padL) || 0;
                const padR = (opts && opts.padR) || 0;
                const padT = (opts && opts.padT) || 0;
                const padB = (opts && opts.padB) || 0;
                const plotW = W - padL - padR;
                const plotH = H - padT - padB;
                ctx.save();
                ctx.beginPath();
                ctx.rect(padL, padT, plotW, plotH);
                ctx.clip();
                ctx.strokeStyle = color;
                ctx.lineWidth = (opts && opts.lineWidth) || 1.2;
                ctx.beginPath();
                const originalMaxFreq = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
                const visFreqRange = _visFreqMax - _visFreqMin;
                for (let i = 0; i < fBins; i++) {
                    const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
                    if (fHz > slice.maxFrequencyHz) { break; }
                    const x = padL + ((fHz - _visFreqMin) / visFreqRange) * plotW;
                    const v = slice.values[i];
                    const norm = (v - _visDbMin) / range;
                    const y = padT + (1 - norm) * plotH;
                    if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
                }
                ctx.stroke();
                ctx.restore();
            }
```

- [ ] **Step 2: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS

- [ ] **Step 3: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum-zoom): make drawSpectrumLine zoom-aware (Issue #67)"
```

---

## Task 5: `renderTrackSpectra` にズームを適用する

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

`renderTrackSpectra` で `drawSpectrumAxes` と `drawSpectrumLine` を呼ぶ箇所に vis* パラメータを渡す。ホバーカーソルの周波数・dB 計算もズーム範囲ベースに更新する。

- [ ] **Step 1: drawSpectrumAxes/Line の呼び出し箇所を更新する**

`renderTrackSpectra` 内の次の 2 行を探す：

```js
                    const color = trackColor(i);
                    drawSpectrumAxes(ctx, W, H, slice, 32, 6, 4, 14);
                    drawSpectrumLine(ctx, W, H, slice, color, { padL: 32, padR: 6, padT: 4, padB: 14 });
```

これを以下に置き換える：

```js
                    const color = trackColor(i);
                    const visFreqMinT = specFreqStart * slice.maxFrequencyHz;
                    const visFreqMaxT = specFreqEnd   * slice.maxFrequencyHz;
                    const visDbMinT   = (specDbMin != null) ? specDbMin : slice.minDb;
                    const visDbMaxT   = (specDbMax != null) ? specDbMax : slice.maxDb;
                    drawSpectrumAxes(ctx, W, H, slice, 32, 6, 4, 14, visFreqMinT, visFreqMaxT, visDbMinT, visDbMaxT);
                    drawSpectrumLine(ctx, W, H, slice, color, { padL: 32, padR: 6, padT: 4, padB: 14 }, visFreqMinT, visFreqMaxT, visDbMinT, visDbMaxT);
```

- [ ] **Step 2: ホバーカーソルの周波数と dB 計算をズーム対応にする**

`renderTrackSpectra` 内のホバーカーソルブロックを探す。次のコードがある：

```js
                        const curX = padL2 + spectrumHoverNorm * plotW2;
                        const origMaxF2 = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
                        const fHz2 = spectrumHoverNorm * slice.maxFrequencyHz;
                        const binF2 = (fHz2 / Math.max(origMaxF2, 1)) * Math.max(slice.frequencyBins - 1, 1);
                        const binIdx2 = Math.max(0, Math.min(slice.frequencyBins - 1, Math.round(binF2)));
                        const dbVal2 = slice.values[binIdx2];
                        const range2 = slice.maxDb - slice.minDb;
```

これを以下に置き換える（`curX` は変わらない — plot 内位置はそのまま）：

```js
                        const curX = padL2 + spectrumHoverNorm * plotW2;
                        const origMaxF2 = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
                        const fHz2 = visFreqMinT + spectrumHoverNorm * (visFreqMaxT - visFreqMinT);
                        const binF2 = (fHz2 / Math.max(origMaxF2, 1)) * Math.max(slice.frequencyBins - 1, 1);
                        const binIdx2 = Math.max(0, Math.min(slice.frequencyBins - 1, Math.round(binF2)));
                        const dbVal2 = slice.values[binIdx2];
                        const range2 = visDbMaxT - visDbMinT;
```

さらに、ホバーカーソルの snap Y 計算を見つける：

```js
                        const norm2 = Math.max(0, Math.min(1, (dbVal2 - slice.minDb) / range2));
```

これを：

```js
                        const norm2 = Math.max(0, Math.min(1, (dbVal2 - visDbMinT) / range2));
```

- [ ] **Step 3: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum-zoom): apply zoom to renderTrackSpectra (Issue #67)"
```

---

## Task 6: `renderOverlaySpectrum` にズームを適用する

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

`renderOverlaySpectrum` の inline ループと軸ラベルをズーム対応にし、ゴムバンド矩形描画を追加する。`_lastVisDbMin`/`_lastVisDbMax` キャッシュも更新する。

- [ ] **Step 1: visFreq/Db 変数を宣言してキャッシュを更新する**

`renderOverlaySpectrum` 内の次のブロックを探す：

```js
                const padL = 36, padR = 8, padT = 8, padB = 18;
                const sharedAxis = { values: [], frequencyBins: 1, maxFrequencyHz: maxF, minDb: minDb, maxDb: maxDb };
                drawSpectrumAxes(ctx, W, H, sharedAxis, padL, padR, padT, padB);

                const plotW = W - padL - padR;
                const plotH = H - padT - padB;
                const range = maxDb - minDb;
```

これを以下に置き換える：

```js
                const padL = 36, padR = 8, padT = 8, padB = 18;
                const visFreqMinO = specFreqStart * maxF;
                const visFreqMaxO = specFreqEnd   * maxF;
                const visDbMinO   = (specDbMin != null) ? specDbMin : minDb;
                const visDbMaxO   = (specDbMax != null) ? specDbMax : maxDb;
                _lastVisDbMin = visDbMinO;
                _lastVisDbMax = visDbMaxO;
                const sharedAxis = { values: [], frequencyBins: 1, maxFrequencyHz: maxF, minDb: visDbMinO, maxDb: visDbMaxO };
                drawSpectrumAxes(ctx, W, H, sharedAxis, padL, padR, padT, padB, visFreqMinO, visFreqMaxO, visDbMinO, visDbMaxO);

                const plotW = W - padL - padR;
                const plotH = H - padT - padB;
                const range = visDbMaxO - visDbMinO;
```

- [ ] **Step 2: inline ループの X・Y マッピングを更新する**

`slices.forEach` 内の inline ループを探す。現在：

```js
                    const x = padL + (fHz / maxF) * plotW;
                    const v = s.slice.values[i];
                    const norm = (v - minDb) / range;
```

これを以下に置き換える（`clip/save/restore` は既存のまま）：

```js
                    const visFreqRangeO = visFreqMaxO - visFreqMinO;
                    const x = padL + ((fHz - visFreqMinO) / visFreqRangeO) * plotW;
                    const v = s.slice.values[i];
                    const norm = (v - visDbMinO) / range;
```

注意: `visFreqRangeO` の宣言は forEach の外（`range` の直後）に移動するのが望ましい：
```js
                const range = visDbMaxO - visDbMinO;
                const visFreqRangeO = visFreqMaxO - visFreqMinO;
```
そして forEach 内では `visFreqRangeO` を参照のみ。

- [ ] **Step 3: ホバーカーソルセクションを更新する**

オーバーレイのホバーカーソルブロックを見つける。`spectrumHoverNorm !== null` で始まるブロック内の次を探す：

```js
                    const fHz = spectrumHoverNorm * maxF;
```

以下に変更：

```js
                    const fHz = visFreqMinO + spectrumHoverNorm * (visFreqMaxO - visFreqMinO);
```

さらに `sliceSnaps` の snap Y 計算を探す：

```js
                        const norm = Math.max(0, Math.min(1, (dbVal - minDb) / range));
```

以下に変更：

```js
                        const norm = Math.max(0, Math.min(1, (dbVal - visDbMinO) / range));
```

ホバーハイライト再描画ブロック内（`ctx.save()` + `lineWidth = 2.5` があるブロック）の norm 計算を探す。`minDb` または `(v - minDb) / range` のような dB 正規化行を見つけ、`minDb` → `visDbMinO`、range は同ブロック内で参照している `range` 変数（既に `visDbMaxO - visDbMinO` に更新済み）に揃える。

- [ ] **Step 4: ゴムバンド矩形描画を末尾に追加する**

`renderOverlaySpectrum` の末尾（既存の `ctx.restore()` や `if (spectrumHoverNorm !== null)` ブロックの後）に追加：

```js
                // ── スペクトルドラッグ選択ゴムバンド ─────────────────────
                if (specDragAnchor !== null && specDragCurrent !== null) {
                    const ax = padL + specDragAnchor.freqNorm  * plotW;
                    const ay = padT + (1 - specDragAnchor.dbNorm)  * plotH;
                    const bx = padL + specDragCurrent.freqNorm * plotW;
                    const by = padT + (1 - specDragCurrent.dbNorm) * plotH;
                    ctx.save();
                    ctx.strokeStyle = 'rgba(100,180,255,0.9)';
                    ctx.fillStyle   = 'rgba(100,180,255,0.15)';
                    ctx.lineWidth   = 1;
                    ctx.setLineDash([4, 3]);
                    const rx = Math.min(ax, bx), ry = Math.min(ay, by);
                    const rw = Math.abs(bx - ax),  rh = Math.abs(by - ay);
                    ctx.fillRect(rx, ry, rw, rh);
                    ctx.strokeRect(rx, ry, rw, rh);
                    ctx.restore();
                }
```

- [ ] **Step 5: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS

- [ ] **Step 6: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum-zoom): apply zoom to renderOverlaySpectrum, add rubber-band (Issue #67)"
```

---

## Task 7: HTML — スペクトルツールバー・波形モードボタン追加

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

スペクトル専用ツールバー行をスペクトルセクションの直前に追加し、既存ツールバーに波形モード切り替えボタンを追加する。

- [ ] **Step 1: スペクトルツールバー行を追加する**

`buildResultsPane` 内の次を探す：

```js
                    + '  <div id="spectrum-overlay-wrap"><canvas id="spectrum-overlay-canvas"></canvas></div>'
```

この行の直前に挿入：

```js
                    + '  <div id="spectrum-zoom-toolbar" style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:11px;">'
                    + '    <span class="tb-label">' + escHtml(STR.spectrumZoomLabel) + '</span>'
                    + '    <button class="tb-btn" data-action="spec-zoom-out" aria-label="' + escHtml(STR.ariaSpecZoomOut) + '">－</button>'
                    + '    <button class="tb-btn" data-action="spec-zoom-in" aria-label="' + escHtml(STR.ariaSpecZoomIn) + '">＋</button>'
                    + '    <button class="tb-btn" data-action="spec-zoom-reset" aria-label="' + escHtml(STR.ariaSpecZoomReset) + '">' + escHtml(STR.btnSpecZoomReset) + '</button>'
                    + '  </div>'
```

- [ ] **Step 2: 波形モードボタンを `buildToolbar` に追加する**

`buildToolbar` 内の次を探す（zoom-reset ボタンの後）：

```js
                    + '<button class="tb-btn" data-action="zoom-reset" aria-label="' + escHtml(STR.ariaZoomReset) + '">' + escHtml(STR.btnZoomReset) + '</button>'
```

この行の直後に追加：

```js
                    + '<div class="tb-sep"></div>'
                    + '<button class="tb-btn" id="btn-wave-mode-loop" data-action="wave-mode-loop" aria-pressed="true">' + escHtml(STR.waveModeLabelLoop) + '</button>'
                    + '<button class="tb-btn" id="btn-wave-mode-rect-zoom" data-action="wave-mode-rect-zoom" aria-pressed="false">' + escHtml(STR.waveModeLabelRectZoom) + '</button>'
```

- [ ] **Step 3: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum-zoom): add spectrum toolbar and wave mode buttons (Issue #67)"
```

---

## Task 8: specZoom 関数・アクションハンドラ・波形モードハンドラ追加

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

`specZoomIn`/`specZoomOut`/`specZoomReset` 関数を追加し、既存のアクションハンドラ dispatch に新アクションを追加する。

- [ ] **Step 1: specZoomIn / specZoomOut / specZoomReset 関数を追加する**

`zoomOut` 関数（行 2035）の直後に追加：

```js
            function specZoomIn() {
                const fc = (specFreqStart + specFreqEnd) / 2;
                const fh = (specFreqEnd - specFreqStart) / 2 * 0.7;
                specFreqStart = Math.max(0, fc - fh);
                specFreqEnd   = Math.min(1, fc + fh);
                if (_lastVisDbMin !== null && _lastVisDbMax !== null) {
                    const dc = (_lastVisDbMin + _lastVisDbMax) / 2;
                    const dh = (_lastVisDbMax - _lastVisDbMin) / 2 * 0.7;
                    specDbMin = dc - dh;
                    specDbMax = dc + dh;
                }
                refreshSpectrumViews();
            }

            function specZoomOut() {
                const fc = (specFreqStart + specFreqEnd) / 2;
                const fh = (specFreqEnd - specFreqStart) / 2 * (1 / 0.7);
                specFreqStart = Math.max(0, fc - fh);
                specFreqEnd   = Math.min(1, fc + fh);
                if (_lastVisDbMin !== null && _lastVisDbMax !== null) {
                    const dc = (_lastVisDbMin + _lastVisDbMax) / 2;
                    const dh = (_lastVisDbMax - _lastVisDbMin) / 2 * (1 / 0.7);
                    specDbMin = dc - dh;
                    specDbMax = dc + dh;
                }
                refreshSpectrumViews();
            }

            function specZoomReset() {
                specFreqStart = 0;
                specFreqEnd   = 1;
                specDbMin     = null;
                specDbMax     = null;
                refreshSpectrumViews();
            }
```

- [ ] **Step 2: アクションハンドラ dispatch に追加する**

`} else if (action === 'zoom-reset') {` で始まるブロックの直後（行 1748 付近）に追加：

```js
                } else if (action === 'spec-zoom-in') {
                    specZoomIn();
                } else if (action === 'spec-zoom-out') {
                    specZoomOut();
                } else if (action === 'spec-zoom-reset') {
                    specZoomReset();
                } else if (action === 'wave-mode-loop') {
                    waveformMode = 'loop';
                    var btnL = document.getElementById('btn-wave-mode-loop');
                    var btnZ = document.getElementById('btn-wave-mode-rect-zoom');
                    if (btnL) { btnL.setAttribute('aria-pressed', 'true'); }
                    if (btnZ) { btnZ.setAttribute('aria-pressed', 'false'); }
                } else if (action === 'wave-mode-rect-zoom') {
                    waveformMode = 'rect-zoom';
                    var btnL2 = document.getElementById('btn-wave-mode-loop');
                    var btnZ2 = document.getElementById('btn-wave-mode-rect-zoom');
                    if (btnL2) { btnL2.setAttribute('aria-pressed', 'false'); }
                    if (btnZ2) { btnZ2.setAttribute('aria-pressed', 'true'); }
```

- [ ] **Step 3: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum-zoom): add specZoom functions and action handlers (Issue #67)"
```

---

## Task 9: スペクトルキャンバスのドラッグ矩形ズームイベント

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

`attachSpectrumCursorEvents` IIFE 内に `#spectrum-overlay-canvas` の mousedown / mouseup を追加し、ドラッグ完了時にズームを適用する。

- [ ] **Step 1: スペクトルドラッグイベントを追加する**

`attachSpectrumCursorEvents` IIFE 内の、`overlayCanvas.addEventListener('mousemove', ...)` の直後に追加：

```js
                    overlayCanvas.addEventListener('mousedown', function(e) {
                        if (e.button !== 0) { return; }
                        const rect = overlayCanvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        const padL = 36, padR = 8, padT = 8, padB = 18;
                        const plotW = overlayCanvas.width - padL - padR;
                        const plotH = overlayCanvas.height - padT - padB;
                        if (plotW <= 0 || plotH <= 0) { return; }
                        const freqNorm = Math.max(0, Math.min(1, (x - padL) / plotW));
                        const dbNorm   = Math.max(0, Math.min(1, 1 - (y - padT) / plotH));
                        specDragAnchor  = { freqNorm: freqNorm, dbNorm: dbNorm };
                        specDragCurrent = { freqNorm: freqNorm, dbNorm: dbNorm };
                        e.preventDefault();
                    });
                    document.addEventListener('mousemove', function(e) {
                        if (specDragAnchor === null) { return; }
                        const rect = overlayCanvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        const padL = 36, padR = 8, padT = 8, padB = 18;
                        const plotW = overlayCanvas.width - padL - padR;
                        const plotH = overlayCanvas.height - padT - padB;
                        if (plotW <= 0 || plotH <= 0) { return; }
                        const freqNorm = Math.max(0, Math.min(1, (x - padL) / plotW));
                        const dbNorm   = Math.max(0, Math.min(1, 1 - (y - padT) / plotH));
                        specDragCurrent = { freqNorm: freqNorm, dbNorm: dbNorm };
                        refreshSpectrumViews();
                    });
                    document.addEventListener('mouseup', function(e) {
                        if (specDragAnchor === null) { return; }
                        const anchor  = specDragAnchor;
                        const current = specDragCurrent;
                        specDragAnchor  = null;
                        specDragCurrent = null;
                        if (!anchor || !current) { refreshSpectrumViews(); return; }
                        const rect = overlayCanvas.getBoundingClientRect();
                        const pxDx = Math.abs((anchor.freqNorm - current.freqNorm) * (overlayCanvas.width - 36 - 8));
                        const pxDy = Math.abs((anchor.dbNorm   - current.dbNorm)   * (overlayCanvas.height - 8 - 18));
                        if (pxDx < 5 && pxDy < 5) { refreshSpectrumViews(); return; }
                        // ズームを適用: freqNorm は現在の visFreqStart..visFreqEnd 内の相対値
                        const f0 = Math.min(anchor.freqNorm, current.freqNorm);
                        const f1 = Math.max(anchor.freqNorm, current.freqNorm);
                        const d0 = Math.min(anchor.dbNorm,   current.dbNorm);
                        const d1 = Math.max(anchor.dbNorm,   current.dbNorm);
                        const prevFreqStart = specFreqStart;
                        const prevFreqEnd   = specFreqEnd;
                        specFreqStart = prevFreqStart + f0 * (prevFreqEnd - prevFreqStart);
                        specFreqEnd   = prevFreqStart + f1 * (prevFreqEnd - prevFreqStart);
                        if (_lastVisDbMin !== null && _lastVisDbMax !== null) {
                            const visDbRange = _lastVisDbMax - _lastVisDbMin;
                            specDbMin = _lastVisDbMin + d0 * visDbRange;
                            specDbMax = _lastVisDbMin + d1 * visDbRange;
                        }
                        refreshSpectrumViews();
                    });
```

- [ ] **Step 2: mousemove ハンドラをドラッグ中はホバーをスキップするよう更新する**

既存の `overlayCanvas.addEventListener('mousemove', function(e) { onSpectrumMove(36, 8, overlayCanvas, e); });` を以下に変更：

```js
                    overlayCanvas.addEventListener('mousemove', function(e) {
                        if (specDragAnchor !== null) { return; }  // ドラッグ中はホバー不要
                        onSpectrumMove(36, 8, overlayCanvas, e);
                    });
```

- [ ] **Step 3: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum-zoom): add spectrum canvas drag-rect zoom events (Issue #67)"
```

---

## Task 10: 波形 rect-zoom モード — handleDocMouseUp に適用

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

`waveformMode === 'rect-zoom'` のとき、`handleDocMouseUp` でループ区間をズームに変換する。波形の `dragType` は既存の `'loop'` を再利用（ループ区間の視覚描画を流用）。

- [ ] **Step 1: handleDocMouseUp に rect-zoom 分岐を追加する**

`handleDocMouseUp` 内の現在のコードを探す：

```js
            function handleDocMouseUp(e) {
                const hadDrag = !!dragState;
                if (dragState && !dragState.isDrag) {
```

関数全体を以下に置き換える：

```js
            function handleDocMouseUp(e) {
                const hadDrag = !!dragState;
                const wasRectZoom = hadDrag && dragState.isDrag && dragState.dragType === 'loop' && waveformMode === 'rect-zoom';
                if (dragState && !dragState.isDrag) {
                    // クリック（ドラッグなし）: カーソル移動 + ループ区間解除
                    const canvasId = 'track-canvas-' + dragState.trackIndex;
                    const canvas = document.getElementById(canvasId);
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                        cursorNorm = Math.max(0, Math.min(1, norm));
                        loopRegion = null;
                        updateLoopTimeDisplay();
                        updateZoomToSelectionBtn();
                        updateCursorDisplay(cursorNorm);
                        scheduleRender();
                    }
                }
                dragState = null;
                if (wasRectZoom && loopRegion) {
                    const pad = (loopRegion.end - loopRegion.start) * 0.05;
                    disableFollowCursor();
                    zoomStart = Math.max(0, loopRegion.start - pad);
                    zoomEnd   = Math.min(1, loopRegion.end + pad);
                    loopRegion = null;
                    updateZoomToSelectionBtn();
                    updateLoopTimeDisplay();
                    scheduleRender();
                    return;
                }
                if (hadDrag) { refreshSpectrumViews(); }
            }
```

- [ ] **Step 2: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS

- [ ] **Step 3: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum-zoom): apply wave rect-zoom mode in handleDocMouseUp (Issue #67)"
```

---

## Task 11: publishTestSnapshot と ComparisonPanelRenderedUi の更新

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`
- Modify: `src/webview/panels/ComparisonPanel.ts`

### 背景

新しい状態 `specFreqStart`、`specFreqEnd`、`waveformMode` をスナップショットに追加する。

- [ ] **Step 1: `publishTestSnapshot` に 3 フィールドを追加する**

`renderedUi` オブジェクト内の `displayOrder: displayOrder.slice(),` の直後に追加：

```js
                        specFreqStart: specFreqStart,
                        specFreqEnd: specFreqEnd,
                        waveformMode: waveformMode,
```

- [ ] **Step 2: `ComparisonPanelRenderedUi` に 3 フィールドを追加する**

`src/webview/panels/ComparisonPanel.ts` の `ComparisonPanelRenderedUi` インターフェースの `displayOrder: number[];` の直後に追加：

```typescript
    specFreqStart: number;
    specFreqEnd: number;
    waveformMode: string;
```

- [ ] **Step 3: verify を実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts src/webview/panels/ComparisonPanel.ts
git commit -m "feat(spectrum-zoom): add specFreqStart/End, waveformMode to test snapshot (Issue #67)"
```

---

## Task 12: 統合テスト追加

**Files:**
- Modify: `src/test/renderScript.integration.test.ts`

### 背景

スペクトルズームツールバーと波形モードボタンが DOM に生成されることをテストする。また、スナップショットの初期値を検証する。

- [ ] **Step 1: テストを追加する**

ファイル末尾に追加：

```typescript
test('スペクトルズームツールバーのボタンが生成される', () => {
    const { dom } = setupEnv();
    const zoomIn  = dom.window.document.querySelector('[data-action="spec-zoom-in"]');
    const zoomOut = dom.window.document.querySelector('[data-action="spec-zoom-out"]');
    const reset   = dom.window.document.querySelector('[data-action="spec-zoom-reset"]');
    assert.ok(zoomIn,  'spec-zoom-in ボタンが存在すること');
    assert.ok(zoomOut, 'spec-zoom-out ボタンが存在すること');
    assert.ok(reset,   'spec-zoom-reset ボタンが存在すること');
});

test('波形モードボタンが生成される', () => {
    const { dom } = setupEnv();
    const loopBtn    = dom.window.document.querySelector('[data-action="wave-mode-loop"]');
    const rectZoomBtn = dom.window.document.querySelector('[data-action="wave-mode-rect-zoom"]');
    assert.ok(loopBtn,     'wave-mode-loop ボタンが存在すること');
    assert.ok(rectZoomBtn, 'wave-mode-rect-zoom ボタンが存在すること');
});

test('初期スペクトルズーム状態が全域である', async () => {
    const { dom, postedMessages } = setupEnv();
    await nextAnimationFrame(dom);
    const snapMsg = postedMessages.find((m: any) => m.type === 'comparison-panel-test-snapshot') as any;
    assert.ok(snapMsg, 'スナップショットメッセージが送信されること');
    assert.strictEqual(snapMsg.renderedUi.specFreqStart, 0,      'specFreqStart の初期値が 0 であること');
    assert.strictEqual(snapMsg.renderedUi.specFreqEnd,   1,      'specFreqEnd の初期値が 1 であること');
    assert.strictEqual(snapMsg.renderedUi.waveformMode,  'loop', 'waveformMode の初期値が loop であること');
});
```

- [ ] **Step 2: テストを実行する**

```bash
cd /workspaces/audio-wandas-analyzer && npm run verify
```

Expected: 新しい 3 テストを含む 216 tests PASS

- [ ] **Step 3: コミットする**

```bash
git add src/test/renderScript.integration.test.ts
git commit -m "test(spectrum-zoom): add integration tests for spectrum zoom UI (Issue #67)"
```

---

## Task 13: PR 作成・Issue #67 クローズ

**Files:**
- なし（GitHub 操作のみ）

- [ ] **Step 1: ブランチを push して PR を作成する**

```bash
git push -u origin <branch-name>
gh pr create \
  --title "feat(spectrum-zoom): add zoom interactions for power spectrum and waveform (Issue #67)" \
  --body "## 概要

Issue #67 の Acceptance Criteria をすべて満たす。

### 変更内容

**1. パワースペクトルズーム**
- スペクトルセクション直上に専用ツールバー行（＋/－/全域ボタン）を追加
- 周波数軸（X）・dB 軸（Y）の同時ズームに対応
- \`drawSpectrumAxes\`/\`drawSpectrumLine\` をズーム範囲パラメータ対応に変更

**2. 矩形選択ズーム（スペクトル）**
- オーバーレイキャンバス上でドラッグすると矩形ゴムバンドを表示
- ドラッグ終了時に周波数・dB 範囲ズームを適用

**3. 波形 rect-zoom モード**
- ツールバーに「🔁 ループ」/「🔲 ズーム」トグルボタンを追加
- ズームモード時にドラッグすると時間範囲ズームが適用される

**4. ヘルプ & i18n**
- ヘルプオーバーレイに 2 行追加（Drag (spectrum)・Drag (zoom mode)）
- i18n: 9 キー追加（EN/JA）

### 変更ファイル
- \`src/webview/comparisonRenderScript.ts\`
- \`src/webview/panels/ComparisonPanel.ts\`
- \`src/shared/i18n/strings.ts\`
- \`src/test/renderScript.integration.test.ts\`

Closes #67

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
  --base main
```

- [ ] **Step 2: マージして Issue がクローズされることを確認する**

```bash
gh pr merge --squash --delete-branch
gh issue view 67 --json state -q .state
```

Expected: `"CLOSED"`
