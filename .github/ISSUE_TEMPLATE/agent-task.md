---
name: Agent task
about: A self-contained task brief for an AI coding agent (Claude Code, Copilot, etc.)
title: "[agent] "
labels: ["agent-task"]
---

<!--
Goal of this template: make a task reproducible across agents and humans.
Fill every section. Vague briefs produce vague work.
-->

## Background

<!-- Why this task exists. What problem it solves. Link related code / issues / PRs. -->

## Acceptance criteria

<!-- Concrete, testable bullets. Avoid adjectives like "better" or "cleaner". -->

- [ ] User-facing GUI changes have a reachable GUI entry point
- [ ] Every changed GUI action has a perceptible user-visible result
- [ ] Regression coverage is listed as `node:test`, `ui-smoke`, or `vscode-e2e`

## Relevant files

<!-- Paths the agent should look at first. -->

-

## Out of scope

<!-- Things the agent should NOT touch in this task. -->

-

## Completion check

The task is done when **`npm run verify`** exits 0 and the acceptance criteria above are satisfied. If the change affects the extension UI, also run `npm run verify:e2e`.

## Suggested agent

- [ ] Claude Code
- [ ] GitHub Copilot
- [ ] Either
