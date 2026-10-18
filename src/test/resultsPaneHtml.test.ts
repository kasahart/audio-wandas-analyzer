import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { resultsPaneHtml, trackAudioHtml, type ResultsPaneParts } from '../webview/runtime/resultsPaneHtml';

const strings = getStrings('en');
const parts: ResultsPaneParts = {
    toolbarHtml: '<b>tb</b>',
    tracksHtml: '<i>tracks</i>',
    audioHtml: '<audio></audio>',
    emptyMessage: 'No <tracks>',
    axisWidth: 64,
    spectrumBandsPerOctave: 0,
};

test('results pane places the supplied toolbar, tracks and audio markup', () => {
    const html = resultsPaneHtml(parts, strings);
    assert.ok(html.startsWith('<div id="toolbar" role="toolbar"'));
    assert.ok(html.includes('"><b>tb</b></div>'));
    assert.ok(html.includes('<div id="stacked-wrap"><i>tracks</i></div>'));
    assert.ok(html.endsWith('<div id="audio-host"><audio></audio></div>'));
});

test('results pane escapes the empty message and sizes the ruler spacer to the axis', () => {
    const html = resultsPaneHtml(parts, strings);
    assert.ok(html.includes('<div id="empty-state"><p>No &lt;tracks&gt;</p></div>'));
    assert.ok(html.includes('id="ruler-axis-spacer" style="width:64px;flex:none"'));
});

test('results pane renders the spectrum section controls', () => {
    const html = resultsPaneHtml(parts, strings);
    for (const action of ['spec-zoom-out', 'spec-zoom-in', 'spec-zoom-reset', 'spectrum-settings', 'spectrum-height-drag']) {
        assert.ok(html.includes('data-action="' + action + '"'), action);
    }
    assert.ok(html.includes('<canvas id="spectrum-overlay-canvas" tabindex="0"'));
});

test('results pane marks the selected spectrum kind as pressed', () => {
    const pressed = (html: string) => Array.from(html.matchAll(/aria-pressed="true" data-action="(spectrum-[^"]+)"/g), match => match[1]);
    assert.deepEqual(pressed(resultsPaneHtml(parts, strings)), ['spectrum-fft']);
    assert.deepEqual(pressed(resultsPaneHtml({ ...parts, spectrumBandsPerOctave: 3 }, strings)), ['spectrum-octave-3']);
    assert.ok(resultsPaneHtml(parts, strings).includes('data-action="spectrum-octave-1" data-hint="' + strings.hintSpectrumOctave1 + '"'));
});

test('track audio element carries the track id, mute state and escaped source', () => {
    assert.equal(
        trackAudioHtml('track-2', 1, 'vscode-resource:/a&b.wav', false),
        '<audio id="track-audio-1" data-track-id="track-2" preload="metadata" crossorigin="anonymous" src="vscode-resource:/a&amp;b.wav"></audio>',
    );
    assert.ok(trackAudioHtml('track-2', 1, 'x.wav', true).includes('preload="metadata" crossorigin="anonymous" muted src="x.wav"'));
});

test('results pane puts a collapse toggle in the spectrum header and marks a collapsed section', () => {
    const open = resultsPaneHtml(parts, strings);
    assert.ok(open.includes('<div id="spectrum-section">'));
    assert.ok(open.includes('data-action="toggle-spectrum-panel" aria-expanded="true" data-hint="' + strings.hintCollapseSpectrum + '"'));
    const collapsed = resultsPaneHtml({ ...parts, spectrumCollapsed: true }, strings);
    assert.ok(collapsed.includes('<div id="spectrum-section" class="is-collapsed">'));
    assert.ok(collapsed.includes('data-action="toggle-spectrum-panel" aria-expanded="false" data-hint="' + strings.hintExpandSpectrum + '"'));
});
