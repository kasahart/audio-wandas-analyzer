# Chart Double-Click Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** グラフのプロット内部ダブルクリックでズーム/レンジリセット、軸エリアのダブルクリックで軸レンジ設定ポップアップを開く。

**Architecture:** ChartSpecPanel の `chartSpecRenderScript.ts` に `activeAxis` 状態・軸別ポップアップレイアウト・dblclick ゾーン分岐を追加。ComparisonPanel の `comparisonRenderScript.ts` に波形キャンバス dblclick → zoom リセットを追加。TDD: テスト先行、実装後に全テスト通過を確認。

**Tech Stack:** TypeScript (source), JSDOM + node:test (unit tests), Canvas2D (rendering)

---

## ファイル構成

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `src/webview/chartSpecRenderScript.ts` | Modify | state・popup・redraw・event handler 全変更 |
| `src/webview/comparisonRenderScript.ts` | Modify | dblclick zoom reset 追加 |
| `src/test/chartSpecRangeControl.test.ts` | Modify | click→dblclick 変換・新テスト追加 |

---

## 座標リファレンス（テスト用）

ChartSpec キャンバスは `setupCanvas(720, 240)` で生成される。JSDOM 上では `getBoundingClientRect()` が `{ left:0, top:0 }` を返すため `clientX === cx`。

**line / bar チャート** `plot = { x:50, y:16, w:660, h:190 }`  
（w = 720−60 = 660, h = 240−50 = 190 → `plot.x + plot.w = 710`, `plot.y + plot.h = 206`）

| ゾーン | 判定 | テスト用座標例 |
|---|---|---|
| Y 軸 | cx < 50 | clientX:20, clientY:100 |
| X 軸 | cy > 206 かつ cx ∈ [50,710] | clientX:300, clientY:220 |
| プロット内部 | cx ∈ [50,710] かつ cy ∈ [16,206] | clientX:300, clientY:100 |

**heatmap チャート** `plot = { x:50, y:16, w:630, h:190 }`  
（w = 720−90 = 630 → `plot.x + plot.w = 680`）

| ゾーン | 判定 | テスト用座標例 |
|---|---|---|
| カラーバー | cx > 680 | clientX:690, clientY:100 |
| プロット内部 | cx ∈ [50,680] かつ cy ∈ [16,206] | clientX:300, clientY:100 |

---

## Task 1: テストを失敗状態で書く（ChartSpecPanel）

**Files:**
- Modify: `src/test/chartSpecRangeControl.test.ts`

- [ ] **Step 1: `setupChartEnv` から `range-popup` div を削除**

`buildRangePopup()` がポップアップを自動生成するため、テスト HTML のプリセット popup を削除する。  
`src/test/chartSpecRangeControl.test.ts` の `setupChartEnv` 関数を以下に置き換える：

```typescript
function setupChartEnv(specs: unknown[]) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="charts"></div>
    </body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = specs;
    win.__CHART_NO_RESULTS_LABEL__ = 'No results';
    win.__CHART_SCALAR_HEADERS__ = ['Label', 'Value', 'Unit'];

    applyCanvasStub(dom.window.document);

    const script = dom.window.document.createElement('script');
    script.textContent = getChartSpecRenderScript();
    dom.window.document.body.appendChild(script);
    return dom;
}
```

- [ ] **Step 2: `buildRangePopup()` 注入テストに新要素 ID チェックを追加**

`'range-popup が HTML になくても buildRangePopup() が注入する'` テストの末尾（`dom.window.close()` の直前）に追加：

```typescript
    assert.ok(dom.window.document.getElementById('range-min-x'),             '#range-min-x が存在すること');
    assert.ok(dom.window.document.getElementById('range-max-x'),             '#range-max-x が存在すること');
    assert.ok(dom.window.document.getElementById('popup-axis-badge'),        '#popup-axis-badge が存在すること');
    assert.ok(dom.window.document.getElementById('popup-inputs-vertical'),   '#popup-inputs-vertical が存在すること');
    assert.ok(dom.window.document.getElementById('popup-inputs-horizontal'), '#popup-inputs-horizontal が存在すること');
```

- [ ] **Step 3: 既存の Y 軸・カラーバー click テストを dblclick に変更**

以下の 4 テストで `'click'` イベントを `'dblclick'` に変更する（テスト名の日本語部分も「クリック」→「ダブルクリック」に変更）：

