import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { backendRequired, testPython } from '../helpers/python';
import { buildUiSmokeEntryHtml } from './buildHtml';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
export interface ScannedFile { filePath: string; result: Record<string, unknown> }

let cached: ScannedFile[] | null | undefined;
let metadataText = '';

/** The fixture's motor.csv as written beside the recordings (after `entry100Results`). */
export function entry100Metadata(): string {
    return metadataText;
}

export { backendRequired };

/** Real scan results for the entry100 fixture, from the Python backend (generated once per worker, never committed). */
export function entry100Results(): ScannedFile[] | undefined {
    if (cached === undefined) cached = scanEntry100() ?? null;
    // Where the backend is required (CI), a test that needs it fails instead of skipping, so it cannot pass unseen.
    if (cached === null && backendRequired()) throw new Error(`the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo's .venv) but the entry100 fixture could not be scanned: ${scanError}`);
    return cached ?? undefined;
}

let scanError = '';
function scanEntry100(): ScannedFile[] | undefined {
    const python = testPython();
    if (!python) { scanError = 'no Python found'; return undefined; }
    const out = mkdtempSync(path.join(tmpdir(), 'entry100-ui-'));
    try {
        const run = spawnSync(python.command, [...python.args, path.join(repoRoot, 'src', 'test', 'fixtures', 'entry100', 'scan.py'), out], {
            encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
        });
        if (run.status !== 0) { scanError = `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}${run.error ? ` ${String(run.error)}` : ''}: ${(run.stderr ?? '').slice(-2000)}`; return undefined; }
        metadataText = readFileSync(path.join(out, 'motor.csv'), 'utf8');
        return JSON.parse(run.stdout) as ScannedFile[];
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
}


/**
 * Opens the entry screen and answers it the way a host does: the folder's Recipe, session and CSV (entry-conditions),
 * and what each file's header says. No scan is asked for and none is answered: the entry analyses nothing.
 */
export interface OpenEntryOptions {
    language?: string;
    /** The conditions the host reports, e.g. a metadata table it found, and the listed file it was read from. */
    table?: unknown;
    metadataPath?: string;
    /** The entry Recipe the host reports for the step bar. */
    recipe?: unknown;
    /** The folder's stored session and CSV, as a host gives them back at open. */
    session?: Record<string, unknown>;
    csv?: { name: string; text: string };
    /**
     * What the files' headers say, by path: a channel count, an error, or its channels, length and rate. A file not
     * named here is answered with its fixture's own header (`result.input`). `null` leaves the probe running.
     */
    headers?: Record<string, number | string | { channels: number; durationS: number; sampleRate?: number; calibrated?: boolean }> | null;
    /** The table opens beside the tracks; most table checks widen it first (⤢), as a user looking at many rows does. */
    docked?: boolean;
}

type Header = number | string | { channels: number; durationS: number; sampleRate?: number; calibrated?: boolean };

/**
 * A fixture file's own header, as the host's probe reads it: its channels, length, rate and whether it is calibrated.
 * A file the fixture could not read has no header: the probe says why, which is how the entry knows it is unreadable.
 */
function headerOf(file: ScannedFile): Header | undefined {
    if (file.result.ok === false) return typeof file.result.reason === 'string' && file.result.reason ? file.result.reason : 'not a WAV header';
    const input = file.result.input as { channels?: unknown[]; durationS?: number; fs?: number; calibrationStatus?: string } | undefined;
    if (!input || !Array.isArray(input.channels) || typeof input.durationS !== 'number') return undefined;
    return { channels: input.channels.length, durationS: input.durationS, ...(typeof input.fs === 'number' ? { sampleRate: input.fs } : {}), calibrated: input.calibrationStatus === 'calibrated' };
}

export async function openEntry(page: Page, files: ScannedFile[], options: OpenEntryOptions | string = {}): Promise<number> {
    const { language = 'en', table = null, metadataPath, recipe, headers = {}, session, csv, docked = false } = typeof options === 'string' ? { language: options } : options;
    const listed = [...files.map(file => file.filePath), ...(metadataPath ? [metadataPath] : [])];
    await page.setContent(buildUiSmokeEntryHtml(listed, language), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#entry-screen')).toBeVisible();
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    if (!docked) await page.locator('[data-action="entry-maximize"]').click();
    const request = await page.waitForFunction(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; requestId?: string }> })
        .__uiSmokePostedMessages.find(message => message.type === 'entry-open'));
    const { requestId } = await request.jsonValue() as { requestId: string };
    if (headers) {
        const own: Record<string, Header> = {};
        for (const file of files) { const header = headerOf(file); if (header !== undefined) own[file.filePath] = header; }
        await answerProbe(page, { ...own, ...headers });
    }
    return page.evaluate(({ requestId, count, table, metadataPath, recipe, session, csv }) => new Promise<number>(resolve => {
        const started = performance.now();
        window.postMessage({ type: 'entry-conditions', requestId, table, ...(metadataPath ? { metadataPath } : {}), ...(recipe ? { recipe } : {}), ...(session ? { session } : {}), ...(csv ? { csv } : {}) }, '*');
        // The listed files draw as rows: the table is ready once they are there.
        const check = (): void => {
            if (!count || document.querySelectorAll('[data-entry-rows] tr.entry-row').length >= Math.min(count, 20)) resolve(performance.now() - started);
            else requestAnimationFrame(check);
        };
        check();
    }), { requestId, count: files.length, table, metadataPath, recipe, session, csv });
}

