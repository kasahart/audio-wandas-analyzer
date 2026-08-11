export interface PopoverPosition {
    left: number;
    top: number;
}

export function parseBoundedInteger(value: string | number, min: number, max: number): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : null;
}

export function positionPopover(
    clientX: number,
    clientY: number,
    popoverWidth: number,
    popoverHeight: number,
    viewportWidth: number,
    viewportHeight: number,
): PopoverPosition {
    return {
        left: popoverWidth > 0 && viewportWidth > 0 && clientX + 8 + popoverWidth > viewportWidth
            ? Math.max(4, clientX - popoverWidth - 8)
            : clientX + 8,
        top: popoverHeight > 0 && viewportHeight > 0 && clientY + 8 + popoverHeight > viewportHeight
            ? Math.max(4, clientY - popoverHeight - 8)
            : clientY + 8,
    };
}
