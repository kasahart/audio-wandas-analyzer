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
