import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type * as vscode from 'vscode';
import type { AnalysisResultWithError } from '../shared/analysis/analysisTypes';
import type { ExportWavLoopMessage } from '../shared/utils/audioTarget';
import type { PanelBackend, PanelControllerHost, PanelFactory, PanelHandle } from '../extension/panelController';
import type { ExportFlows } from '../extension/exportFlows';
import type { TargetFileSystem } from '../extension/targetDiscovery';
import type { SpectrogramSettingsContext } from '../shared/analysis/savedSpectrogramSettings';

class CancellationError extends Error {}
const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
const uri = (fsPath: string) => ({ fsPath, toString: () => `file:${fsPath}` });

function loadWithVscodeMock<T>(load: () => T): T {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
    const originalLoad = NodeModule._load;
    NodeModule._load = function(request, parent, isMain) {
        if (request === 'vscode') return {
            Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
            FileType, ViewColumn: { One: 1 }, ProgressLocation: { Notification: 15 }, CancellationError,
            EventEmitter: class { readonly event = () => ({ dispose() {} }); fire() {} dispose() {} },
            commands: { executeCommand: async () => undefined }, workspace: { fs: {} }, env: { language: 'en' },
            window: { showErrorMessage() {}, showInformationMessage() {}, showOpenDialog() {} },
        };
        return originalLoad.call(this, request, parent, isMain);
    };
    try { return load(); } finally { NodeModule._load = originalLoad; }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PanelController } = loadWithVscodeMock(() => require('../extension/panelController') as typeof import('../extension/panelController'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildDirectoryTree } = loadWithVscodeMock(() => require('../extension/targetDiscovery') as typeof import('../extension/targetDiscovery'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openDroppedTargets, openTarget } = loadWithVscodeMock(() => require('../extension/extensionContributions') as typeof import('../extension/extensionContributions'));

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
// The vscode mock joins URIs with the platform separator; synthetic listings are keyed by POSIX paths, temp-folder ones by host paths.
const posixPath = (fsPath: string) => fsPath.replace(/\\/gu, '/');

function directoryFileSystem(listing: Record<string, Array<[string, number]>>): TargetFileSystem {
    return {
        stat: async () => ({ type: FileType.Directory, ctime: 0, mtime: 0, size: 0 }),
        readDirectory: async (source) => ((listing[source.fsPath] ?? listing[posixPath(source.fsPath)]) ?? []),
    };
}

/** A folder panel over a real folder (so an unguarded read would succeed) and a file outside it. */
function folderPanel(options: { listing?: (root: string) => Record<string, Array<[string, number]>>; withProgress?: PanelControllerHost['withProgress'] } = {}) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'awa-trust-root-'));
    const outside = path.join(mkdtempSync(path.join(os.tmpdir(), 'awa-trust-outside-')), 'secret.wav');
    writeFileSync(path.join(root, 'a.wav'), Buffer.alloc(64));
    writeFileSync(outside, Buffer.alloc(64));
    const inside = path.join(root, 'a.wav');

    const published: Array<Record<string, unknown>> = [];
    let receive: ((message: unknown) => unknown) | undefined;
    const panel: PanelHandle = {
        webview: {
            onDidReceiveMessage: (listener) => { receive = listener; return { dispose() {} }; },
            postMessage: async (message) => { published.push(message as Record<string, unknown>); return true; },
        },
        onDidDispose: () => ({ dispose() {} }),
    };
    const factory: PanelFactory = {
        getResults: () => [], updateResults() {}, replaceResult: () => undefined,
        showResults: () => panel, showDirectory: () => panel, updateDirectoryResults: async () => true,
    };
    const errors: string[] = [], infos: string[] = [];
    const host: PanelControllerHost = {
        fileSystem: directoryFileSystem(options.listing?.(root) ?? { [root]: [['a.wav', FileType.File]] }),
        showOpenDialog: async () => undefined, executeCommand: async () => undefined,
        showInformation: message => { infos.push(message); }, showError: message => { errors.push(message); },
        getPythonEnvironment: () => ({ pythonCommand: 'python3', status: 'normal', tooltip: 'python3' }),
        onPythonEnvironmentChange: () => ({ dispose() {} }),
        language: () => 'en',
        withProgress: options.withProgress ?? ((_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken)),
    };
    const scanned: Array<{ filePath: string; reference?: { filePath: string } }> = [];
    const backend = {
        scan: async (request: { filePath: string; reference?: { filePath: string } }) => {
            scanned.push(request);
            return { ok: false, reason: 'scanned' };
        },
        calibrationFor: () => undefined,
    } as unknown as PanelBackend;
    const exported: ExportWavLoopMessage[] = [];
    const exports = { wavExport: async (message: ExportWavLoopMessage) => { exported.push(message); return undefined; } } as unknown as ExportFlows;
    const context = {
        extensionUri: uri(path.resolve(__dirname, '../..')),
        workspaceState: { get: <T>(_key: string, fallback?: T) => fallback, update: async () => undefined },
    } as unknown as SpectrogramSettingsContext & { extensionUri: vscode.Uri };
    const analysis = {
        warmup() {},
        analyzeFiles: async (filePaths: string[]) => filePaths.map(filePath => ({ filePath, fileName: path.basename(filePath), sampleRateHz: 16000,
            durationSeconds: 1, channelCount: 0, sampleCount: 16000, channels: [], analysisRevision: 0 } satisfies AnalysisResultWithError)),
    };
    const controller = new PanelController(context, backend, analysis, exports, { analysisRevision: () => 0, onDidChange: () => ({ dispose() {} }), configureTrack: async () => undefined }, factory, host);
    // Waits for the reply that ends the request (entry-scan-done, ...) or, for an export, a few turns of the loop.
    const send = async (message: unknown, done?: string) => {
        const before = published.length;
        receive!(message);
        for (let i = 0; i < 200 && (!done || !published.slice(before).some(reply => reply['type'] === done)); i++) {
            await new Promise<void>(resolve => setTimeout(resolve, done ? 5 : 0));
        }
    };
    return { root, inside, outside, controller, panel, published, scanned, exported, errors, infos, send };
}

