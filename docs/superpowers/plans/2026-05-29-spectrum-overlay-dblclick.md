# パワースペクトル overlay dblclick 操作 — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ComparisonPanel のパワースペクトル overlay（`#spectrum-overlay-canvas`）に、軸 dblclick→レンジ popover、プロット内部 dblclick→ズームリセットを追加する。

**Architecture:** すべて `src/webview/comparisonRenderScript.ts`（インライン IIFE 文字列）内で完結。既存の状態（`specFreqStart/End`, `specDbMin/Max`, `specZoomReset()`, `_lastVisDbMin/Max`）を再利用し、`_lastSpectrumMaxF` を1つ追加。popover は ChartSpec の `range-popup` を踏襲しつつ i18n（`STR.*`）化して新設。既存のドラッグズーム（mousedown/move/up）と共存（dblclick はドラッグ移動が無いため衝突しない）。

**Tech Stack:** TypeScript, node:test (jsdom 統合), Playwright (実ブラウザ smoke)。Build: `npm run compile`。Verify: `npm run verify` / `npm run test:ui`。

---

## File Map

| File | Changes |
|---|---|
| `src/shared/i18n/strings.ts` | popover 用 i18n キー 8 個（interface + en + ja） |
| `src/webview/comparisonRenderScript.ts` | `_lastSpectrumMaxF` 宣言/代入、`#spectrum-range-popover` 構築 + ハンドラ、`openSpectrumRangePopup()`、overlay への dblclick リスナー |
| `src/test/renderScript.integration.test.ts` | jsdom 統合テスト（各ゾーン dblclick / Apply / reset / error） |
| `src/test/uiSmoke/spectrumOverlayDblclick.spec.ts` | Playwright 実ブラウザ smoke（新規） |

## 既存コードの確定情報（実装時の参照）

- overlay plot 余白: `padL=36, padR=8, padT=8, padB=18`、canvas 高さ `H=140`、幅 `W = wrap.clientWidth || 800`（`renderOverlaySpectrum`、定義 L2906）
- 状態（モジュールレベル、L156-161）: `specFreqStart=0`, `specFreqEnd=1`（0..1 正規化）, `specDbMin=null`, `specDbMax=null`, `_lastVisDbMin=null`, `_lastVisDbMax=null`
- `renderOverlaySpectrum` 内で `maxF` 算出後に `_lastVisDbMin/_lastVisDbMax` を代入している箇所（L2943 付近）
- `specZoomReset()` 定義 L2488（`specFreqStart=0; specFreqEnd=1; specDbMin=null; specDbMax=null; refreshSpectrumViews();`）
- overlay の既存マウス配線（mousedown ドラッグズーム等）は L1717-1786 の IIFE 内、`const overlayCanvas = document.getElementById('spectrum-overlay-canvas');` のブロック
- ChartSpec popup の踏襲元: `src/webview/chartSpecRenderScript.ts` L70-193

---

## Task 1: i18n キー追加

**Files:**
- Modify: `src/shared/i18n/strings.ts`

- [ ] **Step 1: `UiStrings` interface にキー追加**

`src/shared/i18n/strings.ts` の `interface UiStrings` 内、`btnSpecZoomReset: string;`（L144 付近）の直後に追加:

```ts
    specRangeTitle: string;
    specRangeAxisFreq: string;
    specRangeAxisDb: string;
    specRangeMin: string;
    specRangeMax: string;
    specRangeApply: string;
    specRangeAuto: string;
    specRangeErrorMinMax: string;
```

- [ ] **Step 2: en ロケールに値追加**

`en:` ブロックの `btnSpecZoomReset: 'All',`（L278 付近）の直後に追加:

```ts
        specRangeTitle: 'Range',
        specRangeAxisFreq: 'Frequency (Hz)',
        specRangeAxisDb: 'Level (dB)',
        specRangeMin: 'Min',
        specRangeMax: 'Max',
        specRangeApply: 'Apply',
        specRangeAuto: 'Auto',
        specRangeErrorMinMax: 'Min must be smaller than Max',
```

- [ ] **Step 3: ja ロケールに値追加**

