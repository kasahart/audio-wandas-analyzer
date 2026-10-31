/**
 * The entry table's side panel plots: the overview strip (the table's rows in its order, one per channel, each
 * its recording's 1/3-octave bands) and the held plot beside it, painted on the next frame with the distribution
 * above them. Each keeps its zoom as the lanes do (box zoom, Ctrl+wheel, Shift+wheel, a double click to reset or
 * to type an axis's range); a press that stays put is still a click: a row gone to on the strip.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import type { DatasetRow } from '../../shared/dataset/datasetTable';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { powerMeanOrNull } from '../../shared/utils/levels';
import { installRangePopover, linearAxis, openAxisPart, type AxisMapping } from '../rangePopover';
import type { HeldPicture } from './entryHeldPlot';
import { OVERVIEW_MARGINS, paintOverview } from './entryPlots';
import { attachPlotInteraction, FULL_PLOT_WINDOW, plotPointIn, type PlotMargins, type PlotWindow } from './plotInteraction';
import { positionPopover } from './settingsPopover';
import { STAGE_MARGINS } from './stagePanes';

export interface SidePlotsDeps {
    document: Document;
    window: Pick<Window, 'requestAnimationFrame'>;
    strings: UiStrings;
    screen: HTMLElement;
    /** The side panel, the table's rows and its scroller (which part of the strip is on screen), and the two plots. */
    side: HTMLElement;
    body: HTMLElement;
    tableWrap: HTMLElement;
    overview: HTMLCanvasElement;
    heldCanvas: HTMLCanvasElement;
    /** The rows the table shows, in its order. */
    rows(): readonly DatasetRow[];
    focusedFile(): string | null;
    paintDistribution(): void;
    /** The held plot drawn (or hidden), and what it last drew. */
    paintHeld(): void;
    heldPicture(): HeldPicture | null;
    /** A row picked on the strip. */
    pickRow(key: string): void;
}

export interface SidePlots {
    /** A plot's zoom (whole when it has none). */
    window(name: string): PlotWindow;
    /** A plot's zoom while it shows the same thing (`key`); for something else it starts whole again. */
    keepWindow(name: string, key: string): PlotWindow;
    /** A result arrived: its recording's bands (its channels' power mean) are kept for the strip. */
    noteResult(filePath: string, result: ScanResult): void;
    /** Another folder: no bands kept. */
    clear(): void;
    /** The side plots painted on the next frame; `distribution`: the distribution too, not only the strip's window. */
    schedule(distribution?: boolean): void;
    /** The gestures on the plots, and a click on the strip. */
    attach(): void;
}

