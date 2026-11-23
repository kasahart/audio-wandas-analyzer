/**
 * + / − / 0 over a plot (R13): the keys that zoom the plot under the pointer in, out, or back to its whole axes. One
 * table for the old plots (runtime/shortcuts.ts binds its help rows from it) and the Figure.
 */
export const ZOOM_KEYS: Readonly<Record<string, 'in' | 'out' | 'reset'>> = { '+': 'in', '=': 'in', '-': 'out', '_': 'out', '0': 'reset' };

/** What + / − / 0 (ZOOM_KEYS) do to the plot under the pointer, which every plot answers; null for another key. */
export function zoomKeyAction(key: string): 'in' | 'out' | 'reset' | null {
    return Object.prototype.hasOwnProperty.call(ZOOM_KEYS, key) ? ZOOM_KEYS[key] : null;
}
