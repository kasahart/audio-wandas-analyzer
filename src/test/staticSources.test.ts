import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import {
    byPath, collectDroppedSourceFiles, collectSourceFiles, createFolderKeys, inputTooLarge, listingRoot, listOpenedFiles, listOpenedFolder,
    LoadFailures, sessionFull, type FolderEntryHandle, type FoundFile,
} from '../webview/runtime/staticSources';

const strings = getStrings('en');
const file = (name: string, size = 10, lastModified = 1): File => ({ name, size, lastModified }) as File;
const limits = { maxInputBytes: 16 * 1024 * 1024, maxSources: 2, maxTotalInputBytes: 32 * 1024 * 1024, maxExportBytes: 1 };

test('the folder picker and a dropped folder both list only supported audio files, by their path from the folder', async () => {
    const handle = (name: string, children?: FolderEntryHandle[]): FolderEntryHandle => children
        ? { kind: 'directory', name, values: async function* () { yield* children; } }
        : { kind: 'file', name, getFile: async () => file(name) };
    const root = handle('rec', [handle('b.wav'), handle('notes.txt'), handle('day1', [handle('a.flac')])]) as FolderEntryHandle & { kind: 'directory' };
    const picked: FoundFile[] = [];
    await collectSourceFiles(root, root.name, picked);
    assert.deepEqual(picked.sort(byPath).map(found => found.path), ['rec/b.wav', 'rec/day1/a.flac']);

    // A dropped folder's reader hands out its children in batches until an empty one.
    const entry = (name: string, children?: FileSystemEntry[]): FileSystemEntry => (children ? {
        name, isDirectory: true,
        createReader: () => { const batches = [children.slice(0, 1), children.slice(1), []]; return { readEntries: (done: (entries: FileSystemEntry[]) => void) => done(batches.shift() ?? []) }; },
    } : { name, isDirectory: false, file: (done: (value: File) => void) => done(file(name)) }) as unknown as FileSystemEntry;
    const dropped: FoundFile[] = [];
    await collectDroppedSourceFiles(entry('rec', [entry('b.wav'), entry('x.txt'), entry('day1', [entry('a.wav')])]) as FileSystemDirectoryEntry, 'rec', dropped);
    assert.deepEqual(dropped.map(found => found.path), ['rec/b.wav', 'rec/day1/a.wav']);
});

test('opened files get free top-level names, and an idle listed file picked again keeps its entry', () => {
    const folder = new Map<string, File>([['/sources/rec/a.wav', file('a.wav')]]);
    const first = listOpenedFiles(folder, [file('a.wav'), file('a/b\u0001.wav', 5)], () => true);
    assert.deepEqual(first.map(added => added.sourceId), ['a.wav', 'a_b_.wav'], 'a file inside an opened folder is not reused');
    const again = listOpenedFiles(folder, [file('a.wav'), file('a.wav')], () => true);
    assert.deepEqual(again.map(added => added.sourceId), ['a.wav', 'a (2).wav'], 'one listed entry is reused once per pick');
    const loaded = listOpenedFiles(folder, [file('a.wav')], path => path !== '/sources/a.wav');
    assert.deepEqual(loaded.map(added => added.sourceId), ['a (2).wav'], 'a loaded entry is not reused');
    assert.deepEqual([...folder.keys()], ['/sources/rec/a.wav', '/sources/a.wav', '/sources/a_b_.wav', '/sources/a (2).wav']);
});

test('an opened folder is listed under its name; the same folder again is kept, another one with that name is numbered', () => {
    const folder = new Map<string, File>();
    const files = [{ path: 'rec/a.wav', file: file('a.wav') }];
    assert.equal(listOpenedFolder(folder, 'rec', files), true);
    assert.equal(listOpenedFolder(folder, 'rec', files), false);
    assert.equal(listOpenedFolder(folder, 'rec', [{ path: 'rec/a.wav', file: file('a.wav', 99) }]), true);
    assert.deepEqual([...folder.keys()], ['/sources/rec/a.wav', '/sources/rec (2)/a.wav']);
});

test('a list of one folder is shown under its name, anything else from /sources', () => {
    assert.deepEqual(listingRoot(['/sources/rec/a.wav', '/sources/rec/d/b.wav']), { rootPath: '/sources/rec', rootLabel: 'rec' });
    assert.deepEqual(listingRoot(['/sources/rec/a.wav', '/sources/a.wav']), { rootPath: '/sources', rootLabel: '' });
    assert.deepEqual(listingRoot(['/sources/a.wav']), { rootPath: '/sources', rootLabel: '' });
    assert.deepEqual(listingRoot([]), { rootPath: '/sources', rootLabel: '' });
});

test('the limit checks name the Worker limits in MiB', () => {
    assert.equal(inputTooLarge(limits.maxInputBytes, limits, strings), undefined);
    assert.equal(inputTooLarge(limits.maxInputBytes + 1, limits, strings), strings.browserInputTooLarge.replace('{mib}', '16'));
    assert.equal(sessionFull(1, [1], limits, strings), undefined);
    const full = strings.browserAggregateLimit.replace('{count}', '2').replace('{mib}', '32');
    assert.equal(sessionFull(1, [1, 1], limits, strings), full, 'the session holds maxSources tracks');
    assert.equal(sessionFull(16 * 1024 * 1024, [16 * 1024 * 1024], limits, strings), undefined);
    assert.equal(sessionFull(16 * 1024 * 1024 + 1, [16 * 1024 * 1024], limits, strings), full, 'and maxTotalInputBytes in all');
});

test('a batch reports its failures grouped by reason, else the last file and the track count', () => {
    assert.equal(new LoadFailures().announcement(strings, 'b.wav', 2), `b.wav: ${strings.browserReady.replace('{count}', '2')}`);
    const failures = new LoadFailures();
    failures.add('a.wav', new Error('full'));
    failures.add('b.wav', new Error('full'));
    failures.add('c.wav', 'broken');
    assert.equal(failures.announcement(strings, 'c.wav', 0), [
        strings.browserFileFailed.replace('{file}', 'a.wav (+1)').replace('{error}', 'full'),
        strings.browserFileFailed.replace('{file}', 'c.wav').replace('{error}', 'broken'),
    ].join(' | '));
});

test('folder keys are tagged by the folder listing, so another folder of the same name keeps its own', async () => {
    const folder = new Map<string, File>([['/sources/rec/a.wav', file('a.wav')]]);
    const keys = createFolderKeys(folder);
    assert.equal(keys.isFolderKey('awa.scanIndex.x:/sources/rec'), true);
    assert.equal(keys.isFolderKey('audioWandasAnalyzer.viewState'), false);
    assert.equal(keys.identity('/sources/rec/a.wav'), 'a.wav|10|1');
    assert.equal(keys.identity('/sources/gone.wav'), undefined);
    const tagged = await keys.tagged('awa.session.x:/sources/rec');
    assert.match(tagged, /^awa\.session\.x:\/sources\/rec#1:[0-9a-f]{8}$/);
    assert.equal(await keys.tagged('awa.session.x:/sources/rec'), tagged);
    folder.set('/sources/rec/a.wav', file('a.wav', 11));
    folder.set('/sources/rec/b.wav', file('b.wav'));
    assert.notEqual(await keys.tagged('awa.session.x:/sources/rec'), tagged);
});
