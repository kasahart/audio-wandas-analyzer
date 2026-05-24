# パワースペクトル描画の視認性改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** パワースペクトルの周波数ラベル重なりを除去し、縦軸下限未満の値がプロット下端に貼り付くバグを Canvas クリッピングで修正する。

**Architecture:** `src/webview/comparisonRenderScript.ts` 1ファイルのみ変更。Canvas 2D API の `ctx.save()`/`ctx.clip()`/`ctx.restore()` でプロット領域を切り取り、値クランプを除去する。`drawSpectrumPeakAnnotations` は関数定義ごと削除。

**Tech Stack:** TypeScript (webview template literal)、Canvas 2D API

---

## File Map

| ファイル | 操作 | 内容 |
|---------|------|------|
| `src/webview/comparisonRenderScript.ts` | Modify | ① `drawSpectrumPeakAnnotations` 削除、② `drawSpectrumLine` クリッピング化、③ `renderOverlaySpectrum` クリッピング化 |

---

## Context: コードベース概要

`comparisonRenderScript.ts` は webview の `<script>` タグに埋め込まれる TypeScript ファイルで、ビルド時にテンプレートリテラルに展開される。Canvas 2D でスペクトルを描画する関数群が含まれる：

- `drawSpectrumLine(ctx, W, H, slice, color, opts)` — トラックごとのスペクトルラインを描画
- `drawSpectrumAxes(ctx, W, H, slice, padL, padR, padT, padB)` — 軸ラベルを描画（変更なし）
- `drawSpectrumPeakAnnotations(ctx, W, H, peaks, ...)` — ピーク周波数ラベルを描画（削除対象）
- `renderTrackSpectra()` — 各トラックキャンバスを更新
- `renderOverlaySpectrum()` — オーバーレイキャンバスを更新

`npm run verify` = tsc compile + webview lint + node:test + ruff check + ruff format + pytest。Canvas 描画は webview runtime のため直接ユニットテストなし。verify がパスすれば完了。

---

## Task 1: `drawSpectrumPeakAnnotations` を削除する

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

`drawSpectrumPeakAnnotations` はスペクトルラインの上にピーク周波数ラベルを描画するが、ラインと重なり視認性を損なう。削除する。

- [ ] **Step 1: 関数定義を削除する**

`comparisonRenderScript.ts` から以下の関数ブロック全体（約32行）を削除する：

```js
// 削除対象 — この関数ブロック全体を消す
function drawSpectrumPeakAnnotations(ctx, W, H, peaks, maxFrequencyHz, minDb, maxDb, padL, padR, padT, padB) {
    if (!peaks || peaks.length === 0) { return; }
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var range = maxDb - minDb;
    if (range <= 0 || plotW <= 0 || maxFrequencyHz <= 0) { return; }
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,180,0.85)';
    ctx.fillStyle = 'rgba(255,255,180,0.95)';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (var pi = 0; pi < peaks.length; pi++) {
        var p = peaks[pi];
        if (!p || p.freqHz == null || p.amplitudeDb == null) { continue; }
        if (p.freqHz <= 0 || p.freqHz > maxFrequencyHz) { continue; }
        var x = padL + (p.freqHz / maxFrequencyHz) * plotW;
        var norm = Math.max(0, Math.min(1, (p.amplitudeDb - minDb) / range));
        var y = padT + (1 - norm) * plotH;
        // Vertical tick mark at peak
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x, y + 4);
        ctx.stroke();
        // Frequency label above tick — reuse formatHz() for consistent units
        var label = formatHz(p.freqHz);
        var labelY = y - 8;
        if (labelY < padT + 10) { labelY = y + 14; }
        ctx.fillText(label, x, labelY);
    }
    ctx.restore();
}
```

- [ ] **Step 2: `renderTrackSpectra` 内の呼び出しを削除する**

`renderTrackSpectra` 内の以下の3行を削除する（peaks取得＋呼び出し）：

```js
// 削除対象 — この3行を消す
const ch0 = result.channels && result.channels[0];
const peaks = ch0 && ch0.peaks;
drawSpectrumPeakAnnotations(ctx, W, H, peaks, slice.maxFrequencyHz, slice.minDb, slice.maxDb, 32, 6, 4, 14);
```

- [ ] **Step 3: `renderOverlaySpectrum` 内の呼び出しを削除する**

`renderOverlaySpectrum` 内の `slices.forEach` 中の以下の3行を削除する：

```js
// 削除対象 — この3行を消す
const overlayResult = state.results[s.index];
const overlayPeaks = overlayResult && overlayResult.channels && overlayResult.channels[0] && overlayResult.channels[0].peaks;
drawSpectrumPeakAnnotations(ctx, W, H, overlayPeaks, maxF, minDb, maxDb, padL, padR, padT, padB);
```

- [ ] **Step 4: verify を実行してコンパイルエラーがないことを確認する**

```bash
npm run verify
```

Expected: 全ステップ PASS（tsc エラーなし）