| テスト名（変更前） | 変更箇所 |
|---|---|
| `Line チャートの Y 軸エリアをクリックするとポップアップが開く` | テスト名 + `'click'` → `'dblclick'` |
| `Bar チャートの Y 軸エリアをクリックするとポップアップが開く` | テスト名 + `'click'` → `'dblclick'` |
| `Heatmap のカラーバーエリアをクリックするとポップアップが開く` | テスト名 + `'click'` → `'dblclick'` |
| `Apply ボタンで範囲が適用される` | ポップアップを開く `'click'` → `'dblclick'` |
| `min >= max のとき Apply でエラーメッセージが表示される` | 同上 |
| `Auto ボタンでオーバーライドが解除される` | 同上（2 箇所） |
| `Apply で redraw に override が渡される（fillText で軸ラベルが変化）` | ポップアップを開く `'click'` → `'dblclick'` |

例（Line Y 軸テスト）：
```typescript
test('Line チャートの Y 軸エリアをダブルクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');

    const ev = new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    });
    canvas.dispatchEvent(ev);

    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'ポップアップが表示されること');
    dom.window.close();
});
```

- [ ] **Step 4: シングルクリックが無効になったことを確認するリグレッションテストを追加**

```typescript
test('Line チャートの Y 軸エリアへのシングルクリックではポップアップが開かない', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.equal(popup.style.display, 'none', 'シングルクリックではポップアップが開かないこと');
    dom.window.close();
});
```

- [ ] **Step 5: Line X 軸ダブルクリック → ポップアップ開くテストを追加**

```typescript
test('Line チャートの X 軸エリアをダブルクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    // X 軸ゾーン: cy > plot.y + plot.h = 206, cx ∈ [50, 710]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 220,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'X 軸ポップアップが表示されること');
    dom.window.close();
});
```

- [ ] **Step 6: X 軸ポップアップのバッジ表示テストを追加**

```typescript
test('Line チャートの X 軸ポップアップには X 軸バッジが表示される', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 220,
    }));
    const badge = dom.window.document.getElementById('popup-axis-badge') as HTMLElement;
    assert.ok(badge, '#popup-axis-badge が存在すること');
    assert.ok(
        badge.textContent && badge.textContent.includes('X'),
        `X 軸バッジのテキストが "X" を含むこと。実際: ${badge.textContent}`,
    );
    dom.window.close();
});

test('Line チャートの Y 軸ポップアップには Y 軸バッジが表示される', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const badge = dom.window.document.getElementById('popup-axis-badge') as HTMLElement;
    assert.ok(badge, '#popup-axis-badge が存在すること');
    assert.ok(
        badge.textContent && badge.textContent.includes('Y'),
        `Y 軸バッジのテキストが "Y" を含むこと。実際: ${badge.textContent}`,
    );
    dom.window.close();
});
```

- [ ] **Step 7: Line プロット内部ダブルクリック → レンジリセットテストを追加**

```typescript
test('Line チャートのプロット内部ダブルクリックで Y・X レンジがリセットされる', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    const doc = dom.window.document;

    // Y 軸レンジをセット
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    (doc.getElementById('range-max') as HTMLInputElement).value = '100';
    (doc.getElementById('range-min') as HTMLInputElement).value = '10';
    (doc.getElementById('range-apply') as HTMLElement).click();

    // プロット内部 dblclick でリセット: cx=300 ∈ [50,710], cy=100 ∈ [16,206]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 100,
    }));

    // 再度 Y 軸 dblclick でポップアップを開いて入力が空であることを確認
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const maxInput = doc.getElementById('range-max') as HTMLInputElement;
    assert.equal(maxInput.value, '', 'リセット後 range-max が空であること');
    dom.window.close();
});
```

- [ ] **Step 8: Heatmap プロット内部ダブルクリック → カラーレンジリセットテストを追加**

