/**
 * How the sources on the answer store treat failures and what an answer is of (class sweep 1, cache): a failure that
 * may pass stands for FAILED_RETRY_MS and is asked again, a step that cannot run is an answer, a rescan that failed
 * is no version the pictures were taken of, and a combination the backend let go is tried again once per combination.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLatestAnswers, FAILED_RETRY_MS } from '../webview/runtime/answerStore';

import { createHeaderProbe } from '../webview/runtime/entryHeaders';
import { createStageSource, stageBasis } from '../webview/runtime/stageSource';
import type { ScanResult } from '../shared/protocol/backendProtocol';

const stage = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', xs: [0], values: [0], data: 'k' };

test('a step picture that failed for a passing reason is no picture for the pause, then asked again; a step that cannot run stays its answer', () => {
    let now = 0;
    const posted: Array<{ requestId?: string; filePaths?: string[] }> = [];
    const stages = createStageSource('t', message => posted.push(message), () => undefined, () => '', () => now);
    const spec = { key: 'spec', message: { stage: 's1' } };
    stages.ensure(spec, ['/a.wav', '/b.wav']);
    const requestId = posted[0].requestId ?? '';
    stages.handle({ type: 'compare-scan-result', requestId, filePath: '/a.wav', result: { ok: false, reason: 'OSError: busy' } } as { type: string });
    stages.handle({ type: 'compare-scan-result', requestId, filePath: '/b.wav', result: { ok: false, reason: 'cannot run', failedStep: 's1' } } as { type: string });
    stages.handle({ type: 'compare-scan-done', requestId } as { type: string });
    assert.equal(stages.view(spec, '/a.wav'), null, 'drawn as no picture while the failure stands');
    assert.equal(stages.result(spec, '/a.wav'), undefined, 'a passing failure is not the step\'s failure');
    assert.equal(stages.result(spec, '/b.wav')?.failedStep, 's1', 'a step that cannot run is the answer');
    assert.equal(stages.ensure(spec, ['/a.wav', '/b.wav']), false, 'not asked again on every draw');
    now += FAILED_RETRY_MS;
    assert.equal(stages.ensure(spec, ['/a.wav', '/b.wav']), true, 'asked again after the pause');
    assert.deepEqual(posted[1].filePaths, ['/a.wav']);
});

test('a scan the request does not fit (a region past the file) is not asked again; a new region is', () => {
    let now = 0;
    const posted: Array<{ requestId?: string; filePaths?: string[] }> = [];
    let redraws = 0;
    const stages = createStageSource('t', message => posted.push(message), () => { redraws += 1; }, () => '', () => now);
    const spec = { key: 'region 6-8', message: { stage: 's1' } };
    stages.ensure(spec, ['/short.wav']);
    const requestId = posted[0].requestId ?? '';
    stages.handle({ type: 'compare-scan-result', requestId, filePath: '/short.wav', result: { ok: false, reason: 'region ends after the file (5.000 s)', lasting: true } } as { type: string });
    stages.handle({ type: 'compare-scan-done', requestId } as { type: string });
    assert.equal(stages.view(spec, '/short.wav'), null, 'drawn as no picture');
    assert.equal(stages.failure(spec, '/short.wav'), 'region ends after the file (5.000 s)', 'its reason is said');
    const before = redraws;
    now += FAILED_RETRY_MS * 10;
    // Each scan holds the figure's reads in the browser build (it drew empty, "Computing…"): asked every pause, it blinked.
    assert.equal(stages.ensure(spec, ['/short.wav']), false, 'not asked again however long it stands');
    assert.equal(posted.length, 1);
    assert.equal(redraws, before, 'nobody is woken to ask again');
    assert.equal(stages.ensure({ key: 'region 1-2', message: { stage: 's1' } }, ['/short.wav']), true, 'another region is another request');
});

test('a rescan that failed is not the version the pictures were taken of; one still running keeps it', () => {
    const scans = new Map<string, ScanResult>([['/a.wav', { ok: true, input: { id: 'v1' } } as ScanResult]]);
    const basisOf = stageBasis(path => scans.get(path));
    const first = basisOf('/a.wav');
    scans.delete('/a.wav');
    assert.equal(basisOf('/a.wav'), first, 'running: nothing asked again');
    scans.set('/a.wav', { ok: false, reason: 'unreadable' });
    assert.notEqual(basisOf('/a.wav'), first, 'failed: the old pictures are not the file\'s');
});

test('a header that could not be read is read again after the pause', () => {
    let now = 0;
    const probe = createHeaderProbe(() => now);
    let ids = 0;
    const nextId = (): string => `p-${++ids}`;
    probe.start(['/a'], nextId);
    probe.take({ type: 'entry-probe-result', requestId: 'p-1', filePath: '/a', error: 'being written' });
    probe.take({ type: 'entry-probe-done', requestId: 'p-1' });
    assert.equal(probe.start(['/a'], nextId), null);
    now += FAILED_RETRY_MS;
    assert.deepEqual(probe.start(['/a'], nextId)?.filePaths, ['/a']);
    probe.take({ type: 'entry-probe-result', requestId: 'p-2', filePath: '/a', channels: 2 });
    assert.equal(probe.errors.has('/a'), false, 'read now');
});

test('a latest answer that fails is no longer its old value', () => {
    const latest = createLatestAnswers<number>();
    latest.set('/a', 1);
    latest.fail('/a', 'gone');
    assert.equal(latest.get('/a'), undefined);
    assert.equal(latest.failure('/a'), 'gone');
});

test('a step measured against the base slot\'s recording is of that recording\'s version and calibration too', () => {
    const posted: Array<{ requestId?: string; filePaths?: string[] }> = [];
    const basis = new Map([['/x.wav', 'x1'], ['/ref.wav', 'r1']]);
    const stages = createStageSource('t', message => posted.push(message), () => undefined, path => basis.get(path) ?? '');
    const spec = { key: 'tf|vs|/ref.wav', message: { stage: 's1', reference: { filePath: '/ref.wav', step: 's1', recipe: { version: 1, steps: [] } as never } } };
    stages.ensure(spec, ['/x.wav']);
    stages.handle({ type: 'compare-scan-result', requestId: posted[0].requestId, filePath: '/x.wav', result: { ok: true, stage } } as { type: string });
    stages.handle({ type: 'compare-scan-done', requestId: posted[0].requestId } as { type: string });
    assert.ok(stages.view(spec, '/x.wav'));
    basis.set('/ref.wav', 'r2');
    assert.equal(stages.view(spec, '/x.wav'), undefined, 'the reference calibrated anew: not this picture');
    assert.equal(stages.ensure(spec, ['/x.wav']), true, 'asked again');
});

test('a file calibrated anew while the folder is open is another basis, track or not', () => {
    const scans = new Map<string, ScanResult>([['/b.wav', { ok: true, input: { id: 'v1' } } as ScanResult]]);
    let epoch = 0;
    const basisOf = stageBasis(path => scans.get(path), undefined, () => String(epoch));
    const first = basisOf('/b.wav');
    epoch = 1;
    assert.notEqual(basisOf('/b.wav'), first, 'the old pictures are not the file\'s');
});
