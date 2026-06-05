---
name: ui-smoke-agent
description: Use when reproducing or preventing runtime-only Webview UI bugs with real Chromium checks, Playwright smoke specs, static HTML-pattern linting, or dogfooding the UI smoke layers against a suspected regression.
---

# ui-smoke-agent

Use this skill when a Webview bug can slip past jsdom or unit tests and must be checked in a real browser.

## Mandatory Rules

1. **L1 first**: Run `node scripts/lint-webview-patterns.js` before browser tests when the bug involves generated HTML / CSS visibility state.
2. **Chromium over jsdom**: Prefer `npm run test:ui` for modal visibility, keyboard focus, and console/runtime regressions that depend on actual browser behavior.
3. **Dogfood the guardrails**: When fixing a known bug, temporarily recreate the buggy state and confirm L1 and/or L2 fail before restoring the good state.
4. **Keep HTML self-contained**: UI smoke fixtures should inline the built waveform script and use deterministic dummy analysis data so Playwright failures are easy to reproduce.

## Standard workflow

```bash
# 1. Build typed sources
npm run compile

# 2. L1 static guard
node scripts/lint-webview-patterns.js

# 3. L2 real-browser smoke
npm run test:ui

# 4. Full completion bar
npm run verify
```

## Phase workflow

### Phase 1: Diff analysis

- inspect the touched Webview HTML / script generation paths first
- list which visibility, focus, or runtime behaviors changed
- decide whether the risk is static-pattern only, real-browser only, or both

### Phase 2: L1 static lint

- run `node scripts/lint-webview-patterns.js`
- fail fast on risky generated-markup patterns such as `hidden`/`aria-hidden` mixed with inline display styles
- if the change introduces dialog markup, verify the source also includes an Escape dismissal path

### Phase 3: L2 browser smoke

- run `npm run test:ui`
- verify modal visibility, keyboard dismissal, focus trapping, and console/page errors in Chromium
- keep failures reproducible with self-contained HTML fixtures

### Phase 4: Dynamic case generation

- derive a focused Playwright case directly from the regression shape instead of only reusing existing smoke coverage
- add or extend fixture HTML so the failing UI state can be recreated without VS Code extension-host setup
- cover each independent close/open path separately when behavior can regress asymmetrically (keyboard toggle, Escape, close button, backdrop click)

### Phase 5: Decision report

- summarize which layer caught the bug (`L1`, `L2`, or both)
- record the exact command results needed for the PR comment or handoff
- include a screenshot when the UI changed or when the regression is visual

### Phase 6: Cleanup

- remove temporary reproduction changes after dogfooding
- keep generated artifacts out of git (`test-results/`, `playwright-report/`, etc.)
- finish with `npm run verify` and, for Webview runtime changes, `npm run test:ui`

## Good targets for this skill

- `hidden` / `display` / `aria-modal` interactions
- focus traps and Escape-key dismissal
- popover visibility and keyboard toggles
- runtime `console.error` / uncaught exception checks
- regressions that pass jsdom but fail in Chromium
