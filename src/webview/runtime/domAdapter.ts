import type { RuntimeElement } from './types';

export function eventTarget(event: Event): RuntimeElement {
    return event.target as RuntimeElement;
}
