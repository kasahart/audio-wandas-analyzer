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
import { getStrings } from '../shared/i18n/strings';
const getStringsEn = () => getStrings('en');
import type { PairSourceRef, SpectrumSliceRequest, TrackDetailRequest, WaveformRangeRequest } from '../shared/utils/audioTarget';
import { isRequestPairSpectrumMessage, isRequestTrackDetailMessage } from '../shared/utils/audioTarget';
import { createLaneReads, type LaneTrack } from '../webview/runtime/laneReads';
import { isOfShownVersion } from '../webview/runtime/lazyResponses';
import { answerKey, createAnswerStore, FAILED_RETRY_MS } from '../webview/runtime/answerStore';
import { BackendRequestError } from '../shared/protocol/backendProtocol';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionPublication } from '../shared/session/comparisonSessionController';
import { mock } from 'node:test';

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

test('the host says which failures asking again cannot mend: a file changed since its track was analysed', async () => {
    const published: SessionPublication[] = [];
    let code: 'stale-source' | 'input-error' = 'stale-source';
    const fail = () => Promise.reject(new BackendRequestError(code, 'invalid-input', 'a.wav changed on disk since it was analysed'));
    const ports = {
        strings: getStringsEn(),
        scope: () => ({ isCurrent: () => true, canPublish: () => true }),
        publish: (message: SessionPublication) => { published.push(message); },
        stftOptions: () => undefined,
        lazyContext: () => ({ analysisRevision: 0 }),
        client: { requestTrackDetail: fail, requestRange: fail, requestPairSpectrum: fail },
    } as unknown as ComparisonSessionPorts;
    const controller = new ComparisonSessionController(ports);
    const detail = { type: 'request-track-detail' as const, requestId: 'd', analysisId: 'a', settingsSignature: 's', trackIndex: 0, filePath: '/a.wav', sourceVersion: 'v1' };
    await controller.handle(detail);
    await controller.handle({ type: 'request-waveform-range', requestId: 'r', trackIndex: 0, filePath: '/a.wav', sourceVersion: 'v1', startNorm: 0, endNorm: 1, points: 8 });
    const source = { filePath: '/a.wav', sourceVersion: 'v1', channelIndex: 0, offsetSeconds: 0 };
    await controller.handle({ type: 'request-pair-spectrum', requestId: 'p', analysisId: 'a', settingsSignature: 's', reference: source, responses: [source] });
    assert.deepEqual(published.map(message => [message.type, 'staleSource' in message && message.staleSource]),
        [['track-detail-error', true], ['waveform-range-result', true], ['pair-spectrum-error', true]], 'a range is answered too, so the lane stops asking');
    published.length = 0;
    code = 'input-error';
    await controller.handle({ ...detail, requestId: 'd2' });
    await controller.handle({ type: 'request-waveform-range', requestId: 'r2', trackIndex: 0, filePath: '/a.wav', sourceVersion: 'v1', startNorm: 0, endNorm: 1, points: 8 });
    assert.deepEqual(published.map(message => [message.type, 'staleSource' in message]), [['track-detail-error', false]], 'a passing failure is asked again as before');
});

test('a lasting failure is not asked again after the pause, and nobody is told to ask', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        let clock = 0, told = 0;
        const store = createAnswerStore<number>({ capacity: 4, now: () => clock, retried: () => { told++; } });
        const key = answerKey({ ask: 'pair', version: { by: 'request' } });
        store.ask(key);
        store.fail(key, 'changed', true);
        clock += FAILED_RETRY_MS * 10;
        mock.timers.tick(FAILED_RETRY_MS * 10);
        assert.equal(store.ask(key), false);
        assert.equal(store.reason(key), 'changed');
        assert.equal(told, 0);
        store.fail(key, 'busy');
        mock.timers.tick(FAILED_RETRY_MS + 20);
        clock += FAILED_RETRY_MS;
        assert.equal(told, 1);
        assert.equal(store.ask(key), true, 'a passing failure is asked again');
    } finally {
        mock.timers.reset();
    }
});

test('a track told its file changed asks nothing more until analysed again, and offers the one way on', () => {
    const text = readFileSync(path.join(repoRoot, 'src/webview/runtime/comparisonRuntime.ts'), 'utf8');
    const gate = text.slice(text.indexOf('function trackIdAtProtocolBoundary'), text.indexOf('function trackRecordAtIndex'));
    assert.match(gate, /answer\.staleSource[\s\S]*record\.sourceChanged = true/);
    const body = (name: string): string => { const at = text.indexOf(`function ${name}`); return text.slice(at, text.indexOf('\n    }\n', at)); };
    assert.match(body('requestTrackDetail').split('\n').slice(0, 5).join('\n'), /record\.sourceChanged/, 'no spectrogram asked');
    assert.match(body('checkAndRequestRanges').split('\n').slice(0, 5).join('\n'), /record\.sourceChanged/, 'no range or zoom window asked');
    assert.match(body('laneTrack('), /sourceChanged/, 'no read asked');
    const store = readFileSync(path.join(repoRoot, 'src/webview/runtime/trackStore.ts'), 'utf8');
    assert.match(store.slice(store.indexOf('private clearAnalysisState')), /^[\s\S]*?record\.sourceChanged = false/, 'analysed again: the track asks again');
});
