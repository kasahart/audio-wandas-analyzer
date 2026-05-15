# 設計: オーバーレイモード廃止

Date: 2026-05-15

## 概要

トラックの重ね書き（オーバーレイ）モードを廃止し、縦積み表示のみに固定する。
`viewMode` の分岐を全て除去することで、コードの複雑性を下げる。

## 削除対象

### `src/panels/ComparisonPanel.ts`

- `viewMode` 変数と `'stacked' | 'overlay'` 型定義
- `renderOverlay()` 関数
- `updateOverlayLegend()` 関数
- `hitTestOverlay()` 関数
- `handleOverlayMouseMove()` / `handleOverlayMouseDown()` / `handleOverlayClick()` 関数
- `hoverTrackIndex` 変数（オーバーレイ用ヒットテストハイライト）
- ツールバーの `view-overlay` / `view-stacked` ボタンHTML（両方削除）
- DOM要素: `#overlay-wrap`, `#overlay-canvas-wrap`, `#overlay-canvas`, `#overlay-legend`
- CSS: 上記要素に対応するスタイル定義
- `canvasWidthCache['overlay']` の分岐
- `dragState` 内の `viewMode === 'overlay'` による canvas ID 選択分岐
- ResizeObserver 内のオーバーレイ canvas サイズ更新処理
- `view-stacked` / `view-overlay` ボタンのクリックハンドラ分岐

### `src/e2e/suite/index.ts`

- UI snapshot 型の `hasOverlayCanvas`, `overlayWrapVisible` フィールド
- `view-overlay` 切り替えシナリオとアサーション

### `src/test/renderScript.integration.test.ts`

- オーバーレイ描画テスト (`overlay 表示では...`) 1件

## 保持するもの

- 縦積み表示 (`stacked-wrap`, `track-canvas-*`) は変更なし
- ツールバー本体（スペクトログラム切替等の他ボタン）は変更なし

## 完了条件

- `npm test` が全件パスする
- オーバーレイ関連の識別子が残っていない
- ツールバーに表示切替ボタンが表示されない
