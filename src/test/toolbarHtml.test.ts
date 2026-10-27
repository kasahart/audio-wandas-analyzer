import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { escapeHtml } from '../shared/utils/webviewEscaping';
import { toolbarHtml, type ToolbarSpec } from '../webview/runtime/toolbarHtml';

const strings = getStrings('en');
const spec: ToolbarSpec = {
    contentType: 'waveform',
    appVersion: '1.2.3 (abc1234)',
};

test('toolbar marks the active view; the tracks show waveform and spectrogram together, so there is no spectrogram toggle', () => {
    const html = toolbarHtml(spec, strings);
    assert.ok(html.includes('<button class="tb-btn is-active" data-action="content-waveform"'));
    assert.ok(!html.includes('data-action="content-spectrogram"'));
    // The STFT settings belong to the tracks' spectrograms: shown with them, hidden in 比較解析.
    assert.ok(html.includes('aria-label="' + escapeHtml(strings.btnSpectrogramSettingsTitle) + '">⚙'));
    const stage = toolbarHtml({ ...spec, contentType: 'stage' }, strings);
    assert.ok(stage.includes('<button class="tb-btn is-active" data-action="content-stage"'));
    assert.ok(stage.includes('style="display:none">⚙'));
});

test('toolbar has two menus, the other zoom tools (⋯) and Export, which holds every export; heights are dragged, not typed', () => {
    const html = toolbarHtml(spec, strings);
    // ⋯ acts on the track lanes, so it hides in 比較解析; Export stays, offering what can be written there.
    assert.equal(html.match(/<details class="tb-menu tb-track-only" id="tb-more-menu">/g)?.length, 1);
    assert.equal(html.match(/<details class="tb-menu" id="tb-export-menu">/g)?.length, 1);
    for (const action of ['stage-report', 'entry-batch', 'entry-export-csv', 'entry-export-notes']) assert.ok(html.includes('data-action="' + action + '"'), action);
    assert.ok(html.includes('>' + escapeHtml(strings.toolbarExportLabel) + '</summary>'));
    for (const absent of ['track-height-input', 'spectrum-height-input', 'copy-spec']) assert.ok(!html.includes('data-action="' + absent + '"'), absent);
    for (const action of ['run-recipe', 'save-recipe', 'export-png', 'export-csv', 'export-wav', 'export-report', 'zoom-to-selection', 'toggle-follow-cursor']) {
        assert.ok(html.includes('data-action="' + action + '"'), action);
    }
    assert.ok(html.includes('id="cursor-display"'));
    assert.ok(html.includes('id="loop-time-display"'));
});

test('toolbar shows the app version', () => {
    assert.ok(toolbarHtml(spec, strings).includes('<span class="tb-label tb-version" id="app-version">v1.2.3 (abc1234)</span>'));
});

test('every toolbar control carries a footer hint', () => {
    const controls = toolbarHtml(spec, strings).match(/<(button|summary|input)\b[^>]*>/g) ?? [];
    assert.ok(controls.length > 10);
    for (const control of controls) {
        assert.match(control, / data-hint="[^"]+"/, control);
    }
});
