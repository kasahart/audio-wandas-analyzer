import assert from 'node:assert/strict';
import test from 'node:test';
import {
    channelRowKey, comparedKeys, emptySlots, firstFreeCompareSlot, restoredSlots, roleKey, roleSlot, slotFiles, slotsForFiles, slotsOfFile, trackChanges, withoutFile, withSlot,
} from '../webview/runtime/entrySlots';

test('a row put in a slot leaves any other; the same row again takes it out', () => {
    assert.deepEqual(emptySlots(), [null, null, null, null]);
    const one = withSlot(emptySlots(), 1, '/a.wav');
    assert.deepEqual(one, [null, '/a.wav', null, null]);
    assert.deepEqual(withSlot(one, 2, '/a.wav'), [null, null, '/a.wav', null]);
    assert.deepEqual(withSlot(one, 1, '/a.wav'), [null, null, null, null]);
    assert.deepEqual(withSlot(one, 1, null), [null, null, null, null]);
    assert.deepEqual(withSlot(one, -1, '/a.wav'), [null, null, null, null]);
    assert.deepEqual(one, [null, '/a.wav', null, null], 'the slots given are not changed');
});

test('a file\'s role is its compared slot before the base, as the row it holds there', () => {
    const slots = ['/a.wav#ch1', '/b.wav', '/a.wav#ch2', null];
    assert.deepEqual(slotFiles(slots), ['/a.wav', '/b.wav', '/a.wav', null]);
    assert.equal(roleSlot(slots, '/a.wav'), 2);
    assert.equal(roleKey(slots, '/a.wav'), '/a.wav#ch2');
    assert.equal(roleSlot(['/a.wav', null, null, null], '/a.wav'), 0);
    assert.equal(roleSlot(slots, '/c.wav'), undefined);
    assert.equal(roleKey(slots, '/c.wav'), undefined);
    assert.deepEqual(slotsOfFile(slots, '/a.wav'), [0, 2]);
    assert.deepEqual(withoutFile(slots, '/a.wav'), [null, '/b.wav', null, null]);
    assert.deepEqual(comparedKeys(slots), ['/b.wav', '/a.wav#ch2']);
    assert.equal(firstFreeCompareSlot(slots), 3);
    assert.equal(firstFreeCompareSlot(['/x', '/a', '/b', '/c']), 1);
});

test('slots kept from before drop files no longer listed, and files come back as the rows they held', () => {
    const listed = new Set(['/a.wav', '/b.wav']);
    assert.deepEqual(restoredSlots(['/a.wav#ch2', '/gone.wav', 7, '/b.wav', '/a.wav'], path => listed.has(path)), ['/a.wav#ch2', null, null, '/b.wav']);
    assert.deepEqual(restoredSlots([], path => listed.has(path)), [null, null, null, null]);
    assert.deepEqual(slotsForFiles(['/a.wav', null, '/c.wav', null], ['/a.wav#ch2', null, null, null]), ['/a.wav#ch2', null, '/c.wav', null]);
});

test('the tracks follow the slots: a file that comes in is shown, one out of every slot is taken off', () => {
    assert.deepEqual(trackChanges(['/a', '/b', null, null], [null, '/b', '/c', null]), { show: ['/c'], hide: ['/a'] });
    assert.deepEqual(trackChanges(['/a', '/a', null, null], [null, '/a', null, null]), { show: [], hide: [] }, 'one channel leaving keeps the file on');
});

test('a key taken before the file\'s channels were known moves to its ch 1 row once they are', () => {
    const keys = new Set(['/a.wav#ch1', '/a.wav#ch2', '/b.wav']);
    assert.equal(channelRowKey('/a.wav', keys), '/a.wav#ch1');
    assert.equal(channelRowKey('/b.wav', keys), null);
    assert.equal(channelRowKey('/a.wav#ch2', keys), null);
    assert.equal(channelRowKey('/c.wav', keys), null);
});
