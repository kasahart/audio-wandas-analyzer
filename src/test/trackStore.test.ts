import assert from 'node:assert/strict';
import test from 'node:test';
import { TrackStore } from '../webview/runtime/trackStore';
import type { ComparisonTrackState, TrackRuntimeState } from '../webview/runtime/types';

function result(filePath: string, rms = 0.1): ComparisonTrackState {
    return {
        filePath,
        fileName: filePath.split('/').at(-1) ?? filePath,
        sampleRateHz: 48_000,
        durationSeconds: 1,
        channelCount: 1,
        sampleCount: 48_000,
        channels: [{
            label: 'L',
            rms,
            peakAbsolute: 0.5,
            dominantFrequencies: [],
            waveform: { min: [-0.5], max: [0.5], samples: [0], absolutePeak: 0.5 },
            spectrogram: null,
        }],
    };
}

function runtime(): TrackRuntimeState {
    return { offsetSeconds: 0, hidden: false, color: null, defaultColor: '#123456' };
}

test('TrackStore assigns unique identities to duplicate file instances', () => {
    const store = new TrackStore([result('/same.wav'), result('/same.wav')], runtime);
    const ids = store.activeIds();
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(store.protocolIndexForId(ids[0]), 0);
    assert.equal(store.protocolIndexForId(ids[1]), 1);
});

test('TrackStore preserves runtime state and display order across result reconciliation', () => {
    const store = new TrackStore([result('/b.wav'), result('/c.wav')], runtime);
    const [bId, cId] = store.activeIds();
    store.require(bId).runtime.offsetSeconds = 0.25;
    store.require(bId).runtime.color = '#abcdef';
    store.reorder(cId, bId);

    const reconciliation = store.reconcile(
        [result('/a.wav'), result('/b.wav', 0.2), result('/c.wav', 0.3)],
        (next, previous) => ({ ...next, audioSource: previous?.audioSource }),
    );

    const [aId, nextBId, nextCId] = store.activeIds();
    assert.equal(nextBId, bId);
    assert.equal(nextCId, cId);
    assert.notEqual(aId, bId);
    assert.deepEqual(store.activeIds(), [aId, bId, cId]);
    assert.deepEqual(store.displayOrder, [cId, bId, aId]);
    assert.equal(store.require(bId).runtime.offsetSeconds, 0.25);
    assert.equal(store.require(bId).runtime.color, '#abcdef');
    assert.deepEqual(reconciliation.removed, []);
    assert.deepEqual(reconciliation.added, [aId]);
});

test('TrackStore keeps duplicate-path occurrence identities stable during updates', () => {
    const store = new TrackStore([result('/same.wav', 0.1), result('/same.wav', 0.2)], runtime);
    const originalIds = store.activeIds();
    store.reconcile([result('/same.wav', 0.3), result('/same.wav', 0.4)], (next) => next);
    assert.deepEqual(store.activeIds(), originalIds);
    assert.equal(store.require(originalIds[0]).result.channels[0].rms, 0.3);
    assert.equal(store.require(originalIds[1]).result.channels[0].rms, 0.4);
});

test('TrackStore tombstones removals and does not reuse identity at the same protocol index', () => {
    const store = new TrackStore([result('/old.wav')], runtime);
    const oldId = store.activeIds()[0];
    store.require(oldId).pendingRangeRequest = 'old-request';
    assert.equal(store.remove(oldId), true);
    assert.equal(store.idAtProtocolIndex(0), null);
    assert.equal(store.require(oldId).pendingRangeRequest, null);

    store.reconcile([result('/replacement.wav')], (next) => next);
    const replacementId = store.idAtProtocolIndex(0);
    assert.ok(replacementId);
    assert.notEqual(replacementId, oldId);
});

test('TrackStore clears analysis caches without moving runtime state to another track', () => {
    const store = new TrackStore([result('/a.wav'), result('/b.wav')], runtime);
    const [aId, bId] = store.activeIds();
    store.require(aId).runtime.hidden = true;
    store.require(bId).spectrumSliceCache.set(0, {
        values: [-10], frequencyBins: 1, maxFrequencyHz: 100, minDb: -100, maxDb: 0,
    });
    store.reconcile([result('/b.wav'), result('/a.wav')], (next) => next);

    assert.equal(store.protocolIndexForId(bId), 0);
    assert.equal(store.protocolIndexForId(aId), 1);
    assert.equal(store.require(aId).runtime.hidden, true);
    assert.equal(store.require(bId).runtime.hidden, false);
    assert.equal(store.require(bId).spectrumSliceCache.size, 0);
});

test('TrackStore keeps locally removed paths tombstoned across full result updates', () => {
    const store = new TrackStore([result('/a.wav'), result('/b.wav')], runtime);
    const [aId, bId] = store.activeIds();
    store.remove(aId);

    const first = store.reconcile([result('/a.wav'), result('/b.wav')], (next) => next);
    assert.deepEqual(store.activeIds(), [bId]);
    assert.equal(store.protocolIndexForId(bId), 0);
    assert.equal(first.protocolOrderChanged, true);

    const second = store.reconcile([result('/a.wav'), result('/b.wav')], (next) => next);
    assert.deepEqual(store.activeIds(), [bId]);
    assert.deepEqual(second.added, []);
    assert.equal(second.protocolOrderChanged, false);
});

test('TrackStore reports protocol mapping changes when results reorder', () => {
    const store = new TrackStore([result('/a.wav'), result('/b.wav')], runtime);
    const reconciliation = store.reconcile([result('/b.wav'), result('/a.wav')], (next) => next);

    assert.equal(reconciliation.protocolOrderChanged, true);
});
