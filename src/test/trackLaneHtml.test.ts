import assert from 'node:assert/strict';
import type { ChannelSummary } from '../shared/analysis/analysisTypes';
import test from 'node:test';
import { channelLaneHtml, trackRowHtml, type ChannelLaneSpec, type TrackRowSpec, type TrackRowStrings } from '../webview/runtime/trackLaneHtml';

const base: ChannelLaneSpec = {
    trackId: 't1',
    trackIndex: 1,
    channelIndex: 0,
    channelCount: 1,
    channelLabel: 'Ch 1',
    metricSummaryHtml: '<span>Peak 80.0 dB</span>',
    axisWidth: 64,
    waveformLabel: 'a<b>.wav · Ch 1 · waveform',
    spectrogramLabel: 'a<b>.wav · Ch 1 · spectrogram',
    axisHint: 'Double-click: reset',
    spectrogramAxisHint: 'Double-click: reset zoom',
    splitHint: 'Drag the split',
    splitLabel: 'Split',
};

test('single-channel lane has no header and uses unsuffixed canvas ids', () => {
    const html = channelLaneHtml(base);
    assert.ok(!html.includes('track-channel-lane-header'));
    assert.ok(!html.includes('Peak 80.0 dB'));
    assert.ok(html.includes('id="track-canvas-1"'));
    assert.ok(!html.includes('track-spectrum'));
    assert.ok(html.includes('style="width:64px"'));
    assert.ok(html.includes('left:64px'));
});

test('multi-channel lane shows the label header with the metric summary', () => {
    const html = channelLaneHtml({ ...base, channelIndex: 1, channelCount: 2, channelLabel: 'Ch <2>' });
    assert.ok(html.includes('<span class="track-channel-lane-label">Ch &lt;2&gt;</span><span>Peak 80.0 dB</span>'));
    assert.ok(html.includes('id="track-canvas-1-1"'));
    assert.equal(html.match(/data-track-id="t1" data-channel-index="1"/g)?.length, 7);
});

test('the waveform and spectrogram canvases are named by file, channel and kind, with no inline outline over the focus ring', () => {
    const html = channelLaneHtml(base);
    assert.ok(html.includes('class="track-canvas" id="track-canvas-1" data-track-id="t1" data-channel-index="0" data-plot data-plot-axes="" tabindex="0" role="img" aria-label="a&lt;b&gt;.wav · Ch 1 · waveform"'));
    assert.ok(html.includes('aria-label="a&lt;b&gt;.wav · Ch 1 · spectrogram"'));
    assert.ok(!html.includes('outline:none'));
    assert.ok(html.includes('role="separator" tabindex="0"'));
});

const rowStrings = {
    ariaDragHandle: 'Drag', clipBadgeTitle: 'Clipped',
    trackPlayTitle: 'Play', ariaTrackPlay: 'Play track', trackStopTitle: 'Stop', ariaTrackStop: 'Stop track',
    ariaRemoveTrack: 'Remove',
    calibrationButtonLabel: 'Cal', calibrationButtonTitle: 'Calibrate', calibrationButtonAria: 'Calibrate track',
    trackOffsetResetHint: 'Reset', ariaOffsetValue: 'Offset', ariaOffsetUp: 'Up', ariaOffsetDown: 'Down',
    ariaResizeTrackHeight: 'Track height',
    hintRemoveTrack: 'Remove this track', hintOffsetUp: '+10 ms', hintOffsetDown: '-10 ms', hintTrackHeightResizer: 'Drag height',
    trackMoreHint: 'Time offset', offsetStepUp: '+10 ms', offsetStepDown: '−10 ms', offsetEdit: 'Type…', offsetReset: 'Reset to 0',
    trackNoAudio: 'No audio',
    peakLabel: 'Pk', calibrationBadgeUncalibratedHint: 'Full scale', calibrationBadgeRawHint: 'Raw', calibrationBadgePartialHint: 'Partial', calibrationFactorLabel: 'k',
} satisfies TrackRowStrings;

