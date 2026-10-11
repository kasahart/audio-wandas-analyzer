import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createNonce } from '../webview/panels/nonce';
import { renderComparisonDocument } from '../webview/panels/comparisonDocument';
import type { ComparisonState } from '../webview/runtime/types';
import { DEFAULT_SPECTROGRAM_SETTINGS } from '../shared/analysis/analysisTypes';
import { applyOverlayCompatibility, calibrationButtonHtml } from '../webview/runtime/calibrationDecorations';
import { getStrings } from '../shared/i18n/strings';

test('webview CSP nonces are 128-bit random base64 values', () => {
    const nonces = new Set(Array.from({ length: 32 }, () => createNonce()));
    assert.equal(nonces.size, 32);
    for (const nonce of nonces) {
        assert.equal(Buffer.from(nonce, 'base64').length, 16);
    }
});

test('comparison document issues a fresh random nonce per render', () => {
    const assets = { waveformScriptUri: 'w.js', runtimeScriptUri: 'r.js', cspSource: "'self'", language: 'en' };
    const nonceOf = (html: string) => {
        const match = /script-src 'nonce-([^']+)'/.exec(html);
        assert.ok(match);
        return match[1];
    };
    const state = { mode: 'results', results: [], spectrogramSettings: DEFAULT_SPECTROGRAM_SETTINGS } as unknown as ComparisonState;
    const first = nonceOf(renderComparisonDocument(state, assets));
    const second = nonceOf(renderComparisonDocument(state, assets));
    assert.notEqual(first, second);
    assert.equal(Buffer.from(first, 'base64').length, 16);
});

test('calibration button uses localized label, title and aria-label', () => {
    const ja = getStrings('ja');
    const html = calibrationButtonHtml('track-1', ja);
    assert.ok(html.includes('title="' + ja.calibrationButtonTitle + '"'));
    assert.ok(html.includes('aria-label="' + ja.calibrationButtonAria + '"'));
    assert.ok(html.endsWith('>' + ja.calibrationButtonLabel + '</button>'));
    assert.ok(calibrationButtonHtml('track-1', getStrings('en')).endsWith('>Cal</button>'));
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
