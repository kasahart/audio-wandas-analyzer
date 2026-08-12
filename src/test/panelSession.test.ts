import assert from 'node:assert/strict';
import test from 'node:test';
import { PanelSession, type DisposableLike, type PanelPort } from '../extension/panelSession';

function disposable(onDispose: () => void): DisposableLike {
    return { dispose: onDispose };
}

function createPanel(messages: unknown[]): PanelPort {
    return {
        webview: {
            postMessage: (message) => {
                messages.push(message);
                return Promise.resolve(true);
            },
            onDidReceiveMessage: () => disposable(() => {}),
        },
    };
}

test('PanelSession owns selection, cache, active paths, and latest request state', () => {
    const session = new PanelSession(createPanel([]));
    const selection = {
        rootPath: '/audio',
        tree: [],
        allFilePaths: ['/audio/a.wav'],
        selectedFilePaths: ['/audio/a.wav'],
        cachedResultsByFilePath: new Map(),
    };

    session.setDirectorySelection(selection);
    session.setActiveResults(['/audio/a.wav']);
    const revision = session.beginStateRequest('selection-1');

    assert.equal(session.directorySelection, selection);
    assert.deepEqual(session.activeResultPaths, ['/audio/a.wav']);
    assert.deepEqual(session.getActiveFilePaths(), ['/audio/a.wav']);
    assert.equal(session.latestRequestId, 'selection-1');
    assert.equal(session.isCurrent(revision, 'selection-1'), true);
});

test('PanelSession replaces directory cache entries with successful reanalysis results', () => {
    const session = new PanelSession(createPanel([]));
    const stale = {
        filePath: '/audio/a.wav',
        fileName: 'a.wav',
        sampleRateHz: 8_000,
        durationSeconds: 1,
        channelCount: 0,
        sampleCount: 8_000,
        analysisRevision: 0,
        channels: [],
    };
    const updated = { ...stale, analysisRevision: 1 };
    const cachedResultsByFilePath = new Map([[stale.filePath, stale]]);
    session.setDirectorySelection({
        rootPath: '/audio',
        tree: [],
        allFilePaths: [stale.filePath],
        selectedFilePaths: [stale.filePath],
        cachedResultsByFilePath,
    });

    session.cacheResults([updated]);

    assert.equal(cachedResultsByFilePath.get(stale.filePath), updated);
});

test('PanelSession evicts directory results from an older analysis revision', () => {
    const session = new PanelSession(createPanel([]));
    const stale = {
        filePath: '/audio/a.wav',
        fileName: 'a.wav',
        sampleRateHz: 8_000,
        durationSeconds: 1,
        channelCount: 0,
        sampleCount: 8_000,
        analysisRevision: 1,
        channels: [],
    };
    const cachedResultsByFilePath = new Map([[stale.filePath, stale]]);
    session.setDirectorySelection({
        rootPath: '/audio',
        tree: [],
        allFilePaths: [stale.filePath],
        selectedFilePaths: [stale.filePath],
        cachedResultsByFilePath,
    });

    assert.equal(session.hasCachedResult(stale.filePath, 2), false);
    assert.equal(cachedResultsByFilePath.has(stale.filePath), false);
});

test('PanelSession retains directory results from the current analysis revision', () => {
    const session = new PanelSession(createPanel([]));
    const current = {
        filePath: '/audio/a.wav',
        fileName: 'a.wav',
        sampleRateHz: 8_000,
        durationSeconds: 1,
        channelCount: 0,
        sampleCount: 8_000,
        analysisRevision: 2,
        channels: [],
    };
    const cachedResultsByFilePath = new Map([[current.filePath, current]]);
    session.setDirectorySelection({
        rootPath: '/audio',
        tree: [],
        allFilePaths: [current.filePath],
        selectedFilePaths: [current.filePath],
        cachedResultsByFilePath,
    });

    assert.equal(session.hasCachedResult(current.filePath, 2), true);
    assert.equal(cachedResultsByFilePath.get(current.filePath), current);
});

test('PanelSession rejects stale revisions after a newer state request', () => {
    const session = new PanelSession(createPanel([]));
    const first = session.beginStateRequest('r1');
    const second = session.beginStateRequest('r2');

    assert.equal(session.isCurrent(first, 'r1'), false);
    assert.equal(session.isCurrent(second, 'r2'), true);
    assert.equal(session.isCurrent(second, 'r1'), false);
});

test('PanelSession replaces listeners and disposes every owned resource idempotently', async () => {
    const messages: unknown[] = [];
    const session = new PanelSession(createPanel(messages));
    let firstMessageDisposals = 0;
    let secondMessageDisposals = 0;
    let environmentDisposals = 0;
    session.bindMessageListener(disposable(() => { firstMessageDisposals++; }));
    session.bindMessageListener(disposable(() => { secondMessageDisposals++; }));
    session.bindPythonEnvironment(disposable(() => { environmentDisposals++; }));

    assert.equal(firstMessageDisposals, 1);
    assert.equal(await session.postMessage({ type: 'before-dispose' }), true);
    session.dispose();
    session.dispose();

    assert.equal(secondMessageDisposals, 1);
    assert.equal(environmentDisposals, 1);
    assert.equal(session.isDisposed, true);
    assert.equal(await session.postMessage({ type: 'after-dispose' }), false);
    assert.deepEqual(messages, [{ type: 'before-dispose' }]);
});
