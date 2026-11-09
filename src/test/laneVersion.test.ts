/**
 * A lane's lazy answers are of the file version its track shows (class sweep 2, #8): every request names the track's
 * sourceVersion (a required key, so no request can leave it out), the backend answers only of that version
 * (stale-source otherwise, python-backend/test_analysis_engine.py), the answers are kept under it, and an answer of
 * another version is never drawn over the track: the file rewritten (recorded again) under a track never mixes two
 * versions on one screen.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { PairSourceRef, SpectrumSliceRequest, TrackDetailRequest, WaveformRangeRequest } from '../shared/utils/audioTarget';
import { isRequestPairSpectrumMessage, isRequestTrackDetailMessage } from '../shared/utils/audioTarget';
import { createLaneReads, type LaneTrack } from '../webview/runtime/laneReads';
import { isOfShownVersion } from '../webview/runtime/lazyResponses';

const repoRoot = path.resolve(__dirname, '..', '..');
const track = (sourceVersion: string): LaneTrack => ({ trackIndex: 0, filePath: '/a.wav', sourceVersion, calibrationSignature: 'c', analysisId: 'a', settingsSignature: 's' });

test('every lane request names the version of its file: a request without one does not compile', () => {
    // @ts-expect-error sourceVersion is required
    const range: WaveformRangeRequest = { type: 'request-waveform-range', requestId: 'r', trackIndex: 0, filePath: '/a.wav', startNorm: 0, endNorm: 1, points: 2 };
    // @ts-expect-error sourceVersion is required
    const detail: TrackDetailRequest = { type: 'request-track-detail', requestId: 'r', analysisId: 'a', settingsSignature: 's', trackIndex: 0, filePath: '/a.wav' };
    // @ts-expect-error sourceVersion is required
    const slice: SpectrumSliceRequest = { type: 'request-spectrum-slice', requestId: 'r', analysisId: 'a', settingsSignature: 's', trackIndex: 0, filePath: '/a.wav', cursorNorm: 0.5 };
    // @ts-expect-error sourceVersion is required
    const source: PairSourceRef = { filePath: '/a.wav', channelIndex: 0, offsetSeconds: 0 };
    void [range, detail, slice, source];
    assert.equal(isRequestTrackDetailMessage({ ...detail, sourceVersion: 7 }), false, 'a version is a string');
    assert.equal(isRequestPairSpectrumMessage({ type: 'request-pair-spectrum', requestId: 'r', analysisId: 'a', settingsSignature: 's',
        reference: { ...source, sourceVersion: 'v1' }, responses: [{ ...source, sourceVersion: 'v1' }] }), true);
});

test('an answer of another version than the track shows is not drawn; a track with no version takes any', () => {
    assert.equal(isOfShownVersion({ sourceVersion: 'v1' }, { sourceVersion: 'v1' }), true);
    assert.equal(isOfShownVersion({ sourceVersion: 'v1' }, { sourceVersion: 'v2' }), false, 'the file was analysed again since');
    assert.equal(isOfShownVersion({ sourceVersion: 'v1' }, {}), false, 'an answer that names no version is not of v1');
    assert.equal(isOfShownVersion({}, { sourceVersion: 'v2' }), true);
});

test('a lane read names its track\'s version, is kept under it, and reads nothing of an answer of another version', () => {
    const posted: Array<{ requestId: string; sourceVersion?: string }> = [];
    const reads = createLaneReads(message => { posted.push(message); });
    const query = { x0: 0, x1: 1 } as never;
    const first = reads.slice(track('v1'), 0.5, 0);
    first.line?.(query, () => undefined);
    assert.equal(posted[0].sourceVersion, 'v1');
    reads.handle({ type: 'spectrum-slice-result', requestId: posted[0].requestId, settingsSignature: 's', sourceVersion: 'v2', maxFrequencyHz: 100, channels: [{ channelIndex: 0, values: [1, 2, 3] }] } as { type: string; requestId: string });
    assert.equal(first.line?.(query, () => undefined), null, 'answered of another version: nothing read');
    const again = reads.slice(track('v2'), 0.5, 0);
    assert.notEqual(again, first, 'the file analysed again: its reads are kept apart');
    again.line?.(query, () => undefined);
    assert.equal(posted.length, 2);
    assert.equal(posted[1].sourceVersion, 'v2');
});

test('each lane answer handler of the track view passes the one version gate', () => {
    const text = readFileSync(path.join(repoRoot, 'src/webview/runtime/comparisonRuntime.ts'), 'utf8');
    const gate = text.slice(text.indexOf('function trackIdAtProtocolBoundary'), text.indexOf('function trackRecordAtIndex'));
    assert.match(gate, /isOfShownVersion\(record\.result, answer\)/);
    for (const type of ['waveform-range-result', 'track-detail-result', 'spectrum-slice-result']) {
        const at = text.indexOf(`msg.type !== '${type}'`);
        assert.ok(at > 0, type);
        const handler = text.slice(at, text.indexOf('messaging.onMessage', at));
        assert.match(handler, /trackIdAtProtocolBoundary\(i, msg\)/, `${type} goes through the version gate`);
    }
    const requests = [...text.matchAll(/type: 'request-(waveform-range|track-detail|spectrum-slice)',[\s\S]*?\}\);/g)];
    assert.equal(requests.length, 4);
    for (const request of requests) assert.match(request[0], /sourceVersion: /, request[0].slice(0, 60));
});
