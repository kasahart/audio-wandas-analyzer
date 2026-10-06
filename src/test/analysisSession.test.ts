import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionRequests, SourceResults } from '../shared/analysis/analysisSession';

test('session cancellation, request identity and disposal reject late publication; recreated session is independent', () => {
    const session = new SessionRequests();
    const first = session.begin('first');
    assert.equal(session.isCurrent(first, 'first'), true);
    const second = session.begin('second');
    assert.equal(session.isCurrent(first, 'first'), false);
    assert.equal(session.isCurrent(second, 'first'), false);
    session.advance();
    assert.equal(session.isCurrent(second), false);
    const final = session.begin('final');
    session.dispose(); session.dispose();
    assert.equal(session.isCurrent(final), false);
    assert.equal(session.isCurrent(session.begin('after-close')), false);
    const recreated = new SessionRequests();
    assert.equal(recreated.isCurrent(recreated.begin('new'), 'new'), true);
});

test('owned source removal invalidates leases before release; re-add never accepts an old owner', () => {
    const released: object[] = [];
    const records = new SourceResults<object>(new Map(), source => {
        assert.equal(records.owns('a', source), false);
        released.push(source);
    });
    const first = {}, second = {};
    records.set('a', first);
    assert.equal(records.owns('a', first), true);
    records.delete('a'); records.delete('a');
    records.set('a', second);
    assert.equal(records.owns('a', first), false);
    assert.equal(records.owns('a', second), true);
    records.clear(); records.clear();
    assert.deepEqual(released, [first, second]);
});

test('borrowed native cache survives selection detach; stale revision evicts only its entry', () => {
    const a = { revision: 2 }, b = { revision: 3 };
    const cache = new Map([['a', a], ['b', b]]);
    let session = new SourceResults(cache);
    assert.deepEqual(session.snapshot(value => value.revision), [2, 3]);
    session = new SourceResults(cache);
    assert.equal(session.hasRevision('a', 2, value => value.revision), true);
    assert.equal(session.hasRevision('b', 4, value => value.revision), false);
    assert.equal(cache.get('a'), a);
    assert.equal(cache.has('b'), false);
});

test('replacing an owned source invalidates the old lease and releases it exactly once', () => {
    const released: object[] = [];
    const records = new SourceResults<object>(new Map(), value => released.push(value));
    const previous = {}, current = {};
    records.set('a', previous); records.set('a', current); records.set('a', current);
    assert.equal(records.owns('a', previous), false);
    assert.deepEqual(released, [previous]);
    records.clear();
    assert.deepEqual(released, [previous, current]);
});
