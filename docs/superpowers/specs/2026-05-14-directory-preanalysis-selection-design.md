# ディレクトリ事前選択 UI 設計仕様書

作成日: 2026-05-14

## 概要

ディレクトリを指定した際、対応済み音声ファイルを即解析するのではなく、解析前に Webview 上のファイルツリーで選択できるようにする。表示対象は対応済み音声ファイルのみとし、不要ファイルの解析を避ける。

## 目的

- ディレクトリ内の対応音声ファイルをツリーで可視化する
- ユーザーが解析対象をチェックボックスで絞り込めるようにする
- 選択確定後に既存の比較パネルへ遷移し、既存の解析・描画パイプラインを再利用する

## 設計

### Extension Host

- [src/extension.ts](src/extension.ts) でディレクトリ入力時にツリーを構築する
- ツリーから対応音声ファイル一覧を抽出し、選択用パネルを開く
- Webview から返る選択結果は、ツリーに含まれるファイルに限定して再検証してから解析する

### Webview

- [src/panels/ComparisonPanel.ts](src/panels/ComparisonPanel.ts) に directory-selection モードを追加する
- 左ペインにディレクトリツリー、右ペインに説明領域を持つ
- ファイル行にはチェックボックスを表示し、全選択・全解除・解析実行を提供する

### 共有契約

- [src/utils/audioTarget.ts](src/utils/audioTarget.ts) に analyze-selected-files メッセージを追加する
- [src/utils/directorySelection.ts](src/utils/directorySelection.ts) に tree flatten と選択検証の pure helper を置く

## テスト方針

- [src/test/directorySelection.test.ts](src/test/directorySelection.test.ts) で tree flatten と選択検証を確認する
- [src/test/audioTarget.test.ts](src/test/audioTarget.test.ts) で新規メッセージ型の type guard を確認する
- [src/test/renderScript.integration.test.ts](src/test/renderScript.integration.test.ts) で選択モードの DOM と postMessage を確認する