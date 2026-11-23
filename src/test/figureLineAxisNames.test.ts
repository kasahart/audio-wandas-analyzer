import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { levelUnitOfName, lineAxisNames, type LineAxis } from '../webview/figure/axisNames';

test('an axis the picture says nothing more of is a spectrum\'s: a frequency across, a level up', () => {
    const strings = getStrings('en');
    const axis: LineAxis = { quantity: 'level', referenceLabel: 'dBFS', calibration: 'uncalibrated' };
    assert.deepEqual(lineAxisNames(strings, axis), { x: strings.axisFrequency, y: strings.axisLevelUncal.replace('{label}', 'dBFS') });
    assert.deepEqual(lineAxisNames(strings, { ...axis, quantity: 'delta' }), { x: strings.axisFrequency, y: strings.axisDelta });
});

test('a dB axis\'s unit is read from its name, and no other axis has one', () => {
    assert.equal(levelUnitOfName('Gain [dB]'), 'dB');
    assert.equal(levelUnitOfName('Transfer level, uncalibrated · ch2 / ch1 [dB re 2e-05 Pa/V]'), 'dB re 2e-05 Pa/V');
    assert.equal(levelUnitOfName('Coherence γ² [–]'), '');
    assert.equal(levelUnitOfName('RMS [Pa]'), '');
});
