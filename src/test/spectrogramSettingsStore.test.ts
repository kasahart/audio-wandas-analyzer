import assert from 'node:assert/strict';
import test from 'node:test';
import { SpectrogramSettingsStore } from '../webview/runtime/spectrogramSettingsStore';
import type { SpectrogramSettings } from '../shared/analysis/analysisTypes';

function saved(): SpectrogramSettings {
    return { auto: false, stft: { nFft: 2048, overlapPercent: 50, window: 'hann' }, display: { dbMin: -80, dbMax: 0, maxFrequencyHz: 8000, minFrequencyHz: 100 } };
}

test('a page opened without settings starts from the defaults', () => {
    const store = new SpectrogramSettingsStore(undefined);
    assert.deepEqual(store.settings, { auto: true, stft: { nFft: 1024, overlapPercent: 75, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } });
    assert.equal(store.dataSignature, JSON.stringify({ auto: true, stft: { nFft: 1024, overlapPercent: 75, window: 'hann' } }));
    assert.equal(store.reanalyzeBusy, false);
});

test('the display range does not change the data signature, and the axis lower frequency survives the ⚙ popover', () => {
    const store = new SpectrogramSettingsStore(saved());
    const signature = store.dataSignature;
    store.setDisplay({ dbMin: -60, dbMax: null, maxFrequencyHz: 4000 });
    assert.deepEqual(store.display, { dbMin: -60, dbMax: null, maxFrequencyHz: 4000, minFrequencyHz: 100 });
    assert.equal(store.dataSignature, signature);
    store.setDisplay({ dbMin: null, dbMax: null, maxFrequencyHz: null, minFrequencyHz: null });
    assert.equal(store.display.minFrequencyHz, null);
});

test('new STFT settings keep the lower frequency set on the axis and change the signature', () => {
    const store = new SpectrogramSettingsStore(saved());
    const signature = store.dataSignature;
    store.applyStft({ auto: false, stft: { nFft: 512, overlapPercent: 75, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } });
    assert.equal(store.display.minFrequencyHz, 100);
    assert.equal(store.settings.stft.nFft, 512);
    assert.notEqual(store.dataSignature, signature);
});

test('reset returns to the defaults, a fresh copy each time', () => {
    const store = new SpectrogramSettingsStore(saved());
    store.reset();
    store.display.dbMin = -10;
    store.reset();
    assert.equal(store.display.dbMin, null);
    assert.equal(store.settings.auto, true);
});

test('a re-analysis is busy until it is said to end', () => {
    const store = new SpectrogramSettingsStore(undefined);
    store.setReanalyzeBusy(true);
    assert.equal(store.reanalyzeBusy, true);
    store.setReanalyzeBusy(false);
    assert.equal(store.reanalyzeBusy, false);
});
