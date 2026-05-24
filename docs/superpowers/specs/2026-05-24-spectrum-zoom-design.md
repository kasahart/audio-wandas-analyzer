# パワースペクトル・波形ズーム操作追加 設計書

**Goal:** パワースペクトルに周波数軸・dB 軸の独立ズームと矩形選択ズームを追加し、波形エリアにモード切り替え式の矩形範囲ズームを追加する。ヘルプ表示に新操作の説明を補完する。Issue #67 をクローズする。

**Architecture:** `comparisonRenderScript.ts` にスペクトルズーム状態変数を追加し、既存の `zoomStart`/`zoomEnd` パターンを踏襲。描画関数にズーム範囲を渡してマッピングを変更。`comparisonRenderScript.ts` の `buildResultsPane`/`buildToolbar` にスペクトルツールバー行と波形モードボタンを追加。`ComparisonPanel.ts` はテスト用型フィールドのみ追加。

**Tech Stack:** TypeScript (webview template literal)、Canvas 2D API、`src/shared/i18n/strings.ts`

---

## 1. 状態変数

`comparisonRenderScript.ts` の module-level 変数（既存 `zoomStart`/`zoomEnd` の直後）に追加：

```js
// ── スペクトルズーム ──────────────────────────────────────────
// 周波数軸ズーム（0..1 正規化：0=0Hz, 1=maxFrequencyHz）
let specFreqStart = 0;
let specFreqEnd   = 1;
// dB 軸ズーム（null = データの min/max を自動使用）
let specDbMin = null;  // number | null
let specDbMax = null;  // number | null
// 矩形ドラッグ状態（スペクトルキャンバス上）
let specDragAnchor  = null;  // { freqNorm: number, dbNorm: number } | null
let specDragCurrent = null;  // { freqNorm: number, dbNorm: number } | null

// dB ズームボタン用キャッシュ（直前レンダリング時の実際の表示範囲）
let _lastVisDbMin = null;  // number | null
let _lastVisDbMax = null;  // number | null

// ── 波形ドラッグモード ────────────────────────────────────────
let waveformMode = 'loop';   // 'loop' | 'rect-zoom'
```

---

## 2. 描画関数の変更

### 2-1. `drawSpectrumLine` シグネチャ変更

```js
// 変更前
function drawSpectrumLine(ctx, W, H, slice, color, opts)

// 変更後
function drawSpectrumLine(ctx, W, H, slice, color, opts, visFreqMin, visFreqMax, visDbMin, visDbMax)
```

`visFreqMin`/`visFreqMax`/`visDbMin`/`visDbMax` が渡されない場合（既存呼び出し互換）はデフォルト値（slice 全域）を使う：

```js
const _visFreqMin = (visFreqMin != null) ? visFreqMin : 0;
const _visFreqMax = (visFreqMax != null) ? visFreqMax : slice.maxFrequencyHz;
const _visDbMin   = (visDbMin   != null) ? visDbMin   : slice.minDb;
const _visDbMax   = (visDbMax   != null) ? visDbMax   : slice.maxDb;
const range = _visDbMax - _visDbMin;
if (range <= 0) { return; }
```

X 軸マッピング（周波数 → canvas X 座標）：

```js
// 変更前
const x = padL + (fHz / slice.maxFrequencyHz) * plotW;

// 変更後
const x = padL + ((fHz - _visFreqMin) / (_visFreqMax - _visFreqMin)) * plotW;
```

Y 軸マッピング（dB → canvas Y 座標）：

```js
// 変更前
const norm = (v - slice.minDb) / range;

// 変更後
const norm = (v - _visDbMin) / range;
```

既存の `ctx.save()`/`ctx.clip()`/`ctx.restore()` は変更なし（範囲外は自動的にクリッピング）。

### 2-2. `drawSpectrumAxes` シグネチャ変更

