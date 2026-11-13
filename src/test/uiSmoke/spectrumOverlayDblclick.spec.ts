import { expect, settled, test, type Page } from './canvasAudit';
import { buildUiSmokeHtml } from './buildHtml';

/**
 * The cursor spectrum's double-click, in a real Chromium (docs/display-rules.md R13): on the level axis (the plot's
 * left margin) it opens that axis's range, on the frequency axis (its bottom margin) the frequency range, and inside
 * the plot it only gives the whole back (the zoom reset), opening no range.
 *
 * Where to press comes from the frame the plot component painted (data-plot-frame: left, top, width, height in CSS
 * pixels on the canvas), never from margins written here, so a change of the margins moves the presses with them.
 * Each wait is for the page to have answered (canvasAudit's settled), never a fixed time.
 *
 * These were test.fixme until #790: page.setContent of the self-contained page was said to stall before
 * domcontentloaded. That no longer happens (plotContract.spec.ts loads the same page the same way on every run), so
 * they run; the jsdom tests in renderScript.integration.test.ts ("spectrum overlay:") hold the same handlers' state.
 */

const FULL = '0.000 1.000 0.000 1.000';
/** What the plot shows, as fractions of its whole (data-plot-window, written by the plot gestures; none yet is the whole). */
const shown = async (page: Page): Promise<string> => (await page.locator('#spectrum-overlay-canvas').getAttribute('data-plot-window')) ?? FULL;

/** The plot's frame (CSS pixels on the canvas) and the canvas's place and height on the screen. */
interface Frame { left: number; top: number; width: number; height: number; x: number; y: number; canvasHeight: number }

/** The comparison page with its cursor spectrum drawn and settled, and where its frame is on the screen. */
async function loadSpectrum(page: Page): Promise<Frame> {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const overlay = page.locator('#spectrum-overlay-canvas');
    await expect(overlay).toBeVisible();
    await expect.poll(() => overlay.getAttribute('data-plot-frame')).toMatch(/^\S+ \S+ \S+ \S+$/u);
    await settled(page);
    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    const [left, top, width, height] = ((await overlay.getAttribute('data-plot-frame')) ?? '').split(' ').map(Number);
    expect([left, top, width, height].every(Number.isFinite) && left > 4 && width > 0 && height > 0 && box!.height - top - height > 4).toBe(true);
    expect(await shown(page)).toBe(FULL);
    return { left, top, width, height, x: box!.x, y: box!.y, canvasHeight: box!.height };
}

/** The range popover is open for the axis named `unit`, prefilled with bounds it can apply. */
async function expectRangeOpen(page: Page, unit: string): Promise<void> {
    const popover = page.locator('#spectrum-range-popover');
    await expect(popover).toBeVisible();
    await expect(page.locator('#spec-range-axis-badge')).toContainText(unit);
    const low = Number(await page.locator('#spec-range-min').inputValue());
    const high = Number(await page.locator('#spec-range-max').inputValue());
    expect(Number.isFinite(low) && Number.isFinite(high) && high > low, `prefilled ${low} … ${high}`).toBe(true);
}

test('spectrum overlay: Y軸 dblclick で範囲 popover が表示される', async ({ page }) => {
    const frame = await loadSpectrum(page);
    // The middle of the left margin, half way up the frame.
    await page.mouse.dblclick(frame.x + frame.left / 2, frame.y + frame.top + frame.height / 2);
    await settled(page);
    await expectRangeOpen(page, 'dB');
});

test('spectrum overlay: X軸 dblclick で周波数 popover が表示される', async ({ page }) => {
    const frame = await loadSpectrum(page);
    // The middle of the frame's width, half way down the bottom margin (the frequency axis's ticks).
    await page.mouse.dblclick(frame.x + frame.left + frame.width / 2, frame.y + (frame.top + frame.height + frame.canvasHeight) / 2);
    await settled(page);
    await expectRangeOpen(page, 'Hz');
});

test('spectrum overlay: 内部 dblclick で popover を開かずズームリセット相当', async ({ page }) => {
    const frame = await loadSpectrum(page);
    const middle = { x: frame.x + frame.left + frame.width / 2, y: frame.y + frame.top + frame.height / 2 };
    // Zoomed in first (Ctrl+wheel inside the plot), so the double-click has a zoom to reset.
    await page.mouse.move(middle.x, middle.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await settled(page);
    expect(await shown(page)).not.toBe(FULL);
    await page.mouse.dblclick(middle.x, middle.y);
    await settled(page);
    expect(await shown(page)).toBe(FULL);
    await expect(page.locator('#spectrum-range-popover')).toBeHidden();
});
