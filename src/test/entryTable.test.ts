import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import {
    BAND_CENTERS_HZ, buildEntryModel, entryCsv, filenameConditions, type DerivedRow, type EntryFile,
} from '../webview/runtime/entryTable';
import { getStrings } from '../shared/i18n/strings';

const repoRoot = path.resolve(__dirname, '..', '..');
const BAND_3150 = BAND_CENTERS_HZ.indexOf(3150);
const LABELS = {
    file: 'File', condition: (n: number) => ['Line', 'rpm'][n - 1], regionStart: 'Start s', regionEnd: 'End s', leq: 'Leq dB(A)', peak: 'Δ max band',
    band: '3.15 kHz dB', deltaLeq: 'Δ Leq', deltaBand: 'Δ band', groupSize: 'n', status: 'Reason',
};

function scan(leq: number, band: number, options: { fs?: number; channels?: number; peak?: number } = {}): ScanResult {
    const channels = options.channels ?? 1;
    const third = BAND_CENTERS_HZ.map((_, index) => (index === BAND_3150 ? band : -60));
    return {
        ok: true, conditionId: 'c', specVersion: 1, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: options.fs ?? 16000, channels: Array.from({ length: channels }, (_, i) => i), durationS: 2, unit: 'FS', ref: 1 },
        leqDbA: Array(channels).fill(leq), peakHz: Array(channels).fill(options.peak ?? 100),
        spectrumDb: Array(channels).fill([leq]), thirdOctDb: Array(channels).fill(third), crest: Array(channels).fill(1.4),
    };
}

test('names give two conditions before the run token, split on _ or -', () => {
    assert.deepEqual(filenameConditions('/data/L3_900rpm_run018.wav'), ['L3', '900rpm']);
    assert.deepEqual(filenameConditions('C:\\data\\motorA-1200-007.WAV'), ['motorA', '1200']);
    assert.deepEqual(filenameConditions('/data/run012.wav'), []);
    assert.deepEqual(filenameConditions('/data/Rec_0012.wav'), []);
});

test('rows get Δ from the median of their condition\'s other files, never an outlier mark', () => {
    const files: EntryFile[] = [
        ...[-30, -30.2, -29.8, -30.1, -18].map((band, i) => ({ filePath: `/f/L1_900rpm_run${i}.wav`, result: scan(-20, band) })),
        { filePath: '/f/L2_900rpm_run9.wav', result: scan(-20, -40) },
        { filePath: '/f/L2_900rpm_run8.wav', result: scan(-20, -20) },
        { filePath: '/f/free.wav', result: scan(-25, -35) },
    ];
    const model = buildEntryModel(files, null, { band: BAND_3150 });
    const row = (name: string) => model.rows.find(item => item.filePath.endsWith(name))!;
    // A row is not part of its own base: run4 against the median of run0–run3 (−30.05).
    assert.equal(row('run4.wav').delta.band, 12);
    // Its most different band, with that Δ.
    assert.equal(row('run4.wav').values.peak, 3150);
    assert.equal(row('run4.wav').delta.peak, 12);
    // Two rows: Δ shown.
    assert.equal(row('run9.wav').delta.band, -20);
    // n counts the files a row is measured against: the one other file.
    assert.equal(row('run9.wav').groupSize, 1);
    // No condition: no Δ. Rows keep the files' order (by name without a table).
    assert.equal(row('free.wav').delta.band, null);
    assert.equal(model.rows[0].name, 'L1_900rpm_run0.wav');
});

test('unreadable files and files of another shape show no numbers', () => {
    const files: EntryFile[] = [
        { filePath: '/f/L1_900rpm_run1.wav', result: scan(-20, -30, { channels: 2 }) },
        { filePath: '/f/L1_900rpm_run2.wav', result: scan(-20, -30, { channels: 2 }) },
        { filePath: '/f/mono.wav', result: scan(-20, -30, { fs: 48000 }) },
        { filePath: '/f/broken.wav', result: { ok: false, reason: 'Unable to read audio' } },
        { filePath: '/f/later.wav' },
    ];
    const model = buildEntryModel(files, null, { band: BAND_3150 });
    const row = (name: string) => model.rows.find(item => item.name === name)!;
    assert.equal(row('mono.wav').status, 'mismatch');
    assert.equal(row('mono.wav').mismatch, '≠ 1 ch · 48 kHz');
    assert.equal(row('broken.wav').status, 'failed');
    // Rows keep the files' order (by name): status does not reorder them.
    assert.deepEqual(model.rows.map(item => item.status), ['ok', 'ok', 'failed', 'pending', 'mismatch']);
});

test('a table decides the condition over the name, on its checked columns', () => {
    const files: EntryFile[] = [
        { filePath: '/f/L1_900rpm_run1.wav', result: scan(-20, -30) },
        { filePath: '/f/run2.wav', result: scan(-20, -31) },
    ];
    const table = { columns: ['line', 'rpm'], checked: [0, 1], rows: { '/f/L1_900rpm_run1.wav': ['A', '900'], '/f/run2.wav': ['A', '900'] } };
    const model = buildEntryModel(files, table, { band: BAND_3150 });
    assert.deepEqual(model.columns.map(column => column.name), ['line', 'rpm']);
    assert.deepEqual(model.rows.map(row => row.groupSize), [1, 1]);
    const byLine = buildEntryModel(files, { ...table, checked: [0] }, { band: BAND_3150 });
    assert.deepEqual(byLine.rows[0].conditions, ['A']);
});

