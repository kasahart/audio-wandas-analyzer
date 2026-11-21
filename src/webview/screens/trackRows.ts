/**
 * The Tracks screen's rows on the Figure path (figure-design.md 第 4 節 screens/):
 * every channel of every recording in view is one Figure (screens/trackRowFigure.ts), and this module is what links
 * them. It asks the host for each recording's kept answers (the backend's `track-answers`: keys, no value), declares
 * each channel's spec from them (charts/trackRow.ts), and hands each Figure the range the Tracks screen is at.
 *
 * What the rows share is the Tracks screen's, handed in and told back through `TrackRowsDeps`: the time on screen
 * (each recording's own seconds: the screen places a recording on its shared time axis), the ranges up and of the
 * colours, the cursor, the loop and a recording's offset. Nothing here is made of an answer: this module holds keys
 * and a few words of each reply (the STFT's sizes, which say when a zoom needs its own STFT), never a sample or a
 * level.
 *
 * Answers. A recording's whole-file answers are asked once under what they are of (`asked`: the analysis, the
 * settings, the file's version, whether the rows show a spectrogram). With the automatic STFT settings a zoomed row
 * asks for the window on screen as well (R3: the window's own STFT, finer than the whole file's frames), and shows
 * it once it is in and while it still serves the view (`serves`); until then, and after a pan past it, the whole
 * file's levels stay drawn. The widest picture of the whole file's levels a row has drawn stays under whatever it
 * draws (the Figure's `imageUnder`), so a row scrolled past its picture shows those, coarser, and never an empty plot. A failed asking is asked again after a pause, and at once when what it is of changes.
 */
import type { FigureAnswers } from '../answers/figureRequests';
import { trackRow, TRACK_SPECTROGRAM_LANE, TRACK_WAVE_LANE, type TrackRowAnswers, type TrackRowLinked } from '../charts/trackRow';
import type { FigureInspection, FigurePlacedLane, FigureSpec, FigureTypedAxis,FigureView, FigureWords } from '../figure/index';
import { createTrackRowFigure, type TrackRowFigureScreen } from './trackRowFigure';

type Ends = readonly [number | null, number | null];

/** A recording's row as the Tracks screen has it now. */
export interface TrackRowsTrack {
    /** The track's id (the same while the track lives) and its index on the protocol. */
    id: string;
    index: number;
    filePath: string;
    sourceVersion: string | undefined;
    channels: number;
    colour: string;
    /** What the readout calls a channel, and its canvas's accessible name (the file, the channel, what the canvas shows). */
    name(channel: number): string;
    label(channel: number): string;
    /** Whether a channel is calibrated (R4: its axes say when it is not); left out where the screen does not know. */
    calibrated?(channel: number): boolean;
    /** The time on screen, in the recording's own seconds (before 0 and past its end where the row shows none of it). */
    window: readonly [number, number];
    durationSeconds: number;
    /** The file changed since it was analysed: what is kept of it stays drawn and is never read (R7). */
    changed?: boolean;
}

/** A reply's words kept beside its keys: what its STFT is, so the screen knows when a zoom needs its own. */
export interface TrackRowsReply {
    /** `signalExtent`, `imageExtent`: the keys of the channel's extents, which the other rows' lanes share their scale with. */
    channels: ReadonlyArray<TrackRowAnswers & { channelIndex: number; signalExtent?: string; imageExtent?: string }>;
    sampleRateHz: number;
    durationSeconds: number;
    windowSize: number;
    hopSize: number;
    windowed: boolean;
    /** Why no channel names levels though they were asked for: the recording is shorter than half the STFT's window. */
    noLevels?: 'too-short';
    /** The time window the levels are of (fractions of the file); absent: the whole file. */
    startNorm?: number;
    endNorm?: number;
}

/**
 * Why a row, or one lane of it, draws nothing: its answers are on their way; the asking failed; the answer is over
 * what the backend keeps; the recording is shorter than the STFT's window.
 */
export type TrackRowSaid = 'pending' | 'failed' | 'too-large' | 'too-short';