```typescript
test('Heatmap のプロット内部ダブルクリックでカラーレンジがリセットされる', () => {
    const dom = setupChartEnv([{
        kind: 'heatmap', title: 'H', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], ys: [0, 1],
        matrix: [[0, 50], [50, 100]],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    const doc = dom.window.document;

    // カラーバー dblclick でレンジをセット: cx=690 > 680
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 690, clientY: 100,
    }));
    (doc.getElementById('range-max') as HTMLInputElement).value = '-10';
    (doc.getElementById('range-min') as HTMLInputElement).value = '-60';
    (doc.getElementById('range-apply') as HTMLElement).click();

    // プロット内部 dblclick でリセット: cx=300 ∈ [50,680], cy=100 ∈ [16,206]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 100,
    }));

    // カラーバー dblclick で再度確認
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 690, clientY: 100,
    }));
    const maxInput = doc.getElementById('range-max') as HTMLInputElement;
    assert.equal(maxInput.value, '', 'リセット後 range-max が空であること');
    dom.window.close();
});
```

- [ ] **Step 9: Bar プロット内部ダブルクリック → Y レンジリセットテストを追加**

```typescript
test('Bar チャートのプロット内部ダブルクリックで Y レンジがリセットされる', () => {
    const dom = setupChartEnv([{
        kind: 'bar', title: 'T', xLabel: 'X', yLabel: 'Y',
        categories: ['A', 'B'], series: [{ name: 's', values: [1, 2] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    const doc = dom.window.document;

    // Y 軸 dblclick でレンジをセット
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    (doc.getElementById('range-max') as HTMLInputElement).value = '50';
    (doc.getElementById('range-min') as HTMLInputElement).value = '0';
    (doc.getElementById('range-apply') as HTMLElement).click();

    // プロット内部 dblclick: cx=300 ∈ [50,710], cy=100 ∈ [16,206]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 100,
    }));

    // 再度 Y 軸 dblclick で確認
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const maxInput = doc.getElementById('range-max') as HTMLInputElement;
    assert.equal(maxInput.value, '', 'リセット後 range-max が空であること');
    dom.window.close();
});
```

- [ ] **Step 10: テストが失敗することを確認**

```bash
cd /workspaces/audio-wandas-analyzer
npm run compile && node --test dist/test/chartSpecRangeControl.test.js 2>&1 | tail -30
```

期待結果：dblclick テストが複数 FAIL（ソースはまだ `click` ハンドラのため）

---

## Task 2: chartSpecRenderScript.ts を実装する

**Files:**
- Modify: `src/webview/chartSpecRenderScript.ts`

- [ ] **Step 1: `activeAxis` 状態変数を追加**

ファイル先頭部分（`activeChartIdx = -1;` の行の直後）に追加：

```
    const rangeOverrides = {};   // chartIndex → { y?: {min,max}, x?: {min,max}, color?: {min,max} }
    const chartRedraws   = [];   // chartIndex → function(override) (wired in Task 2/3/4)
    let   activeChartIdx = -1;   // 現在ポップアップが開いているチャート index
    let   activeAxis     = 'y';  // 'y' | 'x' | 'color'
```

現在の `rangeOverrides` コメントと `activeChartIdx` の行を上記に置き換える（19〜21 行目付近）。

- [ ] **Step 2: `buildRangePopup()` の HTML を新構造に置き換える**

`pop.innerHTML = ...` の代入全体（現在の 1 行の長い文字列）を以下に置き換える：

