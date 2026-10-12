import type { TrackId } from './types';

export type SpectrumHoverTarget = TrackId | 'overlay';

export interface SpectrumHoverPoint {
    hoverNorm: number;
    yFrac: number;
}

export class SpectrumHover {
    norm: number | null = null;
    yFrac: number | null = null;
    target: SpectrumHoverTarget | null = null;
    channelIndex: number | null = null;
    hasMouse = false;

    // Keyboard focus without a mouse position starts the cursor at the left edge, vertically centred.
    focus(target: SpectrumHoverTarget | null, channelIndex: number | null): void {
        if (this.norm === null) {
            this.norm = 0;
        }
        if (this.yFrac === null) {
            this.yFrac = 0.5;
        }
        this.target = target;
        this.channelIndex = Number.isInteger(channelIndex) ? channelIndex : null;
        this.hasMouse = false;
    }

    move(point: SpectrumHoverPoint, target: SpectrumHoverTarget | null, channelIndex: number | null): void {
        this.norm = point.hoverNorm;
        this.yFrac = point.yFrac;
        this.target = target;
        this.channelIndex = Number.isInteger(channelIndex) ? channelIndex : null;
        this.hasMouse = true;
    }

    clear(): void {
        this.norm = null;
        this.yFrac = null;
        this.target = null;
        this.channelIndex = null;
    }
}
