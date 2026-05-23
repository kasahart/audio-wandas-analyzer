# CLAUDE.md

> **Start with [AGENTS.md](AGENTS.md).** It is the single source of truth for setup, commands, architecture, conventions, and guardrails. This file lists only Claude-Code-specific additions.

## Skills available in this repo

The `.claude/skills/` tree provides wandas-focused skills. Invoke them via the Skill tool when the task matches:

| Skill | Use when |
|-------|----------|
| `wandas-getting-started` | Loading audio/CSV, creating signals, inspecting metadata, setting units |
| `wandas-signal-processing` | Filters, resampling, RMS, dB/A-weighting, psychoacoustic metrics |
| `wandas-spectral-analysis` | FFT, STFT, PSD, octave bands, coherence, transfer functions |
| `wandas-visualization` | Waveform / spectrogram / octave plots, `describe()` configuration |
| `wandas-analyst` | End-to-end analysis reports, multi-condition comparison, anomaly detection |
| `ui-smoke-agent` | Real-browser Webview smoke checks, Playwright regression reproduction, and L1/L2 dogfooding for runtime-only UI bugs |

Prefer these over recreating DSP code by hand.

## Permissions and hooks

- `.claude/settings.json` (committed) holds the **shared** allowlist needed for the standard verify loop (npm, ruff, pytest, git read-only, the wandas skills). Treat it as the minimum every contributor agrees to.
- `.claude/settings.local.json` (gitignored) is for personal additions only.

## Working style in this repo

- Use `TodoWrite` for any task with 3+ steps.
- Use the `Explore` subagent for codebase-wide questions; use direct `Read`/`Grep` for known paths.
- Before declaring done, run `npm run verify`. If the change touches Webview runtime behavior, also run `npm run test:ui`. If either command can't run in your sandbox, say so explicitly rather than claiming success.
