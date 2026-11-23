
import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';

import { legendHtml } from '../webview/runtime/comparePanes';

test('a legend item ends with the markup its caller adds (the base group\'s ▾), after its label', () => {
    const strings = getStrings('en');
    const html = legendHtml([
        { color: '#000', label: 'Base <group>', trailingHtml: '<button data-action="stage-base-info">▾</button>' },
        { color: '#111', label: 'a.wav', path: '/a.wav', value: 'Leq 60.0' },
    ], strings);
    assert.match(html, /^<span class="compare-legend-item"><svg[^]*<span class="compare-legend-label">Base &lt;group&gt;<\/span><button data-action="stage-base-info">▾<\/button><\/span><span class="compare-legend-item">/);
    assert.equal(html.split('stage-base-info').length, 2);
});

