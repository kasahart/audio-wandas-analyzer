# Changelog

User-visible changes per release. Pull requests add a line under **Unreleased**; the release PR turns it into the version heading (the tag `vX.Y.Z` must match `package.json`).

## Unreleased

- Uncalibrated CSV tracks are labelled in raw input units instead of full scale: the level axis reads "Amplitude, uncalibrated [dB re 1 input unit]", the calibration badge reads RAW, the calibration picker offers "Raw input units (dB re 1 input unit)", and the summary picture's hint, the entry overview's colour scale and a time signal's axis follow suit; audio files keep FS / dBFS (#544).
- VS Code: when no Python interpreter is found, the warning offers "Try Browser Version", which opens the browser version so you can try the analyzer without Python (#546).
- Compare opened from the tracks with no role at all starts with the first two recordings as base and compare 1 (compare 1 alone when rows are grouped, the group median being the base); the legend's chips change them (#540).
- Recipes: a psychoacoustic Recipe (`roughness`, `roughness-heatmap`, and `loudness` on a file of a few samples) run on a file too short for it — for roughness, shorter than its 200 ms window (9600 samples at 48 kHz) — now says the settings don't fit this file, like the other Recipes, instead of "This request could not be processed." (#525).
- CSV tracks no longer show the CLIP badge: their values are physical (Pa, m/s², V…) with no full scale, so the report's Raw Peak and Clipped columns read "—" for them instead of "Yes"/"No" (#524).
- Compare legend: each recording's chip names its role ("Base ▾", "Compare 1 ▾"), or offers "Role ▾" outlined when it has none (#538).
- Web: the empty view offers "Try with samples": three short synthetic recordings (a hum, with a whine, with clicks) load on a click, to try the app without audio at hand (#536).
- Help: a "? Help" button in the footer opens it in every view; it starts with the app's flow in three lines. The Web version's Python boot card no longer covers the empty view's prompt (#533).
- Analysis chain: entry table for up to 100,000 recordings, a dataset table with distributions, a step bar that builds a wandas Recipe, and per-folder sessions (#410, #414, #415).
- Compare view: roles per recording, the tracks' selection carried in as the region, recordings drawn as they are computed, cross-correlation (#452–#456, #468, #472).
- Track lanes: waveform over spectrogram on one time axis, linked amplitude/colour/frequency scales, only lanes near the view drawn and fetched (#427, #442, #444).
- Cursor spectrum snaps to the nearest STFT frame; spectrogram cells centred on their windows (#436, #438).
- Cursor spectrum: tones show at their own frequency and level at every FFT length (it was averaged onto 192 even points, which read an 80 Hz tone at 94 Hz and up to 11 dB low); FFT lengths up to 2048 are drawn bin for bin, longer ones as up to 1025 log-spaced points holding each span's peak; the hover readout reads the loudest bin within a pixel of the pointer, and arrow keys still step one bin at a time; the CSV export writes every FFT bin (n_fft/2+1 rows at fs/n_fft spacing) and names any spectrum it had to leave out.
- Trackpad sideways swipe pans the timeline (#471).
- File table beside the tracks: the selected row's name stays readable (its tools show under the mouse, like other rows); the value column shows only when the table is maximized (#505).
- Track lanes fetch the waveform detail two screens either side of the view, so a pan no longer flashes the coarse overview, and a zoom out keeps the detail already fetched until the new one lands (#502).
- Entry table: the slot chips under the table are gone (roles show on the rows and the compare legend); the base group is chosen from a Base select beside Group (#504).
- Compare view: opens the first time on the input, the recordings as they are; after that on the step shown last, from the table or the tracks. On a waveform, a base group draws each of its recordings' waveforms under the compared one, with no level difference against the group's median, which is on no line (#518, #520).
- Step bar: shows the Recipe's steps only; the app's fixed "1/3 oct (table values)" chip after the chain is gone. The table's 1/3-octave values are listed under … with what the app computes outside the Recipe; for 1/3-octave bands on the compare view, add noct_spectrum from ＋. A base group too large to analyse unasked no longer stands in with the table's whole-file band levels: it has no line until Analyse is pressed (#523).
- Recipe results: a near-constant line (a flat transfer function, its phase) keeps a minimum y span (6 dB on dB axes, a full turn for phase, and only enough to hide floating-point rounding on other linear axes) instead of stretching rounding noise to full height; coherence is drawn on a fixed 0–1 axis.
- Folder: rows checked in the entry table show as tracks again on Windows and in folders opened through a link; the backend names each file as the extension asked for it, not as it resolves.
- Compare view: showing Δ no longer leaves the overlaid plot stretched from its old height, so hovered lines are no longer drawn twice (#503).
- Plots resized by the layout (the compare view's step bar expanded, the entry table's overview strip moved under it in a narrow window) are drawn again at their new size; ui-smoke fails any canvas left stretched (#552).
- Python backend answers requests for different recordings concurrently and reads audio straight into float32 (#462, #464).
- Updated to wandas 0.12.0 (#409, #446, #468).
- Python starts only when a command, view or panel needs it; Select Python Environment can create a `.venv` and install the packages, detects PEP 668 interpreters and uses the Python extension's interpreter; Restricted Mode is supported with the user-level interpreter.
- Every analysis request can be cancelled and times out; Python's errors go to the "Audio Wandas Analyzer" output channel.
- A spectrogram or cursor spectrum that fails says why in its lane and is retried after a pause instead of on every frame; files larger than the cache are no longer re-read on every zoom; non-ASCII paths work on Windows code pages.
- Keyboard: one help (`?`) for every view; Compare toggles its base with `B` (was `0`); entry-table track marks are ☐/☑ (`T` toggles the focused row); canvases and resize edges are focusable and keyboard-resizable.
- Entry table keeps file names' ends in view with the full path as a tooltip; disabled controls say why; PNG/CSV export shows progress; settings popovers use plain labels; light-theme contrast and High Contrast Light role colours fixed; the transfer-function reference is called 参照 in Japanese.
- The webview may read, scan and export only files its panel lists; large folders are listed with a cap, skip symlinked folders and can be cancelled.
- The VSIX no longer ships scripts, tests, agent files or the debug WAV (about 10 MB → 4 MB).
- Requires VS Code 1.122 or later; only the latest VS Code release is supported.
- Tooling: CI runs verify on Linux, Windows and macOS; releases publish only after every CI job passes; pinned CI Python packages; Dependabot; type-aware ESLint and pyright in verify; wall-clock budgets only with `AWA_PERF=1`.

## 0.0.14

- Marketplace icon shrunk below the upload limit (#405).

## 0.0.13

- Save the bottom-panel analysis as a wandas Recipe (#396).
- Recipe replay checked on other inputs, per-command validation (#399).
- README points to the browser version; Marketplace tags listed (#401).
