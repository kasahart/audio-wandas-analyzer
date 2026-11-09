/**
 * The tracks under a trigger's events: each recording as the trigger takes it (the step before it), with the
 * trigger's level as a line, where each event was cut shaded, and a mark per event, numbered as the events'
 * lines are, whose ▶ plays the event and × leaves it out (↺ puts it back); the lane counts the events used.
 */
import type { StageView } from '../../shared/protocol/backendProtocol';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { niceRange } from '../../shared/utils/ticks';
import { paintOverlay, stageRange, type StageAxes } from './stagePanes';
import type { PaneRange } from './comparePanes';
import type { Drawn, StageTrack } from './trackStagePainter';
import type { PlotWindow } from './plotInteraction';
import { NO_FULL_DATA, type FullRead } from './fullRead';

export interface TriggerSettings {
    threshold: number;
    /** The trigger's channel (from 0) of the Frame it takes. */
    channel: number;
    duration: number;
    pre: number;
}

export interface TriggerLaneStrings {
    stageThreshold: string;
    stageEventPlay: string;
    stageEventOutButton: string;
    stageEventInButton: string;
    stageEventsUsed: string;
}

export interface TriggerLanesFrame {
    strings: TriggerLaneStrings;
    tracks: readonly StageTrack[];
    /** A recording as the trigger takes it, and its events (the trigger's picture). */
    signal: (path: string) => StageView | null | undefined;
    /** The part of it on screen at full resolution once zoomed and in (R3); the whole signal until then. */
    detail?: (path: string) => StageView | null | undefined;
    events: (path: string) => NonNullable<StageView['events']> | undefined;
    excluded: (path: string) => readonly number[];
    color: (path: string) => string;
    trigger: TriggerSettings;
    /** The lanes' axes (the signal's unit). */
    axes: (view: StageView | null) => StageAxes;
    window: PlotWindow;
    drawnOn: Map<Element, Drawn>;
    /** Where a recording's numbers are read (R7): its full data, never the signal thinned to be drawn. */
    fullOf?: (view: StageView | null | undefined) => FullRead | undefined;
}

const MARKS = 'stage-event-marks';
/** How far apart (px) two events' marks must be to both be shown. */
const MARK_GAP_PX = 44;

