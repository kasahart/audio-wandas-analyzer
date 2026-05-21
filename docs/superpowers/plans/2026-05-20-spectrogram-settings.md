# Spectrogram Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings popover to the spectrogram view that lets the user override STFT parameters (`n_fft`, `hop_size`, `window`) and display parameters (`dbMin`, `dbMax`, `maxFrequencyHz`), persisted via `workspaceState`.

**Architecture:** STFT changes flow Webview → `ComparisonPanel` → `runAnalysis` → `python-backend/main.py` → `analyze_audio(stft_options=…)`. Display params live entirely in the Webview and only mutate the render pipeline. Settings are loaded from `context.workspaceState` and injected into the rendered script.

**Tech Stack:** TypeScript (Node 22, VS Code extension API), Python 3.11 (wandas, numpy), node:test, pytest, ruff, Mocha VS Code E2E.

**Spec:** `docs/superpowers/specs/2026-05-20-spectrogram-settings-design.md`

---

## File Map

**Modify:**
- `src/shared/analysis/analysisTypes.ts` — add `StftOptions`, `SpectrogramDisplaySettings`, `SpectrogramSettings`, message types.
- `python-backend/analyzer.py` — `analyze_audio` accepts `stft_options`.
- `python-backend/main.py` — CLI args for `--stft-n-fft`, `--stft-hop`, `--stft-window`.
- `src/extension/index.ts` — `runAnalysis` forwards STFT options; new `request-reanalyze` handler; load/save `spectrogramSettings` from `workspaceState`.
- `src/webview/panels/ComparisonPanel.ts` — inject initial settings; toolbar gear button; popover UI in `renderScript()`; extend `paintSpectrogram` for dB/maxFreq.

**Create:**
- `python-backend/test_analyzer.py` — pytest covering `analyze_audio(stft_options=…)`.
- `src/test/spectrogramSettings.test.ts` — node:test for message types + paintSpectrogram clamping helpers.
- `src/e2e/suite/spectrogramSettings.test.ts` — VS Code E2E.

---

## Task 1: Shared types

**Files:**
- Modify: `src/shared/analysis/analysisTypes.ts`

- [ ] **Step 1: Add the new types**

Append to `src/shared/analysis/analysisTypes.ts`:

```ts
export type StftWindow = 'hann' | 'hamming' | 'blackman' | 'boxcar';

export interface StftOptions {
    nFft: number;
    hopSize: number;
    window: StftWindow;
}

export interface SpectrogramDisplaySettings {
    dbMin: number | null;
    dbMax: number | null;
    maxFrequencyHz: number | null;
}

export interface SpectrogramSettings {
    auto: boolean;
    stft: StftOptions;
    display: SpectrogramDisplaySettings;
}

export const DEFAULT_SPECTROGRAM_SETTINGS: SpectrogramSettings = {
    auto: true,
    stft: { nFft: 1024, hopSize: 256, window: 'hann' },
    display: { dbMin: null, dbMax: null, maxFrequencyHz: null },
};

export interface RequestReanalyzeMessage {
    type: 'request-reanalyze';
    settings: SpectrogramSettings;
}

export interface UpdateSpectrogramSettingsMessage {
    type: 'update-spectrogram-settings';
    settings: SpectrogramSettings;
}

export interface AnalysisUpdateMessage {
    type: 'analysis-update';
    results: AnalysisResultWithError[];
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/analysis/analysisTypes.ts
git commit -m "feat(types): add spectrogram settings + reanalyze message types"
```

---

## Task 2: Python — `analyze_audio` accepts `stft_options`

**Files:**
- Modify: `python-backend/analyzer.py`
- Create: `python-backend/test_analyzer.py`

- [ ] **Step 1: Write the failing test**

Create `python-backend/test_analyzer.py`:

