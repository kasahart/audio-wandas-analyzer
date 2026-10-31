import assert from 'node:assert/strict';
import test from 'node:test';
import { LayoutSettings, SPECTRUM_HEIGHT_MIN, TRACK_HEIGHT_MAX, WAVE_SHARE_DEFAULT, WAVE_SHARE_MAX, WAVE_SHARE_MIN, type LayoutChange } from '../webview/runtime/layoutSettings';
import type { PersistedWebviewState } from '../webview/runtime/types';

function setup(persisted: Partial<PersistedWebviewState> = {}) {
    const changes: LayoutChange[] = [];
    const saved: Partial<PersistedWebviewState>[] = [];
    const layout = new LayoutSettings(persisted, patch => { saved.push(patch); });
    layout.onChange(change => { changes.push(change); });
    return { layout, changes, saved };
}

test('a fresh layout folds the cursor spectrum and opens the side panel', () => {
    const { layout } = setup();
    assert.equal(layout.spectrumCollapsed, true);
    assert.equal(layout.sidebarCollapsed, false);
    assert.equal(layout.spectrumMaximized, false);
    assert.equal(layout.waveShare, WAVE_SHARE_DEFAULT);
});

test('the persisted panels and wave share come back, the share clamped', () => {
    assert.equal(setup({ waveShare: 0.99 }).layout.waveShare, WAVE_SHARE_MAX);
    assert.equal(setup({ waveShare: 0 }).layout.waveShare, WAVE_SHARE_MIN);
    const { layout } = setup({ spectrumCollapsed: false, sidebarCollapsed: true });
    assert.equal(layout.spectrumCollapsed, false);
    assert.equal(layout.sidebarCollapsed, true);
});

test('a track height is clamped and announced once; the same height again changes nothing', () => {
    const { layout, changes } = setup();
    assert.equal(layout.setTrackHeight(9999), true);
    assert.equal(layout.trackHeight, TRACK_HEIGHT_MAX);
    assert.equal(layout.setTrackHeight(TRACK_HEIGHT_MAX + 1), false);
    assert.deepEqual(changes, ['track-height']);
});

test('the spectrum height is clamped to the limit the pane gives it', () => {
    const { layout, changes } = setup();
    assert.equal(layout.setSpectrumHeight(500, 300), true);
    assert.equal(layout.spectrumOverlayHeight, 300);
    assert.equal(layout.setSpectrumHeight(10, 300), true);
    assert.equal(layout.spectrumOverlayHeight, SPECTRUM_HEIGHT_MIN);
    assert.equal(layout.setSpectrumHeight(SPECTRUM_HEIGHT_MIN, 300), false);
    assert.deepEqual(changes, ['spectrum-height', 'spectrum-height']);
});

test('a dragged wave share is kept only when asked to', () => {
    const { layout, changes, saved } = setup();
    layout.setWaveShare(0.5, false);
    assert.deepEqual(saved, []);
    layout.persistWaveShare();
    layout.setWaveShare(0.6, true);
    assert.deepEqual(saved, [{ waveShare: 0.5 }, { waveShare: 0.6 }]);
    assert.deepEqual(changes, ['wave-share', 'wave-share']);
});

test('folding a maximized spectrum restores it first; maximizing a folded one unfolds it first', () => {
    const { layout, changes, saved } = setup();
    layout.setSpectrumMaximized(true);
    assert.deepEqual(changes, ['spectrum-collapsed', 'spectrum-maximized']);
    assert.equal(layout.spectrumCollapsed, false);
    changes.length = 0;
    layout.setSpectrumCollapsed(true);
    assert.deepEqual(changes, ['spectrum-maximized', 'spectrum-collapsed']);
    assert.equal(layout.spectrumMaximized, false);
    assert.deepEqual(saved, [{ spectrumCollapsed: false }, { spectrumCollapsed: true }]);
});

test('the side panel is kept as folded', () => {
    const { layout, changes, saved } = setup();
    layout.setSidebarCollapsed(true);
    assert.equal(layout.sidebarCollapsed, true);
    assert.deepEqual(saved, [{ sidebarCollapsed: true }]);
    assert.deepEqual(changes, ['sidebar-collapsed']);
});

test('a canvas is sized again only when its size changed or a lane height or share did', () => {
    const { layout } = setup();
    assert.equal(layout.canvasSizeChanged('0:0', '800x64'), true);
    assert.equal(layout.canvasSizeChanged('0:0', '800x64'), false);
    assert.equal(layout.canvasSizeChanged('0:0', '700x64'), true);
    layout.setTrackHeight(200);
    assert.equal(layout.canvasSizeChanged('0:0', '700x64'), true);
    layout.setWaveShare(0.3, false);
    assert.equal(layout.canvasSizeChanged('0:0', '700x64'), true);
    layout.invalidateCanvasSizes();
    assert.equal(layout.canvasSizeChanged('0:0', '700x64'), true);
});