/** Visible words outside the rows: numbers, Δ and ✕ marks, file names in the slot chips do not count. */
export function countTextElements(page: Page, root = 'entry-screen'): Promise<number> {
    return page.evaluate((id) => {
        const screen = document.getElementById(id)!;
        const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
        let count = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const element = node.parentElement!;
            const text = (node.textContent ?? '').trim();
            if (!text || element.closest('tbody, [hidden], option')) continue;
            if (/^[\d\s./·+−\-—✕Δ▼]*$/u.test(text)) continue;
            count++;
        }
        return count;
    }, root);
}


/** Picks a CSV with 「CSV を選ぶ」 (its hidden file input), as the user does. */
export async function pickCsv(page: Page, name: string, text: string): Promise<void> {
    await page.locator('[data-entry-csv-input]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
}

/** Answers the entry screen's latest header probe as a host does: one result per named file, then done. */
export async function answerProbe(page: Page, headers: Record<string, Header>): Promise<void> {
    const probe = await page.waitForFunction(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'entry-probe').at(-1));
    const { requestId, filePaths } = await probe.jsonValue() as unknown as { requestId: string; filePaths: string[] };
    await page.evaluate(({ requestId, filePaths, headers }) => {
        for (const filePath of filePaths) {
            const header = headers[filePath];
            if (header === undefined) continue;
            window.postMessage({ type: 'entry-probe-result', requestId, filePath, ...(typeof header === 'number' ? { channels: header } : typeof header === 'string' ? { error: header } : header) }, '*');
        }
        window.postMessage({ type: 'entry-probe-done', requestId }, '*');
    }, { requestId, filePaths, headers });
}

/**
 * Opens the track view's 比較解析 (the steps view), where the chain is edited: the focused row in slot 1, Enter,
 * the host's tracks, and the first stage scan answered with `view`. Returns the slotted file.
 */
export async function openStepsView(page: Page, files: ScannedFile[], view: Record<string, unknown>): Promise<string> {
    const first = (await page.locator('[data-entry-rows] tr.is-focused, [data-entry-rows] tr.entry-row').first().getAttribute('data-file-path'))!;
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    await page.evaluate(filePath => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    }] } })), first);
    await expect(page.locator('.track-stage-bar')).toBeVisible();
    type Scan = { type: string; requestId: string; filePaths: string[] };
    const request = await page.waitForFunction(() => (window as unknown as { __uiSmokePostedMessages: Scan[] }).__uiSmokePostedMessages
        .filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage')).at(-1));
    const scan = await request.jsonValue() as Scan;
    await page.evaluate(({ scan, view, files }) => {
        for (const filePath of scan.filePaths) {
            const file = files.find(item => item.filePath === filePath);
            if (file) window.postMessage({ type: 'compare-scan-result', requestId: scan.requestId, filePath, result: { ...file.result, stage: view } }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: scan.requestId }, '*');
    }, { scan, view, files });
    return first;
}
