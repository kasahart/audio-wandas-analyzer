import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';

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
    expect(measurement.paneWidth).toBeCloseTo(expectedPaneWidth(measurement), 1);
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


test('track canvas width follows layout changes without a window resize event', async ({ page }) => {
    await loadUi(page);

    await expect.poll(async () => page.evaluate(() => {
        const wrap = document.getElementById('track-canvas-wrap-0');
        const canvas = document.getElementById('track-canvas-0') as HTMLCanvasElement | null;
        const axis = document.getElementById('track-axis-canvas-0') as HTMLCanvasElement | null;
        if (!wrap || !canvas || !axis) { return false; }
        const expected = Math.max(1, Math.round(wrap.clientWidth - axis.width));
        return Math.abs(canvas.width - expected) <= 1;
    })).toBe(true);

    await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('.track-spectrum-wrap').forEach((el) => {
            el.style.width = '320px';
        });
    });

    await expect.poll(async () => page.evaluate(() => {
        const wrap = document.getElementById('track-canvas-wrap-0');
        const canvas = document.getElementById('track-canvas-0') as HTMLCanvasElement | null;
        const axis = document.getElementById('track-axis-canvas-0') as HTMLCanvasElement | null;
        if (!wrap || !canvas || !axis) { return false; }
        const expected = Math.max(1, Math.round(wrap.clientWidth - axis.width));
        const renderedWidth = Math.round(canvas.getBoundingClientRect().width);
        return Math.abs(canvas.width - expected) <= 1 && Math.abs(renderedWidth - expected) <= 1;
    })).toBe(true);
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
