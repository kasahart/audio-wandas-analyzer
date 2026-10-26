import assert from 'node:assert/strict';
import test from 'node:test';
import { ENTRY_SCAN_INDEX_KEY, ENTRY_SESSION_CSV_KEY, ENTRY_SESSION_KEY, folderKey, runEntryScan, saveSession, type EntryPublication, type EntryScanPorts } from '../shared/analysis/entryScan';
import { parsePanelMessage } from '../shared/protocol/panelMessages';
import { isHostInboundMessage } from '../webview/runtime/hostMessaging';
import type { ScanResult } from '../shared/protocol/backendProtocol';

function ok(filePath: string): ScanResult {
    return {
        ok: true, conditionId: filePath, specVersion: 1, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: filePath, fs: 16000, channels: [0], durationS: 1, unit: 'FS', ref: 1 },
        leqDbA: [-20], peakHz: [100], spectrumDb: [[-20]], thirdOctDb: [[null]], crest: [1.4],
    };
}

function ports(store: Record<string, unknown> = {}, identities: Record<string, string> = {}) {
    const scanned: string[] = [];
    let after = 0;
    const port: EntryScanPorts = {
        identity: async filePath => identities[filePath],
        calibration: () => 'null',
        scan: async filePath => { scanned.push(filePath); return filePath.includes('bad') ? { ok: false, reason: 'Unable to read audio' } : ok(filePath); },
        read: key => store[key],
        write: (key, value) => { store[key] = structuredClone(value); },
        afterScan: () => { after++; },
    };
    return { port, store, scanned, afters: () => after };
}

/** The index of the folder the tests open (none given: ''). */
const INDEX = folderKey(ENTRY_SCAN_INDEX_KEY, '');

async function run(port: EntryScanPorts, filePaths: string[], isCurrent = () => true): Promise<EntryPublication[]> {
    const published: EntryPublication[] = [];
    await runEntryScan(port, { type: 'entry-scan', requestId: 'r', filePaths }, message => { published.push(message); }, isCurrent);
    return published;
}

test('an entry scan publishes the Recipe, one result per file in order, then done', async () => {
    const { port } = ports({}, { '/a.wav': 'a1' });
    const published = await run(port, ['/a.wav', '/bad.wav']);
    assert.deepEqual(published.map(item => item.type), ['entry-conditions', 'entry-scan-result', 'entry-scan-result', 'entry-scan-done']);
    assert.deepEqual(published[0], { type: 'entry-conditions', requestId: 'r', table: null });
    assert.deepEqual((published[2] as { result: ScanResult }).result, { ok: false, reason: 'Unable to read audio' });
});

test('an unchanged file reuses its stored result; a changed one or a failure is scanned again', async () => {
    const first = ports({}, { '/a.wav': 'a1', '/b.wav': 'b1', '/bad.wav': 'x' });
    await run(first.port, ['/a.wav', '/b.wav', '/bad.wav']);
    assert.deepEqual(first.scanned, ['/a.wav', '/b.wav', '/bad.wav']);
    assert.deepEqual(Object.keys(first.store[INDEX] as object), ['/a.wav', '/b.wav']);
    assert.equal(first.afters(), 1);

    const second = ports(first.store, { '/a.wav': 'a1', '/b.wav': 'b2', '/bad.wav': 'x' });
    await run(second.port, ['/a.wav', '/b.wav', '/bad.wav']);
    assert.deepEqual(second.scanned, ['/b.wav', '/bad.wav']);
    // The folder's index keeps every file it has computed, with each Recipe's result (most recent first).
    const third = ports(second.store, { '/c.wav': 'c1', '/a.wav': 'a1' });
    await run(third.port, ['/c.wav']);
    assert.deepEqual(Object.keys(third.store[INDEX] as object).sort(), ['/a.wav', '/b.wav', '/c.wav']);
    const fourth = ports(third.store, { '/a.wav': 'a1' });
    await runEntryScan(fourth.port, { type: 'entry-scan', requestId: 'r', filePaths: ['/a.wav'], recipe: { schema: 'wandas.recipe', version: 3, inputs: [], nodes: [{ id: 'n', operation: 'x', inputs: [] }], output: 'n' } as never }, () => {}, () => true);
    assert.equal((fourth.store[INDEX] as Record<string, unknown[]>)['/a.wav'].length, 2);
});

test('a folder\'s session and CSV are kept by the host under that folder, and come back at open with the stored results', async () => {
    const { port, store } = ports({}, { '/d/a.wav': 'a1' });
    await saveSession(port, { type: 'entry-save-session', rootPath: '/d', session: { version: 1, value: 'csv:score' }, csv: { name: 'm.csv', text: 'audio_file,score\na.wav,1\n' } });
    assert.deepEqual(store[folderKey(ENTRY_SESSION_KEY, '/d')], { version: 1, value: 'csv:score' });
    // A session saved again without its CSV keeps the CSV stored.
    await saveSession(port, { type: 'entry-save-session', rootPath: '/d', session: { version: 1, value: 'leq' } });
    assert.equal((store[folderKey(ENTRY_SESSION_CSV_KEY, '/d')] as { name: string }).name, 'm.csv');
    const published: EntryPublication[] = [];
    await runEntryScan(port, { type: 'entry-scan', requestId: 'r', rootPath: '/d', filePaths: ['/d/a.wav'], cachedOnly: true }, message => { published.push(message); }, () => true);
    assert.deepEqual(published[0], { type: 'entry-conditions', requestId: 'r', table: null, session: { version: 1, value: 'leq' }, csv: { name: 'm.csv', text: 'audio_file,score\na.wav,1\n' } });
    // Another folder has its own (none).
    const other: EntryPublication[] = [];
    await runEntryScan(port, { type: 'entry-scan', requestId: 'r', rootPath: '/e', filePaths: [], cachedOnly: true }, message => { other.push(message); }, () => true);
    assert.deepEqual(other[0], { type: 'entry-conditions', requestId: 'r', table: null });
});

