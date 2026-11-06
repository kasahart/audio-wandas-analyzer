import { expect, test } from './canvasAudit';
import { buildUiSmokeHtml } from './buildHtml';

test('the pointer on a track\'s waveform reads the point nearest it as every plot of lines does: name, time and amplitude in the toolbar, gone off the lane (R7)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const lane = page.locator('.track-canvas:not(.track-spec-canvas)').first();
    const box = await lane.boundingBox();
    if (!box) throw new Error('waveform lane has no layout box');
    const readout = page.locator('.track-lane-readout:not([hidden])');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(readout).toHaveCount(1);
    await expect(readout).toHaveText(/^.+ \/ −?\d+\.\d+ s \/ −?[\d.]+/);
    // Shown in the toolbar beside the cursor's time, never over the waveform it reads.
    await expect(page.locator('#toolbar .track-lane-readout:not([hidden])')).toHaveCount(1);
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
