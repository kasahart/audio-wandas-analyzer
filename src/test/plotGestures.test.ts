import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * R7, R13: every plot answers the pointer and the keys from one place, the shared plot gestures: the listeners in
 * trackPointerEvents.ts, which plotInteraction.ts builds every plot's hover, ← / → step, box zoom, Alt+ and
 * Shift+drag, wheel, double-click and click (a press that stayed put: the `tap` option) on. No other webview module
 * listens for pointer, click or key events of its own for a plot, and none attaches those listeners but
 * plotInteraction.ts: a plot that needs another gesture gets an option there, for every plot.
 *
 * A module that listens for those events for something that is not a plot (a resize edge, a popover, a chip, a button) is in
 * NOT_PLOTS with each event it listens to and why. The list only shrinks: an event a module no longer listens to fails
 * until it is taken off, and a new one fails until it is put on with its reason.
 */
const webview = path.resolve(__dirname, '..', '..', 'src', 'webview');

/** The shared plot gestures themselves. */
const SHARED: Record<string, string> = {
    'runtime/trackPointerEvents.ts': 'the plots\' pointer listeners and their ← / → key context',
    'runtime/keyRouter.ts': 'the one window key listener every key context goes through',
    'runtime/plotInteraction.ts': 'the click a drag (a box zoom) ends with is not passed on: a plot\'s own click is its `tap`',
};

/**
 * Each listener of a module that is not a plot, as `receiver:event` (the expression it is added on, and the event), one
 * entry per listener: a new listener fails until it is put on with its reason, even for an event the module already
 * listens to on something else, so a plot's own click or double-click cannot hide behind another element's.
 * `*:event` is an event named in a loop over names (`for (const type of [...]) view.addEventListener(type, ...)`).
 */
const NOT_PLOTS: Record<string, { sites: readonly string[]; why: string }> = {
    'rangePopover.ts': { sites: ['applyButton:click', 'autoButton:click', 'closeButton:click', 'doc:mousedown'], why: 'a press outside the axis range popover closes it; its Apply, Auto and close buttons' },
    'runtime/comparisonRuntime.ts': {
        sites: ['btn:click', 'document.getElementById(\'spectrum-section-header\')?:click', 'document:dblclick', 'loopTimeDisplayEl:click', 'tracksWrapper:pointerdown', 'document:pointermove', 'document:pointerup', 'document:pointercancel', 'selectionLayout:click', 'resizer:pointerdown', 'document:pointermove', 'document:pointerup', 'document:pointercancel'],
        why: 'the Python setup button, the folded spectrum header, a panel edge double-clicked to fold it (target.closest of the edge), the loop time copied, the waveform/spectrogram split (.track-split) and the side panel\'s edge dragged, the folder selection\'s buttons',
    },
    'runtime/entryRuntime.ts': { sites: ['query(\'.entry-bar\'):dblclick', 'screen:click', 'document:mouseover', 'document:pointerdown', 'screen:dragover', 'screen:drop', 'body:dblclick'], why: 'the entry table\'s rows and bar (double-click a row or the bar, a row lights its lane, a press outside its popovers, the screen\'s buttons and menus, files dropped on the screen)' },
    'runtime/helpOverlay.ts': { sites: ['openButton:mousedown', 'openButton:click', 'overlay:click'], why: 'the help button keeps the focus where it was; it opens the help, and its backdrop or × closes it' },
    'runtime/hintFooter.ts': { sites: ['doc:mousemove', 'doc:mouseover', 'doc:mouseout', 'canvas:focus', 'canvas:blur'], why: 'the footer names what is under the pointer or focused (data-hint), on every element' },
    'runtime/offsetInlineEditor.ts': { sites: ['input:keydown', 'input:blur', 'wrapper:dblclick', 'wrapper:click'], why: 'the track offset\'s text field, opened or reset on its value' },
    'runtime/pairSpectrumPanel.ts': { sites: ['divider?:pointerdown', 'this.doc:pointermove', 'this.doc:pointerup', 'this.doc:pointercancel'], why: 'the divider between the power spectrum and the pair view dragged' },
    'runtime/roleChip.ts': { sites: ['root:click', 'root:keydown', 'root:pointerdown'], why: 'a role chip\'s menu' },
    'runtime/separatorKeys.ts': { sites: ['document:focusin'], why: 'a focused resize edge says its value' },
    'runtime/spectrogramSettingsPopover.ts': { sites: ['field(\'spec-reset\'):click', 'field(\'spec-apply\'):click', 'document:click'], why: 'a lane\'s spectrogram settings: its gear button, Reset and Apply, a click outside closes it' },
    'runtime/staticDialogs.ts': { sites: ['button:click', 'document:pointerdown'], why: 'a press outside a dialog of the browser build closes it; its buttons' },
    'runtime/staticFooter.ts': { sites: ['window:click', 'window:mouseover', 'window:focusin', 'window:pointerdown'], why: 'the browser build\'s footer and its about popover; a control the browser build does not have says so' },
    'runtime/staticHost.ts': { sites: ['target:dragover', 'target:dragleave', 'target:drop'], why: 'files dropped on the browser build\'s page' },
    'runtime/stepBar.ts': { sites: ['element:click', 'element:keydown', 'document:pointerdown'], why: 'the step bar\'s chips, menu and forms' },
    'runtime/stepGestures.ts': { sites: ['element:pointerdown', 'element:dragstart', 'element:dragover', 'element:dragleave', 'element:drop', 'element:dragend', '*:pointerup', '*:pointercancel'], why: 'a step chip held to show the chain without it, or dragged to reorder the chain' },
    'runtime/toolbarEvents.ts': {
        sites: ['container:click', 'toolbar:click', 'toolbar.ownerDocument:pointerdown', 'surface:pointerdown', 'doc:pointerdown', 'win:pointerdown', 'doc:pointermove', 'win:pointermove', 'doc:pointerup', 'win:pointerup', 'win:pointercancel'],
        why: 'the toolbar\'s buttons and menus, and the height edges dragged',
    },
    'runtime/trackLaneActions.ts': { sites: ['wrapper:click', 'wrapper.ownerDocument:pointerdown'], why: 'a lane\'s buttons and … menu; a press outside the menu closes it' },
    'runtime/trackReorderDrag.ts': { sites: ['wrap:dragstart', 'wrap:dragover', 'wrap:drop', 'wrap:dragend'], why: 'a lane\'s header dragged to reorder the tracks' },
    'runtime/trackStageMode.ts': { sites: ['root:click', 'document:click'], why: 'the comparison\'s buttons (layout, Δ, play, the base group\'s scan and info) and a lane\'s event marks (▶, ×, ↺)' },
};

