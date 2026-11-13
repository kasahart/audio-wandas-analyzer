import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { batchBundle } from '../shared/batch/batchBundle';
import { annotatedCsv, datasetRows, matchCsv, readDatasetCsv } from '../shared/dataset/datasetTable';
import { getStrings } from '../shared/i18n/strings';
import type { EntryConditionTable } from '../shared/analysis/entryScan';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { csvField, csvRecords } from '../shared/utils/csv';
import { parseCSV } from '../shared/dataset/asdData';
import { reportCsv } from '../webview/runtime/compareReport';
import { BAND_CENTERS_HZ, buildEntryModel, entryCsv } from '../webview/runtime/entryTable';
import { bandLevelColumns, levelColumns } from '../webview/runtime/figureModel';
import { buildSpectrumCsv } from '../webview/runtime/runtimeExports';
import { compareOf } from './helpers/compareInput';
import { P, T } from './helpers/figure';

/** What a field can hold that a bare join would break: a comma (an English header has one), a quote, a line break. */
const AWKWARD = 'a, "b"\nc';
const EN = getStrings('en');
const sameWidth = (records: string[][]): void => records.forEach((record, index) => assert.equal(record.length, records[0].length, `record ${index}: ${JSON.stringify(record)}`));

function scan(leq: number): ScanResult {
    return {
        ok: true, conditionId: 'c', specVersion: 2, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: 16000, channels: [0], durationS: 2, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true },
        leqDbA: [leq], peakHz: [100], spectrumDb: [[-40, -50]], thirdOctDb: [BAND_CENTERS_HZ.map(() => leq - 10)], crest: [1.4],
    };
}

test('a CSV field is quoted, its quotes doubled, exactly when it holds a comma, a quote or a line break (RFC 4180)', () => {
    assert.equal(csvField('Level [dBFS]'), 'Level [dBFS]');
    assert.equal(csvField('Level, uncalibrated [dBFS]'), '"Level, uncalibrated [dBFS]"');
    assert.equal(csvField('5" disc'), '"5"" disc"');
    assert.equal(csvField('a\r\nb'), '"a\r\nb"');
    assert.equal(csvField(''), '');
});

test('an export reads back by the reader of what the Analyzer writes as by the app\'s own reader of a picked CSV (asdData.parseCSV)', () => {
    const written = [['name', 'level'], [AWKWARD, '1'], ['', '2']].map(record => record.map(csvField).join(',')).join('\r\n') + '\r\n';
    const records = csvRecords('\uFEFF' + written);
    assert.deepEqual(records, [['name', 'level'], [AWKWARD, '1'], ['', '2']]);
    const picked = parseCSV(written);
    assert.deepEqual([picked.columns, ...picked.rows.map(row => picked.columns.map(column => row[column]))], records);
    assert.deepEqual(csvRecords('a,b\nc,'), [['a', 'b'], ['c', '']]);
    assert.throws(() => csvRecords('"a'));
});

test('the spectrum export keeps an English level header ("Level, uncalibrated [dBFS]") one column, its quantity, unit and reference whole', () => {
    const level = EN.axisLevelUncal.replace('{label}', 'dBFS');
    assert.ok(level.includes(','), 'the English level header holds the comma this test is about');
    const csv = buildSpectrumCsv([0, 1].map(channel => ({
        name: `${AWKWARD} ch${channel + 1}`, slice: { values: [-10, -20], bins: [-10, -20], frequencyBins: 2, maxFrequencyHz: 8000, minDb: -20, maxDb: -10 }, levelTitle: T(level),
    })), P(EN.axisFrequency));
    const records = csvRecords(csv);
    assert.deepEqual(records[0], [`${AWKWARD} ch1 ${EN.axisFrequency}`, `${AWKWARD} ch1 ${level}`, `${AWKWARD} ch2 ${EN.axisFrequency}`, `${AWKWARD} ch2 ${level}`]);
    sameWidth(records);
    assert.deepEqual(records[2].map(Number), [8000, -20, 8000, -20]);
});

