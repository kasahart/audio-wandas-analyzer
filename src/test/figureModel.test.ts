import assert from 'node:assert/strict';
import { compareOf } from './helpers/compareInput';
import { P } from './helpers/figure';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { scanAnswer } from '../webview/runtime/answerStore';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import type { Answer } from '../webview/runtime/answerTypes';
import type { LevelInput } from '../webview/runtime/comparePanes';
import { baseUsed, entryMeasure, reportCsv, reportLevelAxes } from '../webview/runtime/compareReport';
import { BAND_CENTERS_HZ, buildEntryModel, entryCsv } from '../webview/runtime/entryTable';
import {
    bandLevelColumns, baseLevelColumns, byLevelKey, calibrationWords, calibrationWordsBy, figureUsed, levelAxes, levelColumns, levelKeyOf, levelKeyOfReading, plainNames, plainRange, scanIdentity,
    type FigureColumns, type FigureNames, type FigureRange, type FigureTitle,
} from '../webview/runtime/figureModel';
import { buildSpectrumCsv } from '../webview/runtime/runtimeExports';
import { csvRecords } from '../shared/utils/csv';
import { paintOverlay } from '../webview/runtime/stagePanes';
import { fileSites, functionSites, rowsOutsideFigureModel, siteProblems, sources, typed, type Sites } from './figureSites';
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
    const spec = { inputOf: (side: Side) => input(side), names: () => plainNames(P('x'), P('y')), range: () => plainRange(0, 1) };
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

test('a figure counts only its ready answers of its identity and axis: pending, stale, failed, another reference\'s and another axis\'s are excluded with why (docs/plot-layers.md)', () => {
    const stale = scanAnswer('/old.wav', scan(-19));
    const answers: Array<Answer<ScanResult & { ok: true }>> = [
        scanAnswer('/a.wav', scan(-20)), scanAnswer('/b.wav', scan(-21)), scanAnswer('/p.wav', undefined), scanAnswer('/x.wav', FAILED), scanAnswer('/s.wav', scan(60, SPL)),
        stale.state === 'ready' ? { state: 'stale', value: stale.value, identity: stale.identity } : stale,
        scanAnswer('/fs44.wav', scan(-20, { fs: 44100 })),
    ];
    const used = figureUsed(scanIdentity(scanAnswer('/c.wav', scan(0))), answers);
    assert.deepEqual(used.paths, ['/a.wav', '/b.wav']);
    assert.equal(used.n, 2);
    assert.deepEqual(used.excluded, [
        { path: '/p.wav', reason: 'pending' }, { path: '/x.wav', reason: 'failed' }, { path: '/s.wav', reason: 'other-reference' },
        { path: '/old.wav', reason: 'stale' }, { path: '/fs44.wav', reason: 'other-axis' },
    ]);
    // Of another compared reference, the other files are the other reference.
    assert.deepEqual(figureUsed(scanIdentity(scanAnswer('/c.wav', scan(60, SPL))), answers).paths, ['/s.wav']);
    // No compared answer: no identity, so nothing is counted (never "the first ready one's"); each ready one waits for it.
    const none = figureUsed(scanIdentity(undefined), answers);
    assert.equal(none.n, 0);
    assert.deepEqual(none.excluded.filter(item => item.reason === 'no-identity').map(item => item.path), ['/a.wav', '/b.wav', '/s.wav', '/fs44.wav']);
    // A compared file still pending has no identity either.
    assert.equal(figureUsed(scanIdentity(scanAnswer('/c.wav', undefined)), answers).n, 0);
    // The injected bug: counting the answers asked for (pending and stale ones too) is not the figure's n.
    assert.notEqual(answers.length, used.n);
});

// ── Every output, mixed references, pending and failed files ─────────────────────────────────────────────────────

