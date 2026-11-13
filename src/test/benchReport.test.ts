import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { recipeSteps } from '../shared/recipe/recipeSteps';
import { BAND_CENTERS_HZ, buildEntryModel } from '../webview/runtime/entryTable';
import { paintDeltaFigure, paintOverlayFigure, reportCsv, reportDefinitions, reportLevelAxes, reportFiles, reportFolderName, reportOctaveRecipe, reportRecipe, summaryRegionText } from '../webview/runtime/compareReport';
import { compareOf } from './helpers/compareInput';
import { misplacedTicks, placeRecordingCanvas } from './helpers/tickPlaces';
import { withChannel } from '../shared/recipe/channelSelection';
import type { BaseDefinition, DerivedRow, EntryModel } from '../webview/runtime/entryTable';

const repoRoot = path.resolve(__dirname, '..', '..');
const entry = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const BAND_3150 = BAND_CENTERS_HZ.indexOf(3150);
/** The comparison the entry screen hands the report (entryBase.comparison): here the slot-0 file, else the condition's other files. */
const compareFor = (model: EntryModel, results: ReadonlyMap<string, ScanResult>, slots: readonly (string | null)[]) =>
    (path: string) => compareOf(model, results, path, slots[0] ?? null, getStrings('ja'));

function scan(leq: number, band: number, durationS = 2): ScanResult {
    return {
        ok: true, conditionId: 'c', specVersion: 2, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: 16000, channels: [0], durationS, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true },
        leqDbA: [leq], peakHz: [100], spectrumDb: [[-40, -50]],
        thirdOctDb: [BAND_CENTERS_HZ.map((_, index) => (index === BAND_3150 ? band : -60))], crest: [1.4],
    };
}

test('the report folder is named after the Recipe and the moment it was written', () => {
    assert.equal(reportFolderName('entry-scan', new Date(2026, 9, 22, 7, 5, 9)), 'entry-scan_20261022-070509');
});

test('報告.csv has one row per slot in the agreed columns: dB to one decimal, Hz whole, missing values empty', () => {
    const results = new Map<string, ScanResult>([
        ['/f/L1_900rpm_run1.wav', scan(-20.04, -30)], ['/f/L1_900rpm_run2.wav', scan(-20.0, -31)], ['/f/L1_900rpm_run3.wav', scan(-10.06, -10)],
    ]);
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    const csv = reportCsv({ model, results, slots: [null, '/f/L1_900rpm_run3.wav', null, null], compare: compareFor(model, results, []), region: { start: 0.5, end: 1.5 }, recipe: entry, recipeName: 'entry-scan', now: new Date(), stale: new Set<string>() }, getStrings('ja'));
    assert.ok(csv.startsWith('﻿'));
    const [header, row, ...rest] = csv.slice(1).trimEnd().split('\r\n');
    assert.equal(rest.length, 0);
    assert.equal(header, `ファイル,Δ最大帯域 Hz,Δ最大帯域 dB,条件 1,条件 2,開始 s,終了 s,Leq A特性,レベル基準,基準 Leq A特性,基準 レベル基準,Δ Leq A特性,${header.split(',').filter(name => /^Δ [\d.]+ k?Hz dB$/.test(name)).join(',')},基準群 n,基準群ファイル,解析仕様版,手順,ch,メモ,基準の定義`);
    assert.ok(header.includes(',Δ 3.15 kHz dB,'));
    const cells = row.split(',');
    // Where the file differs most comes first.
    assert.deepEqual(cells.slice(0, 7), ['L1_900rpm_run3.wav', '3150', '20.5', 'L1', '900rpm', '0.50', '1.50']);
    // The Δ is taken from the full levels (−10.06 against the base's −20.02) and rounded only as it is written: 10.0,
    // never the 9.9 of the two rounded columns (−10.1 − −20.0) subtracted.
    assert.deepEqual([cells[7], cells[8], cells[9], cells[10], cells[11]], ['-10.1', 'dBFS 未校正', '-20.0', 'dBFS 未校正', '10.0']);
    assert.equal(cells[header.split(',').indexOf('Δ 3.15 kHz dB')], '20.5');
    const at = (name: string): string => cells[header.split(',').indexOf(name)];
    assert.deepEqual([at('基準群 n'), at('基準群ファイル'), at('解析仕様版')], ['2', 'L1_900rpm_run1.wav;L1_900rpm_run2.wav', '2']);
    // Which chain the numbers are of: the Recipe beside the CSV, or the previous one where it was not measured again.
    assert.equal(at('手順'), getStrings('ja').reportChainCurrent);
    const previous = reportCsv({ model, results, slots: [null, '/f/L1_900rpm_run3.wav', null, null], compare: compareFor(model, results, []), region: null, recipe: entry, recipeName: 'entry-scan', now: new Date(), stale: new Set(['/f/L1_900rpm_run1.wav']) }, getStrings('ja'));
    assert.equal(previous.trimEnd().split('\r\n')[1].split(',')[header.split(',').indexOf('手順')], getStrings('ja').reportChainPrevious);
    const whole = reportCsv({ model, results, slots: [null, '/f/L1_900rpm_run3.wav', null, null], compare: compareFor(model, results, []), region: null, recipe: entry, recipeName: 'entry-scan', now: new Date(), stale: new Set<string>() }, getStrings('ja'));
    // The whole file is written as the region actually measured: its guarded ends are left out.
    assert.deepEqual(whole.split('\r\n')[1].split(',').slice(5, 7), ['0.15', '1.85']);
});

