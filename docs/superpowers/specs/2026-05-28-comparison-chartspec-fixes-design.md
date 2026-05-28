# Design: ComparisonPanel / ChartSpecPanel Bug Fixes

**Date:** 2026-05-28  
**Issues:** #99, #100, #101, #102  
**Branch:** worktree-fix-issues-90-91-92

---

## Scope

Four independent bug fixes targeting `ComparisonPanel` and `ChartSpecPanel`, delivered in one PR.

---

## #99 — Remove unused mute/solo UI and shortcuts

### Problem

`ComparisonPanel` exposes M/S track buttons and keyboard shortcuts that have no backing multi-track playback logic. They appear as real features but do nothing meaningful.

### Design

Complete removal from all layers — no CSS hide, no feature flag.

**`comparisonRenderScript.ts`**
- Delete `soloTrackIndex` state variable
- Delete `toggleMute()` and `toggleSolo()` functions
- Delete M/S keyboard handler branches (`e.key === 'm'` / `'s'`)
- Delete M/S button generation in track row HTML (`data-action="toggle-mute"` / `"toggle-solo"`)
- Delete solo-filtered rendering branches (`if (soloTrackIndex !== null && soloTrackIndex !== i)`)
- Keep `trackRuntime[i].hidden` — it is used by other rendering logic (color, playback)
- Keep `--muted` CSS variable references — used for visual styling unrelated to solo

**`guiTriggerabilityInventory.ts`**
- Remove `'toggle-mute'`, `'toggle-solo'`, `'M / S'` entries

**`strings.ts`**
- Remove: `ariaToggleMute`, `ariaToggleSolo`, `helpRowMuteSolo`
- Remove: `announceMuted`, `announceUnmuted`, `announceSoloed`, `announceUnsoloed`

**`allButtons.spec.ts`**
- Remove toggle-mute / toggle-solo click and assertion blocks

**`e2e/suite/index.ts`**
- Remove `spectrum-mute` test block

### Acceptance criteria

- M/S buttons do not appear in ComparisonPanel
- M/S keyboard shortcuts are inert
- All tests pass with no references to `toggle-mute` / `toggle-solo`

---

## #100 — Separate axis canvas from waveform canvas

### Problem

`drawWaveformTrack` draws axis labels (0–30 px) and waveform (clipped to 32–W px) on the same canvas. The first 32 px of waveform data are visually hidden behind the axis background, making the signal start appear cut off.

### Design

Replace the single canvas with a flex container holding two canvases side by side.

```
<div style="display:flex; width:100%">
  <canvas class="axis-canvas"     style="width:32px; flex:none">   ← axis only
  <canvas class="waveform-canvas" style="flex:1">                  ← waveform only
</div>
```

**Constants**
- Define `const AXIS_W = 32` once at the top of the relevant render scope
- All axis-width references (clip rect, ruler left-padding, layout) use this constant

**`drawWaveformTrack` refactor**
1. Create a flex wrapper `<div>`
2. Create `axisCanvas` (fixed `AXIS_W` px wide) — call `drawWaveformAmplitudeAxis` on it
3. Create `waveformCanvas` (`flex: 1`) — render waveform with no clip offset needed
4. Append both to wrapper, wrapper replaces the old single canvas in the track row

**Rendering**
- `renderWaveformPipeline` receives the waveform canvas; coordinate mapping starts at x=0 of that canvas (no offset needed)
- Cursor, loop region, hover line draw on `waveformCanvas` only
- Ruler row left-padding uses `AXIS_W` for alignment

**Test addition**
- `node:test`: assert that `axisCanvas.width <= AXIS_W * devicePixelRatio` and `waveformCanvas.offsetLeft >= AXIS_W`

### Acceptance criteria

- Waveform left edge is not hidden behind the axis band
- Ruler and track rows share the same left margin via `AXIS_W`
- No regression in existing waveform rendering tests

---

## #101 — Fix ChartSpec dblclick coordinate mismatch

### Problem

`chartSpecRenderScript.ts` computes hit zones (`plot.x`, `plot.y`, etc.) in canvas logical pixels (720 × 240). When the canvas is rendered narrower than 720 px (container width < 720 px), `getBoundingClientRect()` returns the smaller CSS size, but the raw `e.clientX - rect.left` value is compared against the 720-px-based `plot` coordinates. The comparison is wrong whenever `rect.width !== cv.width`.

