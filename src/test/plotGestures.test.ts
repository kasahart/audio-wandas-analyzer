import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * R7, R13: every plot answers the pointer and the keys from one place, the shared plot gestures: the listeners in
 * trackPointerEvents.ts, which plotInteraction.ts builds every plot's hover, ← / → step, box zoom, Alt+ and
 * Shift+drag, wheel and double-click on. No other webview module listens for pointer or key events of its own for a
 * plot, and none attaches those listeners but plotInteraction.ts: a plot that needs another gesture gets an option
 * there, for every plot.
 *
 * A module that listens for those events for something that is not a plot (a resize edge, a popover, a chip) is in
 * NOT_PLOTS with each event it listens to and why. The list only shrinks: an event a module no longer listens to fails
 * until it is taken off, and a new one fails until it is put on with its reason.
 */
const webview = path.resolve(__dirname, '..', '..', 'src', 'webview');

/** The shared plot gestures themselves. */
const SHARED: Record<string, string> = {
    'runtime/trackPointerEvents.ts': 'the plots\' pointer listeners and their ← / → key context',
    'runtime/keyRouter.ts': 'the one window key listener every key context goes through',
};

const NOT_PLOTS: Record<string, { events: readonly string[]; why: string }> = {
    'rangePopover.ts': { events: ['mousedown'], why: 'a press outside the axis range popover closes it' },
    'runtime/comparisonRuntime.ts': { events: ['dblclick', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel'], why: 'the waveform/spectrogram split and the side panel\'s edge dragged, a panel edge double-clicked to fold it' },
    'runtime/entryRuntime.ts': { events: ['dblclick', 'mouseover', 'pointerdown'], why: 'the entry table\'s rows and bar (double-click a row or the bar, a row lights its lane, a press outside its popovers)' },
    'runtime/helpOverlay.ts': { events: ['mousedown'], why: 'the help button keeps the focus where it was' },
    'runtime/hintFooter.ts': { events: ['mousemove', 'mouseover', 'mouseout', 'focus', 'blur'], why: 'the footer names what is under the pointer or focused (data-hint), on every element' },
    'runtime/offsetInlineEditor.ts': { events: ['keydown', 'blur', 'dblclick'], why: 'the track offset\'s text field, opened or reset on its value' },
    'runtime/pairSpectrumPanel.ts': { events: ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'], why: 'the divider between the power spectrum and the pair view dragged' },
    'runtime/roleChip.ts': { events: ['keydown', 'pointerdown'], why: 'a role chip\'s menu' },
    'runtime/separatorKeys.ts': { events: ['focusin'], why: 'a focused resize edge says its value' },
    'runtime/staticDialogs.ts': { events: ['pointerdown'], why: 'a press outside a dialog of the browser build closes it' },
    'runtime/staticFooter.ts': { events: ['mouseover', 'focusin', 'pointerdown'], why: 'the browser build\'s footer and its about popover' },
    'runtime/stepBar.ts': { events: ['keydown', 'pointerdown'], why: 'the step bar\'s chips, menu and forms' },
    'runtime/stepGestures.ts': { events: ['pointerdown', 'pointerup', 'pointercancel'], why: 'a step chip held to show the chain without it' },
    'runtime/toolbarEvents.ts': { events: ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'], why: 'the toolbar\'s menus and the height edges dragged' },
    'runtime/trackLaneActions.ts': { events: ['pointerdown'], why: 'a press outside a lane\'s menu closes it' },
};

const EVENTS = /addEventListener\(\s*['"](mouse(?:down|move|up|leave|enter|over|out)|pointer(?:down|move|up|cancel)|wheel|dblclick|key(?:down|up)|focus(?:in|out)?|blur)['"]/g;
/**
 * A pointer event named anywhere else (a loop over names, `.onwheel =`) is listened to as well; one taken off
 * (removeEventListener) is not.
 */
const NAMED = /(['"`])((?:mouse|pointer)[a-z]+|wheel|dblclick|contextmenu)\1|\.on((?:mouse|pointer)[a-z]+|wheel|dblclick|contextmenu)\s*=/g;

function sources(dir: string, base = dir): string[] {
    return readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? sources(full, base) : name.endsWith('.ts') ? [path.relative(base, full).split(path.sep).join('/')] : [];
    });
}

const read = (file: string): string => readFileSync(path.join(webview, file), 'utf8');

/** The pointer and key events a module's source listens to. */
function listenedEvents(source: string): string[] {
    const put = source.replace(/removeEventListener\(\s*(['"`])[a-z]+\1/g, '');
    return [...new Set([...[...put.matchAll(EVENTS)].map(match => match[1]), ...[...put.matchAll(NAMED)].map(match => match[2] ?? match[3])])];
}

test('pointer events are found however they are listened to, and not where a listener is taken off', () => {
    assert.deepEqual(listenedEvents([
        "canvas.addEventListener('wheel', zoom);",
        "for (const type of ['pointerup', 'blur']) view.addEventListener(type, end);",
        'canvas.ondblclick = reset;',
        "canvas.removeEventListener('mousedown', press);",
        "canvas.addEventListener('click', pick);",
        "field.addEventListener('keydown', key);",
    ].join('\n')).sort(), ['dblclick', 'keydown', 'pointerup', 'wheel']);
});

test('no webview module listens for pointer or key events of a plot outside the shared plot gestures, except those listed with why (R7, R13)', () => {
    const listening = new Map<string, string[]>();
    for (const file of sources(webview)) {
        const events = listenedEvents(read(file));
        if (events.length) listening.set(file, events);
    }
    const unlisted = [...listening].filter(([file]) => !SHARED[file]).flatMap(([file, events]) => events.filter(event => !NOT_PLOTS[file]?.events.includes(event)).map(event => `${file}: ${event}`));
    assert.deepEqual(unlisted, [], 'listens for a plot\'s pointer or keys outside the shared plot gestures (trackPointerEvents.ts, plotInteraction.ts): give the plot attachPlotInteraction, or list what it is with why in NOT_PLOTS');
    const stale = [...Object.keys(SHARED).filter(file => !listening.has(file)), ...Object.entries(NOT_PLOTS).flatMap(([file, { events }]) => events.filter(event => !listening.get(file)?.includes(event)).map(event => `${file}: ${event}`))];
    assert.deepEqual(stale, [], 'listens for it no more: take it off the list');
});

test('every plot\'s gestures are built on plotInteraction.ts: the shared listeners are called from nowhere else, the plots\' ← / → context added nowhere else (R7, R13)', () => {
    const callers = sources(webview).filter(file => file !== 'runtime/trackPointerEvents.ts' && /\battachTrackPointerListeners\b/.test(read(file)));
    assert.deepEqual(callers, ['runtime/plotInteraction.ts'], 'builds a plot\'s gestures on the low-level listeners, not plotInteraction.ts');
    const plotKeys = sources(webview).filter(file => /layer:\s*'plot'/.test(read(file)));
    assert.deepEqual(plotKeys, ['runtime/trackPointerEvents.ts'], 'only the shared listeners step a plot\'s readout with the keys');
});
