import { expect, test } from './canvasAudit';
import { buildUiSmokeFractionalLevelsHtml } from './buildHtml';
import { colourBarAt } from './colourBar';

test('the auto colour scale opens with round dB ends, and typed ends are kept as typed', async ({ page }) => {
    await page.setContent(buildUiSmokeFractionalLevelsHtml(), { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('#track-row-0 .track-spec-canvas').first();
    const openColourRange = async () => {
        await expect(canvas).toHaveAttribute('data-plot-colour-bar', /\d/);
        await canvas.dblclick({ position: await colourBarAt(canvas) });
        await expect(page.locator('#waveform-range-popover')).toBeVisible();
    };
    await openColourRange();
    await expect(page.locator('#wave-range-max')).toHaveValue('-20');
    await expect(page.locator('#wave-range-min')).toHaveValue('-120');
    await page.locator('#wave-range-max').fill('-23.5');
    await page.locator('#wave-range-apply').click();
    await openColourRange();
    await expect(page.locator('#wave-range-max')).toHaveValue('-23.5');
    await expect(page.locator('#wave-range-min')).toHaveValue('-120');
});

test('a typed colour range is painted, written on the colour bar and offered again exactly as typed: 999990 to 1000000.5 reads 1000000.5, never 1000001 (R9)', async ({ page }) => {
    await page.setContent(buildUiSmokeFractionalLevelsHtml(), { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('#track-row-0 .track-spec-canvas').first();
    const openColourRange = async () => {
        await expect(canvas).toHaveAttribute('data-plot-colour-bar', /\d/);
        await canvas.dblclick({ position: await colourBarAt(canvas) });
        await expect(page.locator('#waveform-range-popover')).toBeVisible();
    };
    await openColourRange();
    await page.locator('#wave-range-min').fill('999990');
    await page.locator('#wave-range-max').fill('1000000.5');
    await page.locator('#wave-range-apply').click();
    // The colour bar's ends as drawn on the lane (the canvas audit keeps every text a canvas draws).
    const drawn = () => canvas.evaluate(element => (element as HTMLCanvasElement & { __plotTexts?: string[] }).__plotTexts ?? []);
    await expect.poll(drawn, { message: 'R9: the colour bar writes the typed ends as typed (stagePanes.colourEndText only formats; figureModel.colourScale keeps a typed end)' })
        .toEqual(expect.arrayContaining(['999990', '1000000.5']));
    expect(await drawn(), 'R9: never the typed end rounded off').not.toContain('1000001');
    await openColourRange();
    await expect(page.locator('#wave-range-max'), 'R9: the range popover offers the scale the lane is painted from, exactly').toHaveValue('1000000.5');
    await expect(page.locator('#wave-range-min')).toHaveValue('999990');
});
