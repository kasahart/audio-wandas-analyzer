import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { scanAnswer } from '../webview/runtime/answerStore';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import type { Answer } from '../webview/runtime/answerTypes';
import { buildCompareModel, type LevelInput } from '../webview/runtime/comparePanes';
import { baseUsed, entryMeasure, reportCsv, reportLevelAxes } from '../webview/runtime/compareReport';
import { BAND_CENTERS_HZ, buildEntryModel, entryCsv } from '../webview/runtime/entryTable';
import {
    bandLevelColumns, baseLevelColumns, byLevelKey, calibrationWords, calibrationWordsBy, figureUsed, levelAxes, levelColumns, levelKeyOf, levelKeyOfReading, plainNames, plainRange, scanAxis, scanFigureOf,
    type FigureColumns, type FigureNames, type FigureRange, type FigureTitle,
} from '../webview/runtime/figureModel';
import { buildSpectrumCsv } from '../webview/runtime/runtimeExports';
import { paintOverlay } from '../webview/runtime/stagePanes';
import { ROWS } from './plotContracts';

interface Side { unit: string; ref: number; label: string; status: string }
const CASES = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'levelIdentityCases.json'), 'utf8')) as Array<{ why: string; a: Side; b: Side; same: boolean }>;
const input = (side: Side): LevelInput => ({ unit: side.unit, ref: side.ref, levelReferenceLabel: side.label, calibrationStatus: side.status as LevelInput['calibrationStatus'], fullScale: side.label === 'dBFS' });
const STR = getStrings('ja');
const BAND_3150 = BAND_CENTERS_HZ.indexOf(3150);

// ── Level identity and words ─────────────────────────────────────────────────────────────────────────────────────

test('lines share an axis by level identity alone: the grouping answers the table the backend answers, whatever their calibration status (R1, R4, A43)', () => {
    assert.ok(CASES.length >= 6);
    for (const item of CASES) {
        const groups = byLevelKey([item.a, item.b], side => levelKeyOf(input(side)));
        assert.equal(groups.length === 1, item.same, item.why);
        // A picture's own axis can only split lines further: never join two the identity keeps apart.
        assert.equal(levelKeyOf(input(item.a), 'x') === levelKeyOf(input(item.b), 'x'), item.same, item.why);
    }
    assert.notEqual(levelKeyOf(input(CASES[0].a), 'dB SPL re 20 µPa'), levelKeyOf(input(CASES[0].a), 'dB SPL re 1 Pa'));
});

