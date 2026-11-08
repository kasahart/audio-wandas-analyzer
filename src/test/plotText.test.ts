import assert from 'node:assert/strict';
import test from 'node:test';
import type { StageView } from '../shared/protocol/backendProtocol';
import { amountText, frequencyText, levelText, secondsText, signedText, withMinus } from '../webview/plot/plotText';
import { spectrumReadoutText } from '../webview/runtime/spectrumRuntime';
import { stageHover, type StagePlot } from '../webview/runtime/stagePanes';
import { spectrogramReadoutText } from '../webview/runtime/trackLaneHover';

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

test('a level reads to a tenth of a decibel in its unit, a time in seconds, other values to three figures (R7)', () => {
    assert.equal(levelText(-42.31), '−42.3 dB');
    assert.equal(levelText(61, 'dB SPL'), '61.0 dB SPL');
    assert.equal(secondsText(1.234), '1.23 s');
    assert.equal(secondsText(-0.5, 3), '−0.500 s');
    assert.equal(amountText(-0.0123, 'Pa'), '−0.0123 Pa');
    assert.equal(amountText(0.5), '0.500');
    assert.equal(amountText(123.45, '°'), '123.5°');
    assert.equal(amountText(2.5e-7), '2.50e−7');
    assert.equal(signedText(3.21), '+3.2 dB');
    assert.equal(signedText(-0.125, false), '−0.125');
});

test('a negative number is written with a true minus sign, its exponent too, never a hyphen (R7)', () => {
    assert.equal(withMinus('-3.2'), '−3.2');
    assert.equal(withMinus('1.5e-7'), '1.5e−7');
    assert.equal(withMinus('1.5e+7'), '1.5e7');
    for (const text of [levelText(-1), secondsText(-1), amountText(-1), amountText(-1e-9), frequencyText(-2000), signedText(-1)]) {
        assert.ok(!text.includes('-'), `${text} has no hyphen`);
    }
});

test('the same frequency and level read the same on the comparison, the cursor spectrum and a spectrogram lane (R7)', () => {
    const view: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs: [1015.625], values: [-42.3] };
    const plot: StagePlot = { frame: { left: 0, top: 0, width: 200, height: 100 }, xAt: () => 100, yAt: () => 50, ratioStep: 1.12, lines: [{ view, color: 'blue', label: 'a.wav' }], diff: false };
    const comparison = stageHover(plot, 100, 50)!.text;
    const spectrum = spectrumReadoutText('a.wav', { values: [], frequencyBins: 0, maxFrequencyHz: 0, minDb: 0, maxDb: 0, unit: 'dB' }, 1015.625, -42.3);
    const lane = spectrogramReadoutText('a.wav', 1, 0.01, { frequencyHz: 1015.625, level: -42.3 }, 'dB');
    for (const text of [comparison, spectrum, lane]) {
        assert.ok(text.includes('1.016 kHz'), text);
        assert.ok(text.includes('−42.3 dB'), text);
    }
});