```js
// 変更前
function drawSpectrumAxes(ctx, W, H, slice, padL, padR, padT, padB)

// 変更後
function drawSpectrumAxes(ctx, W, H, slice, padL, padR, padT, padB, visFreqMin, visFreqMax, visDbMin, visDbMax)
```

軸ラベルをズーム範囲で描画：

```js
const _visFreqMin = (visFreqMin != null) ? visFreqMin : 0;
const _visFreqMax = (visFreqMax != null) ? visFreqMax : slice.maxFrequencyHz;
const _visDbMin   = (visDbMin   != null) ? visDbMin   : slice.minDb;
const _visDbMax   = (visDbMax   != null) ? visDbMax   : slice.maxDb;

// Y 軸ラベル（dB）
ctx.fillText(_visDbMax.toFixed(0) + ' dB', padL - 2, padT);
ctx.fillText(((_visDbMax + _visDbMin) / 2).toFixed(0) + ' dB', padL - 2, padT + plotH / 2);
ctx.fillText(_visDbMin.toFixed(0) + ' dB', padL - 2, H - padB);

// X 軸ラベル（Hz）
ctx.fillText(formatHz(_visFreqMin), padL, H - 1);
ctx.fillText(formatHz((_visFreqMin + _visFreqMax) / 2), padL + plotW / 2, H - 1);
ctx.fillText(formatHz(_visFreqMax), W - padR, H - 1);
```

### 2-3. `renderTrackSpectra` の呼び出し変更

```js
const visFreqMin = specFreqStart * slice.maxFrequencyHz;
const visFreqMax = specFreqEnd   * slice.maxFrequencyHz;
const visDbMin   = specDbMin ?? slice.minDb;
const visDbMax   = specDbMax ?? slice.maxDb;

drawSpectrumAxes(ctx, W, H, slice, 32, 6, 4, 14, visFreqMin, visFreqMax, visDbMin, visDbMax);
drawSpectrumLine(ctx, W, H, slice, color, { padL: 32, padR: 6, padT: 4, padB: 14 }, visFreqMin, visFreqMax, visDbMin, visDbMax);
```

### 2-4. `renderOverlaySpectrum` の呼び出し変更

共通の `visFreqMin`/`visFreqMax` をスライス群の `maxF` に基づいて計算：

```js
const visFreqMin = specFreqStart * maxF;
const visFreqMax = specFreqEnd   * maxF;

// sharedAxis にも反映
const sharedAxis = { ..., minDb: visDbMin, maxDb: visDbMax };
drawSpectrumAxes(ctx, W, H, sharedAxis, padL, padR, padT, padB, visFreqMin, visFreqMax, visDbMin, visDbMax);

// inline ループの X マッピングを変更
const x = padL + ((fHz - visFreqMin) / (visFreqMax - visFreqMin)) * plotW;
const norm = (v - visDbMin) / (visDbMax - visDbMin);
```

`visDbMin = specDbMin ?? minDb`、`visDbMax = specDbMax ?? maxDb`（minDb/maxDb は全スライスから算出済みの値）。

### 2-5. ゴムバンド矩形の描画

`renderOverlaySpectrum` の末尾（既存ホバーカーソル描画の後）に追加：

```js
// 矩形ドラッグ中のゴムバンド表示
// freqNorm / dbNorm は「現在の可視範囲内での 0..1 相対値」（mousedown 時に padL..plotW で正規化済み）
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

---

## 3. HTML 変更 (`comparisonRenderScript.ts`)

### 3-1. スペクトルツールバー行

`#spectrum-overlay-wrap` の直前に挿入：

```html
<div id="spectrum-zoom-toolbar" style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:11px;">
  <span class="tb-label">${STR.spectrumZoomLabel}</span>
  <button class="tb-btn" data-action="spec-zoom-out" aria-label="${STR.ariaSpecZoomOut}">－</button>
  <button class="tb-btn" data-action="spec-zoom-in"  aria-label="${STR.ariaSpecZoomIn}">＋</button>
  <button class="tb-btn" data-action="spec-zoom-reset" aria-label="${STR.ariaSpecZoomReset}">${STR.btnSpecZoomReset}</button>
</div>
```

