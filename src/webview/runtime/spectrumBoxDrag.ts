import { overlayPlotPoint } from './spectrumRuntime';
import type { DragPoint } from './types';

export interface SpectrumBoxSpan {
    anchor: DragPoint;
    current: DragPoint;
}

export class SpectrumBoxDrag {
    private span: SpectrumBoxSpan | null = null;

    get active(): boolean {
        return this.span !== null;
    }

    get box(): SpectrumBoxSpan | null {
        return this.span;
    }

    begin(point: DragPoint): void {
        this.span = { anchor: point, current: { ...point } };
    }

    update(point: DragPoint): void {
        if (this.span !== null) {
            this.span.current = point;
        }
    }

    finish(): SpectrumBoxSpan | null {
        const span = this.span;
        this.span = null;
        return span;
    }
}

export interface BoxDragCanvas {
    width: number;
    height: number;
    getBoundingClientRect(): { left: number; top: number };
    addEventListener(type: 'mousedown', listener: (event: MouseEvent) => void): void;
}

export interface BoxDragListeners {
    onUpdate(): void;
    onFinish(span: SpectrumBoxSpan): void;
}

export function attachSpectrumBoxDrag(
    canvas: BoxDragCanvas,
    doc: Pick<Document, 'addEventListener'>,
    drag: SpectrumBoxDrag,
    listeners: BoxDragListeners,
): void {
    function plotPoint(event: MouseEvent): DragPoint | null {
        const rect = canvas.getBoundingClientRect();
        return overlayPlotPoint(event.clientX - rect.left, event.clientY - rect.top, canvas.width, canvas.height);
    }
    canvas.addEventListener('mousedown', function (e) {
        if (e.button !== 0) {
            return;
        }
        const point = plotPoint(e);
        if (!point) {
            return;
        }
        drag.begin(point);
        e.preventDefault();
    });
    doc.addEventListener('mousemove', function (e) {
        if (!drag.active) {
            return;
        }
        const point = plotPoint(e);
        if (!point) {
            return;
        }
        drag.update(point);
        listeners.onUpdate();
    });
    doc.addEventListener('mouseup', function () {
        const span = drag.finish();
        if (span !== null) {
            listeners.onFinish(span);
        }
    });
}
