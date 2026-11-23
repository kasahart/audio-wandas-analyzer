/**
 * One of the Tracks screen's two bottom figures on screen (figure-design.md 第 4 節 screens/):
 * the cursor spectrum (charts/cursorSpectrum.ts) or the pair figure
 * (charts/pairSpectrum.ts), each one Figure in the screen's own box. It hands the Figure the spec and the specified
 * range, and keeps the range a zoom, a pan, a box or a typed range sets. It counts nothing, picks nothing and draws
 * nothing itself: what a line is called and its colour are the screen's (its track and channel), everything else is
 * the figure service's.
 *
 * While an answer is on its way the Tracks screen shows nothing new: the Figure keeps its last picture. While the
 * picture of new answers is on its way the Figure keeps the last one drawn too (`keepWhileWaiting`: during playback
 * the answers change several times a second, and a plot emptied between two pictures would flicker); it reads nothing
 * of it. With no spec to show (no line) the Figure is hidden and the screen says there is no data.
 *
 * A range up is a lane's, in that lane's unit and reference: it is kept only while the lane is of the same unit and
 * reference (a lane's id is its place, and another unit can take that place when a track is hidden or moved). The
 * lane is the one the user set it on: the lane of the picture on show, which is the picture before while the picture
 * of a new spec is on its way.
 *
 * A kept answer the backend let go (its store made room) is told to the screen's owner (`letGo`), which forgets its
 * reply and asks again. The answer asked again has the same key (a kept answer's key is of what it was made from), so
 * the spec is the same as before: the next showing asks the Figure for its picture once more (`Figure.refresh`).
 *
 * The two figures are of the same frequencies. The screen links them with what this module tells and takes: the range
 * across (`ranged`, `across`) and the place across the pointer reads (`read`, `follow`).
 */
import { answersLetGo } from '../answers/figureKeys';
import type { FigureAnswers } from '../answers/figureRequests';
import { createFigure, type Figure, type FigureInspection, type FigureSpec, type FigureTable, type FigureView, type FigureWords } from '../figure/index';

/** What the Tracks screen says of a line, by its id in the spec: the screen's, never the Figure's. */
export interface TracksFigurePaint {
    /** A line's name in the readout and the CSV (its recording and channel). */
    name(line: string): string;
    /** A line's colour (its track's). */
    colour(line: string): string;
}

/** The ends of a range across; a null end is the whole axis's. */
export type AcrossRange = readonly [number | null, number | null];

export interface TracksFigureDeps {
    document: Document;
    /** Where the Figure's canvas goes: it is drawn at this element's size. */
    host: HTMLElement;
    /** The readout of the panel's header (R7): the Figure writes the point it reads there. */
    readout?: HTMLElement;
    answers: FigureAnswers;
    words: FigureWords;
    label: string;
    /** The page's hint for where the pointer is (over the plot, over an axis), or none when it leaves. */
    hint?: (where: 'plot' | 'axis' | 'colour' | null) => void;
    /** Watches the host's size, so the Figure is drawn again at a new size. */
    ResizeObserver?: typeof ResizeObserver;
    /** There is no line to show (true) or there is (false): the screen says so in the panel. */
    empty(none: boolean): void;
    /** The range across was set here, or taken back (null ends): for the figure sharing it. */
    ranged?(x: AcrossRange): void;
    /** The place across the pointer or the keys read here, or none: for the figure sharing the axis to mark. */
    read?(x: number | null): void;
    /** A picture was drawn, or none could be. */
    drawn?(): void;
    /** A picture counted these kept answers (their keys) as let go by the backend: the owner asks them again. */
    letGo?(keys: readonly string[]): void;
}

/**
 * The range the display settings give (the spectrogram's typed dB range and top frequency, which the cursor spectrum
 * shares): used where the user set none on the figure itself. `up` is the first lane's alone (a typed level is in
 * its unit and reference).
 */
export interface SettingsRange {
    across?: AcrossRange;
    up?: AcrossRange;
}

