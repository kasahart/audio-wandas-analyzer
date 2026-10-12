import assert from 'node:assert/strict';
import test from 'node:test';
import { channelLaneHtml, type ChannelLaneSpec } from '../webview/runtime/trackLaneHtml';

const base: ChannelLaneSpec = {
    trackId: 't1',
    trackIndex: 1,
    channelIndex: 0,
    channelCount: 1,
    channelLabel: 'Ch 1',
    metricSummaryHtml: '<span>Peak 80.0 dB</span>',
    fileName: 'a<b>.wav',
    axisWidth: 64,
    spectrumTitle: 'Spectrum',
};

test('single-channel lane has no header and uses unsuffixed canvas ids', () => {
    const html = channelLaneHtml(base);
    assert.ok(!html.includes('track-channel-lane-header'));
    assert.ok(!html.includes('Peak 80.0 dB'));
    assert.ok(html.includes('id="track-canvas-1"'));
    assert.ok(html.includes('id="track-spectrum-1"'));
    assert.ok(html.includes('style="width:64px"'));
    assert.ok(html.includes('left:64px'));
});

test('multi-channel lane shows the label header with the metric summary', () => {
    const html = channelLaneHtml({ ...base, channelIndex: 1, channelCount: 2, channelLabel: 'Ch <2>' });
    assert.ok(html.includes('<span class="track-channel-lane-label">Ch &lt;2&gt;</span><span>Peak 80.0 dB</span>'));
    assert.ok(html.includes('id="track-canvas-1-1"'));
    assert.ok(html.includes('id="track-spectrum-wrap-1-1"'));
    assert.equal(html.match(/data-track-id="t1" data-channel-index="1"/g)?.length, 5);
});

test('spectrum canvas aria-label escapes the file name', () => {
    const html = channelLaneHtml(base);
    assert.ok(html.includes('aria-label="a&lt;b&gt;.wav Ch 1 Spectrum"'));
});
