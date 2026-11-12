import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { held } from './helpers/heldSource';
import { getStrings } from '../shared/i18n/strings';
import type { StageView } from '../shared/protocol/backendProtocol';
import { amountText, barkText, exactFieldText, frequencyText, lagText, levelText, quefrencyText, secondsSpanText, secondsText, signedNumberText, signedText, withMinus } from '../webview/plot/plotText';
import { fieldWindow } from '../webview/runtime/figureModel';
import { pairHeader, type PairCurve, type PairStrings } from '../webview/runtime/pairSpectrum';
import { formatValue, plotValueText } from '../webview/runtime/entryTableHtml';
import { spectrumReadoutText } from '../webview/runtime/spectrumRuntime';
import { alongAxisTicks, rowAxisTicks, stageHover, valueAxisTicks, type StagePlot } from '../webview/runtime/stagePanes';
import { regionCells } from '../webview/runtime/entryTable';
import { laneReadoutText, spectrogramReadoutText } from '../webview/runtime/trackLaneHover';

test('a frequency reads in Hz below 1 kHz and in kHz to the hertz from there, so neighbouring bins never read the same (R7)', () => {
    assert.equal(frequencyText(15.625), '15.6 Hz');
    assert.equal(frequencyText(250), '250 Hz');
    assert.equal(frequencyText(999.98), '1000 Hz');
    assert.equal(frequencyText(1000), '1 kHz');
    assert.equal(frequencyText(1015.625), '1.016 kHz');
    assert.equal(frequencyText(1031.25), '1.031 kHz');
    assert.equal(frequencyText(3150), '3.15 kHz');
    assert.equal(frequencyText(12500), '12.5 kHz');
});

test('a frequency read among points finer than 1 Hz apart gets the digits that tell neighbouring bins apart (R7)', () => {
    // A 65536-point Welch at 48 kHz: 0.732 Hz bins.
    const step = 48000 / 65536;
    assert.equal(frequencyText(1369 * step, step), '1.0027 kHz');
    assert.equal(frequencyText(1370 * step, step), '1.0034 kHz');
    // A 16384-point STFT at 8 kHz: 0.488 Hz bins, below 1 kHz too.
    const fine = 8000 / 16384;
    assert.notEqual(frequencyText(100 * fine, fine), frequencyText(101 * fine, fine));
    assert.equal(frequencyText(0.05, 0.01), '0.05 Hz');
    // Bins a hertz or more apart keep the plain form.
    assert.equal(frequencyText(1015.625, 15.625), '1.016 kHz');
    assert.equal(frequencyText(250, 31.25), '250 Hz');
    // Any spacing: every pair of neighbours reads apart.
    for (const spacing of [0.05, 0.1, 0.15, 0.49, 0.73, 1, 2.7, 15.625]) {
        for (let k = 1; k < 4000; k += 37) assert.notEqual(frequencyText(k * spacing, spacing), frequencyText((k + 1) * spacing, spacing), `${k} × ${spacing} Hz`);
    }
});

test('a level reads to a tenth of a decibel in its unit, a time in seconds, other values to three figures (R7)', () => {
    assert.equal(levelText(-42.31, 'dBFS'), '−42.3 dBFS');
    // A level whose reference nobody gave is written without one, never in a bare "dB" (R4, A50).
    assert.equal(levelText(-42.31, ''), '−42.3');
    assert.equal(levelText(61, 'dB SPL'), '61.0 dB SPL');
    assert.equal(secondsText(1.234), '1.23 s');
    assert.equal(secondsText(-0.5, 3), '−0.500 s');
    assert.equal(amountText(-0.0123, 'Pa'), '−0.0123 Pa');
    assert.equal(amountText(0.5), '0.500');
    assert.equal(amountText(123.45, '°'), '123°');
    assert.equal(amountText(2.5e-7), '2.50e−7');
    assert.equal(signedText(3.21), '+3.2 dB');
    assert.equal(signedText(-0.125, false), '−0.125');
});

