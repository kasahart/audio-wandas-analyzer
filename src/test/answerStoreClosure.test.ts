/**
 * The answer store closed as a layer (class sweep 2, freshness): no raw map of the scans leaves it (only answers with
 * their state, the current ones as CurrentAnswers, every one for showing as ShownAnswers); a scan keeps what it was
 * asked under; a failure's pause and its retry are the store's alone; a fixed difference is ≠ once a file it is of
 * changed; each fixed difference measured again is its own asker on the host.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test, { mock } from 'node:test';
import { answerKey, createAnswerSlot, createAnswerStore, createFailureHold, FAILED_RETRY_MS } from '../webview/runtime/answerStore';
import { createHeaderProbe } from '../webview/runtime/entryHeaders';

const repoRoot = path.resolve(__dirname, '..', '..');

function webviewSources(): Array<{ file: string; text: string }> {
    const found: Array<{ file: string; text: string }> = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(path.join(repoRoot, dir)).sort()) {
            const rel = `${dir}/${name}`;
            if (statSync(path.join(repoRoot, rel)).isDirectory()) walk(rel);
            else if (rel.endsWith('.ts') && !rel.endsWith('.d.ts')) found.push({ file: rel, text: readFileSync(path.join(repoRoot, rel), 'utf8') });
        }
    };
    walk('src/webview');
    walk('src/shared');
    return found;
}

test('a failure\'s pause is kept by the store, and its owner is told once it is over: no source keeps a timer of its own', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        let told = 0;
        const retried = (): void => { told++; };
        const store = createAnswerStore<number>({ capacity: 4, retried });
        store.fail(answerKey({ ask: 'x', version: { by: 'request' } }), 'busy');
        createAnswerSlot<number>(undefined, retried).fail('busy', 'window 1');
        createFailureHold(undefined, retried).fail('/a.wav');
        mock.timers.tick(FAILED_RETRY_MS);
        assert.equal(told, 0, 'not before the pause is over');
        mock.timers.tick(20);
        assert.equal(told, 3);
    } finally {
        mock.timers.reset();
    }
    const timers = webviewSources().filter(({ file }) => file !== 'src/webview/runtime/answerStore.ts')
        .flatMap(({ file, text }) => (/setTimeout\([^)]*FAILED_RETRY_MS|schedule\(FAILED_RETRY_MS/.test(text) ? [file] : []));
    assert.deepEqual(timers, [], 'a retry after FAILED_RETRY_MS is scheduled by the store (its retried option)');
});

test('a header that could not be read is read again by itself once its pause is over', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        let now = 0;
        const reads: string[][] = [];
        const probe = createHeaderProbe(() => now, () => { const message = probe.start(['/a.wav'], () => 'probe-2'); if (message) reads.push(message.filePaths); });
        const first = probe.start(['/a.wav'], () => 'probe-1');
        assert.ok(first);
        probe.take({ type: 'entry-probe-result', requestId: 'probe-1', filePath: '/a.wav', error: 'being written' });
        now += FAILED_RETRY_MS + 20;
        mock.timers.tick(FAILED_RETRY_MS + 20);
        assert.deepEqual(reads, [['/a.wav']], 'nobody had to add a file or open the folder again');
    } finally {
        mock.timers.reset();
    }
});

