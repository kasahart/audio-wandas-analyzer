import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { getStrings } from '../shared/i18n/strings';
import { BAND_CENTERS_HZ, buildEntryModel } from '../webview/runtime/entryTable';
import { binsView, buildCompareModel, diffHeadline, minMaxLine, withBins, legendHtml, levelsHeadline, paneAxes, trackLevelInput, type LevelInput } from '../webview/runtime/comparePanes';
import type { ChannelSummary } from '../shared/analysis/analysisTypes';
import { paintOverlay, stageAxes } from '../webview/runtime/stagePanes';
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

test('the base is the median of the compared file\'s condition without it, point by point, and Δ adds up as shown', () => {
    const comparison = buildCompareModel(model, files, '/f/L1_900rpm_run3.wav', null, STR);
    assert.equal(comparison.base!.title, 'Base group · L1 · 900rpm · 2 files');
    assert.deepEqual(comparison.base!.filePaths, ['/f/L1_900rpm_run1.wav', '/f/L1_900rpm_run2.wav']);
    assert.deepEqual(comparison.base!.spectrumDb.map(value => Math.round(value * 100) / 100), [-41, -50, -60.5]);
    assert.deepEqual(comparison.diffDb!.map(value => Math.round(value * 100) / 100), [21, 0, 20.5]);
    // Log-spaced from 20 Hz to Nyquist: each point is the geometric centre of its edges (8 kHz Nyquist, 3 points: ×400^(1/3)).
    assert.deepEqual(comparison.frequencies.map(hz => Math.round(hz)), [54, 400, 2947]);
    const { base, compare, delta } = comparison.leq!;
    assert.equal(Math.round((base + delta) * 10) / 10, compare);
    assert.equal(comparison.topBands[0].band, BAND_3150);
    assert.equal(comparison.topBands[0].delta, 20.5);
    assert.ok(diffHeadline(comparison).startsWith('3.15 kHz +20.5 · '));
    assert.ok(diffHeadline(comparison).endsWith(`Leq ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} dB`));
});

test('slot 0 makes one file the base; without a condition or a slot 0 there is no base', () => {
    const single = buildCompareModel(model, files, '/f/L1_900rpm_run3.wav', '/f/free.wav', STR);
    assert.equal(single.base!.title, 'Base · free.wav');
    assert.deepEqual(single.base!.filePaths, ['/f/free.wav']);
    const none = buildCompareModel(model, files, '/f/free.wav', null, STR);
    assert.equal(none.base, null);
    assert.equal(none.diffDb, null);
    assert.equal(diffHeadline(none), '—');
});

test('a Δ that cannot be read is withheld: the file against itself, a group of one, a base over another region', () => {
    const self = buildCompareModel(model, files, '/f/L1_900rpm_run3.wav', '/f/L1_900rpm_run3.wav', STR);
    assert.equal(self.blocked, 'self');
    assert.equal(self.diffDb, null);
    assert.deepEqual(self.topBands, []);
    assert.equal(diffHeadline(self, STR), '— · ≠ same file');
    assert.equal(self.leq!.compare, -10.1);
    const alone = new Map<string, ScanResult>([['/s/L2_1800rpm_run1.wav', scan(-20, [-40, -50, -60], -30)]]);
    const lone = buildEntryModel([...alone].map(([filePath, result]) => ({ filePath, result })), null);
    const single = buildCompareModel(lone, alone, '/s/L2_1800rpm_run1.wav', null, STR);
    assert.equal(single.blocked, 'single');
    assert.equal(diffHeadline(single, STR), '— · n=1');
    const region = buildCompareModel(model, files, '/f/L1_900rpm_run3.wav', null, STR, true);
    assert.equal(region.blocked, 'region');
    assert.equal(diffHeadline(region, STR), '— · ≠ region');
    // A file in slot 0 is scanned over the region too, so the flag does not apply to it.
    assert.equal(buildCompareModel(model, files, '/f/L1_900rpm_run3.wav', '/f/free.wav', STR, true).blocked, undefined);
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
    const comparison = buildCompareModel(leakModel, leaking, '/l/L1_900rpm_run3.wav', null, STR);
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
    const near = buildCompareModel(model, files, '/c/L5_900rpm_near.wav', '/c/L5_900rpm_base.wav', STR);
    assert.deepEqual(near.topBands, []);
    assert.equal(diffHeadline(near, STR), `${STR.compareNoSignificant} · Leq +0.0 dB`);
    const far = buildCompareModel(model, files, '/c/L5_900rpm_far.wav', '/c/L5_900rpm_base.wav', STR);
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
    paintOverlay(canvas, { layers: [{ view: view([-40, -50]), color: '#00f' }] }, { min: -80, max: 0 }, uncal.level);
    assert.ok(texts.includes('振幅 未校正 [dBFS]') && texts.includes('周波数 [Hz]'));
    // The top tick is a number only: the unit is in the axis name.
    assert.ok(!texts.some(text => /^0 dB$/.test(text)));
    texts.length = 0;
    paintOverlay(canvas, { layers: [{ view: view([1, 2]), color: '#0f0' }] }, { min: -8, max: 8 }, uncal.delta, { diff: true, bandSteps: { deltas: [], headline: [], color: '#0f0', legend: uncal.delta.legend } });
    assert.ok(['差 [dB]', '1/3 oct 見出し', '漏れ', '点ごとの差'].every(text => texts.includes(text)));
    assert.equal(paneAxes(ja, { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true }).level.y, '振幅 [dB SPL re 20 µPa]');
});

