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
import ts from 'typescript';
import { compareScanAsker } from '../shared/analysis/entryScan';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { answerKey, createAnswerSlot, createAnswerStore, createFailureHold, createScanAnswers, FAILED_RETRY_MS, type CurrentAnswers, type ScanAnswers } from '../webview/runtime/answerStore';
import { createHeaderProbe } from '../webview/runtime/entryScanQueue';
import { derivedIsStale, derivedRemeasureId } from '../webview/runtime/entryRuntime';
import type { DerivedRow } from '../webview/runtime/entryTable';

const repoRoot = path.resolve(__dirname, '..', '..');
const ok = (conditionId: string): ScanResult => ({ ok: true, conditionId });

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

test('no raw map of the scans leaves the store: its type has no view, get, has or under, and a plain Map is no CurrentAnswers', () => {
    const scans: ScanAnswers = createScanAnswers();
    // @ts-expect-error the scans are handed only as answers (answer, answers) or as the store's own maps
    void scans.view;
    // @ts-expect-error no raw result of a file
    void scans.get;
    // @ts-expect-error no raw membership
    void scans.has;
    // @ts-expect-error what a scan was asked under is the store's to judge (stale)
    void scans.under;
    const counted = (answers: CurrentAnswers): number => answers.size;
    // @ts-expect-error a map of every scan (a stale one too) cannot be counted
    counted(new Map<string, ScanResult>());
    assert.equal(counted(scans.current()), 0);
});

test('outside the store nothing makes the store\'s maps of scans, nor keeps the latest scans itself', () => {
    const offenders = webviewSources().filter(({ file }) => file !== 'src/webview/runtime/answerStore.ts')
        .flatMap(({ file, text }) => [...text.matchAll(/as unknown as (CurrentAnswers|ShownAnswers)\b|createLatestAnswers<ScanResult\b/g)].map(match => `${file}: ${match[0]}`));
    assert.deepEqual(offenders, [], 'CurrentAnswers and ShownAnswers are made by createScanAnswers alone');
});

test('a scan keeps what it was asked under: a calibration changed while it ran makes it stale, and one not asked for is not kept', () => {
    const now = { recipeKey: 'r', epoch: 0 };
    const scans = createScanAnswers(() => ({ recipeKey: now.recipeKey, condition: () => String(now.epoch) }));
    scans.asking(['/a.wav']);
    now.epoch = 1; // the host said the file was calibrated anew while the backend measured it
    assert.equal(scans.answered('/a.wav', ok('old')), true);
    assert.equal(scans.answer('/a.wav').state, 'stale', 'measured under the old calibration');
    assert.equal(scans.current().has('/a.wav'), false);
    assert.equal(scans.answered('/b.wav', ok('x')), false, 'an answer of an asking already ended is not kept');
    assert.equal(scans.answer('/b.wav').state, 'missing');
    scans.asking(['/c.wav']);
    scans.settled();
    assert.equal(scans.answer('/c.wav').state, 'missing', 'stopped (中止, a new chain, a step that cannot run): not still computing');
});

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

test('a fixed difference is ≠ once a file it is of is of another chain, calibration or version', () => {
    const row: DerivedRow = { parentPath: '/c.wav', region: 'all', result: ok('c1'), recipeKey: 'r', base: { leq: 0, bands: [], paths: ['/a.wav', '/b.wav'] }, conditions: { '/c.wav': 'c1', '/a.wav': 'a1', '/b.wav': 'b1' } };
    const conditions: Record<string, string> = { '/c.wav': 'c1', '/a.wav': 'a1', '/b.wav': 'b1' };
    const stale = new Set<string>();
    const now = () => ({ recipeKey: 'r', stale: (file: string) => stale.has(file), conditionOf: (file: string) => conditions[file] ?? '' });
    assert.equal(derivedIsStale(row, now()), false);
    assert.equal(derivedIsStale(row, { ...now(), recipeKey: 'r2' }), true, 'another Recipe');
    stale.add('/b.wav');
    assert.equal(derivedIsStale(row, now()), true, 'the base file calibrated anew, not scanned again yet');
    stale.clear();
    conditions['/b.wav'] = 'b2';
    assert.equal(derivedIsStale(row, now()), true, 'scanned again: another version or calibration than it was fixed with');
});

