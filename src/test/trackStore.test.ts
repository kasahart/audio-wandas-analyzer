import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnswerStore, FAILED_RETRY_MS } from '../webview/runtime/answerStore';
import { laneDetailState, trackDetailKey, TrackStore } from '../webview/runtime/trackStore';
import type { ComparisonTrackState, TrackRuntimeState } from '../webview/runtime/types';

function result(filePath: string, peakAbsolute = 0.5): ComparisonTrackState {
    return {
        filePath,
        fileName: filePath.split('/').at(-1) ?? filePath,
        sampleRateHz: 48_000,
        durationSeconds: 1,
        channelCount: 1,
        sampleCount: 48_000,
        channels: [{
            label: 'L',
            peakAbsolute,
            fullScale: true,
            sourceUnit: 'FS',
            sourceLevelReferenceLabel: 'dBFS',
            waveform: { min: [-0.5], max: [0.5], samples: [0], absolutePeak: 0.5 },
            spectrogram: null,
        }],
    };
}

function runtime(): TrackRuntimeState {
    return { offsetSeconds: 0, hidden: false };
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
    store.require(bId).runtime.hidden = true;
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
    assert.equal(store.require(bId).runtime.hidden, true);
    assert.deepEqual(reconciliation.removed, []);
    assert.deepEqual(reconciliation.added, [aId]);
});

test('TrackStore keeps duplicate-path occurrence identities stable during updates', () => {
    const store = new TrackStore([result('/same.wav', 0.1), result('/same.wav', 0.2)], runtime);
    const originalIds = store.activeIds();
    store.reconcile([result('/same.wav', 0.3), result('/same.wav', 0.4)], (next) => next);
    assert.deepEqual(store.activeIds(), originalIds);
    assert.equal(store.require(originalIds[0]).result.channels[0].peakAbsolute, 0.3);
    assert.equal(store.require(originalIds[1]).result.channels[0].peakAbsolute, 0.4);
});

