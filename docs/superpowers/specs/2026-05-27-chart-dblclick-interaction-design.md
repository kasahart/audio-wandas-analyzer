# Chart Double-Click Interaction Design

**Date:** 2026-05-27  
**Status:** Approved  
**Scope:** ChartSpecPanel + ComparisonPanel

---

## 概要

グラフへのダブルクリック操作で 2 つのインタラクションを追加する。

1. **プロット内部ダブルクリック → ズーム／レンジリセット**
2. **軸エリアダブルクリック → 軸レンジ設定ポップアップ（軸ごとのレイアウト）**

---

## 対象パネルと機能マッピング

### ComparisonPanel（波形ビューア）

| ヒットゾーン | ダブルクリック結果 |
|---|---|
| 波形キャンバス（`.track-canvas`）内部 | `zoomStart = 0, zoomEnd = 1` にリセット + `scheduleRender()` |

- 既存のキーボード `0` キー・ツールバー「リセット」ボタンと同じ効果
- rect-zoom モード中も同様に動作（dblclick は drag を生成しないため競合なし）
- 既存の `dblclick` ハンドラ（`track-offset-val` 向け）はそのまま残し、`.track-canvas` ターゲットで分岐する

### ChartSpecPanel（レシピ出力グラフ）

#### Line チャート

| ヒットゾーン | 判定条件 | ダブルクリック結果 |
|---|---|---|
| Y 軸エリア | `cx < plot.x` | Y レンジ設定ポップアップを開く |
| X 軸エリア | `cx ∈ [plot.x, plot.x+plot.w]` かつ `cy > plot.y + plot.h` | X レンジ設定ポップアップを開く |
| プロット内部 | `cx ∈ [plot.x, plot.x+plot.w]` かつ `cy ∈ [plot.y, plot.y+plot.h]` | X・Y 両レンジをリセット（Auto） |

#### Bar チャート

Bar チャートの X 軸はカテゴリ軸（文字列）のため、数値レンジ設定は対象外。

| ヒットゾーン | 判定条件 | ダブルクリック結果 |
|---|---|---|
| Y 軸エリア | `cx < plot.x` | Y レンジ設定ポップアップを開く |
| プロット内部 | `cx ∈ [plot.x, plot.x+plot.w]` かつ `cy ∈ [plot.y, plot.y+plot.h]` | Y レンジをリセット（Auto） |

#### Heatmap チャート

| ヒットゾーン | 判定条件 | ダブルクリック結果 |
|---|---|---|
| カラーバーエリア | `cx > plot.x + plot.w` | カラーレンジ設定ポップアップを開く |
| プロット内部 | `cx ∈ [plot.x, plot.x+plot.w]` かつ `cy ∈ [plot.y, plot.y+plot.h]` | カラーレンジをリセット（Auto） |

> **注:** Heatmap の X 軸・Y 軸データレンジ設定は今回スコープ外。  
> 既存のシングルクリックハンドラはすべて **dblclick に変更**（シングルクリックは削除）。

---

## データモデル変更

### `rangeOverrides` の型拡張

```js
// Before
rangeOverrides[idx] = { min: number|null, max: number|null }

// After — line/bar
rangeOverrides[idx] = {
  y?: { min: number|null, max: number|null },
  x?: { min: number|null, max: number|null },
}

// After — heatmap
rangeOverrides[idx] = {
  color?: { min: number|null, max: number|null },
}
```

### `redraw(override)` 関数の変更

line/bar の `redraw` が受け取る override の参照先を変更：

```js
// Y 軸
const _yMin = (override?.y?.min != null) ? override.y.min : dataYMin;
const _yMax = (override?.y?.max != null) ? override.y.max : dataYMax;

// X 軸（line のみ）
const _xMin = (override?.x?.min != null) ? override.x.min : dataXMin;
const _xMax = (override?.x?.max != null) ? override.x.max : dataXMax;
```

heatmap の `redraw` は `color` キーを参照：

