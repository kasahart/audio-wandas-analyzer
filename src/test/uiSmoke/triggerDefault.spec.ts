import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getStrings } from '../../shared/i18n/strings';
import { expect, test, type Page } from './canvasAudit';
import { backendRequired, entry100Results, openEntry, type ScannedFile } from './entryHelpers';
import { bridgeComparison, RealBackend, runFixture } from './realBackend';

/**
 * The level a new trigger starts at is half the peak of the compared channels over the region, read from every
 * sample (display rules R1; regionPeak.ts). Two things are checked here, in the real page:
 *
 * 1. End to end with the real backend (backend_server.py, as the host runs it), on recordings whose region's largest
 *    sample is NOT in the envelope a lane draws (src/test/fixtures/triggerPeak): the trigger starts at half the true
 *    peak; added while the read is still on its way it keeps its own level and the footer says so.
 * 2. With many files open, the samples are asked for only when ＋ can add a trigger, and only of the compared slots.
 *
 * If either fails, look at comparisonRuntime.ts (`peak:` given to the comparison), trackStageMode.ts (where it is
 * handed to the step bar) and stepBar.ts (`state.peak?.()`): the chain from the lanes' full data to the new step.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const STR = getStrings('en');
const TRIGGER = 'wandas.audio.trigger';
const REGION = { start: 1, end: 1.5 };
/** The fixture's recordings: 4 s at 8 kHz; over the region the base peaks at 0.32, the compared one at 0.20. */
const SECONDS = 4, SAMPLES = 32_000, TRUE_PEAK = 0.32;

type Read = { x: number[]; level?: string; channel?: number };
type RangeRequest = { type: string; requestId: string; filePath: string; trackIndex: number; startNorm: number; endNorm: number; points: number; read?: Read };
type Envelope = { min: number[]; max: number[]; minT: number[]; maxT: number[]; absolutePeak: number };

/**
 * The reads of a stretch's level and peak the page has posted for the lanes' samples: 'request-waveform-range' with a
 * "square" level read. `stretch` (the file's 0..1) keeps those of one stretch; without it, every one.
 */
const peakReads = async (page: Page, stretch?: [number, number]): Promise<RangeRequest[]> => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: RangeRequest[] }).__uiSmokePostedMessages
    .filter(message => message.type === 'request-waveform-range' && message.read?.level === 'square')))
    .filter(message => !stretch || (message.read!.x[0] === stretch[0] && message.read!.x[1] === stretch[1]));

/** The trigger's level in the chain the comparison last asked the backend to run. */
const triggerLevel = (page: Page): Promise<unknown> => page.evaluate(TRIGGER => {
    type Scan = { type: string; requestId: string; recipe?: { nodes: Array<{ operation: string; params: { entries: Array<[string, unknown]> } }> } };
    const scans = (window as unknown as { __uiSmokePostedMessages: Scan[] }).__uiSmokePostedMessages.filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
    return scans.at(-1)?.recipe?.nodes.find(node => node.operation === TRIGGER)?.params.entries.find(([name]) => name === 'threshold')?.[1];
}, TRIGGER);

/** Slot 0 from the table's first row and slot 1 from its first row of another file, then the comparison (Enter); the two files. */
async function compareTwoFiles(page: Page): Promise<[string, string]> {
    const rows = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(found => found.map(row => row.getAttribute('data-file-path')!));
    const other = rows.findIndex(filePath => filePath !== rows[0]);
    await page.keyboard.press('0');
    for (let step = 0; step < other; step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    return [rows[0], rows[other]];
}

/** The tracks' analysis as the host reports it, each file one channel with `envelope` as its drawn waveform. */
async function postAnalysis(page: Page, paths: string[], seconds: number, samples: number, envelope: (filePath: string) => Envelope): Promise<void> {
    const results = paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: samples / seconds, durationSeconds: seconds, channelCount: 1, sampleCount: samples,
        channels: [{ label: 'L', peakAbsolute: envelope(filePath).absolutePeak, fullScale: true, waveform: envelope(filePath) }],
    }));
    await page.evaluate(results => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results } })), results);
    await expect(page.locator('.track-stage')).toBeVisible();
}

/** The chain cut back to the time signal (the average spectrum's step deleted), so ＋ offers a trigger. */
async function toTimeSignal(page: Page): Promise<void> {
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-delete"]').click();
}

/** The region 1.0–1.5 s set with the region chip (＋ → region). */
async function setRegion(page: Page): Promise<void> {
    const bar = page.locator('.track-stage-bar');
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('.step-menu-item[data-op="wandas.frame.time_slice"]').click();
    await bar.locator('[data-step-region-param="start"]').fill(String(REGION.start));
    await bar.locator('[data-step-region-param="end"]').fill(String(REGION.end));
    await bar.locator('[data-step-region-param="end"]').press('Enter');
    await expect(page.locator('.track-stage')).toHaveAttribute('data-region', '1.00–1.50');
}

