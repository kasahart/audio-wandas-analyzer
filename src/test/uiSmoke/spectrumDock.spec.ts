import { expect, test, type Page } from './canvasAudit';
import { buildExtensionHostPathUiSmokeHtml, buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';

async function expectSpectrumDockedAboveFooter(page: Page): Promise<void> {
    const section = await page.locator('#spectrum-section').boundingBox();
    const footer = await page.locator('#app-footer').boundingBox();
    if (!section || !footer) throw new Error('spectrum section or footer has no layout box');
    expect(Math.round(section.y + section.height)).toBe(Math.round(footer.y));
}

test('the power spectrum is docked at the bottom, above the hint footer', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expectSpectrumDockedAboveFooter(page);

    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    await expectSpectrumDockedAboveFooter(page);
});

test('dragging the spectrum top edge up makes it taller and down makes it shorter', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const handle = page.locator('[data-action="spectrum-height-drag"]');
    const canvas = page.locator('#spectrum-overlay-canvas');
    const handleBox = await handle.boundingBox();
    const sectionBox = await page.locator('#spectrum-section').boundingBox();
    if (!handleBox || !sectionBox) throw new Error('spectrum handle has no layout box');
    expect(Math.abs(handleBox.y + handleBox.height / 2 - sectionBox.y)).toBeLessThanOrEqual(1);

    const x = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    const before = (await canvas.boundingBox())!.height;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 40, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBe(before + 40);
    const grownTop = (await page.locator('#spectrum-section').boundingBox())!.y;
    expect(Math.round(grownTop)).toBe(Math.round(sectionBox.y - 40));
    await expectSpectrumDockedAboveFooter(page);

    const grownHandle = (await handle.boundingBox())!;
    const y2 = grownHandle.y + grownHandle.height / 2;
    await page.mouse.move(x, y2);
    await page.mouse.down();
    await page.mouse.move(x, y2 + 30, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBe(before + 10);
});

test('the spectrum gear opens the shared frequency-analysis settings above itself', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const gear = page.locator('#spectrum-zoom-toolbar [data-action="spectrum-settings"]');
    const popover = page.locator('#spec-settings-popover');
    await gear.click();
    await expect(popover).toBeVisible();
    const gearBox = (await gear.boundingBox())!;
    const popoverBox = (await popover.boundingBox())!;
    expect(popoverBox.y).toBeGreaterThanOrEqual(0);
    expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(gearBox.y);
    await expect(page.locator('#spec-nfft')).toBeVisible();

    await page.locator('#spec-apply').click();
    await expect(popover).toBeHidden();
    await expect(page.locator('#reanalyze-overlay')).toBeVisible();
});

test('in a short Webview the settings popover stays on screen and Apply is reachable', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 500 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.locator('#spectrum-zoom-toolbar [data-action="spectrum-settings"]').click();
    const popover = page.locator('#spec-settings-popover');
    await expect(popover).toBeVisible();
    const box = (await popover.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(500);
    await page.locator('#spec-apply').click();
    await expect(popover).toBeHidden();
});

test('a cursor spectrum request left unanswered by a replaced analysis does not block the next one', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    // This host never answers spectrum requests, like a host whose source was cleared mid-request.
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const sliceRequests = (): Promise<number> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type?: string }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'request-spectrum-slice').length);
    await expect.poll(sliceRequests).toBeGreaterThan(0);

    await page.evaluate(() => {
        const appWindow = window as unknown as { __APP_STATE__: { results: unknown[] }; __uiSmokePostedMessages: unknown[] };
        appWindow.__uiSmokePostedMessages = [];
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: appWindow.__APP_STATE__.results } }));
    });
    const box = await page.locator('#track-canvas-0').boundingBox();
    if (!box) throw new Error('track canvas has no layout box');
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
    await expect.poll(sliceRequests).toBeGreaterThan(0);
});

test('the cursor spectrum zoomed in asks for its slices at full resolution, so the range on screen is drawn again from every bin (R3)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const plot = page.locator('#spectrum-overlay-canvas');
    await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe('');
    // The slices drawn; a read of every bin (`read`: the readout's numbers and the lines' order, R7 and R6) is not one.
    const asked = (): Promise<boolean[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; fullResolution?: boolean; read?: boolean }> }).__uiSmokePostedMessages
        .filter(message => message.type === 'request-spectrum-slice' && !message.read).map(message => !!message.fullResolution));
    // The whole spectrum: its thinned rows are enough.
    await expect.poll(async () => (await asked()).length).toBeGreaterThan(0);
    expect((await asked()).every(full => !full)).toBe(true);
    const box = (await plot.boundingBox())!;
    const pointer = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.5 };
    await page.mouse.move(pointer.x, pointer.y);
    // The frequency under the pointer, as the readout writes it: a line one bin wide is put there in the answers at full
    // resolution (buildHtml's __uiSmokeSpikeHz), which the 192 points drawn so far do not have.
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/Hz/u);
    const read = /([\d.]+) (k?)Hz/u.exec(await page.locator('#spectrum-freq-readout').innerText())!;
    const hz = Number(read[1]) * (read[2] ? 1000 : 1);
    await page.evaluate(hz => { (window as unknown as { __uiSmokeSpikeHz: number }).__uiSmokeSpikeHz = hz; }, hz);
    /**
     * The highest point (smallest y, CSS px) the drawn spectrum lines reach within 4 px of the pointer, or the plot's
     * floor where no part of them is on the plot there. The lines are the colours that draw long strokes (gridlines
     * are two points), every run of those colours: a line is clipped where it leaves the plot (R2), so a stretch under
     * the axis is cut off and a spike over it is a short run of its own.
     */
    const peakNearPointer = (): Promise<number> => plot.evaluate((canvas, x) => {
        const drawn = (canvas as HTMLCanvasElement & { __plotDrawn?: { strokes: Array<{ color: string; points: Array<[number, number]> }> } }).__plotDrawn;
        const strokes = drawn?.strokes ?? [];
        const colours = new Set(strokes.filter(stroke => stroke.points.length >= 10).map(stroke => stroke.color));
        const [, top, , height] = (canvas.dataset.plotFrame ?? '').split(' ').map(Number);
        const floor = top + height;
        return Math.min(floor, ...strokes.filter(stroke => colours.has(stroke.color)).flatMap(stroke => stroke.points.filter(([px]) => Math.abs(px - x) <= 4).map(([, py]) => py)));
    }, pointer.x - box.x);
    const before = await peakNearPointer();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -480);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await asked()).at(-1)).toBe(true);
    // Drawn again from every bin: the line one bin wide is on the plot, far above what the 192 points reached there.
    await expect.poll(peakNearPointer).toBeLessThan(before - 20);
});
