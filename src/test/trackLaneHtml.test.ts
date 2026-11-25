import assert from 'node:assert/strict';
import type { ChannelSummary } from '../shared/analysis/analysisTypes';
import test from 'node:test';
import { channelLaneHtml, trackNameHtml, trackRowHtml, type ChannelLaneSpec, type TrackRowSpec, type TrackRowStrings } from '../webview/runtime/trackLaneHtml';

const base: ChannelLaneSpec = {
    trackId: 't1',
    trackIndex: 1,
    channelIndex: 0,
    channelCount: 1,
    channelLabel: 'Ch 1',
    metricSummaryHtml: '<span>Peak 80.0 dB</span>',
    splitHint: 'Drag the split',
    splitLabel: 'Split',
};

test('single-channel lane has no header and its Figure\'s box has an unsuffixed id', () => {
    const html = channelLaneHtml(base);
    assert.ok(!html.includes('track-channel-lane-header'));
    assert.ok(!html.includes('Peak 80.0 dB'));
    assert.ok(html.includes('<div class="track-row-figure" id="track-row-figure-1"><canvas class="track-row-layer" aria-hidden="true"></canvas><div class="track-row-says" hidden></div></div>'));
    assert.ok(!html.includes('track-canvas-wrap') && !html.includes('track-axis-canvas'), 'a lane holds no canvas of its own beside its Figure\'s box');
});

test('multi-channel lane shows the label header with the metric summary', () => {
    const html = channelLaneHtml({ ...base, channelIndex: 1, channelCount: 2, channelLabel: 'Ch <2>' });
    assert.ok(html.includes('<span class="track-channel-lane-label">Ch &lt;2&gt;</span><span>Peak 80.0 dB</span>'));
    assert.ok(html.includes('id="track-row-figure-1-1"'));
    // The lane and the split between its Figure's two lanes.
    assert.equal(html.match(/data-track-id="t1" data-channel-index="1"/g)?.length, 2);
});

test('the split between a lane\'s waveform and spectrogram is a separator the keyboard reaches', () => {
    const html = channelLaneHtml(base);
    assert.ok(html.includes('role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Split"'));
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
    trackNoAudio: 'No audio', reanalyzeChanged: 'Analyse again', reanalyzeChangedHint: 'Changed on disk',
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
    assert.ok(html.includes('<div class="track-meta">2 ch &nbsp;48 kHz</div>'));
    assert.ok(html.includes('id="offset-val-2"'));
    assert.ok(html.includes('<div class="track-channel-lanes"><i>lanes</i></div>'));
    assert.ok(html.includes('aria-label="Track height"'));
    assert.ok(html.includes('data-action="toggle-playback"') && html.includes('data-action="stop-playback"'));
    assert.ok(!html.includes(' disabled'));
    assert.ok(!html.includes('clip-badge'));
});

test('a track row writes its sample rate as every plot writes a frequency (plotText.frequencyText)', () => {
    for (const [rate, text] of [[48000, '48 kHz'], [44100, '44.1 kHz'], [22050, '22.05 kHz'], [16000, '16 kHz'], [8000, '8 kHz']] as const) {
        assert.ok(trackRowHtml({ ...baseRow, sampleRateHz: rate }, rowStrings).includes(`<div class="track-meta">2 ch &nbsp;${text}</div>`), text);
    }
});

test('track row disables transport buttons without audio', () => {
    const html = trackRowHtml({ ...baseRow, playable: false }, rowStrings);
    assert.equal(html.match(/ disabled>/g)?.length, 2);
    assert.ok(!html.includes('toggle-mute'));
    // A disabled button says why in its hint.
    assert.equal(html.match(/data-hint="No audio"/g)?.length, 2);
});

test('mono track row appends the channel summary to the meta line', () => {
    const channel = { label: 'L', peakAbsolute: 1.5, peakLevelDb: 80, fullScale: true } as unknown as ChannelSummary;
    const html = trackRowHtml({ ...baseRow, channelCount: 1, channels: [channel] }, rowStrings);
    assert.ok(html.includes('<div class="track-meta">1 ch &nbsp;48 kHz &nbsp; <span>Pk 80.0 dBFS</span></div>'));
    assert.ok(html.includes('data-hint="Full scale"'));
    assert.ok(html.includes('class="clip-badge"'));
    const csv = trackRowHtml({ ...baseRow, channelCount: 1, channels: [{ ...channel, fullScale: false, clipped: null }] }, rowStrings);
    assert.ok(csv.includes('data-hint="Raw"') && csv.includes('>RAW</span>'), 'a CSV track is uncalibrated in raw input units, not FS');
    assert.ok(!csv.includes('>FS</span>'));
});

test('every track header control and the split between a row\'s lanes carry a footer hint', () => {
    const row = trackRowHtml(baseRow, rowStrings);
    for (const control of row.match(/<(button|span class="track-offset-val"|div class="height-resizer)\b[^>]*>/g) ?? []) {
        assert.match(control, / data-hint="[^"]+"/, control);
    }
    const lane = channelLaneHtml(base);
    // The row's picture is a Figure's, which tells the footer where the pointer is itself (FigureOptions.hint); the
    // markup's own control is the split between the two lanes.
    assert.match(lane, /class="track-split"[^>]* data-hint="[^"]+"/);
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

test('a long track name gives way in its middle: the run number stays, the text is the whole name (#841)', () => {
    const html = trackNameHtml('L1_900rpm_run001.wav', '/m/L1_900rpm_run001.wav');
    assert.equal(html, '<div class="track-name is-split" data-hint="/m/L1_900rpm_run001.wav" aria-description="/m/L1_900rpm_run001.wav">'
        + '<span class="track-name-head">L1_900rpm_</span><span class="track-name-tail">run001</span><span class="track-name-ext">.wav</span></div>');
    // The cut never splits what is seen as one character: a base and its combining mark (a macOS name in NFD), an emoji.
    for (const name of ['計測_前方マイク_ガ12345.wav'.normalize('NFD'), 'L1_900rpm_🎵12345.wav', 'L1_900rpm_👍🏽12345.wav']) {
        const parts = /<span class="track-name-head">(.*?)<\/span><span class="track-name-tail">(.*?)<\/span>/u.exec(trackNameHtml(name, '/m/x'))!;
        assert.ok(parts, name);
        assert.ok(!/^\p{M}/u.test(parts[2]) && !/^[\uDC00-\uDFFF]/.test(parts[2]) && !/[\uD800-\uDBFF]$/.test(parts[1]), `${name}: ${parts[1]} | ${parts[2]}`);
        assert.equal(parts[1] + parts[2] + '.wav', name);
        assert.equal(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(parts[2])).length, 6);
    }
    // A short name is one box, as before.
    assert.equal(trackNameHtml('Rec_0012.wav', '/m/Rec_0012.wav'), '<div class="track-name" data-hint="/m/Rec_0012.wav" aria-description="/m/Rec_0012.wav">Rec_0012.wav</div>');
});
