import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { amountText, frequencyText, lagText, levelText, quefrencyText, secondsSpanText, secondsText, signedNumberText, signedText } from '../webview/shell/numberText';
import { pairHeader, type PairCurve, type PairStrings } from '../webview/runtime/pairSpectrum';

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

test('a quefrency and a lag read in the unit their axis is named in: seconds, as the axis says [s] (A36, R4, R7)', () => {
    const strings = getStrings('ja');
    for (const [axis, text] of [[strings.axisQuefrency, quefrencyText(0.0025)], [strings.axisLag, lagText(-0.0005)], [getStrings('en').axisQuefrency, quefrencyText(0.0125, 1 / 96000)], [getStrings('en').axisLag, lagText(0.00125, 1 / 96000)]]) {
        const unit = /\[([^\]]+)\]$/u.exec(axis)?.[1];
        assert.equal(text.split(' ').at(-1), unit, `"${text}" on an axis named "${axis}"`);
    }
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

test('a stretch of time is written to 10 ms, finer where its ends would read alike, with a true minus: the pair header and the report write it so (C3)', () => {
    assert.equal(secondsSpanText(1, 3), '1.00–3.00 s');
    assert.equal(secondsSpanText(-0.5, 3), '−0.50–3.00 s');
    const [start, end] = secondsSpanText(1.2341, 1.2346).replace(' s', '').split('–');
    assert.notEqual(start, end, 'a short stretch reads two ends');
    assert.equal(Number(start), 1.2341);
    const fixture = { averages: 32, startSeconds: 1.2341, endSeconds: 1.2346 };
    assert.match(pairHeader([{ drawn: true, response: { status: 'ok', axisLabel: 'a', ...fixture } } as unknown as PairCurve], { pairAverages: '{n} avg' } as PairStrings)?.text ?? '', / 1\.23410–1\.23460 s$/u);
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
    // compareBasics.regionLabel is a key (the comparison's region as its root's data-region says it), never shown as a span.
    assert.deepEqual(found.map(file => path.relative(webview, file)), [path.join('runtime', 'compareBasics.ts')]);
    assert.equal(secondsSpanText(0.5, 0.503), '0.5000–0.5030 s', 'a short region to a tenth of its length');
});

