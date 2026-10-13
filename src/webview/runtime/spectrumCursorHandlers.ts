import type { SpectrumHover, SpectrumHoverTarget } from './spectrumHover';
import { channelIndexAttribute, spectrumHoverAt } from './spectrumRuntime';
import type { TrackId } from './types';

export interface SpectrumFocusTarget {
    trackIndex: number;
    channelIndex: number | null;
}

type FocusableElement = Pick<Element, 'id' | 'classList' | 'getAttribute'>;

export interface SpectrumCanvas {
    width: number;
    height: number;
    getBoundingClientRect(): { left: number; top: number };
}

export interface SpectrumCursorDeps {
    hover: SpectrumHover;
    trackIdAtIndex(trackIndex: number): TrackId | null;
    trackIndexFromElement(element: Pick<Element, 'getAttribute'>): number | null;
    activeElement(): FocusableElement | null;
    refresh(): void;
}

export interface SpectrumCursorHandlers {
    move(canvas: SpectrumCanvas, padLeft: number, padRight: number, pointer: { clientX: number; clientY: number }, trackIndex: number | null, channelIndex: number | null): void;
    leave(): void;
    focus(trackIndex: number | null, channelIndex: number | null): void;
    blur(): void;
}

export function spectrumFocusTargetFromElement(
    el: FocusableElement | null,
    trackIndexFromElement: (element: Pick<Element, 'getAttribute'>) => number | null,
): SpectrumFocusTarget | null {
    if (!el) {
        return null;
    }
    if (el.id === 'spectrum-overlay-canvas') {
        return { trackIndex: -1, channelIndex: null };
    }
    if (el.classList && el.classList.contains('track-spectrum-canvas')) {
        const idx = trackIndexFromElement(el);
        return idx === null ? null : { trackIndex: idx, channelIndex: channelIndexAttribute(el) };
    }
    return null;
}

export function createSpectrumCursorHandlers(deps: SpectrumCursorDeps): SpectrumCursorHandlers {
    const { hover } = deps;
    function hoverTarget(trackIndex: number | null): SpectrumHoverTarget | null {
        return trackIndex === null || trackIndex < 0 ? 'overlay' : deps.trackIdAtIndex(trackIndex);
    }
    function setFocusTarget(trackIndex: number, channelIndex: number | null) {
        hover.focus(hoverTarget(trackIndex), channelIndex);
        deps.refresh();
    }
    function clearFocusTarget() {
        hover.clear();
        deps.refresh();
    }
    return {
        move(canvas, padLeft, padRight, pointer, trackIndex, channelIndex) {
            const rect = canvas.getBoundingClientRect();
            const point = spectrumHoverAt(pointer.clientX - rect.left, pointer.clientY - rect.top, canvas.width, canvas.height, padLeft, padRight);
            if (!point) {
                hover.hasMouse = false;
                clearFocusTarget();
                return;
            }
            hover.move(point, hoverTarget(trackIndex), channelIndex);
            deps.refresh();
        },
        leave() {
            hover.hasMouse = false;
            const focused = spectrumFocusTargetFromElement(deps.activeElement(), deps.trackIndexFromElement);
            if (focused) {
                setFocusTarget(focused.trackIndex, focused.channelIndex);
                return;
            }
            clearFocusTarget();
        },
        focus(trackIndex, channelIndex) {
            if (trackIndex === null) {
                clearFocusTarget();
                return;
            }
            setFocusTarget(trackIndex, channelIndex);
        },
        blur() {
            if (hover.hasMouse) {
                return;
            }
            clearFocusTarget();
        },
    };
}

export interface SpectrumCursorTarget {
    trackIndex: number | null;
    channelIndex: number | null;
}

export function attachSpectrumCursorListeners(
    canvas: SpectrumCanvas & Pick<HTMLElement, 'addEventListener'>,
    cursor: SpectrumCursorHandlers,
    pad: { left: number; right: number },
    target: () => SpectrumCursorTarget,
    isSuppressed: () => boolean = () => false,
): void {
    canvas.addEventListener('mousemove', function (e) {
        if (isSuppressed()) {
            return;
        }
        const t = target();
        cursor.move(canvas, pad.left, pad.right, e, t.trackIndex, t.channelIndex);
    });
    canvas.addEventListener('mouseleave', cursor.leave);
    canvas.addEventListener('focus', function () {
        const t = target();
        cursor.focus(t.trackIndex, t.channelIndex);
    });
    canvas.addEventListener('blur', cursor.blur);
}