test('entry scan reaches the disk and the backend only for files the folder lists', async () => {
    const env = folderPanel();
    await env.controller.analyzeTarget(uri(env.root) as vscode.Uri);
    await env.send({ type: 'entry-scan', requestId: 'scan-1', rootPath: env.root, filePaths: [env.inside, env.outside] }, 'entry-scan-done');
    assert.deepEqual(env.scanned.map(request => request.filePath), [env.inside]);
    const results = env.published.filter(message => message['type'] === 'entry-scan-result');
    const rejected = results.find(message => message['filePath'] === env.outside);
    assert.deepEqual(rejected?.['result'], { ok: false, reason: `Not a file this panel lists: ${env.outside}` });
});

test('entry probe reads headers of listed files only', async () => {
    const env = folderPanel();
    await env.controller.analyzeTarget(uri(env.root) as vscode.Uri);
    await env.send({ type: 'entry-probe', requestId: 'probe-1', filePaths: [env.inside, env.outside] }, 'entry-probe-done');
    const results = env.published.filter(message => message['type'] === 'entry-probe-result');
    assert.equal(results.length, 2);
    assert.equal(results.find(message => message['filePath'] === env.outside)?.['error'], `Not a file this panel lists: ${env.outside}`);
    assert.notEqual(results.find(message => message['filePath'] === env.inside)?.['error'], `Not a file this panel lists: ${env.inside}`);
});

test('compare scan rejects an unlisted file, as a target or as the reference', async () => {
    const env = folderPanel();
    await env.controller.analyzeTarget(uri(env.root) as vscode.Uri);
    const recipe = { schema: 'wandas.recipe', nodes: [], output: 'out' };
    await env.send({ type: 'compare-scan', requestId: 'row-1', filePaths: [env.outside, env.inside], recipe }, 'compare-scan-done');
    assert.deepEqual(env.scanned.map(request => request.filePath), [env.inside]);
    await env.send({ type: 'compare-scan', requestId: 'track-1', filePaths: [env.inside], recipe,
        reference: { filePath: env.outside, step: 'welch', recipe } }, 'compare-scan-done');
    assert.equal(env.scanned.length, 1, 'a scan against an unlisted reference must not reach the backend');
    const last = env.published.filter(message => message['type'] === 'compare-scan-result').at(-1);
    assert.deepEqual(last?.['result'], { ok: false, reason: `Not a file this panel lists: ${env.outside}` });
});

