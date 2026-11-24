# GitHub Copilot Instructions

**Read [`AGENTS.md`](../AGENTS.md) first.** It is the single source of truth for setup, architecture, conventions, and the completion bar. The notes below only add Copilot-specific reminders.

## Completion bar

A change is only finished when `npm run verify` exits 0. Its steps are the `lanes` of `scripts/verify.mjs`, listed in AGENTS.md §3.

`npm run lint` (ESLint, `eslint.config.mjs`) is part of verify; fix findings rather than disabling rules; source files may not use non-null assertions (`!`).

`npm run test:ui` (Playwright) is also required for Webview runtime changes. E2E (`npm run verify:e2e`) is a separate, slower job.

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

## Webview bundles and figures

`scripts/build-webview.js` (run by `npm run compile`) bundles the Webview with esbuild into `dist/webview/comparisonRuntime.js` and `dist/webview/staticHost.js`. Do not hand-edit them; edit the TypeScript under `src/webview/`. Every figure is drawn by one component, `src/webview/figure/figure.ts`, from a picture of the figure service (`python-backend/figures/`); see AGENTS.md §5 Charts.

## GUI completion

User-facing GUI changes are complete only when the command/action/shortcut is reachable from the GUI, produces a perceptible result or feedback, is listed in `src/shared/gui/guiTriggerabilityInventory.ts`, and has a real regression layer: `node:test`, `ui-smoke`, or `vscode-e2e`. Do not use `planned` as a coverage placeholder.

## Python style

- Use `ruff` (configured in `pyproject.toml`). Run `ruff format python-backend` before suggesting a commit.
- Prefer existing wandas APIs in `python-backend/services/` (`analyzer.py`, `analysis_service.py`, `analysis_engine.py`) over reimplementing DSP.

## TypeScript style

- `tsconfig` strict mode is on. Don't introduce `any` unless interfacing with untyped third-party code.
- Tests use `node:test`. Don't introduce Jest, Mocha, or Vitest.
- Edit existing files; don't create new ones unless the task requires it.

## When in doubt

If you'd violate any guidance in `AGENTS.md` or this file, surface the conflict in the suggestion message rather than silently working around it.
