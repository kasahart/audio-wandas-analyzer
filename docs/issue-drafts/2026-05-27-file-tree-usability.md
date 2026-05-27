---
name: Agent task
about: A self-contained task brief for an AI coding agent (Claude Code, Copilot, etc.)
title: "[agent] ファイルツリーの可変幅と大量ファイル向けフィルタ追加"
labels: ["agent-task", "ui", "file-tree"]
---

## Background

比較画面ではファイルツリー領域の幅が固定に近く、波形表示領域が狭くなるケースがあります。加えて、大量ファイルを扱う前提の探索体験としては、現状のツリー表示が弱く、絞り込みができません。

## Acceptance criteria

- [ ] ファイルツリー領域の幅をユーザー操作で変更できる（ドラッグ等）。
- [ ] 波形表示領域の最小可視幅を保ち、ツリーの拡縮で表示崩れが起きない。
- [ ] ツリー上部にフィルタ入力があり、入力に応じてファイル/フォルダを絞り込める。
- [ ] フィルタ適用時も選択状態は失われない。
- [ ] 外観は既存 UI と整合し、VS Code 風の視認性（階層・選択・フォーカス）が改善される。

## Relevant files

- /home/runner/work/audio-wandas-analyzer/audio-wandas-analyzer/src/webview/comparisonRenderScript.ts
- /home/runner/work/audio-wandas-analyzer/audio-wandas-analyzer/src/webview/comparisonStyles.ts
- /home/runner/work/audio-wandas-analyzer/audio-wandas-analyzer/src/test/renderScript.integration.test.ts

## Out of scope

- ファイルツリーの仮想スクロール等、大規模レンダリング最適化の全面導入
- バックエンドのファイル収集ロジック変更

## Completion check

The task is done when **`npm run verify`** exits 0 and the acceptance criteria above are satisfied. If the change affects the extension UI, also run `npm run verify:e2e`.

## Suggested agent

- [ ] Claude Code
- [x] GitHub Copilot
- [ ] Either