```javascript
        const inputStyle = 'width:80px;background:var(--vscode-input-background,#3c3c3c);color:inherit;border:1px solid var(--vscode-input-border,#555);border-radius:2px;padding:2px 4px;font-size:12px;';
        const labelSpanStyle = 'width:30px;font-size:11px;color:var(--vscode-descriptionForeground,#aaa);';
        pop.innerHTML =
            '<div style="margin-bottom:8px;font-weight:600;font-size:11px;color:var(--vscode-descriptionForeground,#aaa);display:flex;align-items:center;gap:6px;">'
            + 'レンジ設定'
            + '<span id="popup-axis-badge" style="padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;color:#fff;background:#0e639c;">Y 軸</span>'
            + '</div>'
            // ── 縦配置（Y 軸・カラー軸）: Max 上 / Min 下 ──
            + '<div id="popup-inputs-vertical" style="display:flex;flex-direction:column;gap:4px;">'
            + '<label style="display:flex;align-items:center;gap:6px;"><span style="' + labelSpanStyle + '">Max</span><input id="range-max" type="number" step="any" placeholder="auto" style="' + inputStyle + '"></label>'
            + '<label style="display:flex;align-items:center;gap:6px;"><span style="' + labelSpanStyle + '">Min</span><input id="range-min" type="number" step="any" placeholder="auto" style="' + inputStyle + '"></label>'
            + '</div>'
            // ── 横配置（X 軸）: Min（左）→ Max（右）──
            + '<div id="popup-inputs-horizontal" style="display:none;flex-direction:row;align-items:flex-end;gap:6px;">'
            + '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">'
            + '<span style="font-size:10px;color:var(--vscode-descriptionForeground,#aaa);">Min（左）</span>'
            + '<input id="range-min-x" type="number" step="any" placeholder="auto" style="width:72px;background:var(--vscode-input-background,#3c3c3c);color:inherit;border:1px solid var(--vscode-input-border,#555);border-radius:2px;padding:2px 4px;font-size:12px;">'
            + '</div>'
            + '<span style="font-size:16px;color:#666;padding-bottom:2px;">→</span>'
            + '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;">'
            + '<span style="font-size:10px;color:var(--vscode-descriptionForeground,#aaa);">Max（右）</span>'
            + '<input id="range-max-x" type="number" step="any" placeholder="auto" style="width:72px;background:var(--vscode-input-background,#3c3c3c);color:inherit;border:1px solid var(--vscode-input-border,#555);border-radius:2px;padding:2px 4px;font-size:12px;">'
            + '</div>'
            + '</div>'
            + '<div style="display:flex;gap:6px;margin-top:8px;">'
            + '<button id="range-apply" style="flex:1;padding:3px 0;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:2px;cursor:pointer;font-size:11px;">Apply</button>'
            + '<button id="range-auto"  style="flex:1;padding:3px 0;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ddd);border:none;border-radius:2px;cursor:pointer;font-size:11px;">Auto</button>'
            + '<button id="range-close" style="padding:3px 6px;background:transparent;color:var(--vscode-descriptionForeground,#aaa);border:none;cursor:pointer;font-size:13px;" aria-label="Close">×</button>'
            + '</div>'
            + '<div id="range-error" style="color:#f48771;font-size:11px;margin-top:4px;min-height:14px;"></div>';
```

- [ ] **Step 3: `openRangePopup()` 関数を全面置き換え**

現在の `openRangePopup` 関数（`function openRangePopup(chartIdx, clientX, clientY, _axis) { ... }`）全体を以下に置き換える：

```javascript
    function openRangePopup(chartIdx, clientX, clientY, axis) {
        activeChartIdx = chartIdx;
        activeAxis = axis || 'y';
        const pop = document.getElementById('range-popup');
        if (!pop) { return; }

        // バッジ更新
        const badge = document.getElementById('popup-axis-badge');
        if (badge) {
            badge.textContent = activeAxis === 'x' ? 'X 軸' : activeAxis === 'color' ? 'カラー' : 'Y 軸';
            badge.style.background = activeAxis === 'x' ? '#6b3fa0' : activeAxis === 'color' ? '#5a8a30' : '#0e639c';
        }

        // 入力セクション切り替え
        const vert  = document.getElementById('popup-inputs-vertical');
        const horiz = document.getElementById('popup-inputs-horizontal');
        const isX   = activeAxis === 'x';
        if (vert)  { vert.style.display  = isX ? 'none' : ''; }
        if (horiz) { horiz.style.display = isX ? 'flex' : 'none'; }

        // 現在のオーバーライドで入力を初期化
        const ov   = rangeOverrides[chartIdx];
        const axOv = ov && ov[activeAxis];
        if (isX) {
            const minX = document.getElementById('range-min-x');
            const maxX = document.getElementById('range-max-x');
            if (minX) { minX.value = (axOv && axOv.min != null) ? String(axOv.min) : ''; }
            if (maxX) { maxX.value = (axOv && axOv.max != null) ? String(axOv.max) : ''; }
        } else {
            const minInput = document.getElementById('range-min');
            const maxInput = document.getElementById('range-max');
            if (maxInput) { maxInput.value = (axOv && axOv.max != null) ? String(axOv.max) : ''; }
            if (minInput) { minInput.value = (axOv && axOv.min != null) ? String(axOv.min) : ''; }
        }

        const err = document.getElementById('range-error');
        if (err) { err.textContent = ''; }
        pop.style.left = (clientX + 8) + 'px';
        pop.style.top  = (clientY + 8) + 'px';
        pop.style.display = 'block';
    }
```

- [ ] **Step 4: `applyRange()` 関数を axis 対応に更新**

現在の `applyRange` 関数全体を以下に置き換える：

