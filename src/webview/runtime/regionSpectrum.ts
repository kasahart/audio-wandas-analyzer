import type { SpectrumBandsPerOctave, SpectrumSliceRequest } from '../../shared/utils/audioTarget';
import type { HostInboundMessage } from './hostMessaging';
import { spectrumSlicesFromResult } from './spectrumRuntime';
import type { SpectrumSeries, SpectrumSlice, TrackId } from './types';

/** One shown track, in display order. */
export interface RegionSpectrumSource {
    trackId: TrackId;
    trackIndex: number;
    filePath: string;
    offsetSeconds: number;
    durationSeconds: number;
    channelCount: number;
    color: string;
    label(channelIndex: number): string;
}

export interface TimeRange {
    startSeconds: number;
    endSeconds: number;
}

export interface RegionSpectrumHost {
    sources(): RegionSpectrumSource[];
    /** Global seconds of the loop region, or null to average each whole file. */
    range(): TimeRange | null;
    analysisId(): string;
    settingsSignature(): string;
    bandsPerOctave(): SpectrumBandsPerOctave | 0;
    nextRequestId(trackIndex: number): string;
    post(request: SpectrumSliceRequest): void;
    applyDisplaySettings(slice: SpectrumSlice): SpectrumSlice;
    /** A spectrum arrived or failed, so the panel needs repainting. */
    onChange(): void;
}

export interface RegionSpectrumStrings {
    pairAverages: string;
}

export const REGION_REQUEST_DELAY_MS = 150;

/** The span of one file that a global range covers, in seconds from the file's start; null when the range misses the file. */
export function regionForTrack(range: TimeRange | null, offsetSeconds: number, durationSeconds: number): TimeRange | null {
    if (!range) {
        return { startSeconds: 0, endSeconds: durationSeconds };
    }
    const startSeconds = Math.max(0, range.startSeconds - offsetSeconds);
    const endSeconds = Math.min(durationSeconds, range.endSeconds - offsetSeconds);
    return endSeconds > startSeconds ? { startSeconds, endSeconds } : null;
}

/** "0.25–1.50 s", with "· 32 avg" after it when the spectra were averaged. */
export function regionCaption(range: TimeRange, averages: number[], strings: RegionSpectrumStrings): string {
    const span = range.startSeconds.toFixed(2) + '–' + range.endSeconds.toFixed(2) + ' s';
    if (averages.length === 0) {
        return span;
    }
    const min = Math.min(...averages);
    const max = Math.max(...averages);
    return span + ' · ' + strings.pairAverages.replace('{n}', min === max ? String(min) : min + '–' + max);
}

interface TrackEntry {
    sentKey: string | null;
    pendingRequestId: string | null;
    slices: Map<number, SpectrumSlice>;
    averages: number | null;
    error: string | null;
}

/**
 * The average spectrum of each shown track over the loop region, or over its whole file without one.
 * A request goes out per track only when the tracks, the region or the settings change and have
 * rested for a moment, so dragging the cursor or a loop edge never recomputes.
 */
export class RegionSpectrumStore {
    private observedKey: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly entries = new Map<TrackId, TrackEntry>();

    constructor(private readonly host: RegionSpectrumHost, private readonly strings: RegionSpectrumStrings) { }

