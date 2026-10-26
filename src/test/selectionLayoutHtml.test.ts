import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { panelToggleHtml } from '../webview/runtime/panelCollapse';
import { selectionFolderButton, selectionLayoutHtml, type SelectionLayoutParts } from '../webview/runtime/selectionLayoutHtml';

const strings = getStrings('en');
const parts: SelectionLayoutParts = {
    rootPath: '/data/a&b',
    resultsPaneHtml: '<div id="toolbar"></div>',
    python: { text: 'Python: py3', tooltip: '/usr/bin/<py3>', warning: false },
};

test('selection layout docks the entry table in the side panel beside the results pane', () => {
    const html = selectionLayoutHtml(parts, strings);
    assert.ok(html.startsWith('<div id="directory-selection-layout">'));
    assert.ok(html.includes('<div id="entry-dock" data-empty-hint="' + strings.selectionEmptyHint + '"></div>'), 'says what the panel will hold before a folder is open');
    assert.ok(!html.includes('selection-tree'), 'no folder tree');
    assert.ok(html.includes('<div id="selection-results-pane"><div id="toolbar"></div>'));
});

test('selection layout python button reflects the warning state', () => {
    const ok = selectionLayoutHtml(parts, strings);
    assert.ok(ok.includes('<button class="tb-btn" id="selection-python-environment" data-action="select-python-environment" data-hint="/usr/bin/&lt;py3&gt;" aria-description="/usr/bin/&lt;py3&gt;">Python: py3</button>'));
    const warn = selectionLayoutHtml({ ...parts, python: { ...parts.python!, warning: true } }, strings);
    assert.ok(warn.includes('<button class="tb-btn is-warning" id="selection-python-environment"'));
    assert.ok(!selectionLayoutHtml({ ...parts, python: undefined }, strings).includes('select-python-environment'));
});

test('selection layout renders the selection actions', () => {
    const html = selectionLayoutHtml(parts, strings);
    for (const action of ['open-file', 'open-folder']) {
        assert.ok(html.includes('data-action="' + action + '"'), action);
    }
});

test('selection layout offers "another" folder only while something is listed and marks an empty list', () => {
    assert.deepEqual(selectionFolderButton(true, strings), { text: strings.btnOpenAnotherFolder, hint: strings.hintOpenFolder });
    assert.deepEqual(selectionFolderButton(false, strings), { text: strings.btnOpenFolder, hint: strings.hintBrowserOpenFolder });
    const empty = selectionLayoutHtml({ ...parts, rootPath: '', isEmpty: true }, strings);
    assert.ok(empty.startsWith('<div id="directory-selection-layout" class="is-empty">'));
    assert.ok(empty.includes('data-action="open-folder" data-hint="' + strings.hintBrowserOpenFolder + '"'));
    assert.ok(empty.includes('>' + strings.btnOpenFolder + '</button>'));
    const picked = selectionLayoutHtml({ ...parts, rootPath: '', isEmpty: false }, strings);
    assert.ok(picked.includes('>' + strings.btnOpenAnotherFolder + '</button>'));
});

test('the file list carries its own collapse toggle that reflects the collapsed state', () => {
    const open = selectionLayoutHtml(parts, strings);
    const toolbar = open.slice(open.indexOf('id="selection-toolbar"'), open.indexOf('id="selection-body"'));
    assert.ok(!toolbar.includes('toggle-selection-sidebar'));
    const sidebar = open.slice(open.indexOf('<div id="selection-sidebar">') + '<div id="selection-sidebar">'.length);
    assert.ok(sidebar.trimStart().startsWith(panelToggleHtml('sidebar', false, strings)));
    assert.ok(open.includes('data-action="toggle-selection-sidebar" aria-expanded="true" data-hint="' + strings.hintCollapseSidebar + '"'));
    assert.ok(!open.includes('sidebar-collapsed'));
    const collapsed = selectionLayoutHtml({ ...parts, isEmpty: true, sidebarCollapsed: true }, strings);
    assert.ok(collapsed.startsWith('<div id="directory-selection-layout" class="is-empty sidebar-collapsed">'));
    assert.ok(collapsed.includes('data-action="toggle-selection-sidebar" aria-expanded="false" data-hint="' + strings.hintExpandSidebar + '"'));
    assert.ok(collapsed.includes('<button id="selection-sidebar-rail" data-action="toggle-selection-sidebar" data-hint="' + strings.hintExpandSidebar + '"'));
});