test('an uncalibrated line says so only where it shares an axis with a calibrated one (R1, R4, A49)', () => {
    const spl = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa' };
    const lines = [{ name: 'cal', level: spl, calibrated: true }, { name: 'raw', level: spl, calibrated: false }, { name: 'fs', level: { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS' }, calibrated: false }];
    const word = calibrationWordsBy(lines, line => levelKeyOf(line.level), line => line.calibrated, ' (uncal)');
    assert.deepEqual(lines.map(word), ['', ' (uncal)', '']);
    const tracks = lines.map((line): { filePath: string; input: LevelInput } => ({ filePath: line.name, input: { ...line.level, calibrationStatus: line.calibrated ? 'calibrated' : 'uncalibrated', fullScale: false } }));
    const said = calibrationWords({ axisUncalibrated: ' (uncal)' }, tracks, ['cal', 'raw', 'fs', 'unknown']);
    assert.deepEqual(['cal', 'raw', 'fs', 'unknown'].map(said), ['', ' (uncal)', '', '']);
});

test('spectrograms share a colour scale only of one reference unit and value and one axis as drawn (R1)', () => {
    const spl = { unit: 'dB SPL', axisLabel: 'STFT amplitude level [dB SPL re 20 µPa]', referenceUnit: 'Pa', referenceValue: 2e-5 };
    assert.equal(levelKeyOfReading(spl), levelKeyOfReading({ ...spl }));
    assert.notEqual(levelKeyOfReading(spl), levelKeyOfReading({ ...spl, referenceValue: 1 }));
    assert.notEqual(levelKeyOfReading(spl), levelKeyOfReading({ ...spl, referenceUnit: 'V' }));
    assert.notEqual(levelKeyOfReading(spl), levelKeyOfReading({ ...spl, unit: 'dBFS', axisLabel: 'STFT amplitude level [dBFS]' }));
});

// ── Axes: one identity each ──────────────────────────────────────────────────────────────────────────────────────

/** Why an axis set breaks the rule (two identities on one axis, or one identity on two), or null. */
function axisProblem<L>(axes: ReadonlyArray<{ lines: L[] }>, inputOf: (line: L) => LevelInput | undefined): string | null {
    const keys = axes.map(axis => new Set(axis.lines.map(line => levelKeyOf(inputOf(line)))));
    const mixed = keys.findIndex(set => set.size > 1);
    if (mixed >= 0) return `axis ${mixed} holds ${keys[mixed].size} level identities`;
    const flat = keys.flatMap(set => [...set]);
    return flat.length === new Set(flat).size ? null : 'one identity is on two axes';
}

test('a figure has one level axis per identity: never two identities on one axis, at most two axes, the first line\'s on the left (R1, C1)', () => {
    const spec = { inputOf: (side: Side) => input(side), names: () => plainNames('x', 'y'), range: () => plainRange(0, 1) };
    for (const item of CASES) {
        const { axes, tooMany } = levelAxes([item.a, item.b], { ...spec, first: item.b });
        assert.equal(tooMany, false, item.why);
        assert.equal(axes.length, item.same ? 1 : 2, item.why);
        assert.equal(axisProblem(axes, spec.inputOf), null, item.why);
        assert.ok(axes[0].lines.includes(item.b), `${item.why}: the first line's axis is the left one`);
    }
    const three = [CASES[2].a, CASES[2].b, CASES[4].a];
    assert.equal(levelAxes(three, spec).tooMany, true, 'three identities are not overlaid');
    // The injected bug: a key that ignores the identity puts two references on one axis, and the check says so.
    const broken = levelAxes([CASES[2].a, CASES[2].b], { ...spec, keyOf: () => 'one' });
    assert.match(axisProblem(broken.axes, spec.inputOf) ?? '', /holds 2 level identities/u);
});

// ── Which files are counted ──────────────────────────────────────────────────────────────────────────────────────

function scan(leq: number, level: Partial<LevelInput> & { fs?: number } = {}): ScanResult {
    return {
        ok: true, conditionId: 'c', specVersion: 2, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: 16000, channels: [0], durationS: 2, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true, ...level },
        leqDbA: [leq], peakHz: [100], spectrumDb: [[-40, -50]], thirdOctDb: [BAND_CENTERS_HZ.map((_, index) => (index === BAND_3150 ? leq - 10 : -60))], crest: [1.4],
    };
}
const SPL = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false } as const;
const FAILED = { ok: false, error: 'failed' } as unknown as ScanResult;

test('a figure counts only its ready answers of its identity and axis: pending, stale, failed, another reference\'s and another axis\'s are excluded with why (layers-design)', () => {
    const stale = scanAnswer('/old.wav', scan(-19));
    const answers: Array<Answer<ScanResult & { ok: true }>> = [
        scanAnswer('/a.wav', scan(-20)), scanAnswer('/b.wav', scan(-21)), scanAnswer('/p.wav', undefined), scanAnswer('/x.wav', FAILED), scanAnswer('/s.wav', scan(60, SPL)),
        stale.state === 'ready' ? { state: 'stale', value: stale.value, identity: stale.identity } : stale,
        scanAnswer('/fs44.wav', scan(-20, { fs: 44100 })),
    ];
    const used = figureUsed(answers, scanFigureOf(scan(0)));
    assert.deepEqual(used.paths, ['/a.wav', '/b.wav']);
    assert.equal(used.n, 2);
    assert.deepEqual(used.excluded, [
        { path: '/p.wav', reason: 'pending' }, { path: '/x.wav', reason: 'failed' }, { path: '/s.wav', reason: 'other-reference' },
        { path: '/old.wav', reason: 'stale' }, { path: '/fs44.wav', reason: 'other-axis' },
    ]);
    // Of another compared reference, the other files are the other reference.
    assert.deepEqual(figureUsed(answers, scanFigureOf(scan(60, SPL))).paths, ['/s.wav']);
    // No compared answer: the first ready one's identity and axis.
    assert.deepEqual(figureUsed(answers, { level: null, axisOf: scanAxis }).paths, ['/a.wav', '/b.wav']);
    // The injected bug: counting the answers asked for (pending and stale ones too) is not the figure's n.
    assert.notEqual(answers.length, used.n);
});

// ── Every output, mixed references, pending and failed files ─────────────────────────────────────────────────────

/** A CSV's columns, split as the writers quote them. */
const csvColumns = (line: string): string[] => (line.match(/("([^"]|"")*"|[^,]*)(,|$)/gu) ?? []).map(cell => cell.replace(/,$/u, '').replace(/^"|"$/gu, '').replace(/""/gu, '"')).slice(0, -1);

/** Why a CSV header has a level column without the column that says its reference beside it, or null. */
function csvHeaderProblem(header: string[], columns: FigureColumns): string | null {
    const level = header.indexOf(columns.level);
    if (level < 0) return `no ${columns.level} column`;
    return header[level + 1] === columns.reference ? null : `${columns.level} has no ${columns.reference} column beside it`;
}

test('every figure and every file written of a base group with another reference\'s, pending, failed and stale recordings: one set everywhere, one identity per axis, each row its own reference (R1, R4, C5)', () => {
    const results = new Map<string, ScanResult>([
        ['/f/a.wav', scan(-20)], ['/f/b.wav', scan(-22)], ['/f/x.wav', FAILED], ['/f/spl.wav', scan(60, SPL)], ['/f/spl2.wav', scan(62, SPL)], ['/f/spl3.wav', scan(58, SPL)],
    ]);
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    // The compared dB SPL file against a group of dBFS, dB SPL, still computing (/p.wav) and failed (/x.wav) recordings.
    const group = { paths: ['/f/a.wav', '/f/b.wav', '/f/spl2.wav', '/f/spl3.wav', '/f/p.wav', '/f/x.wav'], title: '基準群' };
    const comparison = buildCompareModel(model, results, '/f/spl.wav', null, STR, false, undefined, group);
    // The set: the measured recordings of the compared one's reference only; the median, its files and n are of it.
    const used = baseUsed(comparison, results);
    assert.deepEqual(used.paths, ['/f/spl2.wav', '/f/spl3.wav']);
    assert.deepEqual(comparison.base?.filePaths, used.paths);
    assert.equal(comparison.base?.leq, 60);
    assert.equal(comparison.blocked, undefined);
    // 報告.csv: the row's reference and the base's, n and files of the same set.
    const report = reportCsv({ model, results, slots: [null, '/f/spl.wav', null, null], compare: () => comparison, region: null, recipe: null, recipeName: 'r', now: new Date(), stale: new Set<string>() }, STR);
    const [reportHeader, row] = report.slice(1).trimEnd().split('\r\n').map(csvColumns);
    assert.equal(csvHeaderProblem(reportHeader, levelColumns(STR)), null);
    assert.equal(csvHeaderProblem(reportHeader, baseLevelColumns(STR)), null);
    const cell = (name: string): string => row[reportHeader.indexOf(name)];
    assert.equal(cell(STR.reportLevelReference), 'dB SPL re 20 µPa');
    assert.equal(cell(STR.reportBaseLevelReference), 'dB SPL re 20 µPa');
    assert.equal(cell(STR.entryCsvGroupSize), '2');
    assert.equal(cell(STR.reportGroupFiles), 'spl2.wav;spl3.wav');
    // The entry CSV's n is the same set's, and nothing when the Δ is withheld (a file as its own base).
    assert.equal(entryMeasure(comparison, BAND_3150, results)?.count, 2);
    const self = buildCompareModel(model, results, '/f/a.wav', '/f/a.wav', STR);
    assert.equal(self.blocked, 'self');
    assert.equal(entryMeasure(self, BAND_3150, results)?.count, 0);
    // A group all of another reference: no median, no n, the Δ withheld as of another reference.
    const other = buildCompareModel(model, results, '/f/spl.wav', null, STR, false, undefined, { paths: ['/f/a.wav', '/f/b.wav'], title: 'g' });
    assert.equal(other.base, null);
    assert.equal(other.blocked, 'unit');
    // Report PNG of a slot-0 file of another reference: two axes, each named with its own reference.
    const pair = buildCompareModel(model, results, '/f/spl.wav', '/f/a.wav', STR);
    const axes = reportLevelAxes(pair, { results }, STR);
    assert.ok(axes.right, 'two references, two axes');
    for (const title of [axes.left, axes.right ?? '']) assert.match(title, /\[(dBFS|dB SPL re 20 µPa)\]$/u, title);
    assert.equal(baseUsed(pair, results).n, 0, 'a withheld Δ has no base n');
    // Screen: the same rule (levelAxes) over the lines of the pair.
    const lines = ['/f/a.wav', '/f/b.wav', '/f/spl.wav'].map(file => ({ file, input: results.get(file)?.input }));
    const screen = levelAxes(lines, { inputOf: line => line.input, names: () => plainNames('x', 'y'), range: () => plainRange(0, 1) });
    assert.equal(axisProblem(screen.axes, line => line.input), null);
    assert.equal(screen.axes.length, 2);
    // entry-table.csv: every level column (Leq and the band's) with its row's reference beside it.
    const columns = levelColumns(STR), band = bandLevelColumns(STR, '3.15 kHz');
    const labels = { file: 'File', condition: (n: number) => `c${n}`, regionStart: 's', regionEnd: 'e', level: columns, peak: STR.entryColPeak, bandLevel: band, deltaLeq: 'dl', deltaBand: 'db', groupSize: 'n', status: 'st' };
    const [entryHeader, ...rows] = entryCsv(model, labels, () => null).slice(1).trimEnd().split('\r\n').map(csvColumns);
    for (const pairOf of [columns, band]) assert.equal(csvHeaderProblem(entryHeader, pairOf), null);
    const reference = entryHeader.indexOf(columns.reference), bandReference = entryHeader.indexOf(band.reference);
    const spl = rows.find(cells => cells[0] === 'spl.wav') ?? [];
    assert.deepEqual([spl[reference], spl[bandReference]], ['dB SPL re 20 µPa', 'dB SPL re 20 µPa']);
    // A row of another reference than the table's is ≠ and says what differs: its unit (FS), not a level in the table's.
    assert.match(rows.find(cells => cells[0] === 'a.wav')?.at(-1) ?? '', /^≠ FS$/u);
    // No column outside the figure model's is a level in bare dB: each header ending in dB is a Δ.
    for (const name of entryHeader.filter(header => /dB$/u.test(header))) assert.match(name, /Δ/u, name);
    // The spectrum CSV: every level column named with its reference, as its axis is.
    const title = (text: string) => axes.left.replace(/\[[^\]]*\]$/u, `[${text}]`) as FigureTitle;
    const spectrum = buildSpectrumCsv([{ name: 'a', slice: { values: [-1], frequencyBins: 1, maxFrequencyHz: 1, minDb: -1, maxDb: 0 }, levelTitle: title('dBFS') }, { name: 's', slice: { values: [60], frequencyBins: 1, maxFrequencyHz: 1, minDb: 0, maxDb: 60 }, levelTitle: title('dB SPL re 20 µPa') }], 'Hz' as FigureTitle);
    for (const column of csvColumns(spectrum.split('\n')[0]).filter((_, index) => index % 2 === 1)) assert.match(column, /\[(dBFS|dB SPL re 20 µPa)\]$/u, column);
    // The injected bugs: a header without the reference column, and another reference counted in n, are caught.
    assert.match(csvHeaderProblem(entryHeader.filter(name => name !== band.reference), band) ?? '', /no .* column beside it/u);
    assert.notDeepEqual(figureUsed(group.paths.map(path => scanAnswer(path, results.get(path))), { level: null }).paths, used.paths, 'counting without the compared identity is caught');
});

test('paintOverlay and the CSV writers take only the figure model\'s names, ranges, titles and columns', () => {
    // Compile-time: each line below would type-check only if the brands were gone (tsc fails on an unused expect-error).
    const never = (): void => {
        const canvas = {} as HTMLCanvasElement;
        // @ts-expect-error a range made outside the figure model
        paintOverlay(canvas, { layers: [] }, { min: 0, max: 1 }, plainNames('x', 'y'));
        // @ts-expect-error names made outside the figure model
        paintOverlay(canvas, { layers: [] }, plainRange(0, 1), { x: 'x', y: 'y' });
        // @ts-expect-error a level title made outside the figure model
        buildSpectrumCsv([{ name: 'a', slice: { values: [], frequencyBins: 0, maxFrequencyHz: 1, minDb: 0, maxDb: 1 }, levelTitle: 'Level [dB]' }], 'Hz' as FigureTitle);
        // @ts-expect-error a figure's count without the figure's identity
        figureUsed([]);
        // @ts-expect-error CSV level columns made outside the figure model
        entryCsv(buildEntryModel([], null), { file: '', condition: String, regionStart: '', regionEnd: '', level: { level: 'Leq', reference: '', uncalibrated: '' }, peak: '', bandLevel: bandLevelColumns(STR, ''), deltaLeq: '', deltaBand: '', groupSize: '', status: '' }, () => null);
    };
    assert.equal(typeof never, 'function');
    const names: FigureNames = plainNames('x', 'y'), range: FigureRange = plainRange(0, 1);
    assert.deepEqual([names.x, range.max], ['x', 1]);
});

// ── The contract table points at the layer ───────────────────────────────────────────────────────────────────────

/**
 * Rows of an axis, a range or a count of files that are not a figure's level axis, range or n, with why. Every other
 * axis, range and count row of every chart says it is computed in figureModel.ts. Exact: it only shrinks.
 */
const NOT_FIGURE_ROWS: Readonly<Record<string, string>> = {
    'trigger-lanes.count': 'a count of events of one recording, not of files',
    'track-waveform.range-popover': 'the user\'s own typed range',
    'track-axes.axis': 'the time ruler: no level',
    'entry-distribution.count': 'a histogram\'s bin counts of the measured files (binCounts)',
    'entry-table.count': 'the table head\'s counts of files in the folder and the filters, not a figure\'s n',
};

test('every chart\'s level axis, range and file count row says it is computed in figureModel.ts (layers-design)', () => {
    const rows = ROWS.filter(row => row.value === 'axis' || row.value === 'range' || row.value === 'count');
    assert.ok(rows.length >= 30, String(rows.length));
    const outside = rows.filter(row => !row.computedIn.some(where => where.startsWith('src/webview/runtime/figureModel.ts:'))).map(row => row.id).sort();
    const exempt = Object.keys(NOT_FIGURE_ROWS).filter(id => !outside.includes(id));
    assert.deepEqual(outside.filter(id => !NOT_FIGURE_ROWS[id]), [], 'these rows name no figureModel.ts function');
    assert.deepEqual(exempt, [], 'NOT_FIGURE_ROWS lists a row that is gone or now names figureModel.ts: take it off');
    for (const [id, why] of Object.entries(NOT_FIGURE_ROWS)) assert.ok(why.trim(), id);
});

// ── Structure: nothing outside the layer makes a figure's names, ranges, identities or counts ────────────────────

const PATTERNS: Readonly<Record<string, RegExp>> = {
    /** An axis's name built from the UI strings of a level, a gain, a Δ or the calibration word: read off any object, or destructured. */
    'axis-name': /(?<![\w'"])\.?axis(?:Level\w*|Uncalibrated|Gain|TransferLevel|Delta)\b(?!['":?])/gu,
    /** A level named in bare dB by a template ("${band} dB"), not a Δ. */
    'bare-db': /`(?![^`]*Δ)[^`]*\$\{[^}]+\} dB`/gu,
    /** The axis builders and the calibration words, called. */
    'axis-builder': /\b(?:paneAxes|stageAxes|calibrationWords)\(/gu,
    /**
     * Lines or files keyed by level identity by hand: levelIdentityOf and the old per-file rules, a key of unit and
     * reference, units or references compared, and axis names or level labels compared as text.
     */
    'identity': /\b(?:levelIdentityOf|levelIdentity|ofOneUnit|oneLevelIdentity)\(|JSON\.stringify\(\[[^\]\n]*\.unit\b[^\]\n]*\.ref\b|\.(?:unit|ref)\s*[!=]==\s*[\w.?]+\.(?:unit|ref)\b|\.(?:axisLabel|levelReferenceLabel)\s*[!=]==/gu,
    /** A line read on the first track's reference rather than its own recording's. */
    'first-track-input': /tracks\[0\]\??\.input/gu,
    /** An axis named calibrated only when every one is: the rule is any (axisInputOf), each uncalibrated one saying so. */
    'every-calibrated': /\.every\([^\n]*?calibrat/gu,
    /** An absolute level written in wandas' levelUnit (bare "dB" for every reference but FS and SPL), not its reference's name. */
    'bare-level-unit': /(?<!levelReferenceLabel[^\n]*)measurement\??\.levelUnit\b/gu,
    /** A level named "[dB]" in a UI string: only a gain and a Δ are in plain dB. */
    'bracket-db': /:\s*'[^'\n]*\[dB\]'/gu,
    /** A page's calibration note taken from the table's rows, which a ≠ row leaves without one, not the recordings' scans. */
    'table-calibration': /model\.rows[^\n]*\.uncalibrated/gu,
    /** Results over a region mixed with the whole files' (a base recording measured over the other). */
    'mixed-results': /new Map\(\[\.\.\.[\w.]*results, \.\.\.measured\]\)/gu,
    /** R9's range rules, called. */
    'range-rule': /\b(?:niceRange|stageRange|stageDiffRange|heatmapDbRange)\(/gu,
    /** A figure's n, a heading's count or a CSV's 基準群 n written from the files asked for, not the figure's set. */
    'file-count': /(?:String\(|count:\s*|eachBaseTitle\([^,\n]+,\s*)[\w.?]*(?:filePaths|basePaths|allBase|paths|members|sides)\??\.length\b|\.filter\([^\n]*?\.ok\b\)\.length\b/gu,
    /** A CSV level column or reference column named outside the layer. */
    'csv-column': /\b(?:STR|strings)\.(?:reportLevelReference|reportBaseLevelReference|reportBaseLeq|entryColBandLevel)\b/gu,
};

/**
 * The sites outside figureModel.ts that may match, with their counts: the definitions the layer wraps, and counts
 * that are not a figure's n. Exact: a new site fails, and so does one removed until it is taken off. Only shrinks.
 */
const ALLOWED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    // A calibration profile's own equality (its channels' factors and units): which profile applies, not a level identity.
    'shared/analysis/calibrationModel.ts': { 'identity': 1 },
    // A gain (one unit's ratio) and a Δ are plain dB: 'Gain [dB]', 'Difference Δ [dB]' in each language.
    'shared/i18n/strings.ts': { 'bracket-db': 4 },
    // R9's rule and its rounding, defined (figureModel.ts roundedRange / heatmapRange wrap them).
    'shared/utils/ticks.ts': { 'range-rule': 1 },
    // A histogram's bins, rounded by the same rule: entry-distribution's range is figureModel.ts:plainRange of it.
    'shared/dataset/distribution.ts': { 'range-rule': 1 },
    // A signed difference's text ("+1.2 dB"): a Δ, not a level.
    'webview/plot/plotText.ts': { 'bare-db': 1 },
    // The waveform's range, defined (a lane's amplitude range is figureModel.ts:laneAmplitudeRange).
    'webview/plot/waveformLayer.ts': { 'range-rule': 1 },
    // paneAxes and levelIdentityOf, defined (figureModel.ts paneNames and levelKeyOf wrap them); the Δ headline's
    // signed "Leq +1.2 dB" (a Δ); a recording's channels read together are calibrated only when every one is;
    // binsOf's check that every read file's bins arrived (an alignment test, not a shown count).
    'webview/runtime/comparePanes.ts': { 'axis-name': 4, 'bare-db': 2, 'identity': 1, 'every-calibrated': 1, 'file-count': 1 },
    // "Δ max band dB" (a Δ); a median line's own status (uncalibrated while any of its recordings is); a fixed Δ's
    // base: the files it was measured from, kept as baseUsed gave them when it was fixed.
    'webview/runtime/compareReport.ts': { 'bare-db': 1, 'every-calibrated': 1, 'file-count': 1 },
    // The CSV match's "{matched} of {total}" files (the folder's count) and the test snapshot's scanned count.
    'webview/runtime/entryRuntime.ts': { 'file-count': 3 },
    // "Δ max band dB" (a Δ); which part of a ≠ row's identity differs, said once figureModel.scanLevelKey found it differs.
    'webview/runtime/entryTable.ts': { 'bare-db': 1, 'identity': 1 },
    // stageAxes and stageRange / stageDiffRange, defined (figureModel.ts stageNames, dataRange, diffRange wrap them).
    'webview/runtime/stagePanes.ts': { 'axis-builder': 2, 'axis-name': 8, 'range-rule': 3 },
    // The gate's "analyse the base group's n recordings": how many would be scanned, not a figure's n.
    'webview/runtime/trackStageMode.ts': { 'file-count': 2 },
    // A figure's names with no line to take them from (nothing drawn, too many references): the first track's input.
    'webview/runtime/trackStagePainter.ts': { 'first-track-input': 6 },
};

/** Each file's matches of each pattern, a definition (`function name(`) not counted. */
function figureSites(files: ReadonlyArray<{ rel: string; source: string }>): Record<string, Record<string, number>> {
    const sites: Record<string, Record<string, number>> = {};
    for (const { rel, source } of files) {
        if (rel === 'webview/runtime/figureModel.ts') continue;
        // Comments say what the code does; only the code is looked at.
        const code = source.replace(/^\s*(?:\/\/|\/?\*).*$/gmu, '');
        for (const [name, pattern] of Object.entries(PATTERNS)) {
            const count = [...code.matchAll(pattern)].filter(match => !/function\s*$/u.test(code.slice(Math.max(0, match.index - 9), match.index))).length;
            if (count) (sites[rel] ??= {})[name] = count;
        }
    }
    return sites;
}

const srcRoot = path.join(__dirname, '..', '..', 'src');
function sources(): Array<{ rel: string; source: string }> {
    const files: Array<{ rel: string; source: string }> = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) { if (name !== 'test' && name !== 'generated' && name !== 'e2e') walk(full); } else if (name.endsWith('.ts')) files.push({ rel: path.relative(srcRoot, full).split(path.sep).join('/'), source: readFileSync(full, 'utf8') });
        }
    };
    walk(srcRoot);
    return files;
}

test('outside figureModel.ts nothing builds an axis name, calls an axis builder, keys by level identity, applies a range rule or counts files for n, but the exact list (layers-design)', () => {
    const files = sources();
    assert.ok(files.length > 100, String(files.length));
    assert.deepEqual(figureSites(files), ALLOWED);
});

test('the structural check fails on each injected bug: every violation of class sweep 1 (reference, aggregation) and the first ones (an axis name, pending in n, two identities on one axis, a CSV header without its reference)', () => {
    const files = sources();
    const inject = (rel: string, code: string) => figureSites(files.map(file => (file.rel === rel ? { rel, source: `${file.source}\n${code}\n` } : file)));
    const injected: Array<[string, string, string]> = [
        ['webview/runtime/trackStagePainter.ts', 'const y = `${STR.axisLevelCal} [dB]`;', 'axis-name'],
        ['webview/runtime/trackStagePainter.ts', 'const y = s.axisLevelCal;', 'axis-name'],
        ['webview/runtime/trackStagePainter.ts', 'const { axisUncalibrated } = strings;', 'axis-name'],
        // V1: a line without a recording read on the first track's reference.
        ['webview/runtime/trackStagePainter.ts', 'const inputOf = (layer: StageLayer) => tracks[0]?.input;', 'first-track-input'],
        // A1, A3, A7: a base group chosen by hand, of another reference or with pending files kept.
        ['webview/runtime/entryBase.ts', 'const paths = ofOneUnit(results, members.paths, path => path, like);', 'identity'],
        ['webview/runtime/triggerLanes.ts', 'const key = (track: StageTrack) => levelIdentityOf(track.input);', 'identity'],
        // V9, B2: rows compared by a key of unit and reference of their own.
        ['webview/runtime/entryTable.ts', 'const key = JSON.stringify([input.channels.length, input.unit, input.ref]);', 'identity'],
        // V8: lines put on an axis by the text of their axis name.
        ['webview/runtime/pairSpectrum.ts', 'const drawn = ok.filter(curve => curve.response.axisLabel === axisLabel);', 'identity'],
        // Pending counted in n; A10: a heading's count of every recording asked for; a count of ok answers by hand.
        ['webview/runtime/entryBase.ts', 'const definition = { count: basePaths.length };', 'file-count'],
        ['webview/runtime/trackStageMode.ts', 'const title = eachBaseTitle(base, allBase.length, strings);', 'file-count'],
        ['webview/runtime/entryBase.ts', 'const measured = paths.filter(path => results.get(path)?.ok).length;', 'file-count'],
        // V3: a level CSV column in bare dB.
        ['webview/runtime/entryRuntime.ts', 'const band = `${bandLabel(model.band)} dB`;', 'bare-db'],
        ['webview/runtime/entryRuntime.ts', 'const header = [strings.entryColLeq, strings.reportBaseLeq];', 'csv-column'],
        // V5: an axis named uncalibrated while any recording on it is.
        ['webview/runtime/entrySidePlots.ts', 'const calibrated = files.every(path => !!scanned.get(path)?.calibrated);', 'every-calibrated'],
        // V6: the page's calibration note from the table's rows.
        ['webview/runtime/compareReport.ts', 'const uncalibrated = new Set(input.model.rows.map(row => row.uncalibrated));', 'table-calibration'],
        // V7: a level written in wandas' bare levelUnit.
        ['shared/report/analysisReport.ts', 'const text = formatReportDb(value, measurement.levelUnit);', 'bare-level-unit'],
        // V11: a UI string naming a level "[dB]".
        ['shared/i18n/strings.ts', "const preset = { presetLevelGraph: 'A-weighted RMS level [dB]' };", 'bracket-db'],
        // A4, A5: a region's results mixed with the whole files'.
        ['webview/runtime/comparisonRuntime.ts', 'const results = new Map([...data.results, ...measured]);', 'mixed-results'],
        ['webview/runtime/pairSpectrum.ts', 'const range = stageRange([view]);', 'range-rule'],
    ];
    for (const [rel, code, pattern] of injected) {
        const sites = inject(rel, code);
        assert.notDeepEqual(sites, ALLOWED, `${rel}: ${code}`);
        assert.ok((sites[rel]?.[pattern] ?? 0) > (ALLOWED[rel]?.[pattern] ?? 0), `${rel}: ${pattern}`);
    }
});

/**
 * The class closed (A43, A49): nothing outside the layer keys lines by a label, an axis title or a unit string; every
 * file that builds a second level axis or a range per group takes its groups from figureModel.ts.
 */
test('every place that groups lines onto a level axis, range or colour scale goes through figureModel (A43, A49, R1, R4)', () => {
    const LABEL = '(?:levelReferenceLabel|axisLabel|spectrumLevelReference|shownLevelOf|levelUnit|referenceUnit|levelLabel)';
    const keyedByLabel = new RegExp(`\\.(?:get|set|has)\\(\\s*[^,()\\n]*\\b${LABEL}\\b|new (?:Set|Map)\\([^\\n]*\\b${LABEL}\\b|statuses\\.(?:get|set)\\(`, 'u');
    const buildsSecondary = /secondary:\s*\{\s*layers:/u;
    const rangesPerGroup = /new Map<string,\s*PaneRange>/u;
    const grouped = /from '\.\/figureModel'/u;
    const problems: string[] = [];
    let builders = 0;
    for (const { rel, source } of sources()) {
        if (rel !== 'webview/runtime/figureModel.ts' && keyedByLabel.test(source)) problems.push(`${rel}: keys levels by a label or unit (${keyedByLabel.exec(source)?.[0]})`);
        if (buildsSecondary.test(source) || rangesPerGroup.test(source)) {
            builders++;
            if (!grouped.test(source)) problems.push(`${rel}: builds a level axis per group without figureModel`);
        }
    }
    assert.ok(builders >= 1, `the second-axis and per-group range builders are walked (${builders})`);
    assert.deepEqual(problems, []);
});
