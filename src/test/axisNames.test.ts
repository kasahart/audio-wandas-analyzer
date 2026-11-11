import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getStrings, type UiStrings } from '../shared/i18n/strings';
import type { StageView } from '../shared/protocol/backendProtocol';
import { axisNameParts, DIMENSIONLESS, fitAxisTitle, shortQuantities } from '../webview/plot/axisTitle';
import { paneAxes, type LevelInput } from '../webview/runtime/comparePanes';
import { csvAxisName } from '../webview/runtime/entryDistributionPane';
import { pairLanes } from '../webview/runtime/pairSpectrum';
import { amplitudeAxisTitle, stageAxes } from '../webview/runtime/stagePanes';

const LOCALES = ['en', 'ja'] as const;

/**
 * Strings named like an axis that are not a whole axis name: the quantity a producer below puts its unit after
 * (metricAxisName, amplitudeAxisTitle), and the words for an unknown unit. Every other axis string names its unit.
 */
const FRAGMENTS = new Set<keyof UiStrings>(['axisLoudness', 'axisSharpness', 'axisRoughness', 'axisSpecificRoughness', 'axisLevelOf', 'axisRms', 'axisRmsTimeWeighted', 'axisPower', 'axisUncalibrated', 'axisUnitUnknown']);
/** Axis names whose key does not say so: the pair view's plots and the values the distribution's value axis takes. */
const NAMED_ELSEWHERE: Array<keyof UiStrings> = ['pairPhaseLabel', 'pairCoherenceLabel', 'dsLeq', 'dsPeak', 'dsCrest', 'dsBand'];

/** Words that name no quantity: an axis called "Value [Pa]" says only its unit (R4). */
const NO_QUANTITY = new Set(LOCALES.flatMap(locale => [getStrings(locale).dsValue, 'Value', '値']));

/** The words for an amplitude, in each language (the waveform's axis, in its signal's unit). */
const AMPLITUDE = LOCALES.map(locale => getStrings(locale).waveRangeAxisAmplitude);

const named = (where: string, name: string | undefined): void => {
    const parts = axisNameParts(name ?? '');
    assert.ok(parts && parts.quantity.trim() && parts.unit.trim(), `${where}: "${name}" names no quantity and unit in closing brackets`);
    const quantity = parts.quantity.replace(/^Δ\s*/u, '').trim();
    assert.ok(!NO_QUANTITY.has(quantity), `${where}: "${name}" names no quantity, only that it is a value`);
    // A quantity in dB is a level (of what, where that is known), never an amplitude (R4, C5).
    if (/^dB/u.test(parts.unit.trim())) assert.ok(!AMPLITUDE.some(word => quantity.includes(word)), `${where}: "${name}" is in dB, so it is a level, not an amplitude`);
};

test('every axis-name string, in every language, names its quantity and its unit (R4)', () => {
    for (const locale of LOCALES) {
        const strings = getStrings(locale);
        const keys = (Object.keys(strings) as Array<keyof UiStrings>)
            .filter(key => (/^axis/u.test(key) || /Axis$/u.test(key)) && !/hint/iu.test(key) && !FRAGMENTS.has(key));
        assert.ok(keys.length >= 15, `${locale}: the axis strings are walked`);
        for (const key of [...keys, ...NAMED_ELSEWHERE]) named(`${locale}.${key}`, String(strings[key]));
        // A dimensionless quantity says so with the one marker, in every language.
        for (const key of ['axisCoherence', 'axisCepstrum', 'axisCorrelation', 'pairCoherenceLabel', 'dsCrest', 'axisEntryRows'] as const) {
            assert.equal(axisNameParts(strings[key])?.unit, DIMENSIONLESS, `${locale}.${key}`);
        }
    }
});

