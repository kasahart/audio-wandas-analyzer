import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createSessionSaver, readStoredSession } from '../webview/runtime/entrySession';

const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as unknown;

test('a stored session keeps what still fits the folder\'s files and drops the rest', () => {
    const files = new Set(['/d/a.wav', '/d/b.wav']);
    assert.equal(readStoredSession(undefined, files), null);
    assert.equal(readStoredSession({ version: 2, value: 'peak' }, files), null);
    const kept = readStoredSession({
        version: 1, value: 'peak', group: 'csv:rpm', baseGroup: '900',
        filters: [{ column: 'name', kind: 'values', values: ['a'] }, { column: 'leq', kind: 'range', low: 1 }, null, { column: 'leq', kind: 'range', low: 1, high: 2 }],
        sort: { column: 'value', descending: 1 }, slots: ['/d/a.wav#ch2', '/gone.wav', null, '/d/b.wav'],
        memo: [['/d/a.wav', 'loud'], ['/gone.wav', 'x'], ['/d/b.wav', 3]], excluded: ['/d/b.wav', '/gone.wav', 5],
        derived: [{ parentPath: '/d/a.wav', result: { ok: true }, base: {} }, { parentPath: '/gone.wav', result: {}, base: {} }, { parentPath: '/d/a.wav' }],
        recipe,
    }, files);
    assert.ok(kept);
    assert.equal(kept.value, 'peak');
    assert.equal(kept.group, 'csv:rpm');
    assert.equal(kept.baseGroup, '900');
    assert.deepEqual(kept.filters?.map(filter => filter.kind), ['values', 'range']);
    assert.deepEqual(kept.sort, { column: 'value', descending: true });
    assert.deepEqual(kept.slots, ['/d/a.wav#ch2', null, null, '/d/b.wav']);
    assert.deepEqual(kept.memo, [['/d/a.wav', 'loud']]);
    assert.deepEqual(kept.excluded, ['/d/b.wav']);
    assert.equal(kept.derived?.length, 1);
    assert.equal(kept.recipe, recipe);
    const bare = readStoredSession({ version: 1, sort: { column: 'size' }, recipe: { schema: 'x' } }, files);
    assert.deepEqual(bare, { baseGroup: null, memo: [], excluded: [] }, 'nothing stored is nothing kept');
});

test('a change is saved once, a moment after it, and only after the stored session came back', () => {
    const timers: Array<(() => void) | undefined> = [];
    const clock = { setTimeout: (run: () => void) => timers.push(run), clearTimeout: (id: number) => { timers[id - 1] = undefined; } } as unknown as Pick<Window, 'setTimeout' | 'clearTimeout'>;
    const run = (): void => { timers.splice(0).forEach(timer => timer?.()); };
    let state = { value: 'leq' };
    const saved: Array<[unknown, unknown]> = [];
    const saver = createSessionSaver(clock, 600, () => ({ ...state }), (session, csv) => saved.push([session, csv]));
    saver.schedule();
    assert.equal(timers.length, 0, 'nothing is saved before the stored session is back');
    saver.markLoaded();
    assert.equal(saver.loaded, true);
    saver.schedule();
    run();
    assert.deepEqual(saved, [], 'what came back is not saved again');
    state = { value: 'peak' };
    saver.schedule();
    saver.schedule();
    assert.equal(timers.length, 1);
    run();
    assert.deepEqual(saved, [[{ value: 'peak' }, undefined]]);
    saver.keepCsv({ name: 'a.csv', text: 'x' });
    saver.schedule();
    run();
    assert.deepEqual(saved[1], [{ value: 'peak' }, { name: 'a.csv', text: 'x' }], 'a new CSV is saved though nothing else changed');
    saver.keepCsv(null);
    saver.schedule();
    saver.reset();
    run();
    assert.equal(saved.length, 2, 'another folder drops the save that waited');
    assert.equal(saver.loaded, false);
});