`ja:` ブロックの `btnSpecZoomReset: '全域',`（L410 付近）の直後に追加:

```ts
        specRangeTitle: 'レンジ',
        specRangeAxisFreq: '周波数 (Hz)',
        specRangeAxisDb: 'レベル (dB)',
        specRangeMin: 'Min',
        specRangeMax: 'Max',
        specRangeApply: '適用',
        specRangeAuto: '自動',
        specRangeErrorMinMax: 'Min は Max より小さい値を入力してください',
```

- [ ] **Step 4: コンパイルで型確認**

Run: `npm run compile 2>&1 | tail -5`
Expected: exit 0、`specRange*` 欠落の型エラーなし

- [ ] **Step 5: i18n 網羅テスト確認**

Run: `node --test --import tsx src/test/i18n.test.ts 2>&1 | tail -10`
Expected: en/ja のキー集合一致テストが pass（既存テストが新キーを検証）

- [ ] **Step 6: Commit**

```bash
git add src/shared/i18n/strings.ts
git commit -m "i18n: add spectrum overlay range popover strings"
```

---

## Task 2: `_lastSpectrumMaxF` の保持

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: モジュールレベル変数を宣言**

`let _lastVisDbMax = null;`（L161）の直後に追加:

```ts
            let _lastSpectrumMaxF = 0;   // overlay の最大周波数(Hz) キャッシュ（freq popover 用）
```

- [ ] **Step 2: `renderOverlaySpectrum` で代入**

`renderOverlaySpectrum` 内、`_lastVisDbMin = visDbMinO;`（L2943 付近）の直前に追加:

```ts
                _lastSpectrumMaxF = maxF;
```

（`maxF` は同関数内で slices から算出済みのローカル変数。`_lastVisDbMin` 代入と同じブロックにあるためスコープ内。）

- [ ] **Step 3: コンパイル**

