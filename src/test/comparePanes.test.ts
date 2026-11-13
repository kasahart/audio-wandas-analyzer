import { wholeValues } from './helpers/whole';
import assert from 'node:assert/strict';
import { drawableLine } from '../shared/drawnPoints';
import { assertNotDrawn, averagedInto } from './fullNotDrawn';
import { compareOf } from './helpers/compareInput';
import { binnedAnswers } from '../webview/runtime/entryBase';
import { scanAnswer } from '../webview/runtime/answerStore';
import { N, R } from './helpers/figure';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { held } from './helpers/heldSource';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { getStrings } from '../shared/i18n/strings';
import { BAND_CENTERS_HZ, buildEntryModel, regionKey, regionLabel } from '../webview/runtime/entryTable';
import { deltaFigure } from '../webview/runtime/compareReport';
import { SPECTRUM_POINTS, binsSource, binsView, deltaViews, diffHeadline, minMaxLine, sameCondition, legendHtml, levelsHeadline, paneAxes, trackLevelInput, type LevelInput } from '../webview/runtime/comparePanes';
import type { ChannelSummary } from '../shared/analysis/analysisTypes';
import { byLevel, paintOverlay, stageAxes } from '../webview/runtime/stagePanes';
import { NO_FULL_DATA } from '../webview/runtime/fullRead';
import type { StageView } from '../shared/protocol/backendProtocol';

const STR = getStrings('en');
const BAND_3150 = BAND_CENTERS_HZ.indexOf(3150);

function scan(leq: number, spectrum: number[], band3150: number): ScanResult {
    return {
        ok: true, conditionId: 'c', specVersion: 2, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: 16000, channels: [0], durationS: 2, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true },
        leqDbA: [leq], peakHz: [100], spectrumDb: [spectrum],
        thirdOctDb: [BAND_CENTERS_HZ.map((_, band) => (band === BAND_3150 ? band3150 : -60 + band * 0.1))], crest: [1.4],
    };
}

const files = new Map<string, ScanResult>([
    ['/f/L1_900rpm_run1.wav', scan(-20.04, [-40, -50, -60], -30)],
    ['/f/L1_900rpm_run2.wav', scan(-20.0, [-42, -50, -61], -31)],
    ['/f/L1_900rpm_run3.wav', scan(-10.06, [-20, -50, -40], -10)],
    ['/f/free.wav', scan(-25, [-30, -30, -30], -40)],
]);
const model = buildEntryModel([...files].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });

test('the base is the median of the compared file\'s condition without it, point by point, and Δ is taken from the full levels', () => {
    const comparison = compareOf(model, files, '/f/L1_900rpm_run3.wav', null, STR);
    assert.equal(comparison.base!.title, 'Base group · L1 · 900rpm · 2 files');
    assert.deepEqual(comparison.base!.filePaths, ['/f/L1_900rpm_run1.wav', '/f/L1_900rpm_run2.wav']);
    // The scans' 192 points are drawn points (scan_service.log_spectrum): no median and no Δ is taken of them (R1).
    assert.equal(Object.hasOwn(comparison.base!, 'spectrumDb'), false);
    assert.equal(Object.hasOwn(comparison, 'diffDb'), false);
    assert.equal(comparison.comparable, true);
    // Log-spaced from 20 Hz to Nyquist: each of the scan's points is the geometric centre of its edges (8 kHz Nyquist).
    assert.equal(comparison.frequencies.length, SPECTRUM_POINTS);
    assert.ok(Math.abs(comparison.frequencies[0] - 20 * 400 ** (0.5 / SPECTRUM_POINTS)) < 1e-9);
    const { base, compare, delta } = comparison.leq!;
    // Δ is the full levels' difference, never that of levels rounded first.
    assert.equal(delta, compare - base);
    assert.equal(comparison.topBands[0].band, BAND_3150);
    assert.equal(comparison.topBands[0].delta, 20.5);
    assert.ok(diffHeadline(comparison).startsWith('3.15 kHz +20.5 · '));
    assert.ok(diffHeadline(comparison).endsWith(`Leq ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} dB`));
});

test('slot 0 makes one file the base; without a condition or a slot 0 there is no base', () => {
    const single = compareOf(model, files, '/f/L1_900rpm_run3.wav', '/f/free.wav', STR);
    assert.equal(single.base!.title, 'Base · free.wav');
    assert.deepEqual(single.base!.filePaths, ['/f/free.wav']);
    const none = compareOf(model, files, '/f/free.wav', null, STR);
    assert.equal(none.base, null);
    assert.equal(none.comparable, false);
    assert.equal(diffHeadline(none), '—');
});

test('a Δ that cannot be read is withheld: the file against itself, a group of one, a base over another region', () => {
    const self = compareOf(model, files, '/f/L1_900rpm_run3.wav', '/f/L1_900rpm_run3.wav', STR);
    assert.equal(self.blocked, 'self');
    assert.equal(self.comparable, false);
    assert.deepEqual(self.topBands, []);
    assert.equal(diffHeadline(self, STR), '— · ≠ same file');
    assert.equal(self.leq!.compare, -10.06);
    const alone = new Map<string, ScanResult>([['/s/L2_1800rpm_run1.wav', scan(-20, [-40, -50, -60], -30)]]);
    const lone = buildEntryModel([...alone].map(([filePath, result]) => ({ filePath, result })), null);
    const single = compareOf(lone, alone, '/s/L2_1800rpm_run1.wav', null, STR);
    assert.equal(single.blocked, 'single');
    assert.equal(diffHeadline(single, STR), '— · n=1');
    const region = compareOf(model, files, '/f/L1_900rpm_run3.wav', null, STR, true);
    assert.equal(region.blocked, 'region');
    assert.equal(diffHeadline(region, STR), '— · ≠ region');
    // A file in slot 0 is scanned over the region too, so the flag does not apply to it.
    assert.equal(compareOf(model, files, '/f/L1_900rpm_run3.wav', '/f/free.wav', STR, true).blocked, undefined);
});


