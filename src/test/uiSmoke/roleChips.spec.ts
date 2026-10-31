import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';

let scanned: ScannedFile[] | undefined;
const STR = getStrings('en');
test.beforeAll(() => { scanned = entry100Results(); });

type Posted = { type: string; requestId: string; filePaths: string[] };
const posted = (page: Page): Promise<Posted[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages);
const slotText = (page: Page, slot: number) => page.locator(`[data-entry-slots] [data-action="entry-slot"][data-slot="${slot}"]`);

/** Shows two of the table's rows as tracks with ☐, as a host answers: the lanes are there, no role yet. */
async function twoTracks(page: Page): Promise<string[]> {
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe, docked: true });
    const rows = page.locator('[data-entry-rows] tr.entry-row');
    // Rows are a recording's channels: rows 0 and 2 are two recordings.
    const paths = [await rows.nth(0).getAttribute('data-file-path'), await rows.nth(2).getAttribute('data-file-path')] as string[];
    await rows.nth(0).locator('[data-action="entry-row-track"]').click();
    await rows.nth(2).locator('[data-action="entry-row-track"]').click();
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths).toEqual(paths);
    await page.evaluate(paths => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    })) } })), paths);
    await expect(page.locator('.track-row')).toHaveCount(2);
    return paths;
}
const chipOf = (page: Page, filePath: string) => page.locator(`.track-header details.role-chip[data-file-path="${filePath}"]`);

test('a track\'s role chip sets the entry table\'s slots from the track view, by its menu or 0–3 while focused; taking the role off keeps the track', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const [first, second] = await twoTracks(page);
    const firstChip = chipOf(page, first);
    await expect(firstChip.locator('.role-chip-face')).toHaveText('·');
    // Its menu: base, compare 1–3 and none; compare 1 puts the file in slot 1, as 1 on its row would.
    await firstChip.locator('summary').click();
    await expect(firstChip.locator('[data-action="track-role-set"]')).toHaveText([/^0Base0$/, /^1Compare 11$/, /^2Compare 22$/, /^3Compare 33$/, /^·None$/]);
    // The open menu is drawn over the lanes, not clipped by the header: its last item is what is under it.
    const none = firstChip.locator('[data-action="track-role-set"][data-slot=""]');
    const box = (await none.boundingBox())!;
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-action="track-role-set"]')?.getAttribute('data-slot'), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe('');
    await firstChip.locator('[data-action="track-role-set"][data-slot="1"]').click();
    await expect(firstChip).not.toHaveAttribute('open', '');
    await expect(slotText(page, 1)).toContainText(first.split('/').pop()!);
    await expect(firstChip.locator('.role-chip-face')).toHaveText(/^1( ch\d)?$/);
    await expect(firstChip.locator('.role-chip-face')).toHaveAttribute('style', /background:\s*#d4b20f/);
    // Focused, 2 puts the other in slot 2; the lanes' 0 (zoom reset) and the comparison's keys leave it alone.
    await chipOf(page, second).locator('summary').focus();
    await page.keyboard.press('2');
    await expect(slotText(page, 2)).toContainText(second.split('/').pop()!);
    // The chip keeps the focus through its redraw: the next key moves the same recording.
    await expect.poll(() => page.evaluate(() => (document.activeElement?.closest('details.role-chip') as HTMLElement | null)?.dataset.filePath)).toBe(second);
    await page.keyboard.press('3');
    await expect(slotText(page, 3)).toContainText(second.split('/').pop()!);
    await expect(chipOf(page, second).locator('.role-chip-face')).toHaveText(/^3( ch\d)?$/);
    // Esc closes an open menu and leaves the focus on its chip.
    await chipOf(page, second).locator('summary').click();
    await page.keyboard.press('Escape');
    await expect(chipOf(page, second)).not.toHaveAttribute('open', '');
    await expect(page.locator('.track-row')).toHaveCount(2);
    // None: the file leaves its slot, its track stays.
    await firstChip.locator('summary').click();
    await firstChip.locator('[data-action="track-role-set"][data-slot=""]').click();
    await expect(page.locator('[data-entry-slots]')).not.toContainText(first.split('/').pop()!);
    await expect(page.locator('.track-row')).toHaveCount(2);
    await expect(firstChip.locator('.role-chip-face')).toHaveText('·');
    // The row's exclusion says what it does.
    const row = page.locator('[data-entry-rows] tr.entry-row').nth(4);
    await row.hover();
    await expect(row.locator('[data-action="entry-row-exclude"]')).toHaveText(STR.dsRowExcludeShort);
});

test('compared with no role, the comparison asks for one: no difference to show, and the legend\'s chips set the roles there', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const [first] = await twoTracks(page);
    await page.locator('[data-action="content-stage"]').click();
    await expect(page.locator('.track-stage')).toBeVisible();
    const scans = async (): Promise<Posted[]> => (await posted(page)).filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
    await expect.poll(async () => (await scans()).length).toBeGreaterThan(0);
    const request = (await scans()).at(-1)!;
    /** Answers a steps-mode scan as a host does. */
    const answer = (request: Posted): Promise<void> => page.evaluate(({ request, files }) => {
        for (const filePath of request.filePaths) {
            const file = files.find(item => item.filePath === filePath);
            if (file) window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] } } }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, files: scanned! });
    await answer(request);
    await expect(page.locator('[data-stage-headline]')).toHaveText(STR.stageChooseRoles);
    await expect(page.locator('[data-action="stage-diff"]')).toBeDisabled();
    // Each recording in the legend carries its chip: compare 1 from there.
    const legendChip = page.locator(`[data-stage-legend] details.role-chip[data-file-path="${first}"]`);
    await legendChip.locator('summary').click();
    await legendChip.locator('[data-action="track-role-set"][data-slot="1"]').click();
    await expect(slotText(page, 1)).toContainText(first.split('/').pop()!);
    // The compared row is its recording's channel 1: its picture is asked for again, as that channel.
    await expect.poll(async () => (await scans()).length).toBeGreaterThan(1);
    await answer((await scans()).at(-1)!);
    await expect(page.locator('.track-stage')).toHaveAttribute('data-compared', '1');
    await expect(page.locator('[data-action="stage-diff"]')).toBeEnabled();
});
