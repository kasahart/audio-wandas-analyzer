import assert from 'node:assert/strict';
import test from 'node:test';
import type { PairAnswersResult } from '../shared/protocol/backendProtocol';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionPublication } from '../shared/session/comparisonSessionController';
import { isRequestPairSpectrumMessage, type PairSpectrumRequest } from '../shared/utils/audioTarget';
import { cursorLineId } from '../webview/charts/cursorSpectrum';
import { isHostInboundMessage } from '../webview/runtime/hostMessaging';
import { PAIR_PARTS, pairLineId, pairLineOf, pairSpectrum, type PairSpectrumLine } from '../webview/charts/pairSpectrum';

const line = (track: string, channel: number, calibrated = true): PairSpectrumLine => {
    const id = cursorLineId(track, channel);
    return { id, keys: { gain: `g-${id}`, phase: `p-${id}`, coherence: `c-${id}` }, calibrated };
};

test('the pair figure is a lane a quantity, each on a value axis of its own, with a line a channel in the rows\' order', () => {
    const spec = pairSpectrum([line('t1', 1), line('t2', 0)]);
    assert.ok(spec);
    assert.deepEqual(spec.lanes.map(lane => [lane.id, lane.kind, lane.axis]), PAIR_PARTS.map(part => [part, 'lines', 'own']), 'gain, phase, coherence, top to bottom');
    assert.deepEqual(spec.lanes[1].lines, [
        { id: 'phase|t1:1', of: { key: 'p-t1:1' } },
        { id: 'phase|t2:0', of: { key: 'p-t2:0' } },
    ]);
    assert.deepEqual(spec.keys.map(key => key.key), ['g-t1:1', 'g-t2:0', 'p-t1:1', 'p-t2:0', 'c-t1:1', 'c-t2:0'], 'a lane\'s keys are its own: a key is on one lane only');
    assert.ok(spec.keys.every(key => key.state === 'usable' && key.version === key.key), 'a kept answer\'s version is its key');
});

test('only the lanes shown are declared, in the fixed order; with no line or no lane there is no spec', () => {
    assert.deepEqual(pairSpectrum([line('t1', 1)], ['coherence', 'gain'])?.lanes.map(lane => lane.id), ['gain', 'coherence']);
    assert.deepEqual(pairSpectrum([line('t1', 1)], ['phase'])?.keys.map(key => key.key), ['p-t1:1'], 'a lane not shown declares no key');
    assert.equal(pairSpectrum([]), null);
    assert.equal(pairSpectrum([line('t1', 1)], []), null);
});

test('a line id names its quantity and its channel', () => {
    assert.deepEqual(pairLineOf(pairLineId('phase', cursorLineId('track:7', 2))), { part: 'phase', channel: 'track:7:2' });
    assert.equal(pairLineOf('track:7:2'), null);
    assert.equal(pairLineOf('level|x'), null);
});

const KEYS = { gain: 'g', phase: 'p', coherence: 'c' };
const answer = (more: Record<string, unknown> = {}): PairAnswersResult['responses'][number] => ({
    filePath: '/b.wav', channelIndex: 0, status: 'ok', startSeconds: 0, endSeconds: 2, averages: 8, resampled: false, keys: KEYS,
    calibrationStatus: 'uncalibrated', calibrationSignature: 'cal', analysisRevision: 5, sourceVersion: 'v', ...more,
});
const kept = (): PairAnswersResult => ({
    filePath: '/a.wav', channelIndex: 0, nFft: 4096, hopLength: 1024, window: 'hann', calibrationSignature: 'cal', analysisRevision: 2,
    sourceVersion: 'v', stftSignature: '4096/1024/hann', responses: [answer()],
});
const request: PairSpectrumRequest = {
    type: 'request-pair-spectrum', requestId: 'r1', analysisId: 'a', settingsSignature: 's', answers: 'linear',
    reference: { filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0 },
    responses: [{ filePath: '/b.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0.5 }],
};

function controller(canPublish: (filePath: string, revision: number | undefined) => boolean) {
    const published: SessionPublication[] = [];
    const calls: Array<{ command: string; request: Record<string, unknown> }> = [];
    const ports = {
        scope: () => ({ isCurrent: () => true, canPublish }),
        publish: (message: SessionPublication) => { published.push(message); },
        stftOptions: () => ({ nFft: 4096, hopLength: 1024, window: 'hann' }),
        lazyContext: (filePath: string) => ({ analysisRevision: filePath === '/a.wav' ? 2 : 5 }),
        client: {
            requestPairAnswers: async (asked: Record<string, unknown>) => { calls.push({ command: 'pair-answers', request: asked }); return kept(); },
        },
    } as unknown as ComparisonSessionPorts;
    return { controller: new ComparisonSessionController(ports), published, calls };
}

test('a pair request that asks for kept answers is answered with keys and no value, and dropped once a source was analysed again', async () => {
    assert.equal(isRequestPairSpectrumMessage(request), true);
    assert.equal(isRequestPairSpectrumMessage({ ...request, answers: 'cubic' }), false);
    const { controller: session, published, calls } = controller(() => true);
    await session.handle(request);
    assert.deepEqual(calls.map(call => [call.command, call.request.scale, call.request.stftOptions]), [['pair-answers', 'linear', { nFft: 4096, hopLength: 1024, window: 'hann' }]]);
    assert.equal(published.length, 1);
    const message = published[0] as unknown as Record<string, unknown>;
    assert.deepEqual([message.type, message.requestId, message.analysisId, message.settingsSignature], ['pair-answers-result', 'r1', 'a', 's']);
    assert.deepEqual((message.responses as Array<{ keys: unknown }>)[0].keys, KEYS);
    assert.equal('analysisRevision' in message, false);
    assert.equal(isHostInboundMessage(message), true);
    // A response with no lines (it does not overlap the reference) names no key; one with keys names all three.
    assert.equal(isHostInboundMessage({ ...message, responses: [{ ...answer({ status: 'no-overlap' }), keys: undefined }] }), true);
    assert.equal(isHostInboundMessage({ ...message, responses: [answer({ keys: { gain: 'g', phase: 'p' } })] }), false);
    assert.equal(isHostInboundMessage({ ...message, responses: [answer({ status: 'fine' })] }), false);

    const later = controller(filePath => filePath !== '/b.wav');
    await later.controller.handle(request);
    assert.equal(later.published.length, 0);
});