/**
 * The key contexts (keyRouter layers) outside the shared plot gestures, each with what it takes keys for. Only
 * trackPointerEvents.ts adds the 'plot' layer. A context that zooms a plot with + / − / 0 says so in `zooms`: that is
 * owed to the shared plot gestures (one key zoom for every plot, R7, R13) and is taken off once it lives there.
 */
const KEY_CONTEXTS: Record<string, { layers: readonly string[]; why: string; zooms?: string }> = {
    'rangePopover.ts': { layers: ['popover'], why: 'Esc closes the axis range popover' },
    'runtime/comparisonRuntime.ts': { layers: ['lanes'], why: 'Esc leaves the maximized spectrum; the lanes\' shortcuts (shortcuts.ts) run here', zooms: 'zoomIn / zoomOut / resetZoom: the lanes\' time axis whatever plot the pointer is on; to move into plotInteraction' },
    'runtime/entryRuntime.ts': { layers: ['entry'], why: 'the entry table\'s keys (Esc closes its innermost popover, form or list)' },
    'runtime/globalKeyboardEvents.ts': { layers: ['lanes'], why: 'the lanes\' cursor, playback and shortcut keys' },
    'runtime/helpOverlay.ts': { layers: ['help'], why: '? / F1 opens or closes the help; while open it keeps Tab and scrolls itself' },
    'runtime/separatorKeys.ts': { layers: ['widget'], why: 'a focused resize edge moved with the arrow keys' },
    'runtime/spectrogramSettingsPopover.ts': { layers: ['popover'], why: 'Esc closes a lane\'s spectrogram settings' },
    'runtime/staticDialogs.ts': { layers: ['popover'], why: 'Esc closes a dialog of the browser build' },
    'runtime/staticFooter.ts': { layers: ['popover'], why: 'Esc closes the about popover' },
    'runtime/stepBar.ts': { layers: ['step-bar'], why: 'the step bar\'s undo / redo (Ctrl+Z / Ctrl+Y)' },
    'runtime/toolbarEvents.ts': { layers: ['popover'], why: 'Esc closes a toolbar menu' },
    'runtime/trackStageMode.ts': { layers: ['stage'], why: 'the comparison\'s keys: 1–3, B, D, Esc', zooms: 'zoomHovered: the plot under the pointer, else the shared window; to move into plotInteraction' },
};

