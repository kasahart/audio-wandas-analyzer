# Audio Wandas Analyzer

**English** | [日本語](https://github.com/kasahart/audio-wandas-analyzer/blob/main/README.ja.md)

Turn VS Code into a focused audio inspection desk. Audio Wandas Analyzer lets you open audio files, compare takes on one timeline, zoom into waveform detail, inspect spectrograms and cursor-time spectra, and export the evidence you need without switching tools.

**[▶ Try it in your browser](https://kasahart.github.io/audio-wandas-analyzer/)** with no install (audio stays on your device), or install it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=audio-wandas-analyzer.audio-wandas-analyzer).

## Screenshot

![Audio Wandas Analyzer screenshot](https://raw.githubusercontent.com/kasahart/audio-wandas-analyzer/main/media/readme-audio-wandas-analyzer.png)

![Audio Wandas Analyzer spectrogram screenshot](https://raw.githubusercontent.com/kasahart/audio-wandas-analyzer/main/media/readme-audio-wandas-analyzer_stft.png)

## Browser or VS Code

| | Browser | VS Code |
| --- | --- | --- |
| Setup | None: open the page | Python 3.11+ |
| Files | Short files (limits under Browser Version) | Large and long files |
| Calibration | Not available | Available |
| Recipes | Bundled and your own `.recipe.json`; steps that need Python packages the browser lacks do not run | Anything your Python environment can run |

## Why Use It

Audio comparison often means bouncing between a DAW, a notebook, a file browser, and a plotting script. This extension keeps that loop inside VS Code:

- Line up multiple recordings and check timing differences at a glance
- See each track's waveform with its spectrogram right under it, on one time axis, beside its power spectrum
- Switch the cursor spectrum between the FFT and 1/1 or 1/3 octave bands
- Zoom into a range and fetch high-resolution waveform data only for what is visible
- Listen, mute, loop, and nudge tracks while you inspect them
- Export images, CSV spectrum data, loop audio, or a Markdown-friendly report for handoff
- Set a reference track to see the transfer function and coherence to the other tracks
- Calibrate channels to physical units (Pa, m/s², V) and read levels such as dB SPL
- Run bundled or your own analysis recipes for deeper analysis

Supported formats: **WAV / FLAC / OGG / OGA / Opus / MP3 / AIFF / AIF / AU / SND / CAF / W64 / RF64 / CSV** (a CSV's first column is time). Playback covers WAV, FLAC, OGG, OGA, Opus and MP3 only.

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
pip install "wandas[psychoacoustic,effects]>=0.10.0,<0.11.0" "numpy>=2.0.2" "scipy>=1.13" "soundfile>=0.12"
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

- **Compare:** view tracks on one shared timeline, each row showing its waveform over its spectrogram (drag the line between them to share the height)
- **Zoom:** use the toolbar `－ / ＋ / Reset` buttons, the `+ / − / 0` keys, or Ctrl + mouse wheel; `L` zooms to the loop region
- **Inspect:** click a waveform, spectrogram, or spectrum panel to move the cursor and update spectra
- **Loop:** drag on the waveform to create a loop region; clear it with a click
- **Listen:** use the per-track play and mute buttons, or `Space` to play or pause; `F` keeps the cursor in view during playback
- **Align:** nudge a track by 10 ms with `▲ / ▼`, Shift+drag it, or click the offset value to type it; double-click resets it
- **Reference:** set a track as the reference to see the transfer function and coherence to the others in the bottom panel
- **Calibrate:** use **Cal** on a track, or **Audio Analyzer: Configure Calibration**, to set a factor, unit and level reference per channel
- **Tune spectrograms:** open the gear popover to change FFT size, overlap, window function, dB range, and max frequency
- **Get help:** press `?` inside the panel to see keyboard shortcuts

## Exports And Recipes

The comparison toolbar includes export actions for everyday handoff work:

| Action | Output |
| --- | --- |
| **Export PNG** | Current visible tracks as an image |
| **Export CSV** | Spectrum data at the current cursor position |
| **WAV** | Audio from the selected loop region |
| **Report** | Markdown / notebook-ready analysis report |
| **Run recipe** | A recipe result rendered in VS Code |
| **Save as recipe** | The bottom panel's analysis as a `.recipe.json` |

A recipe (`*.recipe.json`) is a saved analysis workflow. **Run recipe** applies a bundled recipe or one of your own to the checked tracks; when a recipe takes several inputs, you confirm which track goes where before it runs.

**Workflow → Save as recipe** saves the bottom panel's analysis with the current settings, computed over whole files: the spectrum or octave bands of every channel, or, while a reference is set, the transfer function from it to the other channels. Track offsets and the loop range are not saved, so the inputs should be synchronized. Run the file again any time with **Run recipe**.

## Settings

| Key | Default | Description |
| --- | --- | --- |
| `audioWandasAnalyzer.pythonCommand` | `python3` | Python environment folder or executable used for the backend |
| `audioWandasAnalyzer.cacheMemoryMb` | `1024` | Maximum memory (MB) used to cache loaded audio |

## Troubleshooting

- **Python interpreter was not found:** select the virtual environment where you installed the Quick Start packages, or update `audioWandasAnalyzer.pythonCommand`.
- **Analysis failed:** open **Output: Audio Wandas Analyzer** and check the Python error. Confirm the Quick Start packages are installed in the selected environment.
- **A file does not load:** confirm the extension is one of WAV, FLAC, OGG, OGA, Opus, MP3, AIFF, AIF, AU, SND, CAF, W64, RF64, or CSV. M4A is not supported.
- **Large files feel slow:** zoomed waveform requests are fetched only for the visible range. For spectrogram-heavy work, try a smaller FFT size or a lower overlap.

## Browser Version

[Open the browser version](https://kasahart.github.io/audio-wandas-analyzer/) to compare short audio or CSV files without installing VS Code or Python. Audio is analyzed on your device and is not uploaded.

Select one or more files, then use the waveform, spectrogram, cursor, playback, mute, offset and loop controls. You can add or remove tracks during a comparison. Export images, CSV spectra, selected audio ranges, or Markdown / Notebook reports; exporting multiple audio ranges downloads a ZIP file. Bundled recipes are available, including psychoacoustic ones (loudness, roughness), and **Workflow → Run recipe → From file…** runs a `.recipe.json` from your computer. The result names the file behind each recipe input.

<!-- browser-limits:start (generated by scripts/check-single-sources.mjs --write) -->
| Limit | Browser version |
| --- | --- |
| Formats | WAV, FLAC, OGG, OGA, Opus, MP3, AIFF, AU, SND, CAF, W64, RF64, CSV |
| Per file | Up to 16 MiB and 30 seconds; mono or stereo |
| Sample rate | 1–96 kHz |
| Comparison | Up to 8 tracks and 64 MiB of input files in total |
| WAV export | Uncalibrated PCM16 audio; up to 32 MiB in total |
<!-- browser-limits:end -->

The left panel lists your files as in the VS Code extension: **Open File**, **Open Folder** or dropping files or folders onto the page adds them to the list, and checked files become tracks. Calibration settings are available in the VS Code extension only. Use a desktop browser for the full set of mouse controls; dragging to select a loop is not supported on touch screens.

Display and spectrogram settings are remembered between visits. Audio files, cursor position and track offsets are not saved; select your files again after reloading. **Clear** in the left panel empties the list and removes all loaded audio. Exported notebooks refer to the audio file names listed in the report, so place copies of your audio beside the notebook using those names.

## Links

- VS Code Marketplace: [Audio Wandas Analyzer](https://marketplace.visualstudio.com/items?itemName=audio-wandas-analyzer.audio-wandas-analyzer)
- Repository: https://github.com/kasahart/audio-wandas-analyzer
- Issues and feature requests: [GitHub Issues](https://github.com/kasahart/audio-wandas-analyzer/issues)
