/**
 * The entry screen's overview strip: the table's rows as their 1/3-octave levels (a row per recording's channel,
 * bright = loud), drawn by the one plot component as a heatmap (R13). The rows on screen are framed and the focused
 * one marked by elements laid over the plot, so scrolling the table moves them without drawing the cells again.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { StageView } from '../../shared/protocol/backendProtocol';
import { BAND_CENTERS_HZ, type EntryRow } from './entryTable';
import { FULL_PLOT_WINDOW, type PlotMargins, type PlotWindow } from './plotInteraction';
import { paintOverlay, type StagePlot } from './stagePanes';
import type { InlineFullSource } from './fullRead';
import { heatmapDbRange } from '../../shared/utils/ticks';

/** The strip's margins: its row axis at the left, the frequency axis below, the colour bar inside the plot's top right. */
export const OVERVIEW_MARGINS: PlotMargins = { left: 30, top: 2, right: 4, bottom: 16 };

/**
 * The strip's rows as a heatmap: a column per band and, in the part of the table in `window`, a row per table row, or
 * where there are more rows than the plot has pixel lines, a row per line holding each band's loudest level there
 * (100,000 rows would otherwise be millions of cells). Rows are placed at minus their place in the table (the
 * picture's rows run up from its bottom), so the axis counts the table's rows down from the top. The colour range is
 * every row's, not only the window's: zooming does not change what a shade means.
 */
/** A table row as the strip reads it: its recording, and the channel it is (`key`, rowKey) when it is one of several. */
export type OverviewRow = Pick<EntryRow, 'filePath'> & { key?: string; ch?: number; channels?: number };

/** A row's name in the readout: its file, and its channel when the recording has more than one. */
const rowName = (row: OverviewRow): string => `${fileName(row.filePath)}${(row.channels ?? 1) > 1 && row.ch ? ` ch${row.ch}` : ''}`;

export function overviewPicture(
    rows: ReadonlyArray<OverviewRow>,
    bands: ReadonlyMap<string, (number | null)[]>,
    window: PlotWindow,
    lines: number,
): { view: StageView; whole: StageView; names: string[][]; range: { min: number; max: number } } | null {
    const bandCount = BAND_CENTERS_HZ.length;
    const total = rows.length;
    const firstRow = Math.max(0, Math.floor((1 - window.y.end) * total));
    const lastRow = Math.min(total, Math.ceil((1 - window.y.start) * total));
    const count = Math.max(0, lastRow - firstRow);
    const binned = count > lines;
    const cellsTotal = binned ? lines : count;
    const loudest: (number | null)[][] = Array.from({ length: cellsTotal }, () => new Array<number | null>(bandCount).fill(null));
    // Per cell and band, the file whose level it shows (the loudest of a line's rows), so the readout names the
    // recording its value is from; a cell with no level names the line's first row.
    const names: string[][] = Array.from({ length: cellsTotal }, () => new Array<string>(bandCount).fill(''));
    let low = Infinity, high = -Infinity;
    // One pass, loops not spreads (a large folder has more levels than a call can take as arguments).
    for (let index = 0; index < total; index++) {
        const levels = bands.get(rows[index].key ?? rows[index].filePath);
        const cell = index >= firstRow && index < lastRow ? (binned ? Math.min(lines - 1, Math.floor((index - firstRow) * lines / count)) : index - firstRow) : -1;
        if (cell >= 0 && !names[cell][0]) names[cell].fill(rowName(rows[index]));
        if (!levels) continue;
        for (let band = 0; band < Math.min(bandCount, levels.length); band++) {
            const value = levels[band];
            if (value === null || value === undefined) continue;
            if (value < low) low = value;
            if (value > high) high = value;
            if (cell >= 0) {
                const was = loudest[cell][band];
                if (was === null || value > was) { loudest[cell][band] = value; names[cell][band] = rowName(rows[index]); }
            }
        }
    }
    if (!Number.isFinite(low)) return null;
    // Each picture row's centre, in table rows (negative: down from the top); bottom first, as the axis runs.
    const centres = loudest.map((_, cell) => -(firstRow + (binned ? (cell + 0.5) * count / lines : cell + 0.5)));
    const order = centres.map((_, cell) => cellsTotal - 1 - cell);
    const xs = [...BAND_CENTERS_HZ];
    const view: StageView = {
        kind: 'heatmap', x: 'frequency', xScale: 'log', quantity: 'level', xs,
        ys: order.map(cell => centres[cell]), matrix: order.map(cell => loudest[cell]),
    } as StageView;
    // The whole table's axes: a zoomed strip places its part on them.
    const whole: StageView = { ...view, ys: [-total, 0], matrix: [] };
    // The colours span every table row's every band (not only the loudest each line draws), widened to round ends (R9).
    // As every heatmap's colours (R9): to the loudest level, no more than 100 dB under it.
    return { view, whole, names: order.map(cell => names[cell]), range: heatmapDbRange(low, high) };
}

