import { expect, test } from './canvasAudit';
import { buildUiSmokeHtml } from './buildHtml';

test('the pointer on a track\'s waveform reads the point nearest it as every plot of lines does: name, time and amplitude in the toolbar, gone off the lane (R7)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const lane = page.locator('.track-canvas:not(.track-spec-canvas)').first();
    const box = await lane.boundingBox();
    if (!box) throw new Error('waveform lane has no layout box');
    const readout = page.locator('#plot-readout:not([hidden])');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(readout).toHaveCount(1);
    await expect(readout).toHaveText(/^.+ \/ −?\d+\.\d+ s \/ −?[\d.]+/);
    // Shown in the toolbar beside the cursor's time, never over the waveform it reads.
    await expect(page.locator('#toolbar #plot-readout:not([hidden])')).toHaveCount(1);
    const readoutBox = await readout.boundingBox();
    if (!readoutBox) throw new Error('readout has no layout box');
    expect(readoutBox.y + readoutBox.height <= box.y || readoutBox.y >= box.y + box.height).toBe(true);
    // The time shown in the toolbar is the point read, not the pointer beside it.
    const readSeconds = Number(/ \/ (\d+\.\d+) s \//.exec((await readout.textContent()) ?? '')?.[1]);
    const [minutes, rest] = ((await page.locator('#cursor-display').textContent()) ?? '').split(':');
    expect(Math.abs(Number(minutes) * 60 + Number(rest) - readSeconds)).toBeLessThan(0.006);
    // On the spectrogram below it, no readout: an image has the cursor alone.
    const spectrogram = page.locator('.track-spec-canvas').first();
    const specBox = await spectrogram.boundingBox();
    if (!specBox) throw new Error('spectrogram lane has no layout box');
    await page.mouse.move(specBox.x + specBox.width / 2, specBox.y + specBox.height / 2);
    await expect(readout).toHaveCount(0);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(readout).toHaveCount(1);
    // Onto the lane's amplitude axis, still among the tracks: gone.
    await page.locator('.track-axis-canvas').first().hover();
    await expect(readout).toHaveCount(0);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(readout).toHaveCount(1);
    await page.mouse.move(0, 0);
    await expect(readout).toHaveCount(0);
});

test('the lane readout keeps its room in the toolbar, so a hover never wraps it and moves the lanes; short of room, the name is cut, never the values', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const lane = page.locator('.track-canvas:not(.track-spec-canvas)').first();
    const box = await lane.boundingBox();
    if (!box) throw new Error('waveform lane has no layout box');
    const toolbarHeight = (await page.locator('#toolbar').boundingBox())?.height;
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await expect(page.locator('#plot-readout:not([hidden])')).toHaveCount(1);
    expect((await page.locator('#toolbar').boundingBox())?.height).toBe(toolbarHeight);
    expect((await lane.boundingBox())?.y).toBe(box.y);
    const values = page.locator('#plot-readout .plot-readout-values');
    await expect(values).toHaveText(/^( \/ )?−?\d+\.\d+ s \/ −?[\d.]+/);
    expect(await values.evaluate(el => el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right + 0.5)).toBe(true);
});

test('every ui-smoke test fails on a hover readout shown over a plot, whichever plot and readout it is (R7)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const lane = page.locator('.track-canvas:not(.track-spec-canvas)').first();
    const box = await lane.boundingBox();
    if (!box) throw new Error('waveform lane has no layout box');
    // A readout laid over a lane, as a plot's own floating box would be: the audit names it.
    await page.evaluate(({ x, y }) => {
        const stray = document.createElement('div');
        stray.className = 'stray-readout';
        stray.textContent = 'a.wav / 1.00 s / 0.1';
        Object.assign(stray.style, { position: 'fixed', left: `${x}px`, top: `${y}px` });
        document.body.append(stray);
    }, { x: box.x + 20, y: box.y + 4 });
    await expect.poll(() => page.evaluate(() => window.__readoutAudit ?? [])).toEqual([expect.stringMatching(/^\.stray-readout over #track-canvas-0 /)]);
    // Taken away before the test ends, so this test itself passes the audit's check.
    await page.evaluate(() => { document.querySelector('.stray-readout')?.remove(); window.__readoutAudit?.splice(0); });
});