export interface TracksFigureScreen {
    /** Shows this spec (its lines in the order drawn); with none, hides the Figure. */
    show(spec: FigureSpec | null, paint: TracksFigurePaint, settings?: SettingsRange): void;
    /** Hides it: the Figure is disposed and its holdings released; the range is kept for the next showing. */
    hide(): void;
    shown(): boolean;
    /** Sets the range across from outside (the figure sharing it); null ends are the whole. */
    across(x: AcrossRange): void;
    /** Marks the place across the other figure reads, or takes the mark away. */
    follow(x: number | null): void;
    /** Forgets the specified range (another axis: bands for bins, log for linear). */
    whole(): void;
    /** + / − / 0 with the pointer on no plot. False when hidden. */
    zoomKey(action: 'in' | 'out' | 'reset'): boolean;
    /** What the Figure drew and reads now, for tests. */
    inspect(): FigureInspection | null;
    /** The CSV of what is shown: every answer of its lines (第 6 節). */
    exportCsv(): Promise<FigureTable>;
}

const LINE_WIDTH = 1.25;
/** The room between two lanes of these figures: they share the panel's short height, and no lane has a headline. */
const LANE_GAP = 8;
/**
 * How often one kept answer is told as let go: were the store too small to keep a figure's lines at all, asking again
 * on every picture would compute them without end. After these, the line stays away until its key changes (the cursor
 * or a setting moves).
 */
const LET_GO_ASKS = 2;

/** The unit and reference a lane's values are in: those its first line's key declares (none declared: the same always). */
export const laneLevel = (of: FigureSpec, laneId: string): string => {
    const first = of.lanes.find(lane => lane.id === laneId)?.lines?.[0]?.of;
    const key = first && 'key' in first ? first.key : undefined;
    return JSON.stringify(of.keys.find(entry => entry.key === key)?.level ?? null);
};
/**
 * The ranges up sent with a spec: those of the lanes it has, each still of the unit and reference it was set in
 * (`was`: laneLevel when it was set). A lane's id is its place: after a track is hidden or moved the same place can be
 * another unit's, and a range typed in Pa is no range in dBFS.
 */
export const rangesKept = (lanes: FigureView['lanes'], was: ReadonlyMap<string, string>, of: FigureSpec): NonNullable<FigureView['lanes']> =>
    (lanes ?? []).filter(lane => of.lanes.some(item => item.id === lane.lane) && (was.get(lane.lane) ?? laneLevel(of, lane.lane)) === laneLevel(of, lane.lane));

