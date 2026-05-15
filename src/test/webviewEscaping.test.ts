import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, serializeForScript } from '../shared/utils/webviewEscaping';

test('escapeHtml escapes HTML significant characters', () => {
    assert.equal(
        escapeHtml('<button title="x & y">it\'s me</button>'),
        '&lt;button title=&quot;x &amp; y&quot;&gt;it&#39;s me&lt;/button&gt;',
    );
});

test('serializeForScript neutralizes unsafe script delimiters and separators', () => {
    const serialized = serializeForScript({
        tag: '</script>',
        text: 'A&B',
        lineSeparator: '\u2028',
        paragraphSeparator: '\u2029',
    });

    assert.match(serialized, /\\u003c\/script\\u003e/);
    assert.match(serialized, /A\\u0026B/);
    assert.doesNotMatch(serialized, /</);
    assert.doesNotMatch(serialized, />/);
});