test('every value has three significant figures however large: no false tenth and no exponent below a million (R7)', () => {
    assert.equal(amountText(12.345), '12.3');
    assert.equal(amountText(1234), '1230');
    assert.equal(amountText(-98765, 'Pa'), '−98800 Pa');
    assert.equal(amountText(2.5e7), '2.50e7');
    assert.equal(amountText(999.6), '1000');
    assert.equal(amountText(-999.7), '−1000');
    assert.equal(amountText(0.0005), '5.00e−4');
    assert.equal(amountText(0.0000015), '1.50e−6');
    assert.equal(amountText(0), '0.00');
    assert.equal(signedText(999.6, false), '+1000');
    assert.equal(signedText(1234, false), '+1230');
    assert.equal(signedText(-2.5e-7, false), '−2.50e−7');
});

test('a lag, a quefrency, Bark and a signed number read the same on every plot (R7)', () => {
    assert.equal(lagText(0.00125), '+0.00125 s');
    assert.equal(lagText(-0.0005), '−0.00050 s');
    assert.equal(lagText(0.000001), '0.00000 s');
    assert.equal(quefrencyText(0.0025), '0.00250 s');
    assert.equal(quefrencyText(0.0125), '0.0125 s');
    assert.equal(barkText(12.46), '12.5 Bark');
    assert.equal(signedNumberText(23.71), '+23.7');
    assert.equal(signedNumberText(-1.44), '−1.4');
});

test('a quefrency and a lag read in the unit their axis is named in: seconds, as the axis says [s] (A36, R4, R7)', () => {
    const strings = getStrings('ja');
    for (const [axis, text] of [[strings.axisQuefrency, quefrencyText(0.0025)], [strings.axisLag, lagText(-0.0005)], [getStrings('en').axisQuefrency, quefrencyText(0.0125, 1 / 96000)], [getStrings('en').axisLag, lagText(0.00125, 1 / 96000)]]) {
        const unit = /\[([^\]]+)\]$/u.exec(axis)?.[1];
        assert.equal(text.split(' ').at(-1), unit, `"${text}" on an axis named "${axis}"`);
    }
});

test('a negative number is written with a true minus sign, its exponent too, never a hyphen (R7)', () => {
    assert.equal(withMinus('-3.2'), '−3.2');
    assert.equal(withMinus('1.5e-7'), '1.5e−7');
    assert.equal(withMinus('1.5e+7'), '1.5e7');
    for (const text of [levelText(-1, 'dBFS'), secondsText(-1), amountText(-1), amountText(-1e-9), frequencyText(-2000), signedText(-1), lagText(-0.001), quefrencyText(-0.001), barkText(-1), signedNumberText(-1)]) {
        assert.ok(!text.includes('-'), `${text} has no hyphen`);
    }
});

test('the same frequency and level read the same on the comparison, the cursor spectrum and a spectrogram lane (R7)', () => {
    const view: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs: [1015.625], values: [-42.3] };
    const plot: StagePlot = { frame: { left: 0, top: 0, width: 200, height: 100 }, xAt: () => 100, xOf: () => 1015.625, yAt: () => 50, ratioStep: 1.12, levelUnit: 'dB', lines: [{ view, color: 'blue', label: 'a.wav', full: held(view) }], diff: false };
    const comparison = stageHover(plot, 100, 50)!.text;
    const spectrum = spectrumReadoutText('a.wav', { values: [], frequencyBins: 0, maxFrequencyHz: 0, minDb: 0, maxDb: 0, unit: 'dB' }, 1015.625, -42.3);
    const lane = spectrogramReadoutText('a.wav', 1, 0.01, { frequencyHz: 1015.625, level: -42.3 }, 'dB');
    for (const text of [comparison, spectrum, lane]) {
        assert.ok(text.includes('1.016 kHz'), text);
        assert.ok(text.includes('−42.3 dB'), text);
    }
    // Bins 0.732 Hz apart: each plot tells two neighbours apart, the same way.
    const step = 48000 / 65536, xs = [1369 * step, 1370 * step];
    const fine: StagePlot = { ...plot, xAt: value => 50 + (value - xs[0]) / (xs[1] - xs[0]) * 100, xOf: x => xs[0] + (x - 50) / 100 * (xs[1] - xs[0]), lines: [{ view: { ...view, xs, values: [-42.3, -42.3] }, color: 'blue', label: 'a.wav', full: held({ ...view, xs, values: [-42.3, -42.3] }) }] };
    const fineSlice = { values: [], frequencyBins: 65537, maxFrequencyHz: 48000, minDb: 0, maxDb: 0, unit: 'dB' };
    const readouts = xs.map((hz, i) => [stageHover(fine, i ? 150 : 50, 50)!.text, spectrumReadoutText('a.wav', fineSlice, hz, -42.3), spectrogramReadoutText('a.wav', 1, 0.01, { frequencyHz: hz, level: -42.3, stepHz: step }, 'dB')]);
    for (const [i, expected] of ['1.0027 kHz', '1.0034 kHz'].entries()) for (const text of readouts[i]) assert.ok(text.includes(expected), text);
});