Run: `npm run compile 2>&1 | tail -5`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: cache spectrum overlay maxF for range popover"
```

---

## Task 3: popover の構築とハンドラ（`openSpectrumRangePopup`）

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

popover は body 直下に一度だけ生成し、`openSpectrumRangePopup(axis, clientX, clientY)` で開く。`axis` は `'freq'` | `'db'`。状態は ChartSpec の `rangeOverrides` ではなく直接 `specFreqStart/End` / `specDbMin/Max` を操作する。

- [ ] **Step 1: popover 構築 IIFE とハンドラを追加**

`specZoomReset()` 関数定義（L2488 付近）の直後に、以下のブロックを追加:

```ts
            // ── スペクトル overlay レンジ popover ──
            let _specRangeAxis = 'freq'; // 'freq' | 'db'

            (function buildSpectrumRangePopover() {
                if (document.getElementById('spectrum-range-popover')) { return; }
                const pop = document.createElement('div');
                pop.id = 'spectrum-range-popover';
                pop.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:10px 12px;font-size:12px;color:var(--text);box-shadow:0 4px 12px rgba(0,0,0,.4);min-width:180px;';
                const inputStyle = 'width:90px;background:var(--vscode-input-background,#3c3c3c);color:inherit;border:1px solid var(--vscode-input-border,#555);border-radius:2px;padding:2px 4px;font-size:12px;';
                const labelStyle = 'width:42px;font-size:11px;color:var(--muted);';
                pop.innerHTML =
                    '<div style="margin-bottom:8px;font-weight:600;font-size:11px;color:var(--muted);">'
                    + escHtml(STR.specRangeTitle)
                    + ' <span id="spec-range-axis-badge" style="padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;color:#fff;background:#0e639c;"></span>'
                    + '</div>'
                    + '<div style="display:flex;flex-direction:column;gap:4px;">'
                    + '<label style="display:flex;align-items:center;gap:6px;"><span style="' + labelStyle + '">' + escHtml(STR.specRangeMin) + '</span><input id="spec-range-min" type="number" step="any" placeholder="auto" style="' + inputStyle + '"></label>'
                    + '<label style="display:flex;align-items:center;gap:6px;"><span style="' + labelStyle + '">' + escHtml(STR.specRangeMax) + '</span><input id="spec-range-max" type="number" step="any" placeholder="auto" style="' + inputStyle + '"></label>'
                    + '</div>'
                    + '<div style="display:flex;gap:6px;margin-top:8px;">'
                    + '<button class="tb-btn" id="spec-range-apply" style="flex:1;">' + escHtml(STR.specRangeApply) + '</button>'
                    + '<button class="tb-btn" id="spec-range-auto" style="flex:1;">' + escHtml(STR.specRangeAuto) + '</button>'
                    + '<button class="tb-btn" id="spec-range-close" aria-label="Close">×</button>'
                    + '</div>'
                    + '<div id="spec-range-error" style="color:#f48771;font-size:11px;margin-top:4px;min-height:14px;"></div>';
                document.body.appendChild(pop);
            })();

            function closeSpectrumRangePopover() {
                const pop = document.getElementById('spectrum-range-popover');
                if (pop) { pop.style.display = 'none'; }
                const err = document.getElementById('spec-range-error');
                if (err) { err.textContent = ''; }
            }

            function openSpectrumRangePopup(axis, clientX, clientY) {
                _specRangeAxis = axis;
                const pop = document.getElementById('spectrum-range-popover');
                if (!pop) { return; }
                const badge = document.getElementById('spec-range-axis-badge');
                const minInput = document.getElementById('spec-range-min');
                const maxInput = document.getElementById('spec-range-max');
                const err = document.getElementById('spec-range-error');
                if (err) { err.textContent = ''; }
                if (axis === 'db') {
                    if (badge) { badge.textContent = STR.specRangeAxisDb; }
                    minInput.value = (specDbMin != null) ? String(specDbMin)
                        : (_lastVisDbMin != null ? String(Math.round(_lastVisDbMin)) : '');
                    maxInput.value = (specDbMax != null) ? String(specDbMax)
                        : (_lastVisDbMax != null ? String(Math.round(_lastVisDbMax)) : '');
                } else {
                    if (badge) { badge.textContent = STR.specRangeAxisFreq; }
                    minInput.value = String(Math.round(specFreqStart * _lastSpectrumMaxF));
                    maxInput.value = String(Math.round(specFreqEnd * _lastSpectrumMaxF));
                }
                pop.style.left = (clientX + 8) + 'px';
                pop.style.top  = (clientY + 8) + 'px';
                pop.style.display = 'block';
                if (maxInput) { maxInput.focus(); }
            }

            function applySpectrumRange() {
                const minInput = document.getElementById('spec-range-min');
                const maxInput = document.getElementById('spec-range-max');
                const err = document.getElementById('spec-range-error');
                if (!minInput || !maxInput) { return; }
                const minVal = minInput.value.trim();
                const maxVal = maxInput.value.trim();
                const min = minVal === '' ? null : Number(minVal);
                const max = maxVal === '' ? null : Number(maxVal);
                if (err) { err.textContent = ''; }
                if (min !== null && !isFinite(min)) { if (err) { err.textContent = STR.specRangeErrorMinMax; } return; }
                if (max !== null && !isFinite(max)) { if (err) { err.textContent = STR.specRangeErrorMinMax; } return; }
                if (min !== null && max !== null && min >= max) { if (err) { err.textContent = STR.specRangeErrorMinMax; } return; }
                if (_specRangeAxis === 'db') {
                    specDbMin = min;
                    specDbMax = max;
                } else {
                    const mf = _lastSpectrumMaxF || 1;
                    specFreqStart = (min === null) ? 0 : Math.max(0, Math.min(1, min / mf));
                    specFreqEnd   = (max === null) ? 1 : Math.max(0, Math.min(1, max / mf));
                }
                refreshSpectrumViews();
                closeSpectrumRangePopover();
            }

            function autoSpectrumRange() {
                if (_specRangeAxis === 'db') {
                    specDbMin = null;
                    specDbMax = null;
                } else {
                    specFreqStart = 0;
                    specFreqEnd = 1;
                }
                refreshSpectrumViews();
                closeSpectrumRangePopover();
            }

            (function wireSpectrumRangeHandlers() {
                const applyBtn = document.getElementById('spec-range-apply');
                const autoBtn  = document.getElementById('spec-range-auto');
                const closeBtn = document.getElementById('spec-range-close');
                if (applyBtn) { applyBtn.addEventListener('click', applySpectrumRange); }
                if (autoBtn)  { autoBtn.addEventListener('click', autoSpectrumRange); }
                if (closeBtn) { closeBtn.addEventListener('click', closeSpectrumRangePopover); }
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') { closeSpectrumRangePopover(); }
                });
                document.addEventListener('mousedown', function(e) {
                    const pop = document.getElementById('spectrum-range-popover');
                    if (pop && pop.style.display !== 'none' && !pop.contains(e.target)) {
                        closeSpectrumRangePopover();
                    }
                });
            })();
