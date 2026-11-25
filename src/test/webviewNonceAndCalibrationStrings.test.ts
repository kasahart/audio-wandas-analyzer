import assert from 'node:assert/strict';
import test from 'node:test';
import { createNonce } from '../webview/panels/nonce';
import { renderComparisonDocument } from '../webview/panels/comparisonDocument';
import type { ComparisonState } from '../webview/runtime/types';
import { DEFAULT_SPECTROGRAM_SETTINGS } from '../shared/analysis/analysisTypes';
import { calibrationButtonHtml } from '../webview/runtime/calibrationDecorations';
import { getStrings } from '../shared/i18n/strings';

test('webview CSP nonces are 128-bit random base64 values', () => {
    const nonces = new Set(Array.from({ length: 32 }, () => createNonce()));
    assert.equal(nonces.size, 32);
    for (const nonce of nonces) {
        assert.equal(Buffer.from(nonce, 'base64').length, 16);
    }
});

test('comparison document issues a fresh random nonce per render', () => {
    const assets = { runtimeScriptUri: 'r.js', cspSource: "'self'", language: 'en', appVersion: '0.0.0' };
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

test('comparison document turns the runtime test hooks on only when asked', () => {
    const assets = { runtimeScriptUri: 'r.js', cspSource: "'self'", language: 'en', appVersion: '0.0.0' };
    const state: ComparisonState = { mode: 'results', results: [], spectrogramSettings: DEFAULT_SPECTROGRAM_SETTINGS };
    assert.doesNotMatch(renderComparisonDocument(state, assets), /__AWA_TEST_HOOKS__/);
    assert.match(renderComparisonDocument(state, { ...assets, testHooks: true }), /window\.__AWA_TEST_HOOKS__ = true;/);
    assert.doesNotMatch(renderComparisonDocument(state, { ...assets, testDocumentId: 'document-1' }), /__AWA_TEST_DOCUMENT__/);
    assert.match(
        renderComparisonDocument(state, { ...assets, testHooks: true, testDocumentId: 'document-1' }),
        /window\.__AWA_TEST_DOCUMENT__ = "document-1";/,
    );
});

test('calibration button uses localized label, title and aria-label', () => {
    const ja = getStrings('ja');
    const html = calibrationButtonHtml('track-1', ja);
    assert.ok(html.includes('data-hint="' + ja.calibrationButtonTitle + '"'));
    assert.ok(html.includes('aria-label="' + ja.calibrationButtonAria + '"'));
    assert.ok(html.endsWith('>' + ja.calibrationButtonLabel + '</button>'));
    assert.ok(calibrationButtonHtml('track-1', getStrings('en')).endsWith('>Cal</button>'));
});
