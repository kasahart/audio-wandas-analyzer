import assert from 'node:assert/strict';
import test from 'node:test';
import { createCombineSource, noDeltaNote } from '../webview/runtime/combineSource';
import { createStageSource } from '../webview/runtime/stageSource';
import type { CompareCombineMessage } from '../shared/analysis/entryScan';
import { parsePanelMessage } from '../shared/protocol/panelMessages';
import type { StageView } from '../shared/protocol/backendProtocol';

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
    const strings = { stageNoDelta: 'axes', stageTooLarge: 'large', stageNoDeltaRate: 'rate', stageNoDeltaUnit: 'unit' };
    assert.equal(noDeltaNote(combined, strings), 'rate');
    assert.equal(noDeltaNote({ noDelta: 'unit' }, strings), 'unit');
    assert.equal(noDeltaNote({ tooLarge: true }, strings), 'large');
    assert.equal(noDeltaNote({}, strings), 'axes');
    assert.equal(noDeltaNote(undefined, strings), 'axes');
});
