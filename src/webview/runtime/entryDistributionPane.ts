/**
 * The entry screen's distribution of the value over the groups: on the right while choosing, folded above the
 * table (low rows, two in view) while a comparison is open. Rows without the value are counted, not drawn. Each
 * group's row is drawn by the plot component (R13) on one value axis, drawn on its own strip below them, and answers
 * its gestures: a drag zooms into its box (the value axis), Ctrl+wheel zooms, a double-click shows the whole again
 * and on the axis strip opens its range. Alt+drag picks a range of the value; a press that stays put picks that bin,
 * or on a dot goes to its row.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import { distribution, groupLabels, type Distribution } from '../../shared/dataset/distribution';
import { groupOf, isComputed, valueOf, type DatasetRow, type GroupId, type ValueId } from '../../shared/dataset/datasetTable';
import { installRangePopover, linearAxis, openAxisPart } from '../rangePopover';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { DIST_MARGINS, DIST_ROW_MAX, DIST_ROW_MIN, DIST_ROW_PAD, DIST_STRIP_ROW, distributionAxisView, distributionLegendHtml, distributionRows, distributionScale, pickedRange, type DistributionRow, type DistributionScale } from './entryDistribution';
import { attachPlotInteraction, FULL_PLOT_WINDOW, notePlotWindow, plotPointIn, type PlotMargins, type PlotWindow, type VerticalAxis } from './plotInteraction';
import { createPlotHoverLayer } from './plotHoverLayer';
import { paintOverlay, type StagePlot } from './stagePanes';
import { countTitle, csvColumnTitle, plainNames, plainRange, setDrawnCount, setExclusionText, setOver, type FigureSet, type FigureTitle, type PlainTitle } from './figureModel';
import { NO_POINTS } from './fullRead';
import { positionPopover } from './settingsPopover';

/** The rows' vertical axis is the count per group, defined to show every count always (R13). */
const DIST_VERTICAL: VerticalAxis = 'all-counts';

/** What the table gives the distribution each time it is drawn. */
export interface DistributionInputs {
    /** The rows it draws from: not excluded, through every filter but the one on the value itself. */
    pool: readonly DatasetRow[];
    value: ValueId;
    group: GroupId;
    results: ReadonlyMap<string, ScanResult>;
    /** The range picked on the value. */
    range: { low: number; high: number } | null;
    /**
     * A level's recordings as one set of the folder's reference (entryBase.folderSet): the heading counts its n and
     * says what it left out, with why (computing, failed, stale, another reference); null for a value that is not a level.
     */
    set?: FigureSet<unknown> | null;
    /** Whether a row's value counts (a computed one only when it is of the current chain). */
    usable: (row: DatasetRow) => boolean;
    slots: readonly (string | null)[];
    rowOf: (key: string | null) => DatasetRow | undefined;
    /** The group whose median is the base (slot 0 empty, a grouping chosen) and that median (entryBase.groupBase), or null. */
    base: { group: string; value: number | null } | null;
    /**
     * Whether a row's level is of the value axis's reference (a level of another is not drawn on it, but counted);
     * always true for a value that is not a level. Required: whoever draws a level here says which reference its axis is.
     */
    onAxis: (row: DatasetRow) => boolean;
    /** The value axis' name: a level's named by its reference (figureModel), else a non-level's. */
    valueLabel: FigureTitle | PlainTitle;
    format: (value: number, step?: number) => string;
    rowName: (key: string) => string;
}

/**
 * A CSV column's value axis: its name and the unit its header gives ("temp [°C]", "temp (°C)"), or that the unit is not
 * known (R4: every axis names its unit).
 */
export function csvAxisName(column: string, strings: Pick<UiStrings, 'dsDistCsvAxis' | 'axisUnitUnknown'>): PlainTitle {
    return csvColumnTitle(column, strings);
}

