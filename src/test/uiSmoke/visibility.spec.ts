import { expect, test, type Page } from './canvasAudit';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';
import { drawnFigure, drawnRow } from './tracksFigures';


async function loadUi(page: Page) {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.mouse.click(20, 20);
}

async function openHelp(page: Page) {
    await page.keyboard.press('?');
}

type SelectionLayoutMeasurement = {
    bodyWidth: number;
    sidebarWidth: number;
    resizerWidth: number;
    paneWidth: number;
};

async function loadSelectionUi(page: Page, viewportWidth: number) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
}

function expectedPaneWidth(measurement: SelectionLayoutMeasurement): number {
    return measurement.bodyWidth - measurement.sidebarWidth - measurement.resizerWidth;
}

function expectPaneFillsRemainingWidth(measurement: SelectionLayoutMeasurement) {
    expect(Math.abs(measurement.paneWidth - expectedPaneWidth(measurement))).toBeLessThanOrEqual(2);
}

test('help overlay opens with ? and starts hidden', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await expect(helpOverlay).toBeHidden();

    await openHelp(page);
    await expect(helpOverlay).toBeVisible();
    await expect(helpOverlay).toHaveCSS('display', 'flex');
});

test('help overlay closes when ? is pressed again', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await openHelp(page);
    await expect(helpOverlay).toBeVisible();

    await openHelp(page);
    await expect(helpOverlay).toBeHidden();
});

test('the footer button opens the help, which starts with the three-step flow', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    const button = page.locator('#app-footer #help-open-btn');
    await expect(button).toBeVisible();
    await button.click();
    await expect(helpOverlay).toBeVisible();
    await expect(helpOverlay.locator('[data-screen-help-flow] li')).toHaveCount(3);
    await expect(page.locator('#help-close-btn')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(helpOverlay).toBeHidden();
    // The press does not take the focus: it stays with what had it before.
    await expect(button).not.toBeFocused();
});

test('help overlay closes with Escape', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await openHelp(page);
    await expect(helpOverlay).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(helpOverlay).toBeHidden();
});

test('help overlay closes with the close button', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await openHelp(page);
    await expect(helpOverlay).toBeVisible();

    await page.locator('#help-close-btn').click({ force: true });
    await expect(helpOverlay).toBeHidden();
});

test('help overlay closes when the backdrop is clicked', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await openHelp(page);
    await expect(helpOverlay).toBeVisible();

    await helpOverlay.click({ position: { x: 8, y: 8 }, force: true });
    await expect(helpOverlay).toBeHidden();
});



test('results preview does not render the bottom metrics legend', async ({ page }) => {
    await loadUi(page);

    await expect(page.locator('#metrics-bar')).toHaveCount(0);
    await expect(page.locator('.metrics-item')).toHaveCount(0);
});

test('the cursor spectrum supports keyboard readout without hover, and track rows carry no spectrum', async ({ page }) => {
    await loadUi(page);

    await expect(page.locator('.track-spectrum-canvas, .track-spectrum-wrap')).toHaveCount(0);
    const overlay = page.locator('#spectrum-overlay-plot canvas');
    await expect(overlay).toHaveAttribute('tabindex', '0');

    // Focused from the keyboard, with no pointer on it: the first → reads a point, the next steps from it (R7).
    await drawnFigure(page);
    await overlay.focus();
    await page.keyboard.press('ArrowRight');
    const readout = page.locator('#spectrum-freq-readout');
    await expect(readout).toContainText(/\.wav.*Hz.*dB/);
    const first = await readout.innerText();
    await page.keyboard.press('ArrowRight');
    await expect(readout).not.toHaveText(first);
});

test('a row\'s Figure follows layout changes without a window resize event', async ({ page }) => {
    await loadUi(page);
    await drawnRow(page);
    // The canvas's bitmap is its box's size (in device px), and its box fills the row's.
    const fits = (): Promise<boolean> => page.evaluate(() => {
        const host = document.getElementById('track-row-figure-0');
        const canvas = host?.querySelector<HTMLCanvasElement>('canvas[data-figure]');
        if (!host || !canvas) { return false; }
        const shown = canvas.getBoundingClientRect().width;
        return Math.abs(shown - host.clientWidth) <= 1 && Math.abs(canvas.width - Math.round(shown * window.devicePixelRatio)) <= 1;
    });
    await expect.poll(fits).toBe(true);
    const before = await page.locator('#track-row-figure-0').evaluate(el => el.clientWidth);

    await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('.track-canvas-stack').forEach((el) => {
            el.style.marginRight = '320px';
        });
    });

    await expect.poll(() => page.locator('#track-row-figure-0').evaluate(el => el.clientWidth)).toBeLessThan(before - 300);
    await expect.poll(fits).toBe(true);
    // The plot inside it is narrower too, once the picture for the new width is drawn.
    await expect.poll(async () => { const lane = (await drawnRow(page)).lanes[0].frame; return lane.left + lane.width; }).toBeLessThanOrEqual(before - 300);
});

test('directory selection results pane flexes with viewport width', async ({ page }) => {
    await loadSelectionUi(page, 1600);

    const measure = async (): Promise<SelectionLayoutMeasurement> => page.evaluate(() => {
        const body = document.getElementById('selection-body');
        const sidebar = document.getElementById('selection-sidebar');
        const resizer = document.getElementById('tree-resizer');
        const pane = document.getElementById('selection-results-pane');
        if (!body || !sidebar || !resizer || !pane) {
            throw new Error('selection layout elements are missing');
        }
        return {
            bodyWidth: body.getBoundingClientRect().width,
            sidebarWidth: sidebar.getBoundingClientRect().width,
            resizerWidth: resizer.getBoundingClientRect().width,
            paneWidth: pane.getBoundingClientRect().width,
        };
    });

    const initial = await measure();
    expectPaneFillsRemainingWidth(initial);

    await page.setViewportSize({ width: 1800, height: 900 });
    await expect.poll(async () => {
        const resized = await measure();
        return resized.paneWidth - initial.paneWidth;
    }).toBeGreaterThan(150);

    const resized = await measure();
    expectPaneFillsRemainingWidth(resized);
});