    /** Called on every render: a change of the inputs restarts the delay before the requests go out. */
    sync(): void {
        const key = this.inputKey();
        if (key === this.observedKey) {
            return;
        }
        this.observedKey = key;
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.requestIfChanged();
        }, REGION_REQUEST_DELAY_MS);
    }

    private inputKey(): string {
        const sources = this.host.sources().map(source => [source.trackId, source.trackIndex, source.filePath, source.offsetSeconds, source.durationSeconds, source.channelCount]);
        return JSON.stringify([this.host.analysisId(), this.host.settingsSignature(), this.host.bandsPerOctave(), this.host.range(), sources]);
    }

    requestIfChanged(): void {
        const sources = this.host.sources();
        const range = this.host.range();
        const kept = new Set<TrackId>();
        for (const source of sources) {
            kept.add(source.trackId);
            const region = regionForTrack(range, source.offsetSeconds, source.durationSeconds);
            const entry = this.entry(source.trackId);
            if (!region) {
                entry.sentKey = null;
                entry.pendingRequestId = null;
                entry.slices.clear();
                entry.averages = null;
                entry.error = null;
                continue;
            }
            const bands = this.host.bandsPerOctave();
            const request: Omit<SpectrumSliceRequest, 'requestId'> = {
                type: 'request-spectrum-slice',
                analysisId: this.host.analysisId(),
                settingsSignature: this.host.settingsSignature(),
                trackIndex: source.trackIndex,
                filePath: source.filePath,
                startSeconds: region.startSeconds,
                endSeconds: region.endSeconds,
                ...(bands ? { bandsPerOctave: bands } : {}),
            };
            const key = JSON.stringify(request);
            if (key === entry.sentKey) {
                continue;
            }
            entry.sentKey = key;
            entry.pendingRequestId = this.host.nextRequestId(source.trackIndex);
            entry.error = null;
            this.host.post({ ...request, requestId: entry.pendingRequestId });
        }
        for (const trackId of Array.from(this.entries.keys())) {
            if (!kept.has(trackId)) {
                this.entries.delete(trackId);
            }
        }
        this.host.onChange();
    }

    private entry(trackId: TrackId): TrackEntry {
        let entry = this.entries.get(trackId);
        if (!entry) {
            entry = { sentKey: null, pendingRequestId: null, slices: new Map(), averages: null, error: null };
            this.entries.set(trackId, entry);
        }
        return entry;
    }

    /** Returns whether the message answered one of this store's requests. */
    handleMessage(message: HostInboundMessage): boolean {
        if (message.type !== 'spectrum-slice-result' && message.type !== 'spectrum-slice-error') {
            return false;
        }
        const found = Array.from(this.entries.entries()).find(([, entry]) => entry.pendingRequestId === message.requestId);
        if (!found) {
            return false;
        }
        const [, entry] = found;
        entry.pendingRequestId = null;
        if (message.type === 'spectrum-slice-error') {
            entry.error = message.error;
            entry.slices.clear();
            entry.averages = null;
        }
        else {
            entry.error = null;
            entry.slices.clear();
            for (const slice of spectrumSlicesFromResult(message, undefined)) {
                entry.slices.set(slice.channelIndex, slice);
            }
            entry.averages = message.averages ?? null;
        }
        this.host.onChange();
        return true;
    }

    /** True while a shown track still waits for its first spectrum. */
    get pending(): boolean {
        return this.host.sources().some(source => {
            const entry = this.entries.get(source.trackId);
            return !entry || (entry.pendingRequestId !== null && entry.slices.size === 0 && entry.error === null);
        });
    }

    /** True while a shown track waits for a newer spectrum than the one it shows. */
    get stale(): boolean {
        return this.host.sources().some(source => {
            const entry = this.entries.get(source.trackId);
            return !!entry && entry.pendingRequestId !== null && entry.slices.size > 0;
        });
    }

    /** The first failure among the shown tracks, or null. */
    get error(): string | null {
        for (const source of this.host.sources()) {
            const entry = this.entries.get(source.trackId);
            if (entry?.error) {
                return entry.error;
            }
        }
        return null;
    }

    /** One line per shown channel, in display order, with the display settings applied. */
    series(): SpectrumSeries[] {
        const series: SpectrumSeries[] = [];
        for (const source of this.host.sources()) {
            const entry = this.entries.get(source.trackId);
            if (!entry) {
                continue;
            }
            for (let channelIndex = 0; channelIndex < source.channelCount; channelIndex++) {
                const slice = entry.slices.get(channelIndex);
                if (slice) {
                    series.push({ slice: this.host.applyDisplaySettings(slice), color: source.color, index: source.trackIndex, channelIndex, label: source.label(channelIndex) });
                }
            }
        }
        return series;
    }

    /** The global span the panel averages, or null without a shown track. */
    range(): TimeRange | null {
        const explicit = this.host.range();
        if (explicit) {
            return explicit;
        }
        const sources = this.host.sources();
        if (sources.length === 0) {
            return null;
        }
        return {
            startSeconds: Math.min(...sources.map(source => source.offsetSeconds)),
            endSeconds: Math.max(...sources.map(source => source.offsetSeconds + source.durationSeconds)),
        };
    }

    /** The header line: the averaged span, then the number of averages once the FFT spectra arrived. */
    caption(): string {
        const range = this.range();
        if (!range) {
            return '';
        }
        const averages = this.host.sources().flatMap(source => {
            const entry = this.entries.get(source.trackId);
            return entry && entry.averages !== null && entry.slices.size > 0 ? [entry.averages] : [];
        });
        return regionCaption(range, averages, this.strings);
    }
}
