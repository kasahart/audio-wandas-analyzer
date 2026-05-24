# Track Color & Drag Sort Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ユーザーが各トラックの色をパレットポップオーバーで変更でき、凡例/トラック行をドラッグして表示順を並び替えられるようにする。

**Architecture:** `displayOrder: number[]` 配列（表示位置 → `state.results` 添え字）を新規追加し、すべての描画ループをこの配列経由に統一する。トラックの色は `trackRuntime[i].color`（null = デフォルト色にフォールバック）で管理する。`state.results` 配列自体は変更せず、DOM ID も添え字で固定されたままにすることで既存コードへの影響を最小化する。

**Tech Stack:** TypeScript（テンプレートリテラル埋め込みJS）、HTML5 Drag and Drop API、CSS flexbox DOM 並び替え、既存ポップオーバーパターン

---

## ファイル構成

| ファイル | 変更種別 | 責務 |
|---------|---------|------|
| `src/webview/comparisonRenderScript.ts` | Modify | displayOrder・trackRuntime.color 追加、描画ループ変更、カラーピッカーポップオーバー、ドラッグ＆ドロップ実装 |
| `src/shared/i18n/strings.ts` | Modify | カラーピッカー・ドラッグハンドル用 ARIA ラベル 4 キー追加 |
| `src/e2e/suite/index.ts` | Modify | スナップショットに `displayOrder` フィールド追加 |
| `src/test/trackOrder.test.ts` | Create | `displayOrder` 操作ロジックのユニットテスト |

---

## Section 1: アーキテクチャ — ランタイム状態の拡張

### displayOrder と trackRuntime.color

```js
// 初期化（既存 trackRuntime 定義の直後）
let displayOrder = state.results.map(function(_, i) { return i; });
// displayOrder[表示位置] = state.results 添え字

// trackRuntime に color フィールドを追加
const trackRuntime = state.results.map(function() {
    return { offsetSeconds: 0, hidden: false, color: null };
});

// 色解決ヘルパー
function trackColor(i) {
    return trackRuntime[i].color || TRACK_COLORS[i % TRACK_COLORS.length];
}
```

### 描画ループの変更

対象 7 箇所を `displayOrder` 経由に変更する。変更パターンは統一：

```js
// Before
state.results.forEach(function(result, i) {
    // ... result, i を使用
});

// After
displayOrder.forEach(function(stateIdx) {
    var result = state.results[stateIdx];
    // ... result, stateIdx を使用（i → stateIdx に読み替え）
});
```

変更対象関数：
1. `buildResultsPane` 内のトラック行ビルド (`tracks` 変数)
2. `buildResultsPane` 内のメトリクスバービルド (`metrics` 変数)
3. `renderStackedTracks`
4. `computeGlobalSpan`
5. `renderSpectrumOverlay` のスライス収集ループ
6. `buildAudioElements`
7. `refreshSpectrumViews` 内のスペクトラムキャンバス更新ループ

### analysis-update 時のリセット

再解析でファイル構成が変わるため、`displayOrder` をリセットする：

```js
if (msg.type === 'analysis-update' && Array.isArray(msg.results)) {
    // ... 既存処理 ...
    displayOrder = msg.results.map(function(_, i) { return i; });
    scheduleRender();
}
```

---

## Section 2: カラーピッカー

### スウォッチ — buildTrackRow への追加

`buildTrackRow` の `track-header` 先頭（`track-name` の直前）に追加：

```js
'<div class="track-color-swatch" data-action="pick-color" data-track-index="' + i + '"'
+ ' style="background:' + trackColor(i) + '"'
+ ' role="button" tabindex="0"'
+ ' aria-label="' + escHtml(STR.ariaPickColor) + '"'
+ ' title="' + escHtml(STR.trackPickColor) + '"></div>'
```

メトリクスバーの `metrics-swatch` に ID を付与：

```js
'<div class="metrics-swatch" id="metrics-swatch-' + stateIdx + '"'
+ ' style="background:' + trackColor(stateIdx) + '"></div>'
```

### パレットポップオーバー

スペクトログラム設定ポップオーバーと同じパターンで `__buildColorPopover()` 関数を追加：

