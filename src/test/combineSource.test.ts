import assert from 'node:assert/strict';
import test from 'node:test';
import { FAILED_RETRY_MS as FAILED_HOLD_MS } from '../webview/runtime/answerStore';
import { createCombineSource, createLastFine, noDeltaNote, type Combined } from '../webview/runtime/combineSource';
import { createStageSource, stageBasis } from '../webview/runtime/stageSource';
import { runCompareCombine, type CompareCombineMessage } from '../shared/analysis/entryScan';
import { getStrings } from '../shared/i18n/strings';
import { parsePanelMessage } from '../shared/protocol/panelMessages';
import type { ScanResult, StageView } from '../shared/protocol/backendProtocol';

const diff: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000], values: [0, 20] };

test('a combination is asked for once, answered from its cache, and kept per part on screen', () => {
    const posted: CompareCombineMessage[] = [];
    let changed = 0;
    const source = createCombineSource('t', message => posted.push(message), () => changed++);
    const request = { base: ['ka', 'kb'], compare: 'kc' };
    assert.equal(source.get('id', request, () => undefined), undefined);
    assert.equal(source.get('id', request, () => undefined), undefined, 'not asked again while in flight');
    assert.deepEqual(posted, [{ type: 'compare-combine', requestId: 't-1', base: ['ka', 'kb'], compare: 'kc' }]);
    assert.ok(parsePanelMessage(posted[0]), 'the host takes the message');
    assert.equal(source.handle({ type: 'compare-combine-result', requestId: 'x-1', result: { ok: true } } as { type: string }), false, 'another source\'s answer');
    source.handle({ type: 'compare-combine-result', requestId: 't-1', result: { ok: true, diff } } as { type: string });
    assert.equal(changed, 1);
    assert.deepEqual(source.get('id', request, () => undefined), { base: null, diff });
    // Zoomed: the part on screen is another combination.
    assert.equal(source.get('id|zoom', { ...request, detail: { x: [100, 200], points: 400 } }, () => undefined), undefined);
    assert.deepEqual(posted.at(-1)?.detail, { x: [100, 200], points: 400 });
});

test('values the backend no longer keeps are scanned again once, then the combination says it is too large', () => {
    const posted: CompareCombineMessage[] = [];
    const forgotten: string[][] = [];
    const source = createCombineSource('t', message => posted.push(message), () => undefined);
    const request = { base: ['ka'], compare: 'kc' };
    const forget = (keys: readonly string[]): void => { forgotten.push([...keys]); };
    source.get('id', request, forget);
    source.handle({ type: 'compare-combine-result', requestId: 't-1', result: { ok: false, missing: ['kc'] } } as { type: string });
    assert.deepEqual(forgotten, [['kc']]);
    // Scanned again (the same keys here): asked anew, and still gone.
    assert.equal(source.get('id', request, forget), undefined);
    assert.equal(posted.length, 2);
    source.handle({ type: 'compare-combine-result', requestId: 't-2', result: { ok: false, missing: ['ka'] } } as { type: string });
    assert.deepEqual(forgotten, [['kc']], 'not scanned again a second time');
    assert.deepEqual(source.get('id', request, forget), { base: null, diff: null, tooLarge: true });
});

test('the host refuses a combination without base keys', () => {
    assert.equal(parsePanelMessage({ type: 'compare-combine', requestId: 'r', base: [] }), undefined);
    assert.equal(parsePanelMessage({ type: 'compare-combine', requestId: 'r', base: [''], compare: 'k' }), undefined);
    assert.ok(parsePanelMessage({ type: 'compare-combine', requestId: 'r', base: ['k'], compare: null }));
});

test('the held step\'s pictures leave its combinations to the combination source', () => {
    const stages = createStageSource('entry-hold', () => undefined, () => undefined);
    assert.equal(stages.handle({ type: 'compare-combine-result', requestId: 'held-combine-1', result: { ok: true } } as { type: string }), false);
});

