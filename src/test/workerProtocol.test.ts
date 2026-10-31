import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BackendProtocolError } from '../shared/protocol/backendProtocol';
import { withoutResponseEnvelope } from '../shared/protocol/schemaValidation';
import { parseWorkerMessage, parseWorkerResult } from '../webview/runtime/workerProtocol';

const limits = { maxInputBytes: 16, maxSources: 8, maxTotalInputBytes: 64, maxExportBytes: 32 };

test('Worker-only replies are checked against their own shapes', () => {
    assert.deepEqual(parseWorkerResult('load', { filePath: '/sources/a.wav' }), { filePath: '/sources/a.wav' });
    assert.deepEqual(parseWorkerResult('unload', {}), {});
    assert.deepEqual(parseWorkerResult('clear', {}), {});
    assert.deepEqual(parseWorkerResult('export-plan', { ignored: undefined }), { ignored: undefined });
    assert.deepEqual(parseWorkerResult('limits', limits), limits);
    assert.throws(() => parseWorkerResult('load', {}), /Invalid load success response/);
    assert.throws(() => parseWorkerResult('load', { filePath: '' }), BackendProtocolError);
    assert.throws(() => parseWorkerResult('load', { filePath: '/sources/a.wav', extra: 1 }), /Invalid load success response/);
    assert.throws(() => parseWorkerResult('unload', { filePath: '/sources/a.wav' }), /Invalid unload success response/);
    assert.throws(() => parseWorkerResult('clear', undefined), /Invalid clear success response/);
    assert.throws(() => parseWorkerResult('export-plan', []), /Invalid export-plan success response/);
    assert.throws(() => parseWorkerResult('limits', { ...limits, maxSources: '8' }), /Invalid limits response from the audio Worker/);
    assert.throws(() => parseWorkerResult('limits', { ...limits, maxSources: 0 }), BackendProtocolError);
});

test('the shared commands go through the native validator', () => {
    const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'src/test/fixtures/backendProtocol.json'), 'utf8')).validResponses as Array<{ command: string; response: unknown }>;
    const analyze = withoutResponseEnvelope(fixtures.find(fixture => fixture.command === 'analyze')!.response);
    assert.deepEqual(parseWorkerResult('analyze', analyze), analyze);
    assert.throws(() => parseWorkerResult('analyze', { filePath: '/sources/a.wav' }), /Invalid analyze success response/);
    assert.throws(() => parseWorkerResult('track-detail', undefined), /Invalid track-detail success response/);
});

test('Worker messages are a boot report or a correlated reply; anything else is dropped', () => {
    assert.deepEqual(parseWorkerMessage({ ready: true, lacks: ['librosa', 3] }), { kind: 'ready', ready: true, lacks: ['librosa'] });
    assert.deepEqual(parseWorkerMessage({ ready: false }), { kind: 'ready', ready: false });
    assert.equal(parseWorkerMessage({ ready: 'yes' }), undefined);
    assert.equal(parseWorkerMessage(null), undefined);
    assert.equal(parseWorkerMessage('ready'), undefined);
    assert.equal(parseWorkerMessage({ result: {} }), undefined);
    assert.deepEqual(parseWorkerMessage({ requestId: 'browser-1', result: { filePath: 'x' } }),
        { kind: 'reply', requestId: 'browser-1', result: { filePath: 'x' }, error: undefined, envelope: { result: { filePath: 'x' } }, wellFormed: true });
    const error = { code: 'input-error', message: 'm' };
    assert.equal(parseWorkerMessage({ requestId: 'browser-2', error })?.kind, 'reply');
    const extra = parseWorkerMessage({ requestId: 'browser-3', result: {}, debug: 1 });
    assert.equal(extra?.kind === 'reply' && extra.wellFormed, false);
});