test('TrackStore tombstones removals and does not reuse identity at the same protocol index', () => {
    const store = new TrackStore([result('/old.wav')], runtime);
    const oldId = store.activeIds()[0];
    const oldRecord = store.require(oldId);
    oldRecord.requests.ask('range', 'old-request', 'whole', null);
    assert.equal(store.remove(oldId), true);
    assert.equal(store.idAtProtocolIndex(0), null);
    assert.equal(oldRecord.requests.pending('range'), undefined);
    assert.equal(store.get(oldId), undefined);

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
    assert.equal(store.require(bId).spectrumSliceCache.view.size, 0);
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


test('TrackStore restores a locally removed path only after explicit selection', () => {
    const store = new TrackStore([result('/a.wav'), result('/b.wav')], runtime);
    const [aId, bId] = store.activeIds();
    store.remove(aId);
    store.reconcile([result('/a.wav'), result('/b.wav')], next => next);
    assert.deepEqual(store.activeIds(), [bId]);
    store.allowExplicitSelection('/a.wav');
    store.reconcile([result('/a.wav'), result('/b.wav')], next => next);
    assert.equal(store.activeIds().length, 2);
    assert.notEqual(store.activeIds()[0], aId);
    assert.equal(store.activeIds()[1], bId);
});


test('TrackStore releases inactive payloads across repeated deselection and explicit restoration', () => {
    const store = new TrackStore([result('/a.wav'), result('/b.wav')], runtime);
    const bId = store.activeIds()[1];
    for (let cycle = 0; cycle < 50; cycle++) {
        const aId = store.activeIds()[0];
        store.reconcile([result('/b.wav')], next => next);
        assert.equal(store.get(aId), undefined, 'deselection must release the old analysis payload');
        store.reconcile([result('/a.wav'), result('/b.wav')], next => next);
        const restoredId = store.activeIds()[0];
        store.remove(restoredId);
        store.allowExplicitSelection('/a.wav');
        assert.equal(store.get(restoredId), undefined, 'restoration must not retain the removed payload');
        store.reconcile([result('/a.wav'), result('/b.wav')], next => next);
        assert.equal(store.activeIds()[1], bId);
    }
});

test('TrackStore globalSpan covers visible, error-free tracks including their offsets', () => {
    const store = new TrackStore([result('/a.wav'), result('/b.wav'), result('/c.wav'), result('/d.wav')], runtime);
    const [aId, bId, cId, dId] = store.activeIds();
    store.require(aId).runtime.offsetSeconds = -0.5;
    store.require(bId).runtime.offsetSeconds = 2;
    store.require(cId).runtime.offsetSeconds = 10;
    store.require(cId).runtime.hidden = true;
    store.require(dId).result.error = 'failed';
    store.require(dId).runtime.offsetSeconds = -5;

    assert.deepEqual(store.globalSpan(), { startSec: -0.5, endSec: 3, spanSec: 3.5 });
});

test('TrackStore globalSpan falls back to a one-second span when no track is visible', () => {
    const store = new TrackStore([result('/a.wav')], runtime);
    const [aId] = store.activeIds();
    store.require(aId).runtime.hidden = true;
    assert.deepEqual(store.globalSpan(), { startSec: 0, endSec: 1, spanSec: 1 });

    store.require(aId).runtime.hidden = false;
    store.require(aId).result.durationSeconds = 0;
    store.require(aId).runtime.offsetSeconds = 4;
    assert.deepEqual(store.globalSpan(), { startSec: 4, endSec: 5, spanSec: 1 });
});

test('an analysis update keeps the audio source a track already plays from and hands back the protocol-ordered results', () => {
    const store = new TrackStore([{ ...result('/a.wav'), audioSource: 'blob:a' }], runtime);
    const [aId] = store.activeIds();
    const update = store.applyAnalysisUpdate([{ ...result('/b.wav'), audioSource: 'blob:b' }, { ...result('/a.wav', 0.9), audioSource: 'blob:new-a' }]);
    assert.equal(update.protocolOrderChanged, true);
    assert.deepEqual(update.results.map(item => item.filePath), ['/b.wav', '/a.wav']);
    assert.deepEqual(update.results.map(item => item.audioSource), ['blob:b', 'blob:a']);
    assert.equal(update.results[1].channels[0].peakAbsolute, 0.9);
    assert.equal(update.results[1].trackId, aId);
    assert.deepEqual(update.results, store.activeResults());
});

test('a new track without an audio source gets an empty one', () => {
    const store = new TrackStore([], runtime);
    const update = store.applyAnalysisUpdate([result('/a.wav')]);
    assert.equal(update.results[0].audioSource, '');
    assert.equal(update.added.length, 1);
});

test('TrackStore lets the remaining tracks ask for a failed spectrogram again when one is taken off', () => {
    const store = new TrackStore([result('/a.wav'), result('/b.wav')], runtime);
    const [aId, bId] = store.activeIds();
    const key = trackDetailKey(store.require(bId).result, 's');
    store.require(bId).detail.fail(key, 'STFT exceeds the memory budget');

    store.remove(aId);

    assert.equal(store.require(bId).detail.state(key), 'missing');
    assert.equal(store.require(bId).detail.reason(key), undefined);
});

test('TrackStore gives each new track the own colour least in use: a file swapped in again and again never takes the colour of the one kept', () => {
    const store = new TrackStore([result('/a.wav'), result('/b.wav')], runtime);
    const colourOf = (path: string): number | undefined => store.activeResults().map((r) => store.require(r.trackId!)).find((record) => record.result.filePath === path)?.runtime.ownColorIndex;
    assert.deepEqual([colourOf('/a.wav'), colourOf('/b.wav')], [0, 1]);
    for (const other of ['/c.wav', '/d.wav', '/e.wav', '/f.wav']) {
        store.applyAnalysisUpdate([result('/a.wav'), result(other)]);
        assert.equal(colourOf('/a.wav'), 0, 'the kept track keeps its colour');
        assert.notEqual(colourOf(other), 0, `${other} has a colour of its own`);
    }
    store.applyAnalysisUpdate([result('/a.wav'), result('/f.wav'), result('/g.wav'), result('/h.wav')]);
    assert.deepEqual(new Set(['/a.wav', '/f.wav', '/g.wav', '/h.wav'].map(colourOf)).size, 4, 'four tracks, four colours');
});

test('TrackStore gives a file opened twice two colours', () => {
    const store = new TrackStore([result('/same.wav'), result('/same.wav')], runtime);
    assert.deepEqual(store.activeIds().map((id) => store.require(id).runtime.ownColorIndex), [0, 1]);
});

test('a detail answered without a spectrogram is asked exactly once: the lane says there is none, and asks again only when its key changes (file version, calibration, STFT or window settings); a failure is asked again after the answer store\'s pause', () => {
    let clock = 0;
    const detail = createAnswerStore<true>({ capacity: 1, now: () => clock });
    let asks = 0;
    let file = { filePath: '/a.wav', sourceVersion: 'v1', calibrationSignature: 'cal-1' };
    // One drawing of a lane whose channel has no spectrogram, as comparisonRuntime.ts requestTrackDetail and the lane's painter do it.
    const draw = (settings: string): string => {
        if (detail.ask(trackDetailKey(file, settings))) asks++;
        return laneDetailState(detail, trackDetailKey(file, settings));
    };
    const fix = 'A lane asks for its detail only when answerStore.ask(trackDetailKey(...)) says so (trackStore.ts). A valid answer without a spectrogram is the answer under its key '
        + '(docs/display-rules.md R3, "届いた答えに絵がないとき"): record it with detail.empty(key), and never clear the store on the next frame.';

    assert.equal(draw('stft 1024'), 'pending');
    for (let frame = 0; frame < 100; frame++) assert.equal(draw('stft 1024'), 'pending', fix);
    assert.equal(asks, 1, `while the answer is on its way the lane asks once. ${fix}`);

    // The valid answer arrives, with no spectrogram for the channel: the store's empty state.
    detail.empty(trackDetailKey(file, 'stft 1024'));
    for (let frame = 0; frame < 100; frame++) { clock += 1000; assert.equal(draw('stft 1024'), 'answered', `the lane must show the existing "no data" state (spectrogramNone). ${fix}`); }
    assert.equal(asks, 1, `an answer without a spectrogram was asked again, though nothing in its key changed (and time alone does not change it). ${fix}`);

    // Other STFT or window settings are another key: asked once.
    assert.equal(draw('stft 2048'), 'pending');
    assert.equal(draw('stft 2048'), 'pending');
    detail.empty(trackDetailKey(file, 'stft 2048'));
    assert.equal(draw('stft 2048'), 'answered');
    assert.equal(asks, 2, `a change of the spectrogram settings asks once more. ${fix}`);

    // A new version of the file, or another calibration, is another key: asked once each.
    file = { ...file, sourceVersion: 'v2' };
    assert.equal(draw('stft 2048'), 'pending');
    detail.empty(trackDetailKey(file, 'stft 2048'));
    assert.equal(draw('stft 2048'), 'answered');
    file = { ...file, calibrationSignature: 'cal-2' };
    assert.equal(draw('stft 2048'), 'pending');
    assert.equal(asks, 4, `a new file version and a new calibration each ask once more. ${fix}`);

    // A failure stands for the store's pause, then is asked again: the only thing time changes.
    detail.fail(trackDetailKey(file, 'stft 2048'), 'backend busy');
    assert.equal(draw('stft 2048'), 'failed');
    assert.equal(detail.reason(trackDetailKey(file, 'stft 2048')), 'backend busy');
    clock += FAILED_RETRY_MS - 1;
    assert.equal(draw('stft 2048'), 'failed');
    clock += 2;
    assert.equal(draw('stft 2048'), 'pending', 'a failure is asked again once the answer store\'s pause (FAILED_RETRY_MS) is over');
    assert.equal(asks, 5);
});

test('touching the spectrogram settings lets go a track\'s detail failure but keeps its empty answer (clearDetailErrors)', () => {
    const store = new TrackStore([result('/a.wav'), result('/b.wav')], runtime);
    const [a, b] = store.activeIds().map(id => store.require(id));
    const keyA = trackDetailKey(a.result, 's'), keyB = trackDetailKey(b.result, 's');
    a.detail.ask(keyA); a.detail.empty(keyA);
    b.detail.ask(keyB); b.detail.fail(keyB, 'busy');
    store.clearDetailErrors();
    assert.equal(a.detail.state(keyA), 'empty', 'an answer without a spectrogram is kept: asking again would get the same answer (docs/display-rules.md R3)');
    assert.equal(b.detail.state(keyB), 'missing', 'a failure is let go, so the user\'s touch of the settings asks again');
});
