import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { deltaAxisName, levelUnitOfName, lineAxisNames, type LineAxis } from '../webview/figure/axisNames';

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

test('every Δ says it is Compare 1 − Base, the only pair its lane draws (#848)', () => {
    for (const lang of ['en', 'ja'] as const) {
        const strings = getStrings(lang);
        // The dB Δ's axis, the headline and a Δ in another unit all name the pair, in the slot names the legend uses.
        assert.ok(strings.axisDelta.includes(strings.deltaPair), `${lang} axisDelta names ${strings.deltaPair}`);
        assert.ok(strings.stageMaxDelta.includes(strings.deltaPair), `${lang} stageMaxDelta names ${strings.deltaPair}`);
        assert.ok(strings.deltaPair.includes(strings.dsSlotCompare.replace('{n}', '1')), `${lang} deltaPair names the Compare 1 slot as the legend does`);
        assert.ok(strings.deltaPair.includes(strings.entryBase), `${lang} deltaPair names the Base as the table does`);
    }
    const en = getStrings('en');
    assert.equal(en.axisDelta, 'Δ = Compare 1 − Base [dB]');
    assert.equal(deltaAxisName(en, 'RMS [Pa]'), 'Δ RMS = Compare 1 − Base [Pa]');
    assert.equal(deltaAxisName(en, 'Amplitude'), 'Δ Amplitude = Compare 1 − Base');
    assert.equal(deltaAxisName(getStrings('ja'), '振幅 [Pa]'), 'Δ 振幅 = 比較 1 − 基準 [Pa]');
});
