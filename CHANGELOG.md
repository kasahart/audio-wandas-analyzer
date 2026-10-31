# Changelog

User-visible changes per release. Pull requests add a line under **Unreleased**; the release PR turns it into the version heading (the tag `vX.Y.Z` must match `package.json`).

## Unreleased

- Analysis chain: entry table for up to 100,000 recordings, a dataset table with distributions, a step bar that builds a wandas Recipe, and per-folder sessions (#410, #414, #415).
- Compare view: roles per recording, the tracks' selection carried in as the region, recordings drawn as they are computed, cross-correlation (#452–#456, #468, #472).
- Track lanes: waveform over spectrogram on one time axis, linked amplitude/colour/frequency scales, only lanes near the view drawn and fetched (#427, #442, #444).
- Cursor spectrum snaps to the nearest STFT frame; spectrogram cells centred on their windows (#436, #438).
- Trackpad sideways swipe pans the timeline (#471).
- Track lanes fetch the waveform detail two screens either side of the view, so a pan no longer flashes the coarse overview, and a zoom out keeps the detail already fetched until the new one lands (#502).
- Python backend answers requests for different recordings concurrently and reads audio straight into float32 (#462, #464).
- Updated to wandas 0.12.0 (#409, #446, #468).
- Python starts only when a command, view or panel needs it; Select Python Environment can create a `.venv` and install the packages, detects PEP 668 interpreters and uses the Python extension's interpreter; Restricted Mode is supported with the user-level interpreter.
- Every analysis request can be cancelled and times out; Python's errors go to the "Audio Wandas Analyzer" output channel.
- A spectrogram or cursor spectrum that fails says why in its lane and is retried after a pause instead of on every frame; files larger than the cache are no longer re-read on every zoom; non-ASCII paths work on Windows code pages.
- Keyboard: one help (`?`) for every view; Compare toggles its base with `B` (was `0`); entry-table track marks are ☐/☑ (`T` toggles the focused row); canvases and resize edges are focusable and keyboard-resizable.
- Entry table keeps file names' ends in view with the full path as a tooltip; disabled controls say why; PNG/CSV export shows progress; settings popovers use plain labels; light-theme contrast and High Contrast Light role colours fixed; the transfer-function reference is called 参照 in Japanese.
- The webview may read, scan and export only files its panel lists; large folders are listed with a cap, skip symlinked folders and can be cancelled.
- The VSIX no longer ships scripts, tests, agent files or the debug WAV (about 10 MB → 4 MB).
- Tooling: CI runs verify on Linux, Windows and macOS; releases publish only after every CI job passes; pinned CI Python packages; Dependabot; type-aware ESLint and pyright in verify; wall-clock budgets only with `AWA_PERF=1`.

## 0.0.14

- Marketplace icon shrunk below the upload limit (#405).

## 0.0.13

- Save the bottom-panel analysis as a wandas Recipe (#396).
- Recipe replay checked on other inputs, per-command validation (#399).
- README points to the browser version; Marketplace tags listed (#401).
