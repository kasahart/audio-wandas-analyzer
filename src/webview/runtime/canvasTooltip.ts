const POINTER_OFFSET_PX = 14;
const FOCUS_HINT_INSET_PX = 8;
const FOCUS_HINT_BOTTOM_OFFSET_PX = 36;
const FOCUS_OUTLINE = '1px solid rgba(100, 160, 255, 0.4)';

export interface CanvasTooltip {
    showAtPointer(clientX: number, clientY: number, text: string): void;
    showInside(rect: { left: number; bottom: number }, text: string): void;
    hide(): void;
}

export function createCanvasTooltip(doc: Document): CanvasTooltip {
    function show(left: number, top: number, text: string): void {
        const el = doc.getElementById('canvas-tooltip');
        if (!el) {
            return;
        }
        el.textContent = text;
        el.style.display = 'block';
        el.style.left = left + 'px';
        el.style.top = top + 'px';
    }
    return {
        showAtPointer(clientX, clientY, text) {
            show(clientX + POINTER_OFFSET_PX, clientY + POINTER_OFFSET_PX, text);
        },
        showInside(rect, text) {
            show(rect.left + FOCUS_HINT_INSET_PX, rect.bottom - FOCUS_HINT_BOTTOM_OFFSET_PX, text);
        },
        hide() {
            const el = doc.getElementById('canvas-tooltip');
            if (el) {
                el.style.display = 'none';
            }
        },
    };
}

export function attachCanvasFocusHint(canvas: HTMLElement, tooltip: CanvasTooltip, text: string): void {
    canvas.addEventListener('focus', function () {
        tooltip.showInside(canvas.getBoundingClientRect(), text);
        canvas.style.outline = FOCUS_OUTLINE;
    });
    canvas.addEventListener('blur', function () {
        tooltip.hide();
        canvas.style.outline = 'none';
    });
}