test('levels in another unit, reference or calibration have no Δ and no shared median, whichever way the base is made', () => {
    const calibrated = (leq: number): ScanResult => {
        const result = scan(leq, [60, 50, 40], 70);
        return { ...result, input: { ...result.input!, unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false } };
    };
    const mixed = new Map<string, ScanResult>([
        ['/m/L1_900rpm_run1.wav', scan(-20, [-40, -50, -60], -30)],
        ['/m/L1_900rpm_run2.wav', scan(-21, [-41, -50, -61], -31)],
        ['/m/L1_900rpm_run3.wav', calibrated(62)],
        ['/m/L1_900rpm_run4.wav', calibrated(64)],
    ]);
    const mixedModel = buildEntryModel([...mixed].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    // Slot 0 in another unit: both levels stay, the Δ is withheld (as the backend's noDelta 'unit').
    const single = compareOf(mixedModel, mixed, '/m/L1_900rpm_run3.wav', '/m/L1_900rpm_run1.wav', STR);
    assert.equal(single.blocked, 'unit');
    assert.equal(single.comparable, false);
    assert.deepEqual(single.bandDeltas, []);
    assert.equal(single.bins?.diff ?? null, null);
    assert.ok(Number.isNaN(single.leq!.delta));
    assert.equal(diffHeadline(single, STR), '— · ≠ level reference');
    // Both levels stay, each named by its own reference (no bare dB).
    assert.equal(levelsHeadline(single, STR), 'Leq base −20.0 dBFS, uncalibrated / compare 62.0 dB SPL re 20 µPa · — · ≠ level reference');
    // A group: only its files in the compared file's unit make the median; the rest are left out.
    const group = compareOf(mixedModel, mixed, '/m/L1_900rpm_run4.wav', null, STR, false, undefined,
        { paths: ['/m/L1_900rpm_run1.wav', '/m/L1_900rpm_run2.wav', '/m/L1_900rpm_run3.wav'], title: 'g' });
    assert.deepEqual(group.base!.filePaths, ['/m/L1_900rpm_run3.wav']);
    assert.equal(group.blocked, undefined);
    assert.equal(group.leq!.delta, 2);
    // A group with none in the compared file's level identity: every one left out (another reference, never counted
    // as the base's), so no median and no Δ, and the comparison says why.
    const other = compareOf(mixedModel, mixed, '/m/L1_900rpm_run4.wav', null, STR, false, undefined,
        { paths: ['/m/L1_900rpm_run1.wav', '/m/L1_900rpm_run2.wav'], title: 'g' });
    assert.equal(other.blocked, 'unit');
    assert.equal(other.base, null);
    assert.equal(other.leq, null);
    assert.equal(other.comparable, false);
    assert.equal(diffHeadline(other, STR), '— · ≠ level reference');
});

test('a tone that leaks into the neighbouring bands heads the list alone: only peaks of |Δ| across bands count', () => {
    const leak = (center: number, side: number): ScanResult => ({
        ...scan(-20, [-40, -50, -60], -30),
        thirdOctDb: [BAND_CENTERS_HZ.map((_, band) => (band === BAND_3150 ? center : Math.abs(band - BAND_3150) === 1 ? side : -60))],
    });
    const leaking = new Map<string, ScanResult>([
        ['/l/L1_900rpm_run1.wav', leak(-60, -60)], ['/l/L1_900rpm_run2.wav', leak(-60, -60)], ['/l/L1_900rpm_run3.wav', leak(-40, -56)],
    ]);
    const leakModel = buildEntryModel([...leaking].map(([filePath, result]) => ({ filePath, result })), null);
    const comparison = compareOf(leakModel, leaking, '/l/L1_900rpm_run3.wav', null, STR);
    assert.deepEqual(comparison.topBands, [{ band: BAND_3150, delta: 20 }]);
    // The neighbours are still drawn as steps.
    assert.equal(Math.round(comparison.bandDeltas[BAND_3150 + 1]!), 4);
});

test('against one base file, a band within the chance spread of its condition is not headline material', () => {
    // The base's condition: four files whose 3.15 kHz band varies by about ±1 dB around −30.
    const peers: Array<[string, number]> = [['/c/L5_900rpm_run1.wav', -31], ['/c/L5_900rpm_run2.wav', -29], ['/c/L5_900rpm_run3.wav', -30.5], ['/c/L5_900rpm_run4.wav', -29.5]];
    const files = new Map<string, ScanResult>([
        ...peers.map(([path, band]) => [path, scan(-20, [-40, -50, -60], band)] as [string, ScanResult]),
        ['/c/L5_900rpm_base.wav', scan(-20, [-40, -50, -60], -30)],
        ['/c/L5_900rpm_near.wav', scan(-20, [-40, -50, -60], -28.2)],
        ['/c/L5_900rpm_far.wav', scan(-20, [-40, -50, -60], -20)],
    ]);
    const model = buildEntryModel([...files].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    const near = compareOf(model, files, '/c/L5_900rpm_near.wav', '/c/L5_900rpm_base.wav', STR);
    assert.deepEqual(near.topBands, []);
    assert.equal(diffHeadline(near, STR), `${STR.compareNoSignificant} · Leq +0.0 dB`);
    const far = compareOf(model, files, '/c/L5_900rpm_far.wav', '/c/L5_900rpm_base.wav', STR);
    assert.deepEqual(far.topBands.map(item => item.band), [BAND_3150]);
});

test('every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files', () => {
    const texts: string[] = [];
    const context = new Proxy({}, {
        get: (_target, key) => (key === 'fillText' ? (text: string) => { texts.push(text); } : key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
        set: () => true,
    });
    const canvas = { width: 0, height: 0, clientWidth: 600, clientHeight: 200, ownerDocument: {}, getContext: () => context } as unknown as HTMLCanvasElement;
    const ja = getStrings('ja');
    const uncal = paneAxes(ja, { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true });
    const view = (values: number[]): StageView => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000], values });
    paintOverlay(canvas, { layers: [{ view: view([-40, -50]), color: '#00f', full: held(view([-40, -50])) }] }, R({ min: -80, max: 0 }), N(uncal.level));
    assert.ok(texts.includes('レベル 未校正 [dBFS]') && texts.includes('周波数 [Hz]'));
    // The top tick is a number only: the unit is in the axis name.
    assert.ok(!texts.some(text => /^0 dB$/.test(text)));
    texts.length = 0;
    paintOverlay(canvas, { layers: [{ view: view([1, 2]), color: '#0f0', full: held(view([1, 2])) }] }, R({ min: -8, max: 8 }), N(uncal.delta), { diff: true, bandSteps: { deltas: [], headline: [], color: '#0f0', legend: uncal.delta.legend } });
    assert.ok(['差 Δ [dB]', '1/3 oct 見出し', '漏れ', '点ごとの差'].every(text => texts.includes(text)));
    assert.equal(paneAxes(ja, { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true }).level.y, 'レベル [dB SPL re 20 µPa]');
});

