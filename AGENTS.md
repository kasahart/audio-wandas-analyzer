# AGENTS.md

Canonical project guide for any AI coding agent (Claude Code, GitHub Copilot, Cursor, Codex, etc.) working in this repository. Human contributors should also read this first.

> Agent-specific addenda live in:
> - [CODEX.md](CODEX.md) — Codex only (project config, skills, hooks, permissions)
> - [CLAUDE.md](CLAUDE.md) — Claude Code only (skills, hooks, permissions)
> - [.github/copilot-instructions.md](.github/copilot-instructions.md) — GitHub Copilot only

---

## 1. Project overview

VS Code extension that analyzes audio files. The extension host is TypeScript; the heavy DSP runs in a Python child process powered by [wandas](https://github.com/kasahart/wandas).

```
User picks audio file
  → src/extension/extensionContributions.ts (command handler; wired up in index.ts)
  → AnalysisClient → PythonBackendServer (persistent child process, NDJSON IPC)
  → python-backend/backend_server.py → command_dispatch.py → AnalysisService
  → src/webview/panels/ComparisonPanel.ts renders Webview
```

On-demand high-resolution waveform data during zoom:

```
Webview postMessage("request-waveform-range")
  → ComparisonSessionController → AnalysisClient → PythonBackendServer (TS)
  → backend_server.py → AnalysisService.waveform_range() (cached AnalysisEngine frame)
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
pip install -c python-backend/constraints.txt -e ".[dev]"   # ruff, pyright, pytest and the runtime deps, at the versions CI uses
```

Node 22 (`.nvmrc`, `engines.node`) and Python 3.11 are the supported versions (matches `.devcontainer/Dockerfile` and CI). The `-c python-backend/constraints.txt` pins every Python package to the version CI installs; without it `pyproject.toml` only gives lower bounds, and a newer ruff or pyright can pass or fail differently from CI. `scripts/check-single-sources.mjs` (part of verify) fails if a documented setup command drops it.

---

## 3. Canonical commands — the completion bar

**An agent's work is "done" only when `npm run verify` exits 0.** This is the single source of truth for correctness. `scripts/verify.mjs` (plain Node, runs on Windows/macOS/Linux) lists every step: compile, ESLint, Webview pattern lint, generated protocol types, single-source check, skills-copy check, GUI triggerability audit, node:test, ruff, pyright, pytest.

pytest opt-ins: `AWA_SLOW=1` runs the slow operation-catalog probe (CI sets it on Linux); `AWA_PERF=1` holds wall-clock budgets in pytest, node:test and the Playwright smoke, which are otherwise only reported. Without its variable an opt-in test is deselected, not skipped.

No silent skips in CI: with `CI=true` (GitHub Actions sets it) a node:test or pytest test that skips fails verify, and a Playwright test that does not run fails `npm run test:ui`, unless `scripts/test-skip-allowlist.json` lists it for its runner and OS with its reason and the issue that ends it. Every form counts: a skip mark or option, a skip called inside a test, a skipped suite, module or file, node:test's todo and Playwright's fixme. The allowlist only shrinks (an entry whose test runs fails too, and `src/test/testSkipGate.test.ts` holds its size to a ceiling). Why: tests that looked for `.venv/bin/python` only skipped in CI on every OS, unseen. A test that needs Python finds it by one rule (`WANDAS_PYTHON`, the workspace venv, `VIRTUAL_ENV`, `python3`, `python`): `pythonCandidates` in `src/extension/pythonInterpreter.ts` for the tests, and `scripts/python-candidates.mjs` for verify and the protocol-type generator, which run before `tsc compile` and so cannot import it; `src/test/pythonInterpreter.test.ts` fails when the two differ. A test that needs a link uses a directory junction, which Windows allows without extra rights. `scripts/test-skips.mjs` says how the gate works.

A verify step waits for every process it starts: one still running a moment after the step exited fails the step and is ended (its process group on POSIX; on Windows each step runs in a job object, `scripts/verify-job.ps1`, as Windows cannot find such a process by process tree). Where PowerShell's Constrained Language Mode blocks the helper's Add-Type, verify says so and asks for an unrestricted shell. Held by `src/test/verifyRunner.test.ts`.

Speed: verify runs three lanes at once (TypeScript, ESLint, Python; `AWA_VERIFY_SERIAL=1` runs them one by one with live output; the first failed step stops every lane with its whole process tree and verify exits non-zero at once, `scripts/verify-runner.mjs`) and pytest across the CPU cores (pytest-xdist `-n auto`). The Playwright smoke uses one worker per core (`AWA_UI_WORKERS` overrides it) and runs `plotContract.spec.ts` in parallel inside the file. `AWA_PERF=1` turns both back to serial pytest and Playwright's default workers, so its budgets see the load they were set under.

```bash
npm run verify        # see scripts/verify.mjs
npm run test:ui       # Playwright Chromium smoke for real-browser Webview regressions
npm run verify:e2e    # VS Code extension-host E2E (uses xvfb-run on Linux)
```

Other useful commands:

```bash
npm run compile       # tsc → dist/
npm run watch         # tsc --watch + esbuild watch of the Webview bundles
npm test              # node:test only (subset of verify)
npm run lint          # ESLint (typescript-eslint, type-aware) over src/ and scripts/ (subset of verify)
npm run lint:gui-triggerability   # static audit: every user-facing GUI feature must stay mapped
ruff check python-backend
ruff format python-backend
python -m pytest python-backend -q
```

Do **not** invent ad-hoc verification recipes. If a check is worth running, add it to `scripts/verify.mjs`.

### 並行作業用ハーネス

複数エージェントで並行に PR を進める／PR スタック中に独立した作業領域が必要なときは worktree を使う:

```bash
scripts/worktree-new.sh <feature-slug> [base-branch]   # base 既定: main
# .worktrees/<slug>/ に worktree が作られ、新規ブランチ <slug> が切られる。
# node_modules と .venv は symlink で共有、dist と .vscode-test は worktree 専有。
```

`npm run compile` は実行前に `scripts/clean-dist.js` で **対応する `src/**/*.ts` が存在しない tsc 出力 (`.js` / `.js.map`)** を自動削除する。ブランチ切替や rebase 後に古いテスト .js が node:test に拾われる事故 (stale dist) を防ぐ。`.json` や画像など tsc が emit しないファイルは対象外で誤削除されない。`scripts/build-webview.js` が生成する `dist/webview/comparisonWaveform.js`・`dist/webview/comparisonRuntime.js`・`dist/webview/staticHost.js` は `PROTECTED_RELATIVE` で保護する。

TS/JS の役割分担は `src/**/*.ts` が編集対象のソース、`dist/**/*.js` が compile で生成される実行物。Webview のバンドル生成物も手で編集せず、元の TS と build script を直す。

---

## 4. Architecture — key files

| File | Role |
|------|------|
| `src/extension/index.ts` | `activate`: wires the backend, panels, flows and status bar together |
| `src/extension/extensionContributions.ts` | Command, explorer-menu and welcome-view registration |
| `src/extension/pythonBackendServer.ts` | Persistent Python child process for analysis requests; NDJSON IPC |
| `src/webview/panels/ComparisonPanel.ts` | Multi-track comparison Webview shell and CSP-safe bootstrap data |
| `src/webview/runtime/comparisonEntry.ts` | Strict TypeScript entry for the modular Comparison Webview runtime |
| `src/shared/analysis/analysisTypes.ts` | Shared `AnalysisResult` / `DirectoryTreeNode` contracts |
| `src/webview/waveform/waveformRenderer.ts` | Pure TS waveform rendering pipeline (3 layers, no Canvas dependency). `src/webview/plot/waveformLayer.ts` imports it, so it ships inside `dist/webview/comparisonRuntime.js`. |
| `src/webview/waveform/rangeRequestPolicy.ts` | `isCacheSufficient` / `computeReqBounds` |
| `python-backend/analyzer.py` | `analyze_from_frame()` — display payload from calibrated wandas frames |
| `python-backend/decimator.py` | `decimated_waveform()` — bucket-level argmin/argmax |
| `python-backend/analysis_service.py` | Initial summary, detail, spectrum slice, waveform range, WAV export and Recipe |
| `python-backend/analysis_engine.py` | Cached audio frames and STFT by calibration/settings |
| `python-backend/backend_server.py` | Persistent NDJSON server; dispatches the validated commands in `command_dispatch.COMMANDS` (11 today) |

### Waveform rendering pipeline

`waveformRenderer.ts` is the **single source of truth**. `src/webview/plot/waveformLayer.ts` imports its layers, so they ship inside the runtime bundle `dist/webview/comparisonRuntime.js`. (`dist/webview/comparisonWaveform.js` only exposes the loop-region painter `paintLoopRegion`.) Three pure layers:

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

Line endings: every text file is LF in the repository and in every checkout, on every OS (`.gitattributes`, which overrides `core.autocrlf`), so tests compare files byte for byte and never normalise `\r\n`; a file that must be CRLF is named in `.gitattributes` with its reason.

### TypeScript

- `tsconfig` strict mode. No `any` unless interfacing with untyped third-party code.
- ESLint (`eslint.config.mjs`) must pass; `no-non-null-assertion` holds in every source file (tests may keep `!`).
- Comments only when *why* is non-obvious; never restate *what*.
- Edit existing files in preference to creating new ones.
- Tests live in `src/test/` and `src/e2e/` and use `node:test` (no Jest, no Mocha).

### Python

- Lint/format: **Ruff** (config in `pyproject.toml`). Run `ruff format` before committing.
- Types: **pyright** basic mode over the non-test modules (`[tool.pyright]` in `pyproject.toml`). Silence a finding only where wandas' own annotations are wrong, with a narrow `# pyright: ignore[rule]` and the reason.
- Prefer wandas APIs over reimplementing DSP. See `python-backend/analyzer.py` for the canonical entry point.
- Tests use `pytest` and live alongside the module they test (`python-backend/test_*.py`).
- The backend never leaves its request or reply pipe as a standard handle of the process. `backend_server._request_stream` reads requests through a private fd and points fd 0 and the Win32 standard input handle at the null device, because on Windows a thread loading a DLL (a lazy scipy import) queries the standard input and would wait for the main thread's pending read on the pipe, that is for the host's next request. `backend_server._reply_stream` writes replies through a private fd and points fd 1, the Win32 standard output handle and `sys.stdout` where stderr goes, because anything else written to the standard output (a library's `print`, C code, a child process) would otherwise land inside the JSON-lines protocol; there it lands in the log. stderr stays the pipe the host reads: the host reads it continuously, so a write there waits a moment at most. Held by `test_the_backends_standard_input_is_not_its_request_pipe` and `test_what_a_request_writes_to_the_standard_output_lands_in_the_log_and_never_in_the_reply_stream`.

### Charts

- Every chart follows the numbered rules in [docs/display-rules.md](docs/display-rules.md). A change that decides a new rule adds it there with the test that checks it; `src/test/displayRules.test.ts` fails when a listed test is missing or any rule is marked 未.
- Every chart and every value a user reads off it (readout, ← / →, Δ, median, headline, order, auto range, ticks, axis names, exports, counts, data identity, pending state) is a row of `src/test/plotContracts/charts/<chart>.ts` (one file per chart), rendered to [docs/plot-contracts.md](docs/plot-contracts.md). `src/test/plotContracts.test.ts` fails when a plot-component call, a `plotRegistry.ts` plot, a function that writes a number (`toFixed`… or a `VALUE_HELPERS` call), or a numeric protocol field (`schema.ts`) is missing from it; when a row's source disagrees with what its functions read; when a named test or function does not exist; or when the gaps differ from each chart's `knownGaps` or from `GAP_CEILING`, which only goes down. Regenerate the doc with `npm run compile && node dist/test/plotContracts/render.js`.
- A number a user reads comes from the full data, never from points thinned to draw. The compiler enforces it in the webview: thinned arrays are typed `Drawn` and cannot be computed with; readouts and exports take only `Whole` (`src/shared/provenance.ts`, checked further by `src/test/provenanceBoundary.test.ts`). The backend is checked by data flow (`scripts/check_decimation_flow.py`). Which layer decides what on a chart: [docs/plot-layers.md](docs/plot-layers.md).
- Adding a chart, a number a user reads, or a canvas/SVG: read [docs/plot-contracts-guide.md](docs/plot-contracts-guide.md) first. It says what the contract tests will ask of you (rows, `NOT_CHART_VALUES`, `surfaces.ts`, proof tests with `assertNotDrawn` / `assert_not_drawn`, `scripts/check_test_proofs.py`).

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

Every browser layer runs in a pinned locale, never the machine's: headless Chromium takes `navigator.language` (the static page's UI language) and its `Intl` from `LANG`, so a Japanese desktop once passed a check that failed in CI's English. `playwright.config.ts` sets `locale: 'en-US'`; `scripts/test-browser-parity.js` opens every page in `en-US` (`AWA_BROWSER_LOCALE=ja npm run test:browser` runs the same checks on the Japanese page). Tests read a CSV the Analyzer wrote with `csvRecords` (`src/shared/utils/csv.ts`), never by splitting a line on `,`: an English header has commas in it ("Level, uncalibrated [dBFS]"). Every CSV writer quotes its fields with `csvField` from that module.

### GUI triggerability audit boundary

- `scripts/verify-gui-triggerability.js` compares the declared GUI inventory against:
  - contributed VS Code commands in `package.json`
  - `data-action` buttons in `src/webview/runtime/comparisonRuntime.ts`
  - shortcut rows exported from `src/webview/runtime/shortcuts.ts`
- The source of truth for the inventory lives in `src/shared/gui/guiTriggerabilityInventory.ts`
- Scope is **user-facing GUI features only**
- Explicitly excluded from this audit:
  - `audioWandasAnalyzer.analyzeDebugFile`
  - startup debug automation and environment-variable-only flows
  - test-only actions / snapshots / internal diagnostics
- When adding a new GUI feature, update the inventory and the matching regression layer in the same change
- A user-facing GUI feature is not complete until it has a reachable entry point, a perceptible result or feedback, and at least one real regression layer: `node:test`, `ui-smoke`, or `vscode-e2e`
- `planned` is not a valid regression layer; temporary uncovered work must carry `coverageDebt: { issue, reason }` with `issue` as `#123` or a GitHub issue URL

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
- **Codex**: also read [CODEX.md](CODEX.md). It documents the project `.codex/config.toml`, repo skills under `.agents/skills/`, and the worktree edit hook.
- **GitHub Copilot**: also read [.github/copilot-instructions.md](.github/copilot-instructions.md). It restates the completion bar and the waveform-mirror invariant in a form Copilot picks up automatically.
