/**
 * The entry table's side panel plots: the overview strip (the table's rows in its order, one per channel, each
 * its recording's 1/3-octave bands) and the held plot beside it, painted on the next frame with the distribution
 * above them. Each keeps its zoom as the lanes do (box zoom, Ctrl+wheel, Shift+wheel, a double click to reset or
 * to type an axis's range); a press that stays put is still a click: a row gone to on the strip.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import { rowKey, type DatasetRow } from '../../shared/dataset/datasetTable';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { commonLevelLabel } from '../../shared/utils/format';
import { levelIdentityOf } from './comparePanes';
import { installRangePopover, linearAxis, openAxisPart, type AxisMapping } from '../rangePopover';
import type { HeldPicture } from './entryHeldPlot';
import { OVERVIEW_MARGINS, paintOverview } from './entryPlots';
import { attachPlotInteraction, FULL_PLOT_WINDOW, plotPointIn, type PlotMargins, type PlotWindow } from './plotInteraction';
import { positionPopover } from './settingsPopover';
import { BAND_CENTERS_HZ } from './entryTable';
import { STAGE_MARGINS, type StagePlot } from './stagePanes';
import { createPlotHoverLayer } from './plotHoverLayer';

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
    /** The focused table row's key (rowKey: a channel's row of a recording of several), for the strip's mark. */
    focusedRow(): string | null;
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
    /** A table row's 1/3-octave levels as the strip draws them (its key: rowKey), once its recording is scanned. */
    levels(key: string): readonly (number | null)[] | undefined;
    /** A result arrived: its recording's bands (each channel's, a row per channel as the table has) are kept for the strip. */
    noteResult(filePath: string, result: ScanResult): void;
    /** Another folder: no bands kept. */
    clear(): void;
    /** The level reference the scanned recordings share ("dBFS", "dB SPL re 20 µPa"), plain dB when they differ: the overview's colour scale and the table's level values name it. */
    levelLabel(): string;
    /** A level value's name ("Leq A特性{uncal} [{label}]"): the most common reference, and 未校正 while it is uncalibrated. */
    levelName(template: string): string;
    /**
     * Whether a recording's levels are of the level identity (R1: unit, reference value, level reference name) `levelLabel` names: the one test every level axis beside the
     * table (the overview's colours, the distribution's value axis) keeps its levels to. A recording not scanned yet is not.
     */
    onLevelAxis(filePath: string): boolean;
    /** The side plots painted on the next frame; `distribution`: the distribution too, not only the strip's window. */
    schedule(distribution?: boolean): void;
    /** The gestures on the plots, and a click on the strip. */
    attach(): void;
}

/** The strip's band axis: log in Hz, from the lowest band's lower edge to the highest band's upper edge. */
function bandAxis(label: string): AxisMapping {
    const step = Math.sqrt(BAND_CENTERS_HZ[1] / BAND_CENTERS_HZ[0]);
    const low = BAND_CENTERS_HZ[0] / step, high = BAND_CENTERS_HZ[BAND_CENTERS_HZ.length - 1] * step;
    return { at: f => low * (high / low) ** f, of: v => Math.log(v / low) / Math.log(high / low), label };
}

