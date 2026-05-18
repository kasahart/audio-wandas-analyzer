## Summary

<!-- 1-3 bullets describing what changed and why. -->

-

## Verification

- [ ] `npm run verify` passes locally
- [ ] `npm run verify:e2e` passes locally (only if the change could affect the Webview / extension host)
- [ ] If waveform rendering changed: BOTH `src/webview/waveform/waveformRenderer.ts` AND `media/comparisonWaveform.js` were updated
- [ ] If conventions / commands changed: `AGENTS.md` (and `CLAUDE.md` / `.github/copilot-instructions.md` if applicable) updated

## Agent attribution

- Primary author: <!-- one of: Claude Code / GitHub Copilot / Human / Mixed -->
- Notes on how the agent was prompted (optional, helps reproducibility):