```javascript
        function applyRange() {
            const isX      = activeAxis === 'x';
            const minInput = isX ? document.getElementById('range-min-x') : document.getElementById('range-min');
            const maxInput = isX ? document.getElementById('range-max-x') : document.getElementById('range-max');
            const errDiv   = document.getElementById('range-error');
            if (!minInput || !maxInput) { return; }

            const minVal = minInput.value.trim();
            const maxVal = maxInput.value.trim();
            const min = minVal === '' ? null : Number(minVal);
            const max = maxVal === '' ? null : Number(maxVal);

            if (errDiv) { errDiv.textContent = ''; }

            if (min !== null && !Number.isFinite(min)) {
                if (errDiv) { errDiv.textContent = 'Min は数値を入力してください'; }
                return;
            }
            if (max !== null && !Number.isFinite(max)) {
                if (errDiv) { errDiv.textContent = 'Max は数値を入力してください'; }
                return;
            }
            if (min !== null && max !== null && min >= max) {
                if (errDiv) { errDiv.textContent = 'Min は Max より小さい値を入力してください'; }
                return;
            }

            if (activeChartIdx >= 0) {
                if (!rangeOverrides[activeChartIdx]) { rangeOverrides[activeChartIdx] = {}; }
                if (min === null && max === null) {
                    delete rangeOverrides[activeChartIdx][activeAxis];
                } else {
                    rangeOverrides[activeChartIdx][activeAxis] = { min: min, max: max };
                }
                if (typeof chartRedraws[activeChartIdx] === 'function') {
                    chartRedraws[activeChartIdx](rangeOverrides[activeChartIdx]);
                }
            }
            closePopup();
        }
```

- [ ] **Step 5: `autoRange()` 関数を axis 対応に更新**

現在の `autoRange` 関数全体を以下に置き換える：

```javascript
        function autoRange() {
            if (activeChartIdx >= 0) {
                if (rangeOverrides[activeChartIdx]) {
                    delete rangeOverrides[activeChartIdx][activeAxis];
                }
                if (typeof chartRedraws[activeChartIdx] === 'function') {
                    chartRedraws[activeChartIdx](rangeOverrides[activeChartIdx]);
                }
            }
            closePopup();
        }
```

- [ ] **Step 6: `drawLine` の `redraw` 関数を更新（Y・X レンジ対応）**

`drawLine` 内の `redraw` 関数中、現在の以下の部分：

```javascript
            const _yMin = (override && override.min != null) ? override.min : yMin;
            let _yMax = (override && override.max != null) ? override.max : yMax;
            if (_yMax <= _yMin) { _yMax = _yMin + 1; }
            const xMin = xs[0] != null ? xs[0] : 0;
            const xMax = xs[xs.length - 1] != null ? xs[xs.length - 1] : 1;
```

を以下に置き換える：

```javascript
            const yOv = override && override.y;
            const xOv = override && override.x;
            const _yMin = (yOv && yOv.min != null) ? yOv.min : yMin;
            let _yMax   = (yOv && yOv.max != null) ? yOv.max : yMax;
            if (_yMax <= _yMin) { _yMax = _yMin + 1; }
            const dataXMin = xs[0] != null ? xs[0] : 0;
            const dataXMax = xs[xs.length - 1] != null ? xs[xs.length - 1] : 1;
            const _xMin = (xOv && xOv.min != null) ? xOv.min : dataXMin;
            let _xMax   = (xOv && xOv.max != null) ? xOv.max : dataXMax;
            if (_xMax <= _xMin) { _xMax = _xMin + 1; }
```

次に同じ `redraw` 内の以下の行：

```javascript
            const xToPx = function(v) { return plot.x + ((v - xMin) / (xMax - xMin || 1)) * plot.w; };
```

を以下に置き換える：

```javascript
            const xToPx = function(v) { return plot.x + ((v - _xMin) / (_xMax - _xMin || 1)) * plot.w; };
```

次に `drawAxisLabels` 呼び出しの部分：

```javascript
            drawAxisLabels(ctx, plot, spec,
                { min: xMin, max: xMax },
                { min: _yMin, max: _yMax },
```

を以下に置き換える：

```javascript
            drawAxisLabels(ctx, plot, spec,
                { min: _xMin, max: _xMax },
                { min: _yMin, max: _yMax },
```