```js
const COLOR_PALETTE = [
    '#4ec994','#ff8c4a','#4a9eff','#e8637a','#c084fc',
    '#f0c040','#40b0d0','#d09060','#80c080','#a0a0ff'
];

(function __buildColorPopover() {
    var swatches = COLOR_PALETTE.map(function(hex) {
        return '<div class="color-palette-swatch" data-color="' + hex + '"'
             + ' style="background:' + hex + '" role="button" tabindex="0"'
             + ' aria-label="' + hex + '"></div>';
    }).join('');
    var html = '<div id="color-picker-popover" hidden'
        + ' style="position:absolute;z-index:60;background:var(--panel);'
        + 'border:1px solid var(--line);padding:8px;border-radius:6px;">'
        + '<div style="display:flex;flex-wrap:wrap;gap:4px;width:144px">' + swatches + '</div>'
        + '<button id="color-reset-btn" style="margin-top:6px;width:100%;font-size:11px">'
        + escHtml(STR.trackColorReset) + '</button>'
        + '</div>';
    var el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el.firstChild);
})();
```

ポップオーバーの開閉：

```js
var __colorPickTarget = null; // 現在ピッカーを開いているトラックの state index

function openColorPicker(stateIdx, anchorEl) {
    __colorPickTarget = stateIdx;
    var pop = document.getElementById('color-picker-popover');
    var rect = anchorEl.getBoundingClientRect();
    pop.style.top  = (rect.bottom + 4) + 'px';
    pop.style.left = rect.left + 'px';
    pop.removeAttribute('hidden');
}

function closeColorPicker() {
    var pop = document.getElementById('color-picker-popover');
    if (pop) { pop.setAttribute('hidden', ''); }
    __colorPickTarget = null;
}
```

### 色変更の反映パス

```js
// ポップオーバー内の色スウォッチクリック
pop.addEventListener('click', function(e) {
    var sw = e.target.closest('.color-palette-swatch');
    if (sw && __colorPickTarget !== null) {
        var hex = sw.dataset.color;
        trackRuntime[__colorPickTarget].color = hex;
        // track-header swatch を即時更新
        var headerSwatch = document.querySelector(
            '[data-action="pick-color"][data-track-index="' + __colorPickTarget + '"]');
        if (headerSwatch) { headerSwatch.style.background = hex; }
        // metrics-bar swatch を即時更新
        var metricsSwatch = document.getElementById('metrics-swatch-' + __colorPickTarget);
        if (metricsSwatch) { metricsSwatch.style.background = hex; }
        scheduleRender();        // canvas 再描画
        refreshSpectrumViews();  // スペクトラム再描画
        closeColorPicker();
    }
    // リセットボタン
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

// 外クリックで閉じる（既存ポップオーバーと同じパターン）
document.addEventListener('click', function(e) {
    var pop = document.getElementById('color-picker-popover');
    if (pop && !pop.hidden && !pop.contains(e.target)
        && !e.target.closest('[data-action="pick-color"]')) {
        closeColorPicker();
    }
}, true);
```

---

## Section 3: ドラッグ＆ドロップ

### ドラッグハンドル — buildTrackRow への追加

カラースウォッチの左隣（`track-header` 先頭）に追加：

```js
'<div class="track-drag-handle" draggable="true" data-track-index="' + i + '"'
+ ' aria-label="' + escHtml(STR.ariaDragHandle) + '"'
+ ' title="' + escHtml(STR.ariaDragHandle) + '">≡</div>'
```

### リオーダー状態変数

既存の `dragState`（波形ループ用）と完全に別管理：

```js
var reorderDragFrom = null; // null | state index（ドラッグ元）
```

### イベントハンドラ

`buildLayout` 内 or 初期化ブロックで `#stacked-wrap` に委譲：

