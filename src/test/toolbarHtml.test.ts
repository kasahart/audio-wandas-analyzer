import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { escapeHtml } from '../shared/utils/webviewEscaping';
import { toolbarHtml, type ToolbarSpec } from '../webview/runtime/toolbarHtml';

const strings = getStrings('en');
const spec: ToolbarSpec = {
    contentType: 'waveform',
    trackHeight: 120,
    trackHeightRange: { min: 80, max: 400 },
    spectrumHeight: 200,
    spectrumHeightRange: { min: 100, max: 320 },
    appVersion: '1.2.3 (abc1234)',
};

test('toolbar marks the active content type', () => {
    assert.ok(toolbarHtml(spec, strings).includes('<button class="tb-btn is-active" data-action="content-waveform">'));
    const spectrogram = toolbarHtml({ ...spec, contentType: 'spectrogram' }, strings);
    assert.ok(spectrogram.includes('<button class="tb-btn is-active" data-action="content-spectrogram">'));
    assert.ok(spectrogram.includes('<button class="tb-btn" data-action="content-waveform">'));
});

test('toolbar height inputs carry the current values and bounds', () => {
    const html = toolbarHtml(spec, strings);
    assert.ok(html.includes('min="80" max="400" step="1" value="120" data-action="track-height-input"'));
    assert.ok(html.includes('min="100" max="320" step="1" value="200" data-action="spectrum-height-input"'));
});

test('toolbar groups adjust, workflow and export actions into menus', () => {
    const html = toolbarHtml(spec, strings);
    assert.equal(html.match(/<details class="tb-menu">/g)?.length, 3);
    assert.ok(html.includes('<summary class="tb-btn">' + escapeHtml(strings.toolbarExportLabel) + '</summary>'));
    for (const action of ['run-recipe', 'copy-spec', 'export-png', 'export-csv', 'export-wav', 'export-report', 'zoom-to-selection', 'toggle-follow-cursor']) {
        assert.ok(html.includes('data-action="' + action + '"'), action);
    }
    assert.ok(html.includes('id="cursor-display"'));
    assert.ok(html.includes('id="loop-time-display"'));
});

test('toolbar shows the app version', () => {
    assert.ok(toolbarHtml(spec, strings).includes('<span class="tb-label tb-version" id="app-version">v1.2.3 (abc1234)</span>'));
});
