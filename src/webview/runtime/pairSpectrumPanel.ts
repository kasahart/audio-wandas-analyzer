import type { PairSpectrumRequest } from '../../shared/utils/audioTarget';
import type { CanvasDrawCtx, DrawTheme, FrequencyScale } from '../draw/canvasDrawers';
import { syncCanvasSize } from './canvasSizing';
import type { HostInboundMessage } from './hostMessaging';
import {
    paintPairSpectrum, pairHeader, pairLegendHtml, PAIR_SPECTRUM_PAD, syncReferenceButtons,
    type PairCurve, type PairReference, type PairSpectrumResultMessage, type PairStrings,
} from './pairSpectrum';
import type { TrackId } from './types';

/** One visible channel lane, in display order. */
export interface PairChannelSource {
    trackId: TrackId;
    filePath: string;
    channelIndex: number;
    offsetSeconds: number;
    label: string;
    color: string;
}

export type PairPanelStrings = PairStrings & {
    pairWaiting: string;
    pairNoResponses: string;
    pairFailed: string;
    pairFewAveragesHint: string;
};

export interface PairPanelHost {
    channels(): PairChannelSource[];
    /** Global seconds of the loop region, or null to average the whole overlap. */
    range(): { startSeconds: number; endSeconds: number } | null;
    analysisId(): string;
    settingsSignature(): string;
    nextRequestId(): string;
    post(request: PairSpectrumRequest): void;
    /** The power spectrum's visible Hz window, or null before it painted an FFT axis. */
    visibleFrequencyHz(): FrequencyScale | null;
    /** The plot height the power spectrum next to it has. */
    plotHeight(): number;
    /** The frequency under the cursor on the power spectrum, or null when the cursor is elsewhere. */
    hoverFrequencyHz(): number | null;
    /** The cursor on the pair plot moved to this frequency, or left it with null, so the power spectrum can follow. */
    onHoverFrequency(frequencyHz: number | null): void;
    theme(): DrawTheme;
    onReferenceChange(reference: PairReference | null): void;
    /** The split moved, so the power spectrum next to it needs repainting. */
    onLayoutChange(): void;
}

export const PAIR_REQUEST_DELAY_MS = 150;
const PAIR_SPLIT_MIN = 0.25;
const PAIR_SPLIT_MAX = 0.75;

/**
 * The pair view next to the power spectrum: which lane is the reference, the request for its
 * response spectra, and their drawing. A request goes out only when the sources or the range
 * change, so moving the cursor never recomputes.
 */
export class PairSpectrumPanel {
    private referenceState: PairReference | null = null;
    private sentKey: string | null = null;
    private observedKey: string | null = null;
    private pendingRequestId: string | null = null;
    private result: PairSpectrumResultMessage | null = null;
    private error: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private hoverPoint: { x: number; y: number } | null = null;
    private splitFraction = 0.5;

    constructor(private readonly doc: Document, private readonly host: PairPanelHost, private readonly strings: PairPanelStrings) { }

    get reference(): PairReference | null {
        return this.referenceState;
    }

    get split(): number {
        return this.splitFraction;
    }

    toggleReference(trackId: TrackId, channelIndex: number): void {
        const same = this.referenceState?.trackId === trackId && this.referenceState.channelIndex === channelIndex;
        this.setReference(same ? null : { trackId, channelIndex });
    }

    setReference(next: PairReference | null): void {
        const hadHover = this.hoverPoint !== null;
        this.referenceState = next;
        this.sentKey = null;
        this.observedKey = null;
        this.pendingRequestId = null;
        this.result = null;
        this.error = null;
        this.hoverPoint = null;
        this.doc.getElementById('spectrum-section')?.classList.toggle('has-pair', next !== null);
        this.applySplit();
        syncReferenceButtons(this.doc, next, this.strings);
        this.host.onReferenceChange(next);
        if (hadHover) {
            // The pointer may still be over a pane that is closing, so no mouseleave will clear the power spectrum cursor.
            this.host.onHoverFrequency(null);
        }
        this.schedule(0);
    }

    setSplit(fraction: number): void {
        this.splitFraction = Math.max(PAIR_SPLIT_MIN, Math.min(PAIR_SPLIT_MAX, fraction));
        this.applySplit();
        this.host.onLayoutChange();
    }

    private applySplit(): void {
        const wrap = this.doc.getElementById('spectrum-overlay-wrap');
        if (wrap) {
            wrap.style.flexBasis = this.referenceState ? (this.splitFraction * 100).toFixed(1) + '%' : '';
        }
    }

