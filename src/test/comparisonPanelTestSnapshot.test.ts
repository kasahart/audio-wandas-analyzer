/**
 * The E2E suite reads the panel's rendered UI through ComparisonPanel's test snapshot. Opening another target on the same
 * panel replaces its html, but the old page's snapshots can still arrive after that: they must not stand for the new page
 * (issue #857, where the old page's track row was read as the new folder's).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeModule = require('node:module');

interface FakeUri { fsPath: string; toString: () => string }
const uri = (fsPath: string): FakeUri => ({ fsPath, toString: () => `file://${fsPath}` });

interface FakePanel {
    title: string;
    webview: {
        html: string;
        options: unknown;
        cspSource: string;
        asWebviewUri: (target: FakeUri) => FakeUri;
        postMessage: (message: unknown) => Promise<boolean>;
        onDidReceiveMessage: (listener: (message: unknown) => void) => { dispose: () => void };
    };
    reveal: () => void;
    onDidDispose: () => void;
    /** Delivers a message as from the page (the last listener registered, as ComparisonPanel keeps one per panel). */
    receive: (message: unknown) => void;
}

function fakePanel(): FakePanel {
    let listener: ((message: unknown) => void) | undefined;
    return {
        title: '',
        webview: {
            html: '',
            options: {},
            cspSource: 'mock-csp',
            asWebviewUri: target => target,
            postMessage: async () => true,
            onDidReceiveMessage: (next) => { listener = next; return { dispose: () => { if (listener === next) listener = undefined; } }; },
        },
        reveal: () => undefined,
        onDidDispose: () => undefined,
        receive: (message) => { listener?.(message); },
    };
}

const vscodeStub = {
    env: { language: 'en' },
    window: { createWebviewPanel: () => fakePanel() },
    ViewColumn: { One: 1, Active: 1, Beside: 2 },
    Uri: {
        file: (fsPath: string) => uri(fsPath),
        joinPath: (base: FakeUri, ...parts: string[]) => uri([base.fsPath, ...parts].join('/')),
    },
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
};

const originalLoad = NodeModule._load;
NodeModule._load = function (id: string, ...rest: unknown[]) {
    if (id === 'vscode') { return vscodeStub; }
    return originalLoad.call(this, id, ...rest);
};
let ComparisonPanel: typeof import('../webview/panels/ComparisonPanel').ComparisonPanel;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ComparisonPanel = require('../webview/panels/ComparisonPanel').ComparisonPanel;
} finally {
    NodeModule._load = originalLoad;
}

const documentIdOf = (html: string): string => {
    const match = /window\.__AWA_TEST_DOCUMENT__ = "([^"]+)";/.exec(html);
    assert.ok(match, 'a page with test hooks names its rendering');
    return match[1];
};

const snapshotMessage = (documentId: string | undefined, trackRowCount: number) => ({
    type: 'comparison-panel-test-snapshot',
    ...(documentId ? { documentId } : {}),
    renderedUi: { toolbarActions: [], trackRowCount },
});

test('a snapshot from the page a panel replaced is not read as the new page', () => {
    ComparisonPanel.enableTestHooks();
    const extensionUri = uri('/ext');
    const result = { fileName: 'a.wav', filePath: '/audio/a.wav' } as never;
    const panel = ComparisonPanel.show(extensionUri as never, [result]) as unknown as FakePanel;
    const singleTrackPage = documentIdOf(panel.webview.html);
    panel.receive(snapshotMessage(singleTrackPage, 1));
    assert.equal(ComparisonPanel.getTestSnapshot()?.renderedUi?.trackRowCount, 1);

    ComparisonPanel.clearTestSnapshot();
    ComparisonPanel.showDirectorySelection(extensionUri as never, '/audio', ['/audio/a.wav', '/audio/b.wav'], [], [], undefined as never, panel as never);
    const folderPage = documentIdOf(panel.webview.html);
    assert.notEqual(folderPage, singleTrackPage, 'each rendering of the panel has its own name');

    // The single-track page's last snapshot lands after the folder's html was set.
    panel.receive(snapshotMessage(singleTrackPage, 1));
    panel.receive(snapshotMessage(undefined, 1));
    assert.equal(ComparisonPanel.getTestSnapshot()?.resultCount, 0);
    assert.equal(ComparisonPanel.getTestSnapshot()?.renderedUi, undefined, 'the old page\'s rows are not the folder\'s');

    panel.receive(snapshotMessage(folderPage, 0));
    assert.equal(ComparisonPanel.getTestSnapshot()?.renderedUi?.trackRowCount, 0);
});