### Design

**`toCanvasCoords` helper function**

Added once, used by all three dblclick handlers (line, bar, heatmap):

```ts
function toCanvasCoords(e, canvas, cv) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = cv.width / rect.width;
    const scaleY = cv.height / rect.height;
    return {
        cx: (e.clientX - rect.left) * scaleX,
        cy: (e.clientY - rect.top)  * scaleY,
    };
}
```

`cv.width` is the logical drawing width (720), `rect.width` is the actual rendered CSS width. The ratio converts click position to the same coordinate space as `plot`.

**Why this is correctly encapsulated**
- `plot` remains the single source of truth for zone boundaries
- Layout changes require only changing `plot` — the handler needs no update
- Click coordinates are always computed from the current rendered size at event time, so resize and responsive scaling are automatically correct

**CSS change**
- Add `canvas { max-width: 100%; }` to `ChartSpecPanel` HTML so canvases shrink to fit narrow panels

**Dblclick handler update (3 locations: drawLine, drawBar, drawHeatmap)**

```ts
// Before
const rect = cv.canvas.getBoundingClientRect();
const cx = e.clientX - rect.left;
const cy = e.clientY - rect.top;

// After
const { cx, cy } = toCanvasCoords(e, cv.canvas, cv);
```

**Test addition**
- Playwright smoke test: render chart in a 400 px wide viewport, dblclick the Y-axis zone, assert `openRangePopup` is triggered (or range popup appears)

### Acceptance criteria

- Dblclick on Y-axis / X-axis / plot interior works in panels narrower than 720 px
- `toCanvasCoords` is the single coordinate normalization point
- Regression test catches future coordinate-space mismatches

---

## #102 — Add user feedback for Copy spec / Export PNG / Export CSV

### Problem

All three toolbar buttons execute silently. Users cannot tell whether the action succeeded or failed.

### Design

Use the existing `announce()` function (aria-live region) for success feedback and `vscode.postMessage({ type: 'show-info' })` for failure feedback — both mechanisms already exist in the codebase.

**New i18n strings in `strings.ts`**

| Key | English | Japanese |
|---|---|---|
| `announceSpecCopied` | `Spec copied to clipboard` | `スペックをクリップボードにコピーしました` |
| `announceSpecCopyFailed` | `Copy failed: clipboard not available` | `コピー失敗：クリップボードが利用できません` |
| `announceExportPngStarted` | `PNG export started` | `PNG 出力を開始しました` |
| `announceExportPngFailed` | `PNG export failed: no visible canvases` | `PNG 出力失敗：表示中のキャンバスがありません` |
| `announceExportCsvStarted` | `CSV export started` | `CSV 出力を開始しました` |
| `announceExportCsvFailed` | `CSV export failed: no spectrum data at cursor` | `CSV 出力失敗：カーソル位置にスペクトルデータがありません` |

**`copySpecToClipboard` changes**
- On success (`.then`): `announce(STR.announceSpecCopied)`
- On failure (`.catch`): `vscode.postMessage({ type: 'show-info', message: STR.announceSpecCopyFailed })`

**`exportPng` changes**
- On early-return (no canvases): replace `console.warn` with `vscode.postMessage({ type: 'show-info', message: STR.announceExportPngFailed })`
- After download triggered: `announce(STR.announceExportPngStarted)`

**`exportCsv` changes**
- On early-return (no data): replace `console.warn` with `vscode.postMessage({ type: 'show-info', message: STR.announceExportCsvFailed })`
- After download triggered: `announce(STR.announceExportCsvStarted)`

**Test addition**
- `allButtons.spec.ts`: after clicking copy-spec / export-png / export-csv, assert that `#a11y-announce` textContent matches expected string

### Acceptance criteria

- Each button produces a visible notification on success
- Failure paths show an info message instead of silently logging to console
- At least one success path is covered by the smoke test

---

## Testing strategy

| Issue | Test type | What is verified |
|---|---|---|
| #99 | Existing tests pass (no mute/solo refs) | Dead controls are gone |
| #100 | node:test (layout assertion) | Axis and waveform canvases don't overlap |
| #101 | Playwright smoke (narrow viewport dblclick) | Coordinate normalization works at any canvas width |
| #102 | Playwright smoke (announce text) | User-visible feedback fires on button click |

Run `npm run verify` after all changes. If Webview runtime behavior is touched, also run `npm run test:ui`.
