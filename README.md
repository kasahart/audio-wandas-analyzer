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

Open the preview over HTTP (not `file://`), select a short WAV, switch between waveform/STFT, move the cursor, drag a loop region, then use Export WAV. Playback is user initiated. Cancel/clear terminates the Worker and releases the source Blob; choosing another file replaces the active source. Only one selected file is decoded at a time. STFT detail is allocated lazily and released on detail cancellation, with an estimated allocation budget and bounded display arrays.

Prototype capabilities: RIFF WAV, 16 MiB input, 30 seconds, 1–2 channels, 1–96 kHz, at least 32 samples; actual WAV support depends on the pinned libsndfile build. STFT requires at least half a window and rejects settings exceeding the 384 MiB estimate (not a guaranteed browser heap ceiling). Range export is uncalibrated PCM16. The hash lock, asset preparation and upstream notices follow [ASD Insight](https://github.com/kasahart/asd-insight/tree/main/runtime) and the Wandas 0.8.1 Pyodide harness. Worker initialization downloads are about 49 MiB; all assets are served from the static site itself. Internet is required only to prepare assets. Each Worker verifies pinned runtime hashes before loading Python.

This is a desktop VS Code + static Web prototype, not a vscode.dev extension. Browser Recipe execution, mosqito psychoacoustics, WDF/h5py, all-codec compatibility, directory scanning, Python selection and calibration configuration are unavailable; the static host reports unsupported commands. Native recipes and calibration remain available in VS Code. No Pages deployment settings or publish workflow are changed. `browser-dist/` can be served under a GitHub Pages project subpath after separate publication approval.

`npm run test:browser` compares a fixed 1-second stereo WAV through native filesystem, native bytes, and a real headless Chromium Pyodide Worker: waveform/STFT/cursor/range numeric arrays and PCM16 WAV bytes. The browser check also covers UI load, STFT switching, region download, cancellation, and no autoplay. Use `AWA_VERIFY_BROWSER=1 npm run verify` after runtime preparation to include this check in the canonical verifier. Standard verify remains network independent. `npm run verify:e2e` also checks a short stereo WAV in the actual VS Code Webview: STFT/cursor, loop export through the real Python backend and VS Code filesystem, and exact PCM16 sample equality. Only output-folder selection is injected to a temporary folder; the OS picker itself is not automated. The output is cleaned up and audio playback is not triggered.

### UI sharing with ASD Insight

Both apps need time/frequency coordinates, waveform envelopes, STFT colors/axes and cursor/region interactions. Analyzer already owns a multi-track Canvas runtime (track identity, offsets, lazy detail, calibrated levels, playback); Insight uses a React spectrogram component and a compact time-major Float32Array contract for its mono overview. Their shells and data conventions differ, so copying either complete screen would duplicate product behavior.

The smallest next shared boundary is a framework-neutral display contract (seconds/Hz, explicit frame centers and frequency axes, time-major arrays, quantity/reference/units, source/channel identities) plus pure coordinate/decimation/color/Canvas functions. React hooks and Analyzer host messages should wrap that core; file selection, playback lifecycle, persistence and native/Worker dispatch stay in host adapters. This prototype first extracts the host-neutral Comparison document and reuses the existing Analyzer UI without a second implementation. It does not migrate Insight or publish a new shared package. Keep DSP and frame/time metadata in Wandas, and UI components in a separately owned UI module; adding React/DOM dependencies to Wandas is unnecessary. An internal shared module should be proven against both consumers before choosing a repository or public package.