const FS: LevelInput = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true };
const RAW: LevelInput = { unit: '', ref: 1, levelReferenceLabel: 'dB re 1 input unit', calibrationStatus: 'uncalibrated', fullScale: false };
const SPL: LevelInput = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true };

test('the level axis is named by wandas\' level reference, and says uncalibrated from the calibration status, not the unit', () => {
    for (const [language, fullScaleAxis, rawAxis, splAxis] of [
        ['en', 'Amplitude, uncalibrated [dBFS]', 'Amplitude, uncalibrated [dB re 1 input unit]', 'Amplitude [dB SPL re 20 µPa]'],
        ['ja', '振幅 未校正 [dBFS]', '振幅 未校正 [dB re 1 input unit]', '振幅 [dB SPL re 20 µPa]'],
    ] as const) {
        const strings = getStrings(language);
        assert.equal(paneAxes(strings, FS).level.y, fullScaleAxis);
        assert.equal(paneAxes(strings, RAW).level.y, rawAxis);
        assert.equal(paneAxes(strings, SPL).level.y, splAxis);
        assert.equal(paneAxes(strings, { ...SPL, fullScale: false }).level.y, splAxis, 'a calibrated CSV names its calibration');
        // A calibration to 1 V is calibrated even with a reference of 1.
        assert.equal(paneAxes(strings, { unit: 'V', ref: 1, levelReferenceLabel: 'dB re 1 V', calibrationStatus: 'calibrated', fullScale: true }).level.y, splAxis.replace('dB SPL re 20 µPa', 'dB re 1 V'));
        assert.equal(paneAxes(strings, undefined).level.y, fullScaleAxis);
    }
    const waveform = { min: [0], max: [1], minT: [0], maxT: [0], absolutePeak: 1, ref: 1 };
    const view = (unit: string): StageView => ({ frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0], values: [0], waveform: { ...waveform, unit } });
    // A waveform says it is uncalibrated as the level axis does; a calibrated one names its unit only.
    assert.equal(stageAxes(STR, view('FS'), { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true }).y, 'Amplitude, uncalibrated [FS]');
    assert.equal(stageAxes(STR, view(''), RAW).y, 'Amplitude, uncalibrated [input unit]');
    assert.equal(stageAxes(STR, view('Pa'), SPL).y, 'Amplitude [Pa]');
    // After rms_trend, sound_level or power the axis names that measure; power is in the unit squared.
    assert.equal(stageAxes(STR, { ...view('Pa'), measure: 'timeWeightedRms' }, SPL).y, 'Time-weighted RMS [Pa]');
    assert.equal(stageAxes(STR, { ...view(''), measure: 'power' }, FS).y, 'Power, uncalibrated [FS²]');
    const series: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: '', xs: [0], values: [0], measure: 'rms' };
    assert.equal(stageAxes(getStrings('ja'), series, FS).y, '実効値 未校正 [FS]');
});

