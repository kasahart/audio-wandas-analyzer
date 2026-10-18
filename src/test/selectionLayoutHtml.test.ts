import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { selectionFolderButton, selectionLayoutHtml, type SelectionLayoutParts } from '../webview/runtime/selectionLayoutHtml';

const strings = getStrings('en');
const parts: SelectionLayoutParts = {
    rootPath: '/data/a&b',
    filterQuery: '"wav"',
    treeHtml: '<ul>tree</ul>',
    resultsPaneHtml: '<div id="toolbar"></div>',
    python: { text: 'Python: py3', tooltip: '/usr/bin/<py3>', warning: false },
};

test('selection layout embeds the tree and results pane and escapes user text', () => {
    const html = selectionLayoutHtml(parts, strings);
    assert.ok(html.startsWith('<div id="directory-selection-layout">'));
    assert.ok(html.includes('<div class="selection-path">/data/a&amp;b</div>'));
    assert.ok(html.includes('value="&quot;wav&quot;"'));
    assert.ok(html.includes('aria-label="' + strings.ariaSelectionTree + '"><ul>tree</ul></div>'));
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
    for (const action of ['open-file', 'open-folder', 'selection-select-all', 'selection-clear-all']) {
        assert.ok(html.includes('data-action="' + action + '"'), action);
    }
});

test('selection layout offers "another" folder only while one is listed and marks an empty list', () => {
    assert.deepEqual(selectionFolderButton('/data', strings), { text: strings.btnOpenAnotherFolder, hint: strings.hintOpenFolder });
    assert.deepEqual(selectionFolderButton('', strings), { text: strings.btnOpenFolder, hint: strings.hintBrowserOpenFolder });
    const empty = selectionLayoutHtml({ ...parts, rootPath: '', isEmpty: true }, strings);
    assert.ok(empty.startsWith('<div id="directory-selection-layout" class="is-empty">'));
    assert.ok(empty.includes('data-action="open-folder" data-hint="' + strings.hintBrowserOpenFolder + '"'));
    assert.ok(empty.includes('>' + strings.btnOpenFolder + '</button>'));
});
