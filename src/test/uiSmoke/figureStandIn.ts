import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { backendPython } from './realBackend';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * The figure service for a ui-smoke page on the stand-in host (buildHtml.ts): the real service
 * (python-backend/figures/) in a process of its own, run by python-backend/tests/figure_stand_in.py, whose answers are
 * the pictures the test posted to the page. The page calls `__uiSmokeFigure` for each figure request; the process is
 * started on the first one, so a test that shows no Figure starts nothing. A test whose pictures the real backend
 * scanned answers the Figure from that backend instead (realBackend.ts bridgeComparison).
 */
export async function installFigureStandIn(page: Page): Promise<() => void> {
    let child: ChildProcess | null = null;
    let count = 0, buffered = '', stopped = false;
    // Each reply goes to the page as its line of JSON, parsed there: a picture of many long lines is megabytes, which
    // the browser's own JSON.parse reads in milliseconds and Playwright's serializer of objects in seconds.
    const waiting = new Map<number, (reply: string) => void>();
    const start = (): ChildProcess => {
        const python = backendPython();
        if (!python) throw new Error('no Python found for the figure service');
        const made = spawn(python, [path.join(repoRoot, 'python-backend', 'tests', 'figure_stand_in.py')], { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] });
        made.stdout.setEncoding('utf8');
        made.stdout.on('data', (chunk: string) => {
            buffered += chunk;
            let newline: number;
            while ((newline = buffered.indexOf('\n')) >= 0) {
                const line = buffered.slice(0, newline);
                buffered = buffered.slice(newline + 1);
                // (figure_stand_in.py writes the id first; any other line is parsed for it.)
                const id = Number(/^\{"id": (\d+),/.exec(line)?.[1] ?? (JSON.parse(line) as { id: number }).id);
                waiting.get(id)?.(line);
                waiting.delete(id);
            }
        });
        let stderr = '';
        made.stderr.setEncoding('utf8');
        made.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
        // A request written as the test ends (the page still asks while it closes) finds the process gone: not a failure of the test.
        made.stdin.on('error', () => undefined);
        made.on('exit', code => { for (const answer of waiting.values()) answer(JSON.stringify({ error: `the figure stand-in exited (${code}): ${stderr}` })); waiting.clear(); });
        return made;
    };
    // The page hands its request as JSON text too (the stand-in's answers can be megabytes), and gets the reply's line.
    await page.exposeFunction('__uiSmokeFigure', (request: string) => new Promise<string>(resolve => {
        if (stopped) { resolve(JSON.stringify({ error: 'the test ended' })); return; }
        child ??= start();
        const id = ++count;
        waiting.set(id, resolve);
        child.stdin!.write(`{"id": ${id}, ${request.slice(1)}\n`);
    }));
    return () => { stopped = true; child?.stdin?.end(); child?.kill(); child = null; };
}