const FS: LevelInput = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true };
const RAW: LevelInput = { unit: '', ref: 1, levelReferenceLabel: 'dB re 1 input unit', calibrationStatus: 'uncalibrated', fullScale: false };
const SPL: LevelInput = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true };

test('the level axis is named by wandas\' level reference, and says uncalibrated from the calibration status, not the unit', () => {
    for (const [language, fullScaleAxis, rawAxis, splAxis] of [
        ['en', 'Level, uncalibrated [dBFS]', 'Level, uncalibrated [dB re 1 input unit]', 'Level [dB SPL re 20 µPa]'],
        ['ja', 'レベル 未校正 [dBFS]', 'レベル 未校正 [dB re 1 input unit]', 'レベル [dB SPL re 20 µPa]'],
    ] as const) {
        const strings = getStrings(language);
        assert.equal(paneAxes(strings, FS).level.y, fullScaleAxis);
        assert.equal(paneAxes(strings, RAW).level.y, rawAxis);
        assert.equal(paneAxes(strings, SPL).level.y, splAxis);
        assert.equal(paneAxes(strings, { ...SPL, fullScale: false }).level.y, splAxis, 'a calibrated CSV names its calibration');
        // A calibration to 1 V is calibrated even with a reference of 1.
        assert.equal(paneAxes(strings, { unit: 'V', ref: 1, levelReferenceLabel: 'dB re 1 V', calibrationStatus: 'calibrated', fullScale: true }).level.y, splAxis.replace('dB SPL re 20 µPa', 'dB re 1 V'));
        // No input: no reference is known, and the axis says so rather than a guessed dBFS (R4, V8).
        assert.equal(paneAxes(strings, undefined).level.y, strings.axisLevelCal.replace('{label}', strings.axisUnitUnknown));
        assert.notEqual(paneAxes(strings, undefined).level.y, fullScaleAxis);
    }
    const waveform = { min: [0], max: [1], minT: [0], maxT: [0], absolutePeak: 1, ref: 1 };
    const view = (unit: string): StageView => ({ frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0], values: [0], waveform: { ...waveform, unit } });
    // A waveform says it is uncalibrated as the level axis does; a calibrated one names its unit only.
    assert.equal(stageAxes(STR, view('FS'), { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true }).y, 'Amplitude, uncalibrated [FS]');
    // No unit sent is no unit claimed (stage_view.signal_unit sends '' where an operation's effect on it is not known).
    assert.equal(stageAxes(STR, view(''), RAW).y, 'Amplitude [unit unknown]');
    assert.equal(stageAxes(STR, view('Pa'), SPL).y, 'Amplitude [Pa]');
    // Its Δ is compare − base sample by sample (a ChannelFrame subtraction), in the same unit: never a level the comparison makes.
    assert.equal(stageAxes(STR, view('Pa'), SPL, true).y, 'Δ Amplitude [Pa]');
    // After rms_trend, sound_level or power the axis names that measure; power is in the unit squared.
    assert.equal(stageAxes(STR, { ...view('Pa'), measure: 'timeWeightedRms' }, SPL).y, 'Time-weighted RMS [Pa]');
    // A power's unit comes raised from the backend (stage_view.signal_unit); the axis writes it as given.
    assert.equal(stageAxes(STR, { ...view('FS²'), measure: 'power' }, FS).y, 'Power, uncalibrated [FS²]');
    const series: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [0], values: [0], measure: 'rms' };
    assert.equal(stageAxes(getStrings('ja'), series, FS).y, '実効値 未校正 [FS]');
});

