# GitHub Copilot Instructions

**Read [`AGENTS.md`](../AGENTS.md) first.** It is the single source of truth for setup, architecture, conventions, and the completion bar. The notes below only add Copilot-specific reminders.

## Completion bar

A change is only finished when `npm run verify` exits 0. That script runs:

- `tsc` compile
- `node:test` against `dist/test/`
- `ruff check` and `ruff format --check` on `python-backend`
- `pytest` on `python-backend`

E2E (`npm run verify:e2e`) is a separate, slower job.

## Read-only paths

Never suggest edits to these directories — they are generated, vendored, or environment-local:

- `dist/`
- `node_modules/`
- `.venv/`
- `.vscode-test/`
- `.worktrees/`

## Cross-language invariant (important)

`media/comparisonWaveform.js` is a plain-JavaScript mirror of `src/webview/waveform/waveformRenderer.ts`. They implement the same 3-layer rendering algorithm and **must stay in lockstep**.

If you propose a change to one, propose the matching change to the other in the same commit. `src/test/renderScript.integration.test.ts` (run via `npm test`) catches divergence at runtime.

## Python style

- Use `ruff` (configured in `pyproject.toml`). Run `ruff format python-backend` before suggesting a commit.
- Prefer existing wandas APIs in `python-backend/analyzer.py`, `decimator.py`, `range_analyzer.py` over reimplementing DSP.

## TypeScript style

- `tsconfig` strict mode is on. Don't introduce `any` unless interfacing with untyped third-party code.
- Tests use `node:test`. Don't introduce Jest, Mocha, or Vitest.
- Edit existing files; don't create new ones unless the task requires it.

## When in doubt

If you'd violate any guidance in `AGENTS.md` or this file, surface the conflict in the suggestion message rather than silently working around it.
