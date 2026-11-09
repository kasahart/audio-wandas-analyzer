/**
 * The answer store's boundary (layers-design: 答えの置き場): answers are kept in answerStore.ts alone. Outside it no
 * code keeps a Map, WeakMap, Set or array that outlives a call (a closure's, a class's or a module's) unless it is listed
 * in NOT_ANSWERS with what it holds instead (a request's callbacks, a canvas's drawing, a gesture's state); and no code
 * names a failure's pause or retry of its own. The list only shrinks: an entry that no longer matches fails too, so a
 * cache moved onto the store is taken off it.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { findAnswerWrites, findFileKeysWithoutVersion, findHeldCollections, findOwnRetryPolicies, type HeldCollection } from './answerBoundary';
import { NOT_ANSWER_WRITES, NOT_ANSWERS } from './answerBoundaryAllowlist';

const repoRoot = path.resolve(__dirname, '..', '..');
const STORE = new Set(['src/webview/runtime/answerStore.ts', 'src/webview/runtime/answerTypes.ts']);

function webviewSources(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(path.join(repoRoot, dir)).sort()) {
            const rel = `${dir}/${name}`;
            if (statSync(path.join(repoRoot, rel)).isDirectory()) walk(rel);
            else if (rel.endsWith('.ts') && !rel.endsWith('.d.ts') && !STORE.has(rel)) found.push(rel);
        }
    };
    walk('src/webview');
    return found;
}

const sources = (): Array<{ file: string; source: ts.SourceFile }> => webviewSources().map(file => ({
    file, source: ts.createSourceFile(file, readFileSync(path.join(repoRoot, file), 'utf8'), ts.ScriptTarget.Latest, true),
}));

const id = (held: Pick<HeldCollection, 'file' | 'name'>): string => `${held.file}#${held.name}`;

test('outside the answer store, every collection that outlives a call is listed with what it holds instead of answers', () => {
    const found = sources().flatMap(({ file, source }) => findHeldCollections(file, source));
    const unlisted = found.filter(held => !(id(held) in NOT_ANSWERS));
    assert.deepEqual(unlisted.map(held => `${id(held)} (${held.kind}, line ${held.line})`), [],
        'Answers are kept in answerStore.ts (createAnswerStore / createLatestAnswers): its key holds the file version, calibration, recipe, region and condition, '
        + 'and its states hold pending, failed (retried after FAILED_RETRY_MS), empty and missing. A collection that holds no answer goes in NOT_ANSWERS with what it holds.');
    const ids = new Set(found.map(id));
    assert.deepEqual(Object.keys(NOT_ANSWERS).filter(entry => !ids.has(entry)), [], 'an entry that matches nothing any more is taken off NOT_ANSWERS (the list only shrinks)');
    for (const [entry, reason] of Object.entries(NOT_ANSWERS)) assert.ok(reason.trim().length >= 12, `${entry} says what it holds`);
});

test('outside the answer store, no code names a failure pause or retry of its own', () => {
    const found = sources().flatMap(({ file, source }) => findOwnRetryPolicies(file, source));
    assert.deepEqual(found, [], 'How long a failure stands and when an unanswered request is asked again are answerStore.ts\' (FAILED_RETRY_MS, UNANSWERED_RETRY_MS, createFailureHold, createRequestClock)');
});

test('the boundary check finds a cache of answers added outside the store (mutation)', () => {
    // A source as a cache would be written outside the store: a factory's Map of answers, and a failure time of its own.
    const text = `
        export function createSource(post: (m: unknown) => void) {
            const answers = new Map<string, number>();
            const kept: number[] = [];
            const failedAt = new Map<string, number>();
            const PAUSE_RETRY_MS = 5000;
            return {
                get(key: string) { kept.push(1); return answers.get(key); },
                set(key: string, value: number) { answers.set(key, value); failedAt.delete(key); return PAUSE_RETRY_MS; },
            };
        }
        export function transient(xs: number[]) {
            const seen = new Set<number>();
            return xs.filter(x => (seen.has(x) ? false : (seen.add(x), true)));
        }
        export class Holder { private readonly byKey = new Map<string, number>(); }
        const moduleCache = new WeakMap<object, number>();
        export const read = (o: object) => moduleCache.get(o);
    `;
    const source = ts.createSourceFile('mutant.ts', text, ts.ScriptTarget.Latest, true);
    assert.deepEqual(findHeldCollections('mutant.ts', source).map(held => held.name).sort(), ['answers', 'byKey', 'failedAt', 'kept', 'moduleCache']);
    assert.deepEqual(findOwnRetryPolicies('mutant.ts', source).sort(), ['mutant.ts#PAUSE_RETRY_MS', 'mutant.ts#failedAt']);
});

test('an answer of a file names the file\'s own version and calibration in its key, never leaves them to the ask', () => {
    assert.deepEqual(sources().flatMap(({ file, source }) => findFileKeysWithoutVersion(file, source)), []);
    const mutant = ts.createSourceFile('m.ts', "answerKey({ ask: 'spec', file: path, version: { by: 'request' } });", ts.ScriptTarget.Latest, true);
    assert.deepEqual(findFileKeysWithoutVersion('m.ts', mutant), ['m.ts:1']);
});

test('outside the answer store, no host answer is written into a field of an object, except those listed with why', () => {
    const found = sources().flatMap(({ file, source }) => findAnswerWrites(file, source));
    assert.deepEqual(found.filter(entry => !(entry in NOT_ANSWER_WRITES)), [], 'An answer is kept in answerStore.ts (createAnswerSlot for one per track), not in an object\'s field');
    assert.deepEqual(Object.keys(NOT_ANSWER_WRITES).filter(entry => !found.includes(entry)), [], 'an entry that matches nothing any more is taken off NOT_ANSWER_WRITES (the list only shrinks)');
    const mutant = ts.createSourceFile('m.ts', 'onMessage(msg => { record.rangeCache = { channels: msg.channels }; label.textContent = msg.text; });', ts.ScriptTarget.Latest, true);
    assert.deepEqual(findAnswerWrites('m.ts', mutant), ['m.ts#record.rangeCache']);
});