/** Why a CSV header has a level column without the column that says its reference beside it, or null. */
function csvHeaderProblem(header: string[], columns: FigureColumns): string | null {
    const level = header.indexOf(columns.level);
    if (level < 0) return `no ${columns.level} column`;
    // An absolute level's column never says a bare dB, dB(A) or a reference of its own: its rows' references are beside it.
    const bare = header.find(name => !/Δ/u.test(name) && /\bdB\b(?:\(A\))?(?!\s*re\b|FS|\s*SPL)/u.test(name));
    if (bare) return `${bare} names an absolute level in bare dB`;
    return header[level + 1] === columns.reference ? null : `${columns.level} has no ${columns.reference} column beside it`;
}

test('every figure and every file written of a base group with another reference\'s, pending, failed and stale recordings: one set everywhere, one identity per axis, each row its own reference (R1, R4, C5)', () => {
    const results = new Map<string, ScanResult>([
        ['/f/a.wav', scan(-20)], ['/f/b.wav', scan(-22)], ['/f/x.wav', FAILED], ['/f/spl.wav', scan(60, SPL)], ['/f/spl2.wav', scan(62, SPL)], ['/f/spl3.wav', scan(58, SPL)],
    ]);
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    // The compared dB SPL file against a group of dBFS, dB SPL, still computing (/p.wav) and failed (/x.wav) recordings.
    const group = { paths: ['/f/a.wav', '/f/b.wav', '/f/spl2.wav', '/f/spl3.wav', '/f/p.wav', '/f/x.wav'], title: '基準群' };
    const comparison = compareOf(model, results, '/f/spl.wav', null, STR, false, undefined, group);
    // The set: the measured recordings of the compared one's reference only; the median, its files and n are of it.
    const used = baseUsed(comparison);
    assert.deepEqual(used.paths, ['/f/spl2.wav', '/f/spl3.wav']);
    assert.deepEqual(comparison.base?.filePaths, used.paths);
    assert.equal(comparison.base?.leq, 60);
    assert.equal(comparison.blocked, undefined);
    // 報告.csv: the row's reference and the base's, n and files of the same set.
    const report = reportCsv({ model, results, slots: [null, '/f/spl.wav', null, null], compare: () => comparison, region: null, recipe: null, recipeName: 'r', now: new Date(), stale: new Set<string>() }, STR);
    const [reportHeader, row] = csvRecords(report);
    assert.equal(csvHeaderProblem(reportHeader, levelColumns(STR)), null);
    assert.equal(csvHeaderProblem(reportHeader, baseLevelColumns(STR)), null);
    const cell = (name: string): string => row[reportHeader.indexOf(name)];
    assert.equal(cell(STR.reportLevelReference), 'dB SPL re 20 µPa');
    assert.equal(cell(STR.reportBaseLevelReference), 'dB SPL re 20 µPa');
    assert.equal(cell(STR.entryCsvGroupSize), '2');
    assert.equal(cell(STR.reportGroupFiles), 'spl2.wav;spl3.wav');
    // The entry CSV's n is the same set's, and nothing when the Δ is withheld (a file as its own base).
    assert.equal(entryMeasure(comparison, BAND_3150, STR)?.count, 2);
    const self = compareOf(model, results, '/f/a.wav', '/f/a.wav', STR);
    assert.equal(self.blocked, 'self');
    assert.equal(entryMeasure(self, BAND_3150, STR)?.count, 0);
    // A group all of another reference: no median, no n, the Δ withheld as of another reference.
    const other = compareOf(model, results, '/f/spl.wav', null, STR, false, undefined, { paths: ['/f/a.wav', '/f/b.wav'], title: 'g' });
    assert.equal(other.base, null);
    assert.equal(other.blocked, 'unit');
    // Report PNG of a slot-0 file of another reference: two axes, each named with its own reference.
    const pair = compareOf(model, results, '/f/spl.wav', '/f/a.wav', STR);
    const axes = reportLevelAxes(pair, { results }, STR);
    assert.ok(axes.right, 'two references, two axes');
    for (const title of [axes.left, axes.right ?? '']) assert.match(title, /\[(dBFS|dB SPL re 20 µPa)\]$/u, title);
    assert.equal(baseUsed(pair).n, 0, 'a withheld Δ has no base n');
    // Screen: the same rule (levelAxes) over the lines of the pair.
    const lines = ['/f/a.wav', '/f/b.wav', '/f/spl.wav'].map(file => ({ file, input: results.get(file)?.input }));
    const screen = levelAxes(lines, { inputOf: line => line.input, names: () => plainNames(P('x'), P('y')), range: () => plainRange(0, 1) });
    assert.equal(axisProblem(screen.axes, line => line.input), null);
    assert.equal(screen.axes.length, 2);
    // entry-table.csv: every level column (Leq and the band's) with its row's reference beside it.
    const columns = levelColumns(STR), band = bandLevelColumns(STR, '3.15 kHz');
    const labels = { file: 'File', condition: (n: number) => `c${n}`, regionStart: 's', regionEnd: 'e', level: columns, peak: STR.entryColPeak, bandLevel: band, deltaLeq: 'dl', deltaBand: 'db', groupSize: 'n', groupLeft: 'gl', stale: 'sl', status: 'st' };
    const [entryHeader, ...rows] = csvRecords(entryCsv(model, labels, () => null));
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
    const spectrum = buildSpectrumCsv([{ name: 'a', slice: { values: [-1], frequencyBins: 1, maxFrequencyHz: 1, minDb: -1, maxDb: 0 }, levelTitle: title('dBFS') }, { name: 's', slice: { values: [60], frequencyBins: 1, maxFrequencyHz: 1, minDb: 0, maxDb: 60 }, levelTitle: title('dB SPL re 20 µPa') }], P('Hz'));
    for (const column of csvRecords(spectrum)[0].filter((_, index) => index % 2 === 1)) assert.match(column, /\[(dBFS|dB SPL re 20 µPa)\]$/u, column);
    // The injected bugs: a header without the reference column, and another reference counted in n, are caught.
    assert.match(csvHeaderProblem(entryHeader.filter(name => name !== band.reference), band) ?? '', /no .* column beside it/u);
    // V6: a level column in bare dB(A) is caught, its reference column beside it or not.
    const bareColumns = levelColumns({ ...STR, entryColLeq: 'Leq dB(A)' });
    assert.match(csvHeaderProblem(entryHeader.map(name => (name === columns.level ? bareColumns.level : name)), bareColumns) ?? '', /bare dB/u);
    assert.notDeepEqual(figureUsed(scanIdentity(undefined), group.paths.map(path => scanAnswer(path, results.get(path)))).paths, used.paths, 'counting without the compared identity is caught');
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
        entryCsv(buildEntryModel([], null), { file: '', condition: String, regionStart: '', regionEnd: '', level: { level: 'Leq', reference: '', uncalibrated: '' }, peak: '', bandLevel: bandLevelColumns(STR, ''), deltaLeq: '', deltaBand: '', groupSize: '', groupLeft: '', stale: '', status: '' }, () => null);
    };
    assert.equal(typeof never, 'function');
    const names: FigureNames = plainNames(P('x'), P('y')), range: FigureRange = plainRange(0, 1);
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

test('every chart\'s level axis, range and file count row says it is computed in figureModel.ts (docs/plot-layers.md)', () => {
    const rows = ROWS.filter(row => row.value === 'axis' || row.value === 'range' || row.value === 'count');
    assert.ok(rows.length >= 30, String(rows.length));
    const outside = rowsOutsideFigureModel(ROWS);
    const exempt = Object.keys(NOT_FIGURE_ROWS).filter(id => !outside.includes(id));
    assert.deepEqual(outside.filter(id => !NOT_FIGURE_ROWS[id]), [], 'these rows name no figureModel.ts function');
    assert.deepEqual(exempt, [], 'NOT_FIGURE_ROWS lists a row that is gone or now names figureModel.ts: take it off');
    for (const [id, why] of Object.entries(NOT_FIGURE_ROWS)) assert.ok(why.trim(), id);
});

// ── Structure: nothing outside the layer makes a figure's names, ranges, identities or counts ────────────────────

// ── Structure: the scan is src/test/figureSites.ts; these are the sites it may find ──

/** The sites outside figureModel.ts that may match, and figureModel.ts's own, each file's with why. */
const ALLOWED: Sites = {
    // A calibration profile's own equality (its channels' factors and units): which profile applies, not a level identity.
    'shared/analysis/calibrationModel.ts': { 'identity': ['profilesEqual'] },
    // Which saved profile is the latest that calibrates anything: a profile's choice, not a line's calibration.
    'extension/calibrationStore.ts': { 'every-calibrated': ['persistChannel'] },
    // A gain (one unit's ratio) and a Δ are plain dB: 'Gain [dB]', 'Difference Δ [dB]' in each language.
    'shared/i18n/strings.ts': { 'bracket-db': ['STRINGS.en.axisDelta', 'STRINGS.en.axisGain', 'STRINGS.ja.axisDelta', 'STRINGS.ja.axisGain'] },
    // A histogram's bins, rounded by the same rule: entry-distribution's range is figureModel.ts:plainRange of it.
    'shared/dataset/distribution.ts': { 'range-rule': ['distribution'] },
    // A signed difference's text ("+1.2 dB"): a Δ, not a level.
    'webview/plot/plotText.ts': { 'bare-db': ['signedText'] },
    // The waveform's range, defined (a lane's amplitude range is figureModel.ts:laneAmplitudeRange).
    'webview/plot/waveformLayer.ts': { 'range-rule': ['waveformRange'] },
    // paneAxes and levelIdentityOf, defined (figureModel.ts paneNames and levelKeyOf wrap them); the Δ headline's
    // signed "Leq +1.2 dB" (a Δ).
    'webview/runtime/comparePanes.ts': { 'axis-name': ['levelsHeadline.word', 'paneAxes.delta.y', 'paneAxes.y'], 'bare-db': ['diffHeadline'], 'identity': ['levelIdentityOf'] },
    // "Δ max band dB" (a Δ); a report figure's level axes, each named by its own sides' input (reportLevelAxes).
    'webview/runtime/compareReport.ts': { 'axis-namer': ['reportLevelAxes'], 'bare-db': ['reportCsv.header'] },
    // A held plot names the one picture it draws (its step's, its Δ's), with its own recording's input.
    'webview/runtime/entryHeldPlot.ts': { 'axis-namer': ['createHeldPlot.paint', 'createHeldPlot.paintDelta', 'createHeldPlot.paintSlot', 'createHeldPlot.paintStep'] },
    // The Δ pane names its difference by the compared recording's input. The overlay's level axes and the lanes are
    // not here: figureModel.stageLevelAxes names each axis by its own lines, laneNames a lane by its own picture (R4).
    'webview/runtime/trackStagePainter.ts': { 'axis-namer': ['paintStageOverlay.diffAxes'] },
    // The CSV match's "{matched} of {total}" files (the folder's count) and the test snapshot's scanned count.
    'webview/runtime/entryRuntime.ts': { 'file-count': ['createEntryScreen.paint', 'createEntryScreen.readCsvFile', 'createEntryScreen.snapshot.scanned'] },
    // "Δ max band dB" (a Δ); which part of a ≠ row's identity differs, said once figureModel.scanLevelKey found it differs.
    'webview/runtime/entryTable.ts': { 'bare-db': ['entryCsv.header'], 'identity': ['mismatchLabel'] },
    // stageAxes and stageRange / stageDiffRange, defined (figureModel.ts stageNames, dataRange, diffRange wrap them).
    'webview/runtime/stagePanes.ts': { 'axis-builder': ['stageAxes.colour', 'stageAxes.y'], 'axis-name': ['amplitudeAxisTitle', 'metricName', 'stageAxes.colour', 'stageAxes.y', 'timeLevelTitle', 'timeLevelTitle.name'], 'range-rule': ['roundEdge', 'stageRange'] },
    // The gate's "analyse the base group's n recordings": how many would be scanned, not a figure's n.
    // A drawn lane's names for the readout: its own picture by its own track's input.
    'webview/runtime/trackStageMode.ts': { 'axis-namer': ['createTrackStageMode.paintNow.lanesDrawn.axes'], 'file-count': ['createTrackStageMode.paintNow.count', 'createTrackStageMode.paintNow.items.count'] },
    // figureModel.ts itself, looked at too: the rules it defines and wraps (its own builders, keys and range rules),
    // and never a default reference ('default-reference'): a guessed reference here would be every figure's.
    // Its definitions: stageAxes/paneAxes/calibrationWords wrapped; the level strings its titles are made of; its CSV
    // columns; medianInputOf, the one place a line of several recordings is calibrated only when every one is; R9's
    // rules wrapped; levelIdentityOf wrapped by levelKeyOf; calibrationWordsBy's and a folder reference's any; the
    // stage's namers (R4): stageLevelAxes each axis by its own lines, laneNames a lane by its own picture, and
    // pendingStageNames the pending name in no recording's unit.
    'webview/runtime/figureModel.ts': { 'axis-namer': ['laneNames', 'pendingStageNames', 'stageLevelAxes', 'stageLevelAxes.names'], 'axis-builder': ['legendWords.word', 'paneNames', 'paneNames.axes', 'stageNames'], 'axis-name': ['gainAxisName.name', 'levelTitle', 'uncalibratedWord', 'unknownLevelTitle'], 'csv-column': ['bandLevelColumns', 'bandLevelColumns.level', 'baseLevelColumns', 'levelColumns'], 'every-calibrated': ['calibrationWordsBy', 'folderReference.calibrated', 'medianInputOf.calibrationStatus'], 'identity': ['levelKeyOf.identity', 'pictureSet.of'], 'range-rule': ['dataRange', 'diffRange', 'heatmapRange', 'levelLineRange.auto', 'roundedRange.nice'] },
};
const INJECTED_FILE = 'webview/runtime/injectedFigure.ts';
/** Uses of the guarded functions under other names: what a search for their spelling would miss. */
const INJECTED_USES = [
    "import * as panes from './stagePanes';",
    "import { niceRange as nice, heatmapDbRange } from '../../shared/utils/ticks';",
    "import { levelIdentityOf as keyOf, paneAxes } from './comparePanes';",
    "import { calibrationWords as words, stageNames as named, levelAxes } from './figureModel';",
    'export const renamed = (low: number, high: number) => nice(low, high);',
    'export const spaced = () => panes.stageRange([]);',
    'export const handedOn = [heatmapDbRange].map(rule => rule(0, 1));',
    'export const diff = panes.stageDiffRange;',
    'export const identity = (input: Parameters<typeof keyOf>[0]) => keyOf(input);',
    'export const axes = paneAxes;',
    'export const builder = panes.stageAxes;',
    'export const calibration = words;',
    'export const overlayNames = (strings: Parameters<typeof named>[0]) => named(strings, null, undefined);',
    'export const ownAxes = levelAxes;',
].join('\n');

test('outside figureModel.ts nothing builds an axis name, calls an axis builder, keys by level identity, applies a range rule, counts files for n or defaults a reference, but the exact list; figureModel.ts only its own definitions (docs/plot-layers.md)', () => {
    const files = sources();
    assert.ok(files.length > 100, String(files.length));
    // One program for the real sources and the injected uses: the injected file's sites are taken out and checked apart.
    const sites = functionSites(typed(files, { [INJECTED_FILE]: INJECTED_USES }));
    const injected = sites[INJECTED_FILE];
    delete sites[INJECTED_FILE];
    for (const { rel, source } of files) fileSites(rel, source, sites);
    const problems = siteProblems(sites, ALLOWED);
    assert.deepEqual(problems, []);
    // The same scan finds a guarded function used under another name, through a namespace, or handed on as a value.
    assert.deepEqual(injected, { 'axis-builder': ['axes', 'builder', 'calibration'], 'axis-namer': ['overlayNames', 'ownAxes'], 'identity': ['identity'], 'range-rule': ['diff', 'handedOn', 'renamed', 'spaced'] });
});

test('the structural check fails on each injected bug: every violation of class sweep 1 (reference, aggregation) and the first ones (an axis name, pending in n, two identities on one axis, a CSV header without its reference)', () => {
    const files = new Map(sources().map(file => [file.rel, file.source]));
    const inject = (rel: string, code: string): Sites => fileSites(rel, `${files.get(rel) ?? ''}\n${code}\n`);
    const injected: Array<[string, string, string]> = [
        ['webview/runtime/trackStagePainter.ts', 'const y = `${STR.axisLevelCal} [dB]`;', 'axis-name'],
        ['webview/runtime/trackStagePainter.ts', 'const y = s.axisLevelCal;', 'axis-name'],
        ['webview/runtime/trackStagePainter.ts', 'const { axisUncalibrated } = strings;', 'axis-name'],
        // V1: a line without a recording read on the first track's reference.
        ['webview/runtime/trackStagePainter.ts', 'const inputOf = (layer: StageLayer) => tracks[0]?.input;', 'first-track-input'],
        // A1, A3, A7: a base group chosen by hand, of another reference or with pending files kept.
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
        // Class sweep 3: a CSV column in "dB(A)" (V6), a reference defaulted before anything is read (V9), in the layer too.
        ['shared/i18n/strings.ts', "const columns = { entryColLeq: 'Leq dB(A)' };", 'default-reference'],
        ['webview/runtime/entrySidePlots.ts', "const label = folder.label || 'dBFS';", 'default-reference'],
        ['webview/runtime/figureModel.ts', "const unit = response?.levelReferenceLabel ?? 'dB';", 'default-reference'],
        // V4: a median line calibrated when any one is, outside medianInputOf; V8: empty axes named by the first track.
        ['webview/runtime/trackStageMode.ts', "const calibrated = inputs.every(input => input?.calibrationStatus === 'calibrated');", 'every-calibrated'],
        ['webview/runtime/trackStagePainter.ts', 'const mainNames = stageNames(strings, picture, tracks[0]?.input);', 'first-track-input'],
        // Class sweep 4: a median's calibration by `.some(`, a gain fixed as calibrated, a bare levelUnit after a label,
        // a dBFS assumed for an input nobody gave.
        ['webview/runtime/comparePanes.ts', 'const uncalibrated = sides.some(side => side.uncalibrated);', 'every-calibrated'],
        ['webview/runtime/figureModel.ts', "const gain = { unit: '1', calibrationStatus: 'calibrated' };", 'every-calibrated'],
        ['shared/report/analysisReport.ts', 'const text = measurement.levelReferenceLabel || measurement.levelUnit;', 'bare-level-unit'],
        ['webview/runtime/stagePanes.ts', 'const reference = input ?? { levelReferenceLabel: uncalibratedUnits(true).level };', 'default-reference'],
        // A power's unit squared in the webview (the axis said Pa², the readout Pa): the backend sends it raised.
        ['webview/runtime/stagePanes.ts', "const title = `${name} [${measure === 'power' ? `${base}\u00b2` : base}]`;", 'unit-edit'],
        ['webview/runtime/figureModel.ts', "const shown = view.unit + '^0.5';", 'unit-edit'],
    ];
    for (const [rel, code, pattern] of injected) {
        const before = fileSites(rel, files.get(rel) ?? '')[rel]?.[pattern] ?? [];
        const added = (inject(rel, code)[rel]?.[pattern] ?? []).filter(site => !before.includes(site));
        assert.equal(added.length, 1, `${rel}: ${pattern}: ${code}`);
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