test('the distribution reads a value as a plot does, not as the table column writes it (R7)', () => {
    assert.equal(formatValue('peak', 3150), '3150');
    assert.equal(plotValueText('peak', 3150, undefined, 'dBFS'), '3.15 kHz');
    assert.equal(plotValueText('peak', 250, undefined, 'dBFS'), '250 Hz');
    // A level says its reference, as its axis does (R7): never a bare number.
    assert.equal(plotValueText('leq', -12.34, undefined, 'dBFS'), '−12.3 dBFS');
    assert.equal(plotValueText('band:1000', 61, undefined, 'dB SPL re 20 µPa'), '61.0 dB SPL re 20 µPa');
    assert.equal(plotValueText('crest', 4.567, undefined, 'dBFS'), '4.57');
    assert.equal(plotValueText('csv:score', 1234.5, undefined, 'dBFS'), '1230');
});

test('neighbouring distribution bins never read the same: the bins\' width adds the digits it needs (R7)', () => {
    const width = 1;
    const edges = [3000, 3001, 3002, 3003].map(edge => plotValueText('csv:rpm', edge, width, ''));
    assert.deepEqual(edges, ['3000', '3001', '3002', '3003']);
    assert.equal(plotValueText('csv:score', 0.1234, 0.001, ''), '0.123');
    assert.equal(plotValueText('csv:score', 12.3456, 0.01, ''), '12.35');
    assert.equal(plotValueText('leq', 61.234, 0.05, 'dBFS'), '61.23 dBFS');
    assert.equal(plotValueText('peak', 3150.4, 0.5, ''), '3.1504 kHz');
    // Bins wider than three figures resolve: the value's own three figures.
    assert.equal(plotValueText('csv:rpm', 3001, 100, ''), '3000');
});

test('the lint stops a minus sign picked by hand, as a lone string or a replaced hyphen (R7)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'minus-'));
    const file = path.join(dir, 'sample.ts');
    writeFileSync(file, [
        "const signed = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v)}`;",
        "const level = (v: number): string => `${v < 0 ? \"−\" : ''}${Math.abs(v)}`;",
        "const fixed = (v: number): string => String(v).replace(/^-/, '−');",
        "const fine = (v: number): string => `${v} − ${v}`;",
    ].join('\n'));
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'lint-webview-patterns.js'), '--minus-hits', file], { encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(run.stdout.trim().split('\n').map(line => line.split(':').pop()), ['1', '2', '3']);
});

test('the lint stops a number the report writes without plotText\'s minus: "-1.8 dBFS" (R7)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'report-minus-'));
    const file = path.join(dir, 'sample.ts');
    writeFileSync(file, [
        "const level = (v: number): string => v.toFixed(1) + ' dBFS';",
        "const time = (v: number): string => withMinus(v.toFixed(3)) + ' s';",
        "const both = (v: number): string => withMinus(v.toFixed(3)) + ' / ' + v.toPrecision(3);",
        "const shown = (v: number): string => levelText(v, 'dBFS');",
    ].join('\n'));
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'lint-webview-patterns.js'), '--report-number-hits', file], { encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(run.stdout.trim().split('\n').map(line => line.split(':').pop()), ['1', '3']);
});