test('a Δ that cannot be taken says why: too much data, other sample rates or units, or other axes', () => {
    const posted: CompareCombineMessage[] = [];
    const source = createCombineSource('r', message => posted.push(message), () => undefined);
    source.get('id', { base: ['ka'], compare: 'kc' }, () => undefined);
    source.handle({ type: 'compare-combine-result', requestId: 'r-1', result: { ok: true, noDelta: 'rate' } } as { type: string });
    const combined = source.get('id', { base: ['ka'], compare: 'kc' }, () => undefined);
    assert.deepEqual(combined, { base: null, diff: null, noDelta: 'rate' });
    const strings = { stageNoDelta: 'axes', stageTooLarge: 'large', stageNoDeltaRate: 'rate', stageNoDeltaUnit: 'unit', stageCombineFailed: 'failed' };
    assert.equal(noDeltaNote(combined, strings), 'rate');
    assert.equal(noDeltaNote({ noDelta: 'unit' }, strings), 'unit');
    assert.equal(noDeltaNote({ tooLarge: true }, strings), 'large');
    assert.equal(noDeltaNote({}, strings), 'axes');
    assert.equal(noDeltaNote(undefined, strings), 'axes');
    assert.equal(noDeltaNote({ failed: true }, strings), 'failed');
});

test('a combination the backend failed is kept as a failure and says so, never as one with nothing to compare, then asked again', async () => {
    const posted: CompareCombineMessage[] = [];
    let clock = 0;
    const source = createCombineSource('f', message => posted.push(message), () => undefined, () => clock);
    const forgotten: string[][] = [];
    source.get('id', { base: ['ka'], compare: 'kc' }, keys => { forgotten.push([...keys]); });
    // What the host answers when stage-combine throws.
    const published: Array<{ type: string; requestId: string; result: unknown }> = [];
    await runCompareCombine({ combine: async () => { throw new Error('boom'); } } as unknown as Parameters<typeof runCompareCombine>[0],
        { ...posted[0] }, message => { published.push(message as { type: string; requestId: string; result: unknown }); });
    assert.deepEqual(published, [{ type: 'compare-combine-result', requestId: 'f-1', result: { ok: false } }]);
    source.handle(published[0]);
    const combined = source.get('id', { base: ['ka'], compare: 'kc' }, () => undefined);
    assert.deepEqual(combined, { base: null, diff: null, failed: true });
    assert.deepEqual(forgotten, [], 'nothing to scan again: no picture is missing');
    assert.equal(noDeltaNote(combined, getStrings('ja')), getStrings('ja').stageCombineFailed);
    // A failure stands a while (no request per draw), then the next draw asks again: a passing failure does not stay.
    clock = FAILED_HOLD_MS - 1;
    assert.deepEqual(source.get('id', { base: ['ka'], compare: 'kc' }, () => undefined), combined);
    assert.equal(posted.length, 1);
    clock = FAILED_HOLD_MS;
    assert.equal(source.get('id', { base: ['ka'], compare: 'kc' }, () => undefined), undefined);
    assert.equal(posted.length, 2);
});

test('a picture whose values the backend let go is dropped wherever it is kept, so it is scanned again', () => {
    const posted: Array<{ requestId?: string }> = [];
    const stages = createStageSource('track-stage', message => posted.push(message), () => undefined);
    const spec = { key: 'spec', message: {} };
    stages.ensure(spec, ['/a.wav', '/b.wav']);
    const requestId = posted[0]?.requestId ?? '';
    const stage = (data: string) => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', xs: [0], values: [0], data });
    for (const [filePath, data] of [['/a.wav', 'ka'], ['/b.wav', 'kb']]) {
        stages.handle({ type: 'compare-scan-result', requestId, filePath, result: { ok: true, stage: stage(data) } } as { type: string });
    }
    stages.forgetData(['ka']);
    assert.equal(stages.view(spec, '/a.wav'), undefined);
    assert.equal(stages.view(spec, '/b.wav')?.data, 'kb');
});