const fileName = (filePath: string): string => filePath.split(/[\\/]/).at(-1) ?? filePath;

/**
 * The strip's every cell, one per table row and band, which the pointer reads (R7): a picture row holding several
 * table rows (their loudest) is only drawn; the readout names the one table row under the pointer and its level.
 */
export function overviewCells(rows: ReadonlyArray<OverviewRow>, bands: ReadonlyMap<string, (number | null)[]>): InlineFullSource {
    return {
        held: 'inline',
        cells(query) {
            const n = rows.length;
            if (!n) return null;
            // Row i sits at −(i + 0.5): the one nearest the place, and two either side.
            const row = Math.max(0, Math.min(n - 1, Math.round(-query.y - 0.5)));
            const near = (value: number): number => {
                let best = 0;
                for (let band = 1; band < BAND_CENTERS_HZ.length; band++) if (Math.abs(BAND_CENTERS_HZ[band] - value) < Math.abs(BAND_CENTERS_HZ[best] - value)) best = band;
                return best;
            };
            const column = near(query.x);
            const c0 = Math.max(0, column - query.beyond), c1 = Math.min(BAND_CENTERS_HZ.length, column + query.beyond + 1);
            // Up the axis: the lowest table row (the largest index) first.
            const indices: number[] = [];
            for (let index = Math.min(n - 1, row + 2); index >= Math.max(0, row - 2); index--) indices.push(index);
            return {
                xs: BAND_CENTERS_HZ.slice(c0, c1), ys: indices.map(index => -(index + 0.5)),
                matrix: indices.map(index => { const levels = bands.get(rows[index].key ?? rows[index].filePath); return BAND_CENTERS_HZ.slice(c0, c1).map((_, band) => levels?.[c0 + band] ?? null); }),
                rowNames: indices.map(index => rowName(rows[index])),
                start: c0 > 0 ? BAND_CENTERS_HZ[c0] : null, end: c1 < BAND_CENTERS_HZ.length ? BAND_CENTERS_HZ[c1 - 1] : null, complete: true,
            };
        },
    };
}

export interface OverviewPaint {
    /** Where the cells are, for the pointer; null when no row has a level. */
    drawn: StagePlot | null;
}

/**
 * Draws the strip when what it shows changed (`bandsVersion`, the rows, the window, the canvas' size or the level's
 * name), and lays the frame of the rows on screen and the focused row's mark over it every time.
 */