test('the headline gives both levels, and a band far below the loudest does not head it however large its Δ', () => {
    const comparison = compareOf(model, files, '/f/L1_900rpm_run3.wav', null, STR);
    assert.match(levelsHeadline(comparison, STR), /^3\.15 kHz base −30\.5 \/ compare −10\.0 dBFS · Leq base −20\.0 \/ compare −10\.1 dBFS$/);
    // A level that rounds to zero is written without a sign, as levelText writes it (R7).
    const nearZero = { ...comparison, topBands: [], leq: { base: -0.04, compare: 0.04, delta: 0.08 } };
    assert.ok(!levelsHeadline(nearZero, STR).includes('−0.0'), levelsHeadline(nearZero, STR));
    // 60 → 65 dB is heard; 20 → 30 dB under it is not: only the loud band heads the list.
    const level = (band3150: number, quiet: number) => {
        const result = scan(-20, [-40, -50, -60], band3150);
        result.thirdOctDb = [BAND_CENTERS_HZ.map((_, band) => (band === BAND_3150 ? band3150 : band === 5 ? quiet : -90))];
        return result;
    };
    const loud = new Map<string, ScanResult>([['/g/L2_1200rpm_run1.wav', level(60, 20)], ['/g/L2_1200rpm_run2.wav', level(60, 20)], ['/g/L2_1200rpm_run3.wav', level(65, 30)]]);
    const loudModel = buildEntryModel([...loud].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    const heard = compareOf(loudModel, loud, '/g/L2_1200rpm_run3.wav', null, STR);
    assert.deepEqual(heard.topBands.map(item => item.band), [BAND_3150]);
    assert.ok(levelsHeadline(heard, STR).startsWith('3.15 kHz base 60.0 / compare 65.0 dBFS · '));
    // A group of three or more files carries its quartiles for the band under its median.
    assert.equal(compareOf(model, files, '/f/free.wav', '/f/L1_900rpm_run1.wav', STR).base!.spread, undefined);
});

test('a legend item ends with the markup its caller adds (the base group\'s ▾), after its label', () => {
    const strings = getStrings('en');
    const html = legendHtml([
        { color: '#000', label: 'Base <group>', trailingHtml: '<button data-action="stage-base-info">▾</button>' },
        { color: '#111', label: 'a.wav', path: '/a.wav', value: 'Leq 60.0' },
    ], strings);
    assert.match(html, /^<span class="compare-legend-item"><svg[^]*<span class="compare-legend-label">Base &lt;group&gt;<\/span><button data-action="stage-base-info">▾<\/button><\/span><span class="compare-legend-item">/);
    assert.equal(html.split('stage-base-info').length, 2);
});

test('a track with no entry result takes its level reference from its own analysis', () => {
    const waveform = { min: [], max: [], samples: [], absolutePeak: 0 };
    const channel = (fullScale: boolean, measurement?: ChannelSummary['measurement']): ChannelSummary => ({ label: 'L', peakAbsolute: 1, fullScale, sourceUnit: fullScale ? 'FS' : '', sourceLevelReferenceLabel: fullScale ? 'dBFS' : 'dB re 1 input unit', waveform, spectrogram: null, ...(measurement ? { measurement } : {}) });
    const pa = { calibrationStatus: 'calibrated', calibrationSource: 'manual', factor: 2, linearUnit: 'Pa', referenceValue: 2e-5, referenceUnit: 'Pa', levelUnit: 'dB SPL', levelReferenceLabel: 'dB SPL re 20 µPa' } as const;
    const g = { ...pa, linearUnit: 'm/s^2', referenceValue: 1, referenceUnit: 'm/s^2', levelUnit: 'dB', levelReferenceLabel: 'dB re 1 m/s^2' } as const;
    const fs = { calibrationStatus: 'uncalibrated', calibrationSource: 'default', factor: 1, linearUnit: 'FS', referenceValue: 1, referenceUnit: 'FS', levelUnit: 'dBFS', levelReferenceLabel: 'dBFS' } as const;
    assert.deepEqual(trackLevelInput([channel(true)], RAW), RAW, 'the entry table\'s scan wins');
    assert.deepEqual(trackLevelInput([channel(false)], undefined), RAW);
    assert.deepEqual(trackLevelInput([channel(true)], undefined), FS);
    assert.deepEqual(trackLevelInput([channel(true, fs), channel(true, fs)], undefined), FS);
    assert.deepEqual(trackLevelInput([channel(false, pa)], undefined), { ...SPL, fullScale: false }, 'a calibrated CSV keeps its calibration');
    const plain = { unit: '', ref: 1, levelReferenceLabel: 'dB', calibrationStatus: 'calibrated', fullScale: true };
    // Channels calibrated apart share no reference: never a bare "dB" (C1). A picture is of one channel, which its
    // caller passes alone; given several, the first calibrated one's reference names them.
    const spl = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true };
    assert.deepEqual(trackLevelInput([channel(true, pa), channel(true, g)], undefined), spl);
    assert.deepEqual(trackLevelInput([channel(true, fs), channel(true, pa)], undefined), spl, 'nor do Pa and an uncalibrated channel');
    assert.deepEqual(trackLevelInput([channel(true, g)], undefined), { unit: 'm/s^2', ref: 1, levelReferenceLabel: 'dB re 1 m/s^2', calibrationStatus: 'calibrated', fullScale: true }, 'the channel read, alone');
    // A gain correction in FS keeps dBFS: it shares the uncalibrated channel's reference, as the scan judges it.
    const gain = { ...fs, calibrationStatus: 'calibrated', calibrationSource: 'manual', factor: 2 } as const;
    assert.deepEqual(trackLevelInput([channel(true, gain), channel(true, fs)], undefined), FS);
    assert.equal(paneAxes(STR, trackLevelInput([channel(true, gain), channel(true, fs)], undefined)).level.y, 'Level, uncalibrated [dBFS]');
    assert.deepEqual(trackLevelInput([channel(true, gain), channel(true, gain)], undefined), { ...FS, calibrationStatus: 'calibrated' });
    assert.equal(paneAxes(STR, plain as LevelInput).level.y, 'Level [dB]');
    assert.equal(paneAxes(STR, trackLevelInput([channel(false)], undefined)).level.y, 'Level, uncalibrated [dB re 1 input unit]');
    assert.equal(paneAxes(STR, trackLevelInput([channel(true)], undefined)).level.y, 'Level, uncalibrated [dBFS]');
});

