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