test('each compared file\'s row, Recipe and heading give the region that file was measured over, cut within its own length', () => {
    // Slot 1 is 10 s long, slot 2 5 s: the whole of each is measured within its own guarded ends (scan_service).
    const results = new Map<string, ScanResult>([['/f/base.wav', scan(-20, -30, 10)], ['/f/long.wav', scan(-10, -10, 10)], ['/f/short.wav', scan(-12, -12, 5)]]);
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    const STR = getStrings('ja');
    const input = { model, results, slots: ['/f/base.wav', '/f/long.wav', '/f/short.wav', null], compare: compareFor(model, results, ['/f/base.wav']), region: null, recipe: entry, recipeName: 'entry-scan', now: new Date(), stale: new Set<string>() };
    const [header, ...rows] = reportCsv(input, STR).slice(1).trimEnd().split('\r\n');
    const columns = header.split(',');
    const span = (row: string): string[] => [row.split(',')[columns.indexOf('開始 s')], row.split(',')[columns.indexOf('終了 s')]];
    assert.deepEqual(rows.map(span), [['0.15', '9.85'], ['0.15', '4.85']], 'each row its own file\'s measured region');
    assert.equal(summaryRegionText(input, STR), '1: 0.15–9.85 s · 2: 0.15–4.85 s');
    // One Recipe per measured region, each slicing as its rows were measured.
    const fakeDocument = { createElement: () => ({ getContext: () => null, toDataURL: () => '' }) } as unknown as Document;
    const recipes = reportFiles(fakeDocument, input, STR).files.filter(file => file.name.endsWith('.recipe.json') && !file.name.includes('1-3oct'));
    const ends = Object.fromEntries(recipes.map(file => [file.name, recipeSteps(JSON.parse(file.text!) as RecipeDocument).find(step => step.name === 'time_slice')!.params['end']]));
    assert.deepEqual(ends, { 'entry-scan.slot1.recipe.json': 9.85, 'entry-scan.slot2.recipe.json': 4.85 });
    const definitions = reportDefinitions({ ...input, rowInfo: path => ({ label: path, value: '', memo: '', channel: null, base: { kind: 'file', file: 'base.wav' } as BaseDefinition }) }, 2, STR) as { comparisons: Array<{ measured: unknown }> };
    assert.deepEqual(definitions.comparisons.map(item => item.measured), [{ startS: 0.15, endS: 9.85 }, { startS: 0.15, endS: 4.85 }]);
    // Files measured over the same region share one Recipe and one heading.
    const same = { ...input, region: { start: 1, end: 3 } };
    assert.equal(summaryRegionText(same, STR), '1.00–3.00 s');
    assert.deepEqual(reportFiles(fakeDocument, same, STR).files.filter(file => file.name.endsWith('.recipe.json')).map(file => file.name), ['entry-scan.recipe.json', 'entry-scan.1-3oct.recipe.json']);
});

test('the report Recipe carries the region as its time slice and still loads in wandas', (t) => {
    const withRegion = reportRecipe(entry, { start: 0.5, end: 1.5 });
    const slice = recipeSteps(withRegion).find(step => step.name === 'time_slice')!;
    assert.deepEqual(slice.params, { end: 1.5, start: 0.5 });
    assert.deepEqual(recipeSteps(reportRecipe(entry, null)).find(step => step.name === 'time_slice')!.params, { end: null, start: 0 });
    const python = [path.join(repoRoot, '.venv', 'bin', 'python'), process.env.WANDAS_PYTHON].find(candidate => candidate && existsSync(candidate));
    if (!python) { t.skip('no Python'); return; }
    const run = spawnSync(python, ['-c', 'import json,sys; from wandas.pipeline import RecipePlan; print(len(RecipePlan.from_dict(json.load(sys.stdin)).to_dict()["nodes"]))'], { input: JSON.stringify(withRegion), encoding: 'utf8' });
    if (/No module named 'wandas'/.test(run.stderr)) { t.skip('wandas is not installed'); return; }
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), '3');
});

