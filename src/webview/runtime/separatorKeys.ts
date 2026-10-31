/**
 * The resize edges (role="separator") from the keyboard: arrows move a focused edge by a step (Shift: ten),
 * Home / End to its least / most, and its aria-valuenow / -min / -max follow its value.
 */
import { keyRouterFor } from './keyRouter';

export interface SeparatorRange {
    now: number;
    min: number;
    max: number;
    step: number;
}

export interface SeparatorControl {
    /** The edge's value and limits, or null for an edge that cannot move now (a collapsed panel's). */
    range(handle: HTMLElement): SeparatorRange | null;
    set(handle: HTMLElement, value: number): void;
    /** The arrow that makes the value larger: the way the edge goes to grow what it sizes. */
    growKey(handle: HTMLElement): 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
}

const SHRINK_KEY = { ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp', ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' } as const;

export function separatorKeyValue(key: string, shiftKey: boolean, growKey: keyof typeof SHRINK_KEY, range: SeparatorRange): number | null {
    const step = range.step * (shiftKey ? 10 : 1);
    const next = key === growKey ? range.now + step
        : key === SHRINK_KEY[growKey] ? range.now - step
            : key === 'Home' ? range.min
                : key === 'End' ? range.max : null;
    return next === null ? null : Math.max(range.min, Math.min(range.max, next));
}

function syncHandle(handle: HTMLElement, control: SeparatorControl): void {
    const range = control.range(handle);
    if (!range) {
        handle.removeAttribute('aria-valuenow');
        return;
    }
    handle.setAttribute('aria-valuenow', String(Math.round(range.now)));
    handle.setAttribute('aria-valuemin', String(Math.round(range.min)));
    handle.setAttribute('aria-valuemax', String(Math.round(range.max)));
}

export interface SeparatorKeys {
    /** Sets every edge's aria values again, after a drag or a rebuild. */
    sync(): void;
}

export function attachSeparatorKeys(document: Document, control: SeparatorControl): SeparatorKeys {
    const handles = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="separator"]'));
    keyRouterFor(document.defaultView!).add({
        layer: 'widget',
        keydown(event) {
            const handle = (event.target as Element | null)?.closest?.<HTMLElement>('[role="separator"]');
            if (!handle || event.ctrlKey || event.metaKey || event.altKey) return false;
            const range = control.range(handle);
            if (!range) return false;
            const next = separatorKeyValue(event.key, event.shiftKey, control.growKey(handle), range);
            if (next === null) return false;
            event.preventDefault();
            control.set(handle, next);
            syncHandle(handle, control);
            return true;
        },
    });
    document.addEventListener('focusin', event => {
        const handle = (event.target as Element | null)?.closest?.<HTMLElement>('[role="separator"]');
        if (handle) syncHandle(handle, control);
    });
    const sync = (): void => handles().forEach(handle => syncHandle(handle, control));
    sync();
    return { sync };
}
