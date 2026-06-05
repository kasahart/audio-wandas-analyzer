# CODEX.md

> **Start with [AGENTS.md](AGENTS.md).** It is the single source of truth for setup, commands, architecture, conventions, and guardrails. This file lists only Codex-specific additions.

## Project config

- `.codex/config.toml` is committed as the project-scoped Codex configuration. Codex loads it only after the repository is trusted.
- The project config enables a `PreToolUse` hook for edit tools. Review and trust the hook with `/hooks` when Codex first reports it.
- Keep personal model, provider, authentication, telemetry, and broad network choices in your user-level `~/.codex/config.toml`, not in this repository.

## Skills available in this repo

Codex discovers repo skills from `.agents/skills/` when launched inside this repository. Use them when the task matches:

| Skill | Use when |
|-------|----------|
| `wandas-getting-started` | Loading audio/CSV, creating signals, inspecting metadata, setting units |
| `wandas-signal-processing` | Filters, resampling, RMS, dB/A-weighting, psychoacoustic metrics |
| `wandas-spectral-analysis` | FFT, STFT, PSD, octave bands, coherence, transfer functions |
| `wandas-visualization` | Waveform / spectrogram / octave plots, `describe()` configuration |
| `wandas-analyst` | End-to-end analysis reports, multi-condition comparison, anomaly detection |
| `ui-smoke-agent` | Real-browser Webview smoke checks, Playwright regression reproduction, and L1/L2 dogfooding for runtime-only UI bugs |
| `ux-cognitive-auditor` | Screenshot-based UX cognitive-load and heuristics audits |

Prefer these over recreating DSP, charting, or UI-smoke workflows by hand.

## Working style in this repo

- Before any code change, create an isolated worktree with `bash scripts/worktree-new.sh <feature-slug>` and work from `.worktrees/<feature-slug>/`.
- The Codex hook blocks edit tools in the primary checkout. It allows edits in linked worktrees.
- Before declaring done, run `npm run verify`. If a Webview runtime behavior changed, also run `npm run test:ui`.
- If Codex sandboxing prevents these checks from running, request the narrow approval needed and report any check that still could not run.

## Recommended user-level allowlist

Codex project config should not grant machine-local privileges. For a smoother local loop, add narrow approvals or rules in your user-level Codex config for the same standard commands allowed by `.claude/settings.json`:

- `npm run *`, `npm test *`, `npm ci`, `npm install *`, `npm list *`
- `npx tsc *`, `node --test *`, `node dist/*`, `bash scripts/verify.sh`
- `ruff check *`, `ruff format *`
- `python -m pytest *`, `python3 -m pytest *`, `.venv/bin/python -m pytest *`
- read-only git commands: `git status *`, `git diff *`, `git log *`, `git show *`, `git branch *`

Do not add broad destructive allowances for `rm`, `git reset`, `git clean`, force-pushes, or bypass flags.
