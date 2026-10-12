export const SHORTCUT_ROWS = [
    { shortcut: 'Space', labelKey: 'helpRowSpace' },
    { shortcut: '← / →', labelKey: 'helpRowArrow' },
    { shortcut: '+ / − / 0', labelKey: 'helpRowZoomKeys' },
    { shortcut: 'F', labelKey: 'helpRowFollowCursor' },
    { shortcut: 'L', labelKey: 'helpRowZoomToSelection' },
    { shortcut: 'Wheel', labelKey: 'helpRowWheel' },
    { shortcut: 'Ctrl+Wheel', labelKey: 'helpRowCtrlWheel' },
    { shortcut: 'Drag (spectrum)', labelKey: 'helpRowSpectrumDrag' },
    { shortcut: 'Drag (zoom mode)', labelKey: 'helpRowWaveRectZoom' },
    { shortcut: 'Drag', labelKey: 'helpRowDrag' },
    { shortcut: 'Shift+Drag', labelKey: 'helpRowShiftDrag' },
    { shortcut: '?', labelKey: 'helpRowQuestion' },
    { shortcut: 'Esc', labelKey: 'helpRowEsc' },
] as const;

export type GlobalShortcutAction = 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'toggle-follow-cursor' | 'zoom-to-selection';

const GLOBAL_SHORTCUT_KEYS: Record<string, GlobalShortcutAction> = {
    '+': 'zoom-in',
    '=': 'zoom-in',
    '-': 'zoom-out',
    '_': 'zoom-out',
    '0': 'zoom-reset',
    f: 'toggle-follow-cursor',
    F: 'toggle-follow-cursor',
    l: 'zoom-to-selection',
    L: 'zoom-to-selection',
};

export function globalShortcutAction(key: string): GlobalShortcutAction | null {
    return Object.prototype.hasOwnProperty.call(GLOBAL_SHORTCUT_KEYS, key) ? GLOBAL_SHORTCUT_KEYS[key] : null;
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
