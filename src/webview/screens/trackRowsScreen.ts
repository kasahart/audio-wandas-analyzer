/**
 * The Tracks screen's rows on the Figure path, joined to the screen's own state.
 * The rows' Figures (screens/trackRows.ts) are in each recording's own seconds; the screen's state is one window of
 * time shared by every row (0–1 of all the tracks' span), one amplitude view, one frequency band and one colour range.
 * This module is the conversion between the two, and nothing else:
 *
 * - what a Figure asks for (a zoom, a pan, a typed range, a reset) written into the screen's state (`viewed`);
 * - a click's time, a stretch of time and a Shift+drag turned into the cursor, the loop and a recording's offset;
 * - the time one row reads marked on the others (each in its own seconds);
 * - where the Figure drew each row's lanes, handed to the screen's layer over the row (the lines that follow the
 *   cursor and the loop: painted by the screen itself, never a round trip to the figure service on a playback frame);
 * - what a row says while it draws nothing.
 *
 * It holds no answer, counts nothing of one and draws nothing.
 */
import { loopAfterDrag } from './loopDrag';
import type { FigureAnswers } from '../answers/figureRequests';
import { TRACK_SPECTROGRAM_LANE, TRACK_WAVE_LANE } from '../charts/trackRow';
import type { FigureInspection, FigurePlacedLane, FigureTypedAxis, FigureView, FigureWords } from '../figure/index';
import { createTrackRows, type TrackRowSaid, type TrackRowsFailures, type TrackRowsLinkedTrack, type TrackRowsMessage, type TrackRowsReply, type TrackRowsRequest, type TrackRowsTrack } from './trackRows';

type Ends = readonly [number | null, number | null];
/** A part of the screen's shared time (0–1 of all the tracks' span). */
export interface SharedTime { start: number; end: number }

/** A recording's row with its place on the screen's shared time. */
export interface ScreenRow extends TrackRowsTrack {
    /** Where the recording starts on the shared time (0–1 of all the tracks' span) and how much of it it takes. */
    start: number;
    length: number;
    /** The file changed since it was analysed: the row asks nothing more and says so where it draws nothing. */
    changed: boolean;
}

export interface TrackRowsScreenDeps {
    document: Document;
    answers: FigureAnswers;
    words: FigureWords;
    ResizeObserver?: typeof ResizeObserver;
    axisWidth: number;
    laneGap: number;
    /** A channel's box (trackLaneHtml.ts `.track-row-figure`): the Figure's host, with the layer and the words in it. */
    host: (trackIndex: number, channel: number) => HTMLElement | null;
    readout: () => HTMLElement | null;
    /** The rows to draw now, in the screen's order: those in view, none while the rows are not on screen. */
    rows: () => ScreenRow[];
    heights: () => { wave: number; spec: number };
    analysisId: () => string;
    settingsSignature: () => string;
    requestId: (row: { index: number }) => string;
    post: (request: TrackRowsRequest) => void;
    /** The window a zoomed row asks its own STFT for, and whether a window's answers still serve the view (screens/trackRows.ts). */
    zoomWindow: (track: TrackRowsTrack, whole: TrackRowsReply, width: number) => { startNorm: number; endNorm: number } | null;
    serves: (track: TrackRowsTrack, whole: TrackRowsReply, window: { startNorm: number; endNorm: number } | null, width: number) => boolean;
    /** The screen's state, as the rows are drawn: the shared time, and each row's ranges up and of the colours. */
    time: () => SharedTime;
    amplitude: (row: ScreenRow, channel: number) => Ends;
    frequency: (row: ScreenRow) => Ends;
    colour: (row: ScreenRow, channel: number) => Ends;
    /** The recordings whose rows share their automatic scales now (Link scales), in view or not; null while each has its own. */
    linked: () => readonly TrackRowsLinkedTrack[] | null;
    /** The screen's state, changed by a gesture on a row. `null`: back to the automatic range. */
    setTime: (range: SharedTime) => void;
    setAmplitude: (row: ScreenRow, channel: number, ends: Ends | null) => void;
    /** `typed`: the band was typed on the axis (a setting: kept across a new analysis), not zoomed into. */
    setFrequency: (row: ScreenRow, ends: Ends | null, typed: boolean) => void;
    setColour: (row: ScreenRow, channel: number, ends: Ends | null) => void;
    resetZoom: () => void;
    /** The cursor put at a time, the loop set to a stretch: each returns how to take it back. */
    seek: (norm: number) => () => void;
    loop: (start: number, end: number) => () => void;
    /** The loop there is now (null: none) and the part of the whole time on screen: a drag begun on an end of the loop moves that end. */
    loopNow: () => { start: number; end: number } | null;
    viewSpan: () => number;
    offset: (row: ScreenRow) => number;
    setOffset: (row: ScreenRow, seconds: number, done: boolean) => void;
    /** The time a row reads (null: none), for the screen's time display. */
    reads: (norm: number | null) => void;
    /** Paints a row's layer (what follows the cursor and the loop) over its lanes, at the frames the Figure drew them (CSS px in the row's box). */
    layer: (row: ScreenRow, channel: number, lanes: readonly FigurePlacedLane[]) => void;
    /** What a row says while it draws nothing. */
    says: (state: TrackRowSaid, reason: string | undefined, row: ScreenRow) => string;
    hint?: (where: 'plot' | 'axis' | 'colour' | null) => void;
    drawn: () => void;
    /** The rows' plots are another width now (`plotWidth`): the screen's time ruler above them follows. */
    widthChanged: () => void;
    /** The pause after a row's failed asking (trackRows.ts TrackRowsFailures): the answer store's hold. */
    failures: TrackRowsFailures;
}