- [ ] **Step 5: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(spectrum): remove peak frequency annotations (Issue #66)"
```

---

## Task 2: `drawSpectrumLine` をクリッピング化する

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

現在の `drawSpectrumLine` は `norm = Math.max(0, Math.min(1, (v - slice.minDb) / range))` でクランプしているため、`minDb` 未満の値が y = プロット下端に貼り付く。Canvas クリッピングで解決する。

- [ ] **Step 1: `drawSpectrumLine` を書き換える**

現在のコード（`drawSpectrumLine` 関数内）：

```js
function drawSpectrumLine(ctx, W, H, slice, color, opts) {
    const fBins = slice.frequencyBins;
    const range = slice.maxDb - slice.minDb;
    if (range <= 0) { return; }
    const padL = (opts && opts.padL) || 0;
    const padR = (opts && opts.padR) || 0;
    const padT = (opts && opts.padT) || 0;
    const padB = (opts && opts.padB) || 0;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    ctx.strokeStyle = color;
    ctx.lineWidth = (opts && opts.lineWidth) || 1.2;
    ctx.beginPath();
    const originalMaxFreq = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
    for (let i = 0; i < fBins; i++) {
        const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
        if (fHz > slice.maxFrequencyHz) { break; }
        const x = padL + (fHz / slice.maxFrequencyHz) * plotW;
        const v = slice.values[i];
        const norm = Math.max(0, Math.min(1, (v - slice.minDb) / range));
        const y = padT + (1 - norm) * plotH;
        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
}
```

以下に置き換える：

```js
function drawSpectrumLine(ctx, W, H, slice, color, opts) {
    const fBins = slice.frequencyBins;
    const range = slice.maxDb - slice.minDb;
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
}
```

変更点：
- `ctx.save()` を先頭に追加
- `ctx.beginPath()` + `ctx.rect(padL, padT, plotW, plotH)` + `ctx.clip()` でプロット領域をクリッピング
- `norm` の `Math.max(0, Math.min(1, ...))` を除去（クランプなし）
- 末尾に `ctx.restore()` を追加

- [ ] **Step 2: verify を実行する**

```bash
npm run verify
```

Expected: 全ステップ PASS

- [ ] **Step 3: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "fix(spectrum): use canvas clip in drawSpectrumLine, remove value clamping (Issue #66)"
```

---

## Task 3: `renderOverlaySpectrum` の inline ループをクリッピング化する

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

### 背景

`renderOverlaySpectrum` の `slices.forEach` 内にも同じクランプバグがある。`drawSpectrumLine` を再利用できないのは、オーバーレイが全スライスで共通の `minDb`/`maxDb`/`maxF` を使うため（スライスごとの値ではなく）。ここも Canvas クリッピングで修正する。

- [ ] **Step 1: `renderOverlaySpectrum` の描画ループを書き換える**

`renderOverlaySpectrum` 内の `drawSpectrumAxes` 呼び出しの直後から `ctx.restore()` を追加するまでを書き換える。

現在のコード（Task 1 で `drawSpectrumPeakAnnotations` 呼び出しは既に削除済み）：

```js
const plotW = W - padL - padR;
const plotH = H - padT - padB;
const range = maxDb - minDb;
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
        const norm = Math.max(0, Math.min(1, (v - minDb) / range));
        const y = padT + (1 - norm) * plotH;
        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
});
```

以下に置き換える：

```js
const plotW = W - padL - padR;
const plotH = H - padT - padB;
const range = maxDb - minDb;
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
        const norm = (v - minDb) / range;
        const y = padT + (1 - norm) * plotH;
        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
});
ctx.restore();
```

変更点：
- `slices.forEach` の前に `ctx.save()` + clip 設定を追加
- `norm` のクランプを除去
- `slices.forEach` の後に `ctx.restore()` を追加

- [ ] **Step 2: verify を実行して全テストがパスすることを確認する**

```bash
npm run verify
```

Expected: 全ステップ PASS

- [ ] **Step 3: コミットする**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "fix(spectrum): use canvas clip in renderOverlaySpectrum, remove value clamping (Issue #66)"
```

---

## Task 4: PR を作成して Issue #66 をクローズする

**Files:**
- なし（GitHub 操作のみ）

- [ ] **Step 1: PR を作成する**

```bash
gh pr create \
  --title "fix(spectrum): remove peak annotations, fix below-minDb clamping with canvas clip (Issue #66)" \
  --body "## 概要

Issue #66 の2つの問題を修正する。

### 変更内容

**1. 周波数ラベル削除**
`drawSpectrumPeakAnnotations` 関数と全呼び出し箇所を削除。スペクトルラインとの重なりがなくなり視認性が向上する。

**2. 下限未満値の貼り付き修正**
\`drawSpectrumLine\` および \`renderOverlaySpectrum\` で \`Math.max(0, Math.min(1, norm))\` によるクランプを除去し、Canvas 2D の \`ctx.clip()\` でプロット領域を切り取る方式に変更。下限未満の値はプロット領域外に描画されるがクリッピングで不可視となり、ラインが連続したままプロット境界でスパッと切れる。

Closes #66

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
  --base main
```

- [ ] **Step 2: CI が通ることを確認してマージする**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

- [ ] **Step 3: Issue #66 がクローズされていることを確認する**

PR マージ時に `Closes #66` で自動クローズされる。GitHub で確認する：

```bash
gh issue view 66 --json state -q .state
```

Expected: `"CLOSED"`
