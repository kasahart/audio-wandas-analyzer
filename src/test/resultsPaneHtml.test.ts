import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { resultsPaneHtml, type ResultsPaneParts } from '../webview/runtime/resultsPaneHtml';

const strings = getStrings('en');
const parts: ResultsPaneParts = {
    toolbarHtml: '<b>tb</b>',
    tracksHtml: '<i>tracks</i>',
    audioHtml: '<audio></audio>',
    emptyMessage: 'No <tracks>',
    axisWidth: 64,
};

test('results pane places the supplied toolbar, tracks and audio markup', () => {
    const html = resultsPaneHtml(parts, strings);
    assert.ok(html.startsWith('<div id="toolbar" role="toolbar"'));
    assert.ok(html.includes('"><b>tb</b></div>'));
    assert.ok(html.includes('<div id="stacked-wrap"><i>tracks</i></div>'));
    assert.ok(html.endsWith('<div id="audio-host"><audio></audio></div>'));
});

test('results pane escapes the empty message and sizes the ruler spacer to the axis', () => {
    const html = resultsPaneHtml(parts, strings);
    assert.ok(html.includes('<div id="empty-state"><p>No &lt;tracks&gt;</p></div>'));
    assert.ok(html.includes('id="ruler-axis-spacer" style="width:64px;flex:none"'));
});

test('results pane renders the spectrum section controls', () => {
    const html = resultsPaneHtml(parts, strings);
    for (const action of ['spec-zoom-out', 'spec-zoom-in', 'spec-zoom-reset', 'spectrum-height-drag']) {
        assert.ok(html.includes('data-action="' + action + '"'), action);
    }
    assert.ok(html.includes('<canvas id="spectrum-overlay-canvas" tabindex="0"'));
});