```python
from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np
import pytest

from analyzer import analyze_audio


def _write_sine_wav(path: Path, freq_hz: float = 440.0, seconds: float = 1.0, sr: int = 16000) -> None:
    t = np.linspace(0, seconds, int(seconds * sr), endpoint=False)
    samples = (0.5 * np.sin(2 * math.pi * freq_hz * t) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())


def test_analyze_audio_defaults(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    result = analyze_audio(wav)
    spec = result["channels"][0]["spectrogram"]
    assert spec["windowSize"] > 0
    assert spec["hopSize"] > 0


def test_analyze_audio_with_stft_options(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    result = analyze_audio(
        wav,
        stft_options={"n_fft": 512, "hop_size": 128, "window": "hamming"},
    )
    spec = result["channels"][0]["spectrogram"]
    assert spec["windowSize"] == 512
    assert spec["hopSize"] == 128


def test_analyze_audio_rejects_bad_options(tmp_path: Path) -> None:
    wav = tmp_path / "tone.wav"
    _write_sine_wav(wav)
    with pytest.raises(ValueError):
        analyze_audio(wav, stft_options={"n_fft": 0, "hop_size": 1, "window": "hann"})
    with pytest.raises(ValueError):
        analyze_audio(wav, stft_options={"n_fft": 256, "hop_size": 512, "window": "hann"})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest python-backend/test_analyzer.py -v`
Expected: FAIL — `analyze_audio` does not accept `stft_options`.

- [ ] **Step 3: Modify `analyze_audio` signature and STFT block**

In `python-backend/analyzer.py`, change the function signature at line 176 and the STFT block at lines 193-196:

```python
def analyze_audio(
    file_path: str | Path,
    peak_count: int = 5,
    *,
    stft_options: dict | None = None,
) -> dict[str, object]:
    target = Path(file_path).expanduser().resolve()
    if not target.exists():
        raise FileNotFoundError(f"Audio file not found: {target}")

    signal = wd.read_wav(str(target))
    channel_count = int(signal.n_channels)
    sample_count = int(signal.n_samples)
    sample_rate_hz = int(signal.sampling_rate)
    labels = list(signal.labels)
    data = _channels_first(np.asarray(signal.data), channel_count, sample_count)
    rms_values = np.asarray(signal.rms, dtype=np.float64)

    fft = signal.fft()
    fft_freqs = np.asarray(fft.freqs, dtype=np.float64)
    fft_magnitudes = _channels_first(np.asarray(fft.magnitude), channel_count, fft_freqs.size)

    window_size, hop_size, window_name = _resolve_stft_params(sample_count, stft_options)
    stft = signal.stft(n_fft=window_size, hop_length=hop_size, window=window_name)
    stft_db = np.asarray(stft.dB, dtype=np.float64)
```

Add the helper above `analyze_audio`:

```python
_ALLOWED_WINDOWS = {"hann", "hamming", "blackman", "boxcar"}


def _resolve_stft_params(
    sample_count: int,
    stft_options: dict | None,
) -> tuple[int, int, str]:
    if stft_options is None:
        window_size = max(64, _pick_window_size(sample_count))
        hop_size = max(
            1,
            int(np.ceil(max(1, sample_count - window_size) / max(1, SPECTROGRAM_TIME_BIN_LIMIT - 1))),
        )
        return window_size, hop_size, "hann"

    n_fft = int(stft_options.get("n_fft", 0))
    hop = int(stft_options.get("hop_size", 0))
    window = str(stft_options.get("window", "hann"))
    if n_fft < 64 or n_fft > 16384:
        raise ValueError(f"n_fft must be in [64, 16384], got {n_fft}")
    if hop < 1 or hop > n_fft:
        raise ValueError(f"hop_size must be in [1, n_fft], got {hop}")
    if window not in _ALLOWED_WINDOWS:
        raise ValueError(f"window must be one of {sorted(_ALLOWED_WINDOWS)}, got {window!r}")
    return n_fft, hop, window
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest python-backend/test_analyzer.py -v`
Expected: 3 passing.

- [ ] **Step 5: Run ruff**

Run: `ruff check python-backend && ruff format --check python-backend`
Expected: no issues.

- [ ] **Step 6: Commit**

```bash
git add python-backend/analyzer.py python-backend/test_analyzer.py
git commit -m "feat(analyzer): accept stft_options in analyze_audio"
```

---

## Task 3: Python — main.py CLI flags

**Files:**
- Modify: `python-backend/main.py`

- [ ] **Step 1: Add CLI arguments**

Replace `parse_args()` and the analyze branch in `main()`:

