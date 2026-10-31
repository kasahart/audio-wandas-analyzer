import type { RectZoomSelection } from './types';

export interface SpectrumZoomSnapshot {
    specFreqStart: number;
    specFreqEnd: number;
    trackHeight: number;
    spectrumOverlayHeight: number;
    specDbMin: number | null;
    specDbMax: number | null;
}

export interface WaveformZoomSnapshot {
    zoomStart: number;
    zoomEnd: number;
    amplitudeZoomMinNorm: number;
    amplitudeZoomMaxNorm: number;
    rectZoomSelection: RectZoomSelection | null;
}

export interface SpectrumSliceTiming {
    requestId: string;
    cursorNorm: number;
    backendComputeMs: number | undefined;
    cursorToResponseMs: number;
    responseAt: number;
    inFlight: number;
    desiredCount: number;
}

/** What the comparison runtime reports as it goes: read-only copies of its view state, never handles into it. */
export type ComparisonRuntimeEvent =
    | { type: 'spectrum-zoom'; snapshot: SpectrumZoomSnapshot }
    | { type: 'waveform-zoom'; snapshot: WaveformZoomSnapshot }
    | { type: 'spectrum-slice-timing'; timing: SpectrumSliceTiming };

export class RuntimeEventFeed {
    private readonly listeners = new Set<(event: ComparisonRuntimeEvent) => void>();

    subscribe(listener: (event: ComparisonRuntimeEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** The event is built only when someone listens, so the runtime emits it on every path at no cost. */
    emit(build: () => ComparisonRuntimeEvent): void {
        if (this.listeners.size === 0) {
            return;
        }
        const event = build();
        this.listeners.forEach(listener => listener(event));
    }
}