/** What the screen posts to the host: a `request-track-detail` with `answers`. */
export interface TrackRowsRequest {
    type: 'request-track-detail';
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    trackIndex: number;
    filePath: string;
    sourceVersion: string | undefined;
    answers: 'linear';
    spectrogram?: false;
    /** The whole file's extents alone, for the linked scale (a recording that is not on screen). */
    extents?: true;
    startNorm?: number;
    endNorm?: number;
}

/** A recording whose rows share their scales with the others' (Link scales), on screen or not. */
export type TrackRowsLinkedTrack = Pick<TrackRowsTrack, 'id' | 'index' | 'filePath' | 'sourceVersion'>;

/** The host's answer to one: the kept answers' keys, or why there are none. */
export type TrackRowsMessage =
    | ({ type: 'track-answers-result'; requestId: string } & TrackRowsReply)
    | { type: 'track-detail-error'; requestId: string; error: string };

export interface TrackRowsDeps {
    document: Document;
    answers: FigureAnswers;
    words: FigureWords;
    ResizeObserver?: typeof ResizeObserver;
    /** The rows' axis column (CSS px) and the split between a row's two lanes. */
    axisWidth: number;
    laneGap: number;
    /** Where a channel's Figure goes; null while its row is not built. */
    host(track: TrackRowsTrack, channel: number): HTMLElement | null;
    /** The page's readout (R7). */
    readout(): HTMLElement | null;
    /** The lanes' heights (CSS px); `spec` 0: the rows show no spectrogram. */
    heights(): { wave: number; spec: number };
    /** What the answers are asked under: the analysis and the settings. */
    analysisId(): string;
    settingsSignature(): string;
    requestId(track: TrackRowsLinkedTrack): string;
    post(request: TrackRowsRequest): void;
    /**
     * The window (fractions of the file) a zoomed row asks its own STFT for, at this plot width; null where the whole
     * file's frames serve (or the STFT settings are set by hand: the whole file's STFT whatever the zoom).
     */
    zoomWindow(track: TrackRowsTrack, whole: TrackRowsReply, width: number): { startNorm: number; endNorm: number } | null;
    /** Whether a window's answers (null: the whole file's) still serve the view at this plot width. */
    serves(track: TrackRowsTrack, whole: TrackRowsReply, window: { startNorm: number; endNorm: number } | null, width: number): boolean;
    /** The ranges the screen is at: up the waveform, up the spectrogram (Hz), of the colours (dB). */
    ranges(track: TrackRowsTrack, channel: number): { amplitude: Ends; frequency: Ends; colour: Ends };
    /**
     * The recordings whose rows share their scales now (Link scales): every one displayed, on screen or not; null
     * while each row has its own.
     */
    linked?(): readonly TrackRowsLinkedTrack[] | null;
    /**
     * What a row says where it draws nothing: on its way, or why not. `lane`: one lane alone draws nothing (the other
     * is drawn), and the words go in its place; without it they are the whole row's.
     */
    says(track: TrackRowsTrack, channel: number, state: TrackRowSaid | null, reason?: string, lane?: typeof TRACK_WAVE_LANE | typeof TRACK_SPECTROGRAM_LANE): void;
    viewed(track: TrackRowsTrack, channel: number, view: FigureView, typed?: FigureTypedAxis): void;
    placed(track: TrackRowsTrack, seconds: number): (() => void) | void;
    ranged(track: TrackRowsTrack, from: number, to: number): (() => void) | void;
    shifted(track: TrackRowsTrack, by: number | null, done: boolean): void;
    read(track: TrackRowsTrack, channel: number, seconds: number | null): void;
    reset(): void;
    hint?: (where: 'plot' | 'axis' | 'colour' | null) => void;
    /** A row's lanes were drawn at these places: the screen's layer over them (the cursor, the loop) follows. */
    lanes(track: TrackRowsTrack, channel: number, lanes: readonly FigurePlacedLane[]): void;
    drawn(): void;
    /**
     * The pause after a failed asking, by recording: the answer store's (runtime/answerStore.ts createFailureHold),
     * the one rule every failed answer is asked again by. The rows keep no time of their own: whoever makes the hold
     * has the rows shown again once a pause is over, and that showing asks.
     */
    failures: TrackRowsFailures;
}

