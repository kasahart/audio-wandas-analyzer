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
import { attachPlotInteraction, FULL_PLOT_WINDOW, plotPointIn, type PlotMargins, type PlotWindow } from './plotInteraction';
import { createPlotHoverLayer } from './plotHoverLayer';
import { showPlotReadout } from './plotHover';
import { paintOverlay, type StagePlot } from './stagePanes';
import { positionPopover } from './settingsPopover';

/** What the table gives the distribution each time it is drawn. */
export interface DistributionInputs {
    /** The rows it draws from: not excluded, through every filter but the one on the value itself. */
    pool: readonly DatasetRow[];
    value: ValueId;
    group: GroupId;
    results: ReadonlyMap<string, ScanResult>;
    /** The range picked on the value. */
    range: { low: number; high: number } | null;
    /** Whether a row's value counts (a computed one only when it is of the current chain). */
    usable: (row: DatasetRow) => boolean;
    slots: readonly (string | null)[];
    rowOf: (key: string | null) => DatasetRow | undefined;
    /** The group whose median is the base (slot 0 empty, a grouping chosen), or null. */
    baseGroup: string | null;
    valueLabel: string;
    format: (value: number, step?: number) => string;
    rowName: (key: string) => string;
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
/** A press that stays put picks its bin once no second click (a double-click, which resets the zoom) follows. */
const CLICK_WAIT_MS = 260;

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
    let pendingClick: ReturnType<typeof setTimeout> | null = null;

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
        const { pool, value, group, results, range, usable, slots, rowOf, baseGroup } = inputs;
        const dist = distribution(pool, value, group, results, range, usable);
        drawn = dist;
        // Another value or grouping is another axis: its zoom starts whole.
        const key = `${value}|${group}`;
        if (key !== windowKey) { windowKey = key; zoomWindow = FULL_PLOT_WINDOW; }
        const members = dist.groups.reduce((sum, item) => sum + item.members.length, 0);
        const unit = dist.unit === 'ch' ? strings.dsCh : strings.dsUnitRecording;
        const labels = groupLabels(dist.groups.map(item => item.name));
        if (group === 'none') labels.set('', strings.dsDistAll);
        const prefix = group === 'ch' ? `${strings.dsCh} ` : '';
        count.textContent = members
            ? `${members.toLocaleString()} ${unit}${dist.groups.length > 4 ? ` · ${strings.dsDistGroups.replace('{n}', String(dist.groups.length))}` : ''}`
            : strings.dsRows.replace('{n}', pool.length.toLocaleString());
        const legendHtml = members ? distributionLegendHtml(slots, baseGroup !== null ? `${prefix}${labels.get(baseGroup) ?? baseGroup}` : null, strings) : '';
        if (legend.innerHTML !== legendHtml) legend.innerHTML = legendHtml;
        note.textContent = members && !range && !strip ? strings.dsDistDrag : '';
        box.dataset.groups = String(dist.groups.length);
        box.dataset.drawn = String(members);
        box.dataset.missing = String(dist.missing);
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
            const number = row && keys.has(row.key) && usable(row) ? valueOf(row, value, results) : null;
            return row && number !== null ? [{ slot, key: row.key, group: groupOf(row, group), value: number }] : [];
        });
        const axisLabel = value.startsWith('csv:') ? strings.dsDistCsvAxis.replace('{col}', value.slice(4)) : inputs.valueLabel;
        rows = distributionRows(dist, {
            width, rowHeight, strip, range, slots: slotted, baseGroup, labels, groupPrefix: prefix, unitLabel: unit, axisLabel,
            format: inputs.format, name: inputs.rowName,
        }, {
            bar: colourOf('--dist-bar', '#5b6470'), barIn: colourOf('--dist-bar-in', '#aab3be'),
            slots: ['--entry-base', '--entry-compare', '--entry-slot-2', '--entry-slot-3'].map(name => colourOf(name, '#888')),
        }, strings);
        scale = distributionScale(dist, width, rowHeight * dist.groups.length, zoomWindow.x);
        const plotWidth = Math.max(1, width - DIST_MARGINS.left - DIST_MARGINS.right);
        const plotHeight = Math.max(1, rowHeight - DIST_ROW_PAD.top - DIST_ROW_PAD.bottom);
        groups.innerHTML = `<div class="entry-dist-plot" data-entry-dist-plot style="width:${width}px">${rows.map(row => `<div class="entry-dist-row" data-dist-group="${escapeHtml(row.group)}" data-dist-slots="${row.slots.join(' ')}"${row.base ? ' data-dist-base' : ''} style="height:${rowHeight}px">`
            + `<div class="entry-dist-label"><span class="entry-dist-name" title="${escapeHtml(row.title)}">${escapeHtml(row.label)}</span>${row.count ? `<span class="entry-dist-count">${escapeHtml(row.count)}</span>` : ''}${row.max ? `<span class="entry-dist-max">${escapeHtml(row.max)}</span>` : ''}</div>`
            + `<canvas class="entry-dist-canvas" data-dist-canvas data-plot-axis="entry-dist-axis-canvas" style="width:${plotWidth}px;height:${plotHeight}px"></canvas></div>`).join('')}<div class="entry-dist-brush" data-dist-brush hidden></div></div>`;
        const axisView = distributionAxisView(dist);
        const zoom = { x: zoomWindow.x };
        const windowText = [zoomWindow.x.start, zoomWindow.x.end, 0, 1].map(part => part.toFixed(3)).join(' ');
        groups.querySelectorAll<HTMLCanvasElement>('[data-dist-canvas]').forEach((canvas, index) => {
            const row = rows[index];
            const plot = paintOverlay(canvas, { layers: row.layers }, row.range, { x: axisLabel, y: strings.dsDistCountAxis.replace('{unit}', unit) },
                { axisView, window: zoom, margins: ROW_MARGINS, xAxisLabels: false, yAxisLabels: false, ...(range ? { highlight: { start: range.low, end: range.high } } : {}) });
            if (plot) plots.set(canvas, plot);
            canvas.dataset.plotWindow = windowText;
            // Its dots, where they are drawn (CSS pixels on the canvas), for a press on one and for tests.
            canvas.dataset.dots = row.dots.map(dot => `${dot.key}\t${plot ? plot.xAt(dot.value).toFixed(1) : ''}\t${plot ? plot.yAt(dot.level + 0.5).toFixed(1) : ''}`).join('\n');
        });
        // The value axis below them, drawn by the same component: its numbers and name; what a bar's height counts beside it.
        axisCanvas.style.width = `${width}px`;
        paintOverlay(axisCanvas, { layers: [{ view: axisView, color: '', full: 'drawn' }] }, { min: 0, max: 1 }, { x: axisLabel, y: strings.dsDistCountAxis.replace('{unit}', unit) },
            { window: zoom, margins: { left: DIST_MARGINS.left, right: DIST_MARGINS.right, top: 0, bottom: 19 }, yAxisLabels: false });
        countAxis.textContent = strip ? '' : strings.dsDistCountAxis.replace('{unit}', unit);
        if (strip && scrollToSlot) {
            scrollToSlot = false;
            const compared = slotted.find(item => item.slot > 0) ?? slotted[0];
            const index = compared ? dist.groups.findIndex(item => item.name === compared.group) : -1;
            if (index >= 0) groups.scrollTop = Math.max(0, index * rowHeight - 4);
        }
    }

    const repaint = (): void => { if (last) paint(last); };
    /** The dot under (x, y) on a row's canvas (its own CSS pixels), within its radius and a little. */
    function dotAt(canvas: HTMLElement, x: number, y: number): string | null {
        for (const line of (canvas.dataset.dots ?? '').split('\n')) {
            const [key, dx, dy] = line.split('\t');
            if (key && Math.hypot(Number(dx) - x, Number(dy) - y) <= 5) return key;
        }
        return null;
    }
    const canvasOf = (target: EventTarget | null): HTMLElement | null => (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-dist-canvas]') ?? null;

    // A press that stayed put (no box drawn): on a dot, its row; elsewhere, the bin under it once no double-click follows.
    groups.addEventListener('click', event => {
        const canvas = canvasOf(event.target);
        if (!canvas || !scale || event.altKey) return;
        const bounds = canvas.getBoundingClientRect();
        const dot = dotAt(canvas, event.clientX - bounds.left, event.clientY - bounds.top);
        if (dot) { deps.dot(dot); return; }
        if (pendingClick !== null) { clearTimeout(pendingClick); pendingClick = null; return; }
        const plot = groups.querySelector<HTMLElement>('[data-entry-dist-plot]');
        const x = event.clientX - (plot ?? canvas).getBoundingClientRect().left;
        pendingClick = setTimeout(() => {
            pendingClick = null;
            const on = scale;
            const range = on ? pickedRange(on, x, x, false) : null;
            if (range) deps.pick(range);
        }, CLICK_WAIT_MS);
    });
    groups.addEventListener('dblclick', () => { if (pendingClick !== null) { clearTimeout(pendingClick); pendingClick = null; } });

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
        setWindow: (_plot, next) => setWindow(next),
        hover(event, hit) {
            const plot = hit ? plots.get(hit.plot) : undefined;
            if (!hit || !plot) { marks.hide(); return; }
            // Off any bar, dot or tick the readout says where on the value axis the pointer is.
            if (marks.show(hit.plot, plot, event.clientX, event.clientY, readout) === null && scale && last) {
                const bounds = hit.plot.getBoundingClientRect();
                showPlotReadout(readout, last.valueLabel, last.format(scale.at(DIST_MARGINS.left + event.clientX - bounds.left)), "");
            }
            document.getElementById('hint-footer')?.replaceChildren(`${strings.dsDistDrag} · ${strings.compareHintPlot}`);
        },
        clearHover() { marks.hide(); },
        stepFrom: (plot, delta) => marks.stepFrom(plot, plots.get(plot) ?? null, delta),
        showBox(plot, from, to) {
            const rect = plot.getBoundingClientRect(), outer = screen.getBoundingClientRect();
            const [x0, x1] = [Math.min(from.fx, to.fx), Math.max(from.fx, to.fx)];
            // The value axis only: the box spans the row's height.
            Object.assign(zoomBox.style, { left: `${rect.left - outer.left + x0 * rect.width}px`, top: `${rect.top - outer.top}px`, width: `${(x1 - x0) * rect.width}px`, height: `${rect.height}px` });
            zoomBox.hidden = false;
        },
        hideBox() { zoomBox.hidden = true; },
        openAxisRange: () => false,
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
        horizontalOnly: true,
    });
    // A double-click on the value axis strip types its range.
    axisCanvas.addEventListener('dblclick', event => {
        if (!drawn) return;
        const whole = drawn;
        openAxisPart(rangePopover, {
            mapping: linearAxis(whole.low, whole.high, last?.valueLabel ?? ''), horizontal: true, current: zoomWindow.x, clientX: event.clientX, clientY: event.clientY, invalid: strings.specRangeErrorMinMax,
            set(part) { setWindow({ x: part, y: FULL_PLOT_WINDOW.y }); },
        });
    });

    return { place, paint, last: () => drawn };
}
