/**
 * The lanes under a trigger's events on screen (figure-design.md 第 4 節 screens/): a Figure of its own under
 * the events' Figure (its axis across is the recording's time, not the time from the trigger), a band lane a
 * recording (charts/triggerLanes.ts). Over it the screen puts each event's controls at the guide line the Figure drew
 * for its firing: ▶ plays the event, × leaves it out, ↺ puts it back; and each lane's count of the events used, as
 * the figure service counted them. It computes nothing: the places are the Figure's (its `placed` signal), the level,
 * the firings, the stretches cut and the counts the figure service's.
 *
 * The Figure keeps its own zoom (the lanes zoom on their own; a range up is every lane's). It lives while the lanes
 * are shown: hidden, it is disposed and its holdings released.
 */
import { eventsKey, triggerLaneAt, triggerLanes, TRIGGER_LANE } from '../charts/triggerLanes';
import type { FigureAnswers } from '../answers/figureRequests';
import { answersLetGo } from '../answers/figureKeys';
import { createFigure, type Figure, type FigureInspection, type FigureKey, type FigurePlacedLane, type FigureView, type FigureWords } from '../figure/index';
import { withMinus } from '../shell/numberText';

/** One recording's lane, as the comparison says it. */
export interface TriggerLaneOf {
    path: string;
    /** Its name (the lane's tag, the readout) and its colour. */
    name: string;
    colour: string;
    role?: string;
    /** The key of its signal as the trigger takes it, and the key of the trigger step's answer of it (its events are of that). */
    signal: FigureKey;
    step: FigureKey;
    /** The events the user left out. */
    out: readonly number[];
    /** The unit the level is written in (the signal's, or the uncalibrated full scale's). */
    unit: string;
}

export interface TriggerLanesStrings {
    stageThreshold: string;
    stageEventPlay: string;
    stageEventOutButton: string;
    stageEventInButton: string;
    stageEventsUsed: string;
    stageEventsNoAnswer: string;
}

export interface TriggerLanesDeps {
    document: Document;
    /** Where the Figure's canvas goes (drawn at this element's size); the controls' layer is made over it. */
    host: HTMLElement;
    /** The lanes' own readout, in the row above them (R7). */
    readout: HTMLElement;
    answers: FigureAnswers;
    words: FigureWords;
    strings: TriggerLanesStrings;
    label: string;
    hint?: (where: 'plot' | 'axis' | 'colour' | null) => void;
    ResizeObserver?: typeof ResizeObserver;
    /** The 0 key over the lanes: the screen's other plots go back to their whole too. */
    wholeZoom?(): void;
    /** How many lanes are drawn, and the part of the whole axes on screen, told when they change (test attributes). */
    drawn?(lanes: number, part: { x: string; y: string }): void;
    /** Told with every picture: the kept answers it holds no more though declared usable (as screens/compareOverlay.ts). */
    letGo?(keys: readonly string[]): void;
}

export interface TriggerLanesScreen {
    show(lanes: readonly TriggerLaneOf[], trigger: { threshold: number; pre: number; duration: number }): void;
    hide(): void;
    shown(): boolean;
    /** Every axis back to its whole (the comparison's reset of every plot). */
    reset(): void;
    inspect(): FigureInspection | null;
}

/** How far apart (px) two events' controls must be to both be shown. */
const MARK_GAP_PX = 44;

