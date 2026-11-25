import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { deltaAxisName, levelUnitOfName, lineAxisNames, withDeltaPair, type LineAxis } from '../webview/figure/axisNames';

test('an axis the picture says nothing more of is a spectrum\'s: a frequency across, a level up', () => {
    const strings = getStrings('en');
    const axis: LineAxis = { quantity: 'level', referenceLabel: 'dBFS', calibration: 'uncalibrated' };
    assert.deepEqual(lineAxisNames(strings, axis), { x: strings.axisFrequency, y: strings.axisLevelUncal.replace('{label}', 'dBFS') });
    assert.deepEqual(lineAxisNames(withDeltaPair(strings, 1), { ...axis, quantity: 'delta' }), { x: strings.axisFrequency, y: 'Δ = Compare 1 − Base [dB]' });
});

test('a dB axis\'s unit is read from its name, and no other axis has one', () => {
    assert.equal(levelUnitOfName('Gain [dB]'), 'dB');
    assert.equal(levelUnitOfName('Transfer level, uncalibrated · ch2 / ch1 [dB re 2e-05 Pa/V]'), 'dB re 2e-05 Pa/V');
    assert.equal(levelUnitOfName('Coherence γ² [–]'), '');
    assert.equal(levelUnitOfName('RMS [Pa]'), '');
});

test('every Δ says what it is the difference of: the compared slot minus the base (#848)', () => {
    for (const lang of ['en', 'ja'] as const) {
        const strings = getStrings(lang);
        // The dB Δ's axis and the headline take the pair; the pair names the slot as the legend does, and the base as the table does.
        assert.ok(strings.axisDelta.includes('{pair}'), `${lang} axisDelta takes {pair}`);
        assert.ok(strings.stageMaxDelta.includes('{pair}'), `${lang} stageMaxDelta takes {pair}`);
        for (const n of [1, 2, 3]) assert.ok(withDeltaPair(strings, n).deltaPair.includes(strings.dsSlotCompare.replace('{n}', String(n))), `${lang} slot ${n} named as the legend does`);
        assert.ok(strings.deltaPair.includes(strings.entryBase), `${lang} deltaPair names the Base as the table does`);
    }
    const en = getStrings('en');
    const axis: LineAxis = { quantity: 'delta', referenceLabel: 'dBFS', calibration: 'uncalibrated' };
    // The compared slot is the screen's to say: slot 2 tapped, or slot 1 empty (trackStageModel.ts comparedPath).
    assert.equal(lineAxisNames(withDeltaPair(en, 1), axis).y, 'Δ = Compare 1 − Base [dB]');
    assert.equal(lineAxisNames(withDeltaPair(en, 2), axis).y, 'Δ = Compare 2 − Base [dB]');
    assert.equal(withDeltaPair(en, 3).stageMaxDelta, 'largest Δ (Compare 3 − Base) {at} {delta}');
    assert.equal(withDeltaPair(getStrings('ja'), 2).stageMaxDelta, '最大 Δ（比較 2 − 基準）{at} {delta}');
    assert.equal(deltaAxisName(withDeltaPair(en, 1), 'RMS [Pa]'), 'Δ RMS = Compare 1 − Base [Pa]');
    assert.equal(deltaAxisName(withDeltaPair(en, 2), 'Amplitude'), 'Δ Amplitude = Compare 2 − Base');
    assert.equal(deltaAxisName(withDeltaPair(getStrings('ja'), 1), '振幅 [Pa]'), 'Δ 振幅 = 比較 1 − 基準 [Pa]');
});
