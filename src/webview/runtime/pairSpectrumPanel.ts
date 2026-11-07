import type { PairSpectrumRequest } from '../../shared/utils/audioTarget';
import type { DrawTheme, FrequencyScale } from '../draw/canvasDrawers';
import type { HostInboundMessage } from './hostMessaging';
import {
    pairHeader, pairLanes, pairLegendHtml, PAIR_LANES, syncReferenceButtons,
    type PairCurve, type PairLaneKey, type PairReference, type PairSpectrumResultMessage, type PairStrings,
} from './pairSpectrum';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotWindow } from './plotInteraction';
import { createPlotHoverLayer, type PlotHoverLayer } from './plotHoverLayer';
import { paintOverlay, stagePlotPoint, type StagePlot } from './stagePanes';
import type { NormalizedRange } from './waveformInteraction';
import type { TrackId } from './types';
import { HostRequests } from './hostRequests';

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
    /** A zoom on the pair view moves the frequency axis it shares with the power spectrum (null: the whole axis). */
    setFrequencyWindowHz(range: { min: number; max: number } | null): void;
    /** A double-click on the pair view's frequency axis opens the power spectrum's frequency range. */
    openFrequencyRange(clientX: number, clientY: number): void;
    /** A double-click on a pair plot's level axis opens its range (the shared range popover). */
    openLevelRange(request: { label: string; min: number; max: number; current: NormalizedRange; clientX: number; clientY: number; set(part: NormalizedRange | null): void }): void;
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
export const PAIR_SPLIT_MIN = 0.25;
export const PAIR_SPLIT_MAX = 0.75;

/**
 * The pair view next to the power spectrum: which lane is the reference, the request for its
 * response spectra, and their drawing. A request goes out only when the sources or the range
 * change, so moving the cursor never recomputes.
 */
export class PairSpectrumPanel {
    private referenceState: PairReference | null = null;
    private sentKey: string | null = null;
    private observedKey: string | null = null;
    /** The response spectra asked for ('pair'), as every on-demand request is kept. */
    private readonly requests = new HostRequests<undefined>();
    private result: PairSpectrumResultMessage | null = null;
    private error: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** The pointer over one of the pair plots, while it is. */
    private pointer: { lane: PairLaneKey; clientX: number; clientY: number } | null = null;
    /** The frequency the pair cursor last read under the pointer. */
    private readHz: number | null = null;
    /** What each plot last drew, for the pointer and the gestures. */
    private readonly drawn = new Map<PairLaneKey, { canvas: HTMLCanvasElement; plot: StagePlot | null; range: { min: number; max: number }; label: string }>();
    /** Each plot's part of its level axis on screen (the frequency axis is the power spectrum's). */
    private readonly levelWindow = new Map<PairLaneKey, NormalizedRange>();
    private marks: Map<PairLaneKey, PlotHoverLayer> | null = null;
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
        const hadHover = this.pointer !== null;
        this.referenceState = next;
        this.sentKey = null;
        this.observedKey = null;
        this.requests.drop('pair');
        this.result = null;
        this.error = null;
        this.pointer = null;
        this.levelWindow.clear();
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

    /** The reference channel and every other shown channel; null without a reference or once its lane is gone. */
    sources(): { reference: PairChannelSource; responses: PairChannelSource[] } | null {
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
            this.requests.drop('pair');
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
        this.error = null;
        this.requests.ask('pair', this.host.nextRequestId(), key, undefined, ({ requestId }) => this.host.post({ ...request, requestId }));
        this.render();
    }

    /** Returns whether the message belonged to the pair view. */
    handleMessage(message: HostInboundMessage): boolean {
        if (message.type !== 'pair-spectrum-result' && message.type !== 'pair-spectrum-error') {
            return false;
        }
        if (!this.requests.answering('pair', message.requestId) || message.analysisId !== this.host.analysisId()) {
            return true;
        }
        this.requests.settle(message.requestId);
        if (message.type === 'pair-spectrum-error') {
            this.error = message.error;
            this.result = null;
        }
        else {
            this.result = message;
            this.error = null;
        }
        this.render();
        if (this.pointer) {
            this.syncHostHover();
        }
        return true;
    }

