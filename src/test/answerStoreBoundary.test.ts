/**
 * The answer store's boundary (layers-design: 答えの置き場): answers are kept in answerStore.ts alone. The webview and the
 * host's side (src/extension, src/shared) are both read: a host's cache of answers (a stored scan, a track's analysis)
 * is an answer kept too. Outside the store no code keeps a Map, WeakMap, Set or array that outlives a call (a closure's, a class's or a module's) unless it is listed
 * in NOT_ANSWERS with what it holds instead (a request's callbacks, a canvas's drawing, a gesture's state); and no code
 * names a failure's pause or retry of its own. The list only shrinks: an entry that no longer matches fails too, so a
 * cache moved onto the store is taken off it.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { ANSWER_DECLARATIONS, answerProgram, findAnswerWrites, findFileKeysWithoutVersion, findFilelessKeys, findHeldCollections, findLatestAnswers, findOwnRetryPolicies, type HeldCollection } from './answerBoundary';
import { FILELESS_KEYS, LATEST_ANSWERS, NOT_ANSWER_WRITES, NOT_ANSWERS } from './answerBoundaryAllowlist';

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
    // The webview, and the host's side, whose caches of answers (stored scans, a track's analysis) are answers kept too.
    for (const dir of ['src/webview', 'src/extension', 'src/shared']) walk(dir);
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

/** The webview's sources with a type checker: an answer is known by its type, not by what its variable is called. */
const ANSWER_FILES = new Set(ANSWER_DECLARATIONS.map(file => ts.sys.resolvePath(path.join(repoRoot, file))));
let typed: ts.Program | null = null;
const program = (): ts.Program => (typed ??= answerProgram(repoRoot, webviewSources()));
const writesIn = (checked: ts.Program, files: readonly string[]): string[] => files.flatMap(file => {
    const source = checked.getSourceFile(path.join(repoRoot, file));
    assert.ok(source, file);
    return findAnswerWrites(file, source, checked.getTypeChecker(), ANSWER_FILES);
});

test('outside the answer store, no host answer is written into a field of an object or a lasting let, except those listed with why', () => {
    const found = writesIn(program(), webviewSources());
    assert.deepEqual(found.filter(entry => !(entry in NOT_ANSWER_WRITES)), [], 'An answer is kept in answerStore.ts (createAnswerSlot for one per track), not in an object\'s field or a let');
    assert.deepEqual(Object.keys(NOT_ANSWER_WRITES).filter(entry => !found.includes(entry)), [], 'an entry that matches nothing any more is taken off NOT_ANSWER_WRITES (the list only shrinks)');
    for (const [entry, reason] of Object.entries(NOT_ANSWER_WRITES)) assert.ok(reason.trim().length >= 12, `${entry} says why`);
});

test('the write check knows an answer by its type, whatever it is called: a field, an element\'s field, an object kept as a cache, a lasting let (mutation)', () => {
    const file = 'src/webview/runtime/__answerWriteMutant.ts';
    const text = `
        import type { HostInboundMessage } from './hostMessaging';
        import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
        export function createKeeper(target: ChannelSummary[], label: { textContent: string }, record: { kept?: unknown; size?: number }) {
            let last: ChannelSummary | null = null;
            let count = 0;
            const byPath: Record<string, unknown> = {};
            return {
                take(event: HostInboundMessage) {
                    if (event.type !== 'track-detail-result') return;
                    event.channels.forEach((channel, index) => { if (target[index]) target[index].spectrogram = channel.spectrogram; });
                    last = event.channels[0] ?? null;
                    record.kept = { x: event.requestId };
                    record.size = 3;
                    count = count + 1;
                    byPath[event.filePath] = event.channels;
                    label.textContent = event.filePath;
                },
                last: () => last, count: () => count,
            };
        }
        export function local(event: HostInboundMessage) { let seen = event.type; return seen; }
    `;
    const checked = answerProgram(repoRoot, [], { [file]: text });
    assert.deepEqual(writesIn(checked, [file]).sort(), [`${file}#byPath[event.filePath]`, `${file}#let last`, `${file}#record.kept`, `${file}#target[index].spectrogram`]);
});

const listed = (found: readonly string[], list: Record<string, string>, what: string): void => {
    assert.deepEqual(found.filter(entry => !(entry in list)), [], what);
    assert.deepEqual(Object.keys(list).filter(entry => !found.includes(entry)), [], 'an entry that matches nothing any more is taken off the list (it only shrinks)');
    for (const [entry, reason] of Object.entries(list)) assert.ok(reason.trim().length >= 12, `${entry} says why`);
};

test('an answer of no one file says where its versions are, each such key listed with how', () => {
    listed(sources().flatMap(({ file, source }) => findFilelessKeys(file, source)), FILELESS_KEYS,
        'An answerKey with no `file` keeps an answer of no one file: list it in FILELESS_KEYS with where the file versions and calibration are (the data keys, the request, the source)');
    const mutant = ts.createSourceFile('m.ts', "const pairKey = (request: string) => answerKey({ ask: request, version: { by: 'request' } });", ts.ScriptTarget.Latest, true);
    assert.deepEqual(findFilelessKeys('m.ts', mutant), ['m.ts#pairKey']);
});

test('every latest-answer place outside the store is listed with what keys it and what makes a value of it old', () => {
    listed(sources().flatMap(({ file, source }) => findLatestAnswers(file, source)), LATEST_ANSWERS,
        'createLatestAnswers keeps one value per subject with no file version or Recipe of its own: list it in LATEST_ANSWERS with what keys it and what keeps it current');
});

test('the boundary check finds a Map handed to a call, a parameter property\'s Map and an answer put with .set (mutation)', () => {
    const held = ts.createSourceFile('m.ts', `
        export function create(requests: { ask(meta: unknown): void }) {
            return { ask() { requests.ask({ row: 1, results: new Map<string, number>() }); } };
        }
        export class Session { constructor(private records = new Map<string, number>()) {} }
    `, ts.ScriptTarget.Latest, true);
    assert.deepEqual(findHeldCollections('m.ts', held).map(item => item.name).sort(), ['records', 'results']);
    const file = 'src/webview/runtime/__answerSetMutant.ts';
    const text = `
        import type { HostInboundMessage } from './hostMessaging';
        export function createKeeper() {
            const pending = { results: new Map<string, unknown>() };
            const local = (event: HostInboundMessage) => { const seen = new Map<string, unknown>(); seen.set('x', event); return seen.size; };
            return {
                take(event: HostInboundMessage) { pending.results.set(event.type, event); return local(event); },
                size: () => pending.results.size,
            };
        }
    `;
    const checked = answerProgram(repoRoot, [], { [file]: text });
    assert.deepEqual(writesIn(checked, [file]), [`${file}#pending.results.set`]);
});
