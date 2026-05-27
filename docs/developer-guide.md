# Developer Guide

**English** | [日本語](./developer-guide.ja.md)

This guide is for developers who are new to this repository and want the shortest path from setup to safe changes.

## 1. What this project is

Audio Wandas Analyzer is a VS Code extension.

- **TypeScript extension host** handles commands, file picking, VS Code integration, and Webview messaging.
- **Python backend** does the heavy audio analysis with `wandas`.
- **Webview UI** renders the comparison panel for waveform, spectrogram, and power spectrum views.

Start here for the bigger picture:

- Product/user overview: [`README.md`](../README.md)
- Architecture details: [`docs/architecture.md`](./architecture.md)
- Repository guardrails and canonical commands: [`AGENTS.md`](../AGENTS.md)

## 2. Supported dev environment

- **Node.js**: 22
- **Python**: 3.11
- **Recommended environment**: the repository devcontainer

Fresh setup:

```bash
npm install
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## 3. The daily workflow

The normal loop is:

1. Make changes in `src/` or `python-backend/`.
2. Run the smallest relevant check while iterating.
3. Finish with `npm run verify`.
4. If the change affects runtime Webview behavior, also run `npm run test:ui`.

Canonical commands:

```bash
npm run compile
npm test
npm run verify
npm run test:ui
npm run verify:e2e
```

`npm run verify` is the completion bar for normal development. It runs the TypeScript build, Webview static checks, unit tests, Ruff, and Pytest.

## 4. Where to edit for common tasks

| Task | Main files |
| --- | --- |
| Register commands / wire VS Code actions | `src/extension/index.ts` |
| Persistent waveform range server | `src/extension/waveformServer.ts`, `python-backend/waveform_server.py` |
| Comparison panel shell / HTML container | `src/webview/panels/ComparisonPanel.ts` |
| Webview interaction logic | `src/webview/comparisonRenderScript.ts` |
| Waveform rendering pipeline | `src/webview/waveform/waveformRenderer.ts` |
| Shared data contracts | `src/shared/analysis/analysisTypes.ts` |
| Full-file backend analysis | `python-backend/analyzer.py` |
| Waveform decimation | `python-backend/decimator.py` |
| High-resolution range analysis | `python-backend/range_analyzer.py` |
| TS unit tests | `src/test/` |
| Webview browser smoke tests | `src/test/uiSmoke/` |
| VS Code E2E | `src/e2e/` |

## 5. Browser preview and UI work

For Webview work, you usually do not need to launch the full extension host first.

VS Code tasks:

- **Preview ComparisonPanel (Results)**
- **Preview ComparisonPanel (Selection)**

These generate standalone browser previews from `dist/tools/openComparisonPreview.js`.

Use them when:

- you are changing ComparisonPanel layout or interaction
- you want a quick reproduction outside VS Code
- you need to inspect preview-only behavior

Use the **results** preview for waveform / graph motion. The **selection** preview is for the file-selection state.

## 6. Important repository rules

- Do **not** edit generated output in `dist/`.
- Do **not** edit vendored or environment-local paths such as `node_modules/`, `.venv/`, `.vscode-test/`, or `.worktrees/`.
- Prefer editing existing files over creating new ones.
- Keep TypeScript strict; do not introduce `any` unless unavoidable at an external boundary.
- Use Ruff for Python formatting and linting.
- Keep behavior changes covered by existing test layers instead of inventing one-off checks.

## 7. Webview-specific gotchas

- `src/webview/waveform/waveformRenderer.ts` is the single source of truth for comparison waveform rendering.
- `npm run compile` rebuilds `dist/webview/comparisonWaveform.js` through `scripts/build-webview.js`.
- If you add or change a user-facing GUI action, update the GUI triggerability inventory in `src/shared/gui/guiTriggerabilityInventory.ts` and keep the matching regression coverage in sync.
- If a bug only shows up in a real browser, use `npm run test:ui` instead of relying only on jsdom-based tests.

## 8. Python/backend notes

- Prefer existing `wandas`-based paths in `python-backend/analyzer.py`, `decimator.py`, and `range_analyzer.py` over reimplementing DSP logic.
- Python tests live next to the backend modules as `python-backend/test_*.py`.
- The extension host and backend communicate through JSON over child-process stdio; keep that boundary explicit and small.

## 9. Before opening a PR

Use this checklist:

1. `npm run verify`
2. `npm run test:ui` if the change affects Webview runtime behavior
3. `npm run verify:e2e` if the change affects full extension-host flows
4. Confirm you did not modify generated or read-only paths
5. Confirm docs changed if behavior or workflow changed

## 10. If you are unsure where to start

Use this order:

1. Read [`README.md`](../README.md) for the product and user-facing flow.
2. Read [`AGENTS.md`](../AGENTS.md) for the repository rules and canonical commands.
3. Read [`docs/architecture.md`](./architecture.md) for the component boundaries.
4. Then inspect the specific files listed in section 4 for the area you want to change.
