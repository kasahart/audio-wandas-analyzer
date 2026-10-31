import assert from 'node:assert/strict';
import test from 'node:test';
import { SelectionSync } from '../webview/runtime/selectionSync';

function setup(overrides: Partial<ConstructorParameters<typeof SelectionSync>[0]> = {}) {
    return new SelectionSync({ rootLabel: '/data', listedFilePaths: ['a.wav', 'b.wav', 'c.wav'], selectedFilePaths: [], listsFiles: true, ...overrides });
}

test('the bootstrap selection keeps its string paths, in order, once each', () => {
    const selection = setup({ selectedFilePaths: ['b.wav', 7, 'a.wav', 'b.wav'] });
    assert.deepEqual(selection.paths, ['b.wav', 'a.wav']);
    assert.equal(selection.listedCount, 3);
    assert.equal(selection.rootLabel, '/data');
});

test('a page that lists no files counts none, whatever it was opened with', () => {
    assert.equal(setup({ listsFiles: false }).listedCount, 0);
});

test('a new folder starts with no tracks; files listed beside it keep them', () => {
    const selection = setup({ selectedFilePaths: ['a.wav'] });
    selection.showListing('more', 5, false);
    assert.deepEqual(selection.paths, ['a.wav']);
    assert.equal(selection.listedCount, 5);
    assert.equal(selection.rootLabel, 'more');
    selection.showListing('/other', 2, true);
    assert.deepEqual(selection.paths, []);
    assert.equal(selection.listedCount, 2);
});

test('only files the host newly reports selected are returned; the reported list becomes the tracks', () => {
    const selection = setup();
    assert.deepEqual(selection.adoptHostSelection(['a.wav', 'b.wav']), ['a.wav', 'b.wav']);
    selection.remove('b.wav');
    // An update that crossed the removal still reports b.wav: it is not new.
    assert.deepEqual(selection.adoptHostSelection(['a.wav', 'b.wav', 'c.wav']), ['c.wav']);
    assert.deepEqual(selection.paths, ['a.wav', 'b.wav', 'c.wav']);
});

test('each request to analyse the tracks has its own id and a copy of the paths', () => {
    const selection = setup({ selectedFilePaths: ['a.wav'] });
    const first = selection.nextRequest('s1');
    const second = selection.nextRequest('s1', true);
    assert.deepEqual(first, { requestId: 'selection-s1-1', filePaths: ['a.wav'] });
    assert.deepEqual(second, { requestId: 'selection-s1-2', filePaths: ['a.wav'], clearAll: true });
    selection.add('b.wav');
    assert.deepEqual(first.filePaths, ['a.wav']);
});

test('a queued play waits for its track and is handed out once', () => {
    const selection = setup();
    assert.equal(selection.takeReadyPlay(() => true), null);
    selection.queuePlay('a.wav');
    assert.equal(selection.takeReadyPlay(() => false), null);
    assert.equal(selection.takeReadyPlay(path => path === 'a.wav'), 'a.wav');
    assert.equal(selection.takeReadyPlay(() => true), null);
});
