# Browser Preview for Real ComparisonPanel Design

## Goal

VS Code の `tasks.json` から、実際の `ComparisonPanel` Webview をブラウザで確認できるようにする。対象は `results` モードと `directory-selection` モードの 2 種類で、`ui_catalog.html` のような近似UIではなく、既存の `renderComparisonHtml()` が生成する本物の HTML / CSS / script をそのまま表示する。

## Scope

- 追加する入口は **VS Code Tasks** のみ
- 追加するプレビューは **Results Preview** と **Selection Preview** の 2 種類
- 表示対象は **実際の ComparisonPanel Webview HTML**
- ダミーデータは既存の UI smoke 用ビルダーを再利用する
- 既定ブラウザで開くところまで自動化する

非スコープ:

- VS Code 全体の外枠や Electron ネイティブ UI の再現
- Python バックエンドとの実通信
- 本番データやユーザーの実ファイルを読む処理

## Existing Building Blocks

このリポジトリには既に、ブラウザ確認に必要な主要部品がある。

- `src/test/helpers/comparisonScriptLoader.ts`
  - `renderComparisonHtml()` を VS Code スタブ付きで呼べる
- `src/test/uiSmoke/buildHtml.ts`
  - `buildUiSmokeHtml()` で `results` モード
  - `buildUiSmokeSelectionHtml()` で `directory-selection` モード
  - `comparisonWaveform.js` と `acquireVsCodeApi()` スタブを埋め込み済み

つまり新機能は「実UIを新しく作る」のではなく、「既存の本物UIビルダーを VS Code task から使えるように露出する」作業になる。

## Proposed Architecture

### 1. Shared preview generator module

新しい小さな TS モジュールを追加し、以下を一箇所にまとめる。

- `results` / `selection` のプレビュー HTML 生成
- 出力先 HTML ファイル名の決定
- 一時ディレクトリへの書き出し
- ブラウザで開く URL の返却

このモジュールは、実際の HTML 生成を `src/test/uiSmoke/buildHtml.ts` の既存関数へ委譲する。見た目のソース・オブ・トゥルースを増やさないため、新しい HTML テンプレートは作らない。

### 2. Thin CLI entrypoint

Node から直接呼べる薄い CLI を追加する。

- 例: `node dist/tools/openComparisonPreview.js --mode results`
- `--mode results | selection`
- 生成した HTML のパスを確定
- 既定ブラウザで開く
- 失敗時は標準エラーに理由を出して非ゼロ終了

CLI は tasks.json から呼ばれるだけの薄いラッパーに留める。

### 3. VS Code tasks

`.vscode/tasks.json` に以下の task を追加する。

- `Preview ComparisonPanel (Results)`
- `Preview ComparisonPanel (Selection)`

どちらも `npm run compile` 済みの `dist/` を前提にしないよう、task 側で compile を先に行うか、コマンド自体に compile を含める。ユーザー体験としては「task を実行したらそのままブラウザで開く」を優先する。

## Data Flow

1. ユーザーが VS Code task を実行する
2. task が compile 後に preview CLI を呼ぶ
3. CLI が shared preview generator を呼ぶ
4. generator が既存の `buildUiSmokeHtml()` または `buildUiSmokeSelectionHtml()` を呼ぶ
5. 生成 HTML を一時ディレクトリへ保存する
6. CLI が既定ブラウザでそのファイルを開く

## File Plan

### Modify

- `.vscode/tasks.json`
  - preview task を追加
- `src/test/uiSmoke/buildHtml.ts`
  - 必要なら test 専用命名を少し一般化し、preview からも自然に使えるようにする
- `src/test/uiCatalog.test.ts`
  - 既存カタログ系の契約テストは維持。今回の preview 実装の邪魔はしない

### Create

- `src/tools/comparisonPreview.ts`
  - preview HTML の生成・保存・URL 解決
- `src/tools/openComparisonPreview.ts`
  - CLI entrypoint
- `src/test/comparisonPreview.test.ts`
  - Results / Selection の両方で HTML が生成されること
  - 出力 HTML に `#toolbar` / `#selection-toolbar` などの主要要素が含まれること

## Error Handling

- 未知の `--mode` は即エラー
- `dist/webview/comparisonWaveform.js` が未生成なら compile を要求するエラー
- ブラウザ起動コマンド失敗時は、生成済み HTML のパスを出して手動で開けるようにする

最後のケースだけは UX のために明示的なフォールバックパス表示を入れる。HTML 生成自体が成功しているのに、ブラウザ起動失敗だけで完全に使えなくするのは不便だからである。

## Testing

1. Node test
   - Results Preview HTML の生成
   - Selection Preview HTML の生成
   - mode 不正時のエラー
2. Existing completion bar
   - `npm run verify`

ブラウザ起動そのものは OS 依存なので、テストでは HTML 生成とコマンド組み立ての層までを対象にする。

## Recommendation

この設計では、**見た目の責任は既存の ComparisonPanel 側だけ**に置かれる。プレビュー用に別 UI を維持しないため、今後 Webview が変わっても preview の見た目は自動的に追従する。