    /**
     * Called on every render. Each change of the sources or the range restarts the delay, so a drag
     * of a loop edge or an offset sends one request once it rests, and a cursor move sends none.
     */
    sync(): void {
        if (!this.referenceState) {
            return;
        }
        const key = this.inputKey();
        if (key === this.observedKey) {
            return;
        }
        this.observedKey = key;
        this.schedule(PAIR_REQUEST_DELAY_MS);
    }

    private inputKey(): string {
        const channels = this.host.channels().map(channel => [channel.trackId, channel.filePath, channel.channelIndex, channel.offsetSeconds]);
        return JSON.stringify([this.referenceState, this.host.analysisId(), this.host.settingsSignature(), this.host.range(), channels]);
    }

    private schedule(delayMs: number): void {
        if (!this.referenceState) {
            return;
        }
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.requestIfChanged();
        }, delayMs);
    }

    private sources(): { reference: PairChannelSource; responses: PairChannelSource[] } | null {
        const reference = this.referenceState;
        if (!reference) {
            return null;
        }
        const channels = this.host.channels();
        const ref = channels.find(channel => channel.trackId === reference.trackId && channel.channelIndex === reference.channelIndex);
        if (!ref) {
            return null;
        }
        return { reference: ref, responses: channels.filter(channel => channel !== ref) };
    }

    requestIfChanged(): void {
        if (!this.referenceState) {
            return;
        }
        const sources = this.sources();
        if (!sources) {
            // The reference lane was removed or hidden.
            this.setReference(null);
            return;
        }
        if (sources.responses.length === 0) {
            this.sentKey = null;
            this.pendingRequestId = null;
            this.result = null;
            this.error = null;
            this.render();
            return;
        }
        const ref = (source: PairChannelSource) => ({ filePath: source.filePath, channelIndex: source.channelIndex, offsetSeconds: source.offsetSeconds });
        const range = this.host.range();
        const request: Omit<PairSpectrumRequest, 'requestId'> = {
            type: 'request-pair-spectrum',
            analysisId: this.host.analysisId(),
            settingsSignature: this.host.settingsSignature(),
            reference: ref(sources.reference),
            responses: sources.responses.map(ref),
            ...(range ? { startSeconds: range.startSeconds, endSeconds: range.endSeconds } : {}),
        };
        const key = JSON.stringify(request);
        if (key === this.sentKey) {
            return;
        }
        this.sentKey = key;
        this.pendingRequestId = this.host.nextRequestId();
        this.error = null;
        this.host.post({ ...request, requestId: this.pendingRequestId });
        this.render();
    }

    /** Returns whether the message belonged to the pair view. */
    handleMessage(message: HostInboundMessage): boolean {
        if (message.type !== 'pair-spectrum-result' && message.type !== 'pair-spectrum-error') {
            return false;
        }
        if (message.requestId !== this.pendingRequestId || message.analysisId !== this.host.analysisId()) {
            return true;
        }
        this.pendingRequestId = null;
        if (message.type === 'pair-spectrum-error') {
            this.error = message.error;
            this.result = null;
        }
        else {
            this.result = message;
            this.error = null;
        }
        this.render();
        return true;
    }

    get waiting(): boolean {
        return this.pendingRequestId !== null;
    }

    get lastResult(): PairSpectrumResultMessage | null {
        return this.result;
    }

    curves(): PairCurve[] {
        const result = this.result;
        const sources = this.sources();
        if (!result || !sources) {
            return [];
        }
        // Hosts give every listed source its own path, so a path and channel name one lane.
        const seenTracks = new Set<TrackId>();
        return result.responses.flatMap(response => {
            const source = sources.responses.find(channel => channel.filePath === response.filePath && channel.channelIndex === response.channelIndex);
            if (!source) {
                return [];
            }
            const dashed = seenTracks.has(source.trackId);
            seenTracks.add(source.trackId);
            return [{ label: source.label, color: source.color, dashed, response }];
        });
    }

    render(): void {
        syncReferenceButtons(this.doc, this.referenceState, this.strings);
        if (!this.referenceState) {
            return;
        }
        const summary = this.doc.getElementById('pair-spectrum-summary');
        const legend = this.doc.getElementById('pair-spectrum-legend');
        const message = this.doc.getElementById('pair-spectrum-message');
        const canvas = this.doc.getElementById('pair-spectrum-canvas') as HTMLCanvasElement | null;
        const plot = this.doc.getElementById('pair-spectrum-plot');
        if (!canvas || !plot) {
            return;
        }
        this.doc.getElementById('pair-spectrum-wrap')?.classList.toggle('is-stale', this.waiting && !!this.result);
        const curves = this.curves();
        const header = pairHeader(curves, this.strings);
        if (summary) {
            summary.textContent = header ? header.text : '';
            summary.classList.toggle('is-warning', !!header?.fewAverages);
            if (header?.fewAverages) {
                summary.setAttribute('data-hint', this.strings.pairFewAveragesHint);
            }
            else {
                summary.removeAttribute('data-hint');
            }
        }
        if (legend) {
            legend.innerHTML = pairLegendHtml(curves, this.strings);
        }
        const sources = this.sources();
        const text = this.error !== null ? this.strings.pairFailed.replace('{error}', this.error)
            : sources && sources.responses.length === 0 ? this.strings.pairNoResponses
                : this.waiting && !this.result ? this.strings.pairWaiting
                    : '';
        if (message) {
            message.textContent = text;
            message.style.display = text ? '' : 'none';
        }
        const width = plot.clientWidth || 400;
        syncCanvasSize(canvas, width, Math.max(60, this.host.plotHeight()));
        const ctx = canvas.getContext('2d') as CanvasDrawCtx | null;
        if (!ctx) {
            return;
        }
        const result = this.result;
        if (!result || text) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            this.setReadout(null);
            return;
        }
        // The power spectrum's Hz window, not its zoom fractions: they scale to the fastest track's Nyquist, the pair view's to the reference's.
        const visible = this.visibleFrequencyHz(result);
        const own = this.hoverPoint ? this.frequencyAt(this.hoverPoint.x, canvas.width, visible) : null;
        const synced = own === null ? this.host.hoverFrequencyHz() : null;
        const hover = own !== null ? { frequencyHz: own, y: this.hoverPoint!.y } : synced !== null ? { frequencyHz: synced, y: null } : null;
        const readout = paintPairSpectrum(ctx, canvas.width, canvas.height,
            { frequencyBins: result.frequencyBins, maxFrequencyHz: result.maxFrequencyHz, curves },
            visible, hover, this.strings, this.host.theme());
        this.setReadout(readout);
    }

    private visibleFrequencyHz(result: PairSpectrumResultMessage): FrequencyScale {
        return this.host.visibleFrequencyHz() ?? { frequencyMin: 0, frequencyMax: result.maxFrequencyHz };
    }

    private frequencyAt(x: number, canvasWidth: number, visible: FrequencyScale): number | null {
        const plotWidth = canvasWidth - PAIR_SPECTRUM_PAD.left - PAIR_SPECTRUM_PAD.right;
        if (plotWidth <= 0) {
            return null;
        }
        const fraction = Math.max(0, Math.min(1, (x - PAIR_SPECTRUM_PAD.left) / plotWidth));
        return visible.frequencyMin + fraction * (visible.frequencyMax - visible.frequencyMin);
    }

    private setReadout(readout: { text: string; color: string } | null): void {
        const el = this.doc.getElementById('pair-spectrum-readout');
        if (el) {
            el.textContent = readout ? readout.text : '';
            el.style.color = readout ? readout.color : '';
        }
    }

    /** Hover on the pair plot and the divider drag; call again after the spectrum section is rebuilt. */
    attach(): void {
        const canvas = this.doc.getElementById('pair-spectrum-canvas');
        canvas?.addEventListener('mousemove', event => {
            const rect = canvas.getBoundingClientRect();
            const element = canvas as HTMLCanvasElement;
            const scaleX = rect.width > 0 ? element.width / rect.width : 1;
            const scaleY = rect.height > 0 ? element.height / rect.height : 1;
            this.hoverPoint = { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
            this.render();
            const frequencyHz = this.result ? this.frequencyAt(this.hoverPoint.x, element.width, this.visibleFrequencyHz(this.result)) : null;
            // The power spectrum may reach past the reference's Nyquist, where the pair cursor stops at its last bin.
            this.host.onHoverFrequency(frequencyHz === null || !this.result ? null : Math.min(frequencyHz, this.result.maxFrequencyHz));
        });
        canvas?.addEventListener('mouseleave', () => {
            this.hoverPoint = null;
            this.render();
            this.host.onHoverFrequency(null);
        });
        const divider = this.doc.getElementById('pair-divider');
        const split = this.doc.getElementById('spectrum-split');
        divider?.addEventListener('mousedown', event => {
            if (!split) {
                return;
            }
            event.preventDefault();
            const body = this.doc.body;
            body.classList.add('is-pair-resizing');
            const move = (moveEvent: MouseEvent) => {
                const rect = split.getBoundingClientRect();
                if (rect.width > 0) {
                    this.setSplit((moveEvent.clientX - rect.left) / rect.width);
                }
            };
            const up = () => {
                body.classList.remove('is-pair-resizing');
                this.doc.removeEventListener('mousemove', move);
                this.doc.removeEventListener('mouseup', up);
            };
            this.doc.addEventListener('mousemove', move);
            this.doc.addEventListener('mouseup', up);
        });
    }

    dispose(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
