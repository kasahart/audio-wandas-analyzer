/**
 * The comparison's spectrum overlay on screen (figure-design.md 第 4 節 screens/): one Figure with the overlay
 * lane and, on request, the Δ lane under it, sharing the axis across. It hands the Figure the spec
 * (charts/compareOverlay.ts) made of the comparison's recordings and the comparison's specified range, and turns the
 * Figure's signals into the comparison's state: a zoom, a pan, a box, a double click's reset or a typed range (view)
 * sets the range; nothing else is acted on (the old overlay's click acted on a trigger's event line only, and a spectrum
 * has none; it had no Alt+drag and no Shift+drag). It counts nothing, picks nothing and draws nothing itself: the
 * sets, counts and calibration words it hands the legend are the figure service's (計算ア), only mapped back from
 * keys to recordings.
 *
 * The Figure lives while the overlay is shown: hidden, it is disposed (its holdings released, 第 6 節); shown again,
 * a new one is made.
 */
import { compareOverlay, DELTA_LANE, eventKey, eventLine, imageLaneLine, isBaseLine, OVERLAY_LANE, OVERLAY_LINE, OWN_LANE, type CompareOverlayInputs } from '../charts/compareOverlay';
import { secondsText } from '../shell/numberText';
import type { ExportDropReason, FigureAnswers } from '../answers/figureRequests';
import { answersLetGo } from '../answers/figureKeys';
import { createFigure, FigureExportDropped, withLegend, type Figure, type FigureInspection, type FigureKey, type FigureLine, type FigureLineName, type FigureMembers, type FigureTable, type FigureView, type FigureWords } from '../figure/index';

/** The recordings of one paint, by path, in the order the chart declares them. */
export interface OverlayRecordings {
    /** The recordings on screen with no role, in display order. */
    others: readonly string[];
    /** The base's recordings (one recording, or a group, the table's order). */
    base: readonly string[];
    /** The compared recording, then the other slots' recordings in slot order. */
    compare: readonly string[];
    delta: boolean;
    /** The step shown is the sound itself: each base recording is a line of its own (charts/compareOverlay.ts). */
    signals?: boolean;
    /** The step shown is an image: a lane a recording on screen (charts/compareOverlay.ts). */
    images?: boolean;
    /**
     * Not overlaid (「One lane per track」): a lane a recording on screen, of its line, its sound or its events. The
     * recordings on screen in the lanes' order, top to bottom.
     */
    apart?: readonly string[];
    /**
     * The step shown is a trigger's: each recording's events (its number from 0 and when it triggered, s into the
     * file) are a line each, in number order; those `out` are left out by the user (drawn faint, clicked back). A base
     * group is one line (the median of its recordings' events' means).
     */
    events?: { of(path: string): ReadonlyArray<{ id: number; time: number }>; out(path: string): readonly number[] };
}

/** What the base heading is written from: the service's counts of the base, by recording. */
export interface OverlayCounts {
    used: readonly string[];
    excluded: ReadonlyArray<{ path: string; reason: string }>;
}

/** A line's kind, for its colour and width. */
export type OverlayLineKind = 'base' | 'delta' | 'compare1' | 'compare' | 'other';

/** What the comparison says of its recordings for one paint: their keys, names and colours (the screen's, never the Figure's). */
export interface OverlayPaint {
    /** A recording's key in the spec, with the state and version the answer store gives it. */
    keyOf(path: string): FigureKey;
    /** A recording's name in the legend and the readout. */
    name(path: string): string;
    /** The base's heading: its counts as the service made them (null while no picture of what is shown is in). */
    baseName(counts: OverlayCounts | null): string;
    /** A line's colour and width (the recording it is of; null for the base's median and the Δ). */
    style(path: string | null, line: OverlayLineKind): { colour: string; width: number };
    /** Writes the legend: the base's heading and each recording's calibration word as the picture says them; how many memos it holds. */
    legend(written: { baseTitle: string; word: (path: string) => string }): number;
    /** A click on an event's line: leaves it out, or puts it back (`out`: it is left out now). May return how to take it back. */
    eventPicked?(path: string, id: number, out: boolean): (() => void) | void;
    /** The event's line the pointer reads now (a click would pick it), or none; `moved`: the pointer came onto it now (else it is the same line, shown anew). */
    eventRead?(event: { path: string; id: number; out: boolean } | null, moved: boolean): void;
}

