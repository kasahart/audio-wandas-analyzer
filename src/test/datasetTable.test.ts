import assert from 'node:assert/strict';
import test from 'node:test';
import { auditAudioMatches, finiteNumber, parseCSV, resolveAudio, summarizeAudioCandidates, AUDIO_REASON_CANDIDATE_LIMIT } from '../shared/dataset/asdData';
import { annotatedCsv, baseGroupMembers, columnValues, csvErrorMessage, datasetRows, matchCsv, middleEllipsis, readDatasetCsv, valueOf, visibleRows, type DatasetRow } from '../shared/dataset/datasetTable';
import { CSVColumnCountError, columnCountMessage } from '../shared/dataset/csvDiagnostics';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult } from '../shared/protocol/backendProtocol';

const en = getStrings('en');
const ja = getStrings('ja');

const file = (name: string): { name: string } => ({ name });
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

// ---- asd-insight's own cases (tests/production/audio-resolution.test.mjs, commit 40ea4a0), on the ported code

test('audio resolution reports only evidence from the existing matching rule', () => {
    assert.equal(resolveAudio({ id: 'normal01', audio_file: 'normal01.wav' }, 0, 'id', 'audio_file', new Map()).reason, 'no-files');
    const blankColumn = resolveAudio({ id: 'normal02', audio_file: '' }, 1, 'id', 'audio_file', new Map([['normal01.wav', file('normal01.wav')]]));
    assert.equal(blankColumn.reason, 'audio-column-empty');
    assert.equal(blankColumn.sourceColumn, 'audio_file');
    assert.equal(resolveAudio({ id: '', audio_file: '' }, 2, 'id', '', new Map([['normal01.wav', file('normal01.wav')]])).reason, 'source-id-empty');
    const extension = resolveAudio({ id: '' }, 2, 'id', '', new Map([['.wav', file('.wav')]]));
    assert.equal(extension.reason, 'matched');
    assert.equal(extension.file?.name, '.wav');
    const mismatch = resolveAudio({ id: 'normal03' }, 3, 'id', '', new Map([['normal01.wav', file('normal01.wav')]]));
    assert.equal(mismatch.reason, 'name-mismatch');
    assert.deepEqual(mismatch.expectedNames.slice(0, 2), ['normal03', 'normal03.wav']);
    // An absolute Windows path names no recording below the folder.
    assert.equal(resolveAudio({ id: 'normal01', audio_file: 'C:\\audio\\normal01.wav' }, 0, 'id', 'audio_file', new Map([['normal01.wav', file('normal01.wav')]])).reason, 'name-mismatch');
});

test('folder keys distinguish equal names, and basename-only references require a unique candidate', () => {
    const normal = file('001.wav'), review = file('001.wav');
    const files = new Map([['正常/設備A/001.wav', normal], ['要確認/設備B/001.wav', review]]);
    assert.equal(resolveAudio({ audio_file: '正常\\設備A\\001.wav' }, 0, '', 'audio_file', files).file, normal);
    assert.equal(resolveAudio({ audio_file: '要確認/設備B/001.wav' }, 1, '', 'audio_file', files).file, review);
    const ambiguous = resolveAudio({ audio_file: '001.wav' }, 2, '', 'audio_file', files);
    assert.equal(ambiguous.reason, 'ambiguous');
    assert.deepEqual(ambiguous.candidates, [...files.keys()]);
    assert.equal(resolveAudio({ audio_file: 'missing/001.wav' }, 3, '', 'audio_file', files).reason, 'name-mismatch');
    assert.equal(resolveAudio({ audio_file: '001.wav' }, 0, '', 'audio_file', new Map([['正常/設備A/001.wav', normal]])).file, normal);
    // Case-sensitive.
    assert.equal(resolveAudio({ audio_file: '正常/設備A/001.WAV' }, 0, '', 'audio_file', files).reason, 'name-mismatch');
});

test('ambiguous reasons show a bounded candidate sample and total', () => {
    const candidates = Array.from({ length: AUDIO_REASON_CANDIDATE_LIMIT + 17 }, (_, index) => `folder-${index}/shared.wav`);
    const summary = summarizeAudioCandidates(candidates, ja);
    assert.ok(summary.includes(candidates[0]));
    assert.ok(summary.includes('、ほか17件'));
    assert.ok(!summary.includes(candidates.at(-1)!));
    const english = summarizeAudioCandidates(candidates, en);
    assert.equal(english, `${candidates.slice(0, AUDIO_REASON_CANDIDATE_LIMIT).join(', ')}, and 17 more`);
    assert.ok(!/[、ほ件]/.test(english));
    assert.equal(summarizeAudioCandidates(candidates.slice(0, 2), ja), `${candidates[0]}、${candidates[1]}`);
});

