/**
 * One channel of a Tracks row on screen (figure-design.md 第 4 節 screens/): its
 * waveform lane and its spectrogram lane (charts/trackRow.ts) as one Figure in the row's own box. The rows are one
 * Figure a channel (案 2): the screen links them by what this module tells and takes.
 *
 * The Tracks screen owns what the rows share: the time on screen (one window for every row), each recording's place
 * on the time axis (its offset), the amplitude and frequency ranges, the colour range, the cursor and the loop. So this
 * module keeps no range of its own: it shows the spec and the view it is handed, and tells the screen every gesture
 * (a zoom, a pan, a typed range: `viewed`; a click's time: `placed`; Alt+drag: `ranged`; Shift+drag: `shifted`).
 * The screen changes its state and shows every row again. It counts nothing, picks nothing and draws nothing itself.
 *
 * Times here are the recording's own: seconds from its start. The screen converts to and from its shared time axis.
 *
 * While the picture of new answers is on its way (a zoom's STFT, a setting) the Figure keeps the last one drawn, on
 * the view asked for (`keepWhileWaiting`), and reads nothing of it.
 *
 * A kept answer the backend let go (its store made room) is told to the screen (`letGo`), which forgets its reply
 * and asks again; the answer asked again has the same key, so the next showing asks the Figure for its picture once
 * more (`Figure.refresh`), as screens/tracksFigure.ts does.
 */
import { answersLetGo } from '../answers/figureKeys';
import type { FigureAnswers } from '../answers/figureRequests';
import { createFigure, type Figure, type FigureInspection, type FigurePlacedLane, type FigureSpec, type FigureTypedAxis, type FigureView, type FigureWords } from '../figure/index';

export interface TrackRowFigureDeps {
    document: Document;
    /** Where the Figure's canvas goes: it is drawn at this element's size. */
    host: HTMLElement;
    /** The row's readout (R7): the Figure writes the point it reads there. */
    readout?: HTMLElement;
    answers: FigureAnswers;
    words: FigureWords;
    /** The canvas's accessible name (the file, the channel). */
    label: string;
    /** The room left of the plots (the rows' axis column) and right of them, so every row's plots start where the time ruler does. */
    margin: { left: number; right: number };
    /** The room between the waveform and the spectrogram (the split the user drags). */
    laneGap: number;
    /** Each lane's height for the box's height (the split's place). */
    laneHeights: (height: number) => Readonly<Record<string, number>>;
    /** The line's colour (the track's) and what the readout calls it. */
    colour(): string;
    name(): string;
    hint?: (where: 'plot' | 'axis' | 'colour' | null) => void;
    ResizeObserver?: typeof ResizeObserver;
    /** A range was asked for on the Figure (a box, a zoom, a pan, a typed range, a reset: null ends). */
    viewed(view: FigureView, typed?: FigureTypedAxis): void;
    /** A click's time on the recording's own axis (s); the screen may return how to take it back. */
    placed?(seconds: number): (() => void) | void;
    /** Alt+drag: a stretch of time (s). */
    /** `from`: where the drag began; `to`: where it was let go (before or after it). */
    ranged?(from: number, to: number): (() => void) | void;
    /** Shift+drag: how far (s) from the press; null when abandoned. */
    shifted?(by: number | null, done: boolean): void;
    /** The time the pointer or the keys read here, or none: for the other rows to mark. */
    read?(seconds: number | null): void;
    /** The 0 key over the Figure. */
    reset?(): void;
    /** The lanes were drawn at these places: for the screen's layer over them (the cursor, the loop). */
    lanes?(lanes: readonly FigurePlacedLane[]): void;
    /** A picture was drawn, or none could be. */
    drawn?(): void;
    /** A picture counted these kept answers (their keys) as let go by the backend: the owner asks them again. */
    letGo?(keys: readonly string[]): void;
}

export interface TrackRowFigureScreen {
    /** Shows this spec on this view (times in the recording's own seconds); with none, takes the Figure away. */
    show(spec: FigureSpec | null, view: FigureView | null): void;
    /** Takes the Figure away: it is disposed and its holdings released. */
    hide(): void;
    shown(): boolean;
    /** Marks the time another row reads, or takes the mark away. */
    follow(seconds: number | null): void;
    /** + / − / 0 with the pointer on no plot. False when hidden. */
    zoomKey(action: 'in' | 'out' | 'reset'): boolean;
    /** What the Figure drew and reads now, for tests. */
    inspect(): FigureInspection | null;
}

