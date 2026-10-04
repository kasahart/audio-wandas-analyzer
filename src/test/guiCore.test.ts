import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintSpectrogramRaster } from '../webview/runtime/spectrogramRaster';
import { normalizedColor, viridis, rasterize } from '../shared/gui-core/index';
import { legacyAnalyzer } from './fixtures/guiCoreLegacy';
import type { SpectrogramData } from '../shared/analysis/analysisTypes';
test('shared kernel preserves Analyzer pixels, including legacy boundary arithmetic and calibrated metadata', () => {
    for (const [columns, bins] of [[1, 1], [7, 13], [32, 17]]) {
        const spec: SpectrogramData = {
            values: Array.from({ length: columns }, (_, c) => Array.from({ length: bins }, (_, b) => -100 + (c * 71 + b * 31) % 101)),
            timeBins: columns, frequencyBins: bins, windowSize: 1024, hopSize: 256,
            maxFrequencyHz: 24000, minDb: -100, maxDb: 0,
            unit: 'dB SPL', axisLabel: 'STFT amplitude level [dB SPL re 20 µPa]', referenceValue: 2e-5, referenceUnit: 'Pa',
        };
        const original = structuredClone(spec);
        for (const [width, height] of [[1, 1], [3, 5], [64, 40]]) {
            for (const [start, end, maxHz] of [[0, 1, 24000], [-0.2, 1.2, 16000], [0.22, 0.51, 12000]]) {
                const view = { zoomStart: start, zoomEnd: end, trackStart: 0, trackDurRatio: 1, dbLo: -100, dbHi: 0, maxFrequencyHz: maxHz };
                const expected = legacyAnalyzer(spec, width, height, { time: { min: start, max: end }, frequency: { min: 0, max: maxHz }, color: { min: -100, max: 0 } });
                const buffer = new Uint8ClampedArray(width * height * 4);
                const result = paintSpectrogramRaster(spec, width, height, view, buffer);
                assert.equal(result.pixels, buffer);
                assert.deepEqual(result.pixels, expected.pixels);
            }
        }
        assert.deepEqual(spec, original);
    }
});
test('comparison peak mode preserves nonfinite and constant-range Analyzer behavior', () => {
    for (const values of [[[NaN, -80], [Infinity, -70]], [[-50, -50], [-50, -50]]]) {
        const spec: SpectrogramData = { values, timeBins: 2, frequencyBins: 2, windowSize: 1024, hopSize: 256, maxFrequencyHz: 24000, minDb: -50, maxDb: -50 };
        const result = paintSpectrogramRaster(spec, 3, 3, { zoomStart: -1, zoomEnd: 2, trackStart: 0, trackDurRatio: 1, dbLo: -50, dbHi: -50, maxFrequencyHz: 12000 });
        const expected = legacyAnalyzer(spec, 3, 3, { time: { min: -1, max: 2 }, frequency: { min: 0, max: 12000 }, color: { min: -50, max: -50 } });
        assert.deepEqual(result.pixels, expected.pixels);
    }
});
test('shared palette endpoints and destination clearing are stable', () => {
    assert.deepEqual(normalizedColor(0, viridis), [68, 1, 84]);
    assert.deepEqual(normalizedColor(1, viridis), [253, 231, 37]);
    const output = new Uint8ClampedArray([255, 255, 255, 255]);
    rasterize({ layout: 'flat', values: [], bins: 0 }, { columns: [null], rows: [null] }, { min: -100, max: 0 }, viridis, output);
    assert.deepEqual([...output], [0, 0, 0, 0]);
});
