import assert from 'node:assert/strict';
import test from 'node:test';
import { answerKey, createAnswerStore, createFailureHold, createLatestAnswers, createRequestClock, FAILED_RETRY_MS, UNANSWERED_RETRY_MS, type AnswerKeyParts } from '../webview/runtime/answerStore';
import type { AnswerIdentity } from '../webview/runtime/answerTypes';

const parts: AnswerKeyParts = { ask: ['stage', 'welch'], file: 'a.wav', version: { fileVersion: '[100,1,2,3]', calibration: 'cal-1' }, recipe: 'recipe-1', region: '[0,48000]', condition: 'cond-1' };
const identity: AnswerIdentity = {
    path: 'a.wav', fileVersion: '[100,1,2,3]', calibrationSignature: 'cal-1', recipeKey: 'recipe-1', region: '[0,48000]', conditionId: 'cond-1',
    level: { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL', calibrationStatus: 'calibrated', fullScale: false },
};

test('an answer\'s key changes with every part: the file version, calibration, recipe, region, condition and what is asked', () => {
    const base = answerKey(parts).id;
    for (const part of ['file', 'recipe', 'region', 'condition'] as const) {
        assert.notEqual(answerKey({ ...parts, [part]: `${parts[part]}-other` }).id, base, `${part} is in the key`);
        assert.notEqual(answerKey({ ...parts, [part]: undefined }).id, base, `${part} left out is another key`);
    }
    assert.notEqual(answerKey({ ...parts, version: { fileVersion: '[100,1,2,4]', calibration: 'cal-1' } }).id, base, 'the file version is in the key');
    assert.notEqual(answerKey({ ...parts, version: { fileVersion: '[100,1,2,3]', calibration: 'cal-2' } }).id, base, 'the calibration is in the key');
    assert.notEqual(answerKey({ ...parts, version: { basis: 'b1' } }).id, answerKey({ ...parts, version: { basis: 'b2' } }).id, 'a basis is in the key');
    assert.notEqual(answerKey({ ...parts, version: { by: 'data-keys' } }).id, base, 'a version carried by the ask is said so');
    assert.notEqual(answerKey({ ...parts, ask: ['stage', 'rms'] }).id, base);
    // Numbers are written exactly: two windows that differ past a rounding are two answers.
    assert.notEqual(answerKey({ ask: [0.1 + 0.2], version: { by: 'request' } }).id, answerKey({ ask: [0.3], version: { by: 'request' } }).id);
    assert.equal(answerKey({ ...parts }).id, base, 'the same parts are the same key');
});

test('an answer is asked once while pending, then ready, and a ready one is not asked again', () => {
    const store = createAnswerStore<number>({ capacity: 8 });
    const key = answerKey(parts);
    assert.equal(store.state(key), 'missing');
    assert.equal(store.ask(key), true);
    assert.equal(store.state(key), 'pending');
    assert.equal(store.ask(key), false, 'not asked again on its way');
    let settled = 0;
    store.whenSettled(key, () => settled++);
    store.ready(key, 42, { identity });
    assert.equal(settled, 1);
    assert.equal(store.value(key), 42);
    assert.equal(store.ask(key), false);
    assert.deepEqual(store.answer(key, identity), { state: 'ready', value: 42, identity });
});

test('a failure stands for FAILED_RETRY_MS and is then asked again; an empty answer is not a failure', () => {
    let now = 1000;
    const store = createAnswerStore<number>({ capacity: 8, now: () => now });
    const key = answerKey(parts);
    store.ask(key);
    store.fail(key, 'backend restarted');
    assert.equal(store.state(key), 'failed');
    assert.equal(store.reason(key), 'backend restarted');
    assert.equal(store.ask(key), false, 'a failure is not asked again on every draw');
    assert.deepEqual(store.answer(key, identity), { state: 'failed', identity, retryAt: 1000 + FAILED_RETRY_MS });
    now += FAILED_RETRY_MS - 1;
    assert.equal(store.state(key), 'failed');
    now += 1;
    assert.equal(store.state(key), 'missing', 'past its pause the failure is gone');
    assert.equal(store.ask(key), true, 'and it is asked again');
    store.empty(key, identity);
    assert.equal(store.state(key), 'empty');
    now += FAILED_RETRY_MS * 10;
    assert.equal(store.state(key), 'empty', 'an empty answer stays: it is an answer');
    assert.equal(store.value(key), undefined);
});

test('an answer the backend let go is asked again once, then it is missing', () => {
    const store = createAnswerStore<number>({ capacity: 8 });
    const key = answerKey(parts);
    store.ask(key);
    assert.equal(store.unreached(key, 'group'), 'again');
    assert.equal(store.ask(key), true, 'asked again once what it is taken from is back');
    assert.equal(store.unreached(key, 'group'), 'given-up');
    assert.equal(store.state(key), 'missing');
    assert.equal(store.ask(key), false, 'not asked over and over');
    // An answer of the group coming in clears it: a later loss is asked again once more.
    const other = answerKey({ ...parts, region: '[1,2]' });
    store.ready(other, 1, { group: 'group' });
    assert.equal(store.unreached(other, 'group'), 'again');
});

test('a request never answered is asked again after UNANSWERED_RETRY_MS only where the store is told to', () => {
    let now = 0;
    const lossy = createAnswerStore<number>({ capacity: 8, retryUnanswered: true, now: () => now });
    const strict = createAnswerStore<number>({ capacity: 8, now: () => now });
    const key = answerKey(parts);
    lossy.ask(key); strict.ask(key);
    now += UNANSWERED_RETRY_MS;
    assert.equal(lossy.ask(key), true);
    assert.equal(strict.ask(key), false);
});

test('the least recently used answers are let go, never one on its way; by ask, every file\'s answer to it goes together', () => {
    const store = createAnswerStore<number>({ capacity: 2 });
    const a = answerKey({ ask: 'a', version: { by: 'request' } }), b = answerKey({ ask: 'b', version: { by: 'request' } }), c = answerKey({ ask: 'c', version: { by: 'request' } });
    store.ask(a);
    store.ready(b, 2);
    store.ready(c, 3);
    assert.equal(store.state(a), 'pending', 'the pending one stays');
    assert.equal(store.state(b), 'missing');
    const byAsk = createAnswerStore<number>({ capacity: 1, evictBy: 'ask' });
    byAsk.ready(answerKey({ ask: 's1', file: 'x', version: { by: 'request' } }), 1);
    byAsk.ready(answerKey({ ask: 's1', file: 'y', version: { by: 'request' } }), 2);
    assert.equal(byAsk.size, 2, 'one ask, two files');
    byAsk.ready(answerKey({ ask: 's2', file: 'x', version: { by: 'request' } }), 3);
    assert.equal(byAsk.size, 1);
    assert.equal(byAsk.value(answerKey({ ask: 's2', file: 'x', version: { by: 'request' } })), 3);
});

test('a kept handle is made once; forgetWhere lets go the values named', () => {
    const store = createAnswerStore<{ data: string }>({ capacity: 8 });
    let made = 0;
    const key = answerKey({ ask: 'handle', version: { by: 'request' } });
    const first = store.keep(key, () => ({ data: `k${++made}` }));
    assert.equal(store.keep(key, () => ({ data: `k${++made}` })), first);
    assert.equal(made, 1);
    store.forgetWhere(value => value.data === 'k1');
    assert.equal(store.state(key), 'missing');
});

test('the latest answers per subject keep what each was asked under, and failures apart from values', () => {
    const latest = createLatestAnswers<string>();
    latest.set('a.wav', 'scan', { recipeKey: 'r1' });
    assert.equal(latest.view.get('a.wav'), 'scan');
    assert.equal(latest.under('a.wav')?.recipeKey, 'r1');
    latest.fail('b.wav', 'unreadable header');
    assert.equal(latest.failures.get('b.wav'), 'unreadable header');
    assert.equal(latest.view.has('b.wav'), false);
    latest.set('b.wav', 'scan');
    assert.equal(latest.failure('b.wav'), undefined, 'an answer clears the failure');
    latest.clear();
    assert.equal(latest.view.size, 0);
});

test('a failure hold stands for FAILED_RETRY_MS under its condition; the request clock waits UNANSWERED_RETRY_MS', () => {
    let now = 0;
    const hold = createFailureHold(() => now);
    hold.fail('track-1', 'settings-a');
    assert.equal(hold.holds('track-1', 'settings-a'), true);
    assert.equal(hold.holds('track-1', 'settings-b'), false, 'other settings are another answer');
    now += FAILED_RETRY_MS;
    assert.equal(hold.holds('track-1', 'settings-a'), false);
    const clock = createRequestClock(() => now);
    clock.sent('r1');
    assert.equal(clock.waiting('r1'), true);
    now += UNANSWERED_RETRY_MS;
    assert.equal(clock.waiting('r1'), false);
    assert.equal(clock.landed('r1'), FAILED_RETRY_MS);
    assert.equal(clock.landed('r1'), -Infinity);
});
