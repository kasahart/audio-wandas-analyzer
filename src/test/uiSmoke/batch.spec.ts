import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Metadata, entry100Results, openEntry, pickCsv, type ScannedFile } from './entryHelpers';

/** 「レシピをまとめて書き出す」: its rows follow the table's filters (or all), and the folder it hands the host. */
let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Folder = { type: string; folder: string; files: Array<{ name: string; text?: string }> };
const folders = (page: Page): Promise<Folder[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Folder[] }).__uiSmokePostedMessages.filter(message => message.type === 'save-report-folder'));

test('the bundle is for the filtered rows, said as recordings and channels, or for all; ch 2 alone gives the channel\'s Recipe', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { language: 'ja', recipe });
    await pickCsv(page, 'motor.csv', entry100Metadata());
    // Narrowed to L2 and ch 2.
    await page.locator('th[data-column="csv:line"] [data-action="entry-fhead"]').click();
    await page.locator('[data-entry-fall]').uncheck();
    await page.locator('[data-entry-fvalue="L2"]').check();
    await page.locator('[data-action="entry-fok"]').click();
    await page.locator('th[data-column="ch"] [data-action="entry-fhead"]').click();
    await page.locator('[data-entry-fvalue="1"]').uncheck();
    await page.locator('[data-action="entry-fok"]').click();
    const visible = await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'entry-snapshot', actions: [] } }));
        return (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { entry: { visible: number } } }> }).__uiSmokePostedMessages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi.entry.visible;
    });
    // The table's exports are in its 書き出し menu.
    await page.locator('#entry-export-menu > summary').click();
    await page.locator('#entry-export-menu [data-action="entry-batch"]').click();
    const pop = page.locator('[data-entry-batch]');
    await expect(pop).toBeVisible();
    // Filtered is chosen: n recordings, each of them one channel (ch 2).
    await expect(pop.locator('.entry-batch-opt').first()).toHaveText(` ${STR.dsBatchFiltered.replace('{n}', String(visible)).replace('{m}', String(visible))}`);
    await expect(pop.locator('[data-entry-batch-scope][value="filtered"]')).toBeChecked();
    await expect(pop.locator('.entry-batch-opt').nth(1)).toHaveText(` ${STR.dsBatchAll.replace('{n}', '99').replace('{m}', '197')}`);
    await pop.locator('[data-action="entry-batch-go"]').click();
    const filtered = (await folders(page)).at(-1)!;
    expect(filtered.folder).toMatch(/_batch_\d{8}-\d{6}$/);
    expect(filtered.files.map(file => file.name)).toEqual(['標準.ch2.recipe.json', 'targets.csv', 'run_recipe.py', 'README.txt'].map(name => name.replace('標準', STR.stepRecipeName)));
    const targets = filtered.files.find(file => file.name === 'targets.csv')!.text!.trimEnd().split('\r\n');
    expect(targets[0]).toBe('path,channel,recipe,sample_id');
    expect(targets.length - 1).toBe(visible);
    expect(targets.slice(1).every(line => /^L2_[^,]+\.wav,2,[^,]+\.ch2\.recipe\.json,S\d+$/.test(line))).toBe(true);
    expect(JSON.parse(filtered.files[0].text!).nodes[0].operation).toBe('wandas.frame.get_channel');
    // All: every recording, whole (its channels together), with the Recipe as it is.
    // The table's exports are in its 書き出し menu.
    await page.locator('#entry-export-menu > summary').click();
    await page.locator('#entry-export-menu [data-action="entry-batch"]').click();
    await page.locator('[data-entry-batch-scope][value="all"]').check();
    await page.locator('[data-action="entry-batch-go"]').click();
    const all = (await folders(page)).at(-1)!;
    expect(all.files.map(file => file.name)[0]).toBe(`${STR.stepRecipeName}.recipe.json`);
    expect(all.files.find(file => file.name === 'targets.csv')!.text!.trimEnd().split('\r\n').length - 1).toBe(99);
});