test('WAV export plans only the listed files and opens no dialog when none are', async () => {
    const env = folderPanel();
    await env.controller.analyzeTarget(uri(env.root) as vscode.Uri);
    await env.send({ type: 'export-wav-loop', filePaths: [env.inside, env.outside], startNorm: 0, endNorm: 1 });
    assert.deepEqual(env.exported.map(message => message.filePaths), [[env.inside]]);
    await env.send({ type: 'export-wav-loop', filePaths: [env.outside], startNorm: 0, endNorm: 1 });
    assert.equal(env.exported.length, 1);
});

test('files shown without a folder may be scanned; others may not', async () => {
    const env = folderPanel();
    await env.controller.analyzeFiles([env.inside]);
    await env.send({ type: 'entry-scan', requestId: 'scan-2', filePaths: [env.inside, env.outside] }, 'entry-scan-done');
    assert.deepEqual(env.scanned.map(request => request.filePath), [env.inside]);
});

test('directory listing skips hidden folders, node_modules and linked folders', async () => {
    const listing = {
        '/r': [['.git', FileType.Directory], ['node_modules', FileType.Directory], ['loop', FileType.Directory | FileType.SymbolicLink],
            ['sub', FileType.Directory], ['a.wav', FileType.File], ['linked.wav', FileType.File | FileType.SymbolicLink], ['notes.txt', FileType.File]],
        '/r/.git': [['x.wav', FileType.File]],
        '/r/node_modules': [['y.wav', FileType.File]],
        '/r/loop': [['z.wav', FileType.File]],
        '/r/sub': [['b.wav', FileType.File]],
    } as Record<string, Array<[string, number]>>;
    const read: string[] = [];
    const fileSystem = directoryFileSystem(listing);
    const { tree, truncated } = await buildDirectoryTree(uri('/r') as vscode.Uri, {
        ...fileSystem, readDirectory: (source) => { read.push(posixPath(source.fsPath)); return fileSystem.readDirectory(source); },
    });
    assert.equal(truncated, false);
    assert.deepEqual(read.sort(), ['/r', '/r/sub']);
    assert.deepEqual(tree.map(node => node.relativePath), ['sub', 'a.wav', 'linked.wav']);
});

test('directory listing stops at its entry cap and says so', async () => {
    const listing: Record<string, Array<[string, number]>> = { '/r': [['d1', FileType.Directory], ['d2', FileType.Directory]] };
    for (const folder of ['d1', 'd2']) listing[`/r/${folder}`] = Array.from({ length: 5 }, (_, i) => [`${i}.wav`, FileType.File]);
    const { tree, truncated } = await buildDirectoryTree(uri('/r') as vscode.Uri, directoryFileSystem(listing), { maxEntries: 9, concurrency: 1 });
    assert.equal(truncated, true);
    const files = tree.flatMap(node => node.children ?? []);
    assert.equal(files.length, 7, 'two folders plus seven files fill the cap of nine');
});

test('a truncated directory listing does not depend on which read finishes first', async () => {
    const listing: Record<string, Array<[string, number]>> = {
        '/r': [['d2', FileType.Directory], ['d1', FileType.Directory]],
        '/r/d1': [['x.wav', FileType.File], ['s', FileType.Directory]],
        '/r/d1/s': Array.from({ length: 3 }, (_, i) => [`${i}.wav`, FileType.File]),
        '/r/d2': Array.from({ length: 5 }, (_, i) => [`${i}.wav`, FileType.File]),
    };
    const listWithDelays = async (delays: Record<string, number>) => {
        const { tree, truncated } = await buildDirectoryTree(uri('/r') as vscode.Uri, {
            stat: async () => ({ type: FileType.Directory }) as vscode.FileStat,
            readDirectory: async (source) => {
                const key = posixPath(source.fsPath);
                for (let i = 0; i < (delays[key] ?? 0); i++) await tick();
                return listing[key] ?? [];
            },
        }, { maxEntries: 9 });
        const paths = (nodes: typeof tree): string[] => nodes.flatMap(node => node.children ? paths(node.children) : [node.relativePath]);
        return { paths: paths(tree), truncated };
    };
    const laterFirst = await listWithDelays({ '/r/d1': 6, '/r/d1/s': 6 });
    const earlierFirst = await listWithDelays({ '/r/d2': 12 });
    // Two folders, then d1's two entries and its subfolder's three files, leave room for two of d2's five.
    assert.deepEqual(laterFirst, { paths: ['d1/s/0.wav', 'd1/s/1.wav', 'd1/s/2.wav', 'd1/x.wav', 'd2/0.wav', 'd2/1.wav'], truncated: true });
    assert.deepEqual(earlierFirst, laterFirst);
});

