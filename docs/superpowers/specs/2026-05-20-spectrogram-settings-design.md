# Spectrogram Settings UI — Design

Status: Draft (2026-05-20)
Branch / worktree: `worktree-spectrogram-settings`

## 1. Background

Today the spectrogram shown in `ComparisonPanel` is computed by `python-backend/analyzer.py` with STFT parameters auto-derived from the sample count:

- `window_size` is chosen by `_pick_window_size()` (power-of-two heuristic).
- `hop_size` is sized so the time-bin count fits `SPECTROGRAM_TIME_BIN_LIMIT`.
- The window function is whatever `wandas.Signal.stft` defaults to.

The user has no way to override these, nor to tweak the dB color range or the maximum frequency drawn. The dominant frequency / formant work the user does needs explicit control over these knobs.

## 2. Goal

Add a settings UI inside the spectrogram view of `ComparisonPanel` that lets the user override:

1. **STFT parameters** — `n_fft` (window size), `hop_size`, `window` function.
2. **Display parameters** — `dbMin`, `dbMax`, `maxFrequencyHz`.

Settings apply to **the whole panel** (all tracks / all channels). STFT changes require a re-analysis round-trip to the Python backend; display changes are applied client-side only.

Settings are persisted per workspace via `context.workspaceState`.

Out of scope:
- Per-track or per-channel overrides.
- Live auto-apply (changes apply on an explicit "Apply" press for STFT params; display params apply on change).
- Exposing settings via `settings.json` (workspaceState only).

## 3. UX

### 3.1 Entry point

A new gear-icon button is added to the Webview toolbar, visible only while the content type is `spectrogram`. Clicking toggles a popover anchored under the button. Clicking outside / pressing Esc closes it.

### 3.2 Popover layout

```
┌─ Spectrogram settings ────────────────┐
│ [x] Auto (use computed defaults)      │
│                                       │
│ STFT                                  │
│   n_fft       [ 1024 ▾ ]   64..16384  │
│   hop_size    [  256   ]              │
│   window      [ hann  ▾ ]             │
│   (changes require Apply)             │
│                                       │
│ Display                                │
│   dB min      [ -80 ]                 │
│   dB max      [   0 ]                 │
│   max freq Hz [ 22050 ]               │
│                                       │
│           [ Reset ]  [ Apply ]        │
└───────────────────────────────────────┘
```

- `n_fft` is a select of powers of two from 64 to 16384.
- `hop_size` is a free numeric input, validated `1 <= hop_size <= n_fft`.
- `window` is a select: `hann`, `hamming`, `blackman`, `boxcar`.
- When **Auto** is checked, STFT inputs are disabled and the backend falls back to the existing auto logic.
- `dB min/max` and `max freq` accept floats; invalid values revert on blur.
- **Apply** is only enabled when STFT params or Auto flag have a pending change. Display params apply immediately on commit (input blur / change).

## 4. Data flow

```
Webview popover
   │  (display change → immediate re-render)
   │  (STFT change + Apply → postMessage)
   ▼
ComparisonPanel.onDidReceiveMessage("request-reanalyze", { stftOptions })
   │
   ▼
extension/index.ts  → spawns analyze_audio with extra args
   │
   ▼
python-backend/analyzer.py::analyze_audio(stft_options=…)
   │  bypasses _pick_window_size / hop calc when provided
   ▼
AnalysisResult (same shape) → postMessage("analysis-update")
   │
   ▼
Webview replaces channels[].spectrogram, re-renders
```

Display params never leave the Webview. They mutate a local `displaySettings` object consumed by `paintSpectrogram`.

## 5. Components and changes

### 5.1 Shared types — `src/shared/analysis/analysisTypes.ts`

Add:

```ts
export type StftWindow = 'hann' | 'hamming' | 'blackman' | 'boxcar';

export interface StftOptions {
    nFft: number;
    hopSize: number;
    window: StftWindow;
}

export interface SpectrogramDisplaySettings {
    dbMin: number | null;   // null = auto from data
    dbMax: number | null;
    maxFrequencyHz: number | null;
}

export interface SpectrogramSettings {
    auto: boolean;            // true → ignore stft and use backend defaults
    stft: StftOptions;
    display: SpectrogramDisplaySettings;
}
```

`SpectrogramData` is unchanged — `windowSize` / `hopSize` already round-trip the actual values used by the backend, which is exactly what we need to verify in tests.

### 5.2 Python backend — `python-backend/analyzer.py`

Modify `analyze_audio` to accept an optional `stft_options: dict | None`:

```python
def analyze_audio(path: str, *, stft_options: dict | None = None) -> dict:
    ...
    if stft_options is None:
        window_size = max(64, _pick_window_size(sample_count))
        hop_size = ...  # current logic
        window_name = None
    else:
        window_size = int(stft_options["n_fft"])
        hop_size    = int(stft_options["hop_size"])
        window_name = stft_options.get("window") or "hann"
    stft = signal.stft(n_fft=window_size, hop_length=hop_size, window=window_name)
    ...
```

