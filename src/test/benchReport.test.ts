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
import { reportCsv, reportDefinitions, reportFolderName, reportOctaveRecipe, reportRecipe } from '../webview/runtime/compareReport';

const repoRoot = path.resolve(__dirname, '..', '..');
const entry = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const BAND_3150 = BAND_CENTERS_HZ.indexOf(3150);

function scan(leq: number, band: number): ScanResult {
    return {
        ok: true, conditionId: 'c', specVersion: 2, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: 16000, channels: [0], durationS: 2, unit: 'FS', ref: 1 },
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
    const csv = reportCsv({ model, results, slots: [null, '/f/L1_900rpm_run3.wav', null, null], region: { start: 0.5, end: 1.5 }, recipe: entry, recipeName: 'entry-scan', now: new Date() }, getStrings('ja'));
    assert.ok(csv.startsWith('﻿'));
    const [header, row, ...rest] = csv.slice(1).trimEnd().split('\r\n');
    assert.equal(rest.length, 0);
    assert.equal(header, `ファイル,Δ最大帯域 Hz,Δ最大帯域 dB,条件 1,条件 2,開始 s,終了 s,Leq dB(A) 未校正,基準 Leq,Δ Leq dB(A),${header.split(',').filter(name => /^Δ [\d.]+ k?Hz dB$/.test(name)).join(',')},基準群 n,基準群ファイル,解析仕様版,外れ値,手順`);
    assert.ok(header.includes(',Δ 3.15 kHz dB,'));
    const cells = row.split(',');
    // Where the file differs most comes first.
    assert.deepEqual(cells.slice(0, 7), ['L1_900rpm_run3.wav', '3150', '20.5', 'L1', '900rpm', '0.50', '1.50']);
    assert.equal(Math.round((Number(cells[7]) - Number(cells[8])) * 10) / 10, Number(cells[9]));
    assert.equal(cells[header.split(',').indexOf('Δ 3.15 kHz dB')], '20.5');
    assert.deepEqual(cells.slice(-5, -2), ['2', 'L1_900rpm_run1.wav;L1_900rpm_run2.wav', '2']);
    // Which chain the numbers are of: the Recipe beside the CSV, or the previous one where it was not measured again.
    assert.equal(cells.at(-1), getStrings('ja').reportChainCurrent);
    const previous = reportCsv({ model, results, slots: [null, '/f/L1_900rpm_run3.wav', null, null], region: null, recipe: entry, recipeName: 'entry-scan', now: new Date(), stale: new Set(['/f/L1_900rpm_run1.wav']) }, getStrings('ja'));
    assert.equal(previous.trimEnd().split('\r\n')[1].split(',').at(-1), getStrings('ja').reportChainPrevious);
    const whole = reportCsv({ model, results, slots: [null, '/f/L1_900rpm_run3.wav', null, null], region: null, recipe: entry, recipeName: 'entry-scan', now: new Date() }, getStrings('ja'));
    // The whole file is written as the region actually measured: its guarded ends are left out.
    assert.deepEqual(whole.split('\r\n')[1].split(',').slice(5, 7), ['0.15', '1.85']);
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
    const definitions = reportDefinitions({ model, results: new Map(), slots: [], region: { start: 0.5, end: 1.5 }, recipe: entry, recipeName: 'entry-scan', now: new Date() }, 2, getStrings('ja')) as {
        region: unknown; metrics: Record<string, string>; steps: Array<{ operation: string; params: Record<string, unknown> }>;
    };
    assert.deepEqual(definitions.region, { startS: 0.5, endS: 1.5 });
    assert.match(definitions.metrics['Leq dB(A)'], /A 特性/);
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