export function createSidePlots(deps: SidePlotsDeps): SidePlots {
    const { document, strings, screen, side, body, tableWrap, overview, heldCanvas } = deps;
    // The held plot's pointer marks and readout (R7): its readout in its own head row, just above it.
    // In the entry screen: maximized, it is laid over the window above the page, and the marks must be above it.
    const marks = createPlotHoverLayer(document, '', screen);
    let pointer: { plot: HTMLElement; clientX: number; clientY: number } | null = null;
    /** What the strip last drew, for its readout. */
    let overviewDrawn: StagePlot | null = null;
    const showMarks = (): void => {
        const drawn = pointer?.plot === heldCanvas ? deps.heldPicture()?.drawn ?? null : overviewDrawn;
        if (!pointer || !drawn || pointer.plot.closest('[hidden]')) { marks.hide(); return; }
        // Each plot's readout row is just above it.
        const slot = pointer.plot === heldCanvas ? heldCanvas.parentElement?.querySelector<HTMLElement>('[data-plot-readout]')
            : overview.closest('.entry-overview-box')?.querySelector<HTMLElement>('[data-plot-readout]');
        marks.show(pointer.plot, drawn, pointer.clientX, pointer.clientY, slot ?? null);
    };
    const windows = new Map<string, PlotWindow>();
    const windowKeys = new Map<string, string>();
    const plotWindow = (name: string): PlotWindow => windows.get(name) ?? FULL_PLOT_WINDOW;
    function keepWindow(name: string, key: string): PlotWindow {
        if (windowKeys.get(name) !== key) { windowKeys.set(name, key); windows.delete(name); }
        return plotWindow(name);
    }
    /**
     * Each scanned recording's bands by table row (a channel's own, keyed as its row: rowKey) and the level reference
     * wandas names its levels by, kept as results arrive so scrolling does not redo them.
     */
    const levels = new Map<string, (number | null)[]>();
    /** The rows of `levels` each recording has, so a result that replaces it takes all of them away. */
    const levelRows = new Map<string, string[]>();
    /** Each recording's level identity (R1: unit, reference value, level reference name) and the name it is written by. */
    const levelLabels = new Map<string, { identity: string; label: string }>();
    /** The recordings scanned with a calibration (their levels are not relative to full scale). */
    const calibrated = new Set<string>();
    /** Bumped on every change to them, so the strip knows when to draw its cells again. */
    let version = 0;
    let shared: { version: number; identity: string; label: string; calibrated: boolean; levels: Map<string, (number | null)[]> } = { version: -1, identity: '', label: '', calibrated: false, levels: new Map() };
    /**
     * The scanned recordings' level reference as wandas names it (the most common one), whether all of theirs are
     * calibrated, and the levels of only the recordings in it: a level of another reference is never coloured on the
     * same scale. Once per change rather than per call.
     */
    function reference(): typeof shared {
        if (shared.version === version) return shared;
        // The most common level identity (R1, the one the comparison and the backend use), named by its reference's label.
        const identity = commonLevelLabel([...levelLabels.values()].map(own => own.identity));
        const files = [...levelLabels].filter(([, own]) => own.identity === identity).map(([path]) => path);
        const label = files.length ? levelLabels.get(files[0])?.label ?? 'dBFS' : 'dBFS';
        const keys = new Set(files.flatMap(path => levelRows.get(path) ?? []));
        shared = { version, identity, label, calibrated: files.length > 0 && files.every(path => calibrated.has(path)), levels: new Map([...levels].filter(([key]) => keys.has(key))) };
        return shared;
    }
    const levelLabel = (): string => reference().label;
    /** A level value's name: the template with the reference and, while uncalibrated, the word that says so (R4). */
    const levelName = (template: string): string => template.replace('{uncal}', reference().calibrated ? '' : strings.axisUncalibrated).replace('{label}', reference().label);
    const pending = { frame: false, distribution: true };

    function paint(): void {
        if (pending.distribution) { pending.distribution = false; deps.paintDistribution(); }
        // The side plots are drawn only while the table is wide enough to show them.
        if (screen.hidden || !side.offsetWidth) { marks.hide(); return; }
        const rows = deps.rows();
        const rowHeight = (body.querySelector('tr') as HTMLElement | null)?.offsetHeight || 22;
        const first = Math.floor(tableWrap.scrollTop / rowHeight);
        const level = reference();
        overviewDrawn = paintOverview(overview, strings, rows, level.levels, { first, last: first + Math.ceil(tableWrap.clientHeight / rowHeight) - 2 }, deps.focusedRow(), keepWindow('overview', String(rows.length)),
            { label: level.label, calibrated: level.calibrated }, version).drawn;
        // The zoom on each plot, for tests: "x0-x1|y0-y1".
        for (const [name, canvas] of [['overview', overview], ['held', heldCanvas]] as const) {
            const zoom = plotWindow(name);
            canvas.dataset.window = `${zoom.x.start.toFixed(3)}-${zoom.x.end.toFixed(3)}|${zoom.y.start.toFixed(3)}-${zoom.y.end.toFixed(3)}`;
        }
        deps.paintHeld();
        // Drawn anew under a still pointer (a zoom, the held picture coming in): the marks follow; let go, they go.
        showMarks();
    }
    function schedule(distribution = true): void {
        pending.distribution ||= distribution;
        if (pending.frame) return;
        pending.frame = true;
        deps.window.requestAnimationFrame(() => { pending.frame = false; paint(); });
    }

    function attach(): void {
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
                pointer = hit && !hit.axis ? { plot: hit.plot, clientX: event.clientX, clientY: event.clientY } : null;
                showMarks();
                // A point's name stays where hints go while the pointer is on it.
                if (!hit) return;
                // A plot that says what it is (the strip) keeps saying it, before the gestures.
                const own = hit.plot.getAttribute('data-hint');
                const gestures = hit.axis ? strings.compareHintAxis : strings.compareHintPlot;
                document.getElementById('hint-footer')?.replaceChildren(own ? `${own} · ${gestures}` : gestures);
            },
            clearHover() { pointer = null; marks.hide(); /* the panel's own hints stay */ },
            stepFrom(plot, delta, arrived) { return marks.stepFrom(plot, plot === heldCanvas ? deps.heldPicture()?.drawn ?? null : overviewDrawn, delta, arrived); },
            // A press on the strip that stayed put (a drag zooms instead) goes to the row under it.
            tap(plot, event) {
                // The second press of a double click (which resets the zoom) picks nothing: the first already did.
                if (plot !== overview || event.detail > 1) return;
                const rows = deps.rows();
                const box = overview.getBoundingClientRect();
                // The strip's rows (top first) over the part of it on screen.
                const zoom = plotWindow('overview');
                const plotTop = box.top + OVERVIEW_MARGINS.top, plotHeight = box.height - OVERVIEW_MARGINS.top - OVERVIEW_MARGINS.bottom;
                const row = rows[Math.floor(((1 - zoom.y.end) + (event.clientY - plotTop) / Math.max(1, plotHeight) * (zoom.y.end - zoom.y.start)) * rows.length)];
                if (row) deps.pickRow(row.key);
            },
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
                const zoom = plotWindow(name);
                if (name === 'overview' && hit.axis === 'y') {
                    // The strip's rows, counted down from the top as its axis counts them: its window runs up from the bottom.
                    const total = deps.rows().length;
                    openAxisPart(rangePopover, {
                        mapping: linearAxis(0, total, strings.axisEntryRows), horizontal: false, current: { start: 1 - zoom.y.end, end: 1 - zoom.y.start }, clientX, clientY, invalid: strings.specRangeErrorMinMax,
                        set(range) { windows.set(name, { ...zoom, y: { start: 1 - range.end, end: 1 - range.start } }); schedule(); },
                    });
                    return true;
                }
                const picture = deps.heldPicture();
                const mapping: AxisMapping | null = name === 'held' && picture ? (hit.axis === 'x' ? { at: picture.x, of: picture.ofX, label: picture.xLabel } : linearAxis(picture.range.min, picture.range.max, picture.yLabel))
                    : name === 'overview' ? bandAxis(strings.axisBand) : null;
                if (!mapping) return false;
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
        levelLabel,
        levelName,
        onLevelAxis: filePath => levelLabels.get(filePath)?.identity === reference().identity,
        levels: key => levels.get(key),
        noteResult(filePath: string, result: ScanResult): void {
            version++;
            const bands = result.thirdOctDb;
            for (const key of levelRows.get(filePath) ?? []) levels.delete(key);
            levelRows.delete(filePath);
            if (result.ok && bands?.length) {
                // A row per channel, as the table has: each channel's own levels.
                const keys = bands.map((channel, index) => { const key = rowKey(filePath, index + 1, bands.length); levels.set(key, channel); return key; });
                levelRows.set(filePath, keys);
            }
            if (result.ok && result.input) levelLabels.set(filePath, { identity: levelIdentityOf(result.input), label: result.input.levelReferenceLabel });
            else levelLabels.delete(filePath);
            if (result.ok && result.input?.calibrationStatus === 'calibrated') calibrated.add(filePath);
            else calibrated.delete(filePath);
        },
        clear(): void {
            levels.clear();
            levelRows.clear();
            levelLabels.clear();
            calibrated.clear();
            version++;
        },
        schedule,
        attach,
    };
}
