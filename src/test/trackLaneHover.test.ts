import assert from 'node:assert/strict';
import test from 'node:test';
import { laneHoverPoint, laneReadoutText, spectrogramCellAt, spectrogramNeighbourNorm, spectrogramReadoutText, type LanePoint } from '../webview/runtime/trackLaneHover';

/** A lane's points: a flat line at y = 50 with a narrow peak to y = 5 at x = 100. */
const lane: LanePoint[] = Array.from({ length: 201 }, (_, x) => ({ x, y: x === 100 ? 5 : 50, value: x === 100 ? 0.9 : 0, t: x / 200 }));

test('the pointer on a track lane reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)', () => {
    assert.equal(laneHoverPoint(lane, 108, 10)?.x, 100);
    // By the flat line, the point under the pointer.
    assert.deepEqual(laneHoverPoint(lane, 108, 48), lane[108]);
    // Far above the line: the point in the pointer's column nearest in height.
    assert.deepEqual(laneHoverPoint(lane, 150, 0), lane[150]);
    // The radius is in CSS pixels: on a 2× bitmap the peak 16 bitmap pixels away is still read.
    assert.equal(laneHoverPoint(lane, 116, 10, 2)?.x, 100);
    // Past the lane's ends, nothing.
    assert.equal(laneHoverPoint(lane, 260, 50), null);
    // Zoomed in, samples 100 px apart: between two of them, far from both, the nearest column is still read.
    const sparse: LanePoint[] = [0, 100, 200].map(x => ({ x, y: 50, value: 0, t: x / 200 }));
    assert.deepEqual(laneHoverPoint(sparse, 60, 50), sparse[1]);
});

test('a track lane\'s readout names the recording, its time to the digits a pixel tells apart and the amplitude in its unit', () => {
    assert.equal(laneReadoutText('a.wav', 1.23456, 0.001, -0.0123, 'Pa'), 'a.wav / 1.235 s / −0.0123 Pa');
    assert.equal(laneReadoutText('a.wav', 12, 0.5, 0.5, null), 'a.wav / 12.00 s / 0.500');
});

test('the pointer on a spectrogram lane reads the cell under it: its frequency bin and level, with the time, in the toolbar (R7)', () => {
    // 4 time bins × 5 frequency bins up to 4000 Hz (1000 Hz apart); each cell's level names its place.
    const spec = { timeBins: 4, frequencyBins: 5, maxFrequencyHz: 4000, values: [0, 1, 2, 3].map(t => [0, 1, 2, 3, 4].map(f => -(10 * t + f) || 0)) };
    assert.deepEqual(spectrogramCellAt(spec, 0.6, 2400), { frequencyHz: 2000, level: -22, stepHz: 1000 });
    assert.deepEqual(spectrogramCellAt(spec, 0, 0), { frequencyHz: 0, level: 0, stepHz: 1000 });
    // The last bin's cell holds the file's end; above the data and off the file, nothing.
    assert.deepEqual(spectrogramCellAt(spec, 1, 4000), { frequencyHz: 4000, level: -34, stepHz: 1000 });
    assert.equal(spectrogramCellAt(spec, 0.5, 4600), null);
    assert.equal(spectrogramCellAt(spec, -0.1, 1000), null);
    assert.equal(spectrogramCellAt(spec, 1.2, 1000), null);
    assert.equal(spectrogramReadoutText('', 0.25, 0.01, { frequencyHz: 2000, level: -22 }, 'dB'), '0.25 s / 2 kHz / −22.0 dB');
});

test('an arrow key on a zoomed spectrogram detail reads the next column at its own centre, not one spread over the file (R7)', () => {
    // A detail of 4.0–4.4 s of a 10 s file: five columns 0.1 s apart.
    const spec = { timeBins: 5, timeCentersSec: [4.0, 4.1, 4.2, 4.3, 4.4] };
    const close = (actual: number | null, expected: number): void => { assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`); };
    close(spectrogramNeighbourNorm(spec, 0.41, 1, 10), 0.42);
    close(spectrogramNeighbourNorm(spec, 0.42, 1, 10), 0.43);
    close(spectrogramNeighbourNorm(spec, 0.42, -1, 10), 0.41);
    // Past the detail's last column there is nothing further that way; before its first, the first is read.
    assert.equal(spectrogramNeighbourNorm(spec, 0.44, 1, 10), null);
    close(spectrogramNeighbourNorm(spec, 0.2, 1, 10), 0.40);
    assert.equal(spectrogramNeighbourNorm(spec, 0.2, -1, 10), null);
    // Without frame centres the columns split the file evenly.
    close(spectrogramNeighbourNorm({ timeBins: 4 }, 0.3, 1, 10), 0.625);
});