- [ ] **Step 7: `drawLine` の `redraw` 初期呼び出しとイベントハンドラを更新**

現在の `redraw(rangeOverrides[chartIdx]);` の直後にある：

```javascript
        chartRedraws[chartIdx] = redraw;

        // Y 軸エリア（x < plot.x）クリックでポップアップ
        cv.canvas.addEventListener('click', function(e) {
            const rect = cv.canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            if (cx >= plot.x) { return; }
            openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
        });
```

を以下に置き換える：

```javascript
        chartRedraws[chartIdx] = redraw;

        // ゾーン別ダブルクリック
        cv.canvas.addEventListener('dblclick', function(e) {
            const rect = cv.canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            if (cx < plot.x) {
                // Y 軸エリア → Y レンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy > plot.y + plot.h) {
                // X 軸エリア → X レンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'x');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy >= plot.y && cy <= plot.y + plot.h) {
                // プロット内部 → X・Y 両レンジをリセット
                if (rangeOverrides[chartIdx]) {
                    delete rangeOverrides[chartIdx].x;
                    delete rangeOverrides[chartIdx].y;
                }
                if (typeof chartRedraws[chartIdx] === 'function') {
                    chartRedraws[chartIdx](rangeOverrides[chartIdx]);
                }
            }
        });
```

- [ ] **Step 8: `drawHeatmap` の `redraw` 関数を更新（`color` キー参照）**

`drawHeatmap` 内の `redraw` 関数中、以下の部分：

```javascript
            const vMin = (override && override.min != null) ? override.min : dataVmin;
            const vMax = (override && override.max != null) ? override.max : dataVmax;
```

を以下に置き換える：

```javascript
            const colorOv = override && override.color;
            const vMin = (colorOv && colorOv.min != null) ? colorOv.min : dataVmin;
            const vMax = (colorOv && colorOv.max != null) ? colorOv.max : dataVmax;
```

- [ ] **Step 9: `drawHeatmap` のイベントハンドラを更新**

現在のカラーバー click ハンドラ全体：

```javascript
        // カラーバーエリア（plot 右端 + 8px 以降）クリック
        cv.canvas.addEventListener('click', function(e) {
            const rect = cv.canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            if (cx <= plot.x + plot.w) { return; }  // カラーバー左端より左はスキップ
            openRangePopup(chartIdx, e.clientX, e.clientY, 'color');
        });
```

を以下に置き換える：

```javascript
        // ゾーン別ダブルクリック
        cv.canvas.addEventListener('dblclick', function(e) {
            const rect = cv.canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            if (cx > plot.x + plot.w) {
                // カラーバーエリア → カラーレンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'color');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy >= plot.y && cy <= plot.y + plot.h) {
                // プロット内部 → カラーレンジをリセット
                if (rangeOverrides[chartIdx]) {
                    delete rangeOverrides[chartIdx].color;
                }
                if (typeof chartRedraws[chartIdx] === 'function') {
                    chartRedraws[chartIdx](rangeOverrides[chartIdx]);
                }
            }
        });
```

- [ ] **Step 10: `drawBar` の `redraw` 関数を更新（`y` キー参照）**

`drawBar` 内の `redraw` 関数中、以下の部分：

```javascript
            const _yMin = (override && override.min != null) ? override.min : yMin;
            let _yMax = (override && override.max != null) ? override.max : yMax;
```

を以下に置き換える：

```javascript
            const yOv   = override && override.y;
            const _yMin = (yOv && yOv.min != null) ? yOv.min : yMin;
            let _yMax   = (yOv && yOv.max != null) ? yOv.max : yMax;
```

- [ ] **Step 11: `drawBar` のイベントハンドラを更新**

現在の Bar クリックハンドラ全体：

```javascript
        cv.canvas.addEventListener('click', function(e) {
            const rect = cv.canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            if (cx >= plot.x) { return; }
            openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
        });
```

を以下に置き換える：

```javascript
        // ゾーン別ダブルクリック（bar は Y 軸のみ、X 軸はカテゴリ軸のため対象外）
        cv.canvas.addEventListener('dblclick', function(e) {
            const rect = cv.canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            if (cx < plot.x) {
                // Y 軸エリア → Y レンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy >= plot.y && cy <= plot.y + plot.h) {
                // プロット内部 → Y レンジをリセット
                if (rangeOverrides[chartIdx]) {
                    delete rangeOverrides[chartIdx].y;
                }
                if (typeof chartRedraws[chartIdx] === 'function') {
                    chartRedraws[chartIdx](rangeOverrides[chartIdx]);
                }
            }
        });
```