test('the median and Δ are taken bin by bin from every bin, and only drawing decimates them', () => {
    // 4096 bins of 2 Hz (16 kHz, n_fft 8192): a narrow rise at one bin of the compared file only.
    const flat = (level: number, at?: number, rise = 0): number[] => Array.from({ length: 4097 }, (_, bin) => (bin === at ? level + rise : level));
    const withBins = (result: ScanResult, rows: number[][]): ScanResult => ({ ...result, spectrumBinsDb: rows, spectrumBinHz: 2 });
    const binned = new Map<string, ScanResult>([
        ['/f/L1_900rpm_run1.wav', withBins(files.get('/f/L1_900rpm_run1.wav')!, [flat(-60)])],
        ['/f/L1_900rpm_run2.wav', withBins(files.get('/f/L1_900rpm_run2.wav')!, [flat(-62)])],
        ['/f/L1_900rpm_run3.wav', withBins(files.get('/f/L1_900rpm_run3.wav')!, [flat(-61, 1500, 40)])],
    ]);
    const comparison = compareOf(model, binned, '/f/L1_900rpm_run3.wav', null, STR);
    const bins = comparison.bins!;
    assert.equal(bins.base![1500], -61, 'the median of -60 and -62 at every bin');
    assert.equal(bins.diff![1500], 40);
    assert.equal(bins.diff![1499], 0);
    // Drawn in 640 log-spaced buckets of their lowest and highest bin: the narrow rise keeps its full height.
    const drawn = binsView(bins, 'diff')!;
    assert.ok(drawn.xs!.length <= 2 * 640);
    assert.equal(Math.max(...(drawn.values as number[])), 40);
    assert.equal(drawn.xs![(drawn.values as number[]).indexOf(40)], 3000);
    assert.deepEqual(drawn.xLimits, [20, 8000]);
    // Zoomed: every bin on screen, still at its own frequency, and the one beyond each end for the line to the edge.
    const zoomed = binsView(bins, 'diff', [2900, 3100], 300)!;
    assert.equal(zoomed.xs!.length, 103);
    assert.deepEqual([zoomed.xs![0], zoomed.xs!.at(-1)], [2898, 3102]);
    assert.equal(zoomed.detail, true);
});

test('a spectrum drawn from its bins carries every bin\'s lowest and highest value in its span as its range, the silent floor left out (R1)', () => {
    const base = Array.from({ length: 4097 }, (_, bin) => -60 + Math.sin(bin) * 3);
    base[700] = -11; base[701] = -300; base[5] = -95;
    const diff = base.map((value, bin) => (bin === 2100 ? -27 : bin === 3000 ? 14 : 0));
    const bins = { hz: 2, nyquist: 8192, base: wholeValues(base), compare: wholeValues(base), diff: wholeValues(diff) };
    const inSpan = (values: number[], low: number, high: number, silent: boolean): { min: number; max: number } => {
        const kept = values.filter((value, bin) => bin * 2 >= low && bin * 2 <= high && bin > 0 && !(silent && value <= -250));
        return { min: Math.min(...kept), max: Math.max(...kept) };
    };
    assert.deepEqual(binsView(bins, 'base', undefined, 8)!.valueRange, inSpan(base, 20, 8192, true));
    assert.deepEqual(binsView(bins, 'diff', undefined, 8)!.valueRange, inSpan(diff, 20, 8192, false));
    // Zoomed: the bins between the ends and one beyond each, not the whole spectrum's.
    assert.deepEqual(binsView(bins, 'diff', [4000, 5000], 8)!.valueRange, inSpan(diff, 3998, 5002, false));
    assert.deepEqual(binsView(bins, 'base', [1000, 1500], 8)!.valueRange, inSpan(base, 998, 1502, true));
    // A line thinned by averaging to as many points loses the one-bin extremes: its range is not these.
    const averagedRange = (values: number[]): { min: number; max: number } => ({ min: Math.min(...averagedInto(values, 16)), max: Math.max(...averagedInto(values, 16)) });
    assertNotDrawn(binsView(bins, 'base', undefined, 8)!.valueRange, averagedRange(base), 'the range holds every bin');
    assertNotDrawn(binsView(bins, 'diff', undefined, 8)!.valueRange, averagedRange(diff), 'the Δ range holds every bin');
});

test('a line decimated for drawing keeps each bucket\'s lowest and highest value at their own places', () => {
    const xs = Array.from({ length: 1000 }, (_, index) => index + 1);
    const values = xs.map(() => 0);
    values[122] = 9;
    values[776] = -4;
    const line = minMaxLine(xs, values, 50, [1, 1000], 'log');
    assert.ok(line.xs.length <= 100);
    assert.equal(line.xs[line.values.indexOf(9)], 123);
    assert.equal(line.xs[line.values.indexOf(-4)], 777);
});

