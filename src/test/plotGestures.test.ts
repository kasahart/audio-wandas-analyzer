import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * R7, R13: every plot answers the pointer and the keys from one place, the shared plot gestures: the listeners in
 * trackPointerEvents.ts, which plotInteraction.ts builds every plot's hover, ← / → step, box zoom, Alt+drag, wheel
 * and double-click on. No other webview module listens for pointer or key events of its own for a plot.
 *
 * A module that listens for those events for something that is not a plot (a resize edge, a popover, a chip) is
 * in NOT_PLOTS with what it listens to. A plot still answering through its own code is in PENDING with what is left;
 * it is taken off once it moves, and the test fails until it is, so PENDING only shrinks.
 */
const webview = path.resolve(__dirname, '..', '..', 'src', 'webview');

/** The shared plot gestures themselves. */
const SHARED: Record<string, string> = {
    'runtime/trackPointerEvents.ts': 'the plots\' pointer listeners and their ← / → key context',
    'runtime/keyRouter.ts': 'the one window key listener every key context goes through',
};

const NOT_PLOTS: Record<string, string> = {
    'rangePopover.ts': 'a press outside the axis range popover closes it',
    'runtime/comparisonRuntime.ts': 'the waveform/spectrogram split and the side panel\'s edge dragged, a panel edge double-clicked to fold it',
    'runtime/entryRuntime.ts': 'the entry table\'s rows and bar (double-click a row or the bar, hints over the table, a press outside its popovers)',
    'runtime/helpOverlay.ts': 'the help button keeps the focus where it was',
    'runtime/hintFooter.ts': 'the footer names what is under the pointer or focused (data-hint), on every element',
    'runtime/offsetInlineEditor.ts': 'the track offset\'s text field',
    'runtime/pairSpectrumPanel.ts': 'the divider between the power spectrum and the pair view dragged',
    'runtime/roleChip.ts': 'a role chip\'s menu',
    'runtime/separatorKeys.ts': 'a focused resize edge says its value',
    'runtime/staticDialogs.ts': 'a press outside a dialog of the browser build closes it',
    'runtime/staticFooter.ts': 'the browser build\'s footer and its about popover',
    'runtime/stepBar.ts': 'the step bar\'s chips, menu and forms',
    'runtime/stepGestures.ts': 'a step chip dragged to reorder the chain',
    'runtime/toolbarEvents.ts': 'the toolbar\'s menus and the height edges dragged',
    'runtime/trackLaneActions.ts': 'a press outside a lane\'s menu closes it',
};

/**
 * Plots that still answer through their own code, with what is left. The track lanes of the time-axis view answer the
 * shared listeners (hover, ← / →, wheel, double-click) but their drags (a box zoom, Alt+drag for the loop, Shift+drag
 * to shift a track) and their wheel's pivot are the lanes' own handlers, not plotInteraction.ts's.
 */
const PENDING_LISTENERS: Record<string, string> = {
    'runtime/entryDistributionPane.ts': 'the value axis strip under the rows opens its range on a double-click of its own, and a double-click on a row takes back the pick its first click waits to make',
};
const PENDING_LOW_LEVEL: Record<string, string> = {
    'runtime/comparisonRuntime.ts': 'the time-axis view\'s track lanes: their drags (box zoom, Alt+drag loop, Shift+drag offset) and wheel are the lanes\' own handlers on the shared listeners, not plotInteraction.ts',
};

const EVENTS = /addEventListener\(\s*['"](mouse(?:down|move|up|leave|enter|over|out)|pointer(?:down|move|up|cancel)|wheel|dblclick|key(?:down|up)|focus(?:in|out)?|blur)['"]/g;

function sources(dir: string, base = dir): string[] {
    return readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? sources(full, base) : name.endsWith('.ts') ? [path.relative(base, full).split(path.sep).join('/')] : [];
    });
}

const read = (file: string): string => readFileSync(path.join(webview, file), 'utf8');

test('no webview module listens for pointer or key events of a plot outside the shared plot gestures, except those listed with why (R7, R13)', () => {
    const listening = new Map<string, string[]>();
    for (const file of sources(webview)) {
        const events = [...read(file).matchAll(EVENTS)].map(match => match[1]);
        if (events.length) listening.set(file, [...new Set(events)]);
    }
    const allowed = new Set([...Object.keys(SHARED), ...Object.keys(NOT_PLOTS), ...Object.keys(PENDING_LISTENERS)]);
    const unlisted = [...listening].filter(([file]) => !allowed.has(file)).map(([file, events]) => `${file}: ${events.join(', ')}`);
    assert.deepEqual(unlisted, [], 'listens for a plot\'s pointer or keys outside the shared plot gestures (trackPointerEvents.ts, plotInteraction.ts)');
    const stale = [...allowed].filter(file => !listening.has(file));
    assert.deepEqual(stale, [], 'listens for none of those events any more: take it off the list');
});

test('every plot\'s gestures are built on plotInteraction.ts: the shared listeners are called from nowhere else, the plots\' ← / → context added nowhere else (R7, R13)', () => {
    const callers = sources(webview).filter(file => file !== 'runtime/trackPointerEvents.ts' && /\battachTrackPointerListeners\s*\(/.test(read(file)));
    const allowed = ['runtime/plotInteraction.ts', ...Object.keys(PENDING_LOW_LEVEL)];
    assert.deepEqual(callers.filter(file => !allowed.includes(file)), [], 'builds a plot\'s gestures on the low-level listeners, not plotInteraction.ts');
    assert.deepEqual(Object.keys(PENDING_LOW_LEVEL).filter(file => !callers.includes(file)), [], 'now on plotInteraction.ts: take it off PENDING_LOW_LEVEL');
    const plotKeys = sources(webview).filter(file => /layer:\s*'plot'/.test(read(file)));
    assert.deepEqual(plotKeys, ['runtime/trackPointerEvents.ts'], 'only the shared listeners step a plot\'s readout with the keys');
});