const calibrated: LevelInput = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false };
const views = (): StageView[] => {
    const xs = ['frequency', 'time', 'band', 'quefrency', 'lag'] as const;
    const quantities = ['level', 'gain', 'coherence', 'value', 'roughness', 'cepstrum', 'correlation'] as const;
    const units = [undefined, 'sone', 'acum', 'asper', 'asper/Bark', 'dB re 1 FS', 'Pa'];
    const lines = xs.flatMap(x => quantities.flatMap(quantity => units.map((unit): StageView => ({ frame: 'SpectralFrame', kind: 'line', x, xScale: 'linear', quantity, ...(unit ? { unit } : {}), xs: [1, 2], values: [0, 1] }))));
    const pairs = lines.flatMap((view): StageView[] => [{ ...view, pair: { output: 2, input: 1 } }, { ...view, pair: { output: 1, input: 1, base: true } }]);
    const measures = (['rms', 'timeWeightedRms', 'power'] as const).flatMap((measure): StageView[] => [
        { frame: 'ChannelFrame', kind: 'line', x: 'time', quantity: 'value', unit: 'Pa', measure, xs: [0, 1], values: [1, 2] },
        { frame: 'ChannelFrame', kind: 'line', x: 'time', quantity: 'level', unit: 'dB re 1 input unit', measure, xs: [0, 1], values: [1, 2] },
    ]);
    const waveforms = ['Pa', ''].map((unit): StageView => ({ frame: 'ChannelFrame', kind: 'line', x: 'time', xs: [0, 1], waveform: { min: [0], max: [1], minT: [0], maxT: [1], absolutePeak: 1, unit, ref: 1 } }));
    const events: StageView = { frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xs: [0, 1], values: [0, 1] };
    const heatmaps = (['level', 'roughness', 'cepstrum', 'value'] as const).flatMap(quantity => (['frequency', 'bark', 'quefrency'] as const).flatMap(yAxis => [undefined, 'asper'].map((unit): StageView => ({ frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', quantity, yAxis, ...(unit ? { unit } : {}), xs: [0, 1], ys: [1, 2], matrix: [[0, 0], [0, 0]] }))));
    return [...lines, ...pairs, ...measures, ...waveforms, events, ...heatmaps];
};

test('every axis a picture is drawn on names its quantity and unit, whatever it measures, with or without a unit, Δ or not (R4)', () => {
    for (const locale of LOCALES) {
        const strings = getStrings(locale);
        for (const view of views()) {
            for (const input of [undefined, calibrated]) {
                for (const diff of [false, true]) {
                    const axes = stageAxes(strings, view, input, diff);
                    const where = `${locale} ${view.frame}/${view.kind}/${view.x}/${view.quantity}/${view.unit ?? '-'}${view.pair ? '/pair' : ''}${diff ? '/Δ' : ''}`;
                    named(`${where} x`, axes.x);
                    named(`${where} y`, axes.y);
                    if (view.kind === 'heatmap') named(`${where} colour`, axes.colour);
                }
            }
        }
        // A series with no unit and no input says its unit is not known, never an assumed full scale (R4); with an
        // input it is in the files' own unit.
        assert.equal(axisNameParts(stageAxes(strings, { frame: 'ChannelFrame', kind: 'line', x: 'time', quantity: 'value', xs: [0, 1], values: [1, 2] }, undefined).y)?.unit, strings.axisUnitUnknown);
        assert.equal(axisNameParts(stageAxes(strings, { frame: 'ChannelFrame', kind: 'line', x: 'time', quantity: 'value', xs: [0, 1], values: [1, 2] }, { ...calibrated, unit: '', fullScale: true, calibrationStatus: 'uncalibrated' }).y)?.unit, 'FS');
        for (const measure of [undefined, 'rms', 'timeWeightedRms', 'power'] as const) {
            for (const input of [undefined, calibrated]) named(`${locale} amplitude ${measure}`, amplitudeAxisTitle(strings, input?.unit, input, measure));
        }
        for (const input of [undefined, calibrated]) {
            const { level, delta } = paneAxes(strings, input);
            for (const name of [level.x, level.y, delta.x, delta.y]) named(`${locale} compare pane`, name);
        }
        const lanes = pairLanes({ frequencyBins: 2, maxFrequencyHz: 1000, curves: [] }, { frequencyMin: 0, frequencyMax: 1000 }, strings);
        for (const lane of lanes) { named(`${locale} pair ${lane.key} x`, lane.axes.x); named(`${locale} pair ${lane.key} y`, lane.axes.y); }
        for (const count of [strings.dsCh, strings.dsUnitRecording]) named(`${locale} distribution count`, strings.dsDistCountAxis.replace('{unit}', count));
    }
});

test('a CSV column\'s value axis names the unit its header gives, and says when it gives none', () => {
    const strings = getStrings('en');
    assert.equal(csvAxisName('temp [°C]', strings), 'temp (CSV column) [°C]');
    assert.equal(csvAxisName('speed (rpm)', strings), 'speed (CSV column) [rpm]');
    assert.equal(csvAxisName('temp_c', strings), 'temp_c (CSV column) [unit unknown]');
    assert.equal(csvAxisName('a$&b', strings), 'a$&b (CSV column) [unit unknown]');
    assert.equal(csvAxisName('温度', getStrings('ja')), '温度（CSV の列） [単位不明]');
});

test('a name too long for its axis keeps its quantity and its unit: smaller, on two lines, then its quantity shortened', () => {
    // About 5.6 px a character at the font's own size.
    const measure = (text: string): number => [...text].length * 5.6;
    assert.deepEqual(fitAxisTitle('Phase [°]', 100, measure, { lines: 2 }), { lines: ['Phase [°]'], scale: 1 });
    assert.deepEqual(fitAxisTitle('Phase [°]', 46, measure, { lines: 2 }), { lines: ['Phase [°]'], scale: 0.9 });
    assert.deepEqual(fitAxisTitle('Phase [°]', 38, measure, { lines: 2 }), { lines: ['Phase', '[°]'], scale: 1 });
    // A quantity ending in its symbol is shortened to the symbol first.
    assert.deepEqual(fitAxisTitle('Coherence γ² [–]', 30, measure, { lines: 2 }), { lines: ['γ² [–]'], scale: 0.8 });
    assert.deepEqual(fitAxisTitle('Gain [dB]', 20, measure, { lines: 1 }).lines, ['G… [dB]']);
    // Even when nothing fits, the quantity (shortened) and the unit are both drawn.
    const tiny = fitAxisTitle('Amplitude, uncalibrated [FS]', 4, measure, { lines: 2 });
    assert.deepEqual(tiny, { lines: ['A…', '[FS]'], scale: 0.8 });
    assert.deepEqual(shortQuantities('Coherence γ² · ch2 / ch1').slice(0, 1), ['Coherence γ² · ch2 / ch…'], 'a channel is no symbol');
    // A name without a unit (none should reach a plot) is drawn as given.
    assert.deepEqual(fitAxisTitle('', 10, measure), { lines: [], scale: 1 });
});

test('no plot names an axis through gui-core\'s drawValueAxis or fittedAxisTitle, which keep only the unit when the name is long: every name is fitted by axisTitle.ts, quantity and unit (R4)', () => {
    // gui-core is a pinned copy of another repository (src/shared/gui-core/upstream.json): the helpers stay there, unused.
    const webview = path.resolve(__dirname, '..', '..', 'src', 'webview');
    const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? files(full) : name.endsWith('.ts') ? [full] : [];
    });
    const using = files(webview).filter(file => /\b(?:drawValueAxis|fittedAxisTitle)\b/u.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, '')));
    assert.deepEqual(using.map(file => path.relative(webview, file)), []);
});

test('a range popover names its axis as the plot does: the plot\'s own axis name, never words of its own (R4)', () => {
    const root = path.join(__dirname, '..', '..', 'src', 'webview');
    const files: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) walk(full); else if (name.endsWith('.ts')) files.push(full);
        }
    };
    walk(root);
    // What a popover may be named by: the plot's axis-name strings, or the title the plot drew its axis with.
    const PLOT_NAMES = [/^STR\.axis\w+(\.replace\(.*\))?(\s*\|\|.*)?$/u, /^spectrumLevelAxisTitle\b/u, /^spectrumRightAxis\.title\b/u, /^spectrogramLevelTitle\(/u, /^laneAmplitudeAxis\(.*\)\.title$/u, /^mapping\.label\b/u];
    let opens = 0;
    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(/\.open\(\{\s*(?:\/\/[^\n]*\n\s*)*axisLabel:\s*([^\n]+?),\n/gu)) {
            opens++;
            const expression = match[1].trim();
            assert.ok(PLOT_NAMES.some(pattern => pattern.test(expression)), `${path.relative(root, file)}: a popover named "${expression}"`);
            assert.ok(!/['"`]\s*\(/u.test(expression), `${path.relative(root, file)}: "${expression}" writes a unit in round brackets`);
        }
    }
    assert.ok(opens >= 5, `the popovers are walked (${opens})`);
});

test('no absolute level falls back to a bare "dB" unit anywhere in src (a default, ?? / || / ternary, or return): it names its reference, or says full scale (R4, R7, A50)', () => {
    const root = path.join(__dirname, '..', '..', 'src');
    const files: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) { if (name !== 'test' && name !== 'generated') walk(full); } else if (name.endsWith('.ts')) files.push(full);
        }
    };
    for (const name of readdirSync(root)) if (name !== 'test' && statSync(path.join(root, name)).isDirectory()) walk(path.join(root, name));
    // Where a bare dB is a ratio, not an absolute level: the one line, said here with why (never a whole file).
    const RATIOS: Record<string, string> = {
        "webview/runtime/figureModel.ts: const GAIN_DB = 'dB';": 'a plain gain: one unit over itself, a ratio (R7)',
    };
    // A bare 'dB' anywhere (a default, an argument, a value), a reference defaulted to dBFS, or a level in "dB(A)".
    // (A prefix test, `unit.startsWith('dB')`, asks whether a unit is a level; it gives none.)
    const BARE = /(?<!(?:startsWith|endsWith|includes)\()(['"`])dB\1|(?:\?\?|\|\|)\s*(['"`])dBFS\2|(['"`])(?![^'"`\n]*Δ)[^'"`\n]*\bdB\(A\)[^'"`\n]*\3|(?:\?\?|\|\||:)\s*uncalibratedUnits\(true\)\.level\b/u;
    // The class sweep 3 loopholes, caught: an argument, a dBFS default, a dB(A) column; a Δ and a prefix test are not.
    // Sweep 4: a dBFS assumed by its name's maker (`?? uncalibratedUnits(true).level` as a default input's reference).
    for (const bad of ["lines(values, 'gain', 'dB')", "label: folder.label || 'dBFS'", "entryColLeq: 'Leq dB(A)'", "const reference = input ?? { levelReferenceLabel: uncalibratedUnits(true).level };"]) assert.ok(BARE.test(bad), bad);
    for (const fine of ["reportDeltaLeq: 'Δ Leq dB(A)'", "unit?.startsWith('dB')"]) assert.ok(!BARE.test(fine), fine);
    const found = files.flatMap(file => {
        const rel = path.relative(root, file).split(path.sep).join('/');
        if (rel.startsWith('e2e/')) return [];
        return readFileSync(file, 'utf8').split('\n').flatMap(line => {
            const code = line.replace(/\/\/.*$|^\s*\/?\*.*$/u, '');
            return BARE.test(code) && !RATIOS[`${rel}: ${line.trim()}`] ? [`${rel}: ${line.trim()}`] : [];
        });
    });
    for (const site of Object.keys(RATIOS)) assert.ok(files.some(file => readFileSync(file, 'utf8').includes(site.slice(site.indexOf(': ') + 2))), `RATIOS lists a line that is gone: ${site}`);
    assert.ok(files.some(file => file.includes(`${path.sep}shared${path.sep}utils${path.sep}`)) && files.some(file => file.includes(`${path.sep}extension${path.sep}`)), 'shared utils and the extension are walked');
    assert.deepEqual(found, []);
});
