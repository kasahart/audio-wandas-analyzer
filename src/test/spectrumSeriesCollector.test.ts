import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSpectrumSeries, type SpectrumSeriesSource } from '../webview/runtime/spectrumSeriesCollector';
import type { SpectrumSlice } from '../webview/runtime/types';

const slice: SpectrumSlice = { values: [-10], frequencyBins: 1, maxFrequencyHz: 100, minDb: -10, maxDb: -10, unit: 'dB' };

function source(missing: Set<string>, pending: Set<number>): SpectrumSeriesSource<{ name: string; channels: number }> {
    return {
        channelCount: (r) => r.channels,
        slice: (_r, i, _offset, _norm, ch) => (missing.has(i + ':' + ch) ? null : slice),
        isPending: (i) => pending.has(i),
        color: (i) => 'c' + i,
        label: (r, ch) => r.name + '/' + ch,
    };
}

test('collectSpectrumSeries emits one series per channel of each visible track in order', () => {
    const tracks = [
        { index: 1, result: { name: 'b', channels: 2 }, hidden: false, offsetSeconds: 0 },
        { index: 0, result: { name: 'a', channels: 1 }, hidden: true, offsetSeconds: 0 },
        { index: 2, result: { name: 'c', channels: 1 }, hidden: false, offsetSeconds: 0 },
    ];
    const collected = collectSpectrumSeries(tracks, 0.5, source(new Set(), new Set()));
    assert.deepEqual(collected.series.map((s) => [s.index, s.channelIndex, s.label, s.color]), [
        [1, 0, 'b/0', 'c1'],
        [1, 1, 'b/1', 'c1'],
        [2, 0, 'c/0', 'c2'],
    ]);
    assert.equal(collected.pending, false);
});

test('collectSpectrumSeries flags a missing slice whose request is still pending', () => {
    const tracks = [
        { index: 0, result: { name: 'a', channels: 1 }, hidden: false, offsetSeconds: 0 },
        { index: 1, result: { name: 'b', channels: 1 }, hidden: false, offsetSeconds: 0 },
    ];
    assert.equal(collectSpectrumSeries(tracks, 0.5, source(new Set(['0:0']), new Set())).pending, false);
    const collected = collectSpectrumSeries(tracks, 0.5, source(new Set(['0:0']), new Set([0])));
    assert.equal(collected.pending, true);
    assert.deepEqual(collected.series.map((s) => s.index), [1]);
});