/** What the rows use of the answer store's failure hold. `condition`: what the answers were asked under. */
export interface TrackRowsFailures {
    fail(subject: string, condition?: string): void;
    holds(subject: string, condition?: string): boolean;
    clear(subject?: string): void;
}

export interface TrackRows {
    /** Shows these rows (those in view): each asks what it lacks and is drawn from what is kept. The others' Figures are taken away. */
    show(tracks: readonly TrackRowsTrack[]): void;
    /** A host message: true when it answered an asking of the rows. */
    handle(message: TrackRowsMessage | { type: string; requestId?: unknown }): boolean;
    /** Marks the time another row reads on every row but that one; `seconds` by track id (the recording's own time). */
    follow(times: ReadonlyMap<string, number> | null, but?: { track: string; channel: number }): void;
    /** + / − / 0 with the pointer on no plot: the first row's Figure takes it. */
    zoomKey(action: 'in' | 'out' | 'reset'): boolean;
    /** Takes every Figure away and forgets every answer (the rows are not on screen). */
    hide(): void;
    /** Whether a row shown waits for something to draw: its answers, or its Figure's picture (an export waits for it). */
    busy(): boolean;
    /** What a channel's Figure drew, for tests; null without one. */
    inspect(trackId: string, channel: number): FigureInspection | null;
    /** What a recording's rows are drawn from now, for tests. */
    held(trackId: string): { whole: TrackRowsReply | null; zoom: TrackRowsReply | null; pending: number } | null;
}

interface Asking { requestId: string; of: string; window: { startNorm: number; endNorm: number } | null }
interface Held {
    /** What the whole file's answers were asked under. */
    of: string;
    /** What its extents are of (`scaleOfNow`), and whether the answers were asked with the levels (the rows show a spectrogram). */
    scaleOf: string;
    levels: boolean;
    whole: TrackRowsReply | null;
    zoom: TrackRowsReply | null;
    asking: Asking[];
    failed: { of: string; reason: string } | null;
    /** How often the answers the store let go were asked again with no showing from outside in between (LET_GO_SHOWS). */
    again: number;
}

/**
 * A linked recording's extents: the keys the rows' lanes share their scales with (the backend's `signalExtent`,
 * `imageExtent`: a few bytes a channel, kept apart from the samples and levels, so every recording is counted
 * whether its rows are on screen or not, and whether its own answers are still kept or not).
 */
interface Scale {
    /** What they are of: the analysis, the settings, the file as read. */
    of: string;
    channels: Map<number, { signal?: string; image?: string }>;
    /** What an answer has told so far: the samples' extents, the levels'. */
    samples: boolean;
    levels: boolean;
    /** The asking for them on its way. */
    asking: { requestId: string; levels: boolean } | null;
}

/**
 * Over this many linked recordings, the levels' extents are those of the recordings whose rows were shown only: each
 * one's needs its whole STFT, and that many are not computed unasked (設計の決まり「暗黙の一括計算をしない」). The
 * samples' extents are asked of every recording whatever their number.
 */
const LINK_LEVELS_MOST = 30;
/** How many recordings' extents are on their way at a time: the rows on screen are not kept waiting behind them. */
const SCALE_ASKINGS = 2;

/**
 * How often a recording's rows are shown again by themselves for answers the backend's store let go. Recordings on
 * screen that do not fit the store together would take each other's place without end (each asking lets the other
 * go); past this the row waits for the next showing from outside (a gesture, a scroll), which counts from 0 again.
 */
const LET_GO_SHOWS = 2;

