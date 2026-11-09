import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { scanAnswer } from '../webview/runtime/answerStore';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import type { Answer } from '../webview/runtime/answerTypes';
import { buildCompareModel, type LevelInput } from '../webview/runtime/comparePanes';
import { baseUsed, reportCsv, reportLevelAxes } from '../webview/runtime/compareReport';
import { BAND_CENTERS_HZ, buildEntryModel, entryCsv } from '../webview/runtime/entryTable';
import {
    byLevelKey, calibrationWords, calibrationWordsBy, figureUsed, levelAxes, levelColumns, levelKeyOf, levelKeyOfReading, plainNames, plainRange,
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

function scan(leq: number, level: Partial<LevelInput> = {}): ScanResult {
    return {
        ok: true, conditionId: 'c', specVersion: 2, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: 16000, channels: [0], durationS: 2, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true, ...level },
        leqDbA: [leq], peakHz: [100], spectrumDb: [[-40, -50]], thirdOctDb: [BAND_CENTERS_HZ.map((_, index) => (index === BAND_3150 ? leq - 10 : -60))], crest: [1.4],
    };
}
const SPL = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false } as const;
const FAILED = { ok: false, error: 'failed' } as unknown as ScanResult;

test('a figure counts only its ready answers of its identity: pending, failed and another reference\'s are excluded with why (layers-design)', () => {
    const answers: Array<Answer<ScanResult & { ok: true }>> = [
        scanAnswer('/a.wav', scan(-20)), scanAnswer('/b.wav', scan(-21)), scanAnswer('/p.wav', undefined), scanAnswer('/x.wav', FAILED), scanAnswer('/s.wav', scan(60, SPL)),
    ];
    const fs = levelKeyOf(scan(0).input);
    const used = figureUsed(answers, fs);
    assert.deepEqual(used.paths, ['/a.wav', '/b.wav']);
    assert.equal(used.n, 2);
    assert.deepEqual(used.excluded, [{ path: '/p.wav', reason: 'pending' }, { path: '/x.wav', reason: 'failed' }, { path: '/s.wav', reason: 'other-reference' }]);
    // Without an identity every ready answer counts, and still nothing pending or failed.
    assert.equal(figureUsed(answers).n, 3);
    // The injected bug: counting the answers asked for (pending ones too) is not the figure's n.
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

test('every figure and every file written of a mixed-reference pair with pending and failed base files: one identity per axis, each row its own reference, n of the measured only (R1, R4, C5)', () => {
    const results = new Map<string, ScanResult>([
        ['/f/a.wav', scan(-20)], ['/f/b.wav', scan(-22)], ['/f/x.wav', FAILED], ['/f/spl.wav', scan(60, SPL)],
    ]);
    const basePaths = ['/f/a.wav', '/f/b.wav', '/f/p.wav', '/f/x.wav'];
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    const group = { paths: basePaths, title: '基準群' };
    const comparison = buildCompareModel(model, results, '/f/spl.wav', null, STR, false, undefined, group);
    // n and the 基準群 files: the measured ones only (the pending /p.wav and the failed /x.wav are not counted).
    const used = baseUsed(comparison, results);
    assert.equal(used.paths.includes('/f/p.wav') || used.paths.includes('/f/x.wav'), false, used.paths.join(';'));
    // Report PNG: the dBFS base and the dB SPL file on two axes, each named with its own reference.
    const axes = reportLevelAxes(comparison, { results }, STR);
    assert.ok(axes.right, 'two references, two axes');
    assert.notEqual(axes.left, axes.right);
    for (const title of [axes.left, axes.right ?? '']) assert.match(title, /\[(dBFS|dB SPL re 20 µPa)\]$/u, title);
    // Screen: the same rule (levelAxes) over the lines of the pair.
    const lines = ['/f/a.wav', '/f/b.wav', '/f/spl.wav'].map(file => ({ file, input: results.get(file)?.input }));
    const screen = levelAxes(lines, { inputOf: line => line.input, names: () => plainNames('x', 'y'), range: () => plainRange(0, 1) });
    assert.equal(axisProblem(screen.axes, line => line.input), null);
    assert.equal(screen.axes.length, 2);
    // 報告.csv: each row says its own reference (and the base's), n and files are the measured ones.
    const report = reportCsv({ model, results, slots: [null, '/f/spl.wav', null, null], compare: () => comparison, region: null, recipe: null, recipeName: 'r', now: new Date() }, STR);
    const [reportHeader, row] = report.slice(1).trimEnd().split('\r\n').map(csvColumns);
    assert.equal(csvHeaderProblem(reportHeader, levelColumns(STR)), null);
    const cell = (name: string): string => row[reportHeader.indexOf(name)];
    assert.equal(cell(STR.reportLevelReference), 'dB SPL re 20 µPa');
    assert.equal(cell(STR.entryCsvGroupSize), String(used.n));
    assert.ok(!/p\.wav|x\.wav/u.test(cell(STR.reportGroupFiles)), cell(STR.reportGroupFiles));
    // entry-table.csv: every measured row its own reference; the failed one and the one of another unit than the
    // table's (a mismatch, which says its unit instead) write none.
    const columns = levelColumns(STR);
    const labels = { file: 'File', condition: (n: number) => `c${n}`, regionStart: 's', regionEnd: 'e', level: columns, peak: 'p', band: 'b', deltaLeq: 'dl', deltaBand: 'db', groupSize: 'n', status: 'st' };
    const [entryHeader, ...rows] = entryCsv(model, labels, () => null).slice(1).trimEnd().split('\r\n').map(csvColumns);
    assert.equal(csvHeaderProblem(entryHeader, columns), null);
    const reference = entryHeader.indexOf(columns.reference);
    assert.deepEqual(rows.map(cells => [cells[0], cells[reference]]).sort(), [['a.wav', `dBFS ${STR.entryLeqUncalibrated}`], ['b.wav', `dBFS ${STR.entryLeqUncalibrated}`], ['spl.wav', ''], ['x.wav', '']]);
    assert.match(rows.find(cells => cells[0] === 'spl.wav')?.at(-1) ?? '', /^≠ Pa$/u);
    // The spectrum CSV: every level column named with its reference, as its axis is.
    const title = (text: string) => axes.left.replace(/\[[^\]]*\]$/u, `[${text}]`) as FigureTitle;
    const spectrum = buildSpectrumCsv([{ name: 'a', slice: { values: [-1], frequencyBins: 1, maxFrequencyHz: 1, minDb: -1, maxDb: 0 }, levelTitle: title('dBFS') }, { name: 's', slice: { values: [60], frequencyBins: 1, maxFrequencyHz: 1, minDb: 0, maxDb: 60 }, levelTitle: title('dB SPL re 20 µPa') }], 'Hz' as FigureTitle);
    for (const column of csvColumns(spectrum.split('\n')[0]).filter((_, index) => index % 2 === 1)) assert.match(column, /\[(dBFS|dB SPL re 20 µPa)\]$/u, column);
    // The injected bug: a header without the reference column is caught.
    assert.match(csvHeaderProblem(entryHeader.filter(name => name !== columns.reference), columns) ?? '', /no .* column beside it/u);
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
        // @ts-expect-error CSV level columns made outside the figure model
        entryCsv(buildEntryModel([], null), { file: '', condition: String, regionStart: '', regionEnd: '', level: { level: 'Leq', reference: '', uncalibrated: '' }, peak: '', band: '', deltaLeq: '', deltaBand: '', groupSize: '', status: '' }, () => null);
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
    /** An axis's name built from the UI strings of a level, a gain, a Δ or the calibration word. */
    'axis-name': /\b(?:STR|strings)\.axis(?:Level\w*|Uncalibrated|Gain|TransferLevel|Delta)\b/gu,
    /** The axis builders and the calibration words, called. */
    'axis-builder': /\b(?:paneAxes|stageAxes|calibrationWords)\(/gu,
    /** Lines keyed by level identity. */
    'identity': /\blevelIdentityOf\(/gu,
    /** R9's range rules, called. */
    'range-rule': /\b(?:niceRange|stageRange|stageDiffRange|heatmapDbRange)\(/gu,
    /** A figure's n or a CSV's 基準群 n written from the files asked for. */
    'file-count': /(?:String\(|count:\s*|\{count\}'\)?,?\s*String\()[\w.?]*(?:filePaths|basePaths|paths|members)\??\.length/gu,
    /** A CSV level column or reference column named outside the layer. */
    'csv-column': /\b(?:STR|strings)\.(?:reportLevelReference|reportBaseLevelReference|reportBaseLeq)\b/gu,
};

/**
 * The sites outside figureModel.ts that may match, with their counts: the definitions the layer wraps, and counts
 * that are not a figure's n. Exact: a new site fails, and so does one removed until it is taken off. Only shrinks.
 */
const ALLOWED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    // R9's rule and its rounding, defined (figureModel.ts roundedRange / heatmapRange wrap them).
    'shared/utils/ticks.ts': { 'range-rule': 1 },
    // A histogram's bins, rounded by the same rule: entry-distribution's range is figureModel.ts:plainRange of it.
    'shared/dataset/distribution.ts': { 'range-rule': 1 },
    // The waveform's range, defined (a lane's amplitude range is figureModel.ts:laneAmplitudeRange).
    'webview/plot/waveformLayer.ts': { 'range-rule': 1 },
    // paneAxes and levelIdentityOf, defined (figureModel.ts paneNames and levelKeyOf wrap them).
    'webview/runtime/comparePanes.ts': { 'axis-name': 3, 'identity': 1 },
    // stageAxes and stageRange / stageDiffRange, defined (figureModel.ts stageNames, dataRange, diffRange wrap them).
    'webview/runtime/stagePanes.ts': { 'axis-builder': 2, 'axis-name': 8, 'range-rule': 3 },
    // A fixed Δ's base: the files it was measured from, kept as baseUsed gave them when it was fixed.
    'webview/runtime/compareReport.ts': { 'file-count': 1 },
    // The CSV match's "{matched} of {total}" files: the folder's count, not a figure's n.
    'webview/runtime/entryRuntime.ts': { 'file-count': 2 },
};

/** Each file's matches of each pattern, a definition (`function name(`) not counted. */
function figureSites(files: ReadonlyArray<{ rel: string; source: string }>): Record<string, Record<string, number>> {
    const sites: Record<string, Record<string, number>> = {};
    for (const { rel, source } of files) {
        if (rel === 'webview/runtime/figureModel.ts') continue;
        for (const [name, pattern] of Object.entries(PATTERNS)) {
            const count = [...source.matchAll(pattern)].filter(match => !/function\s*$/u.test(source.slice(Math.max(0, match.index - 9), match.index))).length;
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
            if (statSync(full).isDirectory()) { if (name !== 'test' && name !== 'generated') walk(full); } else if (name.endsWith('.ts')) files.push({ rel: path.relative(srcRoot, full).split(path.sep).join('/'), source: readFileSync(full, 'utf8') });
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

test('the structural check fails on each injected bug: an axis name outside the layer, pending counted in n, two identities keyed by hand, a CSV header without its reference', () => {
    const files = sources();
    const inject = (rel: string, code: string) => figureSites(files.map(file => (file.rel === rel ? { rel, source: `${file.source}\n${code}\n` } : file)));
    const injected: Array<[string, string, string]> = [
        ['webview/runtime/trackStagePainter.ts', 'const y = `${STR.axisLevelCal} [dB]`;', 'axis-name'],
        ['webview/runtime/entryBase.ts', 'const definition = { count: basePaths.length };', 'file-count'],
        ['webview/runtime/triggerLanes.ts', 'const key = (track: StageTrack) => levelIdentityOf(track.input);', 'identity'],
        ['webview/runtime/entryRuntime.ts', 'const header = [strings.entryColLeq, strings.reportBaseLeq];', 'csv-column'],
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
