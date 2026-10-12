import type { RuntimeElement } from './types';

export function eventTarget(event: Event): RuntimeElement {
    return event.target as RuntimeElement;
}

export function canvasById(doc: { getElementById(elementId: string): unknown }, elementId: string): HTMLCanvasElement | null {
    return doc.getElementById(elementId) as HTMLCanvasElement | null;
}

export function audioById(doc: { getElementById(elementId: string): unknown }, elementId: string): HTMLAudioElement | null {
    return doc.getElementById(elementId) as HTMLAudioElement | null;
}

export function buttonById(doc: { getElementById(elementId: string): unknown }, elementId: string): HTMLButtonElement | null {
    return doc.getElementById(elementId) as HTMLButtonElement | null;
}

export function buttonMatching(root: { querySelector(selectors: string): unknown }, selectors: string): HTMLButtonElement | null {
    return root.querySelector(selectors) as HTMLButtonElement | null;
}

export function inputMatching(root: { querySelector(selectors: string): unknown }, selectors: string): HTMLInputElement | null {
    return root.querySelector(selectors) as HTMLInputElement | null;
}

export function inputsMatching(root: { querySelectorAll(selectors: string): ArrayLike<unknown> }, selectors: string): HTMLInputElement[] {
    return Array.from(root.querySelectorAll(selectors)) as HTMLInputElement[];
}
