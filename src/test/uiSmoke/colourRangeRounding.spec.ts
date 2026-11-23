import { expect, test } from './canvasAudit';
import { buildUiSmokeFractionalLevelsHtml } from './buildHtml';
import { laneOf, openRowRange, rowFigure, ROW_SPECTROGRAM, seenFigure } from './tracksFigures';


test('the auto colour scale opens with round dB ends, and typed ends are kept as typed', async ({ page }) => {
    await page.setContent(buildUiSmokeFractionalLevelsHtml(), { waitUntil: 'domcontentloaded' });
    const first = await openRowRange(page, 'colour');
    await expect(first.max).toHaveValue('-20');
    await expect(first.min).toHaveValue('-120');
    await first.max.fill('-23.5');
    await first.apply.click();
    await expect(first.popover).toHaveCount(0);
    const again = await openRowRange(page, 'colour');
    await expect(again.max).toHaveValue('-23.5');
    await expect(again.min).toHaveValue('-120');
});

test('a typed colour range is painted and offered again exactly as typed: −87.25 to −20.125 dB, neither end rounded off (R9)', async ({ page }) => {
    await page.setContent(buildUiSmokeFractionalLevelsHtml(), { waitUntil: 'domcontentloaded' });
    const first = await openRowRange(page, 'colour');
    await first.min.fill('-87.25');
    await first.max.fill('-20.125');
    await first.apply.click();
    await expect(first.popover).toHaveCount(0);
    // The colours are painted over the typed ends exactly (what the Figure's colour bar is drawn over): the bar is an
    // axis with ticks at round values between them, so it writes no end, and never one rounded off.
    const painted = async () => laneOf(await seenFigure(page, rowFigure(0)), ROW_SPECTROGRAM).image?.colour ?? null;
    await expect.poll(painted, { message: 'R9: the colours are painted over the typed ends as typed (the figure service keeps a specified end)' }).toEqual([-87.25, -20.125]);
    const again = await openRowRange(page, 'colour');
    await expect(again.max, 'R9: the range popover offers the scale the row is painted from, exactly').toHaveValue('-20.125');
    await expect(again.min).toHaveValue('-87.25');
});
