# Audio Wandas Analyzer

**English** | [日本語](https://github.com/kasahart/audio-wandas-analyzer/blob/main/README.ja.md)

A VS Code extension to open audio files and compare them side-by-side via waveform, spectrogram, and power spectrum views. Heavy DSP runs in a Python child process powered by the [wandas](https://github.com/kasahart/wandas) library; the UI is implemented as a VS Code Webview.

## Features

- **Multi-track comparison** — open multiple audio files at once and compare them via waveform / spectrogram / power spectrum
- **Waveform view** — high-resolution re-decimation on zoom, with amplitude axis (±1.0 FS) and time axis always visible
- **Spectrogram view** — frequency axis (Hz / kHz) with a dB colorbar overlay. STFT parameters (FFT size, hop length, window function) and display range (dB min/max, max frequency) are configurable from an in-panel settings popover
- **Cursor-time power spectrum** — overlay across all tracks at the cursor position, plus a per-track spectrum strip next to each row
- **Playback / loop** — play each track individually, mute it, or constrain playback to a loop region
- **Track offsets** — shift each track along the time axis to align them
- **Directory picker UI** — open a folder to see a tree of supported audio files; check the boxes to add tracks (uncheck to remove)
- **Explorer integration** — right-click audio files / folders or drag-and-drop them onto the sidebar to start analysis

Supported formats: **WAV / FLAC / OGG / AIFF / AIF / SND**

## Requirements

This extension calls a Python backend that depends on `wandas`. You need to set up Python before using it.

### 1. Install Python 3.11+

```bash
python3 --version   # 3.11 or newer recommended
```

### 2. Install wandas

A virtual environment is recommended:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install wandas numpy soundfile
```

### 3. Point VS Code at your Python interpreter

In VS Code settings, set `audioWandasAnalyzer.pythonCommand` to the Python in the venv you just created. Example: `/path/to/your/.venv/bin/python`.

Or, from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run **Audio Analyzer: Select Python Environment** to pick it via a GUI.

## Usage

### Opening files

| Method | How |
|--------|-----|
| Command Palette | **Audio Analyzer: Analyze File or Folder** |
| Context menu | Right-click an audio file / folder in the Explorer → **Analyze with Audio Analyzer** |
| Sidebar | Open the **Audio Analyzer** view in the Activity Bar → click *Select files / folder to analyze* |
| Drag-and-drop | Drop audio files or folders onto the *Drop audio files or folders here* row in the sidebar |

### Opening a folder

A tree of the supported audio files appears. All entries start unchecked; checking a file adds a track instantly, unchecking removes it.

### Controls

- **Zoom**: the `+ / -` buttons in the toolbar, or scroll over the waveform
- **Move cursor**: click on the waveform or spectrogram
- **Loop region**: drag to select / click to clear
- **Track offset**: `▲ / ▼` buttons on the track header for ±0.01 s steps; double-click the value to reset
- **Playback**: `▶` to start, `■` to stop
- **Mute**: `M` button (excludes the track from the cursor spectrum overlay too)
- **Spectrogram settings**: gear icon in the toolbar opens a popover for FFT size, hop length, window function, and display range

### View modes

Each track's toolbar lets you flip between **Waveform** and **Spectrogram**.

## Settings

| Key | Default | Description |
|-----|---------|-------------|
| `audioWandasAnalyzer.pythonCommand` | `python3` | Python executable path used to launch the analysis backend |
| `audioWandasAnalyzer.defaultPeakCount` | `5` | Number of dominant frequency peaks shown per channel (1–20) |
| `audioWandasAnalyzer.debugFilePath` | `media/debug` | Default path opened by **Audio Analyzer: Analyze Debug Path**. Relative paths resolve against the workspace root |

## Troubleshooting

- **"Python interpreter was not found"** — set `audioWandasAnalyzer.pythonCommand` to the absolute path of the Python that has `wandas` installed.
- **"analyze failed" errors** — open the **Output** panel and select the **Audio Wandas Analyzer** channel to see the Python stack trace. Confirm `wandas`, `numpy`, and `soundfile` are installed.
- **File won't load** — only WAV / FLAC / OGG / AIFF are supported. MP3 / M4A are not.
- **Slow on large files** — the waveform requests a high-resolution slice only for the visible zoom range, so subsequent zooming is fast. Smaller FFT sizes also speed up spectrogram updates.

## Source & License

- Repository: https://github.com/kasahart/audio-wandas-analyzer
- Backend: [wandas](https://github.com/kasahart/wandas)
- For setup & architecture details, see [`AGENTS.md`](https://github.com/kasahart/audio-wandas-analyzer/blob/main/AGENTS.md).
- Bug reports / feature requests: [GitHub Issues](https://github.com/kasahart/audio-wandas-analyzer/issues).
