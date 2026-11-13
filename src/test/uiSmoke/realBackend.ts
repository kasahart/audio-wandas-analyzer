import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { testPython } from '../helpers/python';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/** The Python with wandas the tests use, found as the extension finds it (helpers/python.ts). */
export function backendPython(): string | undefined {
    return testPython();
}

/** Runs a fixture script with that Python; its stdout, or undefined (with why in `error`) when it fails. */
export function runFixture(script: string, args: string[]): { out?: string; error?: string } {
    const python = backendPython();
    if (!python) return { error: 'no Python found' };
    const run = spawnSync(python, [path.join(repoRoot, script), ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    return run.status === 0 ? { out: run.stdout } : { error: `exit ${run.status}: ${(run.stderr ?? '').slice(-2000)}` };
}

/**
 * The analyzer's own backend (backend_server.py, newline-delimited JSON) in a process of its own, as the extension
 * runs it: a test sends it the commands the host would and gets its real answers.
 */
export class RealBackend {
    private readonly child: ChildProcess;
    private readonly waiting = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: Error): void }>();
    private buffered = '';
    private count = 0;

    constructor() {
        const python = backendPython();
        if (!python) throw new Error('no Python found for the backend');
        this.child = spawn(python, [path.join(repoRoot, 'python-backend', 'backend_server.py')], { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AWA_PERF_LOG: '0' } });
        this.child.stdout!.setEncoding('utf8');
        this.child.stdout!.on('data', (chunk: string) => {
            this.buffered += chunk;
            let newline: number;
            while ((newline = this.buffered.indexOf('\n')) >= 0) {
                const line = this.buffered.slice(0, newline);
                this.buffered = this.buffered.slice(newline + 1);
                let message: Record<string, unknown>;
                try { message = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
                const id = typeof message.requestId === 'string' ? message.requestId : '';
                const waiter = this.waiting.get(id);
                if (!waiter || message.type === 'started' || message.type === 'heartbeat') continue;
                this.waiting.delete(id);
                if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
                else waiter.resolve(message);
            }
        });
        // A backend that dies (wandas missing at import, a crash) fails every request waiting on it, with why.
        let stderr = '';
        this.child.stderr!.setEncoding('utf8');
        this.child.stderr!.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
        const failAll = (why: string): void => {
            this.dead = `${why}${stderr.trim() ? `: ${stderr.trim().slice(-2000)}` : ''}`;
            for (const waiter of this.waiting.values()) waiter.reject(new Error(this.dead));
            this.waiting.clear();
        };
        this.child.on('exit', (code, signal) => failAll(`the backend exited (${signal ?? `code ${code}`})`));
        this.child.on('error', error => failAll(`the backend could not run: ${error.message}`));
    }

    /** Why the backend is gone, once it is. */
    private dead = '';

    /** One command (`cmd` and its fields) and the backend's answer, without its requestId. */
    request(command: Record<string, unknown>): Promise<Record<string, unknown>> {
        const requestId = `test-${++this.count}`;
        return new Promise((resolve, reject) => {
            if (this.dead) { reject(new Error(this.dead)); return; }
            this.waiting.set(requestId, { resolve: ({ requestId: _id, ...result }) => resolve(result), reject });
            this.child.stdin!.write(`${JSON.stringify({ ...command, requestId })}\n`);
        });
    }

    close(): void {
        this.child.stdin!.end();
        this.child.kill();
    }
}

type Posted = Record<string, unknown> & { type: string; requestId: string };

/**
 * Runs in the page: posts a request's last answer as the host does, and tells settled() the request is answered.
 * window.postMessage delivers in a task of its own, after this one; until then settled() counts the message itself
 * (canvasAudit.ts installSettleTracker), so the page is not quiet before it has read the answer and scheduled whatever
 * it draws from it. Otherwise, under load, the frames settled() waits on could come first and a readout read then is
 * the one before the answer (empty while its full data is pending, R7): the test would fail on the page's correct
 * behaviour.
 */
export function postLastAnswer({ data, requestId }: { data: { type: string; requestId: string; [field: string]: unknown }; requestId: string }): void {
    window.postMessage(data, '*');
    (window as unknown as { __settle?: { answered(requestId: string): void } }).__settle?.answered(requestId);
}

/**
 * Answers the comparison's requests on `page` as the host does, from `backend`: each picture asked for ('compare-scan',
 * file by file, then done) and each median and difference ('compare-combine'). The ui-smoke page's own stand-in for
 * the combine is held off. Returns a stop function, which resolves to the backend's refusals.
 */
export async function bridgeComparison(page: Page, backend: RealBackend, entryRecipe: Record<string, unknown>): Promise<() => Promise<string[]>> {
    await page.evaluate(types => {
        (window as unknown as { __uiSmokeHoldCombine: boolean }).__uiSmokeHoldCombine = true;
        // The page has not answered what it asked until the backend has (canvasAudit.ts settled()).
        (window as unknown as { __settle?: { awaitHost(types: readonly string[]): void } }).__settle?.awaitHost(types);
    }, ['compare-scan', 'compare-combine']);
    let seen = 0;
    let stopped = false;
    const failures: string[] = [];
    const pending: Array<Promise<void>> = [];
    const post = (message: unknown): Promise<void> => page.evaluate(data => window.postMessage(data, '*'), message);
    /** The request's last answer, after which settled() no longer waits for it: once the page has read it. */
    const close = (requestId: string, message: { type: string; requestId: string; [field: string]: unknown }): Promise<void> => page.evaluate(postLastAnswer, { data: message, requestId });
    const answer = async (message: Posted): Promise<void> => {
        if (message.type === 'compare-scan') {
            const { requestId, filePaths, recipe, region, stage, detail, reference, spectrumBins } = message as Posted & { filePaths: string[] };
            for (const filePath of filePaths) {
                // What the host passes on (panelController.ts): the entry Recipe when the request names none.
                const fields = { recipe: recipe ?? entryRecipe, region, stage, detail, reference, spectrumBins: spectrumBins || undefined };
                const result = await backend.request({ cmd: 'scan', filePath, ...fields });
                if (!stopped) await post({ type: 'compare-scan-result', requestId, filePath, result });
            }
            if (!stopped) await close(requestId, { type: 'compare-scan-done', requestId });
        } else if (message.type === 'compare-combine') {
            const { type: _type, requestId, ...fields } = message;
            const result = await backend.request({ cmd: 'stage-combine', ...fields });
            if (!stopped) await close(requestId, { type: 'compare-combine-result', requestId, result });
        }
    };
    const poll = async (): Promise<void> => {
        while (!stopped && !page.isClosed()) {
            const posted = await page.evaluate(from => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages.slice(from), seen).catch(() => [] as Posted[]);
            seen += posted.length;
            for (const message of posted) if (message.type === 'compare-scan' || message.type === 'compare-combine') pending.push(answer(message).catch((error: unknown) => { failures.push(String(error)); }));
            await new Promise(resolve => setTimeout(resolve, 30));
        }
    };
    const running = poll();
    // Stopped, the bridge says whether the backend refused any request: a refusal is a test failure, not a skip.
    return async () => { stopped = true; await running; await Promise.all(pending); return failures; };
}