export function createSidePlots(deps: SidePlotsDeps): SidePlots {
    const { document, strings, screen, side, body, tableWrap, overview, heldCanvas } = deps;
    const windows = new Map<string, PlotWindow>();
    const windowKeys = new Map<string, string>();
    const plotWindow = (name: string): PlotWindow => windows.get(name) ?? FULL_PLOT_WINDOW;
    function keepWindow(name: string, key: string): PlotWindow {
        if (windowKeys.get(name) !== key) { windowKeys.set(name, key); windows.delete(name); }
        return plotWindow(name);
    }
    /** Each scanned recording's bands and the calibrated ones, kept as results arrive so scrolling does not redo them. */
    const levels = new Map<string, (number | null)[]>();
    const calibrated = new Set<string>();
    /** Bumped on every change to them, so the strip knows when to draw its cells again. */
    let version = 0;
    const pending = { frame: false, distribution: true };

    function paint(): void {
        if (pending.distribution) { pending.distribution = false; deps.paintDistribution(); }
        // The side plots are drawn only while the table is wide enough to show them.
        if (screen.hidden || !side.offsetWidth) return;
        const rows = deps.rows();
        const rowHeight = (body.querySelector('tr') as HTMLElement | null)?.offsetHeight || 22;
        const first = Math.floor(tableWrap.scrollTop / rowHeight);
        paintOverview(overview, rows, levels, { first, last: first + Math.ceil(tableWrap.clientHeight / rowHeight) - 2 }, deps.focusedFile(), keepWindow('overview', String(rows.length)),
            calibrated.size > 0, version);
        // The zoom on each plot, for tests: "x0-x1|y0-y1".
        for (const [name, canvas] of [['overview', overview], ['held', heldCanvas]] as const) {
            const zoom = plotWindow(name);
            canvas.dataset.window = `${zoom.x.start.toFixed(3)}-${zoom.x.end.toFixed(3)}|${zoom.y.start.toFixed(3)}-${zoom.y.end.toFixed(3)}`;
        }
        deps.paintHeld();
    }
    function schedule(distribution = true): void {
        pending.distribution ||= distribution;
        if (pending.frame) return;
        pending.frame = true;
        deps.window.requestAnimationFrame(() => { pending.frame = false; paint(); });
    }

    function attach(): void {
        overview.addEventListener('click', event => {
            const rows = deps.rows();
            const box = overview.getBoundingClientRect();
            // The strip's rows (top first) over the part of it on screen.
            const zoom = plotWindow('overview');
            const plotTop = box.top + OVERVIEW_MARGINS.top, plotHeight = box.height - OVERVIEW_MARGINS.top - OVERVIEW_MARGINS.bottom;
            const row = rows[Math.floor(((1 - zoom.y.end) + (event.clientY - plotTop) / Math.max(1, plotHeight) * (zoom.y.end - zoom.y.start)) * rows.length)];
            if (row) deps.pickRow(row.key);
        });
        const zoomBox = document.createElement('div');
        zoomBox.className = 'entry-zoom-box';
        zoomBox.hidden = true;
        side.append(zoomBox);
        const rangePopover = installRangePopover(document, { rootId: 'entry-range-popover', badgeId: 'entry-range-axis-badge', idPrefix: 'entry-range', strings: rangePopoverStrings(strings), position: positionPopover });
        const plotName = (plot: HTMLElement): string => (plot === overview ? 'overview' : 'held');
        const marginsOf = (plot: HTMLElement): PlotMargins => (plot === overview ? OVERVIEW_MARGINS : deps.heldPicture()?.margins ?? STAGE_MARGINS);
        attachPlotInteraction(side, document, '[data-entry-held-canvas], [data-entry-overview]', {
            locate(target, clientX, clientY) {
                const plot = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-entry-held-canvas], [data-entry-overview]');
                if (!plot || plot.closest('[hidden]')) return null;
                const { fx, fy, axis } = plotPointIn(plot, marginsOf(plot), clientX, clientY);
                return { plot, point: { fx, fy }, axis };
            },
            pointOn(plot, clientX, clientY) {
                const { fx, fy } = plotPointIn(plot, marginsOf(plot), clientX, clientY);
                return { fx, fy };
            },
            window: plot => plotWindow(plotName(plot)),
            setWindow(plot, next) {
                if (next) windows.set(plotName(plot), next); else windows.delete(plotName(plot));
                schedule();
            },
            hover(event, hit) {
                // A point's name stays where hints go while the pointer is on it.
                if (!hit) return;
                // A plot that says what it is (the strip) keeps saying it, before the gestures.
                const own = hit.plot.getAttribute('data-hint');
                const gestures = hit.axis ? strings.compareHintAxis : strings.compareHintPlot;
                document.getElementById('hint-footer')?.replaceChildren(own ? `${own} · ${gestures}` : gestures);
            },
            clearHover() { /* the panel's own hints stay */ },
            showBox(plot, from, to) {
                const box = plot.getBoundingClientRect(), outer = side.getBoundingClientRect(), margins = marginsOf(plot);
                const width = box.width - margins.left - margins.right, height = box.height - margins.top - margins.bottom;
                const [x0, x1] = [Math.min(from.fx, to.fx), Math.max(from.fx, to.fx)], [y0, y1] = [Math.min(from.fy, to.fy), Math.max(from.fy, to.fy)];
                Object.assign(zoomBox.style, { left: `${box.left - outer.left + margins.left + x0 * width}px`, top: `${box.top - outer.top + margins.top + (1 - y1) * height}px`, width: `${(x1 - x0) * width}px`, height: `${(y1 - y0) * height}px` });
                zoomBox.hidden = false;
            },
            hideBox() { zoomBox.hidden = true; },
            openAxisRange(hit, clientX, clientY) {
                const name = plotName(hit.plot);
                const picture = deps.heldPicture();
                const mapping: AxisMapping | null = name === 'held' && picture ? (hit.axis === 'x' ? { at: picture.x, of: picture.ofX, label: picture.xLabel } : linearAxis(picture.range.min, picture.range.max, picture.yLabel))
                    : null;
                if (!mapping) return false;
                const zoom = plotWindow(name);
                openAxisPart(rangePopover, {
                    mapping, horizontal: hit.axis === 'x', current: hit.axis === 'x' ? zoom.x : zoom.y, clientX, clientY, invalid: strings.specRangeErrorMinMax,
                    set(range) { windows.set(name, hit.axis === 'x' ? { ...zoom, x: range } : { ...zoom, y: range }); schedule(); },
                });
                return true;
            },
        });
    }

    return {
        window: plotWindow,
        keepWindow,
        noteResult(filePath: string, result: ScanResult): void {
            version++;
            const bands = result.thirdOctDb;
            if (result.ok && bands?.length) levels.set(filePath, bands[0].map((_, bandIndex) => powerMeanOrNull(bands.map(channel => channel[bandIndex]))));
            else levels.delete(filePath);
            if (result.ok && result.input?.unit !== undefined && result.input.unit !== 'FS') calibrated.add(filePath);
            else calibrated.delete(filePath);
        },
        clear(): void {
            levels.clear();
            calibrated.clear();
            version++;
        },
        schedule,
        attach,
    };
}
