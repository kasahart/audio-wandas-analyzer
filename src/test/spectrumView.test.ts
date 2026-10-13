import assert from 'node:assert/strict';
import test from 'node:test';
import { SpectrumView } from '../webview/runtime/spectrumView';

test('SpectrumView starts at the full range with no painted data', () => {
    const view = new SpectrumView();
    assert.deepEqual(view.state(), { freqStart: 0, freqEnd: 1, dbMin: null, dbMax: null });
    assert.equal(view.hasData(), false);
    assert.equal(view.paintedDb(), null);
    assert.deepEqual(view.dbRangeFields(), { min: '', max: '' });
    assert.deepEqual(view.frequencyRangeFieldsHz(), { min: '0', max: '0' });
});

test('SpectrumView popover fields prefer overrides and fall back to the rounded painted range', () => {
    const view = new SpectrumView();
    view.recordPaint({ maxFrequencyHz: 24000, dbMin: -80.4, dbMax: -3.6 });
    assert.equal(view.hasData(), true);
    assert.deepEqual(view.dbRangeFields(), { min: '-80', max: '-4' });
    view.setDbRange(-60, null);
    assert.deepEqual(view.dbRangeFields(), { min: '-60', max: '-4' });
    view.freqStart = 0.25;
    view.freqEnd = 0.5;
    assert.deepEqual(view.frequencyRangeFieldsHz(), { min: '6000', max: '12000' });
});

test('SpectrumView.setFrequencyRangeHz clamps to the painted maximum and rejects an empty range', () => {
    const view = new SpectrumView();
    view.recordPaint({ maxFrequencyHz: 1000, dbMin: -60, dbMax: 0 });
    assert.equal(view.setFrequencyRangeHz(100, 2000), true);
    assert.deepEqual([view.freqStart, view.freqEnd], [0.1, 1]);
    assert.equal(view.setFrequencyRangeHz(null, 500), true);
    assert.deepEqual([view.freqStart, view.freqEnd], [0, 0.5]);
    assert.equal(view.setFrequencyRangeHz(600, 400), false);
    assert.deepEqual([view.freqStart, view.freqEnd], [0, 0.5]);
    view.resetFrequency();
    assert.deepEqual([view.freqStart, view.freqEnd], [0, 1]);
});

test('SpectrumView.zoomBy narrows frequency and dB around the painted range, and reset clears both', () => {
    const view = new SpectrumView();
    view.zoomBy(0.5);
    assert.deepEqual([view.freqStart, view.freqEnd], [0.25, 0.75]);
    assert.deepEqual([view.dbMin, view.dbMax], [null, null]);
    view.recordPaint({ maxFrequencyHz: 1000, dbMin: -60, dbMax: 0 });
    view.zoomBy(0.5);
    assert.deepEqual([view.dbMin, view.dbMax], [-45, -15]);
    view.reset();
    assert.deepEqual(view.state(), { freqStart: 0, freqEnd: 1, dbMin: null, dbMax: null });
});

test('SpectrumView.applyBoxZoom keeps the dB range when the box carries none', () => {
    const view = new SpectrumView();
    view.setDbRange(-50, -10);
    view.applyBoxZoom({ freqStart: 0.2, freqEnd: 0.4 });
    assert.deepEqual(view.state(), { freqStart: 0.2, freqEnd: 0.4, dbMin: -50, dbMax: -10 });
    view.applyBoxZoom({ freqStart: 0.1, freqEnd: 0.3, dbMin: -40, dbMax: -20 });
    assert.deepEqual(view.state(), { freqStart: 0.1, freqEnd: 0.3, dbMin: -40, dbMax: -20 });
});