test('定義.json says what each number is, with the steps\' parameters in decimals', () => {
    const model = buildEntryModel([], null);
    const definitions = reportDefinitions({ model, results: new Map(), slots: [], compare: compareFor(model, new Map(), []), region: { start: 0.5, end: 1.5 }, recipe: entry, recipeName: 'entry-scan', now: new Date(), stale: new Set<string>() }, 2, getStrings('ja')) as {
        region: unknown; metrics: Record<string, string>; steps: Array<{ operation: string; params: Record<string, unknown> }>;
    };
    assert.deepEqual(definitions.region, { startS: 0.5, endS: 1.5 });
    assert.match(definitions.metrics['Leq A-weighted'], /A 特性/);
    assert.match(definitions.metrics.spectrum, /n_fft 1024/);
    assert.deepEqual(definitions.steps.find(step => step.operation.endsWith('time_slice'))!.params, { end: 1.5, start: 0.5 });
    assert.equal(typeof definitions.steps.find(step => step.operation.endsWith('highpass_filter'))!.params['cutoff'], 'number');
});

test('the report\'s two Recipes replay in wandas to the frames behind the scan\'s numbers', (t) => {
    const python = [path.join(repoRoot, '.venv', 'bin', 'python'), process.env.WANDAS_PYTHON].find(candidate => candidate && existsSync(candidate));
    if (!python) { t.skip('no Python'); return; }
    const region = { start: 0.5, end: 1.5 };
    const spectrumRecipe = reportRecipe(entry, region, 2);
    const octaveRecipe = reportOctaveRecipe(entry, region, 2, 16000);
    assert.deepEqual(recipeSteps(octaveRecipe).map(step => step.name), ['highpass_filter', 'time_slice', 'noct_spectrum']);
    // A tone file is scanned by the app's backend and both Recipes are applied to the same file with wandas alone.
    const script = `
import json, sys, numpy as np, soundfile as sf, tempfile, os
sys.path.insert(0, ${JSON.stringify(path.join(repoRoot, 'python-backend'))})
import wandas as wd
from wandas.pipeline import RecipePlan
from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from scan_service import log_spectrum
recipes = json.load(sys.stdin)
t = np.arange(32000) / 16000
x = 0.3 * np.sin(2 * np.pi * 1000 * t) + 0.05 * np.sin(2 * np.pi * 3150 * t) + 0.01 * np.random.default_rng(1).standard_normal(t.size)
path = os.path.join(tempfile.mkdtemp(), 'tone.wav'); sf.write(path, x, 16000, subtype='FLOAT')
scan = AnalysisService(AnalysisEngine()).scan(path, recipe=recipes['entry'], region={'start': 0.5, 'end': 1.5})
frame = wd.read_wav(path)
spectral = RecipePlan.from_dict(recipes['spectrum']).apply({'signal': frame})
octave = RecipePlan.from_dict(recipes['octave']).apply({'signal': frame})
spectrum = log_spectrum(np.asarray(spectral.dB).reshape(1, -1), np.asarray(spectral.freqs), 192, 8000.0)
d_spec = float(np.max(np.abs(spectrum[0] - np.asarray(scan['spectrumDb'][0]))))
bands = [b for b, v in zip(scan['thirdOctDb'][0], scan['thirdOctDb'][0]) if v is not None]
levels = np.asarray(octave.dB).ravel()
d_oct = float(np.max(np.abs(levels[-len(bands):] - np.asarray(bands)))) if bands else 0.0
print(json.dumps({'spectral': type(spectral).__name__, 'octave': type(octave).__name__, 'dSpec': d_spec, 'dOct': d_oct}))
`;
    const run = spawnSync(python, ['-c', script], { input: JSON.stringify({ entry, spectrum: spectrumRecipe, octave: octaveRecipe }), encoding: 'utf8', timeout: 120_000 });
    if (/No module named 'wandas'/.test(run.stderr)) { t.skip('wandas is not installed'); return; }
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.trim().split('\n').at(-1)!) as { spectral: string; octave: string; dSpec: number; dOct: number };
    assert.equal(out.spectral, 'SpectralFrame');
    assert.equal(out.octave, 'NOctFrame');
    // The scan rounds levels to 0.01 dB.
    assert.ok(out.dSpec <= 0.01, String(out.dSpec));
    assert.ok(out.dOct <= 0.01, String(out.dOct));
});

