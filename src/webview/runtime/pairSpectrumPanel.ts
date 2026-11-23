import { answerKey, createAnswerStore, type AnswerKey } from './answerStore';
import type { PairSpectrumRequest } from '../../shared/utils/audioTarget';
import type { HostInboundMessage } from './hostMessaging';
import { pairHeader, pairLegendHtml, syncReferenceButtons, type PairAnswersMessage, type PairCurve, type PairReference, type PairStrings } from './pairSpectrum';
import { cursorLineId } from '../charts/cursorSpectrum';
import { pairLineId, pairLineOf, pairSpectrum, type PairSpectrumLine } from '../charts/pairSpectrum';
import type { AcrossRange, SettingsRange, TracksFigureDeps, TracksFigurePaint, TracksFigureScreen } from '../screens/tracksFigure';
import type { FigureInspection } from '../figure/index';
import type { TrackId } from './types';
import { HostRequests } from './hostRequests';

/** One visible channel lane, in display order. */
export interface PairChannelSource {
    trackId: TrackId;
    filePath: string;
    /** The version of the file the track was analysed from: part of the request, so of its answer's key. */
    sourceVersion: string | undefined;
    /** The calibration the track was analysed under: part of the answer's key (not of the request, which the host calibrates). */
    calibrationSignature?: string;
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
    /** Makes the pair figure's screen in `host` (screens/tracksFigure.ts): the Figure's answers and words are the page's. */
    figure(deps: Pick<TracksFigureDeps, 'host' | 'readout' | 'empty' | 'ranged' | 'read' | 'drawn' | 'letGo'>): TracksFigureScreen;
    /** The range the display settings give across (the top frequency, shared with the power spectrum). */
    settingsRange(): SettingsRange;
    /** The range across was set on the pair figure, or taken back (null ends): the power spectrum shares it (R8). */
    onRanged(x: AcrossRange): void;
    /** The frequency the pair figure's pointer or keys read, or none: the power spectrum marks it (R7). */
    onRead(frequencyHz: number | null): void;
    /** The pair figure drew a picture, or could draw none. */
    onDrawn(): void;
    /** The plot height the power spectrum next to it has. */
    plotHeight(): number;
    onReferenceChange(reference: PairReference | null): void;
    /** The split moved, so the power spectrum next to it needs repainting. */
    onLayoutChange(): void;
}

export const PAIR_REQUEST_DELAY_MS = 150;

/** A pair request's answer key: the request as it is sent (its analysis, settings, sources, offsets and range). */
const pairKey = (request: string): AnswerKey => answerKey({ ask: request, version: { by: 'request' } });

/** How the pair figure's frequency axis is drawn: linear from 0 Hz, as the power spectrum's FFT lines are. */
const PAIR_AXIS = 'linear' as const;
export const PAIR_SPLIT_MIN = 0.25;
export const PAIR_SPLIT_MAX = 0.75;

/**
 * The pair view next to the power spectrum: which lane is the reference, the request for its responses' kept lines,
 * and what is said beside the figure (the summary, the legend, why there is no figure). The figure itself is a Figure
 * (screens/tracksFigure.ts) of the spec charts/pairSpectrum.ts makes of the answers' keys: this panel draws, counts
 * and reads nothing. A request goes out only when the sources or the range change, so moving the cursor never
 * recomputes.
 */
export class PairSpectrumPanel {
    private referenceState: PairReference | null = null;
    private observedKey: string | null = null;
    /** The responses' kept lines asked for ('pair'), as every on-demand request is kept. */
    private readonly requests = new HostRequests<undefined>();
    /** The answers, by the request (its sources, offsets, range, settings) each answered; a failed one is asked again after the store's pause. */
    private readonly answers = createAnswerStore<PairAnswersMessage>({ capacity: 4, retried: () => this.schedule(0) });
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** The figure, in the element it was made for (the results pane may be built again). */
    private made: { host: HTMLElement; screen: TracksFigureScreen } | null = null;
    /** The range across the power spectrum shares with this figure, and the frequency it reads: kept for a figure made later. */
    private acrossNow: AcrossRange = [null, null];
    private followed: number | null = null;
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
        this.referenceState = next;
        this.observedKey = null;
        this.requests.drop('pair');
        this.answers.clear();
        // A closed pane's figure is taken away (it tells the power spectrum it reads nothing: screens/tracksFigure.ts).
        if (!next) this.made?.screen.hide();
        this.doc.getElementById('spectrum-section')?.classList.toggle('has-pair', next !== null);
        this.applySplit();
        syncReferenceButtons(this.doc, next, this.strings);
        this.host.onReferenceChange(next);
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