test('every tick and readout takes its digits from the spacing of its neighbours: no two read the same, none reads a value it is not at (C3)', () => {
    // A log frequency axis zoomed into a few bins, or a little: round ticks inside the window, each written as the value it is at.
    const kHz = (text: string): number => (text.endsWith('k') ? Number(text.slice(0, -1).replace('−', '-')) * 1000 : Number(text.replace('−', '-')));
    for (const [low, high] of [[1000.5, 1005], [10000, 10040], [995, 1005], [600, 1800], [1500, 1700], [20, 20000]]) {
        for (const ticks of [alongAxisTicks(low, high, true), rowAxisTicks(low, high, true, 300)]) {
            const texts = ticks.map(tick => tick.text);
            assert.equal(new Set(texts).size, texts.length, `${low}–${high} Hz: ${texts.join(' ')}`);
            for (const tick of ticks) assert.ok(Math.abs(kHz(tick.text) - tick.value) < 1e-6, `${low}–${high} Hz: "${tick.text}" is at ${tick.value}`);
            assert.ok(texts.every(text => kHz(text) >= low && kHz(text) <= high), `${low}–${high} Hz: ${texts.join(' ')} inside the window`);
            assert.ok(!(texts.some(text => text.endsWith('k')) && texts.some(text => !text.endsWith('k') && kHz(text) >= 1000)), `${low}–${high} Hz: never "1000" beside "1k"`);
        }
    }
    // A caller's own tick text (the entry overview's whole row numbers on a few rows) never writes a number twice.
    const rows = rowAxisTicks(0, 3, false, 300, value => String(Math.round(value))).map(tick => tick.text);
    assert.equal(new Set(rows).size, rows.length, rows.join(' '));
    // A time axis zoomed to a few samples.
    const times = alongAxisTicks(1.23451, 1.23459).map(tick => tick.text);
    assert.equal(new Set(times).size, times.length, times.join(' '));
    // Neighbouring samples, lags and quefrencies read apart at any rate.
    const rate = 192000, step = 1 / rate;
    for (const at of [0.0125, 3.27, 9.99]) {
        assert.notEqual(laneReadoutText('', at, 0.01, 0.5, 'FS', step), laneReadoutText('', at + step, 0.01, 0.5, 'FS', step), `a sample at ${at} s and the next`);
        assert.notEqual(quefrencyText(at / 100, step), quefrencyText(at / 100 + step, step), `quefrencies ${step} s apart`);
        assert.notEqual(lagText(at / 100, step), lagText(at / 100 + step, step), `lags ${step} s apart`);
    }
    // An axis range's field keeps the range it shows: a window of a few samples applied unchanged stays that window.
    const [low, high] = [1.23456, 1.23461];
    const window = fieldWindow(low, high), typed = [exactFieldText(window.min), exactFieldText(window.max)].map(Number);
    assert.ok(typed[1] > typed[0] && Math.abs(typed[0] - low) < (high - low) / 1000 && Math.abs(typed[1] - high) < (high - low) / 1000, typed.join('–'));
    assert.equal(exactFieldText(fieldWindow(-12.3456789, 27.6543211).min), '-12.346');
    // Without a finer spacing, the usual digits.
    assert.equal(quefrencyText(0.0025), '0.00250 s');
    assert.equal(lagText(-0.0005), '−0.00050 s');
});

