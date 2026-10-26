import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFolderStore, isFolderKey } from '../extension/folderStore';

test('a folder\'s index and session are JSON files in the extension\'s storage, read back by a new store; null removes one', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'awa-store-'));
    try {
        const store = createFolderStore(path.join(directory, 'entry'));
        await store.write('awa.session.v1:/data/motor', { version: 1, value: 'leq' });
        await store.write('awa.scanIndex.v2:/data/motor', { '/data/motor/a.wav': [] });
        assert.equal(readdirSync(path.join(directory, 'entry')).filter(name => name.endsWith('.json')).length, 2);
        const again = createFolderStore(path.join(directory, 'entry'));
        assert.deepEqual(await again.read('awa.session.v1:/data/motor'), { version: 1, value: 'leq' });
        assert.equal(await again.read('awa.session.v1:/data/other'), undefined);
        await again.write('awa.session.v1:/data/motor', null);
        assert.equal(await createFolderStore(path.join(directory, 'entry')).read('awa.session.v1:/data/motor'), undefined);
        assert.ok(isFolderKey('awa.sessionCsv.v1:/x') && isFolderKey('awa.scanIndex.v2:') && !isFolderKey('awa.conditions.v1'));
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