/** ＋ opened, and the trigger picked from its menu. */
async function openAdd(page: Page): Promise<void> {
    const bar = page.locator('.track-stage-bar');
    await bar.locator('[data-action="step-add"]').click();
    await expect(bar.locator(`.step-menu-item[data-op="${TRIGGER}"]`)).toBeVisible();
}
const pickTrigger = (page: Page): Promise<void> => page.locator(`.track-stage-bar .step-menu-item[data-op="${TRIGGER}"]`).click();

// ---------------------------------------------------------------------------------------------------------------
// 1. End to end, the real backend.

let backend: RealBackend | undefined;
let files: ScannedFile[] | undefined;
let envelopes = new Map<string, Envelope>();
let folder = '';
let recipe: Record<string, unknown> = {};
let fixtureError = '';

test.beforeAll(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'trigger-peak-ui-'));
    const written = runFixture(path.join('src', 'test', 'fixtures', 'triggerPeak', 'generate.py'), [folder]);
    if (!written.out) { fixtureError = written.error ?? ''; return; }
    recipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as Record<string, unknown>;
    try {
        backend = new RealBackend();
        const scanned: ScannedFile[] = [];
        for (const filePath of written.out.trim().split('\n')) {
            scanned.push({ filePath, result: await backend.request({ cmd: 'scan', filePath, recipe }) });
            // The envelope the lanes draw is the backend's own (analyze), so the test's premise is about the real one.
            const analysis = await backend.request({ cmd: 'analyze', filePath, analysisRevision: 0 }) as { channels: Array<{ waveform: Envelope }> };
            envelopes.set(filePath, analysis.channels[0].waveform);
        }
        files = scanned;
    } catch (error) {
        fixtureError = error instanceof Error ? error.message : String(error);
    }
});
test.afterAll(() => {
    backend?.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
    envelopes = new Map();
});

/** What the deleted envelope calculation gave: the largest |extreme| of the drawn envelope whose time is in the region. */
function envelopePeak(envelope: Envelope): number {
    const from = REGION.start / SECONDS, to = REGION.end / SECONDS;
    let peak = 0;
    for (const [values, at] of [[envelope.min, envelope.minT], [envelope.max, envelope.maxT]]) {
        values.forEach((value, index) => { if (at[index] >= from && at[index] <= to) peak = Math.max(peak, Math.abs(value)); });
    }
    return peak;
}

