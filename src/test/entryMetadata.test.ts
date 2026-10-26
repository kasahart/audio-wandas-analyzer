import assert from 'node:assert/strict';
import test from 'node:test';
import {
    audioKey, decodeTableText, parseTable, pickMetadataTable, resolveTable, tableDelimiter, withFolderColumns,
} from '../shared/analysis/entryMetadata';
import { ENTRY_CONDITIONS_KEY, runEntryScan, type EntryPublication, type EntryScanPorts } from '../shared/analysis/entryScan';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { BAND_CENTERS_HZ, buildEntryModel } from '../webview/runtime/entryTable';

const SHIFT_JIS_TABLE = new Uint8Array([131, 116, 131, 64, 131, 67, 131, 139, 150, 188, 44, 143, 240, 140, 143, 13, 10, 114, 117, 110, 49, 46, 119, 97, 118, 44, 65, 13, 10, 114, 117, 110, 50, 46, 119, 97, 118, 44, 66, 13, 10]);
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const ROOT = '/data/motor';
const files = ['a.wav', 'b.wav', 'day1/c.wav', 'day1/dup.wav', 'day2/dup.wav'].map(key => `${ROOT}/${key}`);
const resolve = (text: string, source?: string) => resolveTable(parseTable(text)!, files, ROOT, source);

test('tables are UTF-8 with or without a BOM (Shift_JIS only as a fallback), tab or comma by the first record', () => {
    assert.equal(decodeTableText(bytes('\uFEFFfile,line\n')), 'file,line\n');
    assert.equal(decodeTableText(SHIFT_JIS_TABLE).split('\r\n')[0], 'ファイル名,条件');
    assert.equal(tableDelimiter('\n\nid\tline\tx,y\n'), '\t');
    assert.equal(tableDelimiter('"a\tb",c\n'), ',');
    assert.deepEqual(parseTable('\uFEFFsample_id\tline\nA\tL1\n')?.columns, ['sample_id', 'line']);
    assert.deepEqual(parseTable('id,note\n1,"two\nlines, quoted"\n')?.rows, [['1', 'two\nlines, quoted']]);
    // asd-insight's limits: named, distinct columns, rows as wide as the header, at most 128 columns.
    assert.equal(parseTable('id,,x\n1,2,3\n'), null);
    assert.equal(parseTable('id,id\n1,2\n'), null);
    assert.equal(parseTable('id,x\n1\n'), null);
    assert.equal(parseTable(Array.from({ length: 129 }, (_, i) => `c${i}`).join(',') + '\n' + Array(129).fill('1').join(',') + '\n'), null);
});

test('recordings are keyed by their path below the opened folder', () => {
    assert.equal(audioKey('/data/motor/day1/c.wav', '/data/motor'), 'day1/c.wav');
    assert.equal(audioKey('C:\\data\\motor\\a.wav', 'C:\\data\\motor'), 'a.wav');
    assert.equal(audioKey('/sources/rec/sub/x.WAV', '/sources/rec'), 'sub/x.WAV');
});

test('an audio column matches a relative path exactly, or a file name only when one recording has it', () => {
    const { table, audit } = resolve('audio_file,line\n./day1/c.wav,L1\nday2/c.wav,L2\na.wav,L3\ndup.wav,L4\nmissing.wav,L5\n');
    assert.deepEqual(table.rows, { [`${ROOT}/day1/c.wav`]: ['L1'], [`${ROOT}/a.wav`]: ['L3'] });
    // day2/c.wav is a path, so it is not guessed from the file name; dup.wav names two recordings.
    assert.deepEqual(audit, { matched: 2, recordings: 5, missing: 2, ambiguous: 1, repeated: 0 });
    assert.deepEqual(table.columns, ['line']);
});

test('a sample name gets the audio extensions added; matching is case-sensitive; the first row for a recording wins', () => {
    const { table, audit } = resolve('sample_id,line,rpm\na,L1,900\nB,L2,900\nb,L3,1200\nb,L4,1500\n');
    assert.deepEqual(table.rows, { [`${ROOT}/a.wav`]: ['L1', '900'], [`${ROOT}/b.wav`]: ['L3', '1200'] });
    assert.deepEqual(audit, { matched: 2, recordings: 5, missing: 1, ambiguous: 0, repeated: 1 });
    assert.deepEqual(table.numeric, [false, true]);
    assert.deepEqual(table.checked, [0, 1]);
    assert.deepEqual(table.order, [`${ROOT}/a.wav`, `${ROOT}/b.wav`]);
    // Without an audio or sample column the first column names the sample.
    assert.deepEqual(resolve('name,line\nc,L1\n').table.rows, { [`${ROOT}/day1/c.wav`]: ['L1'] });
    // Both columns: the audio column decides and neither is a condition.
    assert.deepEqual(resolve('sample_id,wav_path,line\nzz,a.wav,L1\n').table.columns, ['line']);
});

