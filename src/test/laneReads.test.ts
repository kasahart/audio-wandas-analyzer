import assert from 'node:assert/strict';
import test from 'node:test';
import { FAILED_RETRY_MS as FAILED_HOLD_MS } from '../webview/runtime/answerStore';
import { createLaneReads } from '../webview/runtime/laneReads';

test('a cursor slice the host failed to give reads nothing a while, then is asked again (no failure kept for good)', () => {
    let clock = 0;
    const posted: Array<{ requestId: string }> = [];
    const reads = createLaneReads(message => { posted.push(message); }, () => clock);
    const source = reads.slice({ trackIndex: 0, filePath: 'a.wav', sourceVersion: 'v1', calibrationSignature: undefined, stftSignature: '1024/256/hann', analysisId: 'a', settingsSignature: 's' }, 0.5, 0);
    const query = { x0: 0, x1: 1 } as Parameters<NonNullable<typeof source.line>>[0];
    assert.equal(source.line?.(query, () => undefined), undefined, 'asked for');
    assert.equal(posted.length, 1);
    reads.handle({ type: 'spectrum-slice-error', requestId: posted[0].requestId });
    assert.equal(source.line?.(query, () => undefined), null, 'failed: nothing to read');
    clock = FAILED_HOLD_MS - 1;
    assert.equal(source.line?.(query, () => undefined), null);
    assert.equal(posted.length, 1, 'not asked on every draw');
    clock = FAILED_HOLD_MS;
    assert.equal(source.line?.(query, () => undefined), undefined, 'asked again');
    assert.equal(posted.length, 2);
});

test('a still pointer on a cursor slice the host failed is read again once the pause is over: its ready is called, no motion needed (R7)', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let clock = 0;
    const posted: Array<{ requestId: string }> = [];
    const reads = createLaneReads(message => { posted.push(message); }, () => clock);
    const source = reads.slice({ trackIndex: 0, filePath: 'a.wav', sourceVersion: 'v1', calibrationSignature: undefined, stftSignature: '1024/256/hann', analysisId: 'a', settingsSignature: 's' }, 0.5, 0);
    const query = { x0: 0, x1: 1 } as Parameters<NonNullable<typeof source.line>>[0];
    let woken = 0;
    const ready = (): void => { woken++; };
    source.line?.(query, ready);
    reads.handle({ type: 'spectrum-slice-error', requestId: posted[0].requestId });
    assert.equal(source.line?.(query, ready), null, 'failed: nothing to read');
    const before = woken;
    t.mock.timers.tick(FAILED_HOLD_MS - 10);
    assert.equal(woken, before, 'not before the pause is over');
    clock = FAILED_HOLD_MS;
    t.mock.timers.tick(20);
    assert.equal(woken, before + 1, 'told once the pause is over');
    assert.equal(source.line?.(query, ready), undefined, 'and asked again');
    assert.equal(posted.length, 2);
});

test('a read answered with another STFT than the track\'s analysis on screen reads nothing of it, whatever settingsSignature it echoes', () => {
    const posted: Array<{ requestId: string; settingsSignature?: string }> = [];
    const reads = createLaneReads(message => { posted.push(message); });
    // The settings were changed to nFFT 4096 (the request carries it) while the analysis drawn is still of 1024.
    const source = reads.slice({ trackIndex: 0, filePath: 'a.wav', sourceVersion: 'v1', calibrationSignature: undefined, stftSignature: '1024/256/hann', analysisId: 'a', settingsSignature: 'nfft-4096' }, 0.5, 0);
    const query = { x0: 0, x1: 1 } as Parameters<NonNullable<typeof source.line>>[0];
    source.line?.(query, () => undefined);
    // As the real host answers: the request's settingsSignature echoed, the STFT computed with named by the backend.
    reads.handle({ type: 'spectrum-slice-result', requestId: posted[0].requestId, settingsSignature: posted[0].settingsSignature, sourceVersion: 'v1', stftSignature: '4096/1024/hann', maxFrequencyHz: 100, channels: [{ channelIndex: 0, values: [1, 2, 3] }] } as { type: string; requestId: string });
    assert.equal(source.line?.(query, () => undefined), null);
    const same = reads.slice({ trackIndex: 0, filePath: 'a.wav', sourceVersion: 'v1', calibrationSignature: undefined, stftSignature: '1024/256/hann', analysisId: 'a', settingsSignature: 'auto' }, 0.25, 0);
    same.line?.(query, () => undefined);
    reads.handle({ type: 'spectrum-slice-result', requestId: posted[1].requestId, settingsSignature: 'auto', sourceVersion: 'v1', stftSignature: '1024/256/hann', maxFrequencyHz: 100, channels: [{ channelIndex: 0, values: [1, 2, 3] }] } as { type: string; requestId: string });
    assert.notEqual(same.line?.(query, () => undefined), null, 'of the STFT drawn: read');
});