```python
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze an audio file with wandas")
    parser.add_argument("--file", required=True, help="Path to the audio file")
    parser.add_argument("--peaks", type=int, default=5, help="Number of dominant frequency peaks to return")
    parser.add_argument("--range-start", type=float, default=None, dest="range_start")
    parser.add_argument("--range-end", type=float, default=None, dest="range_end")
    parser.add_argument("--range-points", type=int, default=2000, dest="range_points")
    parser.add_argument("--stft-n-fft", type=int, default=None, dest="stft_n_fft")
    parser.add_argument("--stft-hop", type=int, default=None, dest="stft_hop")
    parser.add_argument("--stft-window", type=str, default=None, dest="stft_window")
    return parser.parse_args()
```

And inside `main()`, replace the `analyze_audio(...)` call:

```python
            from analyzer import analyze_audio  # noqa: PLC0415

            stft_options = None
            if args.stft_n_fft is not None and args.stft_hop is not None:
                stft_options = {
                    "n_fft": args.stft_n_fft,
                    "hop_size": args.stft_hop,
                    "window": args.stft_window or "hann",
                }
            result = analyze_audio(args.file, peak_count=args.peaks, stft_options=stft_options)
```

- [ ] **Step 2: Smoke-test the CLI**

Run (use any existing fixture WAV — if none, create one via the test helper):

```bash
python python-backend/main.py --file <path-to.wav> --stft-n-fft 512 --stft-hop 128 --stft-window hamming | python -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['channels'][0]['spectrogram']['windowSize'], d['channels'][0]['spectrogram']['hopSize'])"
```

Expected: `512 128`.

- [ ] **Step 3: Ruff**