test('the report says what the comparison was taken from: the value, the filters, each base with its channel, the memo, and the D rows', () => {
    const results = new Map<string, ScanResult>([
        ['/f/a.wav', scan(-20, -30)], ['/f/b.wav', scan(-21, -31)], ['/f/c.wav', scan(-10, -10)],
    ]);
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    const STR = getStrings('ja');
    const base: BaseDefinition = { kind: 'group', group: { column: 'rpm', name: '1500' }, count: 2, channel: 2, filters: ['ch = 2'], fewerChannels: 1 };
    const derived: DerivedRow = { parentPath: '/f/c.wav', ch: 2, region: 'all', result: scan(-10, -10), base: { leq: -20.5, bands: BAND_CENTERS_HZ.map(() => -30), label: '基準群 rpm 1500', paths: ['/f/a.wav', '/f/b.wav'], definition: base } };
    const input = {
        model, results, slots: [null, '/f/c.wav', null, null], region: null, recipe: entry, recipeName: 'entry-scan', now: new Date(), stale: new Set<string>(),
        compare: (path: string) => compareOf(model, results, path, null, STR, false, undefined, { paths: ['/f/a.wav', '/f/b.wav'], title: '基準群 rpm 1500' }),
        rowInfo: () => ({ label: 'c.wav ch2', value: 'Leq A特性 [dBFS] −10.0', memo: 'ベアリングかも', channel: 2, base }),
        selection: { value: 'Leq A特性', group: 'rpm', filters: ['ch = 2'], excluded: 1 },
        derived: [derived],
    };
    const [header, row, d] = reportCsv(input, STR).slice(1).trimEnd().split('\r\n');
    const columns = header.split(',');
    assert.ok(!columns.includes('外れ値'));
    const cell = (line: string, name: string): string => line.split(',')[columns.indexOf(name)];
    assert.equal(row.split(',')[0], 'c.wav ch2');
    assert.deepEqual([cell(row, 'ch'), cell(row, '表示中の値: Leq A特性'), cell(row, 'メモ')], ['2', 'Leq A特性 [dBFS] −10.0', 'ベアリングかも']);
    assert.equal(cell(row, '基準の定義'), '基準群 rpm 1500 · n=2 · ch2 · -1 (< ch2) · ch = 2');
    assert.equal(cell(row, '基準群 n'), '2');
    // A difference fixed with D: under the comparisons, against the base it was fixed with.
    assert.match(d.split(',')[0], /^固定した差（D） · c\.wav ch2 · all$/);
    assert.equal(cell(d, 'Δ Leq A特性'), '10.5');
    assert.equal(cell(d, '基準の定義'), '基準群 rpm 1500 · n=2 · ch2 · -1 (< ch2) · ch = 2');
    // Fixed under an earlier chain (≠): the table has no number to read, and the report writes none either.
    const [, , previous] = reportCsv({ ...input, derived: [{ ...derived, stale: true }] }, STR).slice(1).trimEnd().split('\r\n');
    assert.deepEqual([cell(previous, '表示中の値: Leq A特性'), cell(previous, 'Δ Leq A特性')].filter(Boolean), [], previous);
    assert.equal(cell(previous, STR.reportChain), STR.reportChainPrevious);
    const definitions = reportDefinitions(input, 2, STR) as { selection: unknown; comparisons: Array<{ slot: number; file: string; channel: number; base: BaseDefinition }> };
    assert.deepEqual(definitions.selection, input.selection);
    assert.deepEqual(definitions.comparisons, [{ slot: 1, file: 'c.wav ch2', channel: 2, base, measured: { startS: 0.15, endS: 1.85 } }]);
});

