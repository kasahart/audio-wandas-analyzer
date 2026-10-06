import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { ExportFlows, ExportHost } from '../extension/exportFlows';
import type { ExportReportOptionsMessage, ExportWavLoopMessage } from '../shared/utils/audioTarget';
import { exportWavRegions, reportArtifact } from '../shared/utils/exportArtifact';

// Drives the native ports the way the shared ComparisonSessionController sequences them.
async function exportWav(flows: ExportFlows, message: ExportWavLoopMessage): Promise<void> {
    const plan = await flows.wavExport(message);
    if (!plan) return;
    await exportWavRegions(message, plan.sources, plan.sink);
    await plan.complete?.();
}
async function exportReport(flows: ExportFlows, message: ExportReportOptionsMessage): Promise<void> {
    const format = await flows.pickReportFormat();
    if (format) await flows.saveReport(reportArtifact(message, format), format, message);
}

function load() {
    const exports: { ExportFlows?: typeof ExportFlows } = {};
    runInNewContext(readFileSync(join(__dirname, '../extension/exportFlows.js'), 'utf8'), {
        exports, Buffer,
        require: (name: string) => name === 'vscode'
            ? { Uri: { joinPath: (folder: { fsPath: string }, name: string) => ({ fsPath: `${folder.fsPath}/${name}` }) } }
            : name === 'path' ? require('node:path') : name === '../shared/utils/exportArtifact' ? require('../shared/utils/exportArtifact') : require('../shared/i18n/strings'),
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
    await exportWav(flows, message);
    assert.deepEqual(calls, [['/short.wav', 0.5, 1], ['/long.wav', 0.2, 0.6]]);
    assert.deepEqual(writes, ['/export/short_loop.wav', '/export/long_loop.wav']);
    calls.length = 0;
    await exportWav(flows, { type: 'export-wav-loop', filePaths: ['/short.wav'], startNorm: 0.1, endNorm: 0.9 });
    assert.deepEqual(calls, [['/short.wav', 0.1, 0.9]]);
});

test('desktop report saves exact UTF-8 shared content and cancel writes nothing', async () => {
    const Flows = load();
    const writes: string[] = [];
    let format: 'markdown' | 'notebook' | undefined = 'markdown';
    const host = {
        pickReportFormat: async () => format,
        pickReportDestination: async (name: string, selected: string) => ({ fsPath: `/export/${name}.${selected === 'markdown' ? 'md' : 'ipynb'}` }),
        writeFile: async (_uri: unknown, content: Uint8Array) => { writes.push(Buffer.from(content).toString('utf8')); },
        showInformation: () => undefined,
        language: () => 'ja',
    } as unknown as ExportHost;
    const flows = new Flows({ exportWavLoop: async () => { throw new Error('unused'); } }, host);
    const message = { type: 'export-report-options' as const, defaultName: '測定', markdownContent: '# 測定\n', notebookContent: '{"nbformat":4}' };
    await exportReport(flows, message);
    format = 'notebook'; await exportReport(flows, message);
    format = undefined; await exportReport(flows, message);
    assert.deepEqual(writes, [message.markdownContent, message.notebookContent]);
});
