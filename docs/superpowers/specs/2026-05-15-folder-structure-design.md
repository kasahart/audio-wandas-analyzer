# 設計: フォルダ構成の再編

Date: 2026-05-15

## 概要

TypeScript 側のフォルダ構成を、実行責務がひと目で分かる形へ再編する。
目的は機能追加ではなく、VS Code 拡張本体・Webview UI・共有ロジック・テスト支援コードの境界を明確にし、今後の変更コストを下げることにある。

今回の実装スコープは TypeScript 側中心とし、Python バックエンドは次段の整理候補として設計メモに留める。

## 背景と課題

現状の `src/` には次の課題がある。

- `extension.ts` と `waveformServer.ts` が直下にあり、VS Code 依存コードのまとまりが見えにくい
- `panels/` は実質的に Webview 層だが、責務名より UI 名が前面に出ている
- `utils/` には shared 的な純粋ロジックが含まれており、利用境界が分かりにくい
- `testing/` は VS Code Testing 連携の実装だが、`test/` と近い名前で役割が混同しやすい

## 目標

1. `src/` 配下を責務別に整理し、VS Code 依存コードと共有ロジックを構造上で分離する
2. 既存の公開コマンド、設定キー、データフロー、エラーハンドリングは変えない
3. テストファイルは専用の `src/test/` に維持する
4. 将来の分割に備えつつ、今回の変更は過剰設計にしない

## ターゲット構成

```text
src/
  extension/
    index.ts
    waveformServer.ts
  webview/
    panels/
      ComparisonPanel.ts
    waveform/
      waveformRenderer.ts
      rangeRequestPolicy.ts
  shared/
    analysis/
      analysisTypes.ts
    utils/
      audioTarget.ts
      directorySelection.ts
      startupDebug.ts
      webviewEscaping.ts
  testing/
    tapParser.ts
    testCommandRunner.ts
    testDiscovery.ts
    workspaceTests.ts
  test/
    waveformRenderer.test.ts
    renderScript.integration.test.ts
    helpers/
  e2e/
    runVscodeE2E.ts
    suite/
```

## ファイル移動方針

| 現在 | 移動先 | 理由 |
|------|--------|------|
| `src/extension.ts` | `src/extension/index.ts` | 拡張機能の入口を `extension/` に集約する |
| `src/waveformServer.ts` | `src/extension/waveformServer.ts` | VS Code 側から使う実行系サービスとして extension 層に置く |
| `src/panels/ComparisonPanel.ts` | `src/webview/panels/ComparisonPanel.ts` | Webview UI の責務を明示する |
| `src/panels/waveformRenderer.ts` | `src/webview/waveform/waveformRenderer.ts` | Webview 描画ロジックとしてまとめる |
| `src/panels/rangeRequestPolicy.ts` | `src/webview/waveform/rangeRequestPolicy.ts` | 波形表示用の表示判断ロジックとしてまとめる |
| `src/panels/analysisTypes.ts` | `src/shared/analysis/analysisTypes.ts` | extension / webview 間で共有される型だから |
| `src/utils/*.ts` | `src/shared/utils/*.ts` | 純粋ロジックと補助関数を shared 層へ寄せる |
| `src/testing/*.ts` | `src/testing/*.ts` | 責務が明確なので現状維持。import の参照先だけ更新する |
| `src/test/*.test.ts` | `src/test/*.test.ts` | テスト専用ディレクトリを維持する |

## アーキテクチャ上の扱い

- **Extension 層**  
  VS Code API、コマンド登録、設定取得、Python プロセス起動、Webview メッセージルーティングを担当する。

- **Webview 層**  
  `ComparisonPanel` と波形描画・表示範囲判定など、パネル表示と UI 近傍のロジックを担当する。

- **Shared 層**  
  型定義と純粋関数だけを置き、VS Code API や DOM への直接依存を持ち込まない。

- **Testing 層**  
  VS Code Testing ビュー連携の実装をまとめる。これは「テストコード」ではなく「テスト実行支援の本体実装」として扱う。

- **Test 層**  
  Node.js `node:test` ベースの検証コードを専用ディレクトリとして維持する。

## 移行ルール

1. 振る舞いは変えない。コマンド ID、設定キー、Python 実行経路、Webview メッセージ種別は維持する。
2. import パスだけを追従更新し、ロジック抽出や API 変更は必要最小限に留める。
3. 空ディレクトリを先回りで増やさず、今回必要な単位だけ作る。
4. `media/comparisonWaveform.js` は Webview 資産として現状維持し、TypeScript 側の再編に合わせて関連ドキュメントだけ更新する。

## ドキュメント更新範囲

- `README.md` の主要ファイル一覧
- `docs/architecture.md` のファイル参照
- 必要に応じて `CLAUDE.md` の主要ファイル一覧

## 検証方針

1. `npm test` を通し、TypeScript 側の import 更新漏れがないことを確認する
2. `media/comparisonWaveform.js` と `waveformRenderer.ts` の責務関係が変わっていないことを確認する
3. 既存ドキュメント内のファイルパスが再編後の配置を指していることを確認する

## 今回のスコープ外

- Python バックエンドの実装移動
- Python パッケージ化 (`audio_wandas_backend/` など) の導入
- `src/testing/` のさらなる機能分割
- TypeScript ロジックの大規模な責務再設計

## Python バックエンド整理メモ

Python 側を将来整理する場合は、トップレベルに CLI 入口だけを残し、実処理をパッケージへ集約する構成が望ましい。

```text
python-backend/
  requirements.txt
  main.py
  audio_wandas_backend/
    analysis/
      analyzer.py
      decimator.py
      range_analyzer.py
    server/
      waveform_server.py
    __init__.py
  tests/
    test_decimator.py
```

この案は今回の TypeScript 再編と矛盾しないが、実装に含める場合は Python import と TypeScript 側の実行パス更新を同時に扱う必要があるため、今回は設計メモに留める。