const baseRow: TrackRowSpec = {
    trackId: 'track-3',
    trackIndex: 2,
    fileName: 'a&b.wav',
    filePath: '/x/a&b.wav',
    channelCount: 2,
    sampleRateHz: 48000,
    channels: [],
    roleChipHtml: '<i>chip</i>',
    playable: true,
    lanesHtml: '<i>lanes</i>',
};

test('track row renders header, controls and the given lanes', () => {
    const html = trackRowHtml(baseRow, rowStrings);
    assert.ok(html.startsWith('<div class="track-row" id="track-row-2" data-track-id="track-3" data-file-path="/x/a&amp;b.wav">'));
    assert.ok(html.includes('<i>chip</i>'));
    assert.ok(html.includes('<div class="track-name" data-hint="/x/a&amp;b.wav" aria-description="/x/a&amp;b.wav">a&amp;b.wav</div>'));
    assert.ok(html.includes('<div class="track-meta">2 ch &nbsp;48.0kHz</div>'));
    assert.ok(html.includes('id="offset-val-2"'));
    assert.ok(html.includes('<div class="track-channel-lanes"><i>lanes</i></div>'));
    assert.ok(html.includes('aria-label="Track height"'));
    assert.ok(html.includes('data-action="toggle-playback"') && html.includes('data-action="stop-playback"'));
    assert.ok(!html.includes(' disabled'));
    assert.ok(!html.includes('clip-badge'));
});

test('track row disables transport buttons without audio', () => {
    const html = trackRowHtml({ ...baseRow, playable: false }, rowStrings);
    assert.equal(html.match(/ disabled>/g)?.length, 2);
    assert.ok(!html.includes('toggle-mute'));
    // A disabled button says why in its hint.
    assert.equal(html.match(/data-hint="No audio"/g)?.length, 2);
});

test('mono track row appends the channel summary to the meta line', () => {
    const channel = { label: 'L', peakAbsolute: 1.5, peakLevelDb: 80, fullScale: true, waveform: { min: [], max: [], samples: [], absolutePeak: 0 }, spectrogram: null } as unknown as ChannelSummary;
    const html = trackRowHtml({ ...baseRow, channelCount: 1, channels: [channel] }, rowStrings);
    assert.ok(html.includes('<div class="track-meta">1 ch &nbsp;48.0kHz &nbsp; <span>Pk 80.0 dB</span></div>'));
    assert.ok(html.includes('data-hint="Full scale"'));
    assert.ok(html.includes('class="clip-badge"'));
    const csv = trackRowHtml({ ...baseRow, channelCount: 1, channels: [{ ...channel, fullScale: false, clipped: null }] }, rowStrings);
    assert.ok(csv.includes('data-hint="Raw"') && csv.includes('>RAW</span>'), 'a CSV track is uncalibrated in raw input units, not FS');
    assert.ok(!csv.includes('>FS</span>'));
});

test('every track header control and the lane canvases carry a footer hint', () => {
    const row = trackRowHtml(baseRow, rowStrings);
    for (const control of row.match(/<(button|span class="track-offset-val"|div class="height-resizer)\b[^>]*>/g) ?? []) {
        assert.match(control, / data-hint="[^"]+"/, control);
    }
    const lane = channelLaneHtml(base);
    assert.match(lane, /class="track-axis-canvas"[^>]* data-hint="Double-click: reset"/);
});

test('the reference button sits in a multi-channel lane header or in a mono track\'s buttons', () => {
    const button = '<button data-action="set-pair-reference"></button>';
    assert.ok(channelLaneHtml({ ...base, channelCount: 2, referenceButtonHtml: button }).includes('<span>Peak 80.0 dB</span>' + button + '</div>'));
    assert.ok(!channelLaneHtml({ ...base, referenceButtonHtml: button }).includes(button));
    const row = trackRowHtml({ ...baseRow, referenceButtonHtml: button }, rowStrings);
    assert.ok(row.indexOf(button) > row.indexOf('data-action="configure-calibration"'));
    assert.ok(row.indexOf(button) < row.indexOf('class="track-offset"'));
    assert.ok(!trackRowHtml(baseRow, rowStrings).includes('set-pair-reference'));
});