/** The lanes drawn; returns how many hold a signal. */
export function paintTriggerLanes(frame: TriggerLanesFrame): number {
    const { strings, trigger } = frame;
    const views = frame.tracks.map(track => frame.signal(track.filePath) ?? null);
    // The level stays in sight above or below every signal (a waveform's range leaves other views out).
    const base = stageRange([...views, levelView(trigger.threshold)]);
    const margin = Math.abs(trigger.threshold) * 0.05;
    // Widened again to round ends once the level is in (R9): the waveform's range alone is round already.
    const held = niceRange(Math.min(base.min, trigger.threshold - margin), Math.max(base.max, trigger.threshold + margin));
    const range: PaneRange = { ...base, min: held.low, max: held.high };
    let drawn = 0;
    frame.tracks.forEach((track, index) => {
        const canvas = track.canvas;
        if (!canvas) return;
        const view = views[index];
        const axes = frame.axes(view);
        const events = frame.events(track.filePath) ?? [];
        const out = new Set(frame.excluded(track.filePath));
        // Where each event used was cut (its pre-trigger part and the rest of its length), and the level the trigger
        // fires at, named with its value and unit: guides the plot component draws over the signal.
        const guides = view ? {
            spans: events.filter(event => !out.has(event.id)).map(event => ({ start: event.time - trigger.pre, end: event.time - trigger.pre + trigger.duration })),
            level: { value: trigger.threshold, label: strings.stageThreshold.replace('{value}', String(trigger.threshold)).replace('{unit}', view.unit ?? '').trim() },
        } : undefined;
        // The lanes' own zoom (their time is the recording's): the vertical part narrows the level range.
        const { x, y } = frame.window;
        const narrowed: PaneRange = { min: range.min + y.start * (range.max - range.min), max: range.min + y.end * (range.max - range.min) };
        const drawnView = (view && frame.detail?.(track.filePath)) || view;
        const full = (drawnView ? frame.fullOf?.(drawnView) : undefined) ?? NO_FULL_DATA;
        const plot = paintOverlay(canvas, { layers: drawnView ? [{ view: drawnView, color: frame.color(track.filePath), width: 1.5, full }] : [] }, narrowed, axes, { window: { x }, ...(view ? { axisView: view, guides } : {}) });
        frame.drawnOn.set(canvas, { picture: view, range, axes, plot });
        const marks = marksOf(canvas);
        if (!view || !plot || !marks) { if (marks) { marks.innerHTML = ''; delete marks.dataset.html; } return; }
        drawn++;
        const { left, top, width, height } = plot.frame;
        // The marks: over the canvas, one per event at its trigger, and the lane's count in its corner.
        Object.assign(marks.style, { left: `${canvas.offsetLeft}px`, width: `${canvas.clientWidth}px`, height: `${canvas.clientHeight}px` });
        const used = events.filter(event => !out.has(event.id)).length;
        // Marks too close to the one before are left out (not one left out) (zoomed in, each has room): the count still has them all.
        let last = -Infinity;
        const visible = events.filter(event => {
            const x = plot.xAt(event.time);
            if (x < left || x > left + width) return false;
            // An event left out keeps its mark (its ↺ is the way back here); the others make room for it.
            if (x - last < MARK_GAP_PX && !out.has(event.id)) return false;
            last = x;
            return true;
        });
        const html = `<span class="stage-event-count" style="left:${left + 4}px;top:${top + height - 14}px">${escapeHtml(strings.stageEventsUsed.replace('{used}', String(used)).replace('{total}', String(events.length)))}</span>`
            + visible.map(event => {
                const n = String(event.id + 1);
                const off = out.has(event.id);
                const toggle = (off ? strings.stageEventInButton : strings.stageEventOutButton).replace('{n}', n);
                return `<span class="stage-event-mark${off ? ' is-out' : ''}" style="left:${plot.xAt(event.time).toFixed(1)}px">`
                    + `<button type="button" data-action="stage-event-play" data-path="${escapeHtml(track.filePath)}" data-event="${event.id}" aria-label="${escapeHtml(strings.stageEventPlay.replace('{n}', n))}" title="${escapeHtml(strings.stageEventPlay.replace('{n}', n))}">▶ ${n}</button>`
                    + `<button type="button" data-action="stage-event-toggle" data-path="${escapeHtml(track.filePath)}" data-event="${event.id}" data-out="${off}" aria-label="${escapeHtml(toggle)}" title="${escapeHtml(toggle)}">${off ? '↺' : '×'}</button>`
                    + '</span>';
            }).join('');
        // Written only when it changed: a focused mark keeps its focus, the pointer on it its hint.
        if (marks.dataset.html !== html) { marks.innerHTML = html; marks.dataset.html = html; }
    });
    return drawn;
}

/** The marks off every lane (another step shown, or the lanes side by side). */
export function clearTriggerLanes(document: Document): void {
    document.querySelectorAll(`.${MARKS}`).forEach(element => element.remove());
}

/** The lane's marks layer, made once over its canvas. */
function marksOf(canvas: HTMLCanvasElement): HTMLElement | null {
    const wrap = canvas.parentElement;
    if (!wrap) return null;
    let marks = wrap.querySelector<HTMLElement>(`:scope > .${MARKS}`);
    if (!marks) {
        marks = canvas.ownerDocument.createElement('div');
        marks.className = MARKS;
        wrap.append(marks);
    }
    return marks;
}

/** A level as a picture of one point, so the range holds the trigger's line too. */
function levelView(level: number): StageView {
    return { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0], values: [level] };
}