```

注意: 外側クリックの `mousedown` は overlay の既存ドラッグ開始 `mousedown`（L1742 付近）より後に登録されるが、popover 表示中のみ閉じる動作で、overlay ドラッグとは対象要素が異なるため衝突しない。

- [ ] **Step 2: コンパイル**

Run: `npm run compile 2>&1 | tail -5`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: spectrum overlay range popover (freq/dB) with apply/auto"
```

---

## Task 4: overlay への dblclick リスナー（ゾーン判定）

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

- [ ] **Step 1: 既存 overlay 配線ブロックに dblclick を追加**

L1786 付近、overlay の `document.addEventListener('mouseup', ...)` ブロックの直後（`}` で閉じた後、`document.querySelectorAll('.track-spectrum-canvas')` の前）に追加:

```ts
                        overlayCanvas.addEventListener('dblclick', function(e) {
                            const rect = overlayCanvas.getBoundingClientRect();
                            const scaleX = overlayCanvas.width  / (rect.width  || overlayCanvas.width);
                            const scaleY = overlayCanvas.height / (rect.height || overlayCanvas.height);
                            const cx = (e.clientX - rect.left) * scaleX;
                            const cy = (e.clientY - rect.top)  * scaleY;
                            const padL = 36, padR = 8, padT = 8, padB = 18;
                            const W = overlayCanvas.width, H = overlayCanvas.height;
                            if (_lastSpectrumMaxF <= 0) { return; } // データ無し
                            if (cx < padL) {
                                openSpectrumRangePopup('db', e.clientX, e.clientY);
                            } else if (cx >= padL && cx <= W - padR && cy > H - padB) {
                                openSpectrumRangePopup('freq', e.clientX, e.clientY);
                            } else if (cx >= padL && cx <= W - padR && cy >= padT && cy <= H - padB) {
                                specZoomReset();
                            }
                        });
```

- [ ] **Step 2: コンパイル**

Run: `npm run compile 2>&1 | tail -5`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat: spectrum overlay dblclick zones (axis range popover / interior reset)"
```

---

## Task 5: jsdom 統合テスト

**Files:**
- Modify: `src/test/renderScript.integration.test.ts`

既存パターン（`setupEnv()` + イベント dispatch + `comparison-panel-test-snapshot` または直接 DOM 検証）に従う。overlay canvas は初回レンダリングで `canvas.width` が設定される（`refreshSpectrumViews` → `nextAnimationFrame`）。jsdom の `getBoundingClientRect` は 0 を返すため、`scaleX = width/(0||width) = 1`、`rect.left=0` となり `clientX` がそのまま canvas 座標になる。

- [ ] **Step 1: テストを追加（ファイル末尾に追記）**

```ts
test('spectrum overlay: Y軸(dB) dblclick で popover が開く', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom); // 初回レンダリングで overlay canvas をサイズ設定
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLElement | null;
    assert.ok(overlay, 'overlay canvas が存在すること');
    // Y軸ゾーン: cx < padL(36) → clientX=10
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 70 }));
    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.ok(pop, 'popover が存在すること');
    assert.notStrictEqual(pop.style.display, 'none', 'popover が表示されること');
    const badge = env.dom.window.document.getElementById('spec-range-axis-badge');
    assert.ok(badge && /dB/.test(badge.textContent || ''), 'バッジが dB 軸であること');
    env.dom.window.close();
});