export function createTracksFigureScreen(deps: TracksFigureDeps): TracksFigureScreen {
    let figure: Figure | null = null;
    let observer: ResizeObserver | null = null;
    let view: FigureView | null = null;
    let paint: TracksFigurePaint | null = null;
    let spec: FigureSpec | null = null;
    let followed: number | null = null;
    let settings: SettingsRange = {};
    /** What each lane with a range up was of when the range was set (levelOf). */
    const rangedOf = new Map<string, string>();
    /** The spec of the picture on show (the one a gesture is made on); `spec` is the one asked for. */
    let shownSpec: FigureSpec | null = null;
    /** How often each kept answer of the spec was told as let go. */
    const toldLetGo = new Map<string, number>();
    /** The picture on show left out answers that were told as let go: the next showing asks for it once more. */
    let lacking = false;

    const sizeOf = (): { width: number; height: number } => ({ width: Math.max(1, deps.host.clientWidth || 600), height: Math.max(1, deps.host.clientHeight || 140) });
    const given = (range: AcrossRange | undefined): range is AcrossRange => !!range && (range[0] !== null || range[1] !== null);
    /**
     * The range sent with a spec: the one set on the figure, and where none is, the settings' (SettingsRange). A lane's
     * range up is its own lane's alone: one set on a lane the spec has not is not sent; across it is kept.
     */
    const viewFor = (of: FigureSpec): FigureView | null => {
        const x = view?.x?.some(end => end !== null) ? view.x : given(settings.across) ? [...settings.across] : undefined;
        const lanes = rangesKept(view?.lanes, rangedOf, of);
        const first = of.lanes[0]?.id;
        if (first !== undefined && given(settings.up) && !lanes.some(lane => lane.lane === first)) lanes.unshift({ lane: first, y: [...settings.up] });
        return x || lanes.length ? { ...(x ? { x } : {}), ...(lanes.length ? { lanes } : {}) } : null;
    };
    const specified = (next: FigureView): boolean =>
        !!next.x?.some(end => end !== null) || !!next.lanes?.some(lane => lane.y.some(end => end !== null));
    const acrossOf = (of: FigureView | null): AcrossRange => [of?.x?.[0] ?? null, of?.x?.[1] ?? null];
    const again = (): void => { if (figure && spec) figure.show(spec, viewFor(spec)); };

    const make = (): Figure => {
        const made = createFigure({
            document: deps.document, host: deps.host, requests: deps.answers.figure(), words: deps.words, label: deps.label, size: sizeOf(), fill: true, laneGap: LANE_GAP, keepWhileWaiting: true,
            ...(deps.readout ? { readout: deps.readout } : {}),
            ...(deps.hint ? { hint: deps.hint } : {}),
            lineLabel: line => paint?.name(line.id) ?? line.id,
            lineStyle: line => ({ colour: paint?.colour(line.id) ?? '#7f7f7f', width: LINE_WIDTH }),
        });
        made.on('view', next => {
            const before = acrossOf(view);
            const old = view?.lanes ?? [], stamps = new Map(rangedOf);
            view = specified(next) ? next : null;
            rangedOf.clear();
            // A range up is of the lane it was set on: the lane of the picture on show. A range this gesture left as it
            // was stays of the lane it was set on before.
            const on = shownSpec ?? spec;
            for (const lane of view?.lanes ?? []) {
                const same = old.find(item => item.lane === lane.lane);
                const kept = same && same.y[0] === lane.y[0] && same.y[1] === lane.y[1] ? stamps.get(lane.lane) : undefined;
                if (kept !== undefined) rangedOf.set(lane.lane, kept); else if (on) rangedOf.set(lane.lane, laneLevel(on, lane.lane));
            }
            const now = acrossOf(view);
            again();
            if (before[0] !== now[0] || before[1] !== now[1]) deps.ranged?.(now);
        });
        made.on('across', x => deps.read?.(x));
        made.on('picture', members => {
            shownSpec = spec;
            const gone = answersLetGo(members?.shown.excluded ?? [], spec?.keys ?? []);
            // The count is of the keys the spec has: an answer the picture holds again starts from none.
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
        deps.host.hidden = true;
        observer?.disconnect();
        observer = null;
        figure?.dispose();
        figure = null;
        spec = null;
        shownSpec = null;
        lacking = false;
        toldLetGo.clear();
        paint = null;
        // A Figure taken away reads nothing: the figure following it is told so.
        if (reading) deps.read?.(null);
    };
    return {
        show(next, nextPaint, nextSettings = {}) {
            if (!next) { leave(); deps.empty(true); return; }
            deps.empty(false);
            paint = nextPaint;
            settings = nextSettings;
            spec = next;
            deps.host.hidden = false;
            figure ??= make();
            // The size is the host's ResizeObserver's (screens/compareOverlay.ts says why); read here only without one.
            if (!observer) { const size = sizeOf(); figure.resize(size.width, size.height); }
            figure.show(next, viewFor(next));
            // The answers told as let go were asked again under the same keys: the spec is the same, so the Figure
            // only painted. Its picture is asked once more.
            if (lacking && !figure.inspect().waiting) { lacking = false; figure.refresh(); }
        },
        hide() { leave(); deps.empty(false); },
        shown: () => figure !== null,
        across(x) {
            const before = acrossOf(view);
            if (before[0] === x[0] && before[1] === x[1]) return;
            const lanes = view?.lanes;
            const next: FigureView = { ...(x[0] !== null || x[1] !== null ? { x: [x[0], x[1]] } : {}), ...(lanes ? { lanes } : {}) };
            view = specified(next) ? next : null;
            again();
        },
        follow(x) {
            followed = x;
            figure?.follow(x);
        },
        whole() {
            if (!view) return;
            const before = acrossOf(view);
            view = null;
            rangedOf.clear();
            again();
            // The figure sharing the axis forgets the range with this one.
            if (before[0] !== null || before[1] !== null) deps.ranged?.([null, null]);
        },
        zoomKey(action) {
            if (!figure) return false;
            figure.zoom(action);
            return true;
        },
        inspect: () => figure?.inspect() ?? null,
        exportCsv: () => (figure ? figure.exportTable() : Promise.resolve({ status: 'none' as const })),
    };
}