export interface TrackRowsScreen {
    /** Draws the rows the screen has now (`rows`), each on the screen's state. */
    show(): void;
    /** Paints the layers again: the cursor or the loop moved, nothing else did. */
    marks(): void;
    /** A host message: true when it answered an asking of the rows. */
    handle(message: TrackRowsMessage | { type: string; requestId?: unknown }): boolean;
    /** How wide the rows' plots were drawn (CSS px; a spectrogram's colour bar takes room beside them); null before any was. */
    plotWidth(): number | null;
    /** Whether a row shown waits for its answers or its picture (an export of the rows waits for them). */
    busy(): boolean;
    inspect(trackId: string, channel: number): FigureInspection | null;
    /** What a recording's rows are drawn from now, for tests. */
    held(trackId: string): { whole: TrackRowsReply | null } | null;
}

/** The screen's window of time a Figure's ends across (the recording's seconds) ask for: panned past an end, it keeps its length. */
export function sharedTimeOf(row: Pick<ScreenRow, 'start' | 'length' | 'durationSeconds'>, x: Ends): SharedTime {
    const norm = (seconds: number): number => row.start + (seconds / row.durationSeconds) * row.length;
    let start = x[0] === null ? 0 : norm(x[0]), end = x[1] === null ? 1 : norm(x[1]);
    if (start < 0) { end = Math.min(1, end - start); start = 0; }
    if (end > 1) { start = Math.max(0, start - (end - 1)); end = 1; }
    return { start, end };
}