test('the webview thins a spectrum exactly as the backend does: the shared cases both test suites check (#683)', () => {
    const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), 'src/test/fixtures/spectrumDecimation.json'), 'utf8')) as {
        cases: Array<{ name: string; binHz: number; bins: number; values: Array<number | null>; buckets: number; span: [number, number]; expectedBins: number[] }>;
    };
    assert.ok(fixture.cases.length >= 5);
    for (const item of fixture.cases) {
        const xs = Array.from({ length: item.bins }, (_, bin) => bin * item.binHz);
        const line = minMaxLine(xs, item.values.map(value => value ?? Number.NaN), item.buckets, item.span, 'log');
        assert.deepEqual(line.xs.map(x => Math.round(x / item.binHz)), item.expectedBins, item.name);
    }
});

test('a comparison takes no number of the scans\' 192 drawn points: its base, Δ and figures are the same whatever they hold (R1)', () => {
    // The bins and bands of every file, with 192 drawn points that disagree with them wildly, file by file.
    const binned = new Map<string, ScanResult>([...files].map(([path, result], index) => [path, { ...result, spectrumBinsDb: [[-60 - index, -50, -40 + index]], spectrumBinHz: 2 }]));
    const drawn = new Map<string, ScanResult>([...binned].map(([path, result], index) => [path, { ...result, spectrumDb: [[100 * (index + 1), -200, 7 * index]] }]));
    const of = (results: Map<string, ScanResult>) => compareOf(model, results, '/f/L1_900rpm_run3.wav', null, STR);
    const full = of(binned), other = of(drawn);
    // The base is the median of every bin of runs 1 and 2 (-60, -61 → -60.5); its Δ is run 3's bins less it.
    assert.deepEqual(full.bins?.base, [-60.5, -50, -39.5]);
    assert.deepEqual(full.bins?.diff, [-1.5, 0, 1.5]);
    assert.deepEqual(other.bins, full.bins);
    assert.deepEqual([other.leq, other.bandDeltas, other.topBands], [full.leq, full.bandDeltas, full.topBands]);
    assert.deepEqual(other.base, full.base);
    assert.deepEqual(diffHeadline(other, STR), diffHeadline(full, STR));
    // Without bins, the figures are the bands (each the scan's own level, from every bin), never the drawn points.
    const bandsOnly = of(new Map([...drawn].map(([path, { spectrumBinsDb: _bins, spectrumBinHz: _hz, ...result }]) => [path, result as ScanResult])));
    assert.equal(bandsOnly.bins, null);
    assert.equal(deltaFigure(bandsOnly).view?.frame, 'NOctFrame');
    assert.deepEqual(bandsOnly.bandDeltas, full.bandDeltas);
});

test('files whose bins differ (another sample rate or n_fft) have no bins to compare', () => {
    const one = new Map<string, ScanResult>([...files].map(([path, result]) => [path, { ...result, spectrumBinsDb: [[-60, -60]], spectrumBinHz: path.endsWith('run3.wav') ? 4 : 2 }]));
    assert.equal(compareOf(model, one, '/f/L1_900rpm_run3.wav', null, STR).bins, null);
    assert.equal(compareOf(model, files, '/f/L1_900rpm_run3.wav', null, STR).bins, null, 'a scan without bins');
    // One base file without bins: none, so the figures draw the 1/3-octave bands (never the 192 drawn points).
    const partly = new Map(files);
    partly.set('/f/L1_900rpm_run3.wav', { ...files.get('/f/L1_900rpm_run3.wav')!, spectrumBinsDb: [[-60, -60]], spectrumBinHz: 2 });
    partly.set('/f/L1_900rpm_run1.wav', { ...files.get('/f/L1_900rpm_run1.wav')!, spectrumBinsDb: [[-60, -60]], spectrumBinHz: 2 });
    const comparison = compareOf(model, partly, '/f/L1_900rpm_run3.wav', null, STR);
    assert.equal(comparison.bins, null);
    assert.equal(comparison.comparable, true);
});

test('the table\'s results take the bins of a scan of the same condition only, never judged by its 192 drawn points', () => {
    const own = { ...files.get('/f/free.wav')!, conditionId: 'free@v1' };
    const run1 = { ...files.get('/f/L1_900rpm_run1.wav')!, conditionId: 'run1@v1' };
    const table = new Map([...files, ['/f/free.wav', own], ['/f/L1_900rpm_run1.wav', run1]]);
    const same: ScanResult = { ...own, elapsedMs: 9, spectrumBinsDb: [[-30, -31]], spectrumBinHz: 2 };
    // The file changed on disk with its 192 points alike (a change between them): another condition, not its bins.
    const changed: ScanResult = { ...run1, conditionId: 'run1@v2', spectrumBinsDb: [[-1, -2]], spectrumBinHz: 2 };
    // The held plot keeps a file's bins only while they are of the table's condition (entryHeldPlot.paintSlot asks
    // again otherwise); those it keeps stand for the table's answers (entryBase.binnedAnswers).
    const store = { answers: (paths: readonly string[]) => paths.map(path => scanAnswer(path, table.get(path))) };
    const [free, other] = binnedAnswers(store, new Map([['/f/free.wav', same]])).answers(['/f/free.wav', '/f/L1_900rpm_run1.wav']);
    assert.equal(free.state === 'ready' ? free.value.spectrumBinsDb : null, same.spectrumBinsDb);
    assert.equal(other.state === 'ready' ? other.value : null, run1, 'a file not measured now keeps the store\'s answer');
    assert.equal(sameCondition(own, same), true);
    assert.equal(sameCondition(run1, changed), false);
});

