import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { buildUiSmokeEntryHtml } from './buildHtml';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
export interface ScannedFile { filePath: string; result: Record<string, unknown> }

let cached: ScannedFile[] | null | undefined;
let metadataText = '';

/** The fixture's motor.csv as written beside the recordings (after `entry100Results`). */
export function entry100Metadata(): string {
    return metadataText;
}

/** Real scan results for the entry100 fixture, from the Python backend (generated once per worker, never committed). */
export function entry100Results(): ScannedFile[] | undefined {
    if (cached === undefined) cached = scanEntry100() ?? null;
    return cached ?? undefined;
}

function scanEntry100(): ScannedFile[] | undefined {
    const python = [path.join(repoRoot, '.venv', 'bin', 'python'), process.env.WANDAS_PYTHON, 'python3']
        .find(candidate => candidate && (candidate === 'python3' || existsSync(candidate)));
    if (!python) return undefined;
    const out = mkdtempSync(path.join(tmpdir(), 'entry100-ui-'));
    try {
        const run = spawnSync(python, [path.join(repoRoot, 'src', 'test', 'fixtures', 'entry100', 'scan.py'), out], {
            encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
        });
        if (run.status !== 0) return undefined;
        metadataText = readFileSync(path.join(out, 'motor.csv'), 'utf8');
        return JSON.parse(run.stdout) as ScannedFile[];
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
}


/** Opens the entry screen and answers its request for stored results the way a host does: the Recipe, one result per file, done. */
export interface OpenEntryOptions {
    language?: string;
    /** The conditions the host reports, e.g. a metadata table it found, and the listed file it was read from. */
    table?: unknown;
    metadataPath?: string;
    /** The entry Recipe the host reports for the step bar. */
    recipe?: unknown;
    /** Answers only this many files and leaves the scan running. */
    answered?: number;
    /** What the files' headers say, by path: a channel count or an error. Every probe is answered and finished; `null` leaves it running. */
    headers?: Record<string, number | string> | null;
}

export async function openEntry(page: Page, files: ScannedFile[], options: OpenEntryOptions | string = {}): Promise<number> {
    const { language = 'en', table = null, metadataPath, recipe, answered = files.length, headers = {} } = typeof options === 'string' ? { language: options } : options;
    const listed = [...files.map(file => file.filePath), ...(metadataPath ? [metadataPath] : [])];
    await page.setContent(buildUiSmokeEntryHtml(listed, language), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#entry-screen')).toBeVisible();
    const request = await page.waitForFunction(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; requestId?: string }> })
        .__uiSmokePostedMessages.find(message => message.type === 'entry-scan'));
    const { requestId } = await request.jsonValue() as { requestId: string };
    if (headers) await answerProbe(page, headers);
    return page.evaluate(({ requestId, files, table, metadataPath, recipe, answered }) => new Promise<number>(resolve => {
        const started = performance.now();
        window.postMessage({ type: 'entry-conditions', requestId, table, ...(metadataPath ? { metadataPath } : {}), ...(recipe ? { recipe } : {}) }, '*');
        for (const file of files.slice(0, answered)) window.postMessage({ type: 'entry-scan-result', requestId, filePath: file.filePath, result: file.result }, '*');
        if (answered === files.length) window.postMessage({ type: 'entry-scan-done', requestId }, '*');
        // Answered results draw as rows (one per channel): the table is ready once they are there.
        const check = (): void => {
            if (!answered || document.querySelectorAll('[data-entry-rows] tr.entry-row').length >= Math.min(answered, 20)) resolve(performance.now() - started);
            else requestAnimationFrame(check);
        };
        check();
    }), { requestId, files, table, metadataPath, recipe, answered });
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
            if (!text || element.closest('tbody, [hidden], option, [data-entry-slots] button:not(.entry-chip-base)')) continue;
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
export async function answerProbe(page: Page, headers: Record<string, number | string>): Promise<void> {
    const probe = await page.waitForFunction(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'entry-probe').at(-1));
    const { requestId, filePaths } = await probe.jsonValue() as unknown as { requestId: string; filePaths: string[] };
    await page.evaluate(({ requestId, filePaths, headers }) => {
        for (const filePath of filePaths) {
            const header = headers[filePath];
            if (header === undefined) continue;
            window.postMessage({ type: 'entry-probe-result', requestId, filePath, ...(typeof header === 'number' ? { channels: header } : { error: header }) }, '*');
        }
        window.postMessage({ type: 'entry-probe-done', requestId }, '*');
    }, { requestId, filePaths, headers });
}