const same = (a: number | null, b: number | null): boolean => a === b || (a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
const sameEnds = (a: Ends, b: Ends): boolean => same(a[0], b[0]) && same(a[1], b[1]);
const given = (ends: Ends): boolean => ends[0] !== null || ends[1] !== null;
const NONE: Ends = [null, null];
const endsOf = (ends: readonly (number | null)[] | undefined): Ends => (ends ? [ends[0] ?? null, ends[1] ?? null] : NONE);

export function createTrackRowsScreen(deps: TrackRowsScreenDeps): TrackRowsScreen {
    let rows: ScreenRow[] = [];
    const placed = new Map<string, readonly FigurePlacedLane[]>();
    /** A recording's offset when its Shift+drag began. */
    const shifting = new Map<string, number>();
    let width: number | null = null;
    const key = (track: string, channel: number): string => `${track}\u0000${channel}`;
    const rowOf = (track: TrackRowsTrack): ScreenRow | null => rows.find(row => row.id === track.id) ?? null;
    const normOf = (row: ScreenRow, seconds: number): number => row.start + (seconds / row.durationSeconds) * row.length;
    const paint = (row: ScreenRow, channel: number): void => deps.layer(row, channel, placed.get(key(row.id, channel)) ?? []);
    const marks = (): void => { for (const row of rows) for (let channel = 0; channel < row.channels; channel += 1) paint(row, channel); };

    /** What a Figure asked for, written into the screen's state: only what differs from what the row was shown on. */
    const viewed = (track: TrackRowsTrack, channel: number, view: FigureView, typed?: FigureTypedAxis): void => {
        const row = rowOf(track);
        if (!row) return;
        const x = endsOf(view.x);
        const lanes = view.lanes ?? [];
        // No end specified anywhere: the Figure's reset (a double click, the 0 key) is the screen's.
        const typedBand = typed?.lane === TRACK_SPECTROGRAM_LANE && typed.axis === 'y';
        if (!given(x) && !lanes.length && !typed) { deps.resetZoom(); return; }
        const now = deps.time();
        const next = sharedTimeOf(row, x);
        if (next.end > next.start && !(same(next.start, now.start) && same(next.end, now.end))) deps.setTime(next);
        const wave = endsOf(lanes.find(lane => lane.lane === TRACK_WAVE_LANE)?.y);
        if (!sameEnds(wave, deps.amplitude(row, channel))) deps.setAmplitude(row, channel, given(wave) ? wave : null);
        const image = lanes.find(lane => lane.lane === TRACK_SPECTROGRAM_LANE);
        const band = endsOf(image?.y);
        if (typedBand || !sameEnds(band, deps.frequency(row))) deps.setFrequency(row, given(band) ? band : null, typedBand);
        const colour = endsOf(image?.colour);
        if (!sameEnds(colour, deps.colour(row, channel))) deps.setColour(row, channel, given(colour) ? colour : null);
    };

    const controller = createTrackRows({
        document: deps.document, answers: deps.answers, words: deps.words, axisWidth: deps.axisWidth, laneGap: deps.laneGap,
        ...(deps.ResizeObserver ? { ResizeObserver: deps.ResizeObserver } : {}),
        ...(deps.hint ? { hint: deps.hint } : {}),
        host: (track, channel) => deps.host(track.index, channel),
        readout: deps.readout, heights: deps.heights, analysisId: deps.analysisId, settingsSignature: deps.settingsSignature,
        requestId: track => deps.requestId(track),
        post: deps.post, failures: deps.failures, linked: deps.linked,
        zoomWindow: (track, whole, width) => (rowOf(track)?.changed ? null : deps.zoomWindow(track, whole, width)),
        serves: deps.serves,
        ranges: (track, channel) => {
            const row = rowOf(track);
            return row ? { amplitude: deps.amplitude(row, channel), frequency: deps.frequency(row), colour: deps.colour(row, channel) } : { amplitude: NONE, frequency: NONE, colour: NONE };
        },
        says: (track, channel, state, reason, lane) => {
            const row = rowOf(track);
            const words = row ? deps.host(row.index, channel)?.querySelector<HTMLElement>('.track-row-says') : null;
            if (!row || !words) return;
            words.hidden = state === null;
            words.textContent = state === null ? '' : deps.says(state, reason, row);
            // One lane's words lie over that lane (the waveform on top, the split, the spectrogram); the row's, over the box.
            const heights = deps.heights();
            const top = lane === TRACK_SPECTROGRAM_LANE && heights.wave > 0 ? heights.wave + deps.laneGap : 0;
            words.style.top = lane ? `${top}px` : '';
            words.style.bottom = lane ? 'auto' : '';
            words.style.height = lane ? `${lane === TRACK_WAVE_LANE ? heights.wave : heights.spec}px` : '';
        },
        viewed,
        placed: (track, seconds) => { const row = rowOf(track); return row ? deps.seek(normOf(row, seconds)) : undefined; },
        ranged: (track, from, to) => {
            const row = rowOf(track);
            if (!row) return undefined;
            const next = loopAfterDrag(deps.loopNow(), normOf(row, from), normOf(row, to), deps.viewSpan());
            return next ? deps.loop(next.start, next.end) : undefined;
        },
        shifted: (track, by, done) => {
            const row = rowOf(track);
            if (!row) return;
            const from = shifting.get(row.id) ?? deps.offset(row);
            shifting.set(row.id, from);
            if (by === null || done) shifting.delete(row.id);
            deps.setOffset(row, by === null ? from : from + by, by === null || done);
        },
        read: (track, channel, seconds) => {
            const row = rowOf(track);
            if (!row || seconds === null) { controller.follow(null); deps.reads(null); return; }
            // The same moment on every other row, each in its own seconds.
            const norm = normOf(row, seconds);
            controller.follow(new Map(rows.map(other => [other.id, ((norm - other.start) / other.length) * other.durationSeconds])), { track: row.id, channel });
            deps.reads(norm);
        },
        reset: deps.resetZoom,
        lanes: (track, channel, lanes) => {
            placed.set(key(track.id, channel), lanes);
            const row = rowOf(track);
            if (row) paint(row, channel);
            const drawn = lanes[0]?.frame.width;
            if (drawn !== undefined && drawn !== width) { width = drawn; deps.widthChanged(); }
        },
        drawn: deps.drawn,
    });

    return {
        show() {
            rows = deps.rows();
            const live = new Set(rows.flatMap(row => Array.from({ length: row.channels }, (_, channel) => key(row.id, channel))));
            for (const held of [...placed.keys()]) if (!live.has(held)) placed.delete(held);
            controller.show(rows);
            marks();
        },
        marks,
        handle: message => controller.handle(message),
        plotWidth: () => width,
        busy: () => controller.busy(),
        inspect: (trackId, channel) => controller.inspect(trackId, channel),
        held: trackId => controller.held(trackId),
    };
}
