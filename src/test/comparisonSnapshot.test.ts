import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrackSnapshot, type SnapshotTrack, type TrackSnapshotSource } from '../webview/runtime/comparisonSnapshot';
import type { ComparisonTrackState, SpectrumSlice, TrackId } from '../webview/runtime/types';

function result(filePath: string, durationSeconds = 2): ComparisonTrackState {
    return {
        filePath,
        fileName: filePath,
        sampleRateHz: 8000,
        durationSeconds,
        channelCount: 1,
        sampleCount: 8000 * durationSeconds,
        channels: [{ label: 'L', peakAbsolute: 0.5, waveform: { min: [-0.5], max: [0.5], samples: [0], absolutePeak: 0.5 }, spectrogram: null }],
    };
}

function track(index: number, overrides: Partial<SnapshotTrack> = {}): SnapshotTrack {
    return {
        trackId: `track-${index + 1}` as TrackId,
        trackIndex: index,
        result: result(`/t${index}.wav`),
        offsetSeconds: 0,
        hidden: false,
        waveformCoverage: null,
        spectrumCanvasPresent: true,
        ...overrides,
    };
}

const SLICE: SpectrumSlice = { values: [-60, -40, -20], frequencyBins: 3, maxFrequencyHz: 4000, minDb: -60, maxDb: -20 };

function source(tracks: SnapshotTrack[], peeked: number[]): TrackSnapshotSource {
    return {
        tracks,
        globalSpan: { startSec: 0, endSec: 2, spanSec: 2 },
        zoomStart: 0.25,
        zoomEnd: 0.75,
        spectrumView: { freqStart: 0, freqEnd: 1, dbMin: null, dbMax: null },
        spectrogramDisplay: { dbMin: null, dbMax: null, maxFrequencyHz: null },
        peekSlice(item) { peeked.push(item.trackIndex); return item.trackIndex === 0 ? SLICE : null; },
        waveformAxisLabels: item => ['wave ' + item.trackIndex],
    };
}

test('the track snapshot reads only the spectra shown tracks already have', () => {
    const peeked: number[] = [];
    const snapshot = buildTrackSnapshot(source([track(0), track(1, { hidden: true }), track(2)], peeked));
    assert.deepEqual(peeked, [0, 2]);
    assert.equal(snapshot.visibleSpectrumTrackCount, 1);
    assert.deepEqual(snapshot.tracks.map(item => item.spectrumSlicePresent), [true, false, false]);
    assert.deepEqual(snapshot.axisLabels.waveformPerTrack, [['wave 0'], ['wave 1'], ['wave 2']]);
    assert.equal(snapshot.axisLabels.spectrogramPerTrack.length, 3);
    assert.equal(snapshot.axisLabels.spectrumPerTrack[1].length, 0);
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