    /** The reply shown names kept lines the backend holds no more: it is forgotten and the pair is asked again. */
    private askAgain(): void {
        const asked = this.requestNow();
        if (!asked || this.answers.value(pairKey(asked.key)) === undefined) return;
        this.answers.forget(pairKey(asked.key));
        this.requestIfChanged();
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
            this.requests.drop('pair');
            this.answers.clear();
            this.render();
            return;
        }
        const asked = this.requestNow();
        if (!asked) {
            return;
        }
        const { request, key } = asked;
        // A request superseded on its way is never answered: it is asked anew if it is wanted again.
        const superseded = this.requests.pending('pair');
        if (superseded && superseded.key !== key) this.answers.forget(pairKey(superseded.key));
        if (!this.answers.ask(pairKey(key))) {
            return;
        }
        this.requests.ask('pair', this.host.nextRequestId(), key, undefined, ({ requestId }) => this.host.post({ ...request, requestId }));
        this.render();
    }

    /**
     * The request the sources, their offsets, the range and the settings ask for now, and its key; null without a
     * reference lane or responses. An answer is shown only while it answers this very request.
     */
    private requestNow(): { request: Omit<PairSpectrumRequest, 'requestId'>; key: string } | null {
        const sources = this.sources();
        if (!sources || sources.responses.length === 0) return null;
        const ref = (source: PairChannelSource) => ({ filePath: source.filePath, sourceVersion: source.sourceVersion, channelIndex: source.channelIndex, offsetSeconds: source.offsetSeconds });
        const range = this.host.range();
        const request: Omit<PairSpectrumRequest, 'requestId'> = {
            type: 'request-pair-spectrum',
            analysisId: this.host.analysisId(),
            settingsSignature: this.host.settingsSignature(),
            reference: ref(sources.reference),
            responses: sources.responses.map(ref),
            ...(range ? { startSeconds: range.startSeconds, endSeconds: range.endSeconds } : {}),
            answers: PAIR_AXIS,
        };
        // The key holds each source's file version (in the request) and calibration: an answer of either before is not this one.
        return { request, key: JSON.stringify({ request, calibration: [sources.reference, ...sources.responses].map(source => source.calibrationSignature ?? '') }) };
    }

    /**
     * The answer to what is asked now: one computed for other sources, offsets, a range or settings since changed is
     * not drawn or read under today's names (R7: no numbers until they arrive), while its successor is waited for.
     */
    private current(): { result: PairAnswersMessage | null; error: string | null } | null {
        const asked = this.requestNow();
        if (!asked) return null;
        const key = pairKey(asked.key);
        const result = this.answers.value(key);
        if (result) return { result, error: null };
        const error = this.answers.reason(key);
        return error !== undefined ? { result: null, error } : null;
    }

    private get result(): PairAnswersMessage | null {
        return this.current()?.result ?? null;
    }

    private get error(): string | null {
        return this.current()?.error ?? null;
    }

    /** Returns whether the message belonged to the pair view. */
    handleMessage(message: HostInboundMessage): boolean {
        if (message.type !== 'pair-answers-result' && message.type !== 'pair-spectrum-error') {
            return false;
        }
        const request = this.requests.answering('pair', message.requestId);
        if (!request || message.analysisId !== this.host.analysisId()) {
            return true;
        }
        this.requests.settle(message.requestId);
        // The answer is to the request last asked (requests.answering): that request's key.
        if (message.type === 'pair-spectrum-error') {
            // A passing failure does not stay: once the store's pause is over the request is asked again (its retried).
            // A file changed since its track was analysed is no passing failure: it stands until the tracks are analysed again.
            this.answers.fail(pairKey(request.key), message.error, message.staleSource);
        } else {
            this.answers.ready(pairKey(request.key), message);
        }
        this.render();
        return true;
    }

    get waiting(): boolean {
        return this.requests.pending('pair') !== undefined;
    }

    get lastResult(): PairAnswersMessage | null {
        return this.result;
    }

    curves(): PairCurve[] {
        const result = this.result;
        const sources = this.sources();
        if (!result || !sources) {
            return [];
        }
        // The gain lines the Figure drew: one the figure service left off the gain axis is not among them.
        const gain = this.made?.screen.inspect()?.lanes.find(lane => lane.id === 'gain')?.lines.map(line => line.id);
        // Hosts give every listed source its own path, so a path and channel name one lane.
        return result.responses.flatMap(response => {
            const source = sources.responses.find(channel => channel.filePath === response.filePath && channel.channelIndex === response.channelIndex);
            if (!source) {
                return [];
            }
            const id = cursorLineId(source.trackId, source.channelIndex);
            const drawn = !!response.keys && (!gain?.length || gain.includes(pairLineId('gain', id)));
            return [{ id, label: source.label, color: source.color, response, drawn }];
        });
    }

    /** The figure's screen in the pane's element now; none while the pane is not built. */
    private screen(): TracksFigureScreen | null {
        const host = this.doc.getElementById('pair-spectrum-figure');
        if (!host) {
            this.made?.screen.hide();
            this.made = null;
            return null;
        }
        if (this.made?.host !== host) {
            this.made?.screen.hide();
            const readout = this.doc.getElementById('pair-spectrum-readout');
            const screen = this.host.figure({
                host,
                ...(readout ? { readout } : {}),
                // Why there is no figure is said by the pane's message (waiting, failed, no other channel).
                empty: () => undefined,
                ranged: x => { this.acrossNow = x; this.host.onRanged(x); },
                read: hz => this.host.onRead(hz),
                drawn: () => { this.writeHeader(this.curves()); this.host.onDrawn(); },
                // The backend let a kept line go (its store made room): the reply naming it is of nothing, so it is
                // forgotten and the pair is asked again.
                letGo: () => this.askAgain(),
            });
            screen.across(this.acrossNow);
            screen.follow(this.followed);
            this.made = { host, screen };
        }
        return this.made.screen;
    }

    /** The power spectrum's range across changed: this figure shares it (R8). */
    across(x: AcrossRange): void {
        this.acrossNow = x;
        this.made?.screen.across(x);
    }

    /** The frequency the power spectrum reads, or none: this figure marks it on every lane (R7). */
    follow(frequencyHz: number | null): void {
        this.followed = frequencyHz;
        this.made?.screen.follow(frequencyHz);
    }

    /** What the pair figure drew and reads now, for tests. */
    inspect(): FigureInspection | null {
        return this.made?.screen.inspect() ?? null;
    }

    /** What the lines are called and coloured: their channel's lane's name and its track's colour. */
    private paint(curves: readonly PairCurve[]): TracksFigurePaint {
        const of = (line: string): PairCurve | undefined => { const named = pairLineOf(line); return named ? curves.find(curve => curve.id === named.channel) : undefined; };
        return { name: line => of(line)?.label ?? line, colour: line => of(line)?.color ?? '#7f7f7f' };
    }

    /** The summary (how many averages, over which seconds) and the legend, of the responses on the gain axis. */
    private writeHeader(curves: readonly PairCurve[]): void {
        const summary = this.doc.getElementById('pair-spectrum-summary');
        const legend = this.doc.getElementById('pair-spectrum-legend');
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
            const html = pairLegendHtml(curves, this.strings);
            if (legend.getAttribute('data-legend-key') !== html) {
                legend.setAttribute('data-legend-key', html);
                legend.innerHTML = html;
            }
        }
    }

    render(): void {
        syncReferenceButtons(this.doc, this.referenceState, this.strings);
        if (!this.referenceState) {
            return;
        }
        const message = this.doc.getElementById('pair-spectrum-message');
        const plot = this.doc.getElementById('pair-spectrum-plot');
        if (!plot) {
            return;
        }
        const curves = this.curves();
        this.writeHeader(curves);
        const sources = this.sources();
        const text = this.error !== null ? this.strings.pairFailed.replace('{error}', this.error)
            : sources && sources.responses.length === 0 ? this.strings.pairNoResponses
                : !this.result ? this.strings.pairWaiting
                    : '';
        if (message) {
            message.textContent = text;
            message.style.display = text ? '' : 'none';
        }
        // The figure takes the power spectrum's height beside it.
        plot.style.height = `${this.host.plotHeight()}px`;
        const screen = this.screen();
        if (!screen) return;
        // A response with lines is a line on each lane, in the order of the rows; with none the figure is taken away
        // (R7: no numbers of other sources, offsets, a range or settings while their successor is waited for).
        const lines: PairSpectrumLine[] = text ? [] : curves.flatMap(curve => (curve.response.keys ? [{ id: curve.id, keys: curve.response.keys, calibrated: curve.response.calibrationStatus === 'calibrated' }] : []));
        const spec = pairSpectrum(lines);
        if (!spec) screen.hide();
        else screen.show(spec, this.paint(curves), this.host.settingsRange());
    }

    /** The divider drag; call again after the spectrum section is rebuilt. (The figure's gestures are the Figure's own.) */
    attach(): void {
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

    dispose(): void {
        this.made?.screen.hide();
        this.made = null;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