test('directory listing bounds reads in flight across nesting levels', async () => {
    const listing: Record<string, Array<[string, number]>> = { '/r': [] };
    for (let i = 0; i < 6; i++) {
        listing['/r'].push([`d${i}`, FileType.Directory]);
        listing[`/r/d${i}`] = Array.from({ length: 6 }, (_, j) => [`e${j}`, FileType.Directory]);
        for (let j = 0; j < 6; j++) listing[`/r/d${i}/e${j}`] = [['a.wav', FileType.File]];
    }
    let inFlight = 0, peak = 0;
    const fileSystem: TargetFileSystem = {
        stat: async () => ({ type: FileType.Directory }) as vscode.FileStat,
        readDirectory: async (source) => {
            peak = Math.max(peak, ++inFlight);
            await tick();
            inFlight--;
            return ((listing[source.fsPath] ?? listing[posixPath(source.fsPath)]) ?? []);
        },
    };
    const { tree } = await buildDirectoryTree(uri('/r') as vscode.Uri, fileSystem, { concurrency: 3 });
    assert.equal(tree.length, 6);
    assert.ok(peak <= 3, `at most 3 reads at once, saw ${peak}`);
});

test('a wide two-level folder keeps the read bound busy at the second level', async () => {
    let secondLevelInFlight = 0, secondLevelPeak = 0;
    const fileSystem: TargetFileSystem = {
        stat: async () => ({ type: FileType.Directory }) as vscode.FileStat,
        readDirectory: async (source) => {
            const depth = posixPath(source.fsPath).split('/').filter(Boolean).length - 1;
            if (depth === 2) secondLevelPeak = Math.max(secondLevelPeak, ++secondLevelInFlight);
            for (let i = 0; i < 3; i++) await tick();
            if (depth === 2) secondLevelInFlight--;
            if (depth === 0) return Array.from({ length: 16 }, (_, i) => [`s${String(i).padStart(2, '0')}`, FileType.Directory]);
            return depth === 1 ? [['take', FileType.Directory]] : [['a.wav', FileType.File]];
        },
    };
    const { tree } = await buildDirectoryTree(uri('/r') as vscode.Uri, fileSystem, { concurrency: 4 });
    assert.equal(tree.length, 16);
    assert.equal(secondLevelPeak, 4, 'subfolders of subfolders are read side by side, not one at a time');
});

test('directory listing stops when cancelled', async () => {
    let reads = 0;
    const fileSystem = directoryFileSystem({ '/r': [['a', FileType.Directory]], '/r/a': [['b', FileType.Directory]], '/r/a/b': [['x.wav', FileType.File]] });
    await assert.rejects(buildDirectoryTree(uri('/r') as vscode.Uri, {
        ...fileSystem, readDirectory: (source) => { reads++; return fileSystem.readDirectory(source); },
    }, { isCancelled: () => reads >= 1 }), CancellationError);
    assert.equal(reads, 1);
});

test('opening a folder lists it under a cancellable progress notification and reports a truncated listing', async () => {
    const titles: string[] = [];
    let cancel = false;
    const env = folderPanel({
        withProgress: (options, task) => {
            titles.push(`${options.title}|${options.cancellable}`);
            return task({ report() {} }, { get isCancellationRequested() { return cancel; } } as vscode.CancellationToken);
        },
    });
    await env.controller.analyzeTarget(uri(env.root) as vscode.Uri);
    assert.deepEqual(titles, [`Listing audio files in ${path.basename(env.root)}|true`]);
    assert.ok(env.published.length > 0);

    cancel = true;
    const before = env.published.length;
    await env.controller.analyzeTarget(uri(env.root) as vscode.Uri, env.panel);
    assert.equal(env.published.length, before, 'a cancelled listing leaves the panel as it was');
    assert.deepEqual(env.errors, []);
});

test('a folder over the entry cap opens with a message naming the cap', async () => {
    const env = folderPanel({
        listing: (root) => ({ [root]: Array.from({ length: 50_001 }, (_, i) => [`${String(i).padStart(5, '0')}.wav`, FileType.File]) }),
    });
    await env.controller.analyzeTarget(uri(env.root) as vscode.Uri);
    assert.deepEqual(env.infos, [`Listed the first 50000 entries of ${env.root} only. Open a subfolder to see the rest.`]);
});

