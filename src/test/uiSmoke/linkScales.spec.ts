import { expect, test, type Page } from './canvasAudit';
import { getStrings } from '../../shared/i18n/strings';
import { buildUiSmokeTwoLevelsHtml } from './buildHtml';
import { colourBarAt } from './colourBar';

/** The range popover's Min and Max after double-clicking `selector` of track `trackIndex` (on its colour bar if asked). */
async function rangeAt(page: Page, selector: string, trackIndex: number, colourBar = false): Promise<{ min: string; max: string }> {
    const target = page.locator('#track-row-' + trackIndex + ' ' + selector).first();
    if (colourBar) {
        await expect(target).toHaveAttribute('data-colour-bar', /\d/);
        await target.dblclick({ position: await colourBarAt(target) });
    }
    else {
        await target.dblclick();
    }
    await expect(page.locator('#waveform-range-popover')).toBeVisible();
    const range = { min: await page.locator('#wave-range-min').inputValue(), max: await page.locator('#wave-range-max').inputValue() };
    await page.keyboard.press('Escape');
    await expect(page.locator('#waveform-range-popover')).toBeHidden();
    return range;
}

const AMPLITUDE_AXIS = '.track-axis-canvas:not(.track-spec-axis)';

test('linking the scales gives every track the same amplitude and colour scale; unlinking gives each its own again', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(2);
    const link = page.locator('#toolbar [data-action="link-scales"]');
    await expect(link).toHaveAttribute('aria-pressed', 'false');

    const loud = await rangeAt(page, AMPLITUDE_AXIS, 0);
    const quiet = await rangeAt(page, AMPLITUDE_AXIS, 1);
    expect(Number(quiet.max)).toBeCloseTo(Number(loud.max) / 4, 3);
    expect(await rangeAt(page, '.track-spec-canvas', 1, true)).toEqual({ min: '-110', max: '-20' });

    await link.click();
    await expect(link).toHaveAttribute('aria-pressed', 'true');
    expect(await rangeAt(page, AMPLITUDE_AXIS, 1)).toEqual(loud);
    expect(await rangeAt(page, '.track-spec-canvas', 0, true)).toEqual({ min: '-110', max: '0' });
    expect(await rangeAt(page, '.track-spec-canvas', 1, true)).toEqual({ min: '-110', max: '0' });

    // A range typed on one track's axis shows on the other in the same values.
    await page.locator('#track-row-1 ' + AMPLITUDE_AXIS).first().dblclick();
    await page.locator('#wave-range-min').fill('-0.5');
    await page.locator('#wave-range-max').fill('0.5');
    await page.locator('#wave-range-apply').click();
    expect(await rangeAt(page, AMPLITUDE_AXIS, 0)).toEqual({ min: '-0.5', max: '0.5' });

    await link.click();
    await expect(link).toHaveAttribute('aria-pressed', 'false');
    expect(await rangeAt(page, '.track-spec-canvas', 1, true)).toEqual({ min: '-110', max: '-20' });
});

test('the spectrogram frequency axis and colour bar set the range of every track', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(2);
    const frequency = await rangeAt(page, '.track-spec-axis', 0);
    expect(frequency.min).toBe('0');

    await page.locator('#track-row-0 .track-spec-axis').first().dblclick();
    await page.locator('#wave-range-min').fill('500');
    await page.locator('#wave-range-max').fill('2000');
    await page.locator('#wave-range-apply').click();
    await expect(page.locator('#waveform-range-popover')).toBeHidden();
    expect(await rangeAt(page, '.track-spec-axis', 1)).toEqual({ min: '500', max: '2000' });

    const colourBar = page.locator('#track-row-1 .track-spec-canvas').first();
    await colourBar.dblclick({ position: await colourBarAt(colourBar) });
    await page.locator('#wave-range-min').fill('-80');
    await page.locator('#wave-range-max').fill('-10');
    await page.locator('#wave-range-apply').click();
    expect(await rangeAt(page, '.track-spec-canvas', 0, true)).toEqual({ min: '-80', max: '-10' });

    // Auto takes the frequency back to the full range.
    await page.locator('#track-row-1 .track-spec-axis').first().dblclick();
    await page.locator('#wave-range-auto').click();
    expect(await rangeAt(page, '.track-spec-axis', 0)).toEqual(frequency);
});

test('the colour bar says it sets the colour scale when the pointer is on it', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml(), { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('#track-row-0 .track-spec-canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no spectrogram box');
    await expect(canvas).toHaveAttribute('data-colour-bar', /\d/);
    // The colour bar is the one every coloured picture draws, in the plot's top right (R13).
    const bar = await colourBarAt(canvas);
    expect(bar.x).toBeGreaterThan(box.width / 2);
    expect(bar.y).toBeLessThan(box.height / 2);
    await page.mouse.move(box.x + bar.x, box.y + bar.y);
    await expect(page.locator('#hint-footer')).toHaveText(getStrings('en').hintSpectrogramColorbar);
    await expect(canvas).toHaveCSS('cursor', 'pointer');
    // Off the bar the plot reads the time again.
    await page.mouse.move(box.x + box.width / 4, box.y + box.height * 0.75);
    await expect(canvas).not.toHaveCSS('cursor', 'pointer');
});

test('tracks in another unit keep their own scales when linked', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml('Pa'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(2);
    const quiet = await rangeAt(page, AMPLITUDE_AXIS, 1);
    const quietColour = await rangeAt(page, '.track-spec-canvas', 1, true);
    await page.locator('#toolbar [data-action="link-scales"]').click();
    expect(await rangeAt(page, AMPLITUDE_AXIS, 1)).toEqual(quiet);
    expect(await rangeAt(page, '.track-spec-canvas', 1, true)).toEqual(quietColour);
});

test('a new STFT from ⚙ keeps the lower frequency set on the axis', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoLevelsHtml(), { waitUntil: 'domcontentloaded' });
    await page.locator('#track-row-0 .track-spec-axis').first().dblclick();
    await page.locator('#wave-range-min').fill('500');
    await page.locator('#wave-range-max').fill('2000');
    await page.locator('#wave-range-apply').click();
    await page.locator('#toolbar [data-action="spectrogram-settings"]').click();
    await page.locator('#spec-apply').click();
    const display = await page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; settings?: { display: Record<string, unknown> } }> }).__uiSmokePostedMessages;
        return posted.filter((m) => m.type === 'request-reanalyze').at(-1)?.settings?.display;
    });
    expect(display).toMatchObject({ minFrequencyHz: 500, maxFrequencyHz: 2000 });
});
