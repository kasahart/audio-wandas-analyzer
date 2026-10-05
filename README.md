# Audio Wandas Analyzer

**English** | [日本語](https://github.com/kasahart/audio-wandas-analyzer/blob/main/README.ja.md)

Turn VS Code into a focused audio inspection desk. Audio Wandas Analyzer lets you open audio files, compare takes on one timeline, zoom into waveform detail, inspect spectrograms and cursor-time spectra, and export the evidence you need without switching tools.

## Screenshot

![Audio Wandas Analyzer screenshot](https://raw.githubusercontent.com/kasahart/audio-wandas-analyzer/main/media/readme-audio-wandas-analyzer.png)

![Audio Wandas Analyzer spectrogram screenshot](https://raw.githubusercontent.com/kasahart/audio-wandas-analyzer/main/media/readme-audio-wandas-analyzer_stft.png)

## Why Use It

Audio comparison often means bouncing between a DAW, a notebook, a file browser, and a plotting script. This extension keeps that loop inside VS Code:

- Line up multiple recordings and check timing differences at a glance
- Move between waveform, spectrogram, and power spectrum views without reloading files
- Zoom into a range and fetch high-resolution waveform data only for what is visible
- Listen, mute, loop, and nudge tracks while you inspect them
- Export images, CSV spectrum data, loop audio, or a Markdown-friendly report for handoff
- Run bundled or custom [wandas](https://github.com/kasahart/wandas) recipes for deeper analysis

Supported formats: **WAV / FLAC / OGG / AIFF / AIF / SND**

The UI follows VS Code's display language. Japanese is used for `ja*`; all other languages fall back to English.

## A Good Fit For

- Comparing model outputs, recorded takes, renders, or before/after processing results
- Checking noise, frequency balance, transients, silence, clipping, and alignment
- Reviewing a folder of audio assets without leaving your editor
- Capturing visual and numeric evidence for issues, reports, notebooks, or pull requests

## Quick Start

### 1. Install Python 3.11+

```bash
python3 --version
```

### 2. Install the Python audio dependencies

A virtual environment is recommended:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install "wandas[psychoacoustic]>=0.7.2,<0.8.0" "numpy>=2.0.2" "scipy>=1.13" "soundfile>=0.12"
```

### 3. Select the Python environment in VS Code

Open the Command Palette and run:

```text
Audio Analyzer: Select Python Environment
```

Choose the virtual environment folder, for example `/path/to/your/.venv`. You can also set `audioWandasAnalyzer.pythonCommand` manually in Settings. Both venv folders and direct Python executable paths are accepted.

## Opening Audio

| Method | Action |
| --- | --- |
| Command Palette | Run **Audio Analyzer: Analyze File or Folder** |
| Explorer context menu | Right-click an audio file or folder, then choose **Analyze with Audio Analyzer** |
| Activity Bar | Open the **Audio Analyzer** view and select files or a folder |
| Drag and drop | Drop audio files or folders onto the Audio Analyzer sidebar view |

When you open a folder, supported audio files appear in a tree. Check a file to add it to the comparison panel; uncheck it to remove that track.

## Working In The Panel

- **Compare:** view tracks on one shared timeline and switch each row between waveform and spectrogram
- **Zoom:** use the toolbar `+ / - / 0` buttons, keyboard shortcuts, or the mouse wheel over a plot
- **Inspect:** click a waveform, spectrogram, or spectrum panel to move the cursor and update spectra
- **Loop:** drag on the waveform to create a loop region; clear it with a click
- **Listen:** use the per-track play button; mute tracks with `M`
- **Align:** nudge track offsets with the `▲ / ▼` controls or double-click the offset value to reset it
- **Tune spectrograms:** open the gear popover to change FFT size, hop length, window function, dB range, and max frequency
- **Get help:** press `?` inside the panel to see keyboard shortcuts

## Exports And Recipes

The comparison toolbar includes export actions for everyday handoff work:

| Action | Output |
| --- | --- |
| **Export PNG** | Current visible tracks as an image |
| **Export CSV** | Spectrum data at the current cursor position |
| **Export WAV** | Audio from the selected loop region |
| **Export Report** | Markdown / notebook-ready analysis report |
| **Run recipe** | A wandas recipe result rendered in VS Code |

## Settings

| Key | Default | Description |
| --- | --- | --- |
| `audioWandasAnalyzer.pythonCommand` | `python3` | Python environment folder or executable used for the backend |
| `audioWandasAnalyzer.cacheMemoryMb` | `1024` | Maximum audio cache size used by the persistent Python waveform backend |
| `audioWandasAnalyzer.debugFilePath` | `media/debug` | Default path for **Audio Analyzer: Analyze Debug Path** |

## Troubleshooting

- **Python interpreter was not found:** select the venv that has `wandas` installed, or update `audioWandasAnalyzer.pythonCommand`.
- **Analysis failed:** open **Output: Audio Wandas Analyzer** and check the Python error. Confirm `wandas`, `numpy`, and `soundfile` are installed in the selected environment.
- **A file does not load:** confirm the extension is one of WAV, FLAC, OGG, AIFF, AIF, or SND. MP3 and M4A are not supported yet.
- **Large files feel slow:** zoomed waveform requests are fetched only for the visible range. For spectrogram-heavy work, try a smaller FFT size or hop length.

## Links

- VS Code Marketplace: [Audio Wandas Analyzer](https://marketplace.visualstudio.com/items?itemName=audio-wandas-analyzer.audio-wandas-analyzer)
- Repository: https://github.com/kasahart/audio-wandas-analyzer
- Backend library: [wandas](https://github.com/kasahart/wandas)
- Developer guide: [docs/developer-guide.md](https://github.com/kasahart/audio-wandas-analyzer/blob/main/docs/developer-guide.md)
- Issues and feature requests: [GitHub Issues](https://github.com/kasahart/audio-wandas-analyzer/issues)


### Static browser prototype (Wandas 0.8.1)

The desktop VS Code extension retains its native Python backend. The static build runs the same `AnalysisService`, Wandas DSP and Comparison Canvas UI in a Pyodide module Worker, using a bytes/source-id adapter instead of filesystem metadata. No analysis server is required and selected audio is never uploaded.

```bash
npm ci
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
npm run prepare:browser       # downloads SHA256-locked runtime assets + notices
npm run build:browser         # emits browser-dist/; all URLs are relative
AWA_VERIFY_BROWSER=1 npm run verify
npm run test:ui
python3 -m http.server 8080 --directory browser-dist  # local static preview
```

Open the preview over HTTP (not `file://`), select a short WAV, switch between waveform/STFT, move the cursor, drag a loop region, then use Export WAV. Playback is user initiated. Select multiple WAVs or append files to the existing comparison. Track removal releases its audio Blob and Python source; Cancel/clear terminates the shared Worker and releases every source. Existing offsets and mute choices survive additions. Shared controls provide display, cursor, offset, playback/stop, mute and mouse loop selection. Global loop times are mapped to each track duration and offset in both hosts; multiple Web exports download as one ZIP. Both hosts use the same source-based `_loop.wav` naming and collision suffixes. Invalid additions preserve existing tracks; a Worker crash clears all tracks and permits a fresh load. STFT detail is allocated lazily and released on detail cancellation, with an estimated allocation budget and bounded display arrays.

Prototype capabilities: RIFF WAV, 16 MiB input, 30 seconds, 1–2 channels, 1–96 kHz, at least 32 samples; actual WAV support depends on the pinned libsndfile build. STFT requires at least half a window and rejects settings exceeding the 512 MiB estimate (not a guaranteed browser heap ceiling). Up to eight sources may be retained, with 64 MiB aggregate input and 64 MiB decoded audio limits. Recomputable detail is bounded to 128 MiB and evicted without losing selected audio. Export plans are checked before allocation and limit aggregate WAV output to 32 MiB. These conservative estimates do not guarantee survival under browser memory pressure. Range export is uncalibrated PCM16. The hash lock, asset preparation and upstream notices follow [ASD Insight](https://github.com/kasahart/asd-insight/tree/main/runtime) and the Wandas 0.8.1 Pyodide harness. Worker initialization downloads are about 49 MiB; all assets are served from the static site itself. Internet is required only to prepare assets. Each Worker verifies pinned runtime hashes before loading Python.

Automatic spectrogram display samples roughly 720 analysis windows even for long desktop recordings. When their spacing exceeds the FFT window, a display-only adapter uses the same SciPy STFT and amplitude scaling as Wandas, then delegates spectral levels/calibration to Wandas; physical frame centers retain the actual spacing. This sparse display is not an inverse-STFT or Recipe result. Manual STFT settings still control their own allocation.

The Web adapter uses browser language with the shared English/Japanese dictionary. STFT/display settings and waveform/STFT mode survive reload through origin-local storage; source audio, paths, cursor and track offsets are not persisted. Corrupt or unavailable storage falls back safely. Markdown and Notebook export use the shared report generator; Web chooses a format and downloads UTF-8 content instead of opening a native save dialog. Browser notebooks reference numbered source-file aliases listed in the report: audio is not embedded, so place renamed copies beside the notebook.

This is a desktop VS Code + static Web prototype, not a vscode.dev extension. Browser Recipe execution, mosqito psychoacoustics, WDF/h5py, all-codec compatibility, directory scanning, Python selection and calibration configuration are unavailable; the static host reports unsupported commands. Native recipes and calibration remain available in VS Code. The static build uses relative URLs for a GitHub Pages project subpath; see the deployment workflow below.

`npm run test:browser` compares fixed 1-second and 2.5-second stereo WAVs through native filesystem, native bytes, and a real headless Chromium Pyodide Worker (including simultaneous multi-track waveform/STFT comparisons). The changing-tone fixture checks that a normalized cursor uses the full duration and selects the later 880 Hz segment. Actual UI export is decoded and compared sample-for-sample against the original selected range. Tests wait for completed detail/settings responses rather than a fixed delay, and assert audio elements exist and remain paused.

The browser audit verifies a real CSV Blob download and its UTF-8/channel/frequency contents, repainting all 16 channel canvases after removing/adding an eighth track, and concise expected-input rejection without a Python traceback. CSV values and desktop export behavior remain shared and unchanged. It also covers project-subpath URLs, waveform/STFT switching, FFT/hop changes, cursor and mouse region export, cancellation, repeated source switching and old Blob revocation, invalid/oversized/overlong inputs, runtime initialization failure and Worker crash recovery. The multi-track audit also checks exact offset-aware ZIP samples, repeated additions, eight-track limits, partial invalid batches, mute/offset persistence, manual playback/stop with Chromium audio muted, source removal, and crash recovery. Controlled host-bundle tests cover concurrent reanalysis ownership, unrelated failures, stale Worker callbacks/source requests, and dedicated static-host message subscriptions; the desktop VS Code window transport remains supported. A 390 px Chromium touch viewport checks file loading, cursor taps, STFT and clear. Touch-drag region selection is currently unavailable and the desktop-oriented axes can be cramped at this width. Physical mobile devices, Safari, long-session memory pressure, OS file/download pickers and audible playback are not validated.

Use `AWA_VERIFY_BROWSER=1 npm run verify` after runtime preparation to include the browser check in the canonical verifier. Standard verify remains network independent. `npm run verify:e2e` also checks a short stereo WAV in the actual VS Code Webview: STFT/cursor, loop export through the real Python backend and VS Code filesystem, and exact PCM16 sample equality. Only output-folder selection is injected to a temporary folder; the OS picker itself is not automated. The output is cleaned up and audio playback is not triggered.

### UI sharing with ASD Insight

Both apps need time/frequency coordinates, waveform envelopes, STFT colors/axes and cursor/region interactions. Analyzer already owns a multi-track Canvas runtime (track identity, offsets, lazy detail, calibrated levels, playback); Insight uses a React spectrogram component and a compact time-major Float32Array contract for its mono overview. Their shells and data conventions differ, so copying either complete screen would duplicate product behavior.

The smallest next shared boundary is a framework-neutral display contract (seconds/Hz, explicit frame centers and frequency axes, time-major arrays, quantity/reference/units, source/channel identities) plus pure coordinate/decimation/color/Canvas functions. React hooks and Analyzer host messages should wrap that core; file selection, playback lifecycle, persistence and native/Worker dispatch stay in host adapters. The shared pooling/palette kernel and types now live in [wandas-gui](https://github.com/kasahart/wandas-gui), with commit/hash-pinned source snapshots in both products. Compile checks the kernel, attribution and shared sync tool. Product screens and DSP remain in their existing repositories. Keep DSP and frame/time metadata in Wandas, and UI components in a separately owned UI module; adding React/DOM dependencies to Wandas is unnecessary. An internal shared module should be proven against both consumers before choosing a repository or public package.

GitHub Pages deployment uses `.github/workflows/pages.yml`: pull requests build and verify the static artifact; a successful main CI run triggers deployment of that exact commit. Only `browser-dist/` is uploaded, including hash-locked public runtime assets and notices. Deployment uses the `github-pages` environment and job-scoped `pages: write` / `id-token: write`; no extra secrets or audio data are published.