const EVENT_NAMES = '(?:(?:mouse|pointer|touch|gesture)[a-z]+|drag[a-z]*|drop|wheel|click|dblclick|auxclick|contextmenu|key(?:down|up|press)|focus(?:in|out)?|blur)';
const SITE = new RegExp(`\\.addEventListener\\(\\s*(['"\`])(${EVENT_NAMES})\\1`, 'g');
/**
 * A pointer event named anywhere else (a loop over names, `.onwheel =`) is listened to as well; one taken off
 * (removeEventListener) is not.
 */
const NAMED = /(['"`])((?:mouse|pointer|touch|gesture)[a-z]+|drag[a-z]*|drop|wheel|click|dblclick|auxclick|contextmenu)\1|\.on((?:mouse|pointer|touch|gesture)[a-z]+|drag[a-z]*|drop|wheel|click|dblclick|auxclick|contextmenu)\s*=/g;

function sources(dir: string, base = dir): string[] {
    return readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? sources(full, base) : name.endsWith('.ts') ? [path.relative(base, full).split(path.sep).join('/')] : [];
    });
}

const read = (file: string): string => readFileSync(path.join(webview, file), 'utf8');

/** The expression a listener is added on: the member chain (calls and indexing whole) that ends at `dot`. */
function receiverBefore(source: string, dot: number): string {
    let index = dot - 1, depth = 0;
    for (; index >= 0; index--) {
        const char = source[index];
        if (char === ')' || char === ']') depth++;
        else if (char === '(' || char === '[') { if (depth === 0) break; depth--; }
        else if (depth === 0 && !/[\w$.!?]/.test(char)) break;
    }
    return source.slice(index + 1, dot).replace(/\s+/g, '');
}

