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

## Good targets for this skill

- `hidden` / `display` / `aria-modal` interactions
- focus traps and Escape-key dismissal
- popover visibility and keyboard toggles
- runtime `console.error` / uncaught exception checks
- regressions that pass jsdom but fail in Chromium
