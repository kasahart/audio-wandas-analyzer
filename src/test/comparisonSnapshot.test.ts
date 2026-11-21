import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrackSnapshot, type SnapshotTrack, type TrackSnapshotSource } from '../webview/runtime/comparisonSnapshot';
import type { ComparisonTrackState, TrackId } from '../webview/runtime/types';

function result(filePath: string, durationSeconds = 2): ComparisonTrackState {
    return {
        filePath,
        fileName: filePath,
        sampleRateHz: 8000,
        durationSeconds,
        channelCount: 1,
        sampleCount: 8000 * durationSeconds,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, sourceUnit: 'FS', sourceLevelReferenceLabel: 'dBFS' }],
    };
}

function track(index: number, overrides: Partial<SnapshotTrack> = {}): SnapshotTrack {
    return {
        trackId: `track-${index + 1}` as TrackId,
        trackIndex: index,
        result: result(`/t${index}.wav`),
        offsetSeconds: 0,
        hidden: false,
        ...overrides,
    };
}


function source(tracks: SnapshotTrack[], peeked: number[]): TrackSnapshotSource {
    return {
        tracks,
        globalSpan: { startSec: 0, endSec: 2, spanSec: 2 },
        zoomStart: 0.25,
        zoomEnd: 0.75,
        spectrogramDisplay: { dbMin: null, dbMax: null, maxFrequencyHz: null },
        spectrumLine(item) { peeked.push(item.trackIndex); return item.trackIndex === 0; },
        waveformAxisLabels: item => ['wave ' + item.trackIndex],
        // Track 0 is drawn past both sides of its frame, track 1 stops short of the right side, the others have nothing drawn.
        waveformLane: item => (item.trackIndex === 0 ? { frame: { left: 60, top: 4, width: 600, height: 80 }, range: [-0.5, 0.5] } : null),
        waveformDrawn: item => (item.trackIndex === 0 ? { minX: -40, maxX: 700, left: 60, width: 600 } : item.trackIndex === 1 ? { minX: 61, maxX: 500, left: 60, width: 600 } : null),
        spectrumTexts: () => ['−20', 'drawn'],
        spectrogramTexts: item => ['lane ' + item.trackIndex],
    };
}

test('the track snapshot reads only the spectra shown tracks already have', () => {
    const peeked: number[] = [];
    const snapshot = buildTrackSnapshot(source([track(0), track(1, { hidden: true }), track(2)], peeked));
    assert.deepEqual(peeked, [0, 2]);
    assert.equal(snapshot.visibleSpectrumTrackCount, 1);
    assert.deepEqual(snapshot.tracks.map(item => item.spectrumSlicePresent), [true, false, false]);
    assert.deepEqual(snapshot.axisLabels.waveformPerTrack, [['wave 0'], ['wave 1'], ['wave 2']]);
    // The texts the plots drew, as they drew them: never made again from the data (A27, C6).
    assert.deepEqual(snapshot.axisLabels.spectrogramPerTrack, [['lane 0'], ['lane 1'], ['lane 2']]);
    assert.deepEqual(snapshot.axisLabels.spectrumOverlay, ['−20', 'drawn']);
});

test('each track says which part of its file the zoom shows', () => {
    const snapshot = buildTrackSnapshot(source([track(0), track(1, { offsetSeconds: 1, result: result('/late.wav', 1) })], []));
    assert.deepEqual(snapshot.tracks.map(item => [item.visibleFileStartNorm, item.visibleFileEndNorm, item.waveformFullyVisible]), [
        [0.25, 0.75, false],
        [0, 0.5, false],
    ]);
    assert.equal(snapshot.tracks[1].filePath, '/late.wav');
    assert.equal(snapshot.tracks[1].offsetSeconds, 1);
    assert.equal(snapshot.tracks[0].resultError, null);
});

test('a track says whether the waveform drawn reaches each side of its frame; with nothing drawn it reaches neither', () => {
    const snapshot = buildTrackSnapshot(source([track(0), track(1), track(2)], []));
    assert.deepEqual(snapshot.tracks.map(item => [item.waveformFrame, item.waveformRange]), [[{ left: 60, top: 4, width: 600, height: 80 }, [-0.5, 0.5]], [null, null], [null, null]]);
    assert.deepEqual(snapshot.tracks.map(item => [item.waveformCoversViewportLeft, item.waveformCoversViewportRight, item.waveformMinDrawX, item.waveformMaxDrawX, item.waveformCanvasWidth]), [
        [true, true, -40, 700, 600],
        [true, false, 61, 500, 600],
        [false, false, null, null, null],
    ]);
});