    get waiting(): boolean {
        return this.requests.pending('pair') !== undefined;
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

    private canvases(): Array<{ key: PairLaneKey; canvas: HTMLCanvasElement }> {
        return PAIR_LANES.flatMap(key => {
            const canvas = this.doc.querySelector<HTMLCanvasElement>(`[data-pair-lane="${key}"]`);
            return canvas ? [{ key, canvas }] : [];
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
        const plot = this.doc.getElementById('pair-spectrum-plot');
        if (!plot) {
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
        // The plots together take the power spectrum's height beside them.
        plot.style.height = `${Math.max(180, this.host.plotHeight())}px`;
        const result = this.result;
        const lanes = result && !text ? pairLanes({ frequencyBins: result.frequencyBins, maxFrequencyHz: result.maxFrequencyHz, curves }, this.visibleFrequencyHz(result), this.strings) : [];
        const window = result ? this.frequencyWindow(result) : FULL_PLOT_WINDOW.x;
        this.drawn.clear();
        for (const { key, canvas } of this.canvases()) {
            const lane = lanes.find(item => item.key === key);
            // Each plot is drawn by the plot component (R13): its axes, its zoom, its cursor and readout.
            const range = lane ? this.levelRange(key, lane.range) : { min: 0, max: 1 };
            const drawn = paintOverlay(canvas, { layers: lane?.layers ?? [] }, range, lane?.axes ?? { x: '', y: '' }, { window: { x: window } });
            this.drawn.set(key, { canvas, plot: drawn, range: lane?.range ?? range, label: lane?.axes.y ?? '' });
        }
        this.showMarks();
    }

    /** The plot's level range on screen: its whole range, or the part of it zoomed to. */
    private levelRange(key: PairLaneKey, whole: { min: number; max: number }): { min: number; max: number } {
        const part = this.levelWindow.get(key);
        if (!part) return whole;
        const span = whole.max - whole.min;
        return { min: whole.min + part.start * span, max: whole.min + part.end * span };
    }

    /** The power spectrum's Hz window as the part of the pair view's frequency axis (0 to the reference's Nyquist). */
    private frequencyWindow(result: PairSpectrumResultMessage): NormalizedRange {
        const visible = this.visibleFrequencyHz(result);
        const max = result.maxFrequencyHz || 1;
        const start = Math.max(0, Math.min(1, visible.frequencyMin / max)), end = Math.max(0, Math.min(1, visible.frequencyMax / max));
        return end > start ? { start, end } : FULL_PLOT_WINDOW.x;
    }

    /** The frequency at a point across a plot (CSS pixels from its left), on the frequency axis now on screen. */
    private frequencyAtX(key: PairLaneKey, x: number): number | null {
        const drawn = this.drawn.get(key), result = this.result;
        if (!drawn?.plot || !result) return null;
        const window = this.frequencyWindow(result);
        const fraction = (x - drawn.plot.frame.left) / Math.max(1, drawn.plot.frame.width);
        return (window.start + fraction * (window.end - window.start)) * result.maxFrequencyHz;
    }

    /** The cursor: the plot under the pointer reads its point and the others follow its frequency; with the pointer
     *  on the power spectrum, every plot follows the frequency read there (R7, R8). */
    private showMarks(): void {
        const marks = this.marks, result = this.result;
        if (!marks) return;
        const lineAt = (hz: number | null, except?: PairLaneKey): void => {
            for (const key of PAIR_LANES) {
                if (key === except) continue;
                const drawn = this.drawn.get(key);
                const x = hz === null || !result || !drawn?.plot ? null : this.xOfFrequency(key, hz);
                if (x === null || !drawn) marks.get(key)?.hide();
                else marks.get(key)?.line(drawn.canvas, drawn.plot, drawn.canvas.getBoundingClientRect().left + x);
            }
        };
        const pointer = this.pointer;
        const drawn = pointer ? this.drawn.get(pointer.lane) : undefined;
        if (pointer && drawn && result) {
            const slot = this.doc.getElementById('pair-spectrum-readout');
            // The others first: the plot under the pointer then fills the readout row.
            lineAt(null, pointer.lane);
            const x = marks.get(pointer.lane)?.show(drawn.canvas, drawn.plot, pointer.clientX, pointer.clientY, slot) ?? null;
            this.readHz = x === null ? null : this.frequencyAtX(pointer.lane, x);
            if (this.readHz !== null) lineAt(this.readHz, pointer.lane);
            return;
        }
        this.readHz = null;
        // A cursor that only follows the power spectrum is dropped past the reference's Nyquist rather than pinned to the last bin.
        const synced = result ? this.host.hoverFrequencyHz() : null;
        const halfBin = result ? result.maxFrequencyHz / Math.max(result.frequencyBins - 1, 1) / 2 : 0;
        lineAt(synced !== null && result && synced <= result.maxFrequencyHz + halfBin ? synced : null);
    }

    private xOfFrequency(key: PairLaneKey, hz: number): number | null {
        const drawn = this.drawn.get(key), result = this.result;
        if (!drawn?.plot || !result) return null;
        const window = this.frequencyWindow(result);
        const fraction = (hz / (result.maxFrequencyHz || 1) - window.start) / Math.max(1e-9, window.end - window.start);
        if (fraction < 0 || fraction > 1) return null;
        return drawn.plot.frame.left + fraction * drawn.plot.frame.width;
    }

    private visibleFrequencyHz(result: PairSpectrumResultMessage): FrequencyScale {
        return this.host.visibleFrequencyHz() ?? { frequencyMin: 0, frequencyMax: result.maxFrequencyHz };
    }

    private syncHostHover(): void {
        const result = this.result;
        // The power spectrum follows the point the pair cursor reads (R7), not the pointer beside it.
        const frequencyHz = result && this.pointer
            ? this.readHz ?? this.frequencyAtX(this.pointer.lane, this.pointer.clientX - (this.drawn.get(this.pointer.lane)?.canvas.getBoundingClientRect().left ?? 0)) : null;
        // The power spectrum may reach past the reference's Nyquist, where the pair cursor stops at its last bin.
        this.host.onHoverFrequency(frequencyHz === null || !result ? null : Math.min(frequencyHz, result.maxFrequencyHz));
    }

    /** The plots' gestures (the plot component's, R9) and the divider drag; call again after the spectrum section is rebuilt. */
    attach(): void {
        const plotsEl = this.doc.getElementById('pair-spectrum-plot');
        if (plotsEl) {
            this.marks = new Map(PAIR_LANES.map(key => [key, createPlotHoverLayer(this.doc, 'pair-cursor')]));
            const laneOf = (element: Element): PairLaneKey => (element.getAttribute('data-pair-lane') ?? 'gain') as PairLaneKey;
            attachPlotInteraction(plotsEl, this.doc, '[data-pair-lane]', {
                locate: (target, clientX, clientY) => {
                    const plot = (target as Element | null)?.closest?.<HTMLElement>('[data-pair-lane]');
                    // A plot still waiting for its result takes the pointer too, so it reads once the result arrives.
                    if (!plot || (this.result && !this.drawn.get(laneOf(plot))?.plot)) return null;
                    const { fx, fy, axis } = stagePlotPoint(plot, clientX, clientY);
                    return { plot, point: { fx, fy }, axis };
                },
                pointOn: (plot, clientX, clientY) => { const { fx, fy } = stagePlotPoint(plot, clientX, clientY); return { fx, fy }; },
                window: plot => ({ x: this.result ? this.frequencyWindow(this.result) : FULL_PLOT_WINDOW.x, y: this.levelWindow.get(laneOf(plot)) ?? FULL_PLOT_WINDOW.y }),
                setWindow: (plot, next: PlotWindow | null) => {
                    if (!this.result) return;
                    const max = this.result.maxFrequencyHz;
                    if (!next) {
                        this.levelWindow.clear();
                        this.host.setFrequencyWindowHz(null);
                    }
                    else {
                        const key = laneOf(plot);
                        if (next.y.start <= 0 && next.y.end >= 1) this.levelWindow.delete(key);
                        else this.levelWindow.set(key, next.y);
                        this.host.setFrequencyWindowHz({ min: next.x.start * max, max: next.x.end * max });
                    }
                    this.render();
                },
                hover: (event, hit) => {
                    this.pointer = hit && !hit.axis ? { lane: laneOf(hit.plot), clientX: event.clientX, clientY: event.clientY } : null;
                    this.showMarks();
                    if (this.pointer) this.syncHostHover();
                    else this.host.onHoverFrequency(null);
                },
                clearHover: () => {
                    this.pointer = null;
                    this.showMarks();
                    this.host.onHoverFrequency(null);
                },
                showBox: (plot, from, to) => {
                    const box = this.zoomBox();
                    const rect = plot.getBoundingClientRect(), frame = this.drawn.get(laneOf(plot))?.plot?.frame;
                    if (!frame) return;
                    const [x0, x1] = [Math.min(from.fx, to.fx), Math.max(from.fx, to.fx)], [y0, y1] = [Math.min(from.fy, to.fy), Math.max(from.fy, to.fy)];
                    Object.assign(box.style, { left: `${rect.left + frame.left + x0 * frame.width}px`, top: `${rect.top + frame.top + (1 - y1) * frame.height}px`, width: `${(x1 - x0) * frame.width}px`, height: `${(y1 - y0) * frame.height}px` });
                    box.hidden = false;
                },
                hideBox: () => { this.zoomBox().hidden = true; },
                openAxisRange: (hit, clientX, clientY) => {
                    if (hit.axis === 'x') { this.host.openFrequencyRange(clientX, clientY); return true; }
                    const key = laneOf(hit.plot), drawn = this.drawn.get(key);
                    if (!drawn) return false;
                    this.host.openLevelRange({
                        label: drawn.label, min: drawn.range.min, max: drawn.range.max, current: this.levelWindow.get(key) ?? FULL_PLOT_WINDOW.y, clientX, clientY,
                        set: part => { if (part) this.levelWindow.set(key, part); else this.levelWindow.delete(key); this.render(); },
                    });
                    return true;
                },
            });
        }
        const divider = this.doc.getElementById('pair-divider');
        const split = this.doc.getElementById('spectrum-split');
        divider?.addEventListener('pointerdown', event => {
            if (!split || event.button !== 0) {
                return;
            }
            event.preventDefault();
            const body = this.doc.body;
            body.classList.add('is-pair-resizing');
            const move = (moveEvent: PointerEvent) => {
                const rect = split.getBoundingClientRect();
                if (rect.width > 0) {
                    this.setSplit((moveEvent.clientX - rect.left) / rect.width);
                }
            };
            const up = () => {
                body.classList.remove('is-pair-resizing');
                this.doc.removeEventListener('pointermove', move);
                this.doc.removeEventListener('pointerup', up);
                this.doc.removeEventListener('pointercancel', up);
            };
            this.doc.addEventListener('pointermove', move);
            this.doc.addEventListener('pointerup', up);
            this.doc.addEventListener('pointercancel', up);
        });
    }

    /** The box being dragged on a pair plot, as Compare's plots draw theirs. */
    private zoomBox(): HTMLElement {
        let box = this.doc.getElementById('pair-zoom-box');
        if (!box) {
            box = this.doc.createElement('div');
            box.id = 'pair-zoom-box';
            box.className = 'compare-zoom-box';
            box.hidden = true;
            this.doc.body.append(box);
        }
        return box;
    }

    dispose(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