test('sameCondition and regionKey agree on every pair of regions: regions under 1 ms apart are two conditions, one region is one (#768, R15)', () => {
    // A scan of `region` as the backend answers it: the region it was asked for, echoed exactly, and a conditionId.
    // The ID is the same for every scan here, as the backend gave regions sharing a 3-decimal label before #768.
    const over = (region: { start: number; end: number } | null, conditionId = 'c'): ScanResult => {
        const base = files.get('/f/free.wav')!;
        return { ...base, conditionId, input: { ...base.input!, region } };
    };
    const regions = [null, { start: 0.5001, end: 1.5 }, { start: 0.5004, end: 1.5 }, { start: 0.5, end: 1.5 }, { start: 0.5, end: 1.5 + 1e-9 }];
    assert.equal(regionLabel(regions[1]), regionLabel(regions[2]), 'the label reads them alike: it is never the key');
    for (const a of regions) {
        for (const b of regions) {
            const keyed = regionKey(a) === regionKey(b);
            assert.equal(sameCondition(over(a), over(b)), keyed, `${regionKey(a)} vs ${regionKey(b)}`);
            // A copy of the region (as JSON brings it back from the backend) is the same key and the same condition.
            const echoed = a && JSON.parse(JSON.stringify(a)) as { start: number; end: number };
            assert.equal(sameCondition(over(a), over(echoed)), true);
        }
    }
    // Within one region key the backend's ID still decides: another file version or calibration is another condition.
    assert.equal(sameCondition(over(regions[1], 'c1'), over(regions[1], 'c2')), false);
});

test('the held Δ zoomed in is drawn again from every bin between its ends, not the whole Δ decimated and stretched (R1, R3)', () => {
    // 8192 bins of 1 Hz, each Δ its own: the whole view keeps only a bucket's lowest and highest.
    const diff = Array.from({ length: 8192 }, (_, bin) => Math.sin(bin * 1.7) * 10);
    const comparison = { bins: { hz: 1, nyquist: 8191, base: null, compare: null, diff: wholeValues(diff) }, bandDeltas: wholeValues([]), frequencies: [] };
    const whole = deltaViews(comparison);
    assert.equal(whole.view, whole.picture);
    // Zoomed to the window from 1 kHz up: in it, every bin while there are no more than the buckets.
    const from = 1000, to = 1100;
    const fraction = (hz: number): number => Math.log(hz / 20) / Math.log(8191 / 20);
    const zoomed = deltaViews(comparison, { start: fraction(from), end: fraction(to) });
    assert.deepEqual(zoomed.picture, whole.picture);
    const inside = (view: typeof whole.view): number => (view?.xs ?? []).filter(x => x >= from + 1 && x <= to - 1).length;
    assert.ok(inside(zoomed.view) >= 98, `zoomed: ${inside(zoomed.view)} bins`);
    assert.ok(inside(whole.picture) < inside(zoomed.view) / 2, `whole: ${inside(whole.picture)} bins`);
    const between1k = (view: typeof whole.view): number[] => (view?.xs ?? []).filter(x => x >= from + 1 && x <= to - 1);
    assert.deepEqual(between1k(zoomed.view), Array.from({ length: to - from - 1 }, (_, bin) => from + 1 + bin), 'every bin of the window');
    assertNotDrawn(between1k(zoomed.view), between1k(whole.picture), 'not the points the whole Δ keeps there');
    // Zoomed between two bins (100.3 to 100.7 Hz of 1 Hz bins), the line between them still crosses the range: the bin
    // beyond each end is kept, for the plot to clip.
    const between = deltaViews(comparison, { start: fraction(100.3), end: fraction(100.7) });
    assert.deepEqual(between.view?.xs, [100, 101]);
    // Without bins, the 1/3-octave bands' Δ (each band from every bin), never a Δ of the scans' 192 points.
    const frequencies = Array.from({ length: 192 }, (_, i) => 20 * (8000 / 20) ** ((i + 0.5) / 192));
    const bandDeltas = wholeValues(BAND_CENTERS_HZ.map((_, band) => (band === 3 ? 4.5 : 0)));
    const banded = deltaViews({ bins: null, bandDeltas, frequencies }, { start: 0.2, end: 0.4 });
    assert.equal(banded.view, banded.picture);
    assert.equal(banded.picture?.kind, 'bar');
    assert.deepEqual(banded.picture?.xs, BAND_CENTERS_HZ.slice(0, banded.picture?.xs?.length));
    assert.equal(banded.picture?.values?.[3], 4.5);
    // Nothing to draw without bins or bands.
    assert.equal(deltaViews({ bins: null, bandDeltas: wholeValues([]), frequencies }).picture, null);
});

test('the report\'s Δ figure without bins draws the 1/3-octave Δ, its range holding every band (R1)', () => {
    const frequencies = Array.from({ length: 192 }, (_, i) => 20 * (8000 / 20) ** ((i + 0.5) / 192));
    const bandDeltas = wholeValues(BAND_CENTERS_HZ.map((_, band) => (band === 20 ? 14 : band === 10 ? 3 : 0)));
    const figure = deltaFigure({ bins: null, bandDeltas, frequencies });
    assert.equal(figure.binned, false);
    assert.equal(figure.view?.kind, 'bar');
    assert.equal(figure.view?.values?.[20], 14);
    assert.ok(figure.range.max >= 14, `range ${JSON.stringify(figure.range)}`);
    // With the bins, the bin-by-bin Δ.
    const diff = Array.from({ length: 8192 }, (_, bin) => Math.sin(bin) * 2);
    const binned = deltaFigure({ bins: { hz: 1, nyquist: 8191, base: null, compare: null, diff: wholeValues(diff) }, bandDeltas, frequencies });
    assert.equal(binned.binned, true);
    assert.equal(binned.view?.kind, 'line');
    assert.ok(binned.range.max >= 14, 'the band steps stay inside the range');
    assert.notEqual(binned.range.max, Math.max(...drawableLine(binned.view?.values ?? []).map(value => value ?? -Infinity)), 'not the drawn bins\' highest');
    // A narrow dip in one bin, among 8192 drawn in 640 buckets, sets the range's other end.
    diff[3001] = -31;
    const dipped = deltaFigure({ bins: { hz: 1, nyquist: 8191, base: null, compare: null, diff: wholeValues(diff) }, bandDeltas, frequencies });
    assert.ok(dipped.range.min <= -31 && dipped.range.max >= 14, `range ${JSON.stringify(dipped.range)}`);
});