### 3-2. 波形モード切り替えボタン

既存ツールバー（zoom-reset ボタンの後）に追加：

```html
<span class="tb-sep"></span>
<button class="tb-btn" id="btn-wave-mode-loop"      data-action="wave-mode-loop"      aria-pressed="true">${STR.waveModeLabelLoop}</button>
<button class="tb-btn" id="btn-wave-mode-rect-zoom" data-action="wave-mode-rect-zoom" aria-pressed="false">${STR.waveModeLabelRectZoom}</button>
```

`aria-pressed` は `waveformMode` に応じて動的に更新。

---

## 4. インタラクション実装

### 4-1. スペクトルズームボタン

```js
function specZoomIn() {
    const fc = (specFreqStart + specFreqEnd) / 2;
    const fh = (specFreqEnd - specFreqStart) / 2 * 0.7;
    specFreqStart = Math.max(0, fc - fh);
    specFreqEnd   = Math.min(1, fc + fh);

    const dc = ((specDbMin ?? -Infinity) + (specDbMax ?? Infinity)) / 2;  // 実際は data 範囲を使う
    // dB ズームは renderOverlaySpectrum 内で確定した minDb/maxDb を基準にする
    scheduleRender();
}

function specZoomOut() { /* 逆方向 */ }

function specZoomReset() {
    specFreqStart = 0; specFreqEnd = 1;
    specDbMin = null;  specDbMax = null;
    scheduleRender();
}
```

dB 軸の zoom in/out は、現在の表示 `visDbMin`/`visDbMax` を基準に 0.7 倍／1/0.7 倍する。`renderOverlaySpectrum` が呼ばれる時点で確定した値を使うため、ズームボタンハンドラでは前回レンダリング時の値をキャッシュしておく（`let _lastVisDbMin`, `_lastVisDbMax`）。

### 4-2. スペクトルキャンバス矩形ドラッグ

`#spectrum-overlay-canvas` のイベントハンドラ（既存 `mousemove` ハンドラ内の分岐として追加）：

```js
// mousedown
function onSpecCanvasMouseDown(e) {
    const { freqNorm, dbNorm } = canvasPosToDragCoord(e, canvas);
    specDragAnchor  = { freqNorm, dbNorm };
    specDragCurrent = { freqNorm, dbNorm };
}

// mousemove（ドラッグ中）
function onSpecCanvasMouseMove(e) {
    if (specDragAnchor !== null) {
        specDragCurrent = canvasPosToDragCoord(e, canvas);
        scheduleRender();
        return;  // ホバーカーソルは更新しない
    }
    // 既存ホバー処理
}

// mouseup
function onSpecCanvasMouseUp(e) {
    if (specDragAnchor === null) { return; }
    const dx = /* canvas px 差 */;
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
        // クリック扱い：ドラッグキャンセル
    } else {
        const f0 = Math.min(specDragAnchor.freqNorm, specDragCurrent.freqNorm);
        const f1 = Math.max(specDragAnchor.freqNorm, specDragCurrent.freqNorm);
        const d0Norm = Math.min(specDragAnchor.dbNorm, specDragCurrent.dbNorm);
        const d1Norm = Math.max(specDragAnchor.dbNorm, specDragCurrent.dbNorm);
        // freqNorm は現在の visFreqStart..visFreqEnd 内の値なので絶対正規化に変換
        const prevFreqStart = specFreqStart;
        const prevFreqEnd   = specFreqEnd;
        specFreqStart = prevFreqStart + f0 * (prevFreqEnd - prevFreqStart);
        specFreqEnd   = prevFreqStart + f1 * (prevFreqEnd - prevFreqStart);
        // dB: dbNorm=0 が visDbMin、dbNorm=1 が visDbMax
        const visDbRange = (_lastVisDbMax - _lastVisDbMin);
        specDbMin = _lastVisDbMin + d0Norm * visDbRange;
        specDbMax = _lastVisDbMin + d1Norm * visDbRange;
    }
    specDragAnchor = null; specDragCurrent = null;
    scheduleRender();
}
```

