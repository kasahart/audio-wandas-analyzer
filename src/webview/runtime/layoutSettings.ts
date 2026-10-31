import { clampHeight } from './heightResize';
import type { PersistedWebviewState } from './types';

// A lane's plot height: the waveform and the spectrogram under it share it.
export const TRACK_HEIGHT_DEFAULT = 160;
export const TRACK_HEIGHT_MIN = 100;
export const TRACK_HEIGHT_MAX = 440;
export const WAVE_SHARE_DEFAULT = 0.4;
export const WAVE_SHARE_MIN = 0.15;
export const WAVE_SHARE_MAX = 0.85;
export const SPECTRUM_HEIGHT_DEFAULT = 140;
export const SPECTRUM_HEIGHT_MIN = 80;
export const SPECTRUM_HEIGHT_MAX = 1200;

export type LayoutChange = 'track-height' | 'spectrum-height' | 'wave-share' | 'sidebar-collapsed' | 'spectrum-collapsed' | 'spectrum-maximized';

type PersistedLayout = Pick<PersistedWebviewState, 'waveShare' | 'sidebarCollapsed' | 'spectrumCollapsed'>;

/**
 * The comparison's layout: lane and spectrum heights, the waveform's share of a lane, the folded and maximized
 * panels, and the canvas sizes last applied to each lane. Each setter tells its listeners what changed; the
 * listeners follow it in the DOM.
 */
export class LayoutSettings {
    private trackHeightValue = TRACK_HEIGHT_DEFAULT;
    private spectrumHeightValue = SPECTRUM_HEIGHT_DEFAULT;
    private waveShareValue: number;
    private sidebarCollapsedValue: boolean;
    private spectrumCollapsedValue: boolean;
    private spectrumMaximizedValue = false;
    private readonly canvasSizes = new Map<string, string>();
    private readonly listeners = new Set<(change: LayoutChange) => void>();

    constructor(persisted: PersistedLayout, private readonly persist: (patch: Partial<PersistedWebviewState>) => void) {
        this.waveShareValue = typeof persisted.waveShare === 'number' ? clampHeight(persisted.waveShare, WAVE_SHARE_MIN, WAVE_SHARE_MAX) : WAVE_SHARE_DEFAULT;
        this.sidebarCollapsedValue = persisted.sidebarCollapsed === true;
        // The cursor spectrum starts folded: the tracks get the room until it is opened (and then it stays as left).
        this.spectrumCollapsedValue = persisted.spectrumCollapsed !== false;
    }

    get trackHeight(): number { return this.trackHeightValue; }
    get spectrumOverlayHeight(): number { return this.spectrumHeightValue; }
    get waveShare(): number { return this.waveShareValue; }
    get sidebarCollapsed(): boolean { return this.sidebarCollapsedValue; }
    get spectrumCollapsed(): boolean { return this.spectrumCollapsedValue; }
    get spectrumMaximized(): boolean { return this.spectrumMaximizedValue; }

    onChange(listener: (change: LayoutChange) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** False when the clamped height is the one already set. */
    setTrackHeight(value: number): boolean {
        const next = clampHeight(value, TRACK_HEIGHT_MIN, TRACK_HEIGHT_MAX);
        if (next === this.trackHeightValue) return false;
        this.trackHeightValue = next;
        this.invalidateCanvasSizes();
        this.emit('track-height');
        return true;
    }

    /** `max` is what the pane leaves the plot now; false when the clamped height is the one already set. */
    setSpectrumHeight(value: number, max: number): boolean {
        const next = clampHeight(value, SPECTRUM_HEIGHT_MIN, max);
        if (next === this.spectrumHeightValue) return false;
        this.spectrumHeightValue = next;
        this.emit('spectrum-height');
        return true;
    }

    /** The waveform's share of every lane; `persist` keeps it across sessions (a drag keeps it as it ends). */
    setWaveShare(value: number, persist: boolean): boolean {
        const next = clampHeight(value, WAVE_SHARE_MIN, WAVE_SHARE_MAX);
        if (next === this.waveShareValue) return false;
        this.waveShareValue = next;
        this.invalidateCanvasSizes();
        this.emit('wave-share');
        if (persist) this.persistWaveShare();
        return true;
    }

    persistWaveShare(): void {
        this.persist({ waveShare: this.waveShareValue });
    }

    setSidebarCollapsed(next: boolean): void {
        this.sidebarCollapsedValue = next;
        this.persist({ sidebarCollapsed: next });
        this.emit('sidebar-collapsed');
    }

    /** Folding a maximized spectrum restores it first. */
    setSpectrumCollapsed(next: boolean): void {
        if (next && this.spectrumMaximizedValue) this.setSpectrumMaximized(false);
        this.spectrumCollapsedValue = next;
        this.persist({ spectrumCollapsed: next });
        this.emit('spectrum-collapsed');
    }

    /** Maximizing a folded spectrum unfolds it first; maximized is not kept across sessions. */
    setSpectrumMaximized(next: boolean): void {
        if (next && this.spectrumCollapsedValue) this.setSpectrumCollapsed(false);
        this.spectrumMaximizedValue = next;
        this.emit('spectrum-maximized');
    }

    /** Records `size` for the canvas `key`; false when it is the size already applied, so the canvas need not be touched. */
    canvasSizeChanged(key: string, size: string): boolean {
        if (this.canvasSizes.get(key) === size) return false;
        this.canvasSizes.set(key, size);
        return true;
    }

    /** Every lane's canvases are sized again on the next render. */
    invalidateCanvasSizes(): void {
        this.canvasSizes.clear();
    }

    private emit(change: LayoutChange): void {
        this.listeners.forEach(listener => listener(change));
    }
}
