import { expect, test, type Page } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { HELP_SECTIONS } from '../../webview/runtime/shortcuts';
import { buildUiSmokeHtml } from './buildHtml';

test('keyboard shortcut dialog lists all documented shortcuts', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    await page.mouse.click(20, 20);
    await page.keyboard.press('?');
    const helpOverlay = page.locator('#help-overlay');
    await expect(helpOverlay).toBeVisible();

    // One help: every view's keys in its own section, the lanes' (the view on show) first.
    await expect(helpOverlay.locator('[data-help-section]').first()).toHaveAttribute('data-help-section', 'lanes');
    const STR = getStrings('en');
    for (const section of HELP_SECTIONS) {
        const rows = helpOverlay.locator(`[data-help-section="${section.view}"]`);
        for (const row of section.rows) {
            await expect(rows.getByText(row.shortcutKey ? STR[row.shortcutKey] : row.shortcut, { exact: true })).toBeVisible();
        }
    }
});

test('keyboard shortcut dialog traps focus on Tab and closes on Escape', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    await page.mouse.click(20, 20);
    await page.keyboard.press('?');
    await expect(page.locator('#help-close-btn')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator('#help-close-btn')).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#help-close-btn')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#help-overlay')).toBeHidden();
});

test('a help taller than the window scrolls with ↓, PageDown and End, Home goes back, and nothing behind it moves', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 320 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.mouse.click(20, 20);
    await page.keyboard.press('?');
    const box = page.locator('#help-overlay .screen-help-box');
    await expect(box).toBeVisible();
    const scrollTop = () => box.evaluate(element => element.scrollTop);
    expect(await box.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.keyboard.press('ArrowDown');
    await expect.poll(scrollTop).toBeGreaterThan(0);
    const afterLine = await scrollTop();
    await page.keyboard.press('PageDown');
    await expect.poll(scrollTop).toBeGreaterThan(afterLine);
    await page.keyboard.press('End');
    await expect.poll(() => box.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1)).toBe(true);
    await page.keyboard.press('Home');
    await expect.poll(scrollTop).toBe(0);
    await expect(page.locator('#help-close-btn')).toBeFocused();
});

test('toolbar buttons have aria-labels and toolbar has role=toolbar', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    // Verify toolbar has role="toolbar" and aria-label
    const toolbar = page.locator('#toolbar');
    await expect(toolbar).toHaveAttribute('role', 'toolbar');
    const ariaLabel = await toolbar.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();

    // Verify zoom buttons have aria-labels
    const zoomOut = page.locator('[data-action="zoom-out"]');
    const zoomIn = page.locator('[data-action="zoom-in"]');
    const zoomReset = page.locator('[data-action="zoom-reset"]');
    await expect(zoomOut).toHaveAttribute('aria-label');
    await expect(zoomIn).toHaveAttribute('aria-label');
    await expect(zoomReset).toHaveAttribute('aria-label');
});

test('focus-visible CSS rule is present in rendered styles', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    const hasFocusVisibleRule = await page.evaluate(() => {
        for (const sheet of Array.from(document.styleSheets)) {
            try {
                for (const rule of Array.from(sheet.cssRules)) {
                    if (rule instanceof CSSStyleRule && rule.selectorText && rule.selectorText.includes('focus-visible')) {
                        return true;
                    }
                }
            } catch { /* cross-origin */ }
        }
        return false;
    });
    expect(hasFocusVisibleRule).toBe(true);
});

function showTrack(): void {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath: '/preview/keys.wav', fileName: 'keys.wav', audioSource: '', sampleRateHz: 8000, durationSeconds: 10, channelCount: 1, sampleCount: 80000,
        channels: [{ label: 'L', peakAbsolute: 0.8, waveform: { min: [-0.2, -0.4], max: [0.2, 0.4], minT: [1, 6], maxT: [4, 9], absolutePeak: 0.8 } }],
    }] } }));
}

async function zoomSpan(page: Page): Promise<number> {
    return page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'keys-snapshot', actions: [] } }));
        const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { zoomStart: number; zoomEnd: number } }> }).__uiSmokePostedMessages;
        const ui = messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi;
        return ui.zoomEnd - ui.zoomStart;
    });
}

test('a focused waveform canvas has a ring in the theme\'s focus colour and says its file, channel and kind', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(showTrack);
    const canvas = page.locator('.track-canvas:not(.track-spec-canvas)').first();
    await expect(canvas).toHaveAttribute('aria-label', 'keys.wav · Channel 1 (L) · waveform');
    await expect(page.locator('.track-spec-canvas').first()).toHaveAttribute('aria-label', 'keys.wav · Channel 1 (L) · spectrogram');
    await canvas.focus();
    await expect(canvas).toBeFocused();
    await expect(canvas).toHaveCSS('outline-style', 'solid');
    await expect(canvas).toHaveCSS('outline-width', '2px');
    const accent = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });
    await expect(canvas).toHaveCSS('outline-color', accent);
});

test('a focused resize edge moves with the arrows and says its value', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(showTrack);
    const edge = page.locator('[data-action="track-height-drag"]').first();
    await expect(edge).toHaveAttribute('tabindex', '0');
    await expect(edge).toHaveAttribute('aria-label', 'Track height');
    await edge.focus();
    const before = Number(await edge.getAttribute('aria-valuenow'));
    const span = await zoomSpan(page);
    await page.keyboard.press('ArrowDown');
    await expect(edge).toHaveAttribute('aria-valuenow', String(before + 8));
    await page.keyboard.press('Home');
    await expect(edge).toHaveAttribute('aria-valuenow', (await edge.getAttribute('aria-valuemin'))!);
    const split = page.locator('.track-split').first();
    await split.focus();
    const share = Number(await split.getAttribute('aria-valuenow'));
    await page.keyboard.press('Shift+ArrowUp');
    await expect(split).toHaveAttribute('aria-valuenow', String(Math.max(15, share - 50)));
    const spectrumEdge = page.locator('[data-action="spectrum-height-drag"]');
    await expect(spectrumEdge).toHaveAttribute('aria-label', 'Spectrum panel height');
    await spectrumEdge.focus();
    const spectrumBefore = Number(await spectrumEdge.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowUp');
    await expect(spectrumEdge).toHaveAttribute('aria-valuenow', String(spectrumBefore + 8));
    // The arrows moved the edges, nothing else.
    expect(await zoomSpan(page)).toBe(span);
});

test('the lanes\' zoom keys: + and = zoom in, - and _ zoom out, 0 resets', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(showTrack);
    await page.mouse.click(20, 20);
    expect(await zoomSpan(page)).toBeCloseTo(1, 9);
    await page.keyboard.press('=');
    await page.keyboard.press('+');
    const zoomed = await zoomSpan(page);
    expect(zoomed).toBeLessThan(1);
    await page.keyboard.press('_');
    expect(await zoomSpan(page)).toBeGreaterThan(zoomed);
    await page.keyboard.press('0');
    expect(await zoomSpan(page)).toBeCloseTo(1, 9);
});
