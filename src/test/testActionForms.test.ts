import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
    fillSpectrogramDisplayForm,
    fillSpectrogramSettingsForm,
    heightDragFromPayload,
    loopRegionFromPayload,
    setSelectionFileChecked,
    testActionTrackId,
} from '../webview/runtime/testActionForms';
import type { RuntimeDocument, TrackId } from '../webview/runtime/types';

function field(doc: RuntimeDocument, id: string): HTMLInputElement {
    return doc.getElementById(id) as HTMLInputElement;
}

function makeDoc(html: string): RuntimeDocument {
    return new JSDOM(`<!doctype html><body>${html}</body>`).window.document as unknown as RuntimeDocument;
}

test('fillSpectrogramSettingsForm: 指定された項目だけを書き換え、auto は常に反映する', () => {
    const doc = makeDoc(`
        <input type="checkbox" id="spec-auto" checked>
        <input id="spec-nfft" value="1024">
        <input id="spec-hop" value="256">
        <select id="spec-window"><option value="hann">hann</option><option value="hamming">hamming</option></select>`);
    fillSpectrogramSettingsForm(doc, { auto: false, nFft: 2048, window: 'hamming' });
    assert.equal(field(doc, 'spec-auto').checked, false);
    assert.equal(field(doc, 'spec-nfft').value, '2048');
    assert.equal(field(doc, 'spec-hop').value, '256');
    assert.equal(field(doc, 'spec-window').value, 'hamming');
});

test('fillSpectrogramDisplayForm: 入力欄を埋め、数値以外は null の表示設定を返す', () => {
    const doc = makeDoc('<input id="spec-dbmin" value="x"><input id="spec-dbmax"><input id="spec-maxfreq">');
    const display = fillSpectrogramDisplayForm(doc, { dbMin: -90, dbMax: null, maxFrequencyHz: '8000' });
    assert.equal(field(doc, 'spec-dbmin').value, '-90');
    assert.equal(field(doc, 'spec-dbmax').value, '');
    assert.equal(field(doc, 'spec-maxfreq').value, '8000');
    assert.deepEqual(display, { dbMin: -90, dbMax: null, maxFrequencyHz: null });
});

test('fillSpectrogramSettingsForm: names the missing form field', () => {
    const doc = makeDoc('<input type="checkbox" id="spec-auto">');
    assert.throws(() => fillSpectrogramSettingsForm(doc, { auto: true, nFft: 2048 }), /Form field not found: spec-nfft/);
});

test('setSelectionFileChecked: 対象のチェックボックスを切り替えて change を発火する', () => {
    const doc = makeDoc(`
        <input type="checkbox" class="selection-file-checkbox" data-file-path="/a.wav">
        <input type="checkbox" class="selection-file-checkbox" data-file-path="/b.wav">`);
    const changed: string[] = [];
    doc.addEventListener('change', (event) => { changed.push(event.target.getAttribute('data-file-path') || ''); });
    setSelectionFileChecked(doc, '/b.wav', true);
    const boxes = Array.from(doc.querySelectorAll('.selection-file-checkbox'));
    assert.deepEqual(boxes.map((b) => b.checked), [false, true]);
    assert.deepEqual(changed, ['/b.wav']);
    assert.throws(() => setSelectionFileChecked(doc, '/missing.wav', true), /Selection checkbox not found/);
});

test('loopRegionFromPayload: 0..1 に収め、幅がなければ null', () => {
    assert.deepEqual(loopRegionFromPayload({ start: -0.5, end: 0.4 }), { start: 0, end: 0.4 });
    assert.deepEqual(loopRegionFromPayload({ start: 0.2, end: 3 }), { start: 0.2, end: 1 });
    assert.equal(loopRegionFromPayload({ start: 0.5, end: 0.5 }), null);
    assert.equal(loopRegionFromPayload({ start: 'x', end: 0.5 }), null);
});

test('testActionTrackId prefers a known trackId and otherwise falls back to trackIndex', () => {
    const known = new Set(['track-1']);
    const isKnown = (id: TrackId) => known.has(id);
    const atIndex = (i: number) => (i === 0 ? 'track-9' as TrackId : null);
    assert.equal(testActionTrackId({ action: 'x', trackId: 'track-1', trackIndex: 0 }, isKnown, atIndex), 'track-1');
    assert.equal(testActionTrackId({ action: 'x', trackId: 'gone', trackIndex: 0 }, isKnown, atIndex), 'track-9');
    assert.equal(testActionTrackId({ action: 'x', trackIndex: 3 }, isKnown, atIndex), null);
    assert.equal(testActionTrackId({ action: 'x' }, isKnown, atIndex), null);
});

test('heightDragFromPayload defaults to a zero-length track drag', () => {
    assert.deepEqual(heightDragFromPayload({}), { kind: 'track', startY: 0, endY: 0 });
    assert.deepEqual(heightDragFromPayload({ kind: 'spectrum', startY: 100, endY: 40 }), { kind: 'spectrum', startY: 100, endY: 40 });
    assert.deepEqual(heightDragFromPayload({ startY: 50 }), { kind: 'track', startY: 50, endY: 50 });
});