test('opening a folder computes nothing: with cachedOnly only stored results come back, and the index keeps the rest', async () => {
    const first = ports({}, { '/a.wav': 'a1', '/b.wav': 'b1' });
    await run(first.port, ['/a.wav']);
    const second = ports(first.store, { '/a.wav': 'a1', '/b.wav': 'b1' });
    const published: EntryPublication[] = [];
    await runEntryScan(second.port, { type: 'entry-scan', requestId: 'r', filePaths: ['/a.wav', '/b.wav'], cachedOnly: true }, message => { published.push(message); }, () => true);
    assert.deepEqual(second.scanned, []);
    assert.deepEqual(published.filter(item => item.type === 'entry-scan-result').map(item => (item as { filePath: string }).filePath), ['/a.wav']);
    assert.equal(published.at(-1)!.type, 'entry-scan-done');
    assert.deepEqual(Object.keys(second.store[INDEX] as object), ['/a.wav']);
});

test('a superseded scan stops before its next file and still releases the backend', async () => {
    const { port, scanned, afters } = ports();
    let current = true;
    const published: EntryPublication[] = [];
    await runEntryScan(port, { type: 'entry-scan', requestId: 'r', filePaths: ['/a.wav', '/b.wav'] }, message => {
        published.push(message);
        if (message.type === 'entry-scan-result') current = false;
    }, () => current);
    assert.deepEqual(scanned, ['/a.wav']);
    assert.equal(published.at(-1)!.type, 'entry-scan-result');
    assert.equal(afters(), 1);
});

test('entry messages are validated on both sides of the panel boundary', () => {
    assert.deepEqual(parsePanelMessage({ type: 'entry-scan', requestId: 'r', filePaths: ['/a.wav'] }), { type: 'entry-scan', requestId: 'r', filePaths: ['/a.wav'] });
    assert.equal(parsePanelMessage({ type: 'entry-scan', requestId: 'r', filePaths: [''] }), undefined);
    assert.ok(parsePanelMessage({ type: 'entry-save-session', rootPath: '/d', session: { version: 1 } }));
    assert.ok(parsePanelMessage({ type: 'entry-save-session', rootPath: '/d', session: { version: 1 }, csv: null }));
    assert.equal(parsePanelMessage({ type: 'entry-save-session', rootPath: '/d', session: [] }), undefined);
    assert.equal(parsePanelMessage({ type: 'entry-save-session', rootPath: '/d', session: {}, csv: { name: 'x' } }), undefined);
    assert.ok(isHostInboundMessage({ type: 'entry-conditions', requestId: 'r', table: null, session: { version: 1 }, csv: { name: 'a.csv', text: '' } }));
    assert.equal(isHostInboundMessage({ type: 'entry-conditions', requestId: 'r', table: null, session: 'x' }), false);
    assert.ok(isHostInboundMessage({ type: 'entry-scan-result', requestId: 'r', filePath: '/a.wav', result: ok('/a.wav') }));
    assert.ok(isHostInboundMessage({ type: 'entry-scan-result', requestId: 'r', filePath: '/a.wav', result: { ok: false, reason: 'x' } }));
    assert.equal(isHostInboundMessage({ type: 'entry-scan-result', requestId: 'r', filePath: '/a.wav', result: { ok: true } }), false);
    assert.ok(isHostInboundMessage({ type: 'directory-selection', rootPath: '/sources/x', filePaths: [], entry: true }));
});

test('entry-scan-cancel stops the running entry scan after its current file and keeps what it published', async () => {
    const { ComparisonSessionController } = await import('../shared/session/comparisonSessionController');
    const { parsePanelMessage } = await import('../shared/protocol/panelMessages');
    assert.deepEqual(parsePanelMessage({ type: 'entry-scan-cancel' }), { type: 'entry-scan-cancel' });
    const published: Array<{ type: string; filePath?: string }> = [];
    let release: () => void = () => undefined;
    let scanned = 0;
    const entry = {
        identity: async () => undefined,
        scan: async () => { scanned++; if (scanned === 2) await new Promise<void>(resolve => { release = resolve; }); return { ok: false, reason: 'x' }; },
        read: () => undefined, write: () => undefined,
    };
    const controller = new ComparisonSessionController({
        scope: () => ({ isCurrent: () => true, canPublish: () => true }),
        publish: (message: { type: string; filePath?: string }) => { published.push(message); },
        entry,
    } as never);
    const running = controller.dispatch({ type: 'entry-scan', requestId: 'e', filePaths: ['/a.wav', '/b.wav', '/c.wav'] });
    for (let turn = 0; turn < 20 && scanned < 2; turn++) await new Promise(resolve => setImmediate(resolve));
    await controller.dispatch({ type: 'entry-scan-cancel' });
    release();
    await running;
    assert.equal(scanned, 2, 'the third file is never scanned');
    assert.deepEqual(published.filter(message => message.type === 'entry-scan-result').map(message => message.filePath), ['/a.wav']);
    assert.ok(!published.some(message => message.type === 'entry-scan-done'));
});
