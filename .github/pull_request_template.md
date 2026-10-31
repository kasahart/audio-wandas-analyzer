## Summary

<!-- 1-3 bullets describing what changed and why. -->

-

## GUI reachability

- [ ] GUI entry point is present for every changed user-facing feature
- [ ] Changed command/action/shortcut is listed in `src/shared/gui/guiTriggerabilityInventory.ts`
- [ ] User-visible feedback exists for every changed GUI action
- [ ] Regression layer is `node:test`, `ui-smoke`, or `vscode-e2e`
- [ ] Related Issue state is updated or explicitly left open

## Verification

- [ ] `npm run verify` passes locally
- [ ] `npm run verify:e2e` passes locally (only if the change could affect the Webview / extension host)
- [ ] `npm run test:ui` passes locally (only if Webview runtime behavior changed)
- [ ] If conventions / commands changed: `AGENTS.md` (and `CLAUDE.md` / `CODEX.md` / `.github/copilot-instructions.md` if applicable) updated
- [ ] User-visible change noted in `CHANGELOG.md`

## Agent attribution

- Primary author: <!-- one of: Claude Code / GitHub Copilot / Human / Mixed -->
- Notes on how the agent was prompted (optional, helps reproducibility):
