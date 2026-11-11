/**
 * Fixed differences over a region measured again (entryRemeasure.ts, class sweep 4 V5, V6, B1): found by key, never
 * by the row object; written only under the chain they were measured under while it is the one now; each file's scan
 * kept in the answer store under its epoch.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompareScanMessage } from '../shared/analysis/entryScan';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { recipeKey } from '../shared/recipe/recipeSteps';
import { createRemeasure } from '../webview/runtime/entryRemeasure';
import { derivedKey, type DerivedRow } from '../webview/runtime/entryTable';

const ok = (leq: number): ScanResult => ({ ok: true, conditionId: `c${leq}`, leqDbA: [leq] });
const recipe = (name: string): RecipeDocument => ({ schema: 'wandas.recipe', version: 3, inputs: [], nodes: [{ id: name, operation: name, inputs: [] }], output: name } as unknown as RecipeDocument);

function harness() {
    let chain = recipe('r1');
    const epochs: Record<string, string> = {};
    let derived: DerivedRow[] = [
        { parentPath: '/a.wav', region: '0.50–1.50', result: ok(1), recipeKey: 'old', stale: true, base: { leq: 0, bands: [], paths: ['/b.wav'] } },
        { parentPath: '/c.wav', region: '0.50–1.50', result: ok(2), recipeKey: 'old', stale: true, base: { leq: 0, bands: [], paths: ['/b.wav'] } },
    ];
    const posted: CompareScanMessage[] = [];
    let count = 0;
    const remeasure = createRemeasure({
        derived: () => derived, recipe: () => chain, fileEpoch: path => epochs[path] ?? '0.0', post: message => posted.push(message),
        requestId: row => `derived|${derivedKey(row)}-${++count}`,
        remeasured: (row, compared, base, key) => (compared.state === 'ready' && base.every(item => item.state === 'ready') ? { ...row, result: compared.value, recipeKey: key, stale: false } : null),
        // As keepDerived does for one row measured again: every row a new object (the worst case for object identity).
        replace: (row, next) => { derived = derived.map(item => (item === row ? next : { ...item })); },
    });
    const answer = (message: CompareScanMessage, leq: number): void => {
        for (const filePath of message.filePaths) remeasure.handle({ type: 'compare-scan-result', requestId: message.requestId, filePath, result: ok(leq) });
    };
    const done = (message: CompareScanMessage): boolean => remeasure.handle({ type: 'compare-scan-done', requestId: message.requestId });
    return { remeasure, posted, answer, done, rows: () => derived, setChain: (next: RecipeDocument) => { chain = next; }, epochs };
}

test('two differences measured again at once are both written, though the first one\'s answer made new rows (V5)', () => {
    const h = harness();
    for (const row of h.rows()) h.remeasure.ask(row);
    assert.equal(h.posted.length, 2);
    h.answer(h.posted[0], 10);
    h.done(h.posted[0]);
    h.answer(h.posted[1], 20);
    h.done(h.posted[1]);
    assert.deepEqual(h.rows().map(row => [row.parentPath, row.stale, row.recipeKey]), [['/a.wav', false, recipeKey(recipe('r1'))], ['/c.wav', false, recipeKey(recipe('r1'))]]);
});

test('a difference measured under a chain that is no longer the one now is not written, nor named by the new one (V6)', () => {
    const h = harness();
    h.remeasure.ask(h.rows()[0]);
    h.answer(h.posted[0], 10);
    h.setChain(recipe('r2'));
    assert.equal(h.done(h.posted[0]), true);
    assert.deepEqual(h.rows().map(row => row.stale), [true, true], 'it stays ≠ until the next computation');
});

test('a file written over while its region was measured is no answer of it now (B1: the scans are kept under each file\'s epoch)', () => {
    const h = harness();
    h.remeasure.ask(h.rows()[0]);
    h.answer(h.posted[0], 10);
    h.epochs['/b.wav'] = '0.1';
    h.done(h.posted[0]);
    assert.equal(h.rows()[0].stale, true);
    assert.equal(h.remeasure.handle({ type: 'compare-scan-done', requestId: 'stage-1' }), false, 'another asker\'s answer is not this one\'s');
});
