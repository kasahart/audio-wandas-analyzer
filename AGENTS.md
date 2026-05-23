# AGENTS.md

Canonical project guide for any AI coding agent (Claude Code, GitHub Copilot, Cursor, Codex, etc.) working in this repository. Human contributors should also read this first.

> Agent-specific addenda live in:
> - [CLAUDE.md](CLAUDE.md) — Claude Code only (skills, hooks, permissions)
> - [.github/copilot-instructions.md](.github/copilot-instructions.md) — GitHub Copilot only

---

## 1. Project overview

VS Code extension that analyzes audio files. The extension host is TypeScript; the heavy DSP runs in a Python child process powered by [wandas](https://github.com/kasahart/wandas).

```
User picks audio file
  → src/extension/index.ts (command handler)
  → spawns python-backend/main.py as child process (stdout JSON)
  → src/webview/panels/ComparisonPanel.ts renders Webview
```

On-demand high-resolution waveform data during zoom:

```
Webview postMessage("request-waveform-range")
  → src/extension/index.ts → WaveformServer (TS)
  → python-backend/waveform_server.py (persistent, newline-JSON IPC)
  → postMessage("waveform-range-result") back to Webview
```

See [docs/architecture.md](docs/architecture.md) for full detail.

---

## 2. Setup

The repository ships with a working devcontainer. Use it whenever possible.

**Fresh local setup**

```bash
npm install
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"      # installs ruff + pytest + runtime deps via pyproject.toml
```

Node 22 and Python 3.11 are the supported versions (matches `.devcontainer/Dockerfile` and CI).

---

## 3. Canonical commands — the completion bar

**An agent's work is "done" only when `npm run verify` exits 0.** This is the single source of truth for correctness. That script now includes the Webview pattern lint (`node scripts/lint-webview-patterns.js`) in addition to compile + unit checks.

```bash
npm run verify        # compile + webview pattern lint + node:test + ruff check + ruff format --check + pytest
npm run test:ui       # Playwright Chromium smoke for real-browser Webview regressions
npm run verify:e2e    # VS Code extension-host E2E (uses xvfb-run on Linux)
```

Other useful commands:

```bash
npm run compile       # tsc → dist/
npm run watch         # tsc --watch
npm test              # node:test only (subset of verify)
ruff check python-backend
ruff format python-backend
python -m pytest python-backend -q
```

Do **not** invent ad-hoc verification recipes. If a check is worth running, add it to `scripts/verify.sh`.

### 並行作業用ハーネス

複数エージェントで並行に PR を進める／PR スタック中に独立した作業領域が必要なときは worktree を使う:

```bash
scripts/worktree-new.sh <feature-slug> [base-branch]   # base 既定: main
# .worktrees/<slug>/ に worktree が作られ、新規ブランチ <slug> が切られる。
# node_modules と .venv は symlink で共有、dist と .vscode-test は worktree 専有。
```

`npm run compile` は実行前に `scripts/clean-dist.js` で **対応する `src/**/*.ts` が存在しない tsc 出力 (`.js` / `.js.map`)** を自動削除する。ブランチ切替や rebase 後に古いテスト .js が node:test に拾われる事故 (stale dist) を防ぐ。`.json` や画像など tsc が emit しないファイルは対象外で誤削除されない。別 build スクリプトが生成する成果物 (現状は将来予定の `dist/webview/comparisonWaveform.js`) は `PROTECTED_RELATIVE` で保護する。

---

## 4. Architecture — key files

| File | Role |
|------|------|
| `src/extension/index.ts` | Command registration, file picking, Python spawn, message routing |
| `src/extension/waveformServer.ts` | Persistent Python child process for range requests; newline-JSON IPC |
| `src/webview/panels/ComparisonPanel.ts` | Multi-track comparison Webview; `renderScript()` returns the inline JS |
| `src/shared/analysis/analysisTypes.ts` | Shared `AnalysisResult` / `DirectoryTreeNode` contracts |
| `src/webview/waveform/waveformRenderer.ts` | Pure TS waveform rendering pipeline (3 layers, no Canvas dependency). `scripts/build-webview.js` packages it as `dist/webview/comparisonWaveform.js` for the Webview. |
| `src/webview/waveform/rangeRequestPolicy.ts` | `isCacheSufficient` / `computeReqBounds` |
| `python-backend/analyzer.py` | `analyze_audio()` — full-file analysis via wandas |
| `python-backend/decimator.py` | `decimated_waveform()` — bucket-level argmin/argmax |
| `python-backend/range_analyzer.py` | `analyze_range()` — range-only high-res waveform via soundfile |
| `python-backend/waveform_server.py` | Persistent server loop; caches loaded files |

### Waveform rendering pipeline

`waveformRenderer.ts` is the **single source of truth**. `scripts/build-webview.js` wraps the compiled CJS output into an IIFE and emits `dist/webview/comparisonWaveform.js`, which the Webview loads via `<script src>`. Three pure layers:

1. **CoordTransform** (`makeCoordTransform`) — file-normalized time `tNorm ∈ [0,1]` → canvas x, using `offsetNorm` and `trackDurRatio`.
2. **Decimation** (`computeViewRange` + `decimateBuckets`) — choose bucket range and apply argmin/argmax.
3. **Painting** (`paintDecimatedPoints`) — the only layer that touches Canvas.

Multi-track global span:

```
globalStartSec = min(offsetSeconds[i])
globalEndSec   = max(offsetSeconds[i] + durationSeconds[i])
trackStart     = (offsetSec - globalStartSec) / globalSpanSec   → offsetNorm
trackDurRatio  = durationSeconds / globalSpanSec
```

`zoomStart/zoomEnd ∈ [0,1]` refer to the global span. Python's `decimated_waveform()` returns `minT`/`maxT` normalized to the **full file**, not the requested range.

---

## 5. Conventions

### TypeScript

- `tsconfig` strict mode. No `any` unless interfacing with untyped third-party code.
- Comments only when *why* is non-obvious; never restate *what*.
- Edit existing files in preference to creating new ones.
- Tests live in `src/test/` and `src/e2e/` and use `node:test` (no Jest, no Mocha).

### Python

- Lint/format: **Ruff** (config in `pyproject.toml`). Run `ruff format` before committing.
- Prefer wandas APIs over reimplementing DSP. See `python-backend/analyzer.py` for the canonical entry point.
- Tests use `pytest` and live alongside the module they test (`python-backend/test_*.py`).

---

## 6. Testing strategy

| Layer | Runner | Files |
|-------|--------|-------|
| TS unit | `node:test` (compiled to `dist/test/`) | `src/test/*.test.ts` |
| TS webview-script integration | `node:test` + jsdom | `src/test/renderScript.integration.test.ts` |
| TS webview browser smoke | `@playwright/test` + Chromium | `src/test/uiSmoke/*.spec.ts` |
| Python unit | `pytest` | `python-backend/test_*.py` |
| VS Code E2E | `@vscode/test-electron` (xvfb on Linux) | `src/e2e/suite/index.ts` |

`npm run verify` runs the static lint plus the unit layers above except Playwright browser smoke and VS Code E2E. `npm run test:ui` is the real-browser smoke layer for Webview regressions. VS Code E2E remains separate (`npm run verify:e2e`) because it needs a full extension host and is slower; CI runs both as separate jobs.

---

## 7. Agent guardrails (applies to every agent)

1. **Read this file before any non-trivial change.**
2. **Don't create new files** unless the task genuinely requires it. Prefer editing existing files. No new markdown docs unless the user asks.
3. **Read-only paths**: `dist/`, `.venv/`, `node_modules/`, `.vscode-test/`, `.worktrees/`. Never edit or stage them.
4. **Completion bar**: `npm run verify` must pass before claiming the task is done. If you can't run it, say so explicitly — don't claim success.
5. **No comments restating what the code does.** No multi-paragraph docstrings. No "added for issue #X" notes.
6. **Don't add fallback/error handling for impossible cases.** Validate at boundaries (user input, IPC payloads), trust internal code.
7. **Don't bypass quality gates**: never use `--no-verify`, `--no-gpg-sign`, `git push --force` to main, or `pytest --noconftest` to silence a failure. Diagnose the root cause.

---

## 8. Agent-specific notes

- **Claude Code**: also read [CLAUDE.md](CLAUDE.md). It documents the available `wandas-*` skills and `.claude/settings.json` permissions.
- **GitHub Copilot**: also read [.github/copilot-instructions.md](.github/copilot-instructions.md). It restates the completion bar and the waveform-mirror invariant in a form Copilot picks up automatically.