test('a file\'s pictures are of its version and calibration: a new basis draws none of the old and asks again', () => {
    const posted: Array<{ requestId?: string; filePaths?: string[] }> = [];
    const basis = new Map([['/a.wav', 'v1'], ['/b.wav', 'v1']]);
    const stages = createStageSource('track-stage', message => posted.push(message), () => undefined, path => basis.get(path) ?? '');
    const spec = { key: 'spec', message: {} };
    const stage = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', xs: [0], values: [0], data: 'k' };
    const answer = (requestId: string, filePath: string): void => {
        stages.handle({ type: 'compare-scan-result', requestId, filePath, result: { ok: true, stage } } as { type: string });
    };
    assert.equal(stages.ensure(spec, ['/a.wav', '/b.wav']), true);
    answer(posted[0].requestId ?? '', '/a.wav');
    answer(posted[0].requestId ?? '', '/b.wav');
    stages.handle({ type: 'compare-scan-done', requestId: posted[0].requestId } as { type: string });
    assert.ok(stages.view(spec, '/a.wav'));
    assert.equal(stages.ensure(spec, ['/a.wav', '/b.wav']), false, 'all in under their bases');
    // The calibration of a.wav changes (or the file on disk): its picture is of the old one.
    basis.set('/a.wav', 'v2');
    assert.equal(stages.view(spec, '/a.wav'), undefined, 'not drawn');
    assert.equal(stages.result(spec, '/a.wav'), undefined, 'not read');
    assert.ok(stages.view(spec, '/b.wav'), 'the other file keeps its picture');
    assert.equal(stages.ensure(spec, ['/a.wav', '/b.wav']), true);
    assert.deepEqual(posted[1].filePaths, ['/a.wav'], 'only a.wav asked again');
    // An answer asked under v2 that lands after a change to v3 is of v2: not drawn either.
    basis.set('/a.wav', 'v3');
    answer(posted[1].requestId ?? '', '/a.wav');
    assert.equal(stages.view(spec, '/a.wav'), undefined);
    basis.set('/a.wav', 'v2');
    assert.ok(stages.view(spec, '/a.wav'), 'kept under the basis it was asked for');
});

test('stageBasis follows the screen\'s scan (version, calibration) and the track\'s calibration, and keeps the last scan while one runs', () => {
    const scans = new Map<string, ScanResult>([['/a.wav', { ok: true, conditionId: 'c1' }]]);
    const analyses = new Map<string, { calibrationSignature?: string; analysisRevision?: number }>([['/a.wav', { calibrationSignature: 's', analysisRevision: 1 }]]);
    const basisOf = stageBasis(path => scans.get(path), path => analyses.get(path));
    const first = basisOf('/a.wav');
    scans.delete('/a.wav');
    assert.equal(basisOf('/a.wav'), first, 'a rescan in progress asks nothing again');
    scans.set('/a.wav', { ok: true, conditionId: 'c2' });
    assert.notEqual(basisOf('/a.wav'), first, 'another version or calibration of the file');
    const second = basisOf('/a.wav');
    analyses.set('/a.wav', { calibrationSignature: 's2', analysisRevision: 1 });
    assert.notEqual(basisOf('/a.wav'), second, 'the track calibrated anew, its analysis not run again');
    const third = basisOf('/a.wav');
    analyses.set('/a.wav', { calibrationSignature: 's2', analysisRevision: 2 });
    assert.notEqual(basisOf('/a.wav'), third, 'the track analysed again');
});

test('stageBasis names the version of the file its track was analysed from and the screen\'s own epoch of the file: written over on disk, it is another basis (V2)', () => {
    // The screen's scan says nothing new (the same condition, no rescan yet): the file's version alone tells.
    const scans = new Map<string, ScanResult>([['/a.wav', { ok: true, conditionId: 'c1' }]]);
    const analyses = new Map<string, { sourceVersion?: string; calibrationSignature?: string; analysisRevision?: number }>([['/a.wav', { sourceVersion: 'v1', calibrationSignature: 's', analysisRevision: 1 }]]);
    let epoch = '0.0';
    const basisOf = stageBasis(path => scans.get(path), path => analyses.get(path), () => epoch);
    const first = basisOf('/a.wav');
    analyses.set('/a.wav', { sourceVersion: 'v2', calibrationSignature: 's', analysisRevision: 1 });
    assert.notEqual(basisOf('/a.wav'), first, 'the track analysed from the file as written over');
    const second = basisOf('/a.wav');
    epoch = '0.1';
    assert.notEqual(basisOf('/a.wav'), second, 'the screen told the file changed on disk, before anything is analysed again');
    assert.equal(basisOf('/a.wav'), basisOf('/a.wav'), 'the same file, version and epoch: the same basis');
});