test('the CSV has the agreed columns, a BOM, and the same bytes every time', () => {
    const files: EntryFile[] = [
        ...[-30, -30, -18].map((band, i) => ({ filePath: `/f/L1_900rpm_run${i}.wav`, result: scan(-20, band) })),
        { filePath: '/f/broken.wav', result: { ok: false, reason: 'x' } },
    ];
    const first = entryCsv(buildEntryModel(files, null, { band: BAND_3150 }), LABELS);
    const second = entryCsv(buildEntryModel(files, null, { band: BAND_3150 }), LABELS);
    assert.equal(first, second);
    assert.ok(first.startsWith('\uFEFF'));
    const lines = first.slice(1).trimEnd().split('\r\n');
    assert.equal(lines[0], 'File,Line,rpm,Start s,End s,Leq dB(A),Δ max band Hz,Δ max band dB,3.15 kHz dB,Δ Leq,Δ band,n,Reason');
    assert.equal(lines[3], 'L1_900rpm_run2.wav,L1,900rpm,0.15,1.85,-20.0,3150,12.0,-18.0,0.0,12.0,2,');
    assert.equal(lines.at(-1), 'broken.wav,,,,,,,,,,,,✕');
});

test('one stored scan result stays within about 5 KB', () => {
    const twoChannels = scan(-20.12, -30.12, { channels: 2 });
    twoChannels.spectrumDb = [0, 1].map(() => Array.from({ length: 192 }, (_, i) => Math.round((-40.12 - i / 7) * 100) / 100));
    assert.ok(JSON.stringify(twoChannels).length < 5 * 1024, String(JSON.stringify(twoChannels).length));
});

function findPython(): string | null {
    for (const candidate of [path.join(repoRoot, '.venv', 'bin', 'python'), path.join(repoRoot, '.venv', 'Scripts', 'python.exe'), process.env.WANDAS_PYTHON]) {
        if (candidate && existsSync(candidate)) return candidate;
    }
    for (const command of ['python3', 'python']) {
        if (spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0) return command;
    }
    return null;
}

test('on the scanned entry100 fixture the three resonances stand 10 dB above their groups at 3.15 kHz, one ✕ and one ≠', (t) => {
    const python = findPython();
    if (!python) { t.skip('no Python'); return; }
    const out = mkdtempSync(path.join(tmpdir(), 'entry100-'));
    try {
        const run = spawnSync(python, [path.join(repoRoot, 'src', 'test', 'fixtures', 'entry100', 'scan.py'), out], { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
        if (run.status !== 0 && /No module named 'wandas'/.test(run.stderr)) { t.skip('wandas is not installed'); return; }
        assert.equal(run.status, 0, run.stderr);
        const files = JSON.parse(run.stdout) as EntryFile[];
        const model = buildEntryModel(files, null);
        assert.equal(BAND_CENTERS_HZ[model.band], 3150);
        assert.deepEqual(model.rows.filter(row => (row.delta.band ?? 0) >= 10).map(row => row.name).sort(),
            ['L1_1500rpm_run018.wav', 'L2_1500rpm_run043.wav', 'L3_1500rpm_run060.wav']);
        assert.ok(model.rows.filter(row => row.conditions[1] === '1800rpm').every(row => row.groupSize < 3));
        assert.deepEqual(model.rows.filter(row => row.status !== 'ok').map(row => row.name).sort(), ['Rec_0012.wav', 'mono_48k.wav']);
        assert.ok(files.every(file => JSON.stringify(file.result).length < 5 * 1024));
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
});

test('a folder with one file or no shared condition still builds: no Δ, the 1 kHz band', () => {
    const one = buildEntryModel([{ filePath: '/f/only.wav', result: scan(-20, -30) }], null);
    assert.equal(one.rows.length, 1);
    assert.equal(BAND_CENTERS_HZ[one.band], 1000);
    assert.equal(one.rows[0].delta.leq, null);
    const empty = buildEntryModel([], null);
    assert.deepEqual(empty.rows, []);
    assert.equal(entryCsv(empty, LABELS).slice(1).split('\r\n').length, 2);
});

test('a derived row sits under its parent with the parent\'s condition and Δ against its own base, and counts toward no group', () => {
    const files: EntryFile[] = [-30, -31, -29].map((band, i) => ({ filePath: `/f/L1_900rpm_run${i}.wav`, result: scan(-20, band) }));
    const derived: DerivedRow[] = [{
        parentPath: '/f/L1_900rpm_run1.wav', region: '0.50–1.50', result: scan(-15, -20),
        base: { leq: -20, bands: BAND_CENTERS_HZ.map(() => -26) },
    }];
    const plain = buildEntryModel(files, null, { band: BAND_3150 });
    const model = buildEntryModel(files, null, { band: BAND_3150, derived });
    assert.equal(model.rows.length, 4);
    const parent = model.rows.findIndex(row => row.filePath === '/f/L1_900rpm_run1.wav');
    const child = model.rows[parent + 1];
    assert.equal(child.name, '└ Δ 0.50–1.50 s');
    assert.deepEqual(child.conditions, ['L1', '900rpm']);
    assert.equal(child.delta.leq, 5);
    assert.equal(child.delta.band, 6);
    assert.equal(child.groupSize, 0);
    // The group, its median and its outliers are those of the table without the derived row.
    assert.deepEqual(model.rows.filter(row => !row.derived).map(row => [row.groupSize, row.delta.band]), plain.rows.map(row => [row.groupSize, row.delta.band]));
    const csv = entryCsv(model, LABELS).slice(1).split('\r\n');
    assert.equal(csv[parent + 2].split(',').slice(0, 5).join(','), 'L1_900rpm_run1.wav,L1,900rpm,0.50,1.50');
});
