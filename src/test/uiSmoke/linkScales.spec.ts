import { expect, test, type Page } from './canvasAudit';
import { getStrings } from '../../shared/i18n/strings';
import { buildUiSmokeLoudLastHtml, buildUiSmokeTwoLevelsHtml } from './buildHtml';
import { openRowRange, pointOnLane, pointOnRowAxis, rowFigure, rowRange, ROW_SPECTROGRAM, type RowAxis } from './tracksFigures';


/** The range popover's Min and Max after double-clicking that axis of track `trackIndex`'s row. */
const rangeAt = (page: Page, axis: RowAxis, trackIndex: number): Promise<{ min: string; max: string }> => rowRange(page, axis, trackIndex);

test('linking the scales gives every track the same amplitude and colour scale; unlinking gives each its own again', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(2);
    const link = page.locator('#toolbar [data-action="link-scales"]');
    await expect(link).toHaveAttribute('aria-pressed', 'false');

    const loud = await rangeAt(page, 'amplitude', 0);
    const quiet = await rangeAt(page, 'amplitude', 1);
    expect(Number(quiet.max)).toBeCloseTo(Number(loud.max) / 4, 3);
    expect(await rangeAt(page, 'colour', 1)).toEqual({ min: '-110', max: '-20' });

    await link.click();
    await expect(link).toHaveAttribute('aria-pressed', 'true');
    expect(await rangeAt(page, 'amplitude', 1)).toEqual(loud);
    // Linked, the colours reach the loudest track's top and no more than 100 dB under it (R9), not the quiet one's floor.
    expect(await rangeAt(page, 'colour', 0)).toEqual({ min: '-100', max: '0' });
    expect(await rangeAt(page, 'colour', 1)).toEqual({ min: '-100', max: '0' });

    // A range typed on one track's axis shows on the other in the same values.
    const amplitude = await openRowRange(page, 'amplitude', 1);
    await amplitude.min.fill('-0.5');
    await amplitude.max.fill('0.5');
    await amplitude.apply.click();
    await expect(amplitude.popover).toHaveCount(0);
    expect(await rangeAt(page, 'amplitude', 0)).toEqual({ min: '-0.5', max: '0.5' });

    await link.click();
    await expect(link).toHaveAttribute('aria-pressed', 'false');
    expect(await rangeAt(page, 'colour', 1)).toEqual({ min: '-110', max: '-20' });
});

test('linked, the rows in view share the scale of every recording, also of one far below them whose rows were never drawn', async ({ page }) => {
    // Twenty takes; the last, far below the view, is four times as large as the others and 20 dB up.
    await page.setContent(buildUiSmokeLoudLastHtml(20), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(20);
    await expect(page.locator(rowFigure(19))).toHaveCount(0);
    const quiet = await rangeAt(page, 'amplitude', 0);
    expect(await rangeAt(page, 'colour', 0)).toEqual({ min: '-110', max: '-20' });

    await page.locator('#toolbar [data-action="link-scales"]').click();
    await expect.poll(async () => Number((await rangeAt(page, 'amplitude', 0)).max), { timeout: 15000 }).toBeCloseTo(Number(quiet.max) * 4, 3);
    await expect.poll(() => rangeAt(page, 'colour', 0), { timeout: 15000 }).toEqual({ min: '-100', max: '0' });
    // Of the take below nothing was asked but its extents: its rows are still not drawn.
    await expect(page.locator(rowFigure(19))).toHaveCount(0);
    const asked = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; trackIndex?: number; extents?: boolean }> }).__uiSmokePostedMessages
        .filter(message => message.type === 'request-track-detail' && message.trackIndex === 19).map(message => message.extents === true));
    expect(asked).toEqual([true]);
});