export interface CompareOverlayDeps {
    document: Document;
    /** Where the Figure's canvas goes: it is drawn at this element's size. */
    host: HTMLElement;
    /** The readout of the row above the plots (R7): the Figure writes the point it reads there. */
    readout: HTMLElement;
    /** Where the Δ lane's headline is written. */
    headlineHost: HTMLElement;
    /** Where the test attributes go: the part of each whole axis shown (data-x-window, …), the lines drawn, the memos. */
    zoomAttributes: HTMLElement;
    drawnAttribute: HTMLElement;
    legendElement: HTMLElement;
    answers: FigureAnswers;
    words: FigureWords;
    /** Said after the name of a recording the service drew no line of because it is in another unit or reference (仕様 2). */
    leftOtherReference?: string;
    /** Said after the name of a recording the service drew no line of because no picture of it can be had (failed). */
    leftFailed?: string;
    label: string;
    /** The page's hint for where the pointer is (over the plot, over an axis), or none when it leaves. */
    hint?: (where: 'plot' | 'axis' | 'colour' | null) => void;
    /** Watches the host's size, so the Figure is drawn again at a new size. */
    ResizeObserver?: typeof ResizeObserver;
    /**
     * The comparison's zoom of every plot now: the Figure's range is kept with the zoom it was set under, so a zoom of
     * every plot back to the whole (another one in its place) takes it back too. `freshZoom` puts one of the same part
     * in its place, so a range set now is told apart from a later reset.
     */
    zoom(): object;
    freshZoom(): object;
    /** The 0 key over the Figure: the screen's other plots (the tracks under a trigger's events) go back to their whole too. */
    wholeZoom?(): void;
    /** The comparison draws again (a range changed). */
    rerender(): void;
    /**
     * Told with every picture: the kept answers it counted as let go though declared usable (answers/figureKeys.ts
     * answersLetGo), for the comparison to ask their scans again; none when the picture holds them all.
     */
    letGo?(keys: readonly string[]): void;
}

export interface CompareOverlayScreen {
    /** Shows the overlay of these recordings, at the comparison's range. */
    show(recordings: OverlayRecordings, paint: OverlayPaint): void;
    /** Hides it: the Figure is disposed and its holdings released. */
    hide(): void;
    shown(): boolean;
    /** + / − / 0 with the pointer on no plot: the overlay's axis across zoomed, or reset. False when hidden. */
    zoomKey(action: 'in' | 'out' | 'reset'): boolean;
    /** What the Figure drew and reads now, for tests. */
    inspect(): FigureInspection | null;
    /** The CSV of what is shown: every answer of its lines, of the picture's data id (第 6 節). */
    exportCsv(): Promise<FigureTable>;
    /**
     * The PNG of what is shown: the same spec and range drawn by a Figure of its own at a fixed size (its own Figure id,
     * released once drawn), of the same data id as the picture on screen; refused (`changed`) when it is another's.
     */
    /** `purpose`: a newer export of the same purpose takes an older one's place (the report's is not the PNG button's). */
    exportPng(size: { width: number; height: number }, purpose?: string): Promise<{ status: 'png'; dataId: string; dataUrl: string } | { status: 'changed' | 'none' | 'too-large' | 'failed' }>;
}

/** A colour `#rrggbb` at an opacity (an event's line: one left out is faint). */
const faded = (colour: string, alpha: number): string => {
    const hex = /^#([0-9a-f]{6})$/iu.exec(colour)?.[1];
    if (!hex) return colour;
    const part = (at: number): number => parseInt(hex.slice(at, at + 2), 16);
    return `rgba(${part(0)}, ${part(2)}, ${part(4)}, ${alpha})`;
};

/** The Δ lane's share of the plots' height, as the old Δ pane under the overlay had it. */
const DELTA_SHARE = 0.35;

