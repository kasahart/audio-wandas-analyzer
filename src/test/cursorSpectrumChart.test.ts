import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisClient, executeLazyAnalysis } from '../shared/analysis/analysisClient';
import type { BackendCommand, BackendPayload, BackendResult } from '../shared/protocol/backendProtocol';
import { CURSOR_LANE, cursorLane, cursorLineId, cursorLineOf, cursorSpectrum, type CursorSpectrumLine } from '../webview/charts/cursorSpectrum';

const FS = { unit: 'FS', ref: 1, label: 'dBFS' };
const PA = { unit: 'Pa', ref: 2e-5, label: 'dB SPL' };
const line = (track: string, channel: number, level = FS, calibrated = false): CursorSpectrumLine => ({ id: cursorLineId(track, channel), key: `key-${track}-${channel}`, level, calibrated });

test('the cursor spectrum declares its lines in the rows\' order on one lane when they share a unit and reference', () => {
    const spec = cursorSpectrum([line('t1', 0), line('t1', 1), line('t2', 0)]);
    assert.ok(spec);
    assert.deepEqual(spec.lanes.map(lane => [lane.id, lane.kind, lane.axis]), [[CURSOR_LANE, 'lines', undefined]], 'one lane, on the figure\'s own axis: the same picture as before');
    assert.deepEqual(spec.lanes[0].lines, [
        { id: 't1:0', of: { key: 'key-t1-0' } },
        { id: 't1:1', of: { key: 'key-t1-1' } },
        { id: 't2:0', of: { key: 'key-t2-0' } },
    ], 'declared, and so drawn, in the rows\' order: the order never follows the levels');
    assert.deepEqual(spec.keys[0], { key: 'key-t1-0', state: 'usable', version: 'key-t1-0', level: FS, calibrated: false }, 'a kept answer\'s version is its key');
});

test('recordings in other units or references are each on a lane of their own, in the order first declared', () => {
    const spec = cursorSpectrum([line('t1', 0, PA, true), line('t2', 0), line('t3', 0, PA, true), line('t2', 1)]);
    assert.ok(spec);
    assert.deepEqual(spec.lanes.map(lane => [lane.id, lane.axis, lane.lines.map(found => found.id)]), [
        [cursorLane(0), 'own', ['t1:0', 't3:0']],
        [cursorLane(1), 'own', ['t2:0', 't2:1']],
    ], 'no recording is left out: each unit and reference has its own value axis');
    // A calibrated and an uncalibrated recording in one unit and reference share a lane (仕様 2): the words differ, not the axis.
    const mixed = cursorSpectrum([line('t1', 0, FS, true), line('t2', 0, FS, false)]);
    assert.equal(mixed?.lanes.length, 1);
});

test('with no line there is no spec, and two tracks of one kept answer list its key once', () => {
    assert.equal(cursorSpectrum([]), null);
    const same = cursorSpectrum([{ ...line('t1', 0), key: 'k' }, { ...line('t2', 0), key: 'k' }]);
    assert.deepEqual(same?.keys.map(key => key.key), ['k']);
    assert.deepEqual(same?.lanes[0].lines.map(found => found.id), ['t1:0', 't2:0'], 'each track keeps its own line');
});

test('a line id names its track and channel', () => {
    assert.deepEqual(cursorLineOf(cursorLineId('track:7', 2)), { track: 'track:7', channel: 2 });
    assert.equal(cursorLineOf('base'), null);
});

test('a slice request that asks for kept answers is answered with keys and no value', async () => {
    const client = new class extends AnalysisClient {
        calls: Array<{ command: BackendCommand; payload: unknown }> = [];
        protected async request<K extends BackendCommand>(command: K, payload: BackendPayload<K>): Promise<BackendResult<K>> {
            this.calls.push({ command, payload });
            return { filePath: 'source', channels: [{ channelIndex: 0, level: FS, key: 'k0' }], windowStartNorm: 0.4, windowEndNorm: 0.6, window: 'hann',
                calibrationSignature: 'c', analysisRevision: 4, sourceVersion: 'v2', stftSignature: '512/128/hann', bandsPerOctave: 3 } as unknown as BackendResult<K>;
        }
    }();
    const reply = await executeLazyAnalysis(client, { type: 'request-spectrum-slice', filePath: 'source', sourceVersion: 'v1', trackIndex: 2, requestId: 'r',
        analysisId: 'a', settingsSignature: 's', cursorNorm: 0.5, bandsPerOctave: 3, answers: 'linear' }, { stftOptions: { nFft: 512, overlapPercent: 75, window: 'hann' }, analysisRevision: 4 });
    assert.equal(client.calls[0].command, 'cursor-answers');
    assert.deepEqual(client.calls[0].payload, { filePath: 'source', cursorNorm: 0.5, scale: 'linear', bandsPerOctave: 3,
        stftOptions: { nFft: 512, overlapPercent: 75, window: 'hann' }, sourceVersion: 'v1', analysisRevision: 4 });
    assert.deepEqual(reply, { type: 'cursor-answers-result', requestId: 'r', analysisId: 'a', settingsSignature: 's', trackIndex: 2, filePath: 'source',
        sourceVersion: 'v2', stftSignature: '512/128/hann', analysisRevision: 4, cursorNorm: 0.5, scale: 'linear',
        channels: [{ channelIndex: 0, level: FS, key: 'k0' }], windowStartNorm: 0.4, windowEndNorm: 0.6, window: 'hann', bandsPerOctave: 3 });
});
