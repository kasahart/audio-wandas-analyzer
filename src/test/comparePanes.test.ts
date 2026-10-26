import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { getStrings } from '../shared/i18n/strings';
import { BAND_CENTERS_HZ, buildEntryModel } from '../webview/runtime/entryTable';
import { buildCompareModel, diffHeadline, levelsHeadline, paneAxes } from '../webview/runtime/comparePanes';
import { paintOverlay } from '../webview/runtime/stagePanes';
import type { StageView } from '../shared/protocol/backendProtocol';

const STR = getStrings('en');
const BAND_3150 = BAND_CENTERS_HZ.indexOf(3150);

function scan(leq: number, spectrum: number[], band3150: number): ScanResult {
    return {
        ok: true, conditionId: 'c', specVersion: 2, wandasVersion: '0.9.0', elapsedMs: 1,
        input: { id: 'i', fs: 16000, channels: [0], durationS: 2, unit: 'FS', ref: 1 },
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
    const uncal = paneAxes(ja, { unit: 'FS', ref: 1 });
    const view = (values: number[]): StageView => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000], values });
    paintOverlay(canvas, { layers: [{ view: view([-40, -50]), color: '#00f' }] }, { min: -80, max: 0 }, uncal.level);
    assert.ok(texts.includes('振幅 未校正 [dBFS]') && texts.includes('周波数 [Hz]'));
    // The top tick is a number only: the unit is in the axis name.
    assert.ok(!texts.some(text => /^0 dB$/.test(text)));
    texts.length = 0;
    paintOverlay(canvas, { layers: [{ view: view([1, 2]), color: '#0f0' }] }, { min: -8, max: 8 }, uncal.delta, { diff: true, bandSteps: { deltas: [], headline: [], color: '#0f0', legend: uncal.delta.legend } });
    assert.ok(['差 [dB]', '1/3 oct 見出し', '漏れ', '点ごとの差'].every(text => texts.includes(text)));
    assert.equal(paneAxes(ja, { unit: 'Pa', ref: 2e-5 }).level.y, '振幅 [dB re 0.00002 Pa]');
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
