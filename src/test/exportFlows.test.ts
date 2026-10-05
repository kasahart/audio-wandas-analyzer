import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { ExportFlows, ExportHost } from '../extension/exportFlows';
import type { ExportWavLoopMessage } from '../shared/utils/audioTarget';

function load() {
    const exports: { ExportFlows?: typeof ExportFlows } = {};
    runInNewContext(readFileSync(join(__dirname, '../extension/exportFlows.js'), 'utf8'), {
        exports, Buffer,
        require: (name: string) => name === 'vscode'
            ? { Uri: { joinPath: (folder: { fsPath: string }, name: string) => ({ fsPath: `${folder.fsPath}/${name}` }) } }
            : name === 'path' ? require('node:path') : require('../shared/i18n/strings'),
    });
    return exports.ExportFlows!;
}

test('desktop export honors per-file timeline regions and still supports legacy normalized requests', async () => {
    const Flows = load();
    const calls: Array<[string, number, number]> = [];
    const writes: string[] = [];
    const host = {
        pickOutputFolder: async () => ({ fsPath: '/export' }),
        writeFile: async (uri: { fsPath: string }) => { writes.push(uri.fsPath); },
        showInformation: () => undefined,
        showError: (reason: string) => { throw new Error(reason); },
    } as unknown as ExportHost;
    const flows = new Flows({ exportWavLoop: async (...args: [string, number, number]) => {
        calls.push(args); return { wavBase64: Buffer.from('WAV').toString('base64'), sampleRate: 8000 };
    } }, host);
    const message: ExportWavLoopMessage = {
        type: 'export-wav-loop', filePaths: ['/short.wav', '/long.wav'], startNorm: 0.2, endNorm: 0.6,
        fileRegions: [ { filePath: '/short.wav', startNorm: 0.5, endNorm: 1 }, { filePath: '/long.wav', startNorm: 0.2, endNorm: 0.6 } ],
    };
    await flows.exportWavLoop(message);
    assert.deepEqual(calls, [['/short.wav', 0.5, 1], ['/long.wav', 0.2, 0.6]]);
    assert.equal(writes.length, 2);
    calls.length = 0;
    await flows.exportWavLoop({ type: 'export-wav-loop', filePaths: ['/short.wav'], startNorm: 0.1, endNorm: 0.9 });
    assert.deepEqual(calls, [['/short.wav', 0.1, 0.9]]);
});
