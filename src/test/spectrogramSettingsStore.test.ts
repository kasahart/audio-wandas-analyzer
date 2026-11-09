import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    assert.equal(store.applyStft({ auto: false, stft: { nFft: 512, overlapPercent: 75, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } }), true);
    assert.equal(store.display.minFrequencyHz, 100);
    assert.equal(store.settings.stft.nFft, 512);
    assert.notEqual(store.dataSignature, signature);
});

test('reset returns to the defaults, a fresh copy each time, and says when that changes the STFT', () => {
    const store = new SpectrogramSettingsStore(saved());
    assert.equal(store.reset(), true, 'from nFft 2048 back to auto: the spectra must be made again');
    store.display.dbMin = -10;
    assert.equal(store.reset(), false, 'the display range alone: nothing to analyse again');
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

test('every change of the STFT analyses again: Reset and Apply go through one reanalysis, the only request-reanalyze', () => {
    const runtime = readFileSync(path.join(__dirname, '..', '..', 'src', 'webview', 'runtime', 'comparisonRuntime.ts'), 'utf8');
    const body = (name: string): string => {
        const start = runtime.indexOf(`function ${name}(`);
        assert.ok(start >= 0, name);
        return runtime.slice(start, runtime.indexOf('\n    }\n', start));
    };
    assert.equal(runtime.split("type: 'request-reanalyze'").length - 1, 1, 'one place asks for a reanalysis');
    const reanalyze = body('reanalyzeSpectrogram');
    for (const step of ["type: 'request-reanalyze'", 'invalidateDesiredSpectrumSliceRequests()', 'laneReads.clear()']) assert.ok(reanalyze.includes(step), step);
    // Each call that can change the STFT has its answer acted on: a changed STFT analyses again.
    const calls = [...runtime.matchAll(/spectrogramSettings\.(reset|applyStft)\(/g)];
    assert.ok(calls.length >= 2);
    for (const call of calls) {
        const after = runtime.slice(call.index, call.index + 160);
        assert.match(after, /reanalyzeSpectrogram\(\)/u, `${call[0]} is followed by the reanalysis`);
    }
});