test('a column-count error is worded in the panel language from its diagnostic', () => {
    let caught: unknown;
    try { parseCSV('score,label\n1,OK,extra', 'bad.csv'); } catch (error) { caught = error; }
    assert.ok(caught instanceof CSVColumnCountError);
    assert.equal(csvErrorMessage(caught, en), 'Data row 1 (line 2 of the file) does not have as many columns as the header. The header (line 1) has 2 columns; this row has 3 (1 extra).');
    assert.equal(csvErrorMessage(caught, ja), 'データ行 1（ファイル2行目）の列数がヘッダーと一致しません。ヘッダー（1行目）は2列、実際は3列（1列超過）です。');
    // The thrown message itself is the English wording.
    assert.equal(caught.message, csvErrorMessage(caught, en));
    // A record spanning lines (a quoted newline) that is short of columns.
    const diagnostic = { ...caught.diagnostic, dataRow: 4, startLine: 5, endLine: 7, headerLine: 2, expectedColumns: 5, actualColumns: 3 };
    assert.equal(columnCountMessage(diagnostic, en), 'Data row 4 (lines 5–7 of the file) does not have as many columns as the header. The header (line 2) has 5 columns; this row has 3 (2 missing).');
    assert.equal(columnCountMessage(diagnostic, ja), 'データ行 4（ファイル5〜7行目）の列数がヘッダーと一致しません。ヘッダー（2行目）は5列、実際は3列（2列不足）です。');
    // Other errors keep their own message.
    assert.equal(csvErrorMessage(new Error('plain'), en), 'plain');
});

test('audit lists missing, ambiguous, unused and repeated attachments before import', () => {
    const data = {
        name: 'inspection.csv', columns: ['audio_file', 'score', 'group'],
        rows: [
            { audio_file: '正常/設備A/001.wav', score: '0.1', group: 'A' },
            { audio_file: '正常/設備A/001.wav', score: '0.2', group: 'A' },
            { audio_file: '001.wav', score: '0.3', group: 'B' },
            { audio_file: 'missing.wav', score: '0.4', group: 'B' },
        ],
    };
    const files = new Map([['正常/設備A/001.wav', file('001.wav')], ['要確認/設備B/001.wav', file('001.wav')], ['未使用/other.wav', file('other.wav')]]);
    const audit = auditAudioMatches(data, '', 'audio_file', files);
    assert.equal(audit.matched, 2);
    assert.deepEqual(audit.missing.map(({ row }) => row), [4]);
    assert.deepEqual(audit.ambiguous.map(({ row }) => row), [3]);
    assert.deepEqual(audit.unused, ['要確認/設備B/001.wav', '未使用/other.wav']);
    assert.deepEqual(audit.repeated, [{ key: '正常/設備A/001.wav', rows: [1, 2] }]);
});

test('a CSV is read as asd-insight reads it: strict numbers, one numeric column needed, column counts checked', () => {
    assert.equal(finiteNumber('1.2e-3'), 0.0012);
    for (const text of ['1,000', '0x10', 'Inf', 'NaN', '']) assert.equal(finiteNumber(text), null);
    assert.throws(() => parseCSV('name,label\na,b'), /数値として読める列がありません/);
    assert.throws(() => parseCSV('score,label\n1,OK,extra', 'bad.csv'), CSVColumnCountError);
    assert.throws(() => parseCSV('score,score\n1,2'), /同じ列名/);
    const tsv = parseCSV('\n\nscore\tlabel\n0.5\t"a\tb"\n');
    assert.deepEqual(tsv.columns, ['score', 'label']);
    assert.equal(tsv.rows[0].label, 'a\tb');
});

test('a picked CSV must be UTF-8, at most 20 MB, a .csv or .tsv', () => {
    assert.throws(() => readDatasetCsv(new Uint8Array([0x82, 0xa0, 0x2c, 0x31]), 'sjis.csv'), /UTF-8/);
    assert.throws(() => readDatasetCsv(bytes('score\n1'), 'data.txt'), /CSVまたはTSV/);
    assert.throws(() => readDatasetCsv(new Uint8Array(20 * 1024 ** 2 + 1), 'big.csv'), /20MB/);
    const csv = readDatasetCsv(bytes('\uFEFFaudio_file,line,score\nL1/a.wav,L1,0.2\n'), 'motor.csv');
    assert.deepEqual([csv.audioColumn, csv.idColumn, csv.attributes], ['audio_file', 'audio_file', ['line', 'score']]);
    assert.deepEqual(csv.numeric, { audio_file: false, line: false, score: true });
});

