import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChannelSummary } from '../shared/analysis/analysisTypes';
import {
    DEFAULT_PYTHON_ENVIRONMENT_STATE,
    isResponseToLazyRequest,
    mergeDetailSpectrograms,
    pythonEnvironmentStateFromMessage,
} from '../webview/runtime/lazyResponses';
import type { LazyRequestState, TrackId } from '../webview/runtime/types';

const trackId = 'track-a' as TrackId;
const pending: LazyRequestState = { trackId, requestId: 'r1', analysisId: 'a1', settingsSignature: 's1' };
const response = { requestId: 'r1', analysisId: 'a1', settingsSignature: 's1' };

test('isResponseToLazyRequest: 未処理の要求と識別子がすべて一致したときだけ true', () => {
    assert.equal(isResponseToLazyRequest(pending, trackId, response), true);
    assert.equal(isResponseToLazyRequest(null, trackId, response), false);
    assert.equal(isResponseToLazyRequest(undefined, trackId, response), false);
    assert.equal(isResponseToLazyRequest(pending, 'track-b' as TrackId, response), false);
    assert.equal(isResponseToLazyRequest(pending, trackId, { ...response, requestId: 'r0' }), false);
    assert.equal(isResponseToLazyRequest(pending, trackId, { ...response, analysisId: 'a0' }), false);
    assert.equal(isResponseToLazyRequest(pending, trackId, { ...response, settingsSignature: 's0' }), false);
});

test('pythonEnvironmentStateFromMessage: 不正な値は既定値に戻し、status は warning 以外を normal にする', () => {
    assert.deepEqual(pythonEnvironmentStateFromMessage({ pythonCommand: '/venv/bin/python', status: 'warning', tooltip: 'tip' }), {
        pythonCommand: '/venv/bin/python', status: 'warning', tooltip: 'tip',
    });
    assert.deepEqual(pythonEnvironmentStateFromMessage({ pythonCommand: 3, status: 'error', tooltip: null }), DEFAULT_PYTHON_ENVIRONMENT_STATE);
});

test('mergeDetailSpectrograms: 既存チャンネルにだけスペクトログラムを書き込み、欠けた要素は無視する', () => {
    const spectrogram = { marker: 'new' } as unknown as ChannelSummary['spectrogram'];
    const kept = { marker: 'old' } as unknown as ChannelSummary['spectrogram'];
    const target = [{ spectrogram: kept }, { spectrogram: kept }] as unknown as ChannelSummary[];
    const incoming = [{ spectrogram }, {}, { spectrogram }] as unknown as ChannelSummary[];
    mergeDetailSpectrograms(target, incoming);
    assert.equal(target[0].spectrogram, spectrogram);
    assert.equal(target[1].spectrogram, kept);
    assert.equal(target.length, 2);
});