export interface DistributionPaneDeps {
    screen: HTMLElement;
    strings: UiStrings;
    /** A range of the value picked on the plot. */
    pick(range: { low: number; high: number }): void;
    /** A dot pressed: that row. */
    dot(key: string): void;
}

export interface DistributionPane {
    /** On the right (maximized) or folded above the table. */
    place(maximized: boolean): void;
    paint(inputs: DistributionInputs): void;
    /** What was drawn last, for tests. */
    last(): Distribution | null;
}

/** A row's plot fills its canvas: its names are beside it, its axis on the strip below. */
const ROW_MARGINS: PlotMargins = { left: 0, top: 0, right: 0, bottom: 0 };

export function createDistributionPane(deps: DistributionPaneDeps): DistributionPane {
    const { screen, strings } = deps;
    const document = screen.ownerDocument;
    const query = <T extends Element>(selector: string): T => {
        const element = screen.querySelector<T>(selector);
        if (!element) throw new Error(`entry screen: no ${selector}`);
        return element;
    };
    const box = query<HTMLElement>('[data-entry-dist]');
    const area = query<HTMLElement>('[data-entry-dist-area]');
    const groups = query<HTMLElement>('[data-entry-dist-groups]');
    const axisCanvas = query<HTMLCanvasElement>('[data-entry-dist-axis-canvas]');
    const countAxis = query<HTMLElement>('[data-entry-dist-count-axis]');
    const empty = query<HTMLElement>('[data-entry-dist-empty]');
    const note = query<HTMLElement>('[data-entry-dist-note]');
    const readout = box.querySelector<HTMLElement>('.entry-dist-note > [data-plot-readout]');
    const count = query<HTMLElement>('[data-entry-dist-count]');
    const legend = query<HTMLElement>('[data-entry-dist-legend]');
    const entryBody = query<HTMLElement>('.entry-body');
    const marks = createPlotHoverLayer(document, '', screen);
    let strip = true;
    /** Just folded above the table: its two rows in view go to the compared row's group. */
    let scrollToSlot = false;
    /** What was drawn last: its scale maps a press on it to the value, each row's plot to the pointer's marks. */
    let scale: DistributionScale | null = null;
    let drawn: Distribution | null = null;
    let rows: DistributionRow[] = [];
    const plots = new Map<HTMLElement, StagePlot>();
    /** The value axis' zoom, shared by every row (their counts always show whole). */
    let zoomWindow: PlotWindow = FULL_PLOT_WINDOW;
    let windowKey = '';
    let last: DistributionInputs | null = null;
    /** An Alt+drag picking a range: where it started, in the rows' own pixels. */
    let pick: { x0: number; left: number } | null = null;

    function place(maximized: boolean): void {
        if (maximized) { if (box.parentElement !== area) area.prepend(box); }
        else if (box.nextElementSibling !== entryBody) entryBody.before(box);
        if (!maximized && !screen.classList.contains('is-dist-strip')) scrollToSlot = true;
        screen.classList.toggle('is-dist-strip', !maximized);
        strip = !maximized;
    }

    const colourOf = (name: string, fallback: string): string => document.defaultView?.getComputedStyle(box).getPropertyValue(name).trim() || fallback;

    function paint(inputs: DistributionInputs): void {
        if (screen.hidden) return;
        last = inputs;
        const { pool, value, group, results, range, usable, slots, rowOf, base } = inputs;
        const { onAxis } = inputs;
        const dist = distribution(pool, value, group, results, range, usable, onAxis);
        const baseGroup = base?.group ?? null;
        drawn = dist;
        // Another value or grouping is another axis: its zoom starts whole.
        const key = `${value}|${group}`;
        if (key !== windowKey) { windowKey = key; zoomWindow = FULL_PLOT_WINDOW; }
        const members = dist.groups.reduce((sum, item) => sum + item.members.length, 0);
        const unit = dist.unit === 'ch' ? strings.dsCh : strings.dsUnitRecording;
        const labels = groupLabels(dist.groups.map(item => item.name));
        if (group === 'none') labels.set('', strings.dsDistAll);
        const prefix = group === 'ch' ? `${strings.dsCh} ` : '';
        // A level's heading is its set's: its n (of recordings; channels are counted as drawn) and what it left out, with why.
        const set = inputs.set ?? null;
        // Of the set's recordings alone, in the unit drawn (a level's channels: the drawn channels of its recordings).
        const drawnMembers = dist.groups.flatMap(item => item.members);
        count.textContent = members
            ? `${(set ? setDrawnCount(set, drawnMembers, dist.unit === 'ch') : members).toLocaleString()} ${unit}${dist.groups.length > 4 ? ` · ${strings.dsDistGroups.replace('{n}', String(dist.groups.length))}` : ''}`
            : strings.dsRows.replace('{n}', pool.length.toLocaleString());
        // (A level of another reference is only ever drawn apart with its set given, which says it with the rest.)
        if (set) count.textContent += setExclusionText(set, strings);
        const legendHtml = members ? distributionLegendHtml(slots, baseGroup !== null ? `${prefix}${labels.get(baseGroup) ?? baseGroup}` : null, strings) : '';
        if (legend.innerHTML !== legendHtml) legend.innerHTML = legendHtml;
        note.textContent = members && !range && !strip ? strings.dsDistDrag : '';
        box.dataset.groups = String(dist.groups.length);
        box.dataset.drawn = String(members);
        box.dataset.missing = String(dist.missing);
        box.dataset.apart = String(dist.apart);
        box.dataset.unit = dist.unit;
        plots.clear();
        if (!members) {
            groups.innerHTML = ''; scale = null; rows = [];
            axisCanvas.hidden = true; countAxis.textContent = '';
            // Folded beside the tracks, nothing drawn says nothing: 「計算」 in the head is the way on.
            empty.hidden = strip;
            empty.textContent = isComputed(value) && dist.missing ? strings.dsDistNotComputed.replace('{value}', inputs.valueLabel) : strings.dsDistEmpty;
            return;
        }
        empty.hidden = true;
        axisCanvas.hidden = false;
        // On the right the groups share the height (taller bars read better); above the table they stay low.
        const available = Math.max(0, area.clientHeight - groups.offsetTop - 44);
        const rowHeight = strip ? DIST_STRIP_ROW : Math.max(DIST_ROW_MIN, Math.min(DIST_ROW_MAX, Math.floor(available / dist.groups.length)));
        groups.style.maxHeight = `${strip ? 2 * DIST_STRIP_ROW + 8 : Math.max(available, 2 * DIST_ROW_MIN)}px`;
        const width = Math.max(240, groups.clientWidth || box.clientWidth || 400);
        const keys = new Set(pool.map(row => row.key));
        const slotted = slots.flatMap((key, slot) => {
            const row = rowOf(key);
            const number = row && keys.has(row.key) && usable(row) && onAxis(row) ? valueOf(row, value, results) : null;
            return row && number !== null ? [{ slot, key: row.key, group: groupOf(row, group), value: number }] : [];
        });
        const axisLabel = value.startsWith('csv:') ? csvAxisName(value.slice(4), strings) : inputs.valueLabel;
        rows = distributionRows(dist, {
            width, rowHeight, strip, range, slots: slotted, base, labels, groupPrefix: prefix, unitLabel: unit, axisLabel,
            format: inputs.format, name: inputs.rowName,
            countOf: (name, drawn) => {
                if (!set) return `${drawn} ${unit}`;
                const paths = [...new Set(pool.filter(row => groupOf(row, group) === name).map(row => row.filePath))];
                // A level's channels: those drawn of the set's recordings in the group.
                if (dist.unit === 'ch') return `${setDrawnCount(set, dist.groups.find(item => item.name === name)?.members ?? [], true)} ${unit}`;
                // Its n of the one set (what the set left out is said once, in the heading above the groups).
                return `${setOver(set, paths).n} ${unit}`;
            },
        }, {
            bar: colourOf('--dist-bar', '#5b6470'), barIn: colourOf('--dist-bar-in', '#aab3be'),
            slots: ['--entry-base', '--entry-compare', '--entry-slot-2', '--entry-slot-3'].map(name => colourOf(name, '#888')),
        }, strings);
        scale = distributionScale(dist, width, rowHeight * dist.groups.length, zoomWindow.x);
        const plotWidth = Math.max(1, width - DIST_MARGINS.left - DIST_MARGINS.right);
        const plotHeight = Math.max(1, rowHeight - DIST_ROW_PAD.top - DIST_ROW_PAD.bottom);
        groups.innerHTML = `<div class="entry-dist-plot" data-entry-dist-plot style="width:${width}px">${rows.map(row => `<div class="entry-dist-row" data-dist-group="${escapeHtml(row.group)}" data-dist-slots="${row.slots.join(' ')}"${row.base ? ' data-dist-base' : ''} style="height:${rowHeight}px">`
            + `<div class="entry-dist-label"><span class="entry-dist-name" title="${escapeHtml(row.title)}">${escapeHtml(row.label)}</span>${row.count ? `<span class="entry-dist-count">${escapeHtml(row.count)}</span>` : ''}${row.max ? `<span class="entry-dist-max">${escapeHtml(row.max)}</span>` : ''}</div>`
            + `<canvas class="entry-dist-canvas" data-dist-canvas data-plot-key="dist:${escapeHtml(row.group)}" data-plot-axis="entry-dist-axis-canvas" data-plot-names="entry-dist-count-axis" style="width:${plotWidth}px;height:${plotHeight}px"></canvas></div>`).join('')}<div class="entry-dist-brush" data-dist-brush hidden></div></div>`;
        const axisView = distributionAxisView(dist);
        const zoom = { x: zoomWindow.x };
        groups.querySelectorAll<HTMLCanvasElement>('[data-dist-canvas]').forEach((canvas, index) => {
            const row = rows[index];
            const plot = paintOverlay(canvas, { layers: row.layers }, row.range, plainNames(axisLabel, countTitle(strings, unit)),
                { axisView, window: zoom, margins: ROW_MARGINS, xAxisLabels: false, yAxisLabels: false, xAxisCanvas: axisCanvas, ...(range ? { highlight: { start: range.low, end: range.high } } : {}) });
            if (plot) plots.set(canvas, plot);
            notePlotWindow(canvas, { x: zoomWindow.x, y: FULL_PLOT_WINDOW.y }, DIST_VERTICAL);
            // Its dots, where they are drawn (CSS pixels on the canvas), for a press on one and for tests.
            canvas.dataset.dots = row.dots.map(dot => `${dot.key}\t${plot ? plot.xAt(dot.value).toFixed(1) : ''}\t${plot ? plot.yAt(dot.level + 0.5).toFixed(1) : ''}`).join('\n');
        });
        // The value axis below them, drawn by the same component: its numbers and name; what a bar's height counts beside it.
        // It holds no values: nothing to read.
        axisCanvas.style.width = `${width}px`;
        paintOverlay(axisCanvas, { layers: [{ view: axisView, color: '', full: NO_POINTS }] }, plainRange(0, 1), plainNames(axisLabel, countTitle(strings, unit)),
            { window: zoom, margins: { left: DIST_MARGINS.left, right: DIST_MARGINS.right, top: 0, bottom: 19 }, yAxisLabels: false });
        countAxis.textContent = strings.dsDistCountAxis.replace('{unit}', unit);
        if (strip && scrollToSlot) {
            scrollToSlot = false;
            const compared = slotted.find(item => item.slot > 0) ?? slotted[0];
            const index = compared ? dist.groups.findIndex(item => item.name === compared.group) : -1;
            if (index >= 0) groups.scrollTop = Math.max(0, index * rowHeight - 4);
        }
        showMarksAgain();
    }

    const repaint = (): void => { if (last) paint(last); };
    /** Where the pointer reads a row now: a redraw makes the rows anew, and the marks and readout follow it there (A26). */
    let hovered: { x: number; y: number } | null = null;
    /**
     * The marks and readout at (x, y) on a row's plot, through the one readout (plotHoverLayer): a bar, a dot or a
     * tick read there, else where on the value axis the pointer is. A hover, a redraw and a scroll all show it so.
     */
    const words = {
        none(x: number): { name: string; values: string } | null {
            return scale && last ? { name: last.valueLabel, values: last.format(scale.at(DIST_MARGINS.left + x)) } : null;
        },
    };
    function showAt(canvas: HTMLElement, plot: StagePlot, x: number, y: number): void {
        marks.show(canvas, plot, x, y, readout, words);
    }
    function showMarksAgain(): void {
        if (!hovered) return;
        const doc = groups.ownerDocument;
        const under = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(hovered.x, hovered.y) : null;
        const canvas = under instanceof HTMLCanvasElement && under.hasAttribute('data-dist-canvas') ? under : null;
        const plot = canvas ? plots.get(canvas) : undefined;
        if (!canvas || !plot) { marks.hide(); return; }
        showAt(canvas, plot, hovered.x, hovered.y);
    }
    // The rows scroll under a still pointer: the row now under it is read there, never the one that was (R7).
    groups.addEventListener('scroll', () => showMarksAgain());
    /** The dot under (x, y) on a row's canvas (its own CSS pixels), within its radius and a little. */
    function dotAt(canvas: HTMLElement, x: number, y: number): string | null {
        for (const line of (canvas.dataset.dots ?? '').split('\n')) {
            const [key, dx, dy] = line.split('\t');
            if (key && Math.hypot(Number(dx) - x, Number(dy) - y) <= 5) return key;
        }
        return null;
    }
    const canvasOf = (target: EventTarget | null): HTMLElement | null => (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-dist-canvas]') ?? null;

    // A press that stayed put (no box drawn; the plot gestures' tap): on a dot, its row; elsewhere, the bin under it
    // once no double-click follows.
    // The bin is the one under the pointer on the rows as clicked (a zoom before the click is done draws another
    // there), and is picked once no double click follows (plotInteraction.ts arbitrates every plot's click).
    const tap = (canvas: HTMLElement, event: MouseEvent, current: () => boolean): (() => void) | undefined => {
        if (!scale || event.altKey || !current()) return undefined;
        const bounds = canvas.getBoundingClientRect();
        const dot = dotAt(canvas, event.clientX - bounds.left, event.clientY - bounds.top);
        // A dot's row too, once no double click (a zoom reset only) follows.
        if (dot) return () => deps.dot(dot);
        const plot = groups.querySelector<HTMLElement>('[data-entry-dist-plot]');
        const x = event.clientX - (plot ?? canvas).getBoundingClientRect().left;
        const range = pickedRange(scale, x, x, false);
        return range ? () => deps.pick(range) : undefined;
    };

    // The plot component's gestures on every row (R13): the value axis' window is shared, the counts stay whole.
    const zoomBox = document.createElement('div');
    zoomBox.className = 'entry-zoom-box';
    zoomBox.hidden = true;
    screen.append(zoomBox);
    const rangePopover = installRangePopover(document, { rootId: 'entry-dist-range-popover', badgeId: 'entry-dist-range-axis-badge', idPrefix: 'entry-dist-range', strings: rangePopoverStrings(strings), position: positionPopover });
    const setWindow = (next: PlotWindow | null): void => { zoomWindow = next ? { x: next.x, y: FULL_PLOT_WINDOW.y } : FULL_PLOT_WINDOW; repaint(); };
    attachPlotInteraction(box, document, '[data-dist-canvas]', {
        locate(target, clientX, clientY) {
            const plot = canvasOf(target);
            if (!plot || plot.closest('[hidden]')) return null;
            const { fx, fy } = plotPointIn(plot, ROW_MARGINS, clientX, clientY);
            return { plot, point: { fx, fy }, axis: null };
        },
        pointOn(plot, clientX, clientY) {
            const { fx, fy } = plotPointIn(plot, ROW_MARGINS, clientX, clientY);
            return { fx, fy };
        },
        window: () => zoomWindow,
        setWindow(_plot, next) { setWindow(next); },
        hover(event, hit) {
            const plot = hit ? plots.get(hit.plot) : undefined;
            hovered = hit && plot ? { x: event.clientX, y: event.clientY } : null;
            if (!hit || !plot) { marks.hide(); return; }
            // Off any bar, dot or tick the readout says where on the value axis the pointer is (words.none).
            showAt(hit.plot, plot, event.clientX, event.clientY);
            document.getElementById('hint-footer')?.replaceChildren(`${strings.dsDistDrag} · ${strings.compareHintPlot}`);
        },
        clearHover() { hovered = null; marks.hide(); },
        stepFrom: (plot, delta, arrived) => marks.stepFrom(plot, plots.get(plot) ?? null, delta, arrived),
        tap,
        showBox(plot, from, to) {
            const rect = plot.getBoundingClientRect(), outer = screen.getBoundingClientRect();
            const [x0, x1] = [Math.min(from.fx, to.fx), Math.max(from.fx, to.fx)];
            // The value axis only: the box spans the row's height.
            Object.assign(zoomBox.style, { left: `${rect.left - outer.left + x0 * rect.width}px`, top: `${rect.top - outer.top}px`, width: `${(x1 - x0) * rect.width}px`, height: `${rect.height}px` });
            zoomBox.hidden = false;
        },
        hideBox() { zoomBox.hidden = true; },
        // A double-click on the value axis strip below the rows types its range.
        axes: {
            selector: '[data-entry-dist-axis-canvas]',
            locate(axis, clientX, clientY) {
                if (!drawn) return null;
                const { fx, fy } = plotPointIn(axis, { left: DIST_MARGINS.left, right: DIST_MARGINS.right, top: 0, bottom: 0 }, clientX, clientY);
                return { plot: axis, point: { fx, fy }, axis: 'x' };
            },
        },
        openAxisRange(hit, clientX, clientY) {
            if (hit.plot !== axisCanvas || !drawn) return false;
            const whole = drawn;
            openAxisPart(rangePopover, {
                mapping: linearAxis(whole.low, whole.high, last?.valueLabel ?? ''), horizontal: true, current: zoomWindow.x, clientX, clientY, invalid: strings.specRangeErrorMinMax,
                set(part) { setWindow({ x: part, y: FULL_PLOT_WINDOW.y }); },
            });
            return true;
        },
        // Alt+drag picks a range of the value, across every row's shared axis; Alt+click, the bin under it.
        altDrag: {
            start(_hit, event) {
                const plot = groups.querySelector<HTMLElement>('[data-entry-dist-plot]');
                const bounds = (plot ?? (event.target as HTMLElement)).getBoundingClientRect();
                pick = { x0: event.clientX - bounds.left, left: bounds.left };
            },
            move(event) {
                const brush = groups.querySelector<HTMLElement>('[data-dist-brush]');
                if (!pick || !brush) return;
                const x = event.clientX - pick.left;
                Object.assign(brush.style, { left: `${Math.min(x, pick.x0)}px`, width: `${Math.abs(x - pick.x0)}px` });
                brush.hidden = false;
            },
            end(event, dragged) {
                const ended = pick, on = scale;
                pick = null;
                const brush = groups.querySelector<HTMLElement>('[data-dist-brush]');
                if (brush) brush.hidden = true;
                if (!ended || !on) return;
                const range = pickedRange(on, ended.x0, event.clientX - ended.left, dragged);
                if (range) deps.pick(range);
            },
        },
        // Its vertical axis is the count per group, defined to show every count always (R13): a box zooms the value axis.
        verticalAxis: DIST_VERTICAL,
    });
    return { place, paint, last: () => drawn };
}