test('opening a target that fails shows a localised message instead of failing the command', async () => {
    const shown: string[] = [];
    const host = { stat: async () => ({ type: FileType.File }) as vscode.FileStat, showError: (message: string) => { shown.push(message); }, language: () => 'ja' };
    const failing = {
        analyzeTarget: async () => { throw new Error('No supported audio files were found in /empty'); },
        analyzeFiles: async () => { throw new Error('backend down'); },
    };
    await openTarget(failing, uri('/empty') as vscode.Uri, host);
    assert.deepEqual(shown, ['/empty を開けませんでした: No supported audio files were found in /empty']);

    await openDroppedTargets(failing, [uri('/x/a.wav'), uri('/x/b.wav')] as vscode.Uri[], host);
    assert.match(shown[1], /^2 .*を開けませんでした: backend down$/);
});

test('a dropped item that cannot be read is reported, not thrown', async () => {
    const shown: string[] = [];
    const opened: string[] = [];
    const host = {
        stat: async () => { throw new Error('Unable to resolve resource untitled:Untitled-1'); },
        showError: (message: string) => { shown.push(message); },
        language: () => 'en',
    };
    const controller = { analyzeTarget: async (target: vscode.Uri) => { opened.push(target.fsPath); }, analyzeFiles: async () => undefined };
    await openDroppedTargets(controller, [uri('/untitled') as vscode.Uri], host);
    assert.deepEqual(opened, []);
    assert.deepEqual(shown, ['Could not open /untitled: Unable to resolve resource untitled:Untitled-1']);
});

test('a track\'s calibration button reaches the store through the panel\'s one message handler, with the shown track', async () => {
    let receive: ((message: unknown) => unknown) | undefined;
    let listeners = 0;
    const panel: PanelHandle = {
        webview: {
            onDidReceiveMessage: (listener) => { receive = listener; listeners++; return { dispose() {} }; },
            postMessage: async () => true,
        },
        onDidDispose: () => ({ dispose() {} }),
    };
    const shown: AnalysisResultWithError = { filePath: '/a.wav', fileName: 'a.wav', sampleRateHz: 16000, durationSeconds: 1, channelCount: 1,
        sampleCount: 16000, channels: [{ label: 'shown label' }] as AnalysisResultWithError['channels'], analysisRevision: 0 };
    const factory: PanelFactory = {
        getResults: () => [shown], updateResults() {}, replaceResult: () => undefined,
        showResults: () => panel, showDirectory: () => panel, updateDirectoryResults: async () => true,
    };
    const errors: string[] = [];
    const host = {
        showError: (message: string) => { errors.push(message); }, showInformation() {},
        getPythonEnvironment: () => ({ pythonCommand: 'python3', status: 'normal', tooltip: 'python3' }),
        onPythonEnvironmentChange: () => ({ dispose() {} }), language: () => 'en',
    } as unknown as PanelControllerHost;
    const configured: AnalysisResultWithError[] = [];
    const calibration = { analysisRevision: () => 0, onDidChange: () => ({ dispose() {} }), configureTrack: async (result: AnalysisResultWithError) => { configured.push(result); } };
    const context = { extensionUri: uri('/extension'), workspaceState: { get: <T>(_key: string, fallback?: T) => fallback, update: async () => undefined } } as unknown as SpectrogramSettingsContext & { extensionUri: vscode.Uri };
    const controller = new PanelController(context, {} as PanelBackend, { warmup() {}, analyzeFiles: async () => [shown] }, {} as ExportFlows, calibration, factory, host);
    await controller.analyzeFiles(['/a.wav']);
    assert.equal(listeners, 1);
    await receive!({ type: 'configure-calibration', trackIndex: 0, filePath: '/a.wav', channels: [{ channelIndex: 0, label: 'message label' }] });
    assert.deepEqual(configured, [shown], 'the track as the panel shows it, not the message metadata');
    await receive!({ type: 'configure-calibration', trackIndex: 0, filePath: '/other.wav', channels: [{ channelIndex: 0, label: 'x' }] });
    await receive!({ type: 'configure-calibration', trackIndex: 0, filePath: '/a.wav', channels: [] });
    assert.equal(configured.length, 1, 'a track the panel does not show, or a malformed message, configures nothing');
    assert.deepEqual(errors, []);
    controller.dispose();
});