const LINE_WIDTH = 1;
/** A row's picture is drawn this much of the time shown past each end: scrolled across, that part is on screen at once. */
const ROW_AHEAD = 1;
/** How often one kept answer is told as let go (screens/tracksFigure.ts says why). */
const LET_GO_ASKS = 2;

export function createTrackRowFigure(deps: TrackRowFigureDeps): TrackRowFigureScreen {
    let figure: Figure | null = null;
    let observer: ResizeObserver | null = null;
    let spec: FigureSpec | null = null;
    let followed: number | null = null;
    const toldLetGo = new Map<string, number>();
    let lacking = false;

    /**
     * The box's size. A box with no layout yet (its row not laid out, the page hidden), or one still shorter than its
     * lanes (a row whose lanes were just set, read before the page laid it out again), is taken as tall as its lanes
     * are set to be: the lanes' heights are the screen's, not shares of the box, so a height shorter than them would
     * draw the lower lane, and its axis names, past the canvas's edge (R4).
     */
    const sizeOf = (): { width: number; height: number } => {
        const lanes = Object.values(deps.laneHeights(0));
        const set = lanes.reduce((sum, height) => sum + height, 0) + deps.laneGap * Math.max(0, lanes.length - 1);
        return { width: Math.max(1, deps.host.clientWidth || 600), height: Math.max(1, set, deps.host.clientHeight || set || 160) };
    };

    const make = (): Figure => {
        const made = createFigure({
            document: deps.document, host: deps.host, requests: deps.answers.figure(), words: deps.words, label: deps.label, size: sizeOf(), fill: true,
            margin: { left: deps.margin.left, right: deps.margin.right, top: 0, bottom: 0 }, acrossAxis: false, imagePalette: 'viridis', pressFocuses: true, leaveForgets: true,
            laneGap: deps.laneGap, laneHeights: deps.laneHeights, keepWhileWaiting: true, ahead: ROW_AHEAD,
            ...(deps.readout ? { readout: deps.readout } : {}),
            ...(deps.hint ? { hint: deps.hint } : {}),
            lineLabel: () => deps.name(),
            lineStyle: () => ({ colour: deps.colour(), width: LINE_WIDTH }),
        });
        made.on('view', (next, typed) => deps.viewed(next, typed));
        made.on('across', x => deps.read?.(x));
        made.on('reset', () => deps.reset?.());
        made.on('placed', lanes => deps.lanes?.(lanes));
        if (deps.placed) made.on('place', at => deps.placed?.(at.x));
        if (deps.ranged) made.on('range', range => (range.from === range.x[1] ? deps.ranged?.(range.x[1], range.x[0]) : deps.ranged?.(range.x[0], range.x[1])));
        if (deps.shifted) made.on('shift', drag => deps.shifted?.(drag.by, drag.done));
        made.on('picture', members => {
            const gone = answersLetGo(members?.shown.excluded ?? [], spec?.keys ?? []);
            for (const key of [...toldLetGo.keys()]) if (!gone.includes(key)) toldLetGo.delete(key);
            const ask = gone.filter(key => (toldLetGo.get(key) ?? 0) < LET_GO_ASKS);
            for (const key of ask) toldLetGo.set(key, (toldLetGo.get(key) ?? 0) + 1);
            lacking = ask.length > 0;
            if (ask.length) deps.letGo?.(ask);
            deps.drawn?.();
        });
        made.follow(followed);
        const Observer = deps.ResizeObserver;
        if (Observer) {
            observer = new Observer(() => { const now = sizeOf(); figure?.resize(now.width, now.height); });
            observer.observe(deps.host);
        }
        return made;
    };
    const leave = (): void => {
        const reading = figure !== null;
        observer?.disconnect();
        observer = null;
        figure?.dispose();
        figure = null;
        spec = null;
        lacking = false;
        toldLetGo.clear();
        if (reading) { deps.read?.(null); deps.lanes?.([]); }
    };
    return {
        show(next, view) {
            if (!next) { leave(); return; }
            spec = next;
            figure ??= make();
            // The box's size now, before the spec is shown: a row made taller is shown with its new lane heights at once,
            // never on the canvas of the height before (the observer tells its change a frame later).
            const size = sizeOf();
            figure.resize(size.width, size.height);
            figure.show(next, view);
            if (lacking && !figure.inspect().waiting) { lacking = false; figure.refresh(); }
        },
        hide: leave,
        shown: () => figure !== null,
        follow(seconds) {
            followed = seconds;
            figure?.follow(seconds);
        },
        zoomKey(action) {
            if (!figure) return false;
            figure.zoom(action);
            return true;
        },
        inspect: () => figure?.inspect() ?? null,
    };
}