`canvasPosToDragCoord(e, canvas)` はキャンバス座標から `{freqNorm, dbNorm}` を返すヘルパー：
- `freqNorm = clamp((mouseX - padL) / plotW, 0, 1)` — 現在表示範囲内 0..1
- `dbNorm   = clamp(1 - (mouseY - padT) / plotH, 0, 1)` — 下端=0、上端=1（Y 軸反転に注意）
- padding 定数は overlay と同じ `padL=36, padR=8, padT=8, padB=18`

### 4-3. 波形モード切り替え

```js
} else if (action === 'wave-mode-loop') {
    waveformMode = 'loop';
    document.getElementById('btn-wave-mode-loop').setAttribute('aria-pressed', 'true');
    document.getElementById('btn-wave-mode-rect-zoom').setAttribute('aria-pressed', 'false');
} else if (action === 'wave-mode-rect-zoom') {
    waveformMode = 'rect-zoom';
    document.getElementById('btn-wave-mode-loop').setAttribute('aria-pressed', 'false');
    document.getElementById('btn-wave-mode-rect-zoom').setAttribute('aria-pressed', 'true');
```

波形キャンバスの `mousedown`/`mousemove`/`mouseup` に `waveformMode` の分岐を追加。`rect-zoom` モードでは既存ドラッグ処理をスキップし、選択範囲を `zoomStart`/`zoomEnd` に適用。

---

## 5. i18n キー (`src/shared/i18n/strings.ts`)

追加する 9 キー：

| キー | EN | JA |
|------|----|----|
| `spectrumZoomLabel` | `'Spectrum'` | `'スペクトル'` |
| `ariaSpecZoomIn` | `'Spectrum zoom in'` | `'スペクトル拡大'` |
| `ariaSpecZoomOut` | `'Spectrum zoom out'` | `'スペクトル縮小'` |
| `ariaSpecZoomReset` | `'Spectrum zoom reset'` | `'スペクトルズームリセット'` |
| `btnSpecZoomReset` | `'All'` | `'全域'` |
| `helpRowSpectrumDrag` | `'drag zoom (spectrum)'` | `'矩形ズーム (スペクトル)'` |
| `helpRowWaveRectZoom` | `'drag zoom (waveform rect-zoom mode)'` | `'矩形ズーム (波形ズームモード時)'` |
| `waveModeLabelLoop` | `'🔁 Loop'` | `'🔁 ループ'` |
| `waveModeLabelRectZoom` | `'🔲 Zoom'` | `'🔲 ズーム'` |

---

## 6. ヘルプオーバーレイ (`HELP_ROWS` 配列)

追加する 2 行：

```js
{ shortcut: 'Drag (spectrum)',   labelKey: 'helpRowSpectrumDrag' },
{ shortcut: 'Drag (zoom mode)', labelKey: 'helpRowWaveRectZoom' },
```

---

## 7. 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/webview/comparisonRenderScript.ts` | 状態変数追加、`drawSpectrumLine`/`drawSpectrumAxes` シグネチャ変更、描画ループ変更、ゴムバンド描画、イベントハンドラ追加、ボタンアクション追加、ヘルプ行追加 |
| `src/webview/panels/ComparisonPanel.ts` | テスト用スナップショット型 `ComparisonPanelRenderedUi` に 3 フィールド追加のみ |
| `src/shared/i18n/strings.ts` | 9 キー追加 |

---

## 8. 完了条件

- `npm run verify` がパスする
- スペクトルキャンバス上でドラッグすると矩形が表示され、離した時点でズームが適用される
- スペクトル専用ツールバーの ＋/－/全域 ボタンが機能する
- 波形エリアで「ズームモード」に切り替えるとドラッグで時間範囲ズームができる
- ヘルプオーバーレイ（? キー）に新操作の説明が含まれる
- Issue #67 クローズ
