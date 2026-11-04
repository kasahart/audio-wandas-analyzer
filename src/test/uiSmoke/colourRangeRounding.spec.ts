import { expect, test } from './canvasAudit';
import { buildUiSmokeFractionalLevelsHtml } from './buildHtml';

test('the auto colour scale opens with round dB ends, and typed ends are kept as typed', async ({ page }) => {
    await page.setContent(buildUiSmokeFractionalLevelsHtml(), { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('#track-row-0 .track-spec-canvas').first();
    const openColourRange = async () => {
        const box = await canvas.boundingBox();
        if (!box) throw new Error('no spectrogram box');
        await canvas.dblclick({ position: { x: box.width - 30, y: box.height / 2 } });
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