test('a compared channel is a get_channel step in the exported Recipe, and wandas loads it', (t) => {
    const recipe = reportRecipe(withChannel(entry, 2), { start: 0.5, end: 1.5 });
    const steps = recipeSteps(recipe);
    assert.equal(steps[0].operation, 'wandas.frame.get_channel');
    assert.deepEqual(steps[0].params, { channel_idx: 1 });
    const python = [path.join(repoRoot, '.venv', 'bin', 'python'), process.env.WANDAS_PYTHON].find(candidate => candidate && existsSync(candidate));
    if (!python) { t.skip('no Python'); return; }
    const run = spawnSync(python, ['-c', 'import json,sys; from wandas.pipeline import RecipePlan; print(len(RecipePlan.from_dict(json.load(sys.stdin)).to_dict()["nodes"]))'], { input: JSON.stringify(recipe), encoding: 'utf8' });
    if (/No module named 'wandas'/.test(run.stderr)) { t.skip('wandas is not installed'); return; }
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), '4');
});

/** A scan in Pa, calibrated to dB SPL re 20 µPa; `gain`: a gain-corrected FS file instead (dBFS, calibrated). */
function calibrated(leq: number, band: number, gain = false): ScanResult {
    const raw = scan(leq, band);
    return { ...raw, input: { ...raw.input!, ...(gain ? {} : { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa' }), calibrationStatus: 'calibrated' } };
}

/** A 2D context that records each text drawn; the canvas keeps its data attributes. */
function recordingCanvas(): { canvas: HTMLCanvasElement; texts: string[] } {
    const texts: string[] = [];
    const context = new Proxy({}, {
        get: (_target, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : (...args: unknown[]) => { if (key === 'fillText') texts.push(String(args[0])); }),
        set: () => true,
    });
    const canvas = { width: 0, height: 0, clientWidth: 900, clientHeight: 320, ownerDocument: {}, dataset: {}, setAttribute: () => undefined, getContext: () => context } as unknown as HTMLCanvasElement;
    return { canvas, texts };
}

test('a report figure draws levels of another reference on their own axis, each named by its own recordings, and each uncalibrated line says so (R1, R4)', () => {
    const strings = getStrings('ja');
    const cases: Array<{ base: ScanResult; compare: ScanResult; left: string; right: string | null; baseWord: boolean; compareWord: boolean }> = [
        // Slot 0 in dB SPL, slot 1 uncalibrated dBFS: Δ withheld, and never one read on the other's numbers.
        // Each on its own axis, which says uncalibrated itself: the legend names that axis, once (calibrationWords).
        { base: calibrated(60, 50), compare: scan(-20, -30), left: 'レベル [dB SPL re 20 µPa]', right: 'レベル 未校正 [dBFS]', baseWord: false, compareWord: true },
        { base: scan(-20, -30), compare: calibrated(60, 50), left: 'レベル 未校正 [dBFS]', right: 'レベル [dB SPL re 20 µPa]', baseWord: true, compareWord: false },
        // One reference (dBFS), calibrated apart: one axis, the uncalibrated line names itself.
        { base: scan(-20, -30), compare: calibrated(-18, -28, true), left: 'レベル [dBFS]', right: null, baseWord: true, compareWord: false },
        // Both uncalibrated on one axis named so: neither line repeats it.
        { base: scan(-20, -30), compare: scan(-18, -28), left: 'レベル 未校正 [dBFS]', right: null, baseWord: false, compareWord: false },
        { base: calibrated(60, 50), compare: calibrated(62, 52), left: 'レベル [dB SPL re 20 µPa]', right: null, baseWord: false, compareWord: false },
    ];
    for (const { base, compare, left, right, baseWord, compareWord } of cases) {
        const results = new Map<string, ScanResult>([['/f/base.wav', base], ['/f/cmp.wav', compare]]);
        const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
        const comparison = compareOf(model, results, '/f/cmp.wav', '/f/base.wav', strings);
        const what = `${left} / ${right}`;
        assert.equal(comparison.blocked === 'unit', right !== null, `${what}: the Δ is withheld exactly when the references differ`);
        const axes = reportLevelAxes(comparison, { results }, strings);
        assert.deepEqual([axes.left, axes.right], [left, right], what);
        assert.equal(axes.legend.base.includes(strings.entryLeqUncalibrated), baseWord, what);
        assert.equal(axes.legend.compare.includes(strings.entryLeqUncalibrated), compareWord, what);
        // Said once: never a word of its own and its axis' name both.
        for (const said of [axes.legend.base, axes.legend.compare]) assert.ok(said.split(strings.entryLeqUncalibrated).length <= 2, `${what}: ${said}`);
        // The painted figure (off screen, so no canvas audit sees it) names both axes and writes each line's word.
        const { canvas, texts } = recordingCanvas();
        const input = { model, results, slots: ['/f/base.wav', '/f/cmp.wav', null, null], compare: () => comparison, region: null, recipe: null, recipeName: 'r', now: new Date(), stale: new Set<string>() };
        paintOverlayFigure(canvas, comparison, 1, 'title', strings, input, { width: 900, height: 320 });
        // Without bins the figure draws the 1/3-octave bands: its horizontal axis is the bands' centres, as the comparison names it.
        assert.equal(canvas.dataset.plotAxes, [strings.axisBand, left, ...(right ? [right] : [])].join('|'), what);
        const legend = texts.filter(text => text.startsWith(strings.reportBase) || text.startsWith(strings.reportCompare));
        assert.equal(legend.length, 2, `${what}: ${JSON.stringify(texts)}`);
    }
});

test('the CSVs say each row\'s level reference beside its levels: never one calibration word for the whole table (R1, R4)', () => {
    const strings = getStrings('ja');
    const results = new Map<string, ScanResult>([['/f/L1_900rpm_run1.wav', scan(-20, -30)], ['/f/L1_900rpm_run2.wav', calibrated(60, 50)], ['/f/L1_900rpm_run3.wav', calibrated(62, 52)]]);
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    const csv = reportCsv({ model, results, slots: ['/f/L1_900rpm_run2.wav', '/f/L1_900rpm_run3.wav', '/f/L1_900rpm_run1.wav', null], compare: compareFor(model, results, ['/f/L1_900rpm_run2.wav']), region: null, recipe: entry, recipeName: 'entry-scan', now: new Date(), stale: new Set<string>() }, strings);
    const [header, ...rows] = csv.slice(1).trimEnd().split('\r\n');
    const names = header.split(',');
    assert.ok(!names.some(name => name.includes(strings.entryLeqUncalibrated)), 'no heading carries a calibration word');
    const at = (row: string, name: string): string => row.split(',')[names.indexOf(name)];
    assert.deepEqual(rows.map(row => [at(row, strings.reportLevelReference), at(row, strings.reportBaseLevelReference)]), [
        ['dB SPL re 20 µPa', 'dB SPL re 20 µPa'],
        // The uncalibrated file against a calibrated base: both levels, each with its own reference (no Δ across them).
        ['dBFS 未校正', 'dB SPL re 20 µPa'],
    ]);
});

test('a report figure writes each tick of its level axes, the right-hand one too, and of its Δ axis where that axis paints its number (R9, R14)', () => {
    const strings = getStrings('ja');
    // One reference (one axis), and two (a right-hand axis of its own): the overlay figure; and the Δ figure.
    const cases: Array<{ base: ScanResult; compare: ScanResult; right: boolean }> = [
        { base: calibrated(60, 50), compare: calibrated(62.3, 51.7), right: false },
        { base: calibrated(60, 50), compare: scan(-20, -30), right: true },
    ];
    for (const { base, compare, right } of cases) {
        const results = new Map<string, ScanResult>([['/f/base.wav', base], ['/f/cmp.wav', compare]]);
        const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
        const comparison = compareOf(model, results, '/f/cmp.wav', '/f/base.wav', strings);
        const input = { model, results, slots: ['/f/base.wav', '/f/cmp.wav', null, null], compare: () => comparison, region: null, recipe: null, recipeName: 'r', now: new Date(), stale: new Set<string>() };
        const figures: Array<[string, (canvas: HTMLCanvasElement) => void]> = [
            ['overlay', canvas => paintOverlayFigure(canvas, comparison, 1, 'title', strings, input, { width: 900, height: 320 })],
            ...(right ? [] : [['Δ', (canvas: HTMLCanvasElement) => paintDeltaFigure(canvas, comparison, 'title', 'curve', strings, input, { width: 900, height: 260 })] as [string, (canvas: HTMLCanvasElement) => void]]),
        ];
        for (const [name, paint] of figures) {
            const { canvas, written } = placeRecordingCanvas({ width: 900, height: 320 });
            paint(canvas);
            const ticks = misplacedTicks(canvas, written);
            const what = `${name} figure${right ? ' with a right-hand axis' : ''}`;
            assert.ok(ticks.declared, `${what}: paintOverlay says where its axes paint (__plotTickPlaces)`);
            assert.ok(ticks.judged >= (right ? 4 : 2), `${what}: its level axes write their ticks (${JSON.stringify(written)})`);
            assert.deepEqual(ticks.wrong, [], `${what}: a tick written where its axis does not paint its number (display rules R9, R14: place each tick by the transform the picture is painted with, stagePanes.placedTicks)`);
        }
    }
});