// ---- the Analyzer's dataset: rows per recording and channel

const ok = (channels: number, leq: number[]): ScanResult => ({
    ok: true, input: { id: 'x', fs: 48000, channels: Array.from({ length: channels }, (_, index) => index), durationS: 2, unit: 'FS', ref: 1 },
    leqDbA: leq, peakHz: leq.map(() => 1000), crest: leq.map(() => 3), thirdOctDb: leq.map(level => [level - 10, level - 20]), spectrumDb: [], specVersion: 5,
} as unknown as ScanResult);

test('rows are a recording and its channel; CSV attributes follow every channel, computed values are per channel', () => {
    const csv = readDatasetCsv(bytes('audio_file,line,score\nL1/a.wav,L1,0.2\nL2/b.wav,L2,0.9\nL2/b.wav,L2,0.1\nzzz.wav,L3,0.5\n'), 'm.csv');
    const files = ['/d/L1/a.wav', '/d/L2/b.wav', '/d/L2/c.wav'];
    const match = matchCsv(csv, files, '/d', en);
    assert.deepEqual([...match.attributes.keys()], ['/d/L1/a.wav', '/d/L2/b.wav']);
    // The first row for a recording wins; the rest are said why.
    assert.equal(match.attributes.get('/d/L2/b.wav')!.score, '0.9');
    assert.deepEqual(match.unmatched.map(item => [item.reason, item.row ?? item.filePath]), [['missing', 4], ['repeated', 3], ['no-row', '/d/L2/c.wav']]);
    const results = new Map([['/d/L1/a.wav', ok(1, [-30])], ['/d/L2/b.wav', ok(2, [-25, -40])]]);
    const rows = datasetRows(files, '/d', match.attributes, results);
    assert.deepEqual(rows.map(row => [row.key, row.ch, row.channels]), [['/d/L1/a.wav', 1, 1], ['/d/L2/b.wav#ch1', 1, 2], ['/d/L2/b.wav#ch2', 2, 2], ['/d/L2/c.wav', 1, undefined]]);
    assert.deepEqual(rows.map(row => row.folders), [['L1'], ['L2'], ['L2'], ['L2']]);
    const ch2 = rows[2];
    assert.equal(valueOf(ch2, 'csv:score', results), 0.9);
    assert.equal(valueOf(ch2, 'leq', results), -40);
    assert.equal(valueOf(ch2, 'band:1', results), -60);
    assert.equal(valueOf(rows[3], 'leq', results), null);
    // Filters: ch 2 only; a range on the score; the order by value, a missing value last.
    const view = (extra: object = {}) => visibleRows({ rows, group: 'csv:line', value: 'leq', filters: [], sort: { column: 'value', descending: true }, excluded: new Set(), ...extra }, results).map((row: DatasetRow) => row.key);
    assert.deepEqual(view(), ['/d/L2/b.wav#ch1', '/d/L1/a.wav', '/d/L2/b.wav#ch2', '/d/L2/c.wav']);
    assert.deepEqual(view({ filters: [{ column: 'ch', kind: 'values', values: ['2'] }] }), ['/d/L2/b.wav#ch2']);
    assert.deepEqual(view({ filters: [{ column: 'csv:score', kind: 'range', low: 0.5, high: 1 }] }), ['/d/L2/b.wav#ch1', '/d/L2/b.wav#ch2']);
    assert.deepEqual(view({ excluded: new Set(['/d/L1/a.wav']), sort: { column: 'name', descending: false } }), ['/d/L2/b.wav#ch1', '/d/L2/b.wav#ch2', '/d/L2/c.wav']);
    assert.deepEqual(columnValues(rows, 'csv:line', results), [['', 1], ['L1', 1], ['L2', 2]]);
});

test('rows sort by name in natural order, also after the folder changes and through a filter', () => {
    const byName = (paths: string[], extra: object = {}): string[] => visibleRows({ rows: datasetRows(paths, '/d', new Map(), new Map()), group: 'none', value: 'leq', filters: [], sort: { column: 'name', descending: false }, excluded: new Set(), ...extra }, new Map()).map((row: DatasetRow) => row.name);
    assert.deepEqual(byName(['/d/run10.wav', '/d/Run2.wav', '/d/run9.wav', '/d/run1.wav']), ['run1.wav', 'Run2.wav', 'run9.wav', 'run10.wav']);
    // Another folder: its own names, in their own order.
    assert.deepEqual(byName(['/d/b100.wav', '/d/a.wav', '/d/b20.wav']), ['a.wav', 'b20.wav', 'b100.wav']);
    assert.deepEqual(byName(['/d/b100.wav', '/d/a.wav', '/d/b20.wav'], { excluded: new Set(['/d/a.wav']), sort: { column: 'name', descending: true } }), ['b100.wav', 'b20.wav']);
});

