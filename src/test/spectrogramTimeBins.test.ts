import test from 'node:test';
import assert from 'node:assert/strict';
import { spectrogramTimeBinAt, spectrogramTimeBinEdges, spectrogramTimeBinSpan } from '../webview/spectrum/spectrogramTimeBins';

test('spectrogramTimeBinEdges centres each cell on its frame centre with edges halfway to the neighbours', () => {
    // 1 s file, hop 0.25 s, first window centred 0.25 s before the file start.
    const edges = spectrogramTimeBinEdges({ timeBins: 4, timeCentersSec: [-0.25, 0, 0.25, 0.5] }, 1);
    assert.deepEqual(edges, [-0.375, -0.125, 0.125, 0.375, 0.625]);
    for (const [k, center] of [-0.25, 0, 0.25, 0.5].entries()) {
        assert.equal((edges![k] + edges![k + 1]) / 2, center);
    }
});

test('spectrogramTimeBinEdges is null without usable frame centres', () => {
    assert.equal(spectrogramTimeBinEdges({ timeBins: 3 }, 1), null);
    assert.equal(spectrogramTimeBinEdges({ timeBins: 3, timeCentersSec: [0, 0.5] }, 1), null);
    assert.equal(spectrogramTimeBinEdges({ timeBins: 1, timeCentersSec: [0.5] }, 1), null);
    assert.equal(spectrogramTimeBinEdges({ timeBins: 2, timeCentersSec: [0, NaN] }, 1), null);
    assert.equal(spectrogramTimeBinEdges({ timeBins: 2, timeCentersSec: [0, 0.5] }, 0), null);
    assert.equal(spectrogramTimeBinEdges({ timeBins: 3, timeCentersSec: [0, 0.5, 0.5] }, 1), null);
    assert.equal(spectrogramTimeBinEdges({ timeBins: 2, timeCentersSec: [0.5, 0] }, 1), null);
});

test('spectrogramTimeBinAt and spectrogramTimeBinSpan pick the cells under a time and a span', () => {
    const edges = [-0.375, -0.125, 0.125, 0.375, 0.625];
    assert.equal(spectrogramTimeBinAt(edges, 0), 1);
    assert.equal(spectrogramTimeBinAt(edges, 0.13), 2);
    assert.equal(spectrogramTimeBinAt(edges, 0.9), 3);
    assert.equal(spectrogramTimeBinAt(edges, -1), 0);
    assert.deepEqual(spectrogramTimeBinSpan(edges, 0, 0.1), [1, 2]);
    assert.deepEqual(spectrogramTimeBinSpan(edges, 0.1, 0.2), [1, 3]);
    assert.deepEqual(spectrogramTimeBinSpan(edges, 0.125, 0.375), [2, 3]);
    assert.deepEqual(spectrogramTimeBinSpan(edges, 0.9, 1), [3, 4]);
});