test('over every axis kind and zoom level, neighbouring ticks and neighbouring points never write the same number (C3)', () => {
    // A grid, not examples: a formatter that takes its digits from anything but the spacing (the pixel width, fixed
    // figures, a fixed cap) writes two neighbours alike somewhere on it.
    const centres = [-7.3, 0.0897, 0.5, 3.27, 60.2, 1000.5, 15997.3];
    const spans = [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.1, 1, 10, 100, 1000];
    const alike = (texts: readonly string[]): boolean => new Set(texts).size !== texts.length;
    for (const centre of centres) {
        for (const relative of spans) {
            const span = Math.abs(centre) * relative || relative, low = centre - span / 2, high = centre + span / 2;
            const where = `${low}–${high}`;
            if (span >= 1e-8) {
                for (const ticks of [alongAxisTicks(low, high), rowAxisTicks(low, high, false, 300)]) {
                    assert.ok(ticks.length > 1 && !alike(ticks.map(tick => tick.text)), `linear ${where}: ${ticks.map(tick => tick.text).join(' ')}`);
                }
            }
            const levels = valueAxisTicks({ min: low, max: high }, 300).map(tick => tick.text);
            assert.ok(levels.length > 1 && !alike(levels), `value axis ${where}: ${levels.join(' ')}`);
            if (low > 1 && high < 24000) {
                for (const ticks of [alongAxisTicks(low, high, true), rowAxisTicks(low, high, true, 300)]) {
                    assert.ok(!alike(ticks.map(tick => tick.text)), `log ${where}: ${ticks.map(tick => tick.text).join(' ')}`);
                }
            }
            const ends = fieldWindow(low, high), fields = [exactFieldText(ends.min), exactFieldText(ends.max)];
            assert.ok(Number(fields[1]) > Number(fields[0]), `range field ${where}: ${fields.join('–')}`);
            if (low >= 0 && span >= 1e-5) assert.notEqual(...regionCells({ start: low, end: high }), `region cells ${where}`);
        }
    }
    // Finer than the digits' cap (a window under a nanosecond typed into the range field): each number written once.
    const capped = alongAxisTicks(0.0159449045, 0.0159449069).map(tick => tick.text);
    assert.ok(!alike(capped), capped.join(' '));
    for (const step of [1 / 8000, 1 / 48000, 1 / 192000, 1e-6]) {
        for (const at of [0.0125, 3.27, 599.99]) {
            for (const [name, base, text] of [['time', at, (x: number) => laneReadoutText('', x, 0.01, 0.5, 'FS', step)], ['quefrency', at / 100, (x: number) => quefrencyText(x, step)], ['lag', at / 100 - 1, (x: number) => lagText(x, step)]] as const) {
                assert.notEqual(text(base), text(base + step), `${name} ${step} s apart at ${base}`);
            }
        }
    }
    for (const stepHz of [0.05, 0.73, 1.95, 12.5]) {
        for (const at of [15.6, 999.9, 1000.5, 12345.6]) assert.notEqual(frequencyText(at, stepHz), frequencyText(at + stepHz, stepHz), `bins ${stepHz} Hz apart at ${at} Hz`);
    }
});

test('a stretch of time is written to 10 ms, finer where its ends would read alike, with a true minus: the pair header and the report write it so (C3)', () => {
    assert.equal(secondsSpanText(1, 3), '1.00–3.00 s');
    assert.equal(secondsSpanText(-0.5, 3), '−0.50–3.00 s');
    const [start, end] = secondsSpanText(1.2341, 1.2346).replace(' s', '').split('–');
    assert.notEqual(start, end, 'a short stretch reads two ends');
    assert.equal(Number(start), 1.2341);
    const fixture = { averages: 32, startSeconds: 1.2341, endSeconds: 1.2346 };
    assert.match(pairHeader([{ response: { status: 'ok', axisLabel: 'a', ...fixture } } as unknown as PairCurve], { pairAverages: '{n} avg' } as PairStrings)?.text ?? '', / 1\.23410–1\.23460 s$/u);
});

test('a level or a difference written as zero is never negative: "0.0 dB" and "+0.0", not "−0.0" (A36, C5)', () => {
    assert.equal(levelText(-0.04, 'dB'), '0.0 dB');
    assert.equal(levelText(-0.06, 'dB'), '−0.1 dB');
    assert.equal(signedNumberText(-0.04), '+0.0');
    assert.equal(signedText(-0.04), '+0.0 dB');
    assert.equal(signedText(0.06), '+0.1 dB');
    assert.equal(signedNumberText(-0.0004, 3), '+0.000');
});

test('every region shown on screen or in a report is written by secondsSpanText (R7): no span of its own fixed at 10 ms', () => {
    const webview = path.resolve(__dirname, '..', '..', 'src', 'webview');
    const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? files(full) : name.endsWith('.ts') ? [full] : [];
    });
    // A start and an end each to a fixed number of decimals, joined by the en dash a shown span has (keys use "-").
    const fixedSpan = /toFixed\(\d\)\}\s*–\s*\$\{[^}]*toFixed\(\d\)/u;
    const found = files(webview).filter(file => fixedSpan.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, '')));
    // entryTable.regionLabel is a key (a fixed difference's region, parsed back), never shown as a span.
    assert.deepEqual(found.map(file => path.relative(webview, file)), [path.join('runtime', 'entryTable.ts')]);
    assert.equal(secondsSpanText(0.5, 0.503), '0.5000–0.5030 s', 'a short region to a tenth of its length');
});