```js
var stackedWrap = document.getElementById('stacked-wrap');

stackedWrap.addEventListener('dragstart', function(e) {
    var handle = e.target.closest('.track-drag-handle');
    if (!handle) { e.preventDefault(); return; }
    reorderDragFrom = parseInt(handle.dataset.trackIndex, 10);
    e.dataTransfer.effectAllowed = 'move';
    var row = document.getElementById('track-row-' + reorderDragFrom);
    if (row) { row.style.opacity = '0.4'; }
});

stackedWrap.addEventListener('dragover', function(e) {
    if (reorderDragFrom === null) { return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var row = e.target.closest('.track-row');
    // ハイライト
    document.querySelectorAll('.track-row').forEach(function(r) {
        r.classList.remove('drag-over');
    });
    if (row && parseInt(row.dataset.trackIndex, 10) !== reorderDragFrom) {
        row.classList.add('drag-over');
    }
});

stackedWrap.addEventListener('drop', function(e) {
    if (reorderDragFrom === null) { return; }
    e.preventDefault();
    var row = e.target.closest('.track-row');
    if (!row) { cleanupReorderDrag(); return; }
    var toStateIdx = parseInt(row.dataset.trackIndex, 10);
    if (toStateIdx !== reorderDragFrom) {
        reorderTracks(reorderDragFrom, toStateIdx);
    }
    cleanupReorderDrag();
});

stackedWrap.addEventListener('dragend', function() {
    cleanupReorderDrag();
});

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

### reorderTracks

```js
function reorderTracks(fromStateIdx, toStateIdx) {
    var fromPos = displayOrder.indexOf(fromStateIdx);
    var toPos   = displayOrder.indexOf(toStateIdx);
    if (fromPos === -1 || toPos === -1) { return; }
    displayOrder.splice(fromPos, 1);
    displayOrder.splice(toPos, 0, fromStateIdx);

    // #stacked-wrap の DOM 順を更新
    var wrap = document.getElementById('stacked-wrap');
    displayOrder.forEach(function(idx) {
        var r = document.getElementById('track-row-' + idx);
        if (r) { wrap.appendChild(r); }
    });

    // #metrics-bar の DOM 順を更新
    var metricsBar = document.getElementById('metrics-bar');
    displayOrder.forEach(function(idx) {
        var item = document.getElementById('metrics-item-' + idx);
        if (item) { metricsBar.appendChild(item); }
    });

    scheduleRender();
    refreshSpectrumViews();
}
```

### CSS 追加（renderScript 内の `<style>` ブロック）

```css
.track-drag-handle {
    cursor: grab;
    padding: 0 6px;
    color: var(--muted);
    font-size: 14px;
    user-select: none;
}
.track-drag-handle:active { cursor: grabbing; }
.track-color-swatch {
    width: 14px; height: 14px;
    border-radius: 3px;
    cursor: pointer;
    flex-shrink: 0;
    border: 1px solid var(--line);
}
.color-palette-swatch {
    width: 20px; height: 20px;
    border-radius: 3px;
    cursor: pointer;
    border: 1px solid var(--line);
}
.color-palette-swatch:hover { outline: 2px solid var(--accent); }
.track-row.drag-over { outline: 2px solid var(--accent); }
```

---

## Section 4: i18n

`src/shared/i18n/strings.ts` の `UiStrings` インターフェースと `en`/`ja` 辞書に追加：

| キー | EN | JA |
|-----|----|----|
| `trackPickColor` | `'Change color'` | `'色を変更'` |
| `trackColorReset` | `'Reset to default'` | `'デフォルトに戻す'` |
| `ariaDragHandle` | `'Drag to reorder track'` | `'ドラッグしてトラックを並び替え'` |
| `ariaPickColor` | `'Change track color'` | `'トラック色を変更'` |

---

## Section 5: テスト

### ユニットテスト — `src/test/trackOrder.test.ts`

テスト対象: `displayOrder` 操作ロジックを純粋関数として抽出した `reorderInPlace(order, fromStateIdx, toStateIdx)`

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function reorderInPlace(order: number[], from: number, to: number): number[] {
    const result = [...order];
    const fromPos = result.indexOf(from);
    const toPos   = result.indexOf(to);
    result.splice(fromPos, 1);
    result.splice(toPos, 0, from);
    return result;
}

it('先頭から末尾に移動', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 0, 3), [1,2,3,0]);
});
it('末尾から先頭に移動', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 3, 0), [3,0,1,2]);
});
it('隣接要素の交換', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 1, 2), [0,2,1,3]);
});
it('同一要素は変化なし', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 2, 2), [0,1,2,3]);
});
```

`reorderInPlace` は `comparisonRenderScript.ts` のテンプレートリテラル内に定義するが、同一ロジックをユニットテストファイルに複製して検証する（テンプレートリテラル内関数は import できないため）。

### E2E スナップショット更新

`publishTestSnapshot()` に `displayOrder` を追加：

```js
displayOrder: displayOrder.slice(),
```

`src/e2e/suite/index.ts` で初期順を検証：

```ts
assert.deepEqual(
    snapshot.renderedUi.displayOrder,
    snapshot.renderedUi.results.map((_: unknown, i: number) => i)
);
```

---

## 受入条件

- [ ] トラックヘッダーの色スウォッチをクリックするとパレットポップオーバーが開く
- [ ] パレットから色を選ぶと波形・スペクトラム・メトリクスバーの色が即座に変わる
- [ ] 「リセット」でデフォルト色に戻る
- [ ] ドラッグハンドルでトラック行を並び替えると波形・スペクトラムの描画順も追従する
- [ ] 並び替え後に再解析すると displayOrder はリセットされる
- [ ] `npm run verify` がパス
