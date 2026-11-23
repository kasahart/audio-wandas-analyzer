import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { batchBundle } from '../shared/batch/batchBundle';
import { annotatedCsv, datasetRows, matchCsv, readDatasetCsv } from '../shared/dataset/datasetTable';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { csvField, csvFile, csvRecords } from '../shared/utils/csv';
import { parseCSV } from '../shared/dataset/asdData';

/** What a field can hold that a bare join would break: a comma (an English header has one), a quote, a line break. */
const AWKWARD = 'a, "b"\nc';
/**
 * The file format of every CSV the Analyzer writes (src/shared/utils/csv.ts): EF BB BF first, CRLF after every record
 * and nowhere a bare CR or LF outside a quoted field, and the bytes `csvFile` writes for what `csvRecords` reads back.
 */
function assertCsvFormat(text: string, name: string): string[][] {
    const bytes = Buffer.from(text, 'utf8');
    assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], `${name} starts with the UTF-8 BOM`);
    assert.ok(text.endsWith('\r\n'), `${name} ends its last record with CRLF`);
    const unquoted = text.replace(/"(?:[^"]|"")*"/gu, '""');
    assert.doesNotMatch(unquoted, /\r(?!\n)|(?<!\r)\n/u, `${name} ends every record with CRLF, never a bare LF or CR`);
    const records = csvRecords(text);
    assert.equal(csvFile(records[0], records.slice(1)), text, `${name} round-trips through csvRecords as the bytes csvFile writes`);
    return records;
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

test('the notes CSV gives back a picked CSV whose column names and values hold commas, quotes and line breaks as they were, the memo too', () => {
    const picked = `audio_file,"${AWKWARD.replace(/"/g, '""')}",level\r\na.wav,"x, y",1\r\n`;
    const csv = readDatasetCsv(new TextEncoder().encode(picked), 'picked.csv');
    const files = ['/d/a.wav'];
    const match = matchCsv(csv, files, '/d');
    const rows = datasetRows(files, '/d', match.attributes, new Map());
    const records = assertCsvFormat(annotatedCsv(csv, match, files, '/d', rows, new Map([[rows[0].key, AWKWARD]]), new Set()), 'notes.csv');
    assert.deepEqual(records, [['audio_file', AWKWARD, 'level', 'memo', 'excluded'], ['a.wav', 'x, y', '1', AWKWARD, '']]);
});

test('a batch\'s targets.csv keeps a recording path and an id column with commas and quotes in one column each', () => {
    const recipe = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
    const picked = readDatasetCsv(new TextEncoder().encode('audio_file,"id, ""sample""",level\r\n"a, b.wav",S1,1\r\n'), 'picked.csv');
    const files = ['/d/a, b.wav'];
    const all = datasetRows(files, '/d', matchCsv(picked, files, '/d').attributes, new Map());
    const { files: written } = batchBundle({ recipe, recipeName: 'Standard', rows: all, allRows: all, rootPath: '/d', idColumn: 'id, "sample"', now: new Date(2026, 0, 1) });
    const records = assertCsvFormat(written.find(file => file.name === 'targets.csv')?.text ?? '', 'targets.csv');
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

test('every CSV file is UTF-8 with a BOM and CRLF, written whole by csvFile: no export builds CSV text without it', () => {
    assert.equal(csvFile(['a', 'b, c'], [['1', ''], [AWKWARD, '2']]), '\uFEFFa,"b, c"\r\n1,\r\n"a, ""b""\nc",2\r\n');
    assertCsvFormat(csvFile(['only'], []), 'a header alone');
    // An export that quoted its own fields or wrote its own BOM would be a second place the file format is decided:
    // the spectrum CSV once went out without the BOM and with LF while the others had both.
    const csvModule = path.join('src', 'shared', 'utils', 'csv.ts');
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const file = path.join(dir, name);
            if (statSync(file).isDirectory()) { walk(file); continue; }
            const relative = path.relative(path.join(__dirname, '..', '..'), file);
            if (!file.endsWith('.ts') || relative === csvModule) continue;
            readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
                // A BOM is only ever stripped from a CSV read (a regex anchored at its start), never written.
                const bom = /\\u\{?0*feff\}?|\uFEFF/iu.test(line.replace(/\/\^(?:\\uFEFF|\uFEFF)\//gu, ''));
                if (bom || /\bcsvField\b/u.test(line)) found.push(`${relative}:${index + 1}: ${line.trim()}`);
            });
        }
    };
    ['shared', 'webview', 'extension'].forEach(dir => walk(path.join(__dirname, '..', '..', 'src', dir)));
    assert.deepEqual(found, [], 'Rule: every CSV the Analyzer writes is written by csvFile (src/shared/utils/csv.ts), which alone '
        + 'quotes the fields (csvField) and adds the BOM and the CRLF:\n' + found.join('\n'));
});
