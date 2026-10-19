import { expect, test, type Page } from '@playwright/test';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';

interface PostedMessage {
    type: string;
    reference?: { filePath: string; channelIndex: number };
    responses?: Array<{ filePath: string; channelIndex: number }>;
}

function pairRequests(page: Page): Promise<PostedMessage[]> {
    return page.evaluate(() => ((window as typeof window & { __uiSmokePostedMessages: PostedMessage[] }).__uiSmokePostedMessages)
        .filter(message => message && message.type === 'request-pair-spectrum'));
}

test('a reference lane splits the spectrum section into the power spectrum and the pair view', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const buttons = page.locator('[data-action="set-pair-reference"]');
    await expect(buttons.first()).toBeVisible();
    await expect(page.locator('#pair-spectrum-wrap')).toBeHidden();

    await page.locator('[data-action="spectrum-octave-3"]').click();
    await expect(page.locator('[data-action="spectrum-octave-3"]')).toHaveAttribute('aria-pressed', 'true');

    await buttons.first().click();
    await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(buttons.first().locator('.pair-ref-badge')).toBeVisible();
    await expect(page.locator('#pair-spectrum-wrap')).toBeVisible();
    // The pair view has only an FFT axis, so the octave bands give way to it.
    await expect(page.locator('[data-action="spectrum-fft"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-action="spectrum-octave-1"]')).toBeDisabled();
    await expect(page.locator('[data-action="spectrum-octave-3"]')).toBeDisabled();

    await expect.poll(async () => (await pairRequests(page)).length).toBe(1);
    const [request] = await pairRequests(page);
    const laneCount = await buttons.count();
    expect(request.responses?.length).toBe(laneCount - 1);
    expect(request.responses?.some(source => source.filePath === request.reference?.filePath && source.channelIndex === request.reference?.channelIndex)).toBe(false);

    await expect(page.locator('#pair-spectrum-summary')).toHaveText(/^H1 · \d+ avg · \d+\.\d\d–\d+\.\d\d s$/u);
    await expect(page.locator('.pair-legend-item')).toHaveCount(laneCount - 1);

    const canvas = page.locator('#pair-spectrum-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('pair canvas has no layout box');
    expect(box.height).toBeGreaterThan(60);
    const pixels = (id: string) => page.evaluate(selector => (document.querySelector(selector) as HTMLCanvasElement).toDataURL(), id);
    const powerBefore = await pixels('#spectrum-overlay-canvas');
    // Hovering a lane reads only the line nearest the pointer, in that lane's unit, without asking the host again.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#pair-spectrum-readout')).toHaveText(/ Hz \/ -?\d+°$/u);
    // The power spectrum follows the pair plot's cursor frequency with a vertical line, and the other way round.
    await expect.poll(() => pixels('#spectrum-overlay-canvas')).not.toBe(powerBefore);
    await expect(page.locator('#spectrum-freq-readout')).toHaveText('');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 40);
    await expect(page.locator('#pair-spectrum-readout')).toHaveText('');
    const pairIdle = await pixels('#pair-spectrum-canvas');
    const overlay = await page.locator('#spectrum-overlay-canvas').boundingBox();
    if (!overlay) throw new Error('power spectrum canvas has no layout box');
    await page.mouse.move(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2);
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/ \/ \d+(\.\d)? Hz \/ .* dB$/u);
    await expect.poll(() => pixels('#pair-spectrum-canvas')).not.toBe(pairIdle);
    await expect(page.locator('#pair-spectrum-readout')).toHaveText('');
    // Both readouts sit at the right end of their own half's header row.
    const readoutRight = async (id: string, pane: string) => {
        const [readout, half] = await Promise.all([page.locator(id).boundingBox(), page.locator(pane).boundingBox()]);
        return Math.round((half!.x + half!.width) - (readout!.x + readout!.width));
    };
    await page.mouse.move(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2);
    const powerRight = await readoutRight('#spectrum-freq-readout', '#spectrum-overlay-wrap');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#pair-spectrum-readout')).not.toHaveText('');
    expect(await readoutRight('#pair-spectrum-readout', '#pair-spectrum-wrap')).toBe(powerRight);
    const track = page.locator('.track-canvas').first();
    const trackBox = await track.boundingBox();
    if (!trackBox) throw new Error('track canvas has no layout box');
    await page.mouse.click(trackBox.x + trackBox.width * 0.7, trackBox.y + trackBox.height / 2);
    await page.waitForTimeout(400);
    expect((await pairRequests(page)).length).toBe(1);

    // Dragging the divider moves the split.
    const overlayWidth = async () => (await page.locator('#spectrum-overlay-wrap').boundingBox())?.width ?? 0;
    const before = await overlayWidth();
    const divider = await page.locator('#pair-divider').boundingBox();
    if (!divider) throw new Error('pair divider has no layout box');
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x - 150, divider.y + divider.height / 2);
    await page.mouse.up();
    expect(await overlayWidth()).toBeLessThan(before - 100);

    await buttons.first().click();
    await expect(page.locator('#pair-spectrum-wrap')).toBeHidden();
    await expect(page.locator('[data-action="spectrum-octave-3"]')).toBeEnabled();
});
