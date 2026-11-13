import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import {
    BAND_CENTERS_HZ, buildEntryModel, csvNumber, entryCsv, filenameConditions, levelDelta, type DerivedRow, type EntryFile, type EntryMeasure, type EntryModel,
} from '../webview/runtime/entryTable';
import { compareOf } from './helpers/compareInput';
import { derivedIsStale } from '../webview/runtime/entryRuntime';
import { entryMeasure } from '../webview/runtime/compareReport';
import { getStrings } from '../shared/i18n/strings';
import { bandLevelColumns, levelColumns } from '../webview/runtime/figureModel';

/** Each file measured against its condition's other files, as a comparison with no slot 0 measures it here. */
const byCondition = (model: EntryModel, files: readonly EntryFile[]) => {
    const results = new Map(files.flatMap(file => (file.result ? [[file.filePath, file.result] as const] : [])));
    return (filePath: string): EntryMeasure | null => entryMeasure(compareOf(model, results, filePath, null, getStrings('en')), model.band, getStrings('en'));
};

const repoRoot = path.resolve(__dirname, '..', '..');
const BAND_3150 = BAND_CENTERS_HZ.indexOf(3150);
const LABELS = {
    file: 'File', condition: (n: number) => ['Line', 'rpm'][n - 1], regionStart: 'Start s', regionEnd: 'End s', level: levelColumns({ entryColLeq: 'Leq dB(A)', reportLevelReference: 'Level reference', entryLeqUncalibrated: 'uncalibrated' }), peak: 'Δ max band',
    bandLevel: bandLevelColumns({ entryColBandLevel: '{band} level', reportLevelReference: 'Level reference', entryLeqUncalibrated: 'uncalibrated' }, '3.15 kHz'), deltaLeq: 'Δ Leq', deltaBand: 'Δ band', groupSize: 'n', groupLeft: 'Left out', stale: 'previous chain', status: 'Reason',
};