test('a waveform\'s amplitude range can be typed wider than the automatic one, and the other track (the scales not linked) shows the same numbers, as typed', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(2);
    const loud = await rangeAt(page, 'amplitude', 0);
    const quiet = await rangeAt(page, 'amplitude', 1);
    // Twice the quiet track's automatic range, typed on it.
    const wide = Number(quiet.max) * 2;
    const amplitude = await openRowRange(page, 'amplitude', 1);
    await amplitude.min.fill(String(-wide));
    await amplitude.max.fill(String(wide));
    await amplitude.apply.click();
    await expect(amplitude.popover).toHaveCount(0);
    expect(await rangeAt(page, 'amplitude', 1)).toEqual({ min: String(-wide), max: String(wide) });
    // The numbers typed are every row's of that unit, as typed: never the same ratio of each row's own peak.
    expect(await rangeAt(page, 'amplitude', 0)).toEqual({ min: String(-wide), max: String(wide) });
    expect(Number(loud.max)).not.toBeCloseTo(wide, 3);
});

test('the spectrogram frequency axis and colour bar set the range of every track', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(2);
    const frequency = await rangeAt(page, 'frequency', 0);
    expect(frequency.min).toBe('0');

    const band = await openRowRange(page, 'frequency', 0);
    await band.min.fill('500');
    await band.max.fill('2000');
    await band.apply.click();
    await expect(band.popover).toHaveCount(0);
    expect(await rangeAt(page, 'frequency', 1)).toEqual({ min: '500', max: '2000' });

    const colour = await openRowRange(page, 'colour', 1);
    await colour.min.fill('-80');
    await colour.max.fill('-10');
    await colour.apply.click();
    await expect(colour.popover).toHaveCount(0);
    expect(await rangeAt(page, 'colour', 0)).toEqual({ min: '-80', max: '-10' });

    // Auto takes the frequency back to the full range.
    const auto = await openRowRange(page, 'frequency', 1);
    await auto.popover.locator('button[id$="-auto"]').click();
    expect(await rangeAt(page, 'frequency', 0)).toEqual(frequency);
});

test('the colour bar says it sets the colour scale when the pointer is on it', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml(), { waitUntil: 'domcontentloaded' });
    const canvas = page.locator(rowFigure(0));
    const box = (await canvas.boundingBox())!;
    // The colour bar is right of the row's spectrogram, beside it (R13).
    const bar = await pointOnRowAxis(page, 'colour');
    expect(bar.x).toBeGreaterThan(box.x + box.width / 2);
    await page.mouse.move(bar.x, bar.y);
    await expect(page.locator('#hint-footer')).toHaveText(getStrings('en').hintSpectrogramColorbar);
    await expect(canvas).toHaveCSS('cursor', 'pointer');
    // Off the bar the plot reads the time again.
    const inside = await pointOnLane(page, rowFigure(0), ROW_SPECTROGRAM, 0.25, 0.25);
    await page.mouse.move(inside.x, inside.y);
    await expect(canvas).not.toHaveCSS('cursor', 'pointer');
});

test('tracks in another unit keep their own scales when linked', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml('Pa'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(2);
    const quiet = await rangeAt(page, 'amplitude', 1);
    const quietColour = await rangeAt(page, 'colour', 1);
    await page.locator('#toolbar [data-action="link-scales"]').click();
    expect(await rangeAt(page, 'amplitude', 1)).toEqual(quiet);
    expect(await rangeAt(page, 'colour', 1)).toEqual(quietColour);
});

test('a new STFT from ⚙ keeps the lower frequency set on the axis', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml(), { waitUntil: 'domcontentloaded' });
    const band = await openRowRange(page, 'frequency', 0);
    await band.min.fill('500');
    await band.max.fill('2000');
    await band.apply.click();
    await expect(band.popover).toHaveCount(0);
    await page.locator('#toolbar [data-action="spectrogram-settings"]').click();
    await page.locator('#spec-apply').click();
    const display = await page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; settings?: { display: Record<string, unknown> } }> }).__uiSmokePostedMessages;
        return posted.filter((m) => m.type === 'request-reanalyze').at(-1)?.settings?.display;
    });
    expect(display).toMatchObject({ minFrequencyHz: 500, maxFrequencyHz: 2000 });
});