export function createTriggerLanesScreen(deps: TriggerLanesDeps): TriggerLanesScreen {
    let figure: Figure | null = null;
    let observer: ResizeObserver | null = null;
    let lanes: readonly TriggerLaneOf[] = [];
    let level = 0;
    /** The specified range (the lanes' own zoom), kept while they are shown. */
    let view: FigureView | null = null;
    let spec: ReturnType<typeof triggerLanes> | null = null;
    let written = '';
    /** The layer over the canvas the controls go in, there while the lanes are shown. */
    let marks: HTMLElement | null = null;

    const sizeOf = (): { width: number; height: number } => ({ width: Math.max(1, deps.host.clientWidth || 600), height: Math.max(1, deps.host.clientHeight || 200) });
    const laneOf = (id: string): TriggerLaneOf | undefined => lanes[triggerLaneAt(id)];
    const number = (id: string | undefined): number | null => { const found = /^event:(\d+)$/u.exec(id ?? ''); return found ? Number(found[1]) : null; };

    /** The controls over the lanes, at the places the Figure drew its guide lines at. */
    const place = (placed: readonly FigurePlacedLane[]): void => {
        const { strings } = deps;
        const made: HTMLElement[] = [];
        const element = (tag: string, name: string, left: number, top: number): HTMLElement => {
            const one = deps.document.createElement(tag);
            one.className = name;
            one.style.left = `${left.toFixed(1)}px`;
            one.style.top = `${top}px`;
            return one;
        };
        const button = (path: string, id: number, said: string, text: string): HTMLButtonElement => {
            const one = deps.document.createElement('button');
            one.type = 'button';
            Object.assign(one.dataset, { path, event: String(id) });
            one.setAttribute('aria-label', said);
            one.title = said;
            one.textContent = text;
            return one;
        };
        for (const lane of placed) {
            const of = laneOf(lane.id);
            if (!of) continue;
            const { left, top, width, height } = lane.frame;
            // No events' answer is held: said so, never counted as 0 of 0 (one on its way says nothing yet).
            if (lane.events && lane.events.missing !== 'pending') {
                // In the lane's corner the events' controls and the lane's name leave free (its right end is at this place).
                const count = element('span', 'stage-event-count', left + width - 4, top + height - 20);
                count.textContent = lane.events.missing ? strings.stageEventsNoAnswer : strings.stageEventsUsed.replace('{used}', String(lane.events.used)).replace('{total}', String(lane.events.total));
                if (lane.events.missing) count.dataset.missing = lane.events.missing;
                made.push(count);
            }
            // Controls too close to the one before are left out (zoomed in, each has room): the count still has them all.
            let last = -Infinity;
            for (const guide of lane.guides) {
                const id = number(guide.id);
                if (guide.axis !== 'x' || id === null || guide.px < left || guide.px > left + width) continue;
                // An event left out keeps its control (its ↺ is the way back here); the others make room for it.
                if (guide.px - last < MARK_GAP_PX && !guide.out) continue;
                last = guide.px;
                const n = String(id + 1), off = !!guide.out;
                const mark = element('span', `stage-event-mark${off ? ' is-out' : ''}`, guide.px, top + 2);
                const toggle = button(of.path, id, (off ? strings.stageEventInButton : strings.stageEventOutButton).replace('{n}', n), off ? '↺' : '×');
                toggle.dataset.out = String(off);
                // Each action written out where it is given, for the audit of what can be triggered (guiTriggerabilityInventory.ts).
                toggle.setAttribute('data-action', 'stage-event-toggle');
                const play = button(of.path, id, strings.stageEventPlay.replace('{n}', n), `▶ ${n}`);
                play.setAttribute('data-action', 'stage-event-play');
                mark.append(play, toggle);
                made.push(mark);
            }
        }
        // Written only when it changed: a focused control keeps its focus, the pointer on it its hint.
        const html = made.map(one => one.outerHTML).join('');
        if (html !== written) { marks?.replaceChildren(...made); written = html; }
        const seen = figure?.inspect();
        const part = (axis: 'x' | 'y'): string => { const of = seen?.lanes[0]?.part?.[axis]; return of ? `${of.start.toFixed(3)}-${of.end.toFixed(3)}` : '0.000-1.000'; };
        deps.drawn?.(seen?.waiting === false ? placed.filter(lane => lane.events).length : 0, { x: part('x'), y: part('y') });
    };

    const make = (): Figure => {
        const made = createFigure({
            document: deps.document, host: deps.host, readout: deps.readout, requests: deps.answers.figure(), words: deps.words, label: deps.label, size: sizeOf(), fill: true,
            ...(deps.hint ? { hint: deps.hint } : {}),
            lineLabel: line => laneOf(line.id.replace(/-signal$/u, ''))?.name ?? line.id,
            lineStyle: line => ({ colour: laneOf(line.id.replace(/-signal$/u, ''))?.colour ?? '#7f7f7f', width: 1.5 }),
            laneLabel: lane => laneOf(lane)?.name ?? lane,
            // The level the trigger fires at, with its value and the lane's unit.
            guideLabel: (lane, guide) => (guide.id === 'threshold' ? deps.strings.stageThreshold.replace('{value}', withMinus(String(level))).replace('{unit}', laneOf(lane)?.unit ?? '').trim() : undefined),
        });
        // The controls' layer over the canvas the Figure put in the host.
        marks = deps.document.createElement('div');
        marks.className = 'stage-lanes-marks';
        deps.host.append(marks);
        made.on('view', next => {
            // A range up is every lane's (they are looked at together), as the lanes' zoom was.
            const up = next.lanes?.find(lane => lane.y.some(end => end !== null))?.y;
            const specified = next.x?.some(end => end !== null) || !!up;
            view = specified ? { x: next.x ?? [null, null], lanes: up ? lanes.map((_, at) => ({ lane: TRIGGER_LANE(at), y: up })) : [] } : null;
            if (spec) made.show(spec, view);
        });
        made.on('reset', () => deps.wholeZoom?.());
        made.on('placed', place);
        made.on('picture', members => {
            const seen = made.inspect();
            place(seen.lanes.map(lane => ({ id: lane.id, frame: lane.frame, guides: lane.guides, ...(lane.events ? { events: lane.events } : {}) })));
            // The answers let go: a lane's signal (計算ア counted it so), and a trigger step's whose events the lane says are held no more.
            const steps = seen.lanes.flatMap(lane => { const of = lane.events?.missing === 'evicted' ? laneOf(lane.id) : undefined; return of ? [of.step.key] : []; });
            deps.letGo?.([...new Set([...answersLetGo(members?.shown.excluded ?? [], spec?.keys ?? []), ...steps])]);
        });
        const Observer = deps.ResizeObserver;
        if (Observer) {
            observer = new Observer(() => { const now = sizeOf(); figure?.resize(now.width, now.height); });
            observer.observe(deps.host);
        }
        return made;
    };

    return {
        show(next, trigger) {
            lanes = next;
            level = trigger.threshold;
            const keys = new Map<string, FigureKey>();
            const declared = next.map(lane => {
                keys.set(lane.signal.key, lane.signal);
                // The events are of the trigger step's answer: its key with the mark, its state and version the step's.
                const events = eventsKey(lane.step.key);
                keys.set(events, { key: events, state: lane.step.state, version: lane.step.version });
                return { signal: lane.signal.key, ...(lane.role ? { role: lane.role } : {}), events, out: lane.out };
            });
            deps.host.hidden = false;
            figure ??= make();
            // (Its size is the host's ResizeObserver's alone, as the overlay's: screens/compareOverlay.ts.)
            if (!observer) { const size = sizeOf(); figure.resize(size.width, size.height); }
            spec = triggerLanes({ lanes: declared, trigger, keys: [...keys.values()] });
            figure.show(spec, view);
        },
        hide() {
            deps.host.hidden = true;
            marks?.remove();
            marks = null;
            written = '';
            observer?.disconnect();
            observer = null;
            figure?.dispose();
            figure = null;
            view = null;
            spec = null;
        },
        shown: () => figure !== null,
        reset() { if (view && figure && spec) { view = null; figure.show(spec, null); } },
        inspect: () => figure?.inspect() ?? null,
    };
}
