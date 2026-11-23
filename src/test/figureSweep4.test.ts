/**
 * Class sweep 4 (reference, aggregation): a pair's picture is counted by its own identity and calibrated only when
 * both of its sides are; a channel names its own calibration; every figure counts one set, of the same channels on
 * both sides, with what it left out said with why. Each test injects the violation the sweep found.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { trackLevelInput, type LevelInput } from '../webview/runtime/comparePanes';
import { countedSet, setExclusionText } from '../webview/runtime/figureModel';

const strings = getStrings('en');
const FS: LevelInput = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true };

test('a channel taken from a file names that channel\'s calibration (reference #5)', () => {
    assert.equal(trackLevelInput([], { ...FS, channelCalibration: ['calibrated', 'uncalibrated'] }, 1).calibrationStatus, 'calibrated');
    assert.equal(trackLevelInput([], { ...FS, channelCalibration: ['calibrated', 'uncalibrated'] }, null).calibrationStatus, 'uncalibrated');
});

test('a member too large and one that failed are each said with why (aggregation V9, V13)', () => {
    // As the figure service counted them (計算ア): its reasons are the heading's words.
    const set = countedSet([], [{ path: '/a.wav', reason: 'too-large' }, { path: '/c.wav', reason: 'failed' }]);
    const text = setExclusionText(set, strings);
    assert.ok(text.includes(strings.dsBaseTooLarge.replace('{n}', '1')), text);
    assert.ok(text.includes(strings.dsBaseFailed.replace('{n}', '1')), 'too large is not said as failed');
});
