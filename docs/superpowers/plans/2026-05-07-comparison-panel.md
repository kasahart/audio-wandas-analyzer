# ComparisonPanel 実装計画

**Goal:** 単一ファイル解析と複数ファイル比較を同じ ComparisonPanel へ集約し、同一のデータモデルと描画パイプラインで扱う。

**Architecture:** `extension.ts` はファイルまたはフォルダ入力を解決し、各ファイルを `runAnalysis()` で解析して `AnalysisResultWithError[]` を構築する。`ComparisonPanel.ts` はその配列を受け取り、1 件なら単一解析ビュー、2 件以上なら比較ビューとして描画する。共有型は `analysisTypes.ts` に集約し、高解像度波形は `request-waveform-range` と `WaveformServer` で補う。

**Tech Stack:** TypeScript, VS Code Extension API, HTML Canvas API, node:test

---

## 現行ファイル構成

| ファイル | 役割 |
|---------|------|
| `src/extension.ts` | 入力解決、逐次解析、Webview メッセージルーティング |
| `src/panels/ComparisonPanel.ts` | 単一ファイル表示と比較表示の UI |
| `src/panels/analysisTypes.ts` | `AnalysisResult` / `AnalysisResultWithError` / `DirectoryTreeNode` |
| `src/utils/audioTarget.ts` | `select-target` / `compare-files` / `request-waveform-range` の型ガード |
| `src/waveformServer.ts` | 範囲波形要求のバックエンド中継 |
| `src/test/renderScript.integration.test.ts` | ComparisonPanel の jsdom 統合テスト |

---

## 実装ステップ

### Step 1: 共有型を分離する

目的:

- UI 実装から型定義を切り離す
- `extension.ts` と `ComparisonPanel.ts` が同じ契約を参照する

完了条件:

- `src/panels/analysisTypes.ts` に `AnalysisResult`、`AnalysisResultWithError`、`DirectoryTreeNode` がある
- `ComparisonPanel.ts` と `extension.ts` が `analysisTypes.ts` を import している

### Step 2: Extension Host を ComparisonPanel 中心にする

目的:

- 単一ファイルとディレクトリ入力を同じ処理へ寄せる
- 解析結果を常に `AnalysisResultWithError[]` として扱う

実装ポイント:

- `analyzeAudioTarget()` はファイルなら 1 件、フォルダなら複数件を `analyzeMultipleFiles()` に渡す
- `registerPanelMessageHandler()` は `select-target`、`compare-files`、`request-waveform-range` を処理する
- 失敗ファイルは空チャンネルと `error` 付きで結果配列に残す

完了条件:

- `ComparisonPanel.show()` だけが本番表示経路になっている
- フォルダ入力でも単一ファイル入力でも既存パネルを再利用できる

### Step 3: ComparisonPanel で単一表示と比較表示を統一する

目的:

- 表示件数に応じて UI モードを切り替える
- 単一表示でも比較表示と同じ描画パイプラインを使う

実装ポイント:

- 1 件時は単一トラックとして描画し、タイトルを解析ビュー向けにする
- 2 件以上では基準トラック、オフセット、縦積み / オーバーレイを有効にする
- `comparisonWaveform.js` と `waveformRenderer.ts` のアルゴリズム整合を保つ

完了条件:

- `ComparisonPanel.show()` が単一・複数どちらも受け入れる
- `renderScript.integration.test.ts` が通る

### Step 4: 高解像度波形のオンデマンド取得をつなぐ

目的:

- 初期表示は概要データで軽く保ち、ズーム時だけ範囲データを取る

実装ポイント:

- Webview は `request-waveform-range` を送信する
- Extension Host は `WaveformServer` へ委譲する
- 応答は `waveform-range-result` として Webview に返す

完了条件:

- ズーム時に範囲波形へ差し替わる
- 失敗時は概要データで描画継続できる

### Step 5: 回帰テストで固定する

目的:

- ComparisonPanel 集約で壊れやすい表示・メッセージ・描画経路を固定する

確認項目:

- `src/test/audioTarget.test.ts` で型ガードが通る
- `src/test/renderScript.integration.test.ts` で jsdom 実行が通る
- `src/test/waveformRenderer.test.ts` で描画計算が通る
- `npm test` が緑になる

---

## 完了済み状態

現行実装では以下が完了しています。

- 表示 UI は `src/panels/ComparisonPanel.ts` に統一されている
- 共有型は `src/panels/analysisTypes.ts` に集約されている
- Webview メッセージは `select-target` / `compare-files` / `request-waveform-range` に整理されている
- 単一ファイル表示と複数ファイル比較は同じ描画パイプラインを共有している
- jsdom テスト用の canvas スタブが整備され、統合テストが安定している