test('before anything is computed, the headers split a recording into its channels', () => {
    const rows = datasetRows(['/d/a.wav', '/d/b.wav'], '/d', new Map(), new Map(), new Map([['/d/a.wav', 2]]));
    assert.deepEqual(rows.map(row => [row.key, row.ch, row.channels]), [['/d/a.wav#ch1', 1, 2], ['/d/a.wav#ch2', 2, 2], ['/d/b.wav', 1, undefined]]);
});

test('a long name keeps its start and its end', () => {
    assert.equal(middleEllipsis('short.wav'), 'short.wav');
    const long = middleEllipsis('20261025_東工場_motorA_L2_1500rpm_0042.wav', 24);
    assert.equal(long.length, 24);
    assert.ok(long.endsWith('_0042.wav') && long.includes('…'));
});

test('a base group is the group\'s other recordings in the pool, of the compared channel; recordings without it are left out and counted', () => {
    const attributes = new Map([['/d/a.wav', { rpm: '900' }], ['/d/b.wav', { rpm: '900' }], ['/d/m.wav', { rpm: '900' }], ['/d/c.wav', { rpm: '1500' }]]);
    const rows = datasetRows(['/d/a.wav', '/d/b.wav', '/d/m.wav', '/d/c.wav'], '/d', attributes, new Map(), new Map([['/d/a.wav', 2], ['/d/b.wav', 2], ['/d/m.wav', 1], ['/d/c.wav', 2]]));
    assert.deepEqual(baseGroupMembers(rows, '/d/a.wav', 'csv:rpm', '900', 2), { paths: ['/d/b.wav'], fewerChannels: 1 });
    assert.deepEqual(baseGroupMembers(rows, '/d/a.wav', 'csv:rpm', '900', null), { paths: ['/d/b.wav', '/d/m.wav'], fewerChannels: 0 });
    // The pool is what the filters left: ch = 2 only leaves the mono recording out before any channel is asked for.
    const ch2 = rows.filter(row => row.ch === 2);
    assert.deepEqual(baseGroupMembers(ch2, '/d/a.wav', 'csv:rpm', '900', 2), { paths: ['/d/b.wav'], fewerChannels: 0 });
    assert.deepEqual(baseGroupMembers(rows, '/d/a.wav', 'none', '', 2).paths, ['/d/b.wav', '/d/c.wav']);
});

test('memos and exclusions go back as the picked CSV with two columns after: per channel when a recording has several', () => {
    const csv = readDatasetCsv(bytes('audio_file,line,score\nL1/a.wav,L1,0.2\nL2/b.wav,L2,0.9\nmissing.wav,L3,0.5\nL1/m.wav,L1,0.1\n'), 'm.csv');
    const files = ['/d/L1/a.wav', '/d/L2/b.wav', '/d/L1/m.wav'];
    const match = matchCsv(csv, files, '/d', en);
    const rows = datasetRows(files, '/d', match.attributes, new Map(), new Map([['/d/L1/a.wav', 2], ['/d/L2/b.wav', 2], ['/d/L1/m.wav', 1]]));
    const memo = new Map([['/d/L1/a.wav#ch2', 'rattle, 3 kHz'], ['/d/L1/m.wav', 'quiet']]);
    const excluded = new Set(['/d/L2/b.wav#ch1', '/d/L2/b.wav#ch2', '/d/L1/a.wav#ch1']);
    const text = annotatedCsv(csv, match, files, '/d', rows, memo, excluded);
    assert.ok(text.startsWith('\uFEFF'));
    assert.deepEqual(text.slice(1).trimEnd().split('\r\n'), [
        'audio_file,line,score,memo,excluded',
        'L1/a.wav,L1,0.2,"ch2: rattle, 3 kHz",ch1',
        'L2/b.wav,L2,0.9,,1',
        'missing.wav,L3,0.5,,',
        'L1/m.wav,L1,0.1,quiet,',
    ]);
    // Without a CSV: one row per recording, by its path below the folder.
    assert.deepEqual(annotatedCsv(null, null, files, '/d', rows, memo, excluded).slice(1).trimEnd().split('\r\n')[0], 'audio_file,memo,excluded');
});
