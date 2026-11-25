import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { backendRequired, openEntry, type ScannedFile } from './entryHelpers';
import { bridgeComparison, RealBackend, runFixture } from './realBackend';

/**
 * The comparison's other lines on the new path: a step that ends in a metric over time, a level over
 * time or a cepstrum is overlaid by the one Figure the spectrum overlay is (src/webview/figure/), drawn and read by the
 * figure service (python-backend/figures/) through the REAL backend; so are a pair of channels' figures of a
 * two-channel recording (coherence, transfer function, cross spectrum, cross-correlation). For each kind:
 *
 * - the old overlay and Δ canvases are not shown; the lines are in the declared order (spec 1), on one value axis;
 * - R4: both axes are named with the quantity and the unit the picture says (time, quefrency; an RMS, a level, a
 *   cepstrum), and the Δ lane's as a Δ of them;
 * - R7: the point read is written at its place across in that axis's unit, with its value in its unit, and → steps
 *   one point of the answer;
 * - the Δ headline names the largest difference at a place in that axis's unit.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
type Fixture = 'narrow' | 'pairLines';
const scannedOf: Partial<Record<Fixture, ScannedFile[]>> = {};
let backend: RealBackend | undefined;
const folders: string[] = [];
let scanRecipe: Record<string, unknown> = {};
let fixtureError = '';

interface Kind {
    name: string;
    /** The name of its screenshot (taken with AWA_SHOT_DIR). */
    shot: string;
    /** The chain's last step, in place of the entry scan's average spectrum. */
    step: { operation: string; version: number; entries: Array<[string, unknown]> };
    /** A pair of channels' figure: of the two-channel fixture's recordings, channel 2 over channel 1 (a select_pair step after it, as ＋ adds one). */
    pair?: boolean;
    axes: { x: string; y: RegExp; delta: RegExp };
    /** A place across and a value, as the readout writes them. */
    at: RegExp;
    value: RegExp;
    headline: RegExp;
}
const KINDS: Kind[] = [
    {
        name: 'an RMS over time', shot: 'rms',
        step: { operation: 'wandas.audio.rms_trend', version: 3, entries: [['frame_length', 1024], ['hop_length', 256]] },
        axes: { x: 'Time [s]', y: /^RMS.* \[.+\]$/u, delta: /^Δ RMS.* = Compare 1 − Base \[.+\]$/u },
        at: /^\d+\.\d{2,} s$/u, value: /^\d\.\d+(e[−-]\d+)?( \S+)?$/u,
        headline: /^largest Δ \(Compare 1 − Base\) \d+\.\d{2,} s [+−]\d\.\d+(e[−-]\d+)?( \S+)?$/u,
    },
    {
        name: 'an RMS level over time', shot: 'rms-db',
        step: { operation: 'wandas.audio.rms_trend', version: 3, entries: [['dB', true], ['frame_length', 1024], ['hop_length', 256]] },
        axes: { x: 'Time [s]', y: /^RMS.* \[dBFS\]$/u, delta: /^Δ = Compare 1 − Base \[dB\]$/u },
        at: /^\d+\.\d{2,} s$/u, value: /^[−-]?\d+\.\d dBFS$/u,
        headline: /^largest Δ \(Compare 1 − Base\) \d+\.\d{2,} s [+−]\d+\.\d dB$/u,
    },
    {
        name: 'a cepstrum', shot: 'cepstrum',
        step: { operation: 'wandas.audio.cepstrum', version: 3, entries: [] },
        axes: { x: 'Quefrency [s]', y: /^Real cepstrum \[–\]$/u, delta: /^Δ Real cepstrum = Compare 1 − Base \[–\]$/u },
        at: /^\d+\.\d{4,} s$/u, value: /^[−-]?\d+(\.\d+)?(e[−-]\d+)?$/u,
        headline: /^largest Δ \(Compare 1 − Base\) \d+\.\d{4,} s [+−]\d+(\.\d+)?(e[−-]\d+)?$/u,
    },
    {
        // Bars: a level a band, read at its band's centre; every band drawn (the bands are never thinned).
        name: 'the levels of 1/3-octave bands', shot: 'bands',
        step: { operation: 'wandas.audio.noct_spectrum', version: 1, entries: [['fmax', 4000], ['fmin', 50], ['n', 3]] },
        axes: { x: 'Band centre [Hz]', y: /^Level.* \[dBFS\]$/u, delta: /^Δ = Compare 1 − Base \[dB\]$/u },
        at: /^[\d.]+ k?Hz$/u, value: /^[−-]?\d+\.\d dBFS$/u,
        headline: /^largest Δ \(Compare 1 − Base\) [\d.]+ k?Hz [+−]\d+\.\d dB$/u,
    },
    {
        name: 'a coherence of two channels', shot: 'coherence', pair: true,
        step: { operation: 'wandas.audio.coherence', version: 2, entries: [['n_fft', 1024]] },
        axes: { x: 'Frequency [Hz]', y: /^Coherence γ² · ch2 \/ ch1 \[–\]$/u, delta: /^Δ Coherence γ² · ch2 \/ ch1 = Compare 1 − Base \[–\]$/u },
        at: /^\d+(\.\d+)? k?Hz$/u, value: /^\d\.\d+(e[−-]\d+)?$/u,
        headline: /^largest Δ \(Compare 1 − Base\) \d+(\.\d+)? k?Hz [+−]\d\.\d+(e[−-]\d+)?$/u,
    },
    {
        name: 'a transfer function of two channels', shot: 'transfer', pair: true,
        step: { operation: 'wandas.audio.transfer_function', version: 2, entries: [['n_fft', 1024]] },
        axes: { x: 'Frequency [Hz]', y: /^Gain.* · ch2 \/ ch1 \[dB\]$/u, delta: /^Δ = Compare 1 − Base \[dB\]$/u },
        at: /^\d+(\.\d+)? k?Hz$/u, value: /^[+−-]?\d+\.\d dB$/u,
        headline: /^largest Δ \(Compare 1 − Base\) \d+(\.\d+)? k?Hz [+−]\d+\.\d dB$/u,
    },
    {
        name: 'a cross spectrum of two channels', shot: 'csd', pair: true,
        step: { operation: 'wandas.audio.csd', version: 2, entries: [['n_fft', 1024]] },
        axes: { x: 'Frequency [Hz]', y: /^Level.* · ch2 \/ ch1 \[dB re 1 FS\^2\]$/u, delta: /^Δ = Compare 1 − Base \[dB\]$/u },
        at: /^\d+(\.\d+)? k?Hz$/u, value: /^[−-]?\d+\.\d dB re 1 FS\^2$/u,
        headline: /^largest Δ \(Compare 1 − Base\) \d+(\.\d+)? k?Hz [+−]\d+\.\d dB$/u,
    },
    {
        name: 'a cross-correlation of two channels', shot: 'correlation', pair: true,
        step: { operation: 'wandas.audio.cross_correlation', version: 1, entries: [] },
        axes: { x: 'Lag [s]', y: /^Correlation coefficient · ch2 \/ ch1 \[–\]$/u, delta: /^Δ Correlation coefficient · ch2 \/ ch1 = Compare 1 − Base \[–\]$/u },
        at: /^[+−]\d+\.\d{4,} s$/u, value: /^[−-]?\d\.\d+(e[−-]\d+)?$/u,
        headline: /^largest Δ \(Compare 1 − Base\) [+−]\d+\.\d{4,} s [+−]\d\.\d+(e[−-]\d+)?$/u,
    },
];