export function createCompareOverlayScreen(deps: CompareOverlayDeps): CompareOverlayScreen {
    let figure: Figure | null = null;
    let observer: ResizeObserver | null = null;
    /** The specified range, with the comparison's zoom it was set under. */
    let range: { view: FigureView; under: object } | null = null;
    /** What the last picture showed and counted (計算ア), until the next one. */
    let counted: FigureMembers | null = null;
    /** This paint's recordings, by key and by line id, and what the comparison says of them. */
    let paint: OverlayPaint | null = null;
    let pathOfKey = new Map<string, string>();
    let pathOfLine = new Map<string, string>();
    /** A trigger's events by their line: whose, which, when it triggered and whether it is left out. */
    let eventOfLine = new Map<string, { path: string; id: number; time: number; out: boolean }>();
    /** The line the Figure's pointer reads now. */
    let readLine: string | null = null;
    let recordings: OverlayRecordings = { others: [], base: [], compare: [], delta: false };
    /** The spec last shown, for an export of it. */
    let lastSpec: ReturnType<typeof compareOverlay> | null = null;
    /** The PNG export on its way: settled (rejected) when a newer one takes its place or the screen is hidden. */
    const pngOnWay = new Map<string, { drop: (reason: ExportDropReason) => void }>();

    const viewNow = (): FigureView | null => (range && range.under === deps.zoom() ? range.view : null);
    /**
     * The specified range for a spec: a lane's range up (or colours) is its own lane's alone, so one set on a lane the
     * spec has not (the Δ lane hidden since, the overlay laid out a lane a recording) is not sent; across it is kept.
     */
    const viewFor = (spec: ReturnType<typeof compareOverlay>): FigureView | null => {
        const view = viewNow();
        return view?.lanes ? { ...view, lanes: view.lanes.filter(lane => spec.lanes.some(item => item.id === lane.lane)) } : view;
    };
    const sizeOf = (): { width: number; height: number } => ({ width: Math.max(1, deps.host.clientWidth || 600), height: Math.max(1, deps.host.clientHeight || 300) });
    /**
     * The counts of what is shown: the last picture's, while no new one is on its way, and while the picture on its
     * way is of the same spec at another range or size (the Figure shows the last picture on the new view meanwhile:
     * its recordings are the ones counted). Blanked on each zoom, the base's heading lost its count and the legend
     * its second line, and the plots under it jumped up and back with every gesture.
     */
    const countsNow = (): FigureMembers | null => {
        const seen = figure?.inspect();
        return seen && (!seen.waiting || seen.mapped) ? counted : null;
    };
    /** The base's counts by recording (its line's, as the service made them). */
    const baseCounts = (members: FigureMembers | null): OverlayCounts | null => {
        const lines = members?.lines.filter(item => isBaseLine(item.line)) ?? [];
        return lines.length ? { used: lines.flatMap(line => line.used).map(key => pathOfKey.get(key) ?? key), excluded: lines.flatMap(line => line.excluded).map(item => ({ path: pathOfKey.get(item.key) ?? item.key, reason: item.reason })) } : null;
    };
    /** A line's calibration word, as the picture says it (計算ア): an uncalibrated line on an axis named calibrated. */
    const wordOf = (members: FigureMembers | null, line: string): string =>
        (members?.calibration === 'calibrated' && members.lines.find(item => item.line === line)?.calibration === 'uncalibrated' ? deps.words.axisUncalibrated : '');
    /**
     * Why the recording is shown on no line, as the service counted it (計算ア), in the words of its legend item: in
     * another unit or reference, or failed (no picture of it can be had: a region past its end).
     */
    const leftOut = (members: FigureMembers | null, path: string): string => {
        const reason = members?.shown.excluded.find(item => pathOfKey.get(item.key) === path)?.reason;
        return reason === 'other-reference' ? deps.leftOtherReference ?? '' : reason === 'failed' ? deps.leftFailed ?? '' : '';
    };
    const lineOfPath = (path: string): string | undefined => [...pathOfLine].find(([, of]) => of === path)?.[0];
    /** The base as one recording that is the comparison's own (nothing compared): named as that recording. */
    const baseName = (members: FigureMembers | null): string => (!paint ? '' : recordings.base.length === 1 && !recordings.compare.length ? paint.name(recordings.base[0]) : paint.baseName(baseCounts(members)));

    /** The legend and the test attributes, from what is drawn now: written again when a picture comes. */
    const written = (): void => {
        if (!paint || !figure) return;
        const members = countsNow();
        const memos = paint.legend({
            // Sounds drawn a recording at a time say each their own calibration: no word of the group's.
            baseTitle: baseName(members) + (recordings.signals ? '' : wordOf(members, OVERLAY_LINE.base)),
            // A recording left out for its unit or reference, or failed, has no line: its name says so (the base's heading counts its own).
            word: path => { const line = lineOfPath(path); return (line ? wordOf(members, line) : '') + leftOut(members, path); },
        });
        deps.legendElement.dataset.memos = String(memos);
        const seen = figure.inspect();
        // How many recordings are drawn: the overlay's lines, or the images (a lane each).
        deps.drawnAttribute.dataset.drawn = String(recordings.images ? seen.lanes.filter(lane => lane.image).length : recordings.apart ? seen.lanes.filter(lane => lane.lines.length).length : seen.lanes.find(lane => lane.id === OVERLAY_LANE)?.lines.length ?? 0);
        const first = recordings.images || recordings.apart ? seen.lanes[0]?.id ?? OVERLAY_LANE : OVERLAY_LANE;
        const part = (lane: string, axis: 'x' | 'y'): string => {
            const of = seen.lanes.find(item => item.id === lane)?.part?.[axis];
            return of ? `${of.start.toFixed(3)}-${of.end.toFixed(3)}` : '0.000-1.000';
        };
        deps.zoomAttributes.dataset.xWindow = part(first, 'x');
        deps.zoomAttributes.dataset.yWindow = part(first, 'y');
        deps.zoomAttributes.dataset.diffYWindow = part(DELTA_LANE, 'y');
    };

    const nameOfLine = (line: FigureLineName): string => {
        if (!paint) return line.id;
        if (line.id === OVERLAY_LINE.delta) return 'Δ';
        // Named while a picture is shown only (the readout is empty while one is on its way): its own counts.
        if (line.id === OVERLAY_LINE.base) return baseName(counted);
        const path = pathOfLine.get(line.id);
        // An event: its recording, its number (from 1) and where in the recording it was cut (the plot's time is from the trigger).
        const event = eventOfLine.get(line.id);
        if (event) return `${paint.name(event.path)} #${event.id + 1}${Number.isFinite(event.time) ? ` @ ${secondsText(event.time)}` : ''}`;
        return path ? paint.name(path) : line.id;
    };
    const styleOfLine = (line: FigureLineName): { colour: string; width: number } => {
        if (!paint) return { colour: '#7f7f7f', width: 1.25 };
        if (line.id === OVERLAY_LINE.delta) return paint.style(null, 'delta');
        if (line.id === OVERLAY_LINE.base) return paint.style(null, 'base');
        const path = pathOfLine.get(line.id) ?? '';
        const event = eventOfLine.get(line.id);
        if (event) {
            // Each event thin, in its recording's colour; one left out faint, and still there to be clicked back.
            const own = paint.style(path, isBaseLine(line.id.split('#')[0]) ? 'base' : line.id.startsWith(OVERLAY_LINE.compare(1)) ? 'compare1' : line.id.startsWith('compare') ? 'compare' : 'other');
            return { colour: faded(own.colour, event.out ? 0.25 : 0.85), width: Math.min(own.width, 1.2) };
        }
        if (isBaseLine(line.id)) return paint.style(path, 'base');
        return paint.style(path, line.id === OVERLAY_LINE.compare(1) ? 'compare1' : line.id.startsWith('compare') ? 'compare' : 'other');
    };

    const make = (): Figure => {
        const made = createFigure({
            document: deps.document, host: deps.host, readout: deps.readout, headlineHost: deps.headlineHost, requests: deps.answers.figure(), words: deps.words, label: deps.label, size: sizeOf(),
            ...(deps.hint ? { hint: deps.hint } : {}),
            // Sized by the page's stylesheet to its box, so it follows the layout at once; told its size here.
            fill: true,
            laneHeights: height => ({ delta: Math.round(height * DELTA_SHARE) }),
            lineLabel: nameOfLine,
            lineStyle: styleOfLine,
            // An image lane is named by its recording (the lanes are not overlaid: each says whose it is).
            laneLabel: lane => { const line = imageLaneLine(lane); return line ? nameOfLine({ id: line }) : lane; },
            // So is a recording's own lane of lines (「One lane per track」): the lanes' colours alone did not say whose
            // each is (a recording of no slot is grey, as every other one is).
            laneTitle: lane => (lane.startsWith(OWN_LANE('')) ? nameOfLine({ id: lane.slice(OWN_LANE('').length) }) : undefined),
            // A zoom undone shows the whole recording's lines at once, as the widest picture drew them, while the
            // picture of the whole range is on its way (it took 0.5 to 0.7 s, and the plot stood empty but for the
            // zoomed part stretched).
            lineUnder: true,
        });
        made.on('view', view => {
            const specified = view.x?.some(end => end !== null) || view.lanes?.some(lane => lane.y.some(end => end !== null) || lane.colour?.some(end => end !== null));
            range = specified ? { view, under: deps.freshZoom() } : null;
            deps.rerender();
        });
        made.on('picture', members => { counted = members; written(); deps.letGo?.(answersLetGo(members?.shown.excluded ?? [], lastSpec?.keys ?? [])); });
        made.on('reset', () => deps.wholeZoom?.());
        // A click on an event's line leaves it out or puts it back; the pointer on one says so.
        // (On the line itself: a click in the empty part of the plot leaves nothing out.)
        made.on('pick', read => { const event = read.near ? eventOfLine.get(read.line) : undefined; return event ? paint?.eventPicked?.(event.path, event.id, event.out) : undefined; });
        made.on('read', read => {
            readLine = read?.near ? read.line : null;
            const event = read?.near ? eventOfLine.get(read.line) : undefined;
            made.canvas.style.cursor = event ? 'pointer' : '';
            paint?.eventRead?.(event ? { path: event.path, id: event.id, out: event.out } : null, true);
        });
        const Observer = deps.ResizeObserver;
        if (Observer) {
            observer = new Observer(() => { const now = sizeOf(); figure?.resize(now.width, now.height); });
            observer.observe(deps.host);
        }
        return made;
    };
    return {
        show(next, nextPaint) {
            paint = nextPaint;
            recordings = next;
            const keys = new Map<string, FigureKey>();
            pathOfKey = new Map();
            pathOfLine = new Map();
            const keyFor = (path: string): string => {
                const entry = nextPaint.keyOf(path);
                keys.set(entry.key, entry);
                pathOfKey.set(entry.key, path);
                return entry.key;
            };
            eventOfLine = new Map();
            const events = next.events;
            if (events) {
                // Declared in the order drawn: the recordings with no role, the base, the compared ones; each one's events by number.
                const lines: FigureLine[] = [];
                const eventsOf = (path: string, line: string, role: string | undefined): void => {
                    const entry = nextPaint.keyOf(path);
                    const out = new Set(events.out(path));
                    // (Its lane, a lane a recording, is named by the recording.)
                    if (next.apart) pathOfLine.set(line, path);
                    for (const event of [...events.of(path)].sort((a, b) => a.id - b.id)) {
                        const key = eventKey(entry.key, event.id), id = eventLine(line, event.id + 1);
                        keys.set(key, { ...entry, key });
                        pathOfKey.set(key, path);
                        pathOfLine.set(id, path);
                        eventOfLine.set(id, { path, id: event.id, time: event.time, out: out.has(event.id) });
                        lines.push({ id, of: { key }, ...(role ? { role } : {}) });
                    }
                };
                const apart = next.apart;
                if (apart) {
                    // A lane a recording, in the lanes' order: each recording on screen its own events (no median is one recording's).
                    const lineOf = new Map<string, [string, string | undefined]>([
                        ...next.others.map((path, at): [string, [string, string | undefined]] => [path, [OVERLAY_LINE.other(at + 1), undefined]]),
                        ...next.base.map((path, at): [string, [string, string | undefined]] => [path, [OVERLAY_LINE.baseEach(at + 1), 'base']]),
                        ...next.compare.map((path, at): [string, [string, string | undefined]] => [path, [OVERLAY_LINE.compare(at + 1), `compare${at + 1}`]]),
                    ]);
                    for (const path of apart) { const of = lineOf.get(path); if (of) eventsOf(path, of[0], of[1]); }
                } else {
                    next.others.forEach((path, at) => eventsOf(path, OVERLAY_LINE.other(at + 1), undefined));
                    if (next.base.length === 1) eventsOf(next.base[0], OVERLAY_LINE.baseEach(1), 'base');
                    else if (next.base.length > 1) {
                        // A base group: the median of its recordings' events' means, counted and judged by the service.
                        const means = next.base.map(path => { const entry = nextPaint.keyOf(path); const key = entry.state === 'usable' ? eventKey(entry.key, 'mean') : entry.key; keys.set(key, { ...entry, key }); pathOfKey.set(key, path); return key; });
                        lines.push({ id: OVERLAY_LINE.base, of: { median: means }, role: 'base' });
                    }
                    next.compare.forEach((path, at) => eventsOf(path, OVERLAY_LINE.compare(at + 1), `compare${at + 1}`));
                }
                deps.host.hidden = false;
                figure ??= make();
                if (!observer) { const size = sizeOf(); figure.resize(size.width, size.height); }
                lastSpec = compareOverlay({ others: [], base: [], compare: [], delta: false, events: lines, ...(apart ? { apart: [] } : {}), keys: [...keys.values()] });
                figure.show(lastSpec, viewFor(lastSpec));
                // The line under a still pointer may be left out now, or back.
                const under = readLine ? eventOfLine.get(readLine) : undefined;
                nextPaint.eventRead?.(under ? { path: under.path, id: under.id, out: under.out } : null, false);
                written();
                return;
            }
            const others = next.others.map((path, at) => { pathOfLine.set(OVERLAY_LINE.other(at + 1), path); return keyFor(path); });
            const base = next.base.map(keyFor);
            if (next.signals || next.images || next.apart) next.base.forEach((path, at) => pathOfLine.set(OVERLAY_LINE.baseEach(at + 1), path));
            else if (next.base.length === 1) pathOfLine.set(OVERLAY_LINE.base, next.base[0]);
            const compare = next.compare.map((path, at) => { pathOfLine.set(OVERLAY_LINE.compare(at + 1), path); return keyFor(path); });
            const inputs: CompareOverlayInputs = {
                others,
                base,
                compare,
                delta: next.delta,
                ...(next.signals ? { signals: true } : {}),
                ...(next.images ? { images: true } : {}),
                ...(next.apart ? { apart: next.apart.filter(path => [...pathOfKey.values()].includes(path)).map(keyFor) } : {}),
                keys: [...keys.values()],
            };
            deps.host.hidden = false;
            figure ??= make();
            // The size is the host's ResizeObserver's alone (it tells the size the host is shown at, once laid out). A
            // size read here, in the middle of the comparison's paint, can be a moment's: a row hidden and shown
            // again before the next frame. The observer, having nothing new to tell, would never correct it, and the
            // Figure would stay drawn at a size it is not shown at (the flake of figureBaseGroup.spec.ts, a race).
            if (!observer) { const size = sizeOf(); figure.resize(size.width, size.height); }
            lastSpec = compareOverlay(inputs);
            figure.show(lastSpec, viewFor(lastSpec));
            written();
        },
        hide() {
            deps.host.hidden = true;
            deps.headlineHost.textContent = '';
            observer?.disconnect();
            observer = null;
            [...pngOnWay.values()].forEach(own => own.drop('disposed'));
            figure?.dispose();
            figure = null;
            counted = null;
            paint = null;
        },
        shown: () => figure !== null,
        zoomKey(action) {
            if (!figure) return false;
            figure.zoom(action);
            return true;
        },
        inspect: () => figure?.inspect() ?? null,
        exportCsv: () => (figure ? figure.exportTable() : Promise.resolve({ status: 'none' as const })),
        exportPng(size, purpose = 'png') {
            const shown = figure?.inspect();
            if (!figure || !shown || shown.waiting || !shown.dataId || !lastSpec) return Promise.resolve({ status: 'none' as const });
            const dataId = shown.dataId;
            // Drawn off the page by a Figure of its own; a long computation while it is (spec 4: 書き出し).
            const done = deps.answers.computations.begin();
            const host = deps.document.createElement('div');
            // Each line's name and colour taken now (class 4): the PNG is drawn with these, never with what the
            // screen's legend says when its picture comes (another recording slotted, another base).
            const taken = new Map(lastSpec.lanes.flatMap(lane => lane.lines.map(line => {
                const named: FigureLineName = { id: line.id, ...(line.role !== undefined ? { role: line.role } : {}), ...('key' in line.of ? { key: line.of.key } : {}) };
                // With its calibration word, as the page's legend says it (an uncalibrated line on a calibrated axis).
                const word = line.id === OVERLAY_LINE.base && recordings.signals ? '' : wordOf(counted, line.id);
                return [line.id, { name: nameOfLine(named) + word, style: styleOfLine(named) }] as const;
            })));
            // An image lane's recording, named in the lane as on the page (its lines are none: the strip has no entry of it).
            // With its calibration word, which the page says in its legend beside the canvas.
            const lanesTaken = new Map(lastSpec.lanes.map(lane => { const line = imageLaneLine(lane.id); return [lane.id, line ? nameOfLine({ id: line }) + wordOf(counted, line) : lane.id] as const; }));
            const png = createFigure({
                document: deps.document, host, requests: deps.answers.figure(), words: deps.words, label: deps.label, size,
                laneHeights: height => ({ delta: Math.round(height * DELTA_SHARE) }),
                lineLabel: line => taken.get(line.id)?.name ?? line.id,
                lineStyle: line => taken.get(line.id)?.style ?? styleOfLine(line),
                laneLabel: lane => lanesTaken.get(lane) ?? lane,
            });
            const spec = lastSpec;
            // A newer export of the same purpose takes this one's place; the report's and the PNG's own do not cancel each other.
            pngOnWay.get(purpose)?.drop('superseded');
            return new Promise((resolve, reject) => {
                const own = {
                    drop: (reason: ExportDropReason): void => { if (pngOnWay.get(purpose) === own) pngOnWay.delete(purpose); png.dispose(); done(); reject(new FigureExportDropped(reason)); },
                };
                pngOnWay.set(purpose, own);
                const finish = (result: Awaited<ReturnType<CompareOverlayScreen['exportPng']>>): void => { if (pngOnWay.get(purpose) === own) pngOnWay.delete(purpose); png.dispose(); done(); resolve(result); };
                png.on('picture', () => {
                    const drawn = png.inspect();
                    if (drawn.failure) { finish({ status: drawn.failure === 'too-large' ? 'too-large' : 'failed' }); return; }
                    // Another data's picture than the one on screen: the answers changed meanwhile, nothing is written.
                    if (drawn.dataId !== dataId) { finish({ status: 'changed' }); return; }
                    // The lines the picture drew, named as the page's legend named them when the export was asked
                    // (the legend is beside the canvas on the page, so the image carries its own: pngLegend.ts).
                    const named = [...new Set(drawn.lanes.flatMap(lane => lane.lines.map(line => line.id)))]
                        .flatMap(id => { const line = taken.get(id); return line ? [{ name: line.name, colour: line.style.colour }] : []; });
                    finish({ status: 'png', dataId, dataUrl: withLegend(deps.document, png.canvas, named, size.width).toDataURL('image/png') });
                });
                png.show(spec, viewFor(spec));
            });
        },
    };
}