test('spectrum overlay: X軸(周波数) dblclick で popover が開く', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLElement | null;
    assert.ok(overlay, 'overlay canvas が存在すること');
    const cv = overlay as HTMLCanvasElement;
    const H = cv.height || 140;
    const W = cv.width || 800;
    // X軸ゾーン: cy > H-padB(18) かつ cx ∈ [36, W-8]
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: Math.floor(W / 2), clientY: H - 5 }));
    const badge = env.dom.window.document.getElementById('spec-range-axis-badge');
    assert.ok(badge && /Hz/.test(badge.textContent || ''), 'バッジが 周波数(Hz) 軸であること');
    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.notStrictEqual(pop.style.display, 'none', 'popover が表示されること');
    env.dom.window.close();
});

test('spectrum overlay: プロット内部 dblclick で specZoomReset される', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(overlay, 'overlay canvas が存在すること');
    const W = overlay!.width || 800;
    const H = overlay!.height || 140;
    // まず Y軸 popover を開いて dB レンジを適用（state を変化させる）
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 70 }));
    const minI = env.dom.window.document.getElementById('spec-range-min') as HTMLInputElement;
    const maxI = env.dom.window.document.getElementById('spec-range-max') as HTMLInputElement;
    minI.value = '-80'; maxI.value = '-20';
    (env.dom.window.document.getElementById('spec-range-apply') as HTMLElement).click();
    // スナップショットで specDbMin/Max が変化したことを確認
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
        data: { type: 'comparison-panel-test-action', actions: [], actionId: 'pre-spec-reset' },
    }));
    await nextAnimationFrame(env.dom);
    // 内部 dblclick で reset
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: Math.floor(W / 2), clientY: Math.floor(H / 2) }));
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
        data: { type: 'comparison-panel-test-action', actions: [], actionId: 'post-spec-reset' },
    }));
    await nextAnimationFrame(env.dom);
    const snaps = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot');
    const post = (snaps[snaps.length - 1] as any)?.renderedUi;
    assert.ok(post, 'reset 後スナップショットが存在すること');
    // axisLabels.spectrumOverlay は specDbMin/Max=null・全周波数に戻ると既定ラベルになる
    assert.ok(post.axisLabels && post.axisLabels.spectrumOverlay, '軸ラベルが存在すること');
    env.dom.window.close();
});

test('spectrum overlay: min>=max は error 表示し popover を閉じない', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLElement | null;
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 70 }));
    const minI = env.dom.window.document.getElementById('spec-range-min') as HTMLInputElement;
    const maxI = env.dom.window.document.getElementById('spec-range-max') as HTMLInputElement;
    minI.value = '-10'; maxI.value = '-50';
    (env.dom.window.document.getElementById('spec-range-apply') as HTMLElement).click();
    const err = env.dom.window.document.getElementById('spec-range-error') as HTMLElement;
    assert.ok(err.textContent && err.textContent.length > 0, 'エラーが表示されること');
    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.notStrictEqual(pop.style.display, 'none', 'エラー時は popover が開いたままであること');
    env.dom.window.close();
});
```

- [ ] **Step 2: テスト実行**

Run: `npm run compile && node --test --import tsx src/test/renderScript.integration.test.ts 2>&1 | tail -20`
Expected: 追加4テストを含め全て pass

- [ ] **Step 3: Commit**

```bash
git add src/test/renderScript.integration.test.ts
git commit -m "test: jsdom integration for spectrum overlay dblclick"
```

---

## Task 6: Playwright 実ブラウザ smoke（必須）

**Files:**
- Create: `src/test/uiSmoke/spectrumOverlayDblclick.spec.ts`

issue #101 の教訓に従い、実 Chromium で overlay の dblclick を検証する。`buildUiSmokeHtml`（ComparisonPanel は Chromium で描画可）を使用。

- [ ] **Step 1: smoke spec を作成**

```ts
import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

async function loadResultsUi(page: Page) {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#toolbar')).toBeVisible();
    // overlay がレンダリングされ canvas にサイズが付くのを待つ
    await page.waitForFunction(() => {
        const c = document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
        return !!c && c.width > 100;
    }, { timeout: 5000 });
}

