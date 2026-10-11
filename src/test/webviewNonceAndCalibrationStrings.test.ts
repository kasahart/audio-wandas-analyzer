import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createNonce } from '../webview/panels/nonce';
import { applyOverlayCompatibility, calibrationButtonHtml } from '../webview/runtime/calibrationDecorations';
import { getStrings } from '../shared/i18n/strings';

test('webview CSP nonces are 128-bit random base64 values', () => {
    const nonces = new Set(Array.from({ length: 32 }, () => createNonce()));
    assert.equal(nonces.size, 32);
    for (const nonce of nonces) {
        assert.equal(Buffer.from(nonce, 'base64').length, 16);
    }
});

test('webview panels do not derive CSP nonces from the clock', () => {
    for (const file of ['ChartSpecPanel.ts', 'comparisonDocument.ts']) {
        const source = readFileSync(path.resolve(process.cwd(), 'src/webview/panels', file), 'utf8');
        assert.doesNotMatch(source, /Date\.now\(\)/, file);
        assert.match(source, /createNonce\(\)/, file);
    }
});

test('calibration button uses localized label, title and aria-label', () => {
    const ja = getStrings('ja');
    const html = calibrationButtonHtml('track-1', ja);
    assert.match(html, new RegExp('title="' + ja.calibrationButtonTitle + '"'));
    assert.match(html, new RegExp('aria-label="' + ja.calibrationButtonAria + '"'));
    assert.match(html, new RegExp('>' + ja.calibrationButtonLabel + '</button>$'));
    assert.match(calibrationButtonHtml('track-1', getStrings('en')), />Cal<\/button>$/);
});

test('overlay incompatibility warning shows the localized message and clears when compatible', () => {
    const dom = new JSDOM('<div id="spectrum-overlay-wrap"><canvas id="spectrum-overlay-canvas"></canvas></div>');
    const document = dom.window.document;
    const ja = getStrings('ja');
    applyOverlayCompatibility(document, true, ja.calibrationOverlayIncompatible);
    assert.equal(document.querySelector('.calibration-overlay-warning')?.textContent, ja.calibrationOverlayIncompatible);
    assert.equal(document.getElementById('spectrum-overlay-canvas')?.getAttribute('data-calibration-hidden'), 'true');
    applyOverlayCompatibility(document, false, ja.calibrationOverlayIncompatible);
    assert.equal(document.querySelector('.calibration-overlay-warning'), null);
});