/** A 2D context that records each call by name, with its arguments. */
function recordingCanvas(): { canvas: HTMLCanvasElement; calls: Array<[string, unknown[]]> } {
    const calls: Array<[string, unknown[]]> = [];
    const context = new Proxy({}, {
        get: (_target, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : (...args: unknown[]) => { calls.push([String(key), args]); }),
        set: () => true,
    });
    const canvas = { width: 0, height: 0, clientWidth: 600, clientHeight: 200, ownerDocument: {}, dataset: {}, setAttribute: () => undefined, getContext: () => context } as unknown as HTMLCanvasElement;
    return { canvas, calls };
}

test('an empty plot\'s message keeps its line breaks: the summary and the backend\'s text each on their own line', () => {
    const { canvas, calls } = recordingCanvas();
    paintOverlay(canvas, { layers: [] }, R({ min: 0, max: 1 }), N({ x: 'Time [s]', y: 'Frequency [Hz]' }), { axisCanvas: null, size: { width: 600, height: 200 }, empty: 'Summary\nDetail' });
    const texts = calls.filter(([name]) => name === 'fillText').map(([, args]) => args[0]);
    assert.ok(texts.includes('Summary') && texts.includes('Detail'), JSON.stringify(texts));
    assert.ok(!texts.some(text => String(text).includes('Summary') && String(text).includes('Detail')));
});

test('a plot\'s guides are drawn by the plot component: each span shaded, the level dashed and named', () => {
    const { canvas, calls } = recordingCanvas();
    const view: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 1, 2], values: [0, 0.5, 0] };
    const fills = (): number => calls.filter(([name]) => name === 'fillRect').length;
    paintOverlay(canvas, { layers: [{ view, color: '#00f', full: held(view) }] }, R({ min: -1, max: 1 }), N({ x: 'Time [s]', y: 'Value' }), { axisView: view });
    const without = { fills: fills(), dashes: calls.filter(([name, args]) => name === 'setLineDash' && JSON.stringify(args[0]) === '[5,3]').length };
    calls.length = 0;
    paintOverlay(canvas, { layers: [{ view, color: '#00f', full: held(view) }] }, R({ min: -1, max: 1 }), N({ x: 'Time [s]', y: 'Value' }), { axisView: view, guides: { spans: [{ start: 0.5, end: 1 }], level: { value: 0.25, label: 'Threshold 0.25' } } });
    assert.equal(fills() - without.fills, 1, 'one shaded span');
    assert.equal(calls.filter(([name, args]) => name === 'setLineDash' && JSON.stringify(args[0]) === '[5,3]').length - without.dashes, 1, 'the level dashed');
    assert.ok(calls.some(([name, args]) => name === 'fillText' && args[0] === 'Threshold 0.25'), 'the level named');
});

test('the report\'s overlay figure orders base and compared by every bin\'s power, not the points thinned to draw them: the quieter on top (R6)', () => {
    // The base is −60 dB with a narrow −10 dB line every 300 bins; the compared one a flat −30 dB. By every bin the
    // compared is louder (the base's power mean is about −35 dB); its thinned line keeps each bucket's highest bin,
    // so many of the base's drawn points are its narrow lines and a measure of them would put the base louder.
    const count = 65537;
    const base = Array.from({ length: count }, (_, bin) => (bin % 300 === 7 ? -10 : -60));
    const compare = new Array<number>(count).fill(-30);
    const bins = { hz: 0.5, nyquist: (count - 1) * 0.5, base: wholeValues(base), compare: wholeValues(compare), diff: wholeValues(compare.map((value, bin) => value - base[bin])) };
    const baseView = binsView(bins, 'base'), compareView = binsView(bins, 'compare');
    assert.ok(baseView && compareView);
    assert.ok((baseView.xs?.length ?? 0) < count / 20, 'the line is thinned to be drawn');
    const drawnMean = (values: readonly (number | null)[]) => 10 * Math.log10(values.reduce<number>((sum, value) => sum + 10 ** ((value ?? -250) / 10), 0) / values.length);
    assert.ok(drawnMean(drawableLine(baseView.values ?? [])) > -30, 'the drawn points alone would make the base the louder');
    const layers = [{ view: baseView, color: 'base', full: binsSource(bins, 'base') ?? NO_FULL_DATA }, { view: compareView, color: 'compare', full: binsSource(bins, 'compare') ?? NO_FULL_DATA }];
    const order = byLevel(layers, baseView).map(layer => layer.color);
    assert.deepEqual(order, ['compare', 'base'], 'drawn loudest first: the quieter base last, on top');
    assertNotDrawn(order, [...layers].sort((a, b) => drawnMean(drawableLine(b.view.values ?? [])) - drawnMean(drawableLine(a.view.values ?? []))).map(layer => layer.color), 'not the order of the points drawn');
});
