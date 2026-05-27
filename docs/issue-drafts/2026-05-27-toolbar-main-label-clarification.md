---
name: Agent task
about: A self-contained task brief for an AI coding agent (Claude Code, Copilot, etc.)
title: '[agent] ツールバー "main" 表記の意味明確化'
labels: ["agent-task", "ui", "wording"]
---

## Background

比較画面ツールバー内の "main" という表記が、何を指すのか利用者に伝わりません。画面の理解コストを下げるため、意味が分かる文言へ変更する必要があります。

## Acceptance criteria

- [ ] 比較画面上で "main" と表示される箇所が、意味が明確な文言に置き換わる。
- [ ] 置き換え文言は英語/日本語ロケールの双方で自然に表示される。
- [ ] 当該ラベルに紐づくツールチップまたは補助説明が必要であれば追加される。
- [ ] UI テストまたはスナップショット検証で文言変更が確認できる。

## Relevant files

- /home/runner/work/audio-wandas-analyzer/audio-wandas-analyzer/src/shared/i18n/strings.ts
- /home/runner/work/audio-wandas-analyzer/audio-wandas-analyzer/src/webview/comparisonRenderScript.ts
- /home/runner/work/audio-wandas-analyzer/audio-wandas-analyzer/src/test/renderScript.integration.test.ts

## Out of scope

- ツールバー全体の情報設計見直し
- 既存ショートカット仕様の変更

## Completion check

The task is done when **`npm run verify`** exits 0 and the acceptance criteria above are satisfied. If the change affects the extension UI, also run `npm run verify:e2e`.

## Suggested agent

- [ ] Claude Code
- [x] GitHub Copilot
- [ ] Either