function scan(leq: number, band: number, options: { fs?: number; channels?: number; peak?: number } = {}): ScanResult {
    const channels = options.channels ?? 1;
    const third = BAND_CENTERS_HZ.map((_, index) => (index === BAND_3150 ? band : -60));
    return {
        ok: true, conditionId: 'c', specVersion: 1, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: options.fs ?? 16000, channels: Array.from({ length: channels }, (_, i) => i), durationS: 2, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true },
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

test('a Δ is taken from the full levels and rounded only as written: −9.996 against −10.004 reads 0.0, never the 0.1 of levels rounded first (R7)', () => {
    assert.ok(Math.abs(levelDelta(-9.996, -10.004) - 0.008) < 1e-12);
    assert.equal(csvNumber(levelDelta(-9.996, -10.004), 1), '0.0');
    // The CSV's Δ is the same: the full levels' difference.
    const files: EntryFile[] = [
        { filePath: '/f/L1_900rpm_run0.wav', result: scan(-10.004, -30) },
        { filePath: '/f/L1_900rpm_run1.wav', result: scan(-9.996, -30) },
    ];
    const model = buildEntryModel(files, null, { band: BAND_CENTERS_HZ.indexOf(3150) });
    assert.equal(entryCsv(model, LABELS, byCondition(model, files)).split('\r\n')[2].split(',')[11], '0.0');
});

test('a file row has no Δ of its own: the CSV writes what `measure` (the screen\'s base) gives, the band centre as its column names it', () => {
    const files: EntryFile[] = [
        ...[-30, -30.2, -29.8, -30.1, -18].map((band, i) => ({ filePath: `/f/L1_900rpm_run${i}.wav`, result: scan(-20, band) })),
        { filePath: '/f/free.wav', result: scan(-25, -35) },
    ];
    const model = buildEntryModel(files, null, { band: BAND_3150 });
    assert.ok(model.rows.every(row => Object.values(row.delta).every(value => value === null)), 'no group is made in the model');
    // A base the model knows nothing of (as slot 0 or a filtered group would be): its numbers are the CSV's.
    const measure = (filePath: string): EntryMeasure | null => (filePath.endsWith('run4.wav') ? { leq: 1.25, band: 12.05, peak: { hz: 31.5, db: -7.5 }, count: 3, left: '' } : null);
    const lines = entryCsv(model, LABELS, measure).slice(1).trimEnd().split('\r\n');
    const run4 = lines.find(line => line.startsWith('L1_900rpm_run4.wav'))!.split(',');
    assert.deepEqual(run4.slice(7, 14), ['31.5', '-7.5', '-18.0', 'dBFS uncalibrated', '1.3', '12.1', '3']);
    const free = lines.find(line => line.startsWith('free.wav'))!.split(',');
    assert.deepEqual(free.slice(7, 14), ['', '', '-35.0', 'dBFS uncalibrated', '', '', '']);
});

test('every band centre is written in the CSV as its column header names it, never rounded to a whole Hz', () => {
    const files: EntryFile[] = [{ filePath: '/f/a.wav', result: scan(-20, -30) }];
    const model = buildEntryModel(files, null, { band: BAND_3150 });
    for (const hz of BAND_CENTERS_HZ) {
        const line = entryCsv(model, LABELS, () => ({ leq: 0, band: 0, peak: { hz, db: 1 }, count: 1, left: '' })).slice(1).split('\r\n')[1];
        assert.equal(line.split(',')[7], String(hz));
    }
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
    const byLine = buildEntryModel(files, { ...table, checked: [0] }, { band: BAND_3150 });
    assert.deepEqual(byLine.rows[0].conditions, ['A']);
});

test('the CSV has the agreed columns, a BOM, and the same bytes every time', () => {
    const files: EntryFile[] = [
        ...[-30, -30, -18].map((band, i) => ({ filePath: `/f/L1_900rpm_run${i}.wav`, result: scan(-20, band) })),
        { filePath: '/f/broken.wav', result: { ok: false, reason: 'x' } },
    ];
    const model = buildEntryModel(files, null, { band: BAND_3150 });
    const first = entryCsv(model, LABELS, byCondition(model, files));
    const second = entryCsv(buildEntryModel(files, null, { band: BAND_3150 }), LABELS, byCondition(model, files));
    assert.equal(first, second);
    assert.ok(first.startsWith('\uFEFF'));
    const lines = first.slice(1).trimEnd().split('\r\n');
    assert.equal(lines[0], 'File,Line,rpm,Start s,End s,Leq dB(A),Level reference,Δ max band Hz,Δ max band dB,3.15 kHz level,3.15 kHz level · Level reference,Δ Leq,Δ band,n,Left out,Reason');
    assert.equal(lines[3], 'L1_900rpm_run2.wav,L1,900rpm,0.15,1.85,-20.0,dBFS uncalibrated,3150,12.0,-18.0,dBFS uncalibrated,0.0,12.0,2,,');
    assert.equal(lines.at(-1), 'broken.wav,,,,,,,,,,,,,,,✕');
});

test('one stored scan result stays within about 5 KB', () => {
    const twoChannels = scan(-20.12, -30.12, { channels: 2 });
    twoChannels.spectrumDb = [0, 1].map(() => Array.from({ length: 192 }, (_, i) => Number((-40.1234 - i / 7).toFixed(4))));
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
        const measure = byCondition(model, files);
        assert.deepEqual(model.rows.filter(row => (measure(row.filePath)?.band ?? 0) >= 10).map(row => row.name).sort(),
            ['L1_1500rpm_run018.wav', 'L2_1500rpm_run043.wav', 'L3_1500rpm_run060.wav']);
        assert.ok(model.rows.filter(row => row.conditions[1] === '1800rpm').every(row => (measure(row.filePath)?.count ?? 0) < 3));
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
    assert.equal(entryCsv(empty, LABELS, () => null).slice(1).split('\r\n').length, 2);
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
    // The file rows are those of the table without the derived row.
    assert.deepEqual(model.rows.filter(row => !row.derived).map(row => row.values), plain.rows.map(row => row.values));
    const csv = entryCsv(model, LABELS, byCondition(plain, files)).slice(1).split('\r\n');
    assert.equal(csv[parent + 2].split(',').slice(0, 5).join(','), 'L1_900rpm_run1.wav,L1,900rpm,0.50,1.50');
});

test('a fixed difference made stale by a recipe change shows ≠ and writes no Δ, no base n and no left-out files (R4)', () => {
    const files: EntryFile[] = [-30, -31, -29].map((band, i) => ({ filePath: `/f/L1_900rpm_run${i}.wav`, result: scan(-20, band) }));
    const fixed: DerivedRow = {
        parentPath: '/f/L1_900rpm_run1.wav', region: '0.50–1.50', result: scan(-15, -20), recipeKey: 'chain-1',
        base: { leq: -20, bands: BAND_CENTERS_HZ.map(() => -26), paths: ['/f/L1_900rpm_run0.wav', '/f/L1_900rpm_run2.wav'],
            definition: { kind: 'group', count: 2, channel: null, filters: [], fewerChannels: 0, left: { failed: 1 } } },
    };
    const header = entryCsv(buildEntryModel([], null), LABELS, () => null).slice(1).split('\r\n')[0].split(',');
    const column = (line: string, name: string): string => line.split(',')[header.indexOf(name)];
    const rowOf = (model: EntryModel) => model.rows.find(row => row.derived)!;
    const csvOf = (model: EntryModel): string => entryCsv(model, LABELS, () => null).slice(1).split('\r\n')[model.rows.indexOf(rowOf(model)) + 1];
    // Current, its saved base n and left-out files are written.
    const current = buildEntryModel(files, null, { band: BAND_3150, derived: [fixed] });
    assert.deepEqual([column(csvOf(current), 'Δ Leq'), column(csvOf(current), 'n'), column(csvOf(current), 'Left out')], ['5.0', '2', '-1 (failed)']);
    // The Recipe changes: the difference is of the chain before (derivedIsStale), so it is ≠.
    const stale = derivedIsStale(fixed, { recipeKey: 'chain-2', stale: () => false, conditionOf: () => '' });
    assert.equal(stale, true);
    const model = buildEntryModel(files, null, { band: BAND_3150, derived: [{ ...fixed, stale }] });
    const row = rowOf(model);
    assert.deepEqual([row.status, row.mismatch, row.stale], ['mismatch', '≠', true], 'the table row shows ≠ and is stale');
    assert.deepEqual(row.values, { leq: null, peak: null, band: null });
    const line = csvOf(model);
    for (const name of ['Δ Leq', 'Δ band', 'n', 'Left out', 'Leq dB(A)']) assert.equal(column(line, name), '', `${name} is empty`);
    assert.equal(column(line, 'Reason'), '≠', 'the status column says ≠, not the file-stale word');
});

test('an uncalibrated row says what its level is relative to (full scale for audio, raw input units for CSV), from its calibration status', () => {
    const csv = scan(-20, -30);
    if (csv.input) csv.input = { ...csv.input, unit: '', levelReferenceLabel: 'dB re 1 input unit', fullScale: false };
    // Calibrated to 1 V: a reference of 1 is still a calibration.
    const volts = scan(60, 50);
    if (volts.input) volts.input = { ...volts.input, unit: 'V', ref: 1, levelReferenceLabel: 'dB re 1 V', calibrationStatus: 'calibrated' };
    // Each its own folder: a table compares only rows of one unit and reference.
    const row = (filePath: string, result: ScanResult) => buildEntryModel([{ filePath, result }], null, { band: BAND_3150 }).rows[0];
    assert.deepEqual([row('/f/a.wav', scan(-20, -30)), row('/f/b.csv', csv), row('/f/c.wav', volts)].map(item => [item.status, item.uncalibrated]),
        [['ok', 'full-scale'], ['ok', 'raw-units'], ['ok', undefined]]);
});

test('no CSV writes a number rounded to a whole (a band centre of 31.5 Hz read "32"): centres go through bandCentreCell', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const root = path.join(repoRoot, 'src');
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? (entry.name === 'test' ? [] : files(full)) : full.endsWith('.ts') ? [full] : [];
    });
    for (const file of files(root)) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), /csvNumber\([^()]*(?:\([^()]*\)[^()]*)*,\s*0\s*\)/, path.relative(root, file));
    }
});