test('the last zoomed answer kept on screen is of the pictures it was taken of: a rescan, a calibration or a file\'s new version is not it (A35, C2)', () => {
    const last = createLastFine();
    const zoomed = { base: null, diff: null } as Combined;
    last.keep('one.wav|base.wav', { base: ['k-base'], compare: 'k-one' }, zoomed);
    assert.equal(last.of('one.wav|base.wav', { base: ['k-base'], compare: 'k-one' }), zoomed, 'the same pictures: kept');
    assert.equal(last.of('one.wav|base.wav', { base: ['k-base'], compare: 'k-one-v2' }), undefined, 'the compared file scanned again: not its');
    assert.equal(last.of('one.wav|base.wav', { base: ['k-base-calibrated'], compare: 'k-one' }), undefined, 'the base calibrated since: not its');
    assert.equal(last.of('two.wav|base.wav', { base: ['k-base'], compare: 'k-one' }), undefined, 'another pair: not its');
});

test('a step\'s picture comes out of its source as an answer with the identity it was answered under, never an empty one (B2)', () => {
    const posted: Array<{ requestId?: string }> = [];
    const basis = new Map([['/a.wav', 'v1']]);
    const stages = createStageSource('id-stage', message => posted.push(message), () => undefined, path => basis.get(path) ?? '');
    const spec = { key: 'spec', message: { recipe: { format: 'wandas.recipe', steps: [] } as never, region: { start: 0, end: 48000 } } };
    const stage: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', xs: [0], values: [0], data: 'k' };
    const input = { id: 'ver-1', unit: 'Pa', ref: 2e-5, levelReferenceLabel: '20 µPa', calibrationStatus: 'calibrated', fullScale: false };
    assert.equal(stages.answer(spec, '/a.wav').state, 'missing');
    stages.ensure(spec, ['/a.wav']);
    const pending = stages.answer(spec, '/a.wav');
    assert.equal(pending.state, 'pending');
    assert.equal(pending.identity.path, '/a.wav');
    stages.handle({ type: 'compare-scan-result', requestId: posted[0].requestId, filePath: '/a.wav', result: { ok: true, stage, input, conditionId: 'cond-1' } } as { type: string });
    const ready = stages.answer(spec, '/a.wav');
    assert.equal(ready.state, 'ready');
    assert.equal(ready.state === 'ready' && ready.value, stage);
    assert.equal(ready.identity.fileVersion, 'ver-1', 'the file version its scan read');
    assert.equal(ready.identity.calibrationSignature, 'calibrated');
    assert.equal(ready.identity.level.unit, 'Pa');
    assert.notEqual(ready.identity.recipeKey, '', 'the full recipe');
    assert.equal(ready.identity.region, JSON.stringify({ start: 0, end: 48000 }));
    assert.ok(ready.identity.conditionId.includes('cond-1') && ready.identity.conditionId.includes('v1'), 'the condition and the basis it was asked under');
    // Another basis: that picture is not this file's now, and nothing ready comes out.
    basis.set('/a.wav', 'v2');
    assert.equal(stages.answer(spec, '/a.wav').state, 'missing');
    basis.set('/a.wav', 'v1');
    // A step that cannot run on the file is a failure with its identity.
    stages.ensure({ ...spec, key: 'other' }, ['/a.wav']);
    stages.handle({ type: 'compare-scan-result', requestId: posted[1].requestId, filePath: '/a.wav', result: { ok: false, failedStep: 'x', reason: 'r', input } } as { type: string });
    const failed = stages.answer({ ...spec, key: 'other' }, '/a.wav');
    assert.equal(failed.state, 'failed');
    assert.equal(failed.identity.fileVersion, 'ver-1');
});

test('a combination comes out as an answer with what it was combined of (B2)', () => {
    const posted: CompareCombineMessage[] = [];
    const source = createCombineSource('id', message => posted.push(message), () => undefined);
    const request = { base: ['ka', 'kb'], compare: 'kc' };
    source.get('shown', request, () => undefined);
    assert.equal(source.answer('shown', request).state, 'pending');
    source.handle({ type: 'compare-combine-result', requestId: posted[0].requestId, result: { ok: true, diff } } as { type: string });
    const answer = source.answer('shown', request);
    assert.equal(answer.state, 'ready');
    assert.equal(answer.identity.fileVersion, JSON.stringify([['ka', 'kb'], 'kc']), 'the data keys, which name each file\'s version and calibration');
    assert.equal(answer.identity.conditionId, 'shown');
    assert.equal(answer.identity.path, 'kc');
    // Read under another name for the same data keys: still the identity it was answered under, not the reader's.
    assert.equal(source.answer('read-later', request).identity.conditionId, 'shown');
});
