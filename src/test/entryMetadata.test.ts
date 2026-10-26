import assert from 'node:assert/strict';
import test from 'node:test';
import { audioKey, withFolderColumns } from '../shared/analysis/entryMetadata';
import { runEntryScan, type EntryPublication, type EntryScanPorts } from '../shared/analysis/entryScan';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { BAND_CENTERS_HZ, buildEntryModel } from '../webview/runtime/entryTable';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const ROOT = '/data/motor';
const files = ['a.wav', 'b.wav', 'day1/c.wav', 'day1/dup.wav', 'day2/dup.wav'].map(key => `${ROOT}/${key}`);

test('recordings are keyed by their path below the opened folder', () => {
    assert.equal(audioKey('/data/motor/day1/c.wav', '/data/motor'), 'day1/c.wav');
    assert.equal(audioKey('C:\\data\\motor\\a.wav', 'C:\\data\\motor'), 'a.wav');
    assert.equal(audioKey('/sources/rec/sub/x.WAV', '/sources/rec'), 'sub/x.WAV');
});

test('subfolders become condition columns, checked by default when the table has none of its own', () => {
    const folders = withFolderColumns(null, files, ROOT, level => `folder ${level}`)!;
    assert.deepEqual(folders.columns, ['folder 1']);
    assert.deepEqual(folders.checked, [0]);
    assert.deepEqual(folders.rows[`${ROOT}/day2/dup.wav`], ['day2']);
    assert.deepEqual(folders.rows[`${ROOT}/a.wav`], ['']);
    const withTable = withFolderColumns({ columns: ['line'], checked: [0], rows: { [`${ROOT}/a.wav`]: ['L1'] } }, files, ROOT, level => `folder ${level}`)!;
    assert.deepEqual(withTable.columns, ['line', 'folder 1']);
    assert.deepEqual(withTable.checked, [0]);
    assert.deepEqual(withTable.rows[`${ROOT}/day1/c.wav`], ['', 'day1']);
    assert.equal(withFolderColumns(null, [`${ROOT}/a.wav`], ROOT, String), null);
});

function ok(): ScanResult {
    return {
        ok: true, conditionId: 'c', specVersion: 2, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: 16000, channels: [0], durationS: 1, unit: 'FS', ref: 1 },
        leqDbA: [-20], peakHz: [100], spectrumDb: [[-20]], thirdOctDb: [BAND_CENTERS_HZ.map(() => -40)], crest: [1.4],
    };
}

test('the host looks for no CSV: a listed one is neither read nor scanned (the user picks one on the table)', async () => {
    const scanned: string[] = [];
    let read = 0;
    const ports: EntryScanPorts = {
        identity: async () => undefined,
        scan: async filePath => { scanned.push(filePath); return ok(); },
        readFile: async () => { read++; return bytes('sample_id,audio_file,line,rpm\nx,a.wav,L1,900\n'); },
        read: () => undefined,
        write: () => undefined,
    };
    const published: EntryPublication[] = [];
    await runEntryScan(ports, { type: 'entry-scan', requestId: 'r', rootPath: '/d', filePaths: ['/d/a.wav', '/d/motor.csv', '/d/b.wav'] }, message => { published.push(message); }, () => true);
    assert.deepEqual(published[0], { type: 'entry-conditions', requestId: 'r', table: null });
    assert.equal(read, 0);
    assert.deepEqual(scanned, ['/d/a.wav', '/d/b.wav']);
});

test('rows keep the metadata table\'s order, files it does not name after it by name', () => {
    const table = { columns: ['line'], checked: [0], rows: { '/d/z.wav': ['L1'], '/d/a.wav': ['L1'], '/d/m.wav': ['L1'] }, order: ['/d/z.wav', '/d/a.wav', '/d/m.wav'] };
    const entries = [
        { filePath: '/d/a.wav', result: { ...ok(), leqDbA: [-30] } },
        { filePath: '/d/m.wav' },
        { filePath: '/d/z.wav', result: { ...ok(), leqDbA: [-10] } },
        { filePath: '/d/x.wav' },
    ];
    const done = buildEntryModel(entries, table);
    assert.deepEqual(done.rows.map(row => row.name), ['z.wav', 'a.wav', 'm.wav', 'x.wav']);
    assert.equal(done.rows.at(-1)!.status, 'pending');
    // A recording the table does not name has no condition (no file-name fallback once a table exists).
    assert.deepEqual(done.rows.find(row => row.name === 'x.wav')!.conditions, []);
});
