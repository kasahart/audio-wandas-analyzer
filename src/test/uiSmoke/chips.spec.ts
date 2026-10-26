import { expect, test, type Locator } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';

let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

const style = (locator: Locator, property: string): Promise<string> => locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
const BLUE = 'rgb(59, 130, 246)', YELLOW = 'rgb(212, 178, 15)';

test('controls follow the chip design: slots by role and state, a white primary, the filter inverse', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openEntry(page, scanned!);
    // The primary is white, not blue; every control is 28 px high.
    const open = page.locator('[data-action="entry-open"]');
    expect(await style(open, 'background-color')).not.toBe(BLUE);
    expect(await style(open, 'height')).toBe('28px');
    // Slots: 0 tinted blue, empty ones dashed with "empty".
    const base = page.locator('[data-entry-slots] [data-slot="0"]');
    expect(await style(base, 'border-top-color')).toBe(BLUE);
    const empty = page.locator('[data-entry-slots] [data-slot="2"]');
    await expect(empty).toHaveClass(/is-empty/);
    expect(await style(empty, 'border-top-style')).toBe('dashed');
    await expect(empty.locator('.awa-slot-label')).toHaveText(STR.slotEmpty);
    // Held: 0 fills the base slot with its colour.
    await page.keyboard.down('0');
    await expect(base).toHaveClass(/is-held/);
    expect(await style(base, 'background-color')).toBe(BLUE);
    await page.keyboard.up('0');
    // The outlier filter: on is the white inverse.
    const outliers = page.locator('[data-action="entry-filter-outliers"]');
    await outliers.click();
    await expect(outliers).toHaveAttribute('aria-pressed', 'true');
    expect(await style(outliers, 'background-color')).toBe(await style(page.locator('#entry-screen'), 'color'));
    await outliers.click();
    // A filled slot keeps its role's colour: slot 1 yellow. Enter compares it in the track view.
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    const slotted = page.locator('[data-entry-slots] [data-slot="1"]');
    await expect(slotted).not.toHaveClass(/is-empty/);
    // The slot bar redraws as the file becomes a track, so read its colour once it settles.
    await expect.poll(() => style(slotted.locator('.awa-slot-num'), 'background-color')).toBe(YELLOW);
    await page.keyboard.press('Enter');
    await expect(page.locator('.track-stage')).toBeVisible();
});