test('each fixed difference measured again over its region is its own asker, so one never stops another on the host', () => {
    const row = (parentPath: string): DerivedRow => ({ parentPath, region: '0.50–1.50', result: ok('x'), base: { leq: 0, bands: [], label: 'g' } });
    const askers = [derivedRemeasureId(row('/d/a-1.wav'), 1), derivedRemeasureId(row('/d/b.wav'), 2)].map(compareScanAsker);
    assert.notEqual(askers[0], askers[1]);
    assert.equal(compareScanAsker(derivedRemeasureId(row('/d/a-1.wav'), 7)), askers[0], 'the same row asked again supersedes its own request');
    const parsers = webviewSources().filter(({ file, text }) => file !== 'src/shared/analysis/entryScan.ts' && text.includes('replace(/-[^-]*$/'));
    assert.deepEqual(parsers.map(({ file }) => file), [], 'the asker is read off a request id in entryScan.ts alone (compareScanAsker)');
});

test('the entry table stops a computation in one place, which settles its asking', () => {
    const text = readFileSync(path.join(repoRoot, 'src/webview/runtime/entryRuntime.ts'), 'utf8');
    assert.equal([...text.matchAll(/type: 'entry-scan-cancel'/g)].length, 1, 'every stop goes through stopScan');
    const start = text.indexOf('function stopScan');
    const stop = text.slice(start, text.indexOf('\n    }\n', start));
    assert.match(stop, /entry-scan-cancel[\s\S]*requests\.settle[\s\S]*scans\.settled\(\)/);
});

/** Every write of `derived` in a source, by the function it is in, and whether each place that loads fixed differences hands them to keepDerived. */
function derivedWrites(text: string): { writers: string[]; judged: boolean; loads: string[] } {
    const source = ts.createSourceFile('entryRuntime.ts', text, ts.ScriptTarget.Latest, true);
    const writers: string[] = [];
    let judged = false;
    const loads: string[] = [];
    const nameOf = (node: ts.Node): string => {
        for (let at: ts.Node | undefined = node; at; at = at.parent) if (ts.isFunctionDeclaration(at) && at.name) return at.name.text;
        return '(top)';
    };
    const inKeepDerived = (node: ts.Node): boolean => {
        for (let at: ts.Node | undefined = node.parent; at; at = at.parent) if (ts.isCallExpression(at) && ts.isIdentifier(at.expression) && at.expression.text === 'keepDerived') return true;
        return false;
    };
    const visit = (node: ts.Node): void => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && node.left.text === 'derived') {
            writers.push(nameOf(node));
            if (nameOf(node) === 'keepDerived' && /derivedStale\(/.test(node.right.getText(source))) judged = true;
        }
        // The fixed differences come back from the session (kept.derived) and from the folder's store (loadDerived).
        if (ts.isPropertyAccessExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 'kept' && node.name.text === 'derived') || node.name.text === 'loadDerived')) {
            if (!ts.isPropertyAccessExpression(node.parent) || node.parent.expression !== node) loads.push(`${node.getText(source)}:${inKeepDerived(node) || ts.isIfStatement(node.parent) ? 'kept' : 'raw'}`);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return { writers, judged, loads };
}

test('the fixed differences are kept one way only, judged against the files as they are now, on the folder opened and a session restored too (V5)', () => {
    const text = readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'src/webview/runtime/entryRuntime.ts'), 'utf8');
    const found = derivedWrites(text);
    assert.deepEqual([...new Set(found.writers)], ['keepDerived'], 'every write of `derived` is keepDerived\'s');
    assert.equal(found.judged, true, 'keepDerived judges each row (derivedStale), never trusting the stale it was stored with');
    assert.ok(found.loads.length >= 2, `the session and the folder's store are both read: ${found.loads.join(', ')}`);
    assert.deepEqual(found.loads.filter(item => item.endsWith(':raw')), [], 'what is loaded goes through keepDerived');
    // Mutation: a restore that keeps the rows as they were stored, and a load that skips the judgement.
    const mutant = derivedWrites(`
        function keepDerived(rows) { derived = rows.map(row => ({ ...row, stale: derivedStale(row) })); }
        function applySession(kept) { if (kept.derived) { derived = kept.derived; } }
        function open() { const rows = deps.loadDerived?.() ?? []; keepDerived(rows); }
    `);
    assert.deepEqual([...new Set(mutant.writers)], ['keepDerived', 'applySession']);
    assert.ok(mutant.loads.some(item => item.endsWith(':raw')), JSON.stringify(mutant.loads));
});
