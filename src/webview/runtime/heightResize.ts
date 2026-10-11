import { parseBoundedInteger } from './settingsPopover';

export type HeightKind = 'track' | 'spectrum';

export function clampHeight(value: number, minValue: number, maxValue: number): number {
    return Math.max(minValue, Math.min(maxValue, value));
}

/** Maps a height number-input action and its raw value to the height it requests; null when it requests none. */
export function heightInputRequest(action: string | null, value: string | number | null): { kind: HeightKind; height: number } | null {
    const kind = action === 'track-height-input' ? 'track' : action === 'spectrum-height-input' ? 'spectrum' : null;
    if (!kind || value === null) {
        return null;
    }
    const height = parseBoundedInteger(value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    return height === null ? null : { kind, height };
}

export interface HeightResizeDeps {
    currentHeight(kind: HeightKind): number;
    setHeight(kind: HeightKind, height: number): void;
    onActiveChange(active: boolean): void;
}

export interface HeightResize {
    begin(kind: HeightKind, clientY: number): void;
    update(clientY: number): void;
    end(): void;
    isActive(): boolean;
}

/** Drag-to-resize for track rows and the spectrum overlay; the spectrum handle sits above its panel, so dragging up grows it. */
export function createHeightResize(deps: HeightResizeDeps): HeightResize {
    let drag: { kind: HeightKind; startY: number; startHeight: number } | null = null;
    return {
        begin(kind, clientY) {
            drag = { kind, startY: clientY, startHeight: deps.currentHeight(kind) };
            deps.onActiveChange(true);
        },
        update(clientY) {
            if (!drag) {
                return;
            }
            const delta = clientY - drag.startY;
            deps.setHeight(drag.kind, drag.kind === 'track' ? drag.startHeight + delta : drag.startHeight - delta);
        },
        end() {
            if (!drag) {
                return;
            }
            drag = null;
            deps.onActiveChange(false);
        },
        isActive: () => drag !== null,
    };
}
