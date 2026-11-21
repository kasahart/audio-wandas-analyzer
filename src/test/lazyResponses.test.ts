import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PYTHON_ENVIRONMENT_STATE, isResponseToLazyRequest, pythonEnvironmentStateFromMessage } from '../webview/runtime/lazyResponses';
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

