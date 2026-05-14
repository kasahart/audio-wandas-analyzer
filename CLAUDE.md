# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build (TypeScript → dist/)
npm run compile

# Watch mode
npm run watch

# Run all tests
npm test

# Run a single test file
npm run compile && node --test dist/test/waveformRenderer.test.js

# Run VS Code E2E smoke tests
npm run test:e2e:vscode

# Python backend tests
cd python-backend && python -m pytest test_decimator.py -v
```

## Architecture

This is a VS Code extension that analyzes audio files. A TypeScript extension host manages the UI (Webview), while a Python backend powered by [wandas](https://github.com/kasahart/wandas) does the heavy lifting.

### Data flow

```
User picks audio file
  → extension.ts (command handler)
  → spawns python-backend/main.py as child process (stdout JSON)
  → ComparisonPanel.ts renders Webview
```

For on-demand high-resolution waveform data during zoom:

```
Webview JS postMessage("request-waveform-range")
  → extension.ts forwards to WaveformServer
  → WaveformServer (TypeScript) keeps python-backend/waveform_server.py alive
  → waveform_server.py responds with newline-delimited JSON via stdin/stdout
  → extension.ts postMessage("waveform-range-result") back to Webview
```

### Key files

| File | Role |
|------|------|
| `src/extension.ts` | Command registration, file picking, Python process spawning, message routing |
| `src/waveformServer.ts` | Persistent Python child process for range requests; newline-JSON IPC |
| `src/panels/ComparisonPanel.ts` | Multi-track comparison Webview; contains `renderScript()` (large inline JS) and `getWebviewContent()` |
| `src/panels/analysisTypes.ts` | Shared `AnalysisResult` / `DirectoryTreeNode` contracts used by the extension and Webview |
| `src/panels/waveformRenderer.ts` | Pure TypeScript waveform rendering pipeline (3 layers, no Canvas dependency) |
| `src/panels/rangeRequestPolicy.ts` | `isCacheSufficient` / `computeReqBounds` — decides when to fetch higher-res data |
| `media/comparisonWaveform.js` | Plain-JS mirror of `waveformRenderer.ts` loaded in the Webview via `localResourceRoots`; exposes `window.renderWaveformPipeline` |
| `python-backend/analyzer.py` | `analyze_audio()` — full-file analysis using wandas |
| `python-backend/decimator.py` | `decimated_waveform()` — bucket-level argmin/argmax with normalized timestamps |
| `python-backend/range_analyzer.py` | `analyze_range()` — range-only high-res waveform via soundfile |
| `python-backend/waveform_server.py` | Persistent server loop; caches loaded files in `_file_cache` |

### Waveform rendering pipeline (3 layers)

`waveformRenderer.ts` and `media/comparisonWaveform.js` implement the same algorithm:

- **Layer 1 — CoordTransform** (`makeCoordTransform`): converts file-normalized time `tNorm ∈ [0,1]` to canvas x using `offsetNorm` (global start of track) and `trackDurRatio` (track duration / global span). Pure function, no Canvas.
- **Layer 2 — Decimation** (`computeViewRange` + `decimateBuckets`): selects the bucket index range to draw and applies argmin/argmax decimation. Pure function, no Canvas.
- **Layer 3 — Painting** (`paintDecimatedPoints`): the only place that touches Canvas API.

#### Multi-track global time coordinate system

When multiple tracks have different offsets, a global span is computed:
```
globalStartSec = min(offsetSeconds[i])
globalEndSec   = max(offsetSeconds[i] + durationSeconds[i])
globalSpanSec  = globalEndSec - globalStartSec

trackStart    = (offsetSec - globalStartSec) / globalSpanSec   → passed as offsetNorm
trackDurRatio = durationSeconds / globalSpanSec                → scales tNorm in toX
```
`zoomStart/zoomEnd ∈ [0,1]` always refer to this global span. `computeGlobalSpan()` in the Webview JS recomputes this on every render.

The Python `decimated_waveform()` returns `minT`/`maxT` as positions normalized to the **full file** (not the requested range), so they map correctly into `[0,1]` file-normalized space.

### Testing

Tests are plain Node.js `node:test` modules compiled to `dist/test/`. They run without VS Code.

For VS Code-hosted UI smoke tests, use `npm run test:e2e:vscode`. This launches the compiled extension in a VS Code test host, runs the `Audio Analyzer: Analyze Debug Path` flow against the workspace debug audio, and verifies the ComparisonPanel UI state. In headless Linux environments, the script uses `xvfb-run` automatically when available.

- `src/test/waveformRenderer.test.ts` — unit tests for all 3 rendering layers including `trackDurRatio` and offset scenarios
- `src/test/rangeRequestPolicy.test.ts` — cache sufficiency and request bound logic
- `src/test/renderScript.integration.test.ts` — runs `ComparisonPanel.renderScript()` inside jsdom to verify the Webview JS executes without errors
- `src/test/helpers/comparisonScriptLoader.ts` — stubs the `vscode` module so `ComparisonPanel` can be imported in Node.js tests
- `src/test/helpers/webviewTestEnv.ts` — jsdom environment setup for Webview script integration tests
- `src/e2e/suite/index.ts` — VS Code E2E smoke scenarios for debug-path analysis, toolbar and track visibility, zoom behavior, view switching, and offset-visible-range checks

`media/comparisonWaveform.js` must stay in sync with `waveformRenderer.ts`. When changing rendering logic, update both files and run `npm test` to catch divergence via `renderScript.integration.test.ts`.
