import type { UiStrings } from '../../shared/i18n/strings';

export type GlobalShortcutAction = 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'toggle-follow-cursor' | 'zoom-to-selection';
export type EntryKeyAction = 'row-up' | 'row-down' | 'slot' | 'open' | 'play' | 'track' | 'memo';
export type CompareKeyAction = 'slot' | 'toggle-base' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'fix' | 'play' | 'back';

/**
 * A row of the help and, with `bind`, the keys (KeyboardEvent.key) that run its action. The help lists
 * what the router runs: each context looks its keys up in its own table.
 */
export interface KeyRow<A extends string = string> {
    readonly shortcut: string;
    readonly labelKey: keyof UiStrings;
    /** For a row whose "key" is a button's name, said in the UI's language instead of `shortcut`. */
    readonly shortcutKey?: keyof UiStrings;
    readonly bind?: Readonly<Record<string, A>>;
}

const ZOOM_BINDINGS = { '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '_': 'zoom-out', '0': 'zoom-reset' } as const;

export const GENERAL_KEYS: readonly KeyRow[] = [
    { shortcut: '? / F1', labelKey: 'helpRowQuestion' },
    { shortcut: 'Esc', labelKey: 'helpRowEsc' },
];

export const LANE_KEYS: readonly KeyRow<GlobalShortcutAction>[] = [
    { shortcut: 'Space', labelKey: 'helpRowSpace' },
    { shortcut: '← / →', labelKey: 'helpRowArrow' },
    { shortcut: '+ / − / 0', labelKey: 'helpRowZoomKeys', bind: ZOOM_BINDINGS },
    { shortcut: 'F', labelKey: 'helpRowFollowCursor', bind: { f: 'toggle-follow-cursor', F: 'toggle-follow-cursor' } },
    { shortcut: 'L', labelKey: 'helpRowZoomToSelection', bind: { l: 'zoom-to-selection', L: 'zoom-to-selection' } },
    { shortcut: 'Wheel', labelKey: 'helpRowWheel' },
    { shortcut: 'Ctrl+Wheel', labelKey: 'helpRowCtrlWheel' },
    { shortcut: 'Drag (spectrum)', labelKey: 'helpRowSpectrumDrag' },
    { shortcut: 'Drag (zoom mode)', labelKey: 'helpRowWaveRectZoom' },
    { shortcut: 'Drag', labelKey: 'helpRowDrag' },
    { shortcut: 'Shift+Drag', labelKey: 'helpRowShiftDrag' },
    { shortcut: 'Double-click (resize edge)', labelKey: 'helpRowDoubleClickEdge' },
    { shortcut: 'Arrows (resize edge)', labelKey: 'helpRowResizeKeys' },
];

export const ENTRY_KEYS: readonly KeyRow<EntryKeyAction>[] = [
    { shortcut: '↑ / ↓', labelKey: 'helpEntryRows', bind: { ArrowUp: 'row-up', ArrowDown: 'row-down' } },
    { shortcut: '1–3', labelKey: 'helpEntrySlot', bind: { 1: 'slot', 2: 'slot', 3: 'slot' } },
    { shortcut: '0', labelKey: 'helpEntryBase', bind: { 0: 'slot' } },
    { shortcut: 'Enter', labelKey: 'helpEntryOpen', bind: { Enter: 'open' } },
    { shortcut: 'Space', labelKey: 'helpEntryPlay', bind: { ' ': 'play' } },
    { shortcut: 'T', labelKey: 'helpEntryTrack', bind: { t: 'track', T: 'track' } },
    { shortcut: 'M', labelKey: 'helpEntryMemo', bind: { m: 'memo', M: 'memo' } },
    { shortcut: 'Esc', labelKey: 'helpEntryEsc' },
];

export const COMPARE_KEYS: readonly KeyRow<CompareKeyAction>[] = [
    { shortcut: '1–3', labelKey: 'helpCompareSlot', bind: { 1: 'slot', 2: 'slot', 3: 'slot' } },
    { shortcut: 'B', labelKey: 'helpCompareBase', bind: { b: 'toggle-base', B: 'toggle-base' } },
    { shortcut: '+ / − / 0', labelKey: 'helpCompareZoom', bind: ZOOM_BINDINGS },
    { shortcut: 'D', labelKey: 'helpCompareFix', bind: { d: 'fix', D: 'fix' } },
    { shortcut: 'Space', labelKey: 'helpComparePlay', bind: { ' ': 'play' } },
    { shortcut: 'Esc', labelKey: 'helpCompareEsc', bind: { Escape: 'back' } },
    { shortcut: 'Compare / Overlay', shortcutKey: 'helpCompareLayoutKey', labelKey: 'helpCompareLayout' },
    { shortcut: 'Show Δ', shortcutKey: 'compareDiffShow', labelKey: 'helpCompareDiff' },
];

export const STEP_KEYS: readonly KeyRow[] = [
    { shortcut: 'Delete (step chip)', labelKey: 'helpRowStepKeys' },
    { shortcut: 'Drag (step chip)', labelKey: 'helpRowStepDrag' },
    { shortcut: 'M (step chip)', labelKey: 'helpRowStepBypass' },
    { shortcut: 'Ctrl+Z / Ctrl+Shift+Z (step bar)', labelKey: 'helpRowStepUndo' },
    { shortcut: 'Enter (operation filter)', labelKey: 'helpRowStepMenuEnter' },
];

export type HelpView = 'lanes' | 'entry' | 'compare' | 'steps';

/** The help's sections, one per view; the view on show comes first. */
export const HELP_SECTIONS: ReadonlyArray<{ readonly view: HelpView | 'general'; readonly titleKey: keyof UiStrings; readonly rows: readonly KeyRow[] }> = [
    { view: 'entry', titleKey: 'helpSectionEntry', rows: ENTRY_KEYS },
    { view: 'compare', titleKey: 'helpSectionCompare', rows: COMPARE_KEYS },
    { view: 'lanes', titleKey: 'helpSectionLanes', rows: LANE_KEYS },
    { view: 'steps', titleKey: 'helpSectionSteps', rows: STEP_KEYS },
    { view: 'general', titleKey: 'helpSectionGeneral', rows: GENERAL_KEYS },
];

/** Every row of the help, as the GUI triggerability audit reads them. */
export const SHORTCUT_ROWS: readonly KeyRow[] = HELP_SECTIONS.flatMap(section => section.rows);

/** The action a table binds to a key, if any. */
export function keyAction<A extends string>(table: readonly KeyRow<A>[], key: string): A | null {
    for (const row of table) {
        if (row.bind && Object.prototype.hasOwnProperty.call(row.bind, key)) return row.bind[key];
    }
    return null;
}

export function globalShortcutAction(key: string): GlobalShortcutAction | null {
    return keyAction(LANE_KEYS, key);
}

export function isTextEntryTag(tagName: string | null | undefined): boolean {
    const tag = tagName ? tagName.toUpperCase() : '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function arrowCursorStep(shiftKey: boolean, spanSec: number, zoomStart: number, zoomEnd: number, canvasWidth: number): number {
    if (shiftKey) {
        return spanSec > 0 ? 0.1 / spanSec : 0.001;
    }
    return (zoomEnd - zoomStart) / canvasWidth;
}

export type KeydownIntent =
    | { kind: 'spectrum-step'; delta: -1 | 1 }
    | { kind: 'shortcut'; action: GlobalShortcutAction }
    | { kind: 'toggle-playback'; target: 'focused-track' | 'current' }
    | { kind: 'cursor-step'; direction: -1 | 1 };

export interface KeydownEventLike {
    key: string;
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
}

export interface KeydownContext {
    spectrumActive: boolean;
    helpOpen: boolean;
    textEntryFocused: boolean;
    trackCanvasFocused: boolean;
}

export interface FocusedElementLike {
    id: string;
    tagName: string;
    classList: { contains(token: string): boolean };
}

export function keydownContextFor(active: FocusedElementLike | null, helpOverlay: { hidden: boolean } | null, spectrumHasMouse: boolean): KeydownContext {
    return {
        spectrumActive: spectrumHasMouse || !!(active && (active.id === 'spectrum-overlay-canvas' || active.classList.contains('track-spectrum-canvas'))),
        helpOpen: !!(helpOverlay && !helpOverlay.hidden),
        textEntryFocused: isTextEntryTag(active && active.tagName),
        trackCanvasFocused: !!(active && active.classList.contains('track-canvas')),
    };
}

function arrowDirection(code: string): -1 | 1 | null {
    return code === 'ArrowLeft' ? -1 : code === 'ArrowRight' ? 1 : null;
}

export function keydownIntent(e: KeydownEventLike, ctx: KeydownContext): KeydownIntent | null {
    if (e.ctrlKey || e.metaKey || e.altKey) {
        return null;
    }
    const arrow = arrowDirection(e.code);
    if (ctx.spectrumActive && arrow !== null) {
        return { kind: 'spectrum-step', delta: arrow };
    }
    if (ctx.helpOpen) {
        return null;
    }
    const action = ctx.textEntryFocused ? null : globalShortcutAction(e.key);
    if (action) {
        return { kind: 'shortcut', action };
    }
    if (e.code === 'Space' && !ctx.textEntryFocused) {
        return { kind: 'toggle-playback', target: ctx.trackCanvasFocused ? 'focused-track' : 'current' };
    }
    if (ctx.trackCanvasFocused && arrow !== null) {
        return { kind: 'cursor-step', direction: arrow };
    }
    return null;
}
