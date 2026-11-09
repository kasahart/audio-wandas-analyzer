import assert from 'node:assert/strict';
import test from 'node:test';
import { FAILED_HOLD_MS } from '../webview/runtime/combineSource';
import { createLaneReads } from '../webview/runtime/laneReads';

test('a cursor slice the host failed to give reads nothing a while, then is asked again (no failure kept for good)', () => {
    let clock = 0;
    const posted: Array<{ requestId: string }> = [];
    const reads = createLaneReads(message => { posted.push(message); }, () => clock);
    const source = reads.slice({ trackIndex: 0, filePath: 'a.wav', analysisId: 'a', settingsSignature: 's' }, 0.5, 0);
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

test('a read answered under other analysis settings (another STFT) reads nothing of it', () => {
    const posted: Array<{ requestId: string }> = [];
    const reads = createLaneReads(message => { posted.push(message); });
    const source = reads.slice({ trackIndex: 0, filePath: 'a.wav', analysisId: 'a', settingsSignature: 'nfft-4096' }, 0.5, 0);
    const query = { x0: 0, x1: 1 } as Parameters<NonNullable<typeof source.line>>[0];
    source.line?.(query, () => undefined);
    reads.handle({ type: 'spectrum-slice-result', requestId: posted[0].requestId, settingsSignature: 'auto', maxFrequencyHz: 100, channels: [{ channelIndex: 0, values: [1, 2, 3] }] } as { type: string; requestId: string });
    assert.equal(source.line?.(query, () => undefined), null);
});