```js
const vMin = (override?.color?.min != null) ? override.color.min : dataVmin;
const vMax = (override?.color?.max != null) ? override.color.max : dataVmax;
```

### `activeAxis` 状態追加

```js
let activeChartIdx = -1;
let activeAxis = 'y'; // 'y' | 'x' | 'color'
```

---

## レンジポップアップ UI 設計

### 軸別レイアウト

**Y 軸・カラー軸（縦配置）**  
グラフの上下方向と対応させ、Max を上・Min を下に配置する。

```
┌─────────────────────────────┐
│ レンジ設定  [Y 軸]          │
│  Max: [_______]  ↑          │
│  Min: [_______]  ↓          │
│ [Apply] [Auto] [×]          │
└─────────────────────────────┘
```

**X 軸（横配置）**  
グラフの左右方向と対応させ、Min（左）→ Max（右）の横並びにする。

```
┌─────────────────────────────────────┐
│ レンジ設定  [X 軸]                  │
│ Min（左）: [____]  →  Max（右）: [____] │
│ [Apply]  [Auto]  [×]               │
└─────────────────────────────────────┘
```

### 軸バッジ

ポップアップタイトルに色分けバッジを表示：

| 軸 | バッジテキスト | 色 |
|---|---|---|
| Y 軸 | `Y 軸` | `#0e639c`（青） |
| X 軸 | `X 軸` | `#6b3fa0`（紫） |
| カラー | `カラー` | `#5a8a30`（緑） |

### ポップアップ表示ロジック

- `openRangePopup(chartIdx, clientX, clientY, axis)` に `axis` を渡す
- `axis === 'x'` のとき横レイアウト（`popup-inputs-horizontal`）を表示、縦を非表示
- それ以外は縦レイアウト（`popup-inputs-vertical`）を表示
- Apply 時は `activeAxis` に応じて `rangeOverrides[idx].y / .x / .color` を更新
- Auto 時は対応するキーを `delete`
- フォーカスは Max 入力（縦）/ Min 入力（横）に自動移動

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/webview/chartSpecRenderScript.ts` | rangeOverrides 型変更、dblclick ゾーン実装、シングルクリック削除、ポップアップ DOM 更新 |
| `src/webview/comparisonRenderScript.ts` | `.track-canvas` dblclick → zoom リセット追加 |
| `src/test/chartSpecRangeControl.test.ts` | click → dblclick 変更、X 軸テスト追加、プロット内部リセットテスト追加 |

---

## エラー処理・バリデーション

既存のバリデーションをそのまま維持する：

- Min・Max どちらかが空欄の場合は片側のみ設定（もう片側は auto）
- `min >= max` の場合はエラーメッセージ表示
- Escape キーでポップアップを閉じる
- ポップアップ外クリックで閉じる

---

## テスト方針

| テストケース | 内容 |
|---|---|
| line Y 軸 dblclick | `cx < plot.x` → ポップアップが `y` 軸モードで開く |
| line X 軸 dblclick | `cy > plot.y + plot.h` → ポップアップが `x` 軸モードで開く |
| line プロット内部 dblclick | X・Y 両レンジがリセットされ再描画される |
| heatmap colorbar dblclick | ポップアップが `color` 軸モードで開く |
| heatmap プロット内部 dblclick | カラーレンジがリセットされ再描画される |
| Y 軸シングルクリック | 何も起きない（旧動作が削除されていることを確認） |
| X レンジ適用 | `rangeOverrides[idx].x` が更新され再描画される |
| Auto ボタン | 対応軸のオーバーライドが削除され再描画される |

---

## スコープ外

- ComparisonPanel の Y 軸レンジ設定（波形の振幅レンジ操作は今回含まない）
- Heatmap の Y 軸エリア（左側、`cx < plot.x`）へのインタラクション — 今回は未対応
- Heatmap の X 軸・Y 軸データレンジ設定（カラーレンジのみ対応）
- Bar チャートの X 軸レンジ設定（カテゴリ軸のため数値レンジ不適用）
- X 軸ズーム（ComparisonPanel の水平ズームは既存実装で対応済み）
