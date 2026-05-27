# 開発者ガイド

[English](./developer-guide.md) | **日本語**

このガイドは、このリポジトリに初めて入る開発者が、最短でセットアップして安全に変更できるようにするためのものです。

## 1. このプロジェクトは何か

Audio Wandas Analyzer は VS Code 拡張機能です。

- **TypeScript の extension host** がコマンド登録、ファイル選択、VS Code 連携、Webview メッセージ処理を担当します。
- **Python バックエンド** が `wandas` を使って重い音声解析を担当します。
- **Webview UI** が波形・スペクトログラム・パワースペクトルを表示する ComparisonPanel を描画します。

全体像の把握には次を参照してください。

- プロダクト概要・利用者向け説明: [`README.ja.md`](../README.ja.md)
- アーキテクチャ詳細: [`docs/architecture.md`](./architecture.md)
- リポジトリのガードレールと標準コマンド: [`AGENTS.md`](../AGENTS.md)

## 2. 対応する開発環境

- **Node.js**: 22
- **Python**: 3.11
- **推奨環境**: このリポジトリの devcontainer

初回セットアップ:

```bash
npm install
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## 3. 日常の開発フロー

通常のループは次のとおりです。

1. `src/` または `python-backend/` を編集する
2. 途中では影響範囲に応じた最小限のチェックを回す
3. 最後に `npm run verify` を通す
4. Webview の実行時挙動に関わる変更なら `npm run test:ui` も回す

標準コマンド:

```bash
npm run compile
npm test
npm run verify
npm run test:ui
npm run verify:e2e
```

通常開発の完了条件は `npm run verify` です。TypeScript ビルド、Webview の静的チェック、ユニットテスト、Ruff、Pytest がここに含まれます。

## 4. よくある変更ごとの編集先

| 作業内容 | 主なファイル |
| --- | --- |
| コマンド登録 / VS Code 連携 | `src/extension/index.ts` |
| ComparisonPanel の外枠 / HTML コンテナ | `src/webview/panels/ComparisonPanel.ts` |
| Webview の操作ロジック | `src/webview/comparisonRenderScript.ts` |
| 波形描画パイプライン | `src/webview/waveform/waveformRenderer.ts` |
| 共有データ契約 | `src/shared/analysis/analysisTypes.ts` |
| 全体解析バックエンド | `python-backend/analyzer.py` |
| 波形デシメーション | `python-backend/decimator.py` |
| 高解像度の範囲解析 | `python-backend/range_analyzer.py` |
| TypeScript ユニットテスト | `src/test/` |
| Webview ブラウザスモークテスト | `src/test/uiSmoke/` |
| VS Code E2E | `src/e2e/` |

## 5. ブラウザプレビューと UI 作業

Webview 作業では、毎回フルの extension host を起動しなくても進められることが多いです。

VS Code タスク:

- **Preview ComparisonPanel (Results)**
- **Preview ComparisonPanel (Selection)**

これらは `dist/tools/openComparisonPreview.js` からスタンドアロンのブラウザプレビューを生成します。

次のようなときに使います。

- ComparisonPanel のレイアウトや操作を変更するとき
- VS Code 外で素早く再現したいとき
- プレビュー専用の挙動を確認したいとき

波形やグラフの動きを見るなら **results** プレビュー、ファイル選択状態を見るなら **selection** プレビューを使ってください。

## 6. リポジトリ上の重要ルール

- `dist/` の生成物は **編集しない**
- `node_modules/`, `.venv/`, `.vscode-test/`, `.worktrees/` のような vendored / 環境ローカルな場所は **編集しない**
- 新規ファイルを増やす前に、既存ファイルの編集で済まないかを考える
- TypeScript は strict を維持し、外部境界以外で安易に `any` を入れない
- Python の整形・Lint は Ruff を使う
- 挙動変更は場当たり的な確認ではなく、既存のテスト層で担保する

## 7. Webview 周りの注意点

- `src/webview/waveform/waveformRenderer.ts` が比較波形描画の single source of truth です。
- `npm run compile` で `scripts/build-webview.js` が走り、`dist/webview/comparisonWaveform.js` が再生成されます。
- ユーザー向け GUI アクションを追加・変更したら、`src/shared/gui/guiTriggerabilityInventory.ts` の在庫定義と対応する回帰カバレッジも合わせて更新します。
- 実ブラウザでしか出ない不具合は、jsdom だけに頼らず `npm run test:ui` を使って確認します。

## 8. Python / バックエンドのメモ

- DSP ロジックを作り直す前に、`python-backend/analyzer.py`, `decimator.py`, `range_analyzer.py` の既存の `wandas` ベース実装を優先してください。
- Python テストは `python-backend/test_*.py` としてモジュールの近くにあります。
- extension host とバックエンドの境界は、子プロセスの標準入出力を使う JSON 通信です。境界は小さく、明示的に保ちます。

## 9. PR を出す前

次を確認してください。

1. `npm run verify`
2. Webview の実行時挙動に関わる変更なら `npm run test:ui`
3. extension host 全体の導線に関わる変更なら `npm run verify:e2e`
4. 生成物や read-only 扱いの場所を変更していないこと
5. 挙動やワークフローが変わったならドキュメントも更新したこと

## 10. どこから読めばよいか迷ったら

次の順で見るのがおすすめです。

1. [`README.ja.md`](../README.ja.md) でプロダクトと利用者向け導線を把握する
2. [`AGENTS.md`](../AGENTS.md) でリポジトリのルールと標準コマンドを把握する
3. [`docs/architecture.md`](./architecture.md) で責務分割を把握する
4. そのうえで、セクション 4 の対象ファイルを見る
