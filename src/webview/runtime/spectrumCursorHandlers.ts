import type { SpectrumHover } from './spectrumHover';
import { spectrumHoverAt } from './spectrumRuntime';

type FocusableElement = Pick<Element, 'id'>;

export interface SpectrumCanvas {
    width: number;
    height: number;
    getBoundingClientRect(): { left: number; top: number };
}

export interface SpectrumCursorDeps {
    hover: SpectrumHover;
    activeElement(): FocusableElement | null;
    refresh(): void;
}

export interface SpectrumCursorHandlers {
    move(canvas: SpectrumCanvas, padLeft: number, padRight: number, pointer: { clientX: number; clientY: number }): void;
    leave: () => void;
    focus: () => void;
    blur: () => void;
}

export function isSpectrumCanvasFocused(el: FocusableElement | null): boolean {
    return !!el && el.id === 'spectrum-overlay-canvas';
}

export function createSpectrumCursorHandlers(deps: SpectrumCursorDeps): SpectrumCursorHandlers {
    const { hover } = deps;
    function focusSpectrum() {
        hover.focus();
        deps.refresh();
    }
    function clearHover() {
        hover.clear();
        deps.refresh();
    }
    return {
        move(canvas, padLeft, padRight, pointer) {
            const rect = canvas.getBoundingClientRect();
            const point = spectrumHoverAt(pointer.clientX - rect.left, pointer.clientY - rect.top, canvas.width, canvas.height, padLeft, padRight);
            if (!point) {
                hover.hasMouse = false;
                clearHover();
                return;
            }
            hover.move(point);
            deps.refresh();
        },
        leave() {
            hover.hasMouse = false;
            if (isSpectrumCanvasFocused(deps.activeElement())) {
                focusSpectrum();
                return;
            }
            clearHover();
        },
        focus: focusSpectrum,
        blur() {
            if (hover.hasMouse) {
                return;
            }
            clearHover();
        },
    };
}

export function attachSpectrumCursorListeners(
    canvas: SpectrumCanvas & Pick<HTMLElement, 'addEventListener'>,
    cursor: SpectrumCursorHandlers,
    pad: { left: number; right: number },
    isSuppressed: () => boolean = () => false,
): void {
    canvas.addEventListener('mousemove', function (e) {
        if (isSuppressed()) {
            return;
        }
        cursor.move(canvas, pad.left, pad.right, e);
    });
    canvas.addEventListener('mouseleave', cursor.leave);
    canvas.addEventListener('focus', cursor.focus);
    canvas.addEventListener('blur', cursor.blur);
}
