import assert from 'node:assert/strict';
import test from 'node:test';
import { tableValueText } from '../webview/shell/numberText';

test('a very small table value is written with its exponent, to the digits that tell values a bin apart', () => {
    // A column in 1e-9s: never a row of zeros, and two bins' ends never the same text.
    assert.equal(tableValueText(3.2e-9, 1e-10), '3.20e−9');
    assert.equal(tableValueText(3.3e-9, 1e-10), '3.30e−9');
    assert.equal(tableValueText(3.21e-9, 1e-12), '3.2100e−9');
    assert.notEqual(tableValueText(-4e-8), tableValueText(4e-8));
    // An ordinary value is written as before.
    assert.equal(tableValueText(20.0625, 0.354), '20.1');
});