export function paintOverview(
    canvas: HTMLCanvasElement,
    strings: Pick<UiStrings, 'axisBand' | 'axisEntryRows' | 'axisLevelCal' | 'axisLevelUncal'>,
    rows: ReadonlyArray<OverviewRow>,
    bands: ReadonlyMap<string, (number | null)[]>,
    visible: { first: number; last: number },
    /** The focused table row's key (rowKey), marked on the strip. */
    focused: string | null,
    /** The part on screen (zoomed): x of the bands, y of the rows (0 at the bottom). */
    window: PlotWindow = FULL_PLOT_WINDOW,
    /** The colour's name: what the levels are, with their reference. */
    level: { label: string; calibrated: boolean } = { label: 'dBFS', calibrated: false },
    /** Changes whenever `bands` does: with the same rows, window and size the cells are kept, not drawn again. */
    bandsVersion?: number,
): OverviewPaint {
    const { left, top, right, bottom } = OVERVIEW_MARGINS;
    const width = canvas.clientWidth || 400, height = canvas.clientHeight || 120;
    const plotWidth = Math.max(1, width - left - right), plotHeight = Math.max(1, height - top - bottom);
    const colour = (level.calibrated ? strings.axisLevelCal : strings.axisLevelUncal).replace('{label}', level.label);
    // The theme's colours and the screen's pixel ratio too: a theme switch or another monitor draws the cells again.
    const view = canvas.ownerDocument.defaultView;
    const style = view?.getComputedStyle(canvas);
    const theme = ['--text', '--muted', '--line'].map(name => style?.getPropertyValue(name).trim() ?? '').join(',');
    const key = `${bandsVersion}|${width}x${height}@${view?.devicePixelRatio ?? 1}|${window.x.start},${window.x.end},${window.y.start},${window.y.end}|${colour}|${theme}`;
    const cached = overviewCache.get(canvas);
    let drawn: StagePlot | null;
    if (bandsVersion !== undefined && cached && cached.key === key && cached.rows === rows) drawn = cached.drawn;
    else {
        const picture = overviewPicture(rows, bands, window, Math.ceil(plotHeight));
        drawn = paintOverlay(canvas, { layers: picture ? [{ view: picture.view, color: '', rowName: (row, column) => picture.names[row]?.[column] ?? '', full: overviewCells(rows, bands) }] : [] }, picture?.range ?? { min: 0, max: 1 },
            { x: strings.axisBand, y: strings.axisEntryRows, colour }, {
                margins: OVERVIEW_MARGINS,
                window: { x: window.x, y: window.y }, axisView: picture?.whole ?? null,
                // The rows are counted down from the top: a row's place is minus its value.
                yTickText: value => String(Math.round(Math.abs(value))),
            });
        overviewCache.set(canvas, { key, rows, drawn });
    }
    // The rows on screen framed, the focused one marked, over the plot (clipped to it).
    const rowTop = (index: number): number => top + (index / Math.max(1, rows.length) - (1 - window.y.end)) / (window.y.end - window.y.start || 1) * plotHeight;
    const holder = canvas.parentElement;
    const frame = holder?.querySelector<HTMLElement>('[data-entry-overview-frame]');
    const mark = holder?.querySelector<HTMLElement>('[data-entry-overview-focus]');
    const clip = (y0: number, y1: number): { top: number; height: number } | null => {
        const a = Math.max(top, y0), b = Math.min(top + plotHeight, y1);
        return b > a ? { top: a, height: b - a } : null;
    };
    const place = (element: HTMLElement | null | undefined, box: { top: number; height: number } | null, x: number, w: number): void => {
        if (!element) return;
        element.hidden = !drawn || !box;
        if (box) Object.assign(element.style, { left: `${canvas.offsetLeft + x}px`, top: `${canvas.offsetTop + box.top}px`, width: `${w}px`, height: `${box.height}px` });
    };
    place(frame, visible.last >= visible.first ? clip(rowTop(visible.first), rowTop(visible.last + 1)) : null, left, plotWidth);
    const at = rows.findIndex(row => (row.key ?? row.filePath) === focused);
    place(mark, at >= 0 ? clip(rowTop(at), Math.max(rowTop(at) + 2, rowTop(at + 1))) : null, left, 3);
    return { drawn };
}

const overviewCache = new WeakMap<HTMLCanvasElement, { key: string; rows: ReadonlyArray<OverviewRow>; drawn: StagePlot | null }>();