/** Each pointer, key or drag listener a module's source adds, as `receiver:event` (`*:event` for one named elsewhere). */
function listenerSites(source: string): string[] {
    const put = source.replace(/removeEventListener\(\s*(['"`])[a-z]+\1/g, '');
    const sites = [...put.matchAll(SITE)].map(match => `${receiverBefore(put, match.index)}:${match[2]}`);
    const added = new Set(sites.map(site => site.slice(site.lastIndexOf(':') + 1)));
    const named = [...new Set([...put.matchAll(NAMED)].map(match => match[2] ?? match[3]))].filter(event => !added.has(event));
    return [...sites, ...named.map(event => `*:${event}`)];
}

/** The pointer and key events a module's source listens to. */
function listenedEvents(source: string): string[] {
    return [...new Set(listenerSites(source).map(site => site.slice(site.lastIndexOf(':') + 1)))];
}

const sorted = (items: readonly string[]): string[] => [...items].sort();

test('pointer events are found however they are listened to, and not where a listener is taken off', () => {
    assert.deepEqual(listenedEvents([
        "canvas.addEventListener('wheel', zoom);",
        "for (const type of ['pointerup', 'blur']) view.addEventListener(type, end);",
        'canvas.ondblclick = reset;',
        "canvas.removeEventListener('mousedown', press);",
        "canvas.addEventListener('click', pick);",
        "field.addEventListener('keydown', key);",
        'canvas.onclick = pick;',
        "canvas.addEventListener('touchstart', touch);",
        "canvas.addEventListener('auxclick', middle);",
        "canvas.addEventListener('contextmenu', menu);",
        "canvas.addEventListener('dragstart', drag);",
        "canvas.addEventListener('gesturechange', pinch);",
        "canvas.style.cursor = 'pointer';",
    ].join('\n')).sort(), ['auxclick', 'click', 'contextmenu', 'dblclick', 'dragstart', 'gesturechange', 'keydown', 'pointerup', 'touchstart', 'wheel']);
});

test('a listener is told apart by what it is added on: one more on a plot fails even where the module listens to that event elsewhere', () => {
    const source = "document.addEventListener('dblclick', fold);\ndocument.getElementById('spectrum-overlay-canvas')!.addEventListener('dblclick', zoom);\nthis.doc.addEventListener('pointerup', end);\nfield('spec-apply').addEventListener('click', apply);";
    assert.deepEqual(listenerSites(source), ['document:dblclick', 'document.getElementById(\'spectrum-overlay-canvas\')!:dblclick', 'this.doc:pointerup', 'field(\'spec-apply\'):click']);
    const allowed = ['document:dblclick', 'this.doc:pointerup', 'field(\'spec-apply\'):click'];
    assert.deepEqual(unlistedSites(listenerSites(source), allowed), ['document.getElementById(\'spectrum-overlay-canvas\')!:dblclick']);
    // A second listener of the same kind on the same thing is a new one too.
    assert.deepEqual(unlistedSites([...allowed, 'document:dblclick'], allowed), ['document:dblclick']);
});

/** The sites not in `allowed`, each allowed site taking one listener (a multiset difference). */
function unlistedSites(sites: readonly string[], allowed: readonly string[]): string[] {
    const left = [...allowed];
    return sites.filter(site => {
        const at = left.indexOf(site);
        if (at < 0) return true;
        left.splice(at, 1);
        return false;
    });
}

test('no webview module listens for pointer or key events of a plot outside the shared plot gestures, except those listed with why (R7, R13)', () => {
    const listening = new Map<string, string[]>();
    for (const file of sources(webview)) {
        const sites = listenerSites(read(file));
        if (sites.length) listening.set(file, sites);
    }
    const unlisted = [...listening].filter(([file]) => !SHARED[file]).flatMap(([file, sites]) => unlistedSites(sites, NOT_PLOTS[file]?.sites ?? []).map(site => `${file}: ${site}`));
    assert.deepEqual(unlisted, [], 'listens for a plot\'s pointer or keys outside the shared plot gestures (trackPointerEvents.ts, plotInteraction.ts): give the plot attachPlotInteraction, or list what it is with why in NOT_PLOTS');
    const stale = [...Object.keys(SHARED).filter(file => !listening.has(file)), ...Object.entries(NOT_PLOTS).flatMap(([file, { sites }]) => unlistedSites(sites, listening.get(file) ?? []).map(site => `${file}: ${site}`))];
    assert.deepEqual(stale, [], 'listens for it no more: take it off the list');
});

test('every key context outside the shared plot gestures is listed with what it takes keys for; one that zooms a plot says it is owed to them (R7, R13)', () => {
    const contexts = new Map<string, string[]>();
    for (const file of sources(webview)) {
        if (SHARED[file]) continue;
        const layers = [...read(file).matchAll(/\blayer:\s*'([a-z-]+)'/g)].map(match => match[1]);
        if (layers.length) contexts.set(file, sorted(layers));
    }
    assert.deepEqual(Object.fromEntries(contexts), Object.fromEntries(Object.entries(KEY_CONTEXTS).map(([file, { layers }]) => [file, sorted(layers)])), 'a key context not listed (or listed no more) in KEY_CONTEXTS');
    assert.ok(![...contexts.values()].some(layers => layers.includes('plot')), 'only the shared listeners add the plot layer');
    // The key zoom (+ / − / 0) acts on plots: only where KEY_CONTEXTS says it is still owed to the shared gestures.
    const zooming = sources(webview).filter(file => !SHARED[file] && file !== 'runtime/shortcuts.ts' && /'zoom-(?:in|out|reset)'/.test(read(file)));
    assert.deepEqual(sorted(zooming), sorted(Object.entries(KEY_CONTEXTS).filter(([, context]) => context.zooms).map(([file]) => file)), 'a key zoom outside the shared plot gestures');
});

test('every plot\'s gestures are built on plotInteraction.ts: the shared listeners are called from nowhere else, the plots\' ← / → context added nowhere else (R7, R13)', () => {
    const callers = sources(webview).filter(file => file !== 'runtime/trackPointerEvents.ts' && /\battachTrackPointerListeners\b/.test(read(file)));
    assert.deepEqual(callers, ['runtime/plotInteraction.ts'], 'builds a plot\'s gestures on the low-level listeners, not plotInteraction.ts');
    const plotKeys = sources(webview).filter(file => /layer:\s*'plot'/.test(read(file)));
    assert.deepEqual(plotKeys, ['runtime/trackPointerEvents.ts'], 'only the shared listeners step a plot\'s readout with the keys');
});
