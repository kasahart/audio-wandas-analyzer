import assert from 'node:assert/strict';
import test from 'node:test';
import { createStepHistory } from '../webview/runtime/stepHistory';

test('undo goes back to what was there before an edit, and redo forward again', () => {
    const history = createStepHistory<string>();
    assert.equal(history.canUndo(), false);
    assert.equal(history.undo('a'), undefined);
    history.record('a');
    history.record('b');
    assert.equal(history.canUndo(), true);
    assert.equal(history.undo('c'), 'b');
    assert.equal(history.canRedo(), true);
    assert.equal(history.undo('b'), 'a');
    assert.equal(history.undo('a'), undefined);
    assert.equal(history.redo('a'), 'b');
    assert.equal(history.redo('b'), 'c');
    assert.equal(history.canRedo(), false);
});

test('a new edit drops what was undone', () => {
    const history = createStepHistory<string>();
    history.record('a');
    assert.equal(history.undo('b'), 'a');
    history.record('a');
    assert.equal(history.canRedo(), false);
    assert.equal(history.redo('x'), undefined);
});

test('only the last edits are kept', () => {
    const history = createStepHistory<number>(3);
    for (let edit = 0; edit < 5; edit++) history.record(edit);
    assert.deepEqual([history.undo(5), history.undo(4), history.undo(3), history.undo(2)], [4, 3, 2, undefined]);
});

test('with nothing on screen to come back to, an undo is dropped rather than kept for redo', () => {
    const history = createStepHistory<string>();
    history.record('a');
    assert.equal(history.undo(null), undefined);
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
});