test('the entry CSV keeps a condition column named with a comma, a quote and a line break, and the English level columns, one column each', () => {
    const results = new Map<string, ScanResult>([['/f/a.wav', scan(-20)], ['/f/b.wav', scan(-30)]]);
    const table: EntryConditionTable = { columns: [AWKWARD], checked: [0], rows: { '/f/a.wav': ['x, "y"'], '/f/b.wav': ['z'] } };
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), table);
    const csv = entryCsv(model, {
        file: EN.entryColFile, condition: n => EN.entryColCondition.replace('{n}', String(n)), regionStart: EN.reportRegionStart, regionEnd: EN.reportRegionEnd,
        level: levelColumns(EN), peak: EN.entryColPeak, bandLevel: bandLevelColumns(EN, '3.15 kHz'), deltaLeq: `Δ ${EN.entryColLeq}`, deltaBand: 'Δ 3.15 kHz dB',
        groupSize: EN.entryCsvGroupSize, groupLeft: EN.entryCsvGroupLeft, status: EN.dsReason, stale: EN.reportChainPrevious,
    }, () => null);
    const records = csvRecords(csv);
    sameWidth(records);
    assert.equal(records.length, 3);
    assert.ok(records[0].includes(levelColumns(EN).level) && records[0].includes(levelColumns(EN).reference), records[0].join(' | '));
    assert.equal(records[0][1], AWKWARD);
    assert.deepEqual(records.slice(1).map(record => record[1]), ['x, "y"', 'z']);
});

test('報告.csv keeps a memo and a row label with a comma, a quote and a line break in their own columns, in English too', () => {
    const results = new Map<string, ScanResult>([['/f/a.wav', scan(-20)], ['/f/b.wav', scan(-30)]]);
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null);
    const csv = reportCsv({
        model, results, slots: [null, '/f/b.wav', null, null], region: null, recipe: null, recipeName: 'r', now: new Date(), stale: new Set<string>(),
        compare: (filePath: string) => compareOf(model, results, filePath, '/f/a.wav', EN),
        rowInfo: () => ({ label: AWKWARD, value: '', memo: AWKWARD, channel: 1, base: { kind: 'file', file: AWKWARD, count: 1, channel: 1, filters: [AWKWARD], fewerChannels: 0 } }),
    }, EN);
    const records = csvRecords(csv);
    sameWidth(records);
    assert.equal(records.length, 2);
    assert.equal(records[1][0], AWKWARD);
    assert.equal(records[1][records[0].indexOf(EN.reportMemo)], AWKWARD);
});

test('the notes CSV gives back a picked CSV whose column names and values hold commas, quotes and line breaks as they were, the memo too', () => {
    const picked = `audio_file,"${AWKWARD.replace(/"/g, '""')}",level\r\na.wav,"x, y",1\r\n`;
    const csv = readDatasetCsv(new TextEncoder().encode(picked), 'picked.csv');
    const files = ['/d/a.wav'];
    const match = matchCsv(csv, files, '/d');
    const rows = datasetRows(files, '/d', match.attributes, new Map());
    const records = csvRecords(annotatedCsv(csv, match, files, '/d', rows, new Map([[rows[0].key, AWKWARD]]), new Set()));
    assert.deepEqual(records, [['audio_file', AWKWARD, 'level', 'memo', 'excluded'], ['a.wav', 'x, y', '1', AWKWARD, '']]);
});

test('a batch\'s targets.csv keeps a recording path and an id column with commas and quotes in one column each', () => {
    const recipe = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
    const picked = readDatasetCsv(new TextEncoder().encode('audio_file,"id, ""sample""",level\r\n"a, b.wav",S1,1\r\n'), 'picked.csv');
    const files = ['/d/a, b.wav'];
    const all = datasetRows(files, '/d', matchCsv(picked, files, '/d').attributes, new Map());
    const { files: written } = batchBundle({ recipe, recipeName: 'Standard', rows: all, allRows: all, rootPath: '/d', idColumn: 'id, "sample"', now: new Date(2026, 0, 1) });
    const records = csvRecords(written.find(file => file.name === 'targets.csv')?.text ?? '');
    assert.deepEqual(records, [['path', 'channel', 'recipe', 'id, "sample"'], ['a, b.wav', '', 'Standard.recipe.json', 'S1']]);
});

test('every CSV the Analyzer writes quotes its fields through shared/utils/csv.ts: no writer doubles quotes of its own', () => {
    const roots = ['shared', 'webview', 'extension'].map(dir => path.join(__dirname, '..', '..', 'src', dir));
    const copies: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const file = path.join(dir, name);
            if (statSync(file).isDirectory()) walk(file);
            else if (file.endsWith('.ts') && !file.endsWith(path.join('utils', 'csv.ts')) && readFileSync(file, 'utf8').includes(`'""'`)) copies.push(path.relative(path.join(__dirname, '..', '..'), file));
        }
    };
    roots.forEach(walk);
    assert.deepEqual(copies, []);
});