export function createTrackRows(deps: TrackRowsDeps): TrackRows {
    const held = new Map<string, Held>();
    /** `spec`: what the row was last drawn from (its answers, its linked scale): shown as stale while new answers are on their way. */
    const figures = new Map<string, { host: HTMLElement; screen: TrackRowFigureScreen; track: TrackRowsTrack; channel: number; spec: FigureSpec | null }>();
    const rowKey = (track: string, channel: number): string => `${track}\u0000${channel}`;
    const scales = new Map<string, Scale>();
    let shown: readonly TrackRowsTrack[] = [];

    const scaleOfNow = (track: TrackRowsLinkedTrack): string => JSON.stringify([deps.analysisId(), deps.settingsSignature(), track.filePath, track.sourceVersion ?? null]);
    const scaleFor = (track: TrackRowsLinkedTrack): Scale => {
        const of = scaleOfNow(track);
        let scale = scales.get(track.id);
        if (!scale || scale.of !== of) { scale = { of, channels: new Map(), samples: false, levels: false, asking: null }; scales.set(track.id, scale); }
        return scale;
    };
    /** An answer names a recording's extents (its own answers' reply does, as an asking for the extents alone). */
    const takeScale = (scale: Scale, reply: TrackRowsReply, levels: boolean): void => {
        for (const channel of reply.channels) {
            const had = scale.channels.get(channel.channelIndex) ?? {};
            scale.channels.set(channel.channelIndex, {
                ...had,
                ...(channel.signalExtent !== undefined ? { signal: channel.signalExtent } : {}),
                ...(channel.imageExtent !== undefined ? { image: channel.imageExtent } : {}),
            });
        }
        scale.samples = true;
        if (levels) scale.levels = true;
    };
    const scaleSubject = (trackId: string): string => `${trackId}\u0000scale`;

    const ofNow = (track: TrackRowsTrack): string =>
        JSON.stringify([deps.analysisId(), deps.settingsSignature(), track.filePath, track.sourceVersion ?? null, deps.heights().spec > 0]);
    const plotWidth = (track: TrackRowsTrack): number => {
        const host = deps.host(track, 0);
        return Math.max(1, (host?.clientWidth || 800) - deps.axisWidth);
    };
    /** Posts one asking of a recording (the one place: every asking names the analysis, the settings and the file's version). */
    const send = (track: TrackRowsLinkedTrack, levels: boolean, more: { startNorm: number; endNorm: number } | { extents: true } | null): string => {
        const requestId = deps.requestId(track);
        deps.post({
            type: 'request-track-detail', requestId, analysisId: deps.analysisId(), settingsSignature: deps.settingsSignature(),
            trackIndex: track.index, filePath: track.filePath, sourceVersion: track.sourceVersion, answers: 'linear',
            ...(levels ? {} : { spectrogram: false as const }),
            ...(more ?? {}),
        });
        return requestId;
    };
    const ask = (track: TrackRowsTrack, state: Held, window: { startNorm: number; endNorm: number } | null): void => {
        state.asking.push({ requestId: send(track, deps.heights().spec > 0, window), of: state.of, window });
    };
    /** What a recording's rows need that is neither kept nor on its way: asked. */
    const need = (track: TrackRowsTrack): Held => {
        const of = ofNow(track);
        let state = held.get(track.id);
        if (!state || state.of !== of) {
            // Another analysis, other settings, another version of the file: the answers before are of nothing now.
            state = { of, scaleOf: scaleOfNow(track), levels: deps.heights().spec > 0, whole: null, zoom: null, asking: [], failed: null, again: 0 };
            held.set(track.id, state);
        }
        const wholeOnWay = state.asking.some(asking => asking.of === of && !asking.window);
        const paused = deps.failures.holds(track.id, of);
        if (!state.whole && !wholeOnWay && !paused) ask(track, state, null);
        // (A recording with no levels at all, too short for the STFT, has no window's levels either.)
        if (state.whole && deps.heights().spec > 0 && state.whole.channels.some(item => item.image !== undefined)) {
            const width = plotWidth(track);
            const window = state.zoom && state.zoom.startNorm !== undefined && state.zoom.endNorm !== undefined ? { startNorm: state.zoom.startNorm, endNorm: state.zoom.endNorm } : null;
            const served = deps.serves(track, state.whole, null, width) || (window !== null && deps.serves(track, state.whole, window, width));
            const onWay = state.asking.find(asking => asking.of === of && asking.window);
            const wanted = served ? null : deps.zoomWindow(track, state.whole, width);
            // One window on its way at a time: the view may have moved on when it lands, and is asked again then.
            if (wanted && !onWay && !paused) ask(track, state, wanted);
        }
        return state;
    };
    /** The answers a channel is drawn from: the zoom window's levels while they serve the view, else the whole file's. */
    const answersOf = (track: TrackRowsTrack, state: Held, channel: number): TrackRowAnswers | null => {
        const whole = state.whole?.channels.find(item => item.channelIndex === channel);
        if (!state.whole || !whole) return null;
        const zoom = state.zoom?.channels.find(item => item.channelIndex === channel);
        const window = state.zoom && state.zoom.startNorm !== undefined && state.zoom.endNorm !== undefined ? { startNorm: state.zoom.startNorm, endNorm: state.zoom.endNorm } : null;
        const zoomed = zoom?.image !== undefined && window !== null && !deps.serves(track, state.whole, null, plotWidth(track)) && deps.serves(track, state.whole, window, plotWidth(track));
        const calibrated = track.calibrated?.(channel);
        return { ...(whole.signal !== undefined ? { signal: whole.signal } : {}), ...(zoomed ? { image: zoom.image } : whole.image !== undefined ? { image: whole.image } : {}), ...(calibrated === undefined ? {} : { calibrated }) };
    };
    const viewOf = (track: TrackRowsTrack, channel: number, lanes: readonly string[]): FigureView => {
        const ranges = deps.ranges(track, channel);
        const given = (ends: Ends): boolean => ends[0] !== null || ends[1] !== null;
        const out: NonNullable<FigureView['lanes']> = [];
        if (lanes.includes(TRACK_WAVE_LANE) && given(ranges.amplitude)) out.push({ lane: TRACK_WAVE_LANE, y: [...ranges.amplitude] });
        if (lanes.includes(TRACK_SPECTROGRAM_LANE) && (given(ranges.frequency) || given(ranges.colour))) {
            out.push({ lane: TRACK_SPECTROGRAM_LANE, y: [...ranges.frequency], ...(given(ranges.colour) ? { colour: [...ranges.colour] } : {}) });
        }
        return { x: [track.window[0], track.window[1]], ...(out.length ? { lanes: out } : {}) };
    };
    const figureFor = (track: TrackRowsTrack, channel: number, host: HTMLElement): TrackRowFigureScreen => {
        const key = rowKey(track.id, channel);
        const had = figures.get(key);
        if (had && had.host === host) { had.track = track; return had.screen; }
        had?.screen.hide();
        // The callbacks read the row as it is now (its window, its index): the entry is replaced on every showing.
        const now = (): TrackRowsTrack => figures.get(key)?.track ?? track;
        const readout = deps.readout();
        const screen = createTrackRowFigure({
            document: deps.document, host, answers: deps.answers, words: deps.words, label: track.label(channel),
            ...(readout ? { readout } : {}),
            ...(deps.ResizeObserver ? { ResizeObserver: deps.ResizeObserver } : {}),
            ...(deps.hint ? { hint: deps.hint } : {}),
            margin: { left: deps.axisWidth, right: 0 }, laneGap: deps.laneGap,
            laneHeights: () => { const heights = deps.heights(); return { [TRACK_WAVE_LANE]: heights.wave, [TRACK_SPECTROGRAM_LANE]: heights.spec }; },
            colour: () => now().colour, name: () => now().name(channel),
            viewed: (view, typed) => deps.viewed(now(), channel, view, typed),
            placed: seconds => deps.placed(now(), seconds),
            ranged: (from, to) => deps.ranged(now(), from, to),
            shifted: (by, done) => deps.shifted(now(), by, done),
            read: seconds => deps.read(now(), channel, seconds),
            reset: () => deps.reset(),
            lanes: lanes => deps.lanes(now(), channel, lanes),
            drawn: () => deps.drawn(),
            under: () => held.get(now().id)?.whole?.channels.find(item => item.channelIndex === channel)?.image,
            // The answer asked again has the same key: forgetting the reply asks it on the next showing, and the rows
            // are shown again for that once the Figure is done with this picture (nothing else would: the page may
            // be at rest, and the lane would stay empty until the next gesture).
            letGo: () => {
                const state = held.get(now().id);
                if (!state || (!state.whole && !state.zoom)) return;
                state.whole = null; state.zoom = null;
                if (state.again >= LET_GO_SHOWS) return;
                state.again += 1;
                void Promise.resolve().then(() => { if (shown.some(item => item.id === track.id)) showRows(shown); });
            },
        });
        figures.set(key, { host, screen, track, channel, spec: null });
        return screen;
    };
    const drop = (key: string): void => { figures.get(key)?.screen.hide(); figures.delete(key); };

    /**
     * The extents of every recording whose scales are linked, by key (in the recordings' order, a channel after
     * another), asking for those not told yet. The scale the rows share widens as they come in; at every moment every
     * row names the same ones, so the rows are on one scale throughout.
     */
    const linkedNow = (): TrackRowLinked | null => {
        const tracks = deps.linked?.() ?? null;
        if (!tracks) return null;
        const levels = deps.heights().spec > 0 && tracks.length <= LINK_LEVELS_MOST;
        let onWay = [...scales.values()].filter(scale => scale.asking).length;
        const signals: string[] = [], images: string[] = [];
        for (const track of tracks) {
            const scale = scaleFor(track);
            const own = held.get(track.id);
            // Its own answers name them: those kept (linked after they came in), or those on their way.
            if (own?.whole && own.scaleOf === scale.of && (!scale.samples || (own.levels && !scale.levels))) takeScale(scale, own.whole, own.levels);
            const ownOnWay = own !== undefined && own.scaleOf === scale.of && own.asking.some(asking => asking.of === own.of && !asking.window);
            const lacks = !scale.samples || (levels && !scale.levels);
            if (lacks && !scale.asking && !ownOnWay && onWay < SCALE_ASKINGS && !deps.failures.holds(scaleSubject(track.id), scale.of)) {
                scale.asking = { requestId: send(track, levels, { extents: true }), levels };
                onWay += 1;
            }
            for (const index of [...scale.channels.keys()].sort((a, b) => a - b)) {
                const channel = scale.channels.get(index);
                if (channel?.signal !== undefined) signals.push(channel.signal);
                if (channel?.image !== undefined) images.push(channel.image);
            }
        }
        // A recording no longer linked (closed, hidden) is forgotten.
        const ids = new Set(tracks.map(track => track.id));
        for (const id of [...scales.keys()]) if (!ids.has(id)) scales.delete(id);
        return { signals, images };
    };
    const showRows = (tracks: readonly TrackRowsTrack[]): void => {
        shown = tracks;
        const live = new Set<string>();
        // Every recording shown is asked before any is drawn: a row's linked scale names the others' answers.
        for (const track of tracks) need(track);
        const linked = linkedNow();
        for (const track of tracks) {
            const state = need(track);
            for (let channel = 0; channel < track.channels; channel += 1) {
                const key = rowKey(track.id, channel);
                const host = deps.host(track, channel);
                if (!host) continue;
                const answers = answersOf(track, state, channel);
                const heights = deps.heights();
                const spec = answers ? trackRow(answers, { waveform: heights.wave > 0, spectrogram: heights.spec > 0 }, track.changed === true, linked) : null;
                if (!spec) {
                    // Nothing kept to draw from: the Figure before stays while the answers are on their way (a
                    // setting changed), and the row says so; a refused answer (over the store's budget) has no key.
                    const failed = state.failed && state.failed.of === state.of ? state.failed : null;
                    deps.says(track, channel, failed ? 'failed' : state.whole ? (state.whole.noLevels === 'too-short' && heights.wave <= 0 ? 'too-short' : 'too-large') : 'pending', failed?.reason);
                    if (failed || state.whole) drop(key);
                    else if (figures.has(key)) {
                        live.add(key);
                        // The picture before stays, of the answers before: the very spec it was drawn from (a
                        // zoom window's levels, a linked scale: any other would be another picture, and one of
                        // stale answers is empty), every key told as stale, so nothing is read off it under the new
                        // settings (R7), and at the time the screen is at now.
                        const was = figures.get(key)?.spec ?? null;
                        const stale = was ? { ...was, keys: was.keys.map(item => ({ ...item, state: 'stale' as const })) } : null;
                        if (stale) figureFor(track, channel, host).show(stale, viewOf(track, channel, stale.lanes.map(lane => lane.id)));
                    }
                    continue;
                }
                live.add(key);
                // One lane alone has nothing to draw from: the other is drawn, and this one says why in its place.
                if (heights.spec > 0 && state.levels && answers?.image === undefined) deps.says(track, channel, state.whole?.noLevels === 'too-short' ? 'too-short' : 'too-large', undefined, TRACK_SPECTROGRAM_LANE);
                else if (heights.wave > 0 && answers?.signal === undefined) deps.says(track, channel, 'too-large', undefined, TRACK_WAVE_LANE);
                else deps.says(track, channel, null);
                figureFor(track, channel, host).show(spec, viewOf(track, channel, spec.lanes.map(lane => lane.id)));
                const entry = figures.get(key);
                if (entry) entry.spec = spec;
            }
        }
        for (const key of [...figures.keys()]) if (!live.has(key)) drop(key);
        // A recording no longer shown keeps its replies (it may scroll back); one no longer among the tracks is
        // forgotten when the screen hides the rows or its answers are asked under something else.
    };

    return {
        show(tracks) {
            for (const state of held.values()) state.again = 0;
            showRows(tracks);
        },
        handle(message) {
            if ((message.type !== 'track-answers-result' && message.type !== 'track-detail-error') || typeof message.requestId !== 'string') return false;
            for (const [trackId, scale] of scales) {
                if (scale.asking?.requestId !== message.requestId) continue;
                const { levels } = scale.asking;
                scale.asking = null;
                // Failed: asked again after the answer store's pause; the other recordings' extents are shared meanwhile.
                if (message.type === 'track-detail-error') deps.failures.fail(scaleSubject(trackId), scale.of);
                else takeScale(scale, message as Extract<TrackRowsMessage, { type: 'track-answers-result' }>, levels);
                showRows(shown);
                return true;
            }
            for (const [trackId, state] of held) {
                const at = state.asking.findIndex(asking => asking.requestId === message.requestId);
                if (at < 0) continue;
                const [asking] = state.asking.splice(at, 1);
                if (asking.of !== state.of) return true;
                if (message.type === 'track-detail-error') {
                    const { error } = message as Extract<TrackRowsMessage, { type: 'track-detail-error' }>;
                    // A window that failed leaves the whole file's levels drawn; it is asked again after the pause.
                    state.failed = { of: state.of, reason: error };
                    deps.failures.fail(trackId, state.of);
                } else {
                    const { type: _type, requestId: _id, ...reply } = message as Extract<TrackRowsMessage, { type: 'track-answers-result' }>;
                    if (asking.window) state.zoom = { ...reply, startNorm: asking.window.startNorm, endNorm: asking.window.endNorm };
                    else {
                        state.whole = reply; state.failed = null;
                        const scale = scales.get(trackId);
                        if (scale && scale.of === state.scaleOf) takeScale(scale, reply, state.levels);
                    }
                }
                if (shown.some(track => track.id === trackId)) showRows(shown);
                return true;
            }
            return false;
        },
        follow(times, but) {
            for (const entry of figures.values()) entry.screen.follow(times && !(but && entry.track.id === but.track && entry.channel === but.channel) ? times.get(entry.track.id) ?? null : null);
        },
        zoomKey(action) {
            const first = figures.values().next().value;
            return first ? first.screen.zoomKey(action) : false;
        },
        hide() {
            for (const key of [...figures.keys()]) drop(key);
            held.clear();
            scales.clear();
            deps.failures.clear();
            shown = [];
        },
        busy: () => shown.some(track => (held.get(track.id)?.asking.length ?? 0) > 0) || [...scales.values()].some(scale => scale.asking !== null) || [...figures.values()].some(entry => entry.screen.inspect()?.waiting === true),
        inspect: (trackId, channel) => figures.get(rowKey(trackId, channel))?.screen.inspect() ?? null,
        held(trackId) {
            const state = held.get(trackId);
            return state ? { whole: state.whole, zoom: state.zoom, pending: state.asking.length } : null;
        },
    };
}
