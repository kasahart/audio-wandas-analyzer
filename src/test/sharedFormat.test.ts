import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
    channelLabel, formatClockTime, formatMeasuredLevel, formatMeasurementNumber, formatReportDuration, FORMAT_SCRIPT_SOURCE,
} from '../shared/utils/format';
import { escapeHtml } from '../shared/utils/webviewEscaping';
import { PendingBackendRequests } from '../shared/protocol/backendProtocol';

test('measurement formatting keeps the calibration panel and report wording', () => {
    assert.deepEqual([1234.5, 12.345, 0.1234, 0.001234, Number.NaN].map(formatMeasurementNumber), ['1235', '12.35', '0.123', '0.00123', '—']);
    assert.equal(formatMeasuredLevel(0.5, -6.02, { calibrationStatus: 'calibrated', linearUnit: 'Pa', levelUnit: 'dB SPL' }), '0.500 Pa / -6.0 dB SPL');
    assert.equal(formatMeasuredLevel(0.5, -6.02, { calibrationStatus: 'uncalibrated', linearUnit: 'FS', levelUnit: 'dBFS' }), '-6.0 dBFS');
    assert.equal(formatMeasuredLevel(0.5, -6.02, undefined), '-6.0 dB');
    assert.equal(formatMeasuredLevel(0.5, Number.NaN, undefined), null);
});

test('time and channel labels share one implementation', () => {
    assert.equal(formatClockTime(65.5), '1:05.50');
    assert.equal(formatReportDuration(65.5), '1m 5.500s');
    assert.equal(formatReportDuration(2.5), '2.500s');
    assert.equal(channelLabel({ channels: [{ label: 'Channel 1' }, { label: 'Mic B' }] }, 1), 'Channel 2 / 2 (Mic B)');
    assert.equal(channelLabel({ channels: [{ label: 'Channel 1' }], channelCount: 1 }, 0), 'Channel 1');
});

test('render scripts can inline the shared formatters', () => {
    const context: Record<string, unknown> = {};
    runInNewContext(`${FORMAT_SCRIPT_SOURCE}; result = [formatMeasuredLevel(2, 40, { calibrationStatus: 'calibrated', linearUnit: 'Pa', levelUnit: 'dB SPL' }), channelsForResult(null).length];`, context);
    assert.equal(JSON.stringify(context.result), JSON.stringify(['2.00 Pa / 40.0 dB SPL', 0]));
});

test('webview HTML escaping covers quotes and apostrophes', () => {
    assert.equal(escapeHtml(`<a href="x">it's</a>`), '&lt;a href=&quot;x&quot;&gt;it&#39;s&lt;/a&gt;');
    assert.equal(escapeHtml(undefined), 'undefined');
});

test('pending requests number ids per host and unregister a request whose send fails', async () => {
    const pending = new PendingBackendRequests<Record<string, unknown>>('browser-');
    assert.deepEqual([pending.nextId(), pending.nextId()], ['browser-1', 'browser-2']);
    const ok = pending.dispatch('analyze', 'a', response => response.value, () => {});
    pending.get('a')!.complete({ value: 3 });
    assert.equal(await ok, 3);
    await assert.rejects(pending.dispatch('analyze', 'b', response => response, () => { throw new Error('closed'); }), /closed/);
    assert.equal(pending.has('b'), false);
});
