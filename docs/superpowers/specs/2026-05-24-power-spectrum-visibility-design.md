# パワースペクトル描画の視認性改善 設計書

**Goal:** パワースペクトルの周波数ラベル重なりを除去し、縦軸下限未満の値がプロット下端に貼り付く描画バグを修正する。Issue #66 をクローズする。

**Architecture:** `comparisonRenderScript.ts` の Canvas 描画関数を修正する。クリッピングは Canvas 2D API の `ctx.save()`／`ctx.clip()`／`ctx.restore()` パターンで行い、値のクランプは除去する。

**Tech Stack:** TypeScript (webview template literal)、Canvas 2D API

---

## 1. 問題と対処

### Problem 1 — 周波数ラベルがスペクトルラインに重なる

`drawSpectrumPeakAnnotations` がトラックスペクトルキャンバス上にピーク周波数ラベルを描画しており、スペクトルラインと重なって視認性を損なっている。

**対処:** `drawSpectrumPeakAnnotations` 関数と全呼び出し箇所を削除する。

削除対象：
- 関数定義 (`drawSpectrumPeakAnnotations`、`comparisonRenderScript.ts` 内)
- `renderTrackSpectra` 内の呼び出し行 1 行

### Problem 2 — 縦軸下限未満の値がプロット下端に貼り付く

`drawSpectrumLine` および `renderOverlaySpectrum` の inline ループで、`norm` を `Math.max(0, ...)` でクランプしているため、`minDb` 未満の値が y = bottom に貼り付いて表示される。

**対処:** クランプを除去し、プロット領域を Canvas クリッピング矩形で囲む。

```js
// 修正後パターン（drawSpectrumLine）
ctx.save();
ctx.beginPath();
ctx.rect(padL, padT, plotW, plotH);
ctx.clip();

ctx.strokeStyle = color;
ctx.lineWidth = (opts && opts.lineWidth) || 1.2;
ctx.beginPath();
for (let i = 0; i < fBins; i++) {
    const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
    if (fHz > slice.maxFrequencyHz) { break; }
    const x = padL + (fHz / slice.maxFrequencyHz) * plotW;
    const v = slice.values[i];
    const norm = (v - slice.minDb) / range;   // クランプなし
    const y = padT + (1 - norm) * plotH;
    if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
}
ctx.stroke();
ctx.restore();
```

同様の修正を `renderOverlaySpectrum` の inline ループにも適用する。

---

## 2. 対象ファイルと変更箇所

| ファイル | 変更内容 |
|---------|---------|
| `src/webview/comparisonRenderScript.ts` | `drawSpectrumPeakAnnotations` 削除、`drawSpectrumLine` クリッピング化、`renderOverlaySpectrum` inline ループクリッピング化 |

---

## 3. 変更詳細

### 3-1. `drawSpectrumPeakAnnotations` の削除

`comparisonRenderScript.ts` の以下を削除する：
- `function drawSpectrumPeakAnnotations(...)` ブロック全体（約 32 行）
- `renderTrackSpectra` 内の `drawSpectrumPeakAnnotations(ctx, W, H, peaks, ...)` 呼び出し 3 行（peaks 取得含む）

### 3-2. `drawSpectrumLine` のクリッピング化

現在（バグあり）:
```js
ctx.beginPath();
for (let i = 0; i < fBins; i++) {
    ...
    const norm = Math.max(0, Math.min(1, (v - slice.minDb) / range));
    ...
}
ctx.stroke();
```

修正後:
```js
ctx.save();
ctx.beginPath();
ctx.rect(padL, padT, plotW, plotH);
ctx.clip();
ctx.strokeStyle = color;
ctx.lineWidth = (opts && opts.lineWidth) || 1.2;
ctx.beginPath();
for (let i = 0; i < fBins; i++) {
    const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
    if (fHz > slice.maxFrequencyHz) { break; }
    const x = padL + (fHz / slice.maxFrequencyHz) * plotW;
    const v = slice.values[i];
    const norm = (v - slice.minDb) / range;
    const y = padT + (1 - norm) * plotH;
    if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
}
ctx.stroke();
ctx.restore();
```

`ctx.strokeStyle` と `ctx.lineWidth` の設定を `ctx.save()` の後に移動する点に注意（save/restore でリセットされないが順序を明確にする）。

### 3-3. `renderOverlaySpectrum` のクリッピング化

`slices.forEach` 内の描画ループを `ctx.save()` / `ctx.clip()` / `ctx.restore()` で囲み、`norm` のクランプを除去する：

```js
ctx.save();
ctx.beginPath();
ctx.rect(padL, padT, plotW, plotH);
ctx.clip();

slices.forEach(function(s) {
    if (range <= 0) { return; }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const fBins = s.slice.frequencyBins;
    const originalMaxFreq = s.slice.originalMaxFrequencyHz || s.slice.maxFrequencyHz;
    for (let i = 0; i < fBins; i++) {
        const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
        if (fHz > maxF) { break; }
        const x = padL + (fHz / maxF) * plotW;
        const v = s.slice.values[i];
        const norm = (v - minDb) / range;    // クランプなし
        const y = padT + (1 - norm) * plotH;
        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
});

ctx.restore();
```

---

## 4. テスト

### 手動確認
- スペクトルパネルで cursor を動かしたとき、プロット下端への貼り付きが消えること
- オーバーレイスペクトルでも同様
- 周波数ラベルが消えてラインが見やすくなること

### `npm run verify`
TypeScript コンパイル + webview lint + node:test + ruff check + ruff format + pytest がすべてパスすること。

---

## 5. 完了条件

- `drawSpectrumPeakAnnotations` が削除されている
- `drawSpectrumLine` が `ctx.clip()` を使い、`norm` にクランプがない
- `renderOverlaySpectrum` の inline ループも同様
- `npm run verify` がパスする
- Issue #66 クローズ
