import { expect, test } from './canvasAudit';
import { buildUiSmokeFractionalLevelsHtml } from './buildHtml';
import { colourBarAt } from './colourBar';

test('the auto colour scale opens with round dB ends, and typed ends are kept as typed', async ({ page }) => {
    await page.setContent(buildUiSmokeFractionalLevelsHtml(), { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('#track-row-0 .track-spec-canvas').first();
    const openColourRange = async () => {
        await expect(canvas).toHaveAttribute('data-colour-bar', /\d/);
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