`waveform_server.py` is untouched (it serves waveform ranges, not spectrograms).

Validation: clamp `window_size` to `[64, 16384]`, `hop_size` to `[1, window_size]`. Raise a clear error on bad input — `extension/index.ts` surfaces it as an error analysis result.

### 5.3 Extension host — `src/extension/index.ts`

- Add a CLI flag or env-var path so `analyze_audio` is called with `stft_options`. The current invocation is via `runAnalyzer()`; extend it to forward the JSON.
- Add message handler in `ComparisonPanel` for `request-reanalyze`:
    - reads `stftOptions` from the message,
    - re-invokes the Python analyzer for the panel's files,
    - posts `analysis-update` with the new results.

### 5.4 ComparisonPanel webview — `src/webview/panels/ComparisonPanel.ts`

`renderScript()` additions:

1. New `spectrogramSettings` state object, hydrated from the `initialSettings` injected by the panel constructor (read from `workspaceState`).
2. New toolbar button `data-action="spectrogram-settings"`, hidden unless `contentType === 'spectrogram'`.
3. Popover DOM + open/close logic (anchored to button, dismiss on outside click / Esc).
4. Form bindings:
   - STFT inputs mutate a pending draft; "Apply" copies draft → state and posts `request-reanalyze`.
   - Display inputs commit on change; trigger `scheduleRender()`.
5. `paintSpectrogram` extended to honor `dbMin`, `dbMax`, `maxFrequencyHz`:
   - clamp displayed dB to `[dbMin ?? data.minDb, dbMax ?? data.maxDb]` before colormap lookup,
   - clip frequency axis to `min(maxFrequencyHz, data.maxFrequencyHz)`.

Panel side (TS, outside renderScript):

- On creation, load `spectrogramSettings` from `workspaceState.get("spectrogramSettings")`; pass into the rendered script as a JSON literal.
- On `update-settings` message from Webview, persist via `workspaceState.update`.
- On `request-reanalyze`, run the backend with the requested STFT options.

### 5.5 Files mirrored

`media/comparisonWaveform.js` does not currently render the spectrogram — that lives inside `renderScript()`. No mirror update needed unless a mirror is added in this task. (Confirm by grep; if mirrored, update both.)

## 6. Testing

### 6.1 Python unit — `python-backend/tests/test_analyzer.py`

- `analyze_audio(path)` — baseline auto behavior unchanged.
- `analyze_audio(path, stft_options={n_fft: 512, hop_size: 128, window: "hamming"})` — `result.channels[0].spectrogram.windowSize == 512` and `hopSize == 128`.
- Invalid options (`n_fft=0`, `hop_size > n_fft`) raise.

### 6.2 TS unit — `src/test`

- Settings round-trip through workspaceState (mock the memento).
- `request-reanalyze` message handler forwards `stftOptions` to the analyzer invocation (use existing analyzer mock pattern in `renderScript.integration.test.ts`).
- `paintSpectrogram` honors `dbMin/dbMax` (color sampled at clipped value) and `maxFrequencyHz` (rows above cutoff are not drawn).

### 6.3 E2E — `src/e2e/suite`

New file `src/e2e/suite/spectrogramSettings.test.ts`:

1. Open the extension command that launches `ComparisonPanel` against the existing test fixture WAV.
2. Wait for analysis-complete; switch content to spectrogram via toolbar.
3. Click the settings gear → assert the popover is visible.
4. Change `n_fft` to a non-default value (e.g. 512), keep Auto off, press Apply.
5. Wait for `analysis-update`; assert the latest `channels[0].spectrogram.windowSize === 512`.
6. Change `dbMin` to a tight range; assert no re-analysis was triggered (no extra Python spawn) and the rendered canvas changed (basic pixel sample check via `getImageData`).
7. Reload panel → settings persist (workspaceState).

E2E uses the same harness as existing `src/e2e/suite/index.ts`.

## 7. Risks and follow-ups

- STFT re-analysis is heavy; long files will block the UI. The "Apply" button design avoids accidental re-runs. A spinner / disabled state during re-analysis is included.
- `wandas.Signal.stft` accepts a string window argument — verify the supported names match our select options before wiring up. If `boxcar` is unsupported, drop it.
- Persisted settings could become invalid for a different file (e.g. `n_fft` larger than the file). Validation on apply guards against this; show an error toast on backend failure.

## 8. Verification bar

Done when:
- `npm run verify` passes.
- `npm run verify:e2e` passes including the new spectrogram-settings E2E.
- Manual smoke: open a WAV, switch to spectrogram, change n_fft/hop/window, Apply, see new `windowSize` in tooltip / inspector; change dB range, see immediate color shift.
