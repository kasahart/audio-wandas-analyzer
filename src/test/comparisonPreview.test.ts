import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComparisonPreviewHtml } from '../tools/comparisonPreview';

test('buildComparisonPreviewHtml returns results-mode ComparisonPanel HTML', () => {
    const html = buildComparisonPreviewHtml('results');

    assert.match(html, /"mode":"results"/);
    assert.match(html, /id="toolbar"/);
    assert.match(html, /data-action="content-waveform"/);
    assert.doesNotMatch(html, /"mode":"directory-selection"/);
});

test('buildComparisonPreviewHtml returns selection-mode ComparisonPanel HTML', () => {
    const html = buildComparisonPreviewHtml('selection');

    assert.match(html, /"mode":"directory-selection"/);
    assert.match(html, /id="selection-toolbar"/);
    assert.match(html, /id="selection-tree"/);
});