test('subfolders become condition columns, checked by default when the table has none of its own', () => {
    const folders = withFolderColumns(null, files, ROOT, level => `folder ${level}`)!;
    assert.deepEqual(folders.columns, ['folder 1']);
    assert.deepEqual(folders.checked, [0]);
    assert.deepEqual(folders.rows[`${ROOT}/day2/dup.wav`], ['day2']);
    assert.deepEqual(folders.rows[`${ROOT}/a.wav`], ['']);
    const withTable = withFolderColumns(resolve('sample_id,line\na,L1\n').table, files, ROOT, level => `folder ${level}`)!;
    assert.deepEqual(withTable.columns, ['line', 'folder 1']);
    assert.deepEqual(withTable.checked, [0]);
    assert.deepEqual(withTable.rows[`${ROOT}/day1/c.wav`], ['', 'day1']);
    assert.equal(withFolderColumns(null, [`${ROOT}/a.wav`], ROOT, String), null);
});

test('the folder\'s metadata is the table attached to the most recordings, at least half of them', async () => {
    const candidate = (path: string, text: string) => ({ path, read: async () => bytes(text) });
    const picked = await pickMetadataTable([
        candidate('/data/motor/z.csv', 'sample_id,x\na,1\nb,1\nc,1\n'),
        candidate('/data/motor/half.tsv', 'sample_id\tx\na\t1\n'),
        candidate('/data/motor/broken.csv', 'only header\n'),
        { path: '/data/motor/huge.csv', size: 21 * 1024 ** 2, read: async () => { throw new Error('read'); } },
        { path: '/data/motor/unreadable.csv', read: async () => { throw new Error('denied'); } },
    ], files, ROOT);
    assert.equal(picked?.path, '/data/motor/z.csv');
    assert.equal(picked?.table.source, 'z.csv');
    assert.equal(await pickMetadataTable([candidate('/data/motor/one.csv', 'sample_id,x\na,1\nb,1\n')], files, ROOT), undefined);
});

function ok(): ScanResult {
    return {
        ok: true, conditionId: 'c', specVersion: 2, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: 16000, channels: [0], durationS: 1, unit: 'FS', ref: 1 },
        leqDbA: [-20], peakHz: [100], spectrumDb: [[-20]], thirdOctDb: [BAND_CENTERS_HZ.map(() => -40)], crest: [1.4],
    };
}

test('a listed metadata CSV becomes the conditions, is not scanned and keeps the columns last checked for it', async () => {
    const store: Record<string, unknown> = {};
    const scanned: string[] = [];
    const ports: EntryScanPorts = {
        identity: async () => undefined,
        scan: async filePath => { scanned.push(filePath); return ok(); },
        readFile: async () => bytes('sample_id,audio_file,line,rpm\nx,a.wav,L1,900\ny,b.wav,L2,900\n'),
        read: key => store[key],
        write: (key, value) => { store[key] = value; },
    };
    const run = async (): Promise<Extract<EntryPublication, { type: 'entry-conditions' }>> => {
        const published: EntryPublication[] = [];
        await runEntryScan(ports, { type: 'entry-scan', requestId: 'r', rootPath: '/d', filePaths: ['/d/a.wav', '/d/motor.csv', '/d/b.wav'] }, message => { published.push(message); }, () => true);
        return published[0] as Extract<EntryPublication, { type: 'entry-conditions' }>;
    };
    const first = await run();
    assert.equal(first.metadataPath, '/d/motor.csv');
    assert.equal(first.table?.source, 'motor.csv');
    assert.deepEqual(first.table?.columns, ['line', 'rpm']);
    assert.deepEqual(scanned, ['/d/a.wav', '/d/b.wav']);
    store[ENTRY_CONDITIONS_KEY] = { ...first.table!, checked: [1] };
    assert.deepEqual((await run()).table?.checked, [1]);
});

test('while a scan runs the rows keep the metadata table\'s order; afterwards they sort by Δ', () => {
    const table = resolveTable(parseTable('sample_id,line\nz,L1\na,L1\nm,L1\n')!, ['/d/a.wav', '/d/m.wav', '/d/z.wav', '/d/x.wav'], '/d').table;
    const entries = [
        { filePath: '/d/a.wav', result: { ...ok(), leqDbA: [-30] } },
        { filePath: '/d/m.wav' },
        { filePath: '/d/z.wav', result: { ...ok(), leqDbA: [-10] } },
        { filePath: '/d/x.wav' },
    ];
    assert.deepEqual(buildEntryModel(entries, table, { sort: 'leq', order: 'file' }).rows.map(row => row.name), ['z.wav', 'a.wav', 'm.wav', 'x.wav']);
    const done = buildEntryModel(entries, table, { sort: 'leq', order: 'delta' });
    assert.equal(done.rows[0].name, 'z.wav');
    assert.equal(done.rows.at(-1)!.status, 'pending');
    // A recording the table does not name has no condition (no file-name fallback once a table exists).
    assert.deepEqual(done.rows.find(row => row.name === 'x.wav')!.conditions, []);
});