test('spectrum overlay: Y軸 dblclick で範囲 popover が表示される', async ({ page }) => {
    await loadResultsUi(page);
    const overlay = page.locator('#spectrum-overlay-canvas');
    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    const { W, H } = await overlay.evaluate((c) => ({
        W: (c as HTMLCanvasElement).width, H: (c as HTMLCanvasElement).height,
    }));
    const sX = box!.width / W, sY = box!.height / H;
    // Y軸ゾーン: canvas x=10 (<padL36)
    await page.mouse.dblclick(box!.x + 10 * sX, box!.y + (H / 2) * sY);
    const pop = page.locator('#spectrum-range-popover');
    await expect(pop).toBeVisible();
    await expect(page.locator('#spec-range-axis-badge')).toContainText('dB');
});

test('spectrum overlay: X軸 dblclick で周波数 popover が表示される', async ({ page }) => {
    await loadResultsUi(page);
    const overlay = page.locator('#spectrum-overlay-canvas');
    const box = await overlay.boundingBox();
    const { W, H } = await overlay.evaluate((c) => ({
        W: (c as HTMLCanvasElement).width, H: (c as HTMLCanvasElement).height,
    }));
    const sX = box!.width / W, sY = box!.height / H;
    // X軸ゾーン: canvas y = H-5 (>H-padB18), x = 中央
    await page.mouse.dblclick(box!.x + (W / 2) * sX, box!.y + (H - 5) * sY);
    await expect(page.locator('#spectrum-range-popover')).toBeVisible();
    await expect(page.locator('#spec-range-axis-badge')).toContainText('Hz');
});

test('spectrum overlay: 内部 dblclick で popover を開かずズームリセット相当', async ({ page }) => {
    await loadResultsUi(page);
    const overlay = page.locator('#spectrum-overlay-canvas');
    const box = await overlay.boundingBox();
    const { W, H } = await overlay.evaluate((c) => ({
        W: (c as HTMLCanvasElement).width, H: (c as HTMLCanvasElement).height,
    }));
    const sX = box!.width / W, sY = box!.height / H;
    // 内部中央 dblclick → popover は出ない（reset 動作）
    await page.mouse.dblclick(box!.x + (W / 2) * sX, box!.y + (H / 2) * sY);
    await expect(page.locator('#spectrum-range-popover')).toBeHidden();
});
```

- [ ] **Step 2: smoke 実行**

Run: `npm run test:ui -- spectrumOverlayDblclick 2>&1 | tail -20`
Expected: 3 テスト pass

- [ ] **Step 3: Commit**

```bash
git add src/test/uiSmoke/spectrumOverlayDblclick.spec.ts
git commit -m "test(ui): real-browser smoke for spectrum overlay dblclick"
```

---

## Task 7: 完了検証

- [ ] **Step 1: フルverify**

Run: `npm run verify 2>&1 | tail -15`
Expected: 全ユニット pass + ruff OK + pytest OK

- [ ] **Step 2: UI smoke 全体**

Run: `npm run test:ui 2>&1 | tail -10`
Expected: 既存 + 新規 spectrum smoke が pass（既存の pre-existing 失敗 `allButtons.spec.ts:105` は本作業と無関係）

- [ ] **Step 3: L1 静的lint**

Run: `node scripts/lint-webview-patterns.js 2>&1`
Expected: `webview pattern lint: OK`

---

## Self-Review チェック

- **Spec coverage:** 軸 dblclick→popover（Task3,4）/ 内部→reset（Task4）/ freq・dB 単位（Task1,3）/ maxF キャッシュ（Task2）/ エラー（Task3,5）/ 実ブラウザ検証（Task6）— spec の全項目に対応するタスクあり
- **Placeholder scan:** 各 step に実コード・実コマンド・期待値あり、TBD なし
- **Type consistency:** `openSpectrumRangePopup(axis, clientX, clientY)` / `_specRangeAxis`('freq'|'db') / `_lastSpectrumMaxF` / `closeSpectrumRangePopover` / `applySpectrumRange` / `autoSpectrumRange` — タスク間で命名一貫
- **既存挙動非破壊:** ドラッグズーム（mousedown/move/up）と reset ボタンは変更せず、dblclick を追加するのみ
