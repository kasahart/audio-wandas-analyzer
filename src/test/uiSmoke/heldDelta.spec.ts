import { expect, test, type Page } from './canvasAudit';
import { openEntry, type ScannedFile } from './entryHelpers';

/**
 * A slot key held in the entry table draws that row's Δ beside the distribution (R1, R3, R11): the row's own channel
 * against the same channel of its base, from every Welch bin of the files, which the hold asks the host for. Three
 * two-channel recordings; the first one's second channel is 12 dB louder in three bins round 1 kHz only, which the
 * table's 192 points (and both channels power-averaged) would show as a smaller, wider bump. The host's answers are
 * the test's, so it runs without a backend.
 */
const FS = 16000;
const BINS = 513;
const BIN_HZ = FS / 2 / (BINS - 1);
const NARROW = [63, 64, 65];
const FILES = ['/w/a.wav', '/w/b.wav', '/w/c.wav'];

function result(filePath: string, withBins: boolean): Record<string, unknown> {
    const louder = filePath === FILES[0];
    const channel = (ch: number): number[] => Array.from({ length: BINS }, (_, bin) => (louder && ch === 1 && NARROW.includes(bin) ? -28 : -40));
    return {
        ok: true,
        input: { id: filePath, fs: FS, channels: [0, 1], durationS: 2, unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true },
        leqDbA: [60, 60], peakHz: [1000, 1000], spectrumDb: [Array(192).fill(-40), Array(192).fill(-40)], thirdOctDb: [Array(27).fill(40), Array(27).fill(40)], crest: [3, 3],
        specVersion: 5, conditionId: 'test', wandasVersion: 'test', elapsedMs: 1,
        ...(withBins ? { spectrumBinsDb: [channel(0), channel(1)], spectrumBinHz: BIN_HZ } : {}),
    };
}

type Posted = { type: string; requestId: string; filePaths: string[]; spectrumBins?: boolean };
const binScans = async (page: Page): Promise<Posted[]> => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages))
    .filter(message => message.type === 'compare-scan' && message.requestId.startsWith('held-bins'));

async function focusRow(page: Page, key: (key: string) => boolean): Promise<void> {
    for (const arrow of ['ArrowUp', 'ArrowDown']) for (let step = 0; step < 8; step++) {
        const focused = await page.locator('[data-entry-rows] tr.entry-row[aria-selected="true"]').getAttribute('data-key');
        if (focused && key(focused)) return;
        await page.keyboard.press(arrow);
    }
    throw new Error('row not found');
}

/** The largest Δ the held plot's readout gives, the pointer swept across it. */
async function largestReadDelta(page: Page): Promise<number> {
    const plot = page.locator('[data-entry-held-canvas]');
    const box = (await plot.boundingBox())!;
    const readout = page.locator('[data-entry-held] [data-plot-readout]');
    let largest = -Infinity;
    // The readout takes the point nearest the pointer, across and up: swept along the top, where a bump is.
    for (const y of [0.1]) for (let x = box.x + 2; x < box.x + box.width - 2; x += 1) {
        await page.mouse.move(x, box.y + box.height * y);
        const text = (await readout.textContent()) ?? '';
        const match = /([+−-]?\d+(?:\.\d+)?) dB\s*$/.exec(text);
        if (match) largest = Math.max(largest, Number(match[1].replace('−', '-')));
    }
    return largest;
}

test('a held slot draws its own channel\'s Δ against its base from every bin the hold asks for (R1, R3, R11)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const files: ScannedFile[] = FILES.map(filePath => ({ filePath, result: result(filePath, false) }));
    await openEntry(page, files, { language: 'en', headers: Object.fromEntries(FILES.map(filePath => [filePath, { channels: 2, durationS: 2 }])) });
    await expect(page.locator('[data-entry-rows] tr.entry-row')).toHaveCount(6);
    const keys = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(rows => rows.map(row => [row.getAttribute('data-key')!, row.getAttribute('data-file-path')!]));
    const ofFile = (file: string): string[] => keys.filter(([, path]) => path === file).map(([key]) => key);
    const [first, second] = ofFile(FILES[0]).sort();

    for (const [key, expected] of [[second, 12], [first, 0]] as const) {
        await focusRow(page, focused => focused === key);
        await page.keyboard.press('1');
        await page.keyboard.down('1');
        await expect(page.locator('[data-entry-held]')).toBeVisible();
        if (key === second) {
            // The hold asks for every bin of the slotted file and its base (the other two recordings).
            await expect(page.locator('[data-entry-held]')).toHaveClass(/is-pending/);
            await expect.poll(async () => (await binScans(page)).length).toBe(1);
            const request = (await binScans(page))[0];
            expect(request.spectrumBins).toBe(true);
            expect([...request.filePaths].sort()).toEqual(FILES);
            await page.evaluate(({ request, answers }) => {
                for (const filePath of request.filePaths) window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: answers[filePath] }, '*');
                window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
            }, { request, answers: Object.fromEntries(FILES.map(filePath => [filePath, result(filePath, true)])) });
        }
        await expect(page.locator('[data-entry-held]')).not.toHaveClass(/is-pending/);
        // Channel 2's three bins are 12 dB up; channel 1 is the same as its base's.
        expect(await largestReadDelta(page)).toBeCloseTo(expected, 1);
        await page.keyboard.up('1');
        await expect(page.locator('[data-entry-held]')).toBeHidden();
    }
    expect((await binScans(page)).length, 'the bins once scanned are kept for the next hold').toBe(1);
});
