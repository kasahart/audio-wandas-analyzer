---
name: Agent task
about: A self-contained task brief for an AI coding agent (Claude Code, Copilot, etc.)
title: "[agent] Python環境表示の簡素化と導線整理"
labels: ["agent-task", "ui", "python-environment"]
---

## Background

比較画面の Python 環境表示において、実行コマンドのフルパスが長く表示され可読性を下げています。さらに、Python 環境設定ボタンが複数箇所にあり、どこから設定すべきかが分かりづらい状態です。

## Acceptance criteria

- [ ] Python 環境ボタンのラベルは「Python: <短い表示名>」とし、長いフルパスは表示しない。
- [ ] フルパス（または詳細情報）はツールチップで確認できる。
- [ ] Python 環境設定導線は 1 箇所を主導線として統一され、重複感がない。
- [ ] 警告状態（⚠）の表示・スタイルは維持される。

## Relevant files

- /home/runner/work/audio-wandas-analyzer/audio-wandas-analyzer/src/webview/comparisonRenderScript.ts
- /home/runner/work/audio-wandas-analyzer/audio-wandas-analyzer/src/extension/pythonEnvironment.ts
- /home/runner/work/audio-wandas-analyzer/audio-wandas-analyzer/src/shared/i18n/strings.ts

## Out of scope

- Python 実行環境の検出ロジック自体の刷新
- 新しい Python 管理機能（仮想環境作成など）の追加

## Completion check

The task is done when **`npm run verify`** exits 0 and the acceptance criteria above are satisfied. If the change affects the extension UI, also run `npm run verify:e2e`.

## Suggested agent

- [ ] Claude Code
- [x] GitHub Copilot
- [ ] Either
