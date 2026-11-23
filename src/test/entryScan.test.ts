import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePanelMessage } from '../shared/protocol/panelMessages';
import { isHostInboundMessage } from '../webview/runtime/hostMessaging';
import { ENTRY_SESSION_CSV_KEY, ENTRY_SESSION_KEY, folderKey, type EntryPublication } from '../shared/analysis/entryScan';

test('entry messages are validated on both sides of the panel boundary, and neither side knows an entry scan', () => {
    assert.deepEqual(parsePanelMessage({ type: 'entry-open', requestId: 'r', rootPath: '/d' }), { type: 'entry-open', requestId: 'r', rootPath: '/d' });
    assert.deepEqual(parsePanelMessage({ type: 'entry-open', requestId: 'r' }), { type: 'entry-open', requestId: 'r' });
    assert.equal(parsePanelMessage({ type: 'entry-open', rootPath: '/d' }), undefined);
    assert.equal(parsePanelMessage({ type: 'entry-open', requestId: 'r', rootPath: 1 }), undefined);
    assert.ok(parsePanelMessage({ type: 'entry-save-session', rootPath: '/d', session: { version: 1 } }));
    assert.ok(parsePanelMessage({ type: 'entry-save-session', rootPath: '/d', session: { version: 1 }, csv: null }));
    assert.equal(parsePanelMessage({ type: 'entry-save-session', rootPath: '/d', session: [] }), undefined);
    assert.equal(parsePanelMessage({ type: 'entry-save-session', rootPath: '/d', session: {}, csv: { name: 'x' } }), undefined);
    assert.ok(isHostInboundMessage({ type: 'entry-conditions', requestId: 'r', table: null, session: { version: 1 }, csv: { name: 'a.csv', text: '' } }));
    assert.equal(isHostInboundMessage({ type: 'entry-conditions', requestId: 'r', table: null, session: 'x' }), false);
    assert.ok(isHostInboundMessage({ type: 'directory-selection', rootPath: '/sources/x', filePaths: [], entry: true }));
    // The entry scans nothing: the messages of its scan are no messages any more.
    assert.equal(parsePanelMessage({ type: 'entry-scan', requestId: 'r', filePaths: ['/a.wav'] }), undefined);
    assert.equal(parsePanelMessage({ type: 'entry-scan-cancel' }), undefined);
    assert.equal(isHostInboundMessage({ type: 'entry-scan-result', requestId: 'r', filePath: '/a.wav', result: { ok: false, reason: 'x' } }), false);
    assert.equal(isHostInboundMessage({ type: 'entry-scan-done', requestId: 'r' }), false);
});

test('a folder opened is answered with the host\'s Recipe and the folder\'s stored session: no file is read, nothing is scanned or drawn', async () => {
    const { ComparisonSessionController } = await import('../shared/session/comparisonSessionController');
    const published: EntryPublication[] = [];
    const reached: string[] = [];
    const recipe = { schema: 'wandas.recipe', version: 2, inputs: [], nodes: [], output: 'input-0' };
    const store = new Map<string, unknown>([
        [folderKey(ENTRY_SESSION_KEY, '/d'), { version: 1, group: 'csv:line' }],
        [folderKey(ENTRY_SESSION_CSV_KEY, '/d'), { name: 'm.csv', text: 'a,b' }],
    ]);
    const entry = {
        scan: async () => { reached.push('scan'); return { ok: false, reason: 'x' }; },
        figure: async () => { reached.push('figure'); return {}; },
        readFile: async () => { reached.push('readFile'); return new Uint8Array(); },
        readHead: async () => { reached.push('readHead'); return new Uint8Array(); },
        recipe: async () => recipe,
        read: (key: string) => store.get(key),
        write: () => { reached.push('write'); },
    };
    const controller = new ComparisonSessionController({
        scope: () => ({ isCurrent: () => true, canPublish: () => true }),
        publish: (message: EntryPublication) => { published.push(message); },
        entry,
    } as never);
    await controller.dispatch({ type: 'entry-open', requestId: 'o1', rootPath: '/d' });
    assert.deepEqual(published, [{ type: 'entry-conditions', requestId: 'o1', table: null, recipe, session: { version: 1, group: 'csv:line' }, csv: { name: 'm.csv', text: 'a,b' } }]);
    assert.deepEqual(reached, [], 'opening a folder reaches no file and no backend');
    // A folder never opened before, on a host whose Recipe cannot be read: still answered, with neither.
    entry.recipe = async () => { throw new Error('no recipe'); };
    await controller.dispatch({ type: 'entry-open', requestId: 'o2', rootPath: '/other' });
    assert.deepEqual(published[1], { type: 'entry-conditions', requestId: 'o2', table: null });
    assert.deepEqual(reached, []);
});