- [ ] **Step 12: テストが通ることを確認**

```bash
cd /workspaces/audio-wandas-analyzer
npm run compile && node --test dist/test/chartSpecRangeControl.test.js 2>&1 | tail -40
```

期待結果：全テスト PASS

- [ ] **Step 13: ChartSpec 変更をコミット**

```bash
git add src/webview/chartSpecRenderScript.ts src/test/chartSpecRangeControl.test.ts
git commit -m "feat: chartSpec dblclick range interaction (Y/X/color axis + plot reset)

- Y・カラー軸: dblclick でレンジポップアップ（Max上/Min下）
- X 軸（line）: dblclick でレンジポップアップ（Min左/Max右）
- プロット内部 dblclick → X・Y・カラーレンジをリセット
- rangeOverrides を { y, x, color } 構造に拡張
- シングルクリックハンドラを削除

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: ComparisonPanel に波形ダブルクリック zoom リセットを追加

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts:1373`

- [ ] **Step 1: 既存 dblclick ハンドラの直後に新しいハンドラを追加**

`src/webview/comparisonRenderScript.ts` の以下の行（既存の dblclick ハンドラ終了直後）：

```javascript
                document.getElementById('tracks-wrapper').addEventListener('dblclick', function(e) {
                    if (e.target.classList.contains('track-offset-val')) {
                        clearTimeout(_offsetEditTimer);
                        _offsetEditTimer = null;
                        const idx = parseInt(e.target.getAttribute('data-track-index'), 10);
                        if (!isNaN(idx)) {
                            trackRuntime[idx].offsetSeconds = 0;
                            updateOffsetDisplays();
                            scheduleRender();
                            scheduleSpectrumRefresh();
                        }
                    }
                });
```

の直後（`});` の次の行）に以下を追加する：

```javascript
                // 波形キャンバスのダブルクリック → ズームリセット
                document.getElementById('tracks-wrapper').addEventListener('dblclick', function(e) {
                    var targetCanvas = e.target.closest ? e.target.closest('.track-canvas') : null;
                    if (!targetCanvas) { return; }
                    disableFollowCursor();
                    zoomStart = 0;
                    zoomEnd = 1;
                    scheduleRender();
                });
```

- [ ] **Step 2: `npm run verify` で全検証を実行**

```bash
cd /workspaces/audio-wandas-analyzer
npm run verify 2>&1 | tail -30
```

期待結果：`verify: OK` または全テスト PASS

- [ ] **Step 3: ComparisonPanel 変更をコミット**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: waveform canvas dblclick resets zoom in ComparisonPanel

波形キャンバスのダブルクリックで zoomStart=0, zoomEnd=1 にリセット。
ツールバー「リセット」ボタン・キーボード「0」キーと同等の操作。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: モックアップファイルのクリーンアップ

**Files:**
- Delete: `chart-interaction-mockup.html`（ルートに置かれたブレインストーミング用一時ファイル）

- [ ] **Step 1: 一時ファイルを削除してコミット**

```bash
cd /workspaces/audio-wandas-analyzer
git rm chart-interaction-mockup.html
git commit -m "chore: remove brainstorming mockup file

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 完了チェックリスト

実装が完了したら、以下を確認する：

- [ ] `npm run verify` が 0 で終了する
- [ ] `chartSpecRangeControl.test.ts` の全テストが PASS
- [ ] Line チャート: Y 軸 dblclick → ポップアップ（Y 軸バッジ、Max 上/Min 下）
- [ ] Line チャート: X 軸 dblclick → ポップアップ（X 軸バッジ、Min 左/Max 右）
- [ ] Line チャート: プロット内部 dblclick → X・Y レンジリセット
- [ ] Bar チャート: Y 軸 dblclick → ポップアップ
- [ ] Bar チャート: プロット内部 dblclick → Y レンジリセット
- [ ] Heatmap: カラーバー dblclick → ポップアップ（カラーバッジ）
- [ ] Heatmap: プロット内部 dblclick → カラーレンジリセット
- [ ] ComparisonPanel: 波形キャンバス dblclick → zoom リセット
- [ ] シングルクリックでポップアップが開かない（リグレッションなし）