test.beforeAll(async () => {
    scanRecipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as Record<string, unknown>;
    try {
        backend = new RealBackend();
        // The table's rows are of the entry's own scan (its average spectrum); the comparison then runs the chain with
        // the average spectrum swapped for the kind's step.
        for (const fixture of ['narrow', 'pairLines'] as const) {
            const folder = mkdtempSync(path.join(tmpdir(), `figure-lines-ui-${fixture}-`));
            folders.push(folder);
            const written = runFixture(path.join('src', 'test', 'fixtures', fixture, 'generate.py'), [folder]);
            if (!written.out) { fixtureError = written.error ?? ''; return; }
            const scanned: ScannedFile[] = [];
            for (const filePath of written.out.trim().split('\n')) scanned.push({ filePath, result: await backend.request({ cmd: 'scan', filePath, recipe: scanRecipe, stage: String(scanRecipe.output) }) });
            scannedOf[fixture] = scanned;
        }
    } catch (error) {
        fixtureError = error instanceof Error ? error.message : String(error);
    }
});
test.afterAll(() => {
    backend?.close();
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const ready = (): boolean => {
    const all = !!scannedOf.narrow && !!scannedOf.pairLines;
    if (!all && backendRequired()) throw new Error(`the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo's .venv) but the fixtures could not be analysed: ${fixtureError}`);
    return all;
};

function recipeOf(kind: Kind): Record<string, unknown> {
    const recipe = JSON.parse(JSON.stringify(scanRecipe)) as Record<string, unknown>;
    const nodes = recipe.nodes as Array<Record<string, unknown>>;
    nodes[2] = { ...nodes[2], operation: kind.step.operation, version: kind.step.version, params: { $type: 'map', entries: kind.step.entries } };
    if (kind.pair) {
        nodes.push({ id: 'node-3', operation: 'wandas.frame.select_pair', version: 1, inputs: ['node-2'], params: { $type: 'map', entries: [['input', 0], ['output', 1]] } });
        recipe.output = 'node-3';
    }
    return recipe;
}

type Point = [number, number];
interface Seen {
    waiting: boolean; pictureId: string | null; readout: string; headline: string; failure: string | null;
    lanes: Array<{ id: string; frame: { left: number; top: number; width: number; height: number }; range: { x: [number, number]; y: [number, number] } | null; axisNames: { x: string; y: string }; order: string[]; lines: Array<{ id: string; colour: string; points: Array<Point | null> }> }>;
    mark: { lane: string; line: string; index: number; x: number; value: number; px: number; py: number } | null;
}
const FIGURE = '[data-stage-figure] canvas[data-figure]';
const seen = (page: Page): Promise<Seen> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());

/** The base recording in slot 0, the compared one in slot 1, the comparison opened on the chain's last step, drawn. */
async function openComparison(page: Page, recipe: Record<string, unknown>, files: ScannedFile[], channels: number): Promise<() => Promise<string[]>> {
    const lastStep = (recipe.nodes as Array<{ id: string }>).at(-1)!.id;
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEntry(page, files, { language: 'en', recipe });
    const stop = await bridgeComparison(page, backend!, recipe);
    // Rows are a recording's channels: the first row is the base, the first row of the other recording the compared one.
    const rows = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(items => items.map(row => row.getAttribute('data-file-path')!));
    await page.keyboard.press('0');
    for (let step = 0; step < rows.findIndex(filePath => filePath !== rows[0]); step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    const paths = files.map(file => file.filePath);
    await page.evaluate(({ paths, channels }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: channels, sampleCount: 32000,
        channels: ['L', 'R'].slice(0, channels).map(label => ({ label, peakAbsolute: 0.1, fullScale: true, waveform: { min: [-0.1, -0.1], max: [0.1, 0.1], minT: [0.1, 1.1], maxT: [0.4, 1.4], absolutePeak: 0.1 } })),
    })) } })), { paths, channels });
    await expect(page.locator('.track-stage')).toBeVisible();
    const bar = page.locator('.track-stage-bar');
    const last = bar.locator(`[data-step-hold="${lastStep}"]`);
    await expect(last).toBeVisible();
    // The bar is drawn again while the comparison opens, and a click landing in between is lost (no step is
    // shown, and this wait ran out under load): the click is made again until the step is the one shown.
    await expect(async () => {
        if ((await bar.getAttribute('data-stage')) !== lastStep) await last.click();
        await expect(bar).toHaveAttribute('data-stage', lastStep, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    // Overlaid (a step that is not an image is overlaid by default; the toggle says so).
    await expect(page.locator('.track-stage')).toHaveAttribute('data-figure', 'true', { timeout: 30_000 });
    await expect.poll(async () => {
        const now = await seen(page);
        return !now.waiting && (now.lanes[0]?.lines.length ?? 0) >= 2;
    }, { timeout: 30_000, message: 'the Figure drew the base and the compared recording' }).toBe(true);
    return stop;
}

for (const kind of KINDS) {
    test(`${kind.name} is overlaid by the one Figure of the new path: its axes named, its point read and its Δ headed in its own units`, async ({ page }) => {
        test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
        test.setTimeout(120_000);
        const stop = await openComparison(page, recipeOf(kind), scannedOf[kind.pair ? 'pairLines' : 'narrow']!, kind.pair ? 2 : 1);
        await expect(page.locator('[data-stage-canvas="overlay"]')).toBeHidden();
        await expect(page.locator('[data-stage-canvas="diff"]')).toBeHidden();
        const now = await seen(page);
        expect(now.failure).toBeNull();
        expect(now.lanes.map(lane => lane.id)).toEqual(['overlay']);
        expect(now.lanes[0].order).toEqual(['base', 'compare1']);
        expect(now.lanes[0].lines.map(line => line.colour)).toEqual(['#3b82f6', '#d4b20f']);
        expect(now.lanes[0].axisNames.x).toBe(kind.axes.x);
        expect(now.lanes[0].axisNames.y).toMatch(kind.axes.y);
        // Across, the answers' own first and last point: nothing before 0 (a lag is about 0), and the whole of it drawn.
        const [low, high] = now.lanes[0].range!.x;
        if (kind.axes.x !== 'Lag [s]') expect(low).toBeGreaterThanOrEqual(0);
        else expect(low).toBeCloseTo(-high, 6);
        expect(high).toBeGreaterThan(low);

        // R7: the point read, at its place across in the axis's unit, its value in its unit.
        const lane = now.lanes[0];
        if (kind.shot === 'bands') {
            // Bars: one a band, every band of the answer (50 Hz to 4 kHz in thirds: 20), each around its centre, meeting its neighbour.
            const line = lane.lines[1] as typeof lane.lines[1] & { bars?: Array<[number, number, number] | null> };
            expect(line.bars?.length).toBe(20);
            line.bars!.forEach((bar, index) => {
                const point = line.points[index]!;
                expect(bar![0]).toBeLessThan(point[0]);
                expect(bar![1]).toBeGreaterThan(point[0]);
                expect(bar![2]).toBe(point[1]);
                if (index > 0) expect(bar![0]).toBeCloseTo(line.bars![index - 1]![1], 6);
            });
        }
        const drawn = lane.lines[1].points.filter((point): point is Point => !!point && point[0] > lane.frame.left + 40 && point[0] < lane.frame.left + lane.frame.width - 40);
        expect(drawn.length, 'the compared line is drawn').toBeGreaterThan(4);
        const at = drawn[Math.floor(drawn.length / 2)];
        const box = (await page.locator(FIGURE).boundingBox())!;
        await page.mouse.move(box.x + at[0], box.y + at[1]);
        await expect.poll(async () => (await seen(page)).mark !== null, { timeout: 15_000 }).toBe(true);
        await settled(page);
        const read = await seen(page);
        const parts = read.readout.split(' / ');
        expect(parts.length, `the readout "${read.readout}" is a name, a place and a value`).toBe(3);
        expect(parts[1]).toMatch(kind.at);
        expect(parts[2]).toMatch(kind.value);
        expect(Math.hypot(read.mark!.px - at[0], read.mark!.py - at[1]), 'the mark is at a point near the pointer').toBeLessThan(20);
        // → steps one point of the answer, on the same line.
        await page.keyboard.press('ArrowRight');
        await expect.poll(async () => (await seen(page)).mark?.index, { timeout: 15_000 }).toBe(read.mark!.index + 1);
        const stepped = await seen(page);
        expect(stepped.mark!.line).toBe(read.mark!.line);
        expect(stepped.mark!.x).toBeGreaterThan(read.mark!.x);

        // Δ: a lane under the overlay sharing the axis across, named as a Δ of the quantity, headed in its units.
        await page.locator('[data-action="stage-diff"]').click();
        await expect.poll(async () => (await seen(page)).lanes.map(item => item.id), { timeout: 30_000 }).toEqual(['overlay', 'delta']);
        await expect.poll(async () => !(await seen(page)).waiting, { timeout: 30_000 }).toBe(true);
        const both = await seen(page);
        expect(both.lanes[1].range!.x).toEqual(both.lanes[0].range!.x);
        expect(both.lanes[1].axisNames.x).toBe(kind.axes.x);
        expect(both.lanes[1].axisNames.y).toMatch(kind.axes.delta);
        await expect(page.locator('[data-stage-figure-headline]')).toHaveText(kind.headline);
        if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, `lines-${kind.shot}.png`) });
        expect(await stop(), 'the backend answered every request').toEqual([]);
    });
}
