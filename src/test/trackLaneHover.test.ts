import assert from 'node:assert/strict';
import test from 'node:test';
import { laneHoverPoint, laneReadoutText, type LanePoint } from '../webview/runtime/trackLaneHover';
import { renderWaveformPipeline } from '../webview/waveform/waveformRenderer';

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
});

test('a track lane\'s readout names the recording, its time to the digits a pixel tells apart and the amplitude in its unit', () => {
    assert.equal(laneReadoutText('a.wav', 1.23456, 0.001, -0.0123, 'Pa'), 'a.wav / 1.235 s / −0.0123 Pa');
    assert.equal(laneReadoutText('a.wav', 12, 0.5, 0.5, null), 'a.wav / 12.00 s / 0.500');
});

test('the waveform pipeline tells each point it draws, where and with its value and time', () => {
    const points: Array<[number, number, number, number]> = [];
    const ctx = { beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, lineWidth: 0, strokeStyle: '' } as unknown as CanvasRenderingContext2D;
    renderWaveformPipeline(ctx, 4, 100, { min: [-1, -0.5], max: [1, 0.5], samples: [], absolutePeak: 1 },
        { zoomStart: 0, zoomEnd: 1, offsetNorm: 0, dataStart: 0, dataEnd: 1, color: '#fff', onPoint: (x, y, value, t) => points.push([x, y, value, t]) });
    assert.deepEqual(points.map(([, , value]) => value), [-1, 1, -0.5, 0.5]);
    assert.ok(points.every(([x, y]) => x >= 0 && x <= 4 && y >= 0 && y <= 100));
});