test('a trigger added on a region starts at half the region\'s true peak, read from every sample by the real backend; added while that read is on its way it keeps its own level and the footer says so (R1)', async ({ page }) => {
    if (!files && backendRequired()) throw new Error(`the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo's .venv) but the triggerPeak fixture could not be analysed: ${fixtureError}`);
    test.skip(!files, `no Python backend with wandas: ${fixtureError}`);
    test.setTimeout(120_000);
    const paths = files!.map(file => file.filePath);
    // The premise: the envelope the lanes draw does not hold the region's largest sample. If this fails the fixture no
    // longer proves anything (the backend's envelope changed): move the samples in fixtures/triggerPeak/generate.py.
    for (const filePath of paths) expect(Math.abs(envelopePeak(envelopes.get(filePath)!) - TRUE_PEAK), `${path.basename(filePath)}: the drawn envelope must not hold the region's peak`).toBeGreaterThan(0.01);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEntry(page, files!, { language: 'en', recipe });
    // The lanes' reads are answered by this test from the real backend, not by the page's stand-in.
    await page.evaluate(() => { (window as unknown as { __uiSmokeTestAnswersReads: boolean }).__uiSmokeTestAnswersReads = true; });
    const stop = await bridgeComparison(page, backend!, recipe);
    await compareTwoFiles(page);
    await postAnalysis(page, paths, SECONDS, SAMPLES, filePath => envelopes.get(filePath)!);
    await toTimeSignal(page);
    await setRegion(page);
    /** The real backend's answer to each read, posted as the host does ('range' with the read); the peaks it gave. */
    const answerReads = async (asked: RangeRequest[]): Promise<Map<string, number | undefined>> => {
        const peaks = new Map<string, number | undefined>();
        for (const read of asked) {
            const result = await backend!.request({ cmd: 'range', filePath: read.filePath, startNorm: read.startNorm, endNorm: read.endNorm, points: read.points, read: read.read }) as { points?: { level?: { peak?: number } } };
            peaks.set(read.filePath, result.points?.level?.peak);
            await page.evaluate(message => window.postMessage(message, '*'), { type: 'waveform-range-result', requestId: read.requestId, trackIndex: read.trackIndex, startNorm: read.startNorm, endNorm: read.endNorm, channels: [], points: result.points });
        }
        return peaks;
    };
    // The ＋ opened to set the region offered a trigger too, over the whole file then: those reads are answered first
    // (a source sends one read at a time). The region's own samples have not been asked for yet.
    await expect.poll(async () => (await peakReads(page)).length).toBe(2);
    await answerReads(await peakReads(page));
    const stretch: [number, number] = [REGION.start / SECONDS, REGION.end / SECONDS];
    expect(await peakReads(page, stretch), 'the region\'s samples are not asked for before ＋ can add a trigger on it').toHaveLength(0);

    // ＋ offers a trigger: each compared channel's samples over the region are asked for, as the file's 0..1.
    await openAdd(page);
    await expect.poll(async () => (await peakReads(page, stretch)).length).toBe(2);
    const reads = await peakReads(page, stretch);
    expect(reads.map(read => read.filePath).sort()).toEqual([...paths].sort());

    // Not answered yet: a trigger added now keeps the step's own level, and the footer says the peak is not read.
    await pickTrigger(page);
    const chip = page.locator('.track-stage-bar .step-chip', { hasText: STR.stepTrigger });
    // (The footer names the step as the menu does; the words after its name are the message.)
    await expect(page.locator('#hint-footer')).toContainText(STR.stepPeakUnread.split('{op}')[1]);
    await expect.poll(() => triggerLevel(page)).toBe(0.1);
    await chip.locator('[data-action="step-delete"]').click();
    await expect(chip).toHaveCount(0);

    // The real backend answers each read: the region's true peak of each recording.
    const peaks = await answerReads(reads);
    for (const filePath of paths) expect(peaks.get(filePath), `${path.basename(filePath)}: the backend's peak of the region`).toBeCloseTo(filePath.endsWith('base.wav') ? TRUE_PEAK : 0.2, 12);

    // Added again: half the true peak of the louder channel, to two figures; nothing is asked a second time.
    await openAdd(page);
    await pickTrigger(page);
    await expect(page.locator('#hint-footer')).toContainText(STR.stepAdded.split('{op}')[1]);
    await expect.poll(() => triggerLevel(page), 'the trigger starts at half the region\'s true peak (0.32 → 0.16); 0.1 means the peak never reached the step bar (comparisonRuntime `peak:` → trackStageMode → stepBar)').toBe(0.16);
    await expect(chip).toHaveText(`${STR.stepTrigger} 0.16`);
    expect(await peakReads(page, stretch), 'the answers are kept (fetchedSource): not asked again').toHaveLength(2);
    expect(await stop(), 'the backend refused no request').toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Many files: who is asked, and when.

let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

test('with a hundred files open and thirty of them on the tracks, the samples for a trigger\'s level are asked only when ＋ offers a trigger, and only of the two compared slots (R1)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const entryRecipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as Record<string, unknown>;
    await openEntry(page, scanned!, { language: 'en', recipe: entryRecipe });
    const compared = await compareTwoFiles(page);
    // Thirty files are analysed and on the tracks (the two compared ones first); the page's stand-in answers reads.
    const onTracks = [...new Set([...compared, ...scanned!.map(file => file.filePath)])].slice(0, 30);
    expect(onTracks).toHaveLength(30);
    const envelope: Envelope = { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 };
    await postAnalysis(page, onTracks, 2, 32_000, () => envelope);
    await toTimeSignal(page);
    const bar = page.locator('.track-stage-bar');
    // Drawn, repainted and hovered, with no menu open: nothing is asked.
    const overlay = (await page.locator('[data-stage-canvas="overlay"]').boundingBox())!;
    await page.mouse.move(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.mouse.move(0, 0);
    expect(await peakReads(page), 'no samples are asked for while the comparison is only drawn').toHaveLength(0);

    // ＋ offers a trigger: one read per compared slot (each one channel), none for the other 28 files.
    await openAdd(page);
    await expect.poll(async () => (await peakReads(page)).length).toBe(2);
    expect((await peakReads(page)).map(read => read.filePath).sort()).toEqual([...compared].sort());
    // Picked, closed and opened again, and repainted: still those two (the answers are kept).
    await pickTrigger(page);
    await expect(bar.locator('.step-chip', { hasText: STR.stepTrigger })).toHaveText(`${STR.stepTrigger} 0.25`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await bar.locator('[data-action="step-add"]').click();
    await page.keyboard.press('Escape');
    expect(await peakReads(page), 'two reads in all, for thirty files on the tracks').toHaveLength(2);
});
