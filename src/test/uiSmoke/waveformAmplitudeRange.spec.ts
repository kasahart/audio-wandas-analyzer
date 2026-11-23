import { expect, test } from './canvasAudit';
import { buildUiSmokeHtml } from './buildHtml';
import { drawnRow, openRowRange, ROW_WAVE, laneOf } from './tracksFigures';


test('double-clicking the waveform amplitude axis sets the vertical range from a popover', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const first = await openRowRange(page, 'amplitude');
    await expect(first.max).toBeFocused();

    const max = Number(await first.max.inputValue());
    expect(max).toBeGreaterThan(0);
    await first.min.fill('-0.25');
    await first.max.fill('0.25');
    await first.apply.click();
    await expect(first.popover).toHaveCount(0);
    // The waveform is drawn on the typed range.
    await expect.poll(async () => laneOf(await drawnRow(page), ROW_WAVE).range?.y).toEqual([-0.25, 0.25]);

    const again = await openRowRange(page, 'amplitude');
    await expect(again.max).toHaveValue('0.25');
    await page.keyboard.press('Escape');
    await expect(again.popover).toHaveCount(0);
});
