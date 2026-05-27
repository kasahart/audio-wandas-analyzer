# GitHub Copilot Instructions

**Read [`AGENTS.md`](../AGENTS.md) first.** It is the single source of truth for setup, architecture, conventions, and the completion bar. The notes below only add Copilot-specific reminders.

## Completion bar

A change is only finished when `npm run verify` exits 0. That script runs:

- `tsc` compile
- `node:test` against `dist/test/`
- `ruff check` and `ruff format --check` on `python-backend`
- `pytest` on `python-backend`

E2E (`npm run verify:e2e`) is a separate, slower job.

## Worktree isolation

**Before making any code change, always work in a linked git worktree — never edit files directly in the primary checkout.**

Use `scripts/worktree-new.sh <feature-slug>` to create an isolated worktree under `.worktrees/`:

```bash
bash scripts/worktree-new.sh my-feature   # → .worktrees/my-feature/ (branches from origin/main)
```

The check logic lives in `scripts/check-worktree.sh`.  
Claude Code enforces this automatically via a `PreToolUse` hook in `.claude/settings.json`.  
Copilot has no equivalent hook — this rule is enforced by convention here.

## Read-only paths

Never suggest edits to these directories — they are generated, vendored, or environment-local:

- `dist/`
- `node_modules/`
- `.venv/`
- `.vscode-test/`
- `.worktrees/`

## Webview waveform pipeline

`src/webview/waveform/waveformRenderer.ts` is the single source of truth for the comparison panel's waveform rendering. `scripts/build-webview.js` (run automatically by `npm run compile`) wraps its CJS output in an IIFE and emits `dist/webview/comparisonWaveform.js`, which the Webview loads via `<script src>`. Do not hand-edit the generated file.

## Python style

- Use `ruff` (configured in `pyproject.toml`). Run `ruff format python-backend` before suggesting a commit.
- Prefer existing wandas APIs in `python-backend/analyzer.py`, `decimator.py`, `range_analyzer.py` over reimplementing DSP.

## TypeScript style

- `tsconfig` strict mode is on. Don't introduce `any` unless interfacing with untyped third-party code.
- Tests use `node:test`. Don't introduce Jest, Mocha, or Vitest.
- Edit existing files; don't create new ones unless the task requires it.

## When in doubt

If you'd violate any guidance in `AGENTS.md` or this file, surface the conflict in the suggestion message rather than silently working around it.