Run: `ruff check python-backend && ruff format --check python-backend`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add python-backend/main.py
git commit -m "feat(backend-cli): add --stft-n-fft/--stft-hop/--stft-window flags"
```

---

## Task 4: Extension — runAnalysis forwards STFT options

**Files:**
- Modify: `src/extension/index.ts`

- [ ] **Step 1: Extend `runAnalysis` signature and spawn args**

In `src/extension/index.ts` at the `runAnalysis` definition (around line 576), change:

```ts
async function runAnalysis(
    extensionPath: string,
    fileUri: vscode.Uri,
    stftOptions?: StftOptions,
): Promise<AnalysisResult> {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const pythonCommand = config.get<string>('pythonCommand', 'python3');
    const defaultPeakCount = config.get<number>('defaultPeakCount', 5);
    const scriptPath = path.join(extensionPath, 'python-backend', 'main.py');

    const args = [scriptPath, '--file', fileUri.fsPath, '--peaks', String(defaultPeakCount)];
    if (stftOptions) {
        args.push(
            '--stft-n-fft', String(stftOptions.nFft),
            '--stft-hop', String(stftOptions.hopSize),
            '--stft-window', stftOptions.window,
        );
    }

    return new Promise((resolve, reject) => {
        const process = spawn(pythonCommand, args, {
            cwd: extensionPath,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        // ...keep the rest of the existing implementation unchanged
```

Add the import near the top of the file (next to existing analysisTypes imports):

```ts
import type { StftOptions } from '../shared/analysis/analysisTypes';
```

- [ ] **Step 2: Compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/extension/index.ts
git commit -m "feat(extension): forward STFT options to python backend"
```

---

## Task 5: Extension — settings persistence + reanalyze handler

**Files:**
- Modify: `src/extension/index.ts`
- Modify: `src/webview/panels/ComparisonPanel.ts`

- [ ] **Step 1: Read settings in `ComparisonPanel.show`**

In `src/webview/panels/ComparisonPanel.ts`, change the `show` signature to accept optional settings and pass them into `renderHtml`. Around line 92:

```ts
public static show(
    extensionUri: vscode.Uri,
    results: AnalysisResultWithError[],
    existingPanel?: vscode.WebviewPanel,
    spectrogramSettings: SpectrogramSettings = DEFAULT_SPECTROGRAM_SETTINGS,
): vscode.WebviewPanel {
```

Add the import at the top of the file:

```ts
import {
    DEFAULT_SPECTROGRAM_SETTINGS,
    type SpectrogramSettings,
} from '../../shared/analysis/analysisTypes';
```

In the `state` literal built inside `show`, include `spectrogramSettings`:

```ts
const state: ComparisonResultsState = {
    mode: 'results',
    spectrogramSettings,
    results: results.map((result) => ({
        ...result,
        audioSource: panel.webview.asWebviewUri(vscode.Uri.file(result.filePath)).toString(),
    })),
};
```

Update `ComparisonResultsState` (search in the same file) to include `spectrogramSettings: SpectrogramSettings;`.

- [ ] **Step 2: Wire workspaceState in extension/index.ts**

In `src/extension/index.ts`, find every site that calls `ComparisonPanel.show(...)`. Add this helper near the top of the file (after imports):

```ts
const SPECTROGRAM_SETTINGS_KEY = 'audioWandasAnalyzer.spectrogramSettings';

function loadSpectrogramSettings(context: vscode.ExtensionContext): SpectrogramSettings {
    const stored = context.workspaceState.get<SpectrogramSettings>(SPECTROGRAM_SETTINGS_KEY);
    return stored ?? DEFAULT_SPECTROGRAM_SETTINGS;
}
```

Add imports:

```ts
import {
    DEFAULT_SPECTROGRAM_SETTINGS,
    type SpectrogramSettings,
    type RequestReanalyzeMessage,
    type UpdateSpectrogramSettingsMessage,
    type AnalysisUpdateMessage,
} from '../shared/analysis/analysisTypes';
```

Replace `ComparisonPanel.show(context.extensionUri, results, panel)` with `ComparisonPanel.show(context.extensionUri, results, panel, loadSpectrogramSettings(context))` at line 533 (and any other call site).

- [ ] **Step 3: Handle webview messages**

Extend the `panel.webview.onDidReceiveMessage` block in `src/extension/index.ts` (around line 274) — add two branches **before** the catch:

```ts
if (isUpdateSpectrogramSettingsMessage(message)) {
    await context.workspaceState.update(SPECTROGRAM_SETTINGS_KEY, message.settings);
    return;
}

if (isRequestReanalyzeMessage(message)) {
    await context.workspaceState.update(SPECTROGRAM_SETTINGS_KEY, message.settings);
    const filePaths = getActiveFilePathsForPanel(panel);
    const stftOptions = message.settings.auto ? undefined : message.settings.stft;
    const results: AnalysisResultWithError[] = [];
    for (const filePath of filePaths) {
        try {
            results.push(await runAnalysis(context.extensionPath, vscode.Uri.file(filePath), stftOptions));
        } catch (err) {
            results.push({
                filePath,
                fileName: path.basename(filePath),
                sampleRateHz: 0,
                durationSeconds: 0,
                channelCount: 0,
                sampleCount: 0,
                channels: [],
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    await panel.webview.postMessage({ type: 'analysis-update', results } satisfies AnalysisUpdateMessage);
    return;
}
```

Add type guards at the bottom of the file:

```ts
function isRequestReanalyzeMessage(value: unknown): value is RequestReanalyzeMessage {
    return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'request-reanalyze';
}

function isUpdateSpectrogramSettingsMessage(value: unknown): value is UpdateSpectrogramSettingsMessage {
    return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'update-spectrogram-settings';
}
```

Add `getActiveFilePathsForPanel`:

```ts
function getActiveFilePathsForPanel(panel: vscode.WebviewPanel): string[] {
    const selection = panelDirectorySelections.get(panel);
    if (selection) {
        return [...selection.selectedFilePaths];
    }
    const fallback = panelResultFilePaths.get(panel);
    return fallback ? [...fallback] : [];
}
```

In the existing `ComparisonPanel.show` call sites in `index.ts`, also record the file paths into a new `panelResultFilePaths` weak-map keyed by panel (track results passed to `show`). Add near `panelDirectorySelections`:

```ts
const panelResultFilePaths = new WeakMap<vscode.WebviewPanel, string[]>();
```

After each `ComparisonPanel.show(..., loadSpectrogramSettings(context))`, store paths:

```ts
panelResultFilePaths.set(comparisonPanel, results.map((r) => r.filePath));
```

(Adapt variable names to the existing scope at each call site.)

- [ ] **Step 4: Compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/extension/index.ts src/webview/panels/ComparisonPanel.ts
git commit -m "feat(extension): persist spectrogram settings and handle reanalyze"
```

---

## Task 6: Webview — settings popover UI

**Files:**
- Modify: `src/webview/panels/ComparisonPanel.ts`

- [ ] **Step 1: Add gear button to toolbar**

In `renderScript()` find the toolbar template (around line 934, where the `content-spectrogram` button lives) and insert immediately after that button:

```ts
+ '<button class="tb-btn" data-action="spectrogram-settings" title="スペクトログラム設定" style="display:none">⚙</button>'
```

The `display:none` default keeps it hidden until the spectrogram content type is active.

In the existing content-type click handler (around line 1776-1783) toggle visibility:

```js
const gear = document.querySelector('[data-action="spectrogram-settings"]');
if (gear) {
    gear.style.display = (contentType === 'spectrogram') ? '' : 'none';
}
```

- [ ] **Step 2: Render popover DOM**

Inside `renderScript()`, near the place where other floating UI is created (e.g. `#canvas-tooltip`), inject the popover markup string into the body via `document.body.insertAdjacentHTML('beforeend', …)` on script init. Add this block:

```js
const __spectrogramSettings = (__APP_STATE__.spectrogramSettings) || {
    auto: true,
    stft: { nFft: 1024, hopSize: 256, window: 'hann' },
    display: { dbMin: null, dbMax: null, maxFrequencyHz: null }
};

document.body.insertAdjacentHTML('beforeend', `
<div id="spec-settings-popover" hidden style="position:absolute;z-index:50;background:var(--panel);border:1px solid var(--line);padding:12px;border-radius:6px;min-width:260px;color:var(--text);font-family:var(--font-ui);">
  <label style="display:block;margin-bottom:6px"><input type="checkbox" id="spec-auto"> Auto (defaults)</label>
  <fieldset id="spec-stft-fields" style="border:1px solid var(--line);padding:6px;margin-bottom:8px">
    <legend>STFT</legend>
    <label>n_fft <select id="spec-nfft">
      ${[64,128,256,512,1024,2048,4096,8192,16384].map(v=>`<option value="${v}">${v}</option>`).join('')}
    </select></label><br>
    <label>hop_size <input type="number" id="spec-hop" min="1" step="1"></label><br>
    <label>window <select id="spec-window">
      <option value="hann">hann</option><option value="hamming">hamming</option>
      <option value="blackman">blackman</option><option value="boxcar">boxcar</option>
    </select></label>
    <div style="font-size:11px;color:var(--muted)">変更は「適用」で反映</div>
  </fieldset>
  <fieldset style="border:1px solid var(--line);padding:6px;margin-bottom:8px">
    <legend>Display</legend>
    <label>dB min <input type="number" id="spec-dbmin" step="1" placeholder="auto"></label><br>
    <label>dB max <input type="number" id="spec-dbmax" step="1" placeholder="auto"></label><br>
    <label>max freq Hz <input type="number" id="spec-maxfreq" min="1" step="1" placeholder="Nyquist"></label>
  </fieldset>
  <div style="display:flex;gap:6px;justify-content:flex-end">
    <button class="tb-btn" id="spec-reset">Reset</button>
    <button class="tb-btn" id="spec-apply">Apply</button>
  </div>
</div>`);
```

- [ ] **Step 3: Wire popover open / close**

```js
const __specPopover = document.getElementById('spec-settings-popover');

function __openSpecPopover() {
    const btn = document.querySelector('[data-action="spectrogram-settings"]');
    if (!btn || !__specPopover) return;
    const rect = btn.getBoundingClientRect();
    __specPopover.style.top = (rect.bottom + 6) + 'px';
    __specPopover.style.left = Math.max(8, rect.right - 280) + 'px';
    __specPopover.hidden = false;
    __syncSpecFormFromState();
}
function __closeSpecPopover() { if (__specPopover) __specPopover.hidden = true; }

document.addEventListener('click', function(ev) {
    const btn = ev.target.closest && ev.target.closest('[data-action="spectrogram-settings"]');
    if (btn) { ev.stopPropagation(); (__specPopover.hidden ? __openSpecPopover : __closeSpecPopover)(); return; }
    if (!__specPopover.hidden && !__specPopover.contains(ev.target)) __closeSpecPopover();
});
document.addEventListener('keydown', function(ev) { if (ev.key === 'Escape') __closeSpecPopover(); });
```

- [ ] **Step 4: Wire form bindings**

```js
function __syncSpecFormFromState() {
    document.getElementById('spec-auto').checked = !!__spectrogramSettings.auto;
    document.getElementById('spec-nfft').value = String(__spectrogramSettings.stft.nFft);
    document.getElementById('spec-hop').value = String(__spectrogramSettings.stft.hopSize);
    document.getElementById('spec-window').value = __spectrogramSettings.stft.window;
    document.getElementById('spec-dbmin').value = __spectrogramSettings.display.dbMin ?? '';
    document.getElementById('spec-dbmax').value = __spectrogramSettings.display.dbMax ?? '';
    document.getElementById('spec-maxfreq').value = __spectrogramSettings.display.maxFrequencyHz ?? '';
    __applySpecAutoState();
}

function __applySpecAutoState() {
    const auto = document.getElementById('spec-auto').checked;
    document.getElementById('spec-stft-fields').disabled = auto;
}

document.getElementById('spec-auto').addEventListener('change', __applySpecAutoState);

function __readDisplayFromForm() {
    const n = (id) => {
        const v = document.getElementById(id).value;
        return v === '' ? null : Number(v);
    };
    return { dbMin: n('spec-dbmin'), dbMax: n('spec-dbmax'), maxFrequencyHz: n('spec-maxfreq') };
}

['spec-dbmin','spec-dbmax','spec-maxfreq'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', function() {
        __spectrogramSettings.display = __readDisplayFromForm();
        vscode.postMessage({ type: 'update-spectrogram-settings', settings: __spectrogramSettings });
        scheduleRender();
    });
});

document.getElementById('spec-reset').addEventListener('click', function() {
    __spectrogramSettings = { auto: true, stft: { nFft: 1024, hopSize: 256, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } };
    __syncSpecFormFromState();
    vscode.postMessage({ type: 'update-spectrogram-settings', settings: __spectrogramSettings });
    scheduleRender();
});

document.getElementById('spec-apply').addEventListener('click', function() {
    __spectrogramSettings = {
        auto: document.getElementById('spec-auto').checked,
        stft: {
            nFft: Number(document.getElementById('spec-nfft').value),
            hopSize: Number(document.getElementById('spec-hop').value),
            window: document.getElementById('spec-window').value
        },
        display: __readDisplayFromForm()
    };
    vscode.postMessage({ type: 'request-reanalyze', settings: __spectrogramSettings });
    __closeSpecPopover();
});
```

- [ ] **Step 5: Handle `analysis-update` from extension**

Inside the existing `window.addEventListener('message', …)` block (one of those at lines 653/664/675), add a branch:

```js
if (event.data && event.data.type === 'analysis-update') {
    __APP_STATE__.results = event.data.results.map(function(r, i) {
        const old = __APP_STATE__.results[i];
        return Object.assign({}, r, { audioSource: old ? old.audioSource : '' });
    });
    scheduleRender();
    return;
}
```

- [ ] **Step 6: Extend `paintSpectrogram` for display params**

Find `paintSpectrogram` in the same file. At the top of the function, add:

```js
const dispCfg = __spectrogramSettings.display || {};
const dbLo = (dispCfg.dbMin != null) ? dispCfg.dbMin : spec.minDb;
const dbHi = (dispCfg.dbMax != null) ? dispCfg.dbMax : spec.maxDb;
const maxFreq = (dispCfg.maxFrequencyHz != null) ? Math.min(dispCfg.maxFrequencyHz, spec.maxFrequencyHz) : spec.maxFrequencyHz;
```

Then use `dbLo`/`dbHi` instead of `spec.minDb`/`spec.maxDb` for color mapping, and clip rows whose center frequency exceeds `maxFreq` before drawing. (Inspect the existing loop and substitute the variables; do not rewrite the function.)

- [ ] **Step 7: Compile + run unit tests**

Run: `npm test`
Expected: pass (no behavior change in existing flows).

- [ ] **Step 8: Commit**

```bash
git add src/webview/panels/ComparisonPanel.ts
git commit -m "feat(webview): spectrogram settings popover and reanalyze hookup"
```

---

## Task 7: TS unit test — settings round-trip + paintSpectrogram clamp

**Files:**
- Create: `src/test/spectrogramSettings.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SPECTROGRAM_SETTINGS,
    type SpectrogramSettings,
} from '../shared/analysis/analysisTypes';

test('default settings are auto', () => {
    assert.equal(DEFAULT_SPECTROGRAM_SETTINGS.auto, true);
    assert.equal(DEFAULT_SPECTROGRAM_SETTINGS.stft.nFft, 1024);
});

test('round-trip via JSON', () => {
    const s: SpectrogramSettings = {
        auto: false,
        stft: { nFft: 2048, hopSize: 512, window: 'hamming' },
        display: { dbMin: -80, dbMax: 0, maxFrequencyHz: 8000 },
    };
    const restored = JSON.parse(JSON.stringify(s)) as SpectrogramSettings;
    assert.deepEqual(restored, s);
});
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: new tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/test/spectrogramSettings.test.ts
git commit -m "test: spectrogram settings type defaults and round-trip"
```

---

## Task 8: E2E test

**Files:**
- Create: `src/e2e/suite/spectrogramSettings.test.ts`

- [ ] **Step 1: Inspect an existing E2E test for boilerplate**

Run: `ls src/e2e/suite && head -80 src/e2e/suite/*.test.ts 2>/dev/null | head -200`

Identify the existing pattern for opening a `ComparisonPanel`, the test fixture WAV path, and how `postTestActions` + `getTestSnapshot` are used. Mirror that exact shape — do **not** invent a new harness.

- [ ] **Step 2: Write the E2E**

Create `src/e2e/suite/spectrogramSettings.test.ts` following the harness pattern from Step 1. The test must:

1. Activate the extension and open the panel against a fixture WAV.
2. Wait until `ComparisonPanel.getTestSnapshot()` is populated.
3. Post a test action that selects spectrogram content and clicks `spectrogram-settings`. Add corresponding handlers in `renderScript()` if `postTestActions` does not already understand `spectrogram-settings` / `apply-spectrogram-settings` actions.
4. Post a `apply-spectrogram-settings` action with `{ nFft: 512, hopSize: 128, window: 'hamming', auto: false }`.
5. Poll the latest analysis snapshot — assert `channels[0].spectrogram.windowSize === 512` and `hopSize === 128`.
6. Post an action setting `display.dbMin = -60` and assert the test snapshot's `renderedUi` reflects the change without a re-analysis (no new Python call).
7. Re-open the panel — assert the new settings survive (workspaceState).

Use Mocha `suite()` / `test()` style matching neighbouring files. If `postTestActions` does not yet handle these specific actions, extend the inline test-action dispatcher in `renderScript()` minimally — one branch per new action — and re-build. Keep the assertion strings stable so they can be grepped.

- [ ] **Step 3: Build + run E2E**

Run: `npm run verify:e2e`
Expected: all suites pass including the new one.

- [ ] **Step 4: Commit**

```bash
git add src/e2e/suite/spectrogramSettings.test.ts src/webview/panels/ComparisonPanel.ts
git commit -m "test(e2e): spectrogram settings popover roundtrip"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run full verify**

Run: `npm run verify`
Expected: exit 0.

- [ ] **Step 2: Run E2E**

Run: `npm run verify:e2e`
Expected: exit 0.

- [ ] **Step 3: Manual smoke**

1. F5 launch the extension.
2. Open a WAV, switch to spectrogram view.
3. Click the gear → change n_fft to 512, hop to 128, window to hamming → Apply. Confirm new spectrogram bins.
4. Change dB min to -60 → instant color shift, no spinner.
5. Reload window, reopen the same WAV — settings persist.

- [ ] **Step 4: Final commit / push**

If anything was tweaked during smoke testing:

```bash
git add -A
git commit -m "chore: polish spectrogram settings"
```

Otherwise no-op. Then offer to merge / PR per `superpowers:finishing-a-development-branch`.