test('the headline gives both levels, and a band far below the loudest does not head it however large its Δ', () => {
    const comparison = buildCompareModel(model, files, '/f/L1_900rpm_run3.wav', null, STR);
    assert.match(levelsHeadline(comparison, STR), /^3\.15 kHz base −30\.5 \/ compare −10\.0 · Leq base −20\.0 \/ compare −10\.1 dB$/);
    // 60 → 65 dB is heard; 20 → 30 dB under it is not: only the loud band heads the list.
    const level = (band3150: number, quiet: number) => {
        const result = scan(-20, [-40, -50, -60], band3150);
        result.thirdOctDb = [BAND_CENTERS_HZ.map((_, band) => (band === BAND_3150 ? band3150 : band === 5 ? quiet : -90))];
        return result;
    };
    const loud = new Map<string, ScanResult>([['/g/L2_1200rpm_run1.wav', level(60, 20)], ['/g/L2_1200rpm_run2.wav', level(60, 20)], ['/g/L2_1200rpm_run3.wav', level(65, 30)]]);
    const loudModel = buildEntryModel([...loud].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_3150 });
    const heard = buildCompareModel(loudModel, loud, '/g/L2_1200rpm_run3.wav', null, STR);
    assert.deepEqual(heard.topBands.map(item => item.band), [BAND_3150]);
    assert.ok(levelsHeadline(heard, STR).startsWith('3.15 kHz base 60.0 / compare 65.0 · '));
    // A group of three or more files carries its quartiles for the band under its median.
    assert.equal(buildCompareModel(model, files, '/f/free.wav', '/f/L1_900rpm_run1.wav', STR).base!.spread, undefined);
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
    assert.deepEqual(trackLevelInput([channel(true, pa), channel(true, g)], undefined), plain, 'channels calibrated apart share no reference');
    assert.deepEqual(trackLevelInput([channel(true, pa), channel(true, fs)], undefined), plain, 'nor do Pa and an uncalibrated channel');
    // A gain correction in FS keeps dBFS: it shares the uncalibrated channel's reference, as the scan judges it.
    const gain = { ...fs, calibrationStatus: 'calibrated', calibrationSource: 'manual', factor: 2 } as const;
    assert.deepEqual(trackLevelInput([channel(true, gain), channel(true, fs)], undefined), FS);
    assert.equal(paneAxes(STR, trackLevelInput([channel(true, gain), channel(true, fs)], undefined)).level.y, 'Amplitude, uncalibrated [dBFS]');
    assert.deepEqual(trackLevelInput([channel(true, gain), channel(true, gain)], undefined), { ...FS, calibrationStatus: 'calibrated' });
    assert.equal(paneAxes(STR, plain as LevelInput).level.y, 'Amplitude [dB]');
    assert.equal(paneAxes(STR, trackLevelInput([channel(false)], undefined)).level.y, 'Amplitude, uncalibrated [dB re 1 input unit]');
    assert.equal(paneAxes(STR, trackLevelInput([channel(true)], undefined)).level.y, 'Amplitude, uncalibrated [dBFS]');
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
    const comparison = buildCompareModel(model, binned, '/f/L1_900rpm_run3.wav', null, STR);
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
    // Zoomed: every bin on screen, still at its own frequency.
    const zoomed = binsView(bins, 'diff', [2900, 3100], 300)!;
    assert.equal(zoomed.xs!.length, 101);
    assert.equal(zoomed.detail, true);
});

test('a line decimated for drawing keeps each bucket\'s lowest and highest value at their own places', () => {
    const xs = Array.from({ length: 1000 }, (_, index) => index + 1);
    const values = xs.map(() => 0);
    values[122] = 9;
    values[776] = -4;
    const line = minMaxLine(xs, values, 50, [1, 1000]);
    assert.ok(line.xs.length <= 100);
    assert.equal(line.xs[line.values.indexOf(9)], 123);
    assert.equal(line.xs[line.values.indexOf(-4)], 777);
});

test('files whose bins differ (another sample rate or n_fft) have no bins to compare', () => {
    const one = new Map<string, ScanResult>([...files].map(([path, result]) => [path, { ...result, spectrumBinsDb: [[-60, -60]], spectrumBinHz: path.endsWith('run3.wav') ? 4 : 2 }]));
    assert.equal(buildCompareModel(model, one, '/f/L1_900rpm_run3.wav', null, STR).bins, null);
    assert.equal(buildCompareModel(model, files, '/f/L1_900rpm_run3.wav', null, STR).bins, null, 'a scan without bins');
    // One base file without bins: none, so the figures keep every curve on the 192 points.
    const partly = new Map(files);
    partly.set('/f/L1_900rpm_run3.wav', { ...files.get('/f/L1_900rpm_run3.wav')!, spectrumBinsDb: [[-60, -60]], spectrumBinHz: 2 });
    partly.set('/f/L1_900rpm_run1.wav', { ...files.get('/f/L1_900rpm_run1.wav')!, spectrumBinsDb: [[-60, -60]], spectrumBinHz: 2 });
    const comparison = buildCompareModel(model, partly, '/f/L1_900rpm_run3.wav', null, STR);
    assert.equal(comparison.bins, null);
    assert.ok(comparison.diffDb);
});

test('the table\'s results take the bins of a scan of the same spectrum only', () => {
    const own = files.get('/f/free.wav')!;
    const same: ScanResult = { ...own, elapsedMs: 9, spectrumBinsDb: [[-30, -31]], spectrumBinHz: 2 };
    const other: ScanResult = { ...own, spectrumDb: [[-1, -2, -3]], spectrumBinsDb: [[-1, -2]], spectrumBinHz: 2 };
    const merged = withBins(files, new Map([['/f/free.wav', same], ['/f/L1_900rpm_run1.wav', other]]));
    assert.deepEqual(merged.get('/f/free.wav'), { ...own, spectrumBinsDb: [[-30, -31]], spectrumBinHz: 2 }, 'the table\'s own numbers, with the bins');
    assert.equal(merged.get('/f/L1_900rpm_run1.wav'), files.get('/f/L1_900rpm_run1.wav'), 'another spectrum: as it was');
});
