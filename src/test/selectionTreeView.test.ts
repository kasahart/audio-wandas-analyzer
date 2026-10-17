import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSelectionTree } from '../webview/runtime/directorySelection';
import { createSelectionTreeView, type SelectionTreeViewDeps } from '../webview/runtime/selectionTreeView';

function view(overrides: Partial<SelectionTreeViewDeps> = {}) {
    const tree = buildSelectionTree('/root', ['/root/a.wav', '/root/set/<b>.wav', '/root/set/deep/c.wav']);
    return {
        tree,
        view: createSelectionTreeView({
            document: {} as SelectionTreeViewDeps['document'],
            strings: { ariaSelectionTreeDir: 'Folder', selectionNoSupported: 'No audio files', hintTreeDirectory: 'Expand', hintTreeFile: 'Check' },
            tree,
            rootPath: '/root',
            collapseState: {},
            filterQuery: '',
            isSelected: (filePath) => filePath === '/root/a.wav',
            persist: () => undefined,
            onFileToggled: () => undefined,
            handleAction: () => false,
            syncSummary: () => undefined,
            setFilterFlush: () => undefined,
            setTimeout: () => 0,
            clearTimeout: () => undefined,
            ...overrides,
        }),
    };
}

test('selection tree renders top-level folders expanded and deeper folders lazily', () => {
    const { tree, view: subject } = view();
    const html = subject.renderTree(tree.roots, true, 0);
    assert.match(html, /^<ul class="selection-tree-list is-root">/);
    assert.match(html, /data-relative-path="set" data-depth="0"[^>]*aria-expanded="true"/);
    assert.match(html, /data-relative-path="set\/deep" data-depth="1"[^>]*aria-expanded="false"/);
    assert.match(html, /<ul class="selection-tree-list" data-lazy="true" style="display:none"><\/ul>/);
    assert.doesNotMatch(html, /c\.wav/, 'collapsed folders render their files only when opened');
    assert.match(html, /data-file-path="\/root\/a\.wav" checked>/);
    assert.match(html, /&lt;b&gt;\.wav/);
});

test('selection tree honors saved collapse state, the restored filter and an empty listing', () => {
    const { tree, view: subject } = view({ collapseState: { set: false, 'set/deep': true }, filterQuery: 'deep' });
    const html = subject.renderTree(tree.roots, true, 0);
    assert.match(html, /data-relative-path="set" data-depth="0"[^>]*aria-expanded="false"/);
    assert.equal(subject.filterQuery, 'deep');
    assert.equal(subject.renderTree([], true, 0), '<div class="selection-path">No audio files</div>');
});
