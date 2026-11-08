import type { Palette } from '../../shared/gui-core/index';

/** A matrix cell's place: its row and column, or row −1 for none. */
export interface HeatmapCell {
    row: number;
    column: number;
}

/** The pixels of a heatmap and, for the pointer, the cell each pixel shows. */
export interface HeatmapRaster {
    /** The cell drawn at pixel (px, py) of the raster, or row −1 for none. */
    cellAt(px: number, py: number): HeatmapCell;
}

/** What a heatmap is drawn from: its cells, which of them each pixel line and column covers, and how a cell is coloured. */
export interface HeatmapRasterInput {
    /** Rows of cells; null or undefined for a cell with no value. */
    matrix: readonly (readonly (number | null | undefined)[])[];
    width: number;
    height: number;
    /** The rows [first, after) each pixel line covers, top line first; null for none. */
    rowSpans: readonly (readonly [number, number] | null)[];
    /** The columns [first, after) each pixel column covers; null for none. */
    columnSpans: readonly (readonly [number, number] | null)[];
    /** Whether the strongest cell is the largest magnitude (a signed picture) rather than the largest value. */
    signed: boolean;
    /** A cell's colour as the canvas stores it (ABGR in one 32-bit number). */
    colour: (cell: number, row: number, column: number) => number;
}

/**
 * Paints a heatmap into `pixels` (ABGR, `width` × `height`): each pixel shows the strongest of the cells it covers
 * (R2: a peak is never thinned away), the first met in row order when several are as strong. A NaN cell is empty, as
 * a missing one is. Pixels covering no cell are left as they are.
 *
 * This runs for every heatmap on every zoom, pan and resize (a track's spectrogram lane, Compare's pictures), so it
 * allocates nothing per pixel, and it takes the cheaper of two ways to the same cells: each pixel scanning the cells
 * it covers, or (when a pixel covers many columns) each row's peaks across the pixel columns found once, then
 * compared down the rows each pixel line covers.
 */
export function rasterizeHeatmap(input: HeatmapRasterInput, pixels: Uint32Array, way: 'cheaper' | 'scan' | 'row-peaks' = 'cheaper'): HeatmapRaster {
    const { matrix, width, height, rowSpans, columnSpans, signed, colour } = input;
    let columnCells = 0, rowCells = 0, minRow = Infinity, maxRow = -1;
    for (let px = 0; px < width; px++) { const span = columnSpans[px]; if (span) columnCells += span[1] - span[0]; }
    for (let py = 0; py < height; py++) {
        const span = rowSpans[py];
        if (!span) continue;
        rowCells += span[1] - span[0];
        minRow = Math.min(minRow, span[0]);
        maxRow = Math.max(maxRow, span[1]);
    }
    // Scanning every pixel's cells costs (columns per pixel) × (rows per line) per pixel; the row peaks cost each
    // row covered once across the columns, then a comparison per row per pixel.
    const byRowPeaks = way === 'cheaper' ? (maxRow - minRow) * columnCells + width * rowCells < columnCells * rowCells : way === 'row-peaks';
    const shownAt = byRowPeaks ? rowPeakPicker(matrix, width, columnSpans, signed) : cellScanPicker(matrix, columnSpans, signed);
    const cell = { row: -1, column: -1 };
    // Zoomed in, a cell covers many pixels side by side: its colour is worked out once for them.
    let colouredRow = -1, colouredColumn = -1, coloured = 0;
    for (let py = 0; py < height; py++) {
        const span = rowSpans[py];
        if (!span) continue;
        const offset = py * width;
        for (let px = 0; px < width; px++) {
            if (!shownAt(px, span, cell)) continue;
            if (cell.row !== colouredRow || cell.column !== colouredColumn) {
                colouredRow = cell.row;
                colouredColumn = cell.column;
                coloured = colour(matrix[cell.row][cell.column] as number, cell.row, cell.column);
            }
            pixels[offset + px] = coloured;
        }
    }
    return {
        cellAt: (px, py) => {
            const span = px >= 0 && px < width && py >= 0 && py < height ? rowSpans[py] : null;
            // One pixel: its cells scanned again, which gives the cell either way chose.
            const found = { row: -1, column: -1 };
            return span && cellScanPicker(matrix, columnSpans, signed)(px, span, found) ? found : { row: -1, column: -1 };
        },
    };
}

/** Writes into `cell` the strongest cell pixel column `px` shows over the rows `rows`; false for none. */
type CellPicker = (px: number, rows: readonly [number, number], cell: HeatmapCell) => boolean;

/** Each pixel's cells scanned in row order: the first non-empty cell, then any stronger one. */
function cellScanPicker(matrix: HeatmapRasterInput['matrix'], columnSpans: HeatmapRasterInput['columnSpans'], signed: boolean): CellPicker {
    return (px, rows, cell) => {
        const columns = columnSpans[px];
        if (!columns) return false;
        let bestRow = -1, bestColumn = -1, bestKey = -Infinity;
        for (let row = rows[0]; row < rows[1]; row++) {
            const cells = matrix[row];
            if (!cells) continue;
            for (let column = columns[0]; column < columns[1]; column++) {
                const value = cells[column];
                // Not a number (NaN) is no value, as an empty cell.
                if (value === null || value === undefined || value !== value) continue;
                const key = signed ? Math.abs(value) : value;
                if (bestRow < 0 || key > bestKey) { bestRow = row; bestColumn = column; bestKey = key; }
            }
        }
        if (bestRow < 0) return false;
        cell.row = bestRow;
        cell.column = bestColumn;
        return true;
    };
}

/**
 * Each row's peak across each pixel column found once (when first asked), then the strongest of those peaks down a
 * pixel line's rows: the same cell the scan finds, as both keep the first of equally strong cells in row order.
 */
function rowPeakPicker(matrix: HeatmapRasterInput['matrix'], width: number, columnSpans: HeatmapRasterInput['columnSpans'], signed: boolean): CellPicker {
    const peakColumns: (Int32Array | undefined)[] = new Array<Int32Array | undefined>(matrix.length);
    const peakKeys: (Float64Array | undefined)[] = new Array<Float64Array | undefined>(matrix.length);
    const peaksOf = (row: number): void => {
        if (peakColumns[row]) return;
        const peaks = new Int32Array(width).fill(-1), keys = new Float64Array(width);
        const cells = matrix[row] ?? [];
        for (let px = 0; px < width; px++) {
            const span = columnSpans[px];
            if (!span) continue;
            let best = -1, bestKey = -Infinity;
            for (let column = span[0]; column < span[1]; column++) {
                const value = cells[column];
                // Not a number (NaN) is no value, as an empty cell.
                if (value === null || value === undefined || value !== value) continue;
                const key = signed ? Math.abs(value) : value;
                if (best < 0 || key > bestKey) { best = column; bestKey = key; }
            }
            peaks[px] = best;
            keys[px] = bestKey;
        }
        peakColumns[row] = peaks;
        peakKeys[row] = keys;
    };
    return (px, rows, cell) => {
        let bestRow = -1, bestColumn = -1, bestKey = -Infinity;
        for (let row = rows[0]; row < rows[1]; row++) {
            peaksOf(row);
            const at = (peakColumns[row] as Int32Array)[px];
            if (at < 0) continue;
            const key = (peakKeys[row] as Float64Array)[px];
            if (bestRow < 0 || key > bestKey) { bestRow = row; bestColumn = at; bestKey = key; }
        }
        if (bestRow < 0) return false;
        cell.row = bestRow;
        cell.column = bestColumn;
        return true;
    };
}

/** An opaque colour as the canvas stores it in one 32-bit number (ABGR). */
export function packRgb(r: number, g: number, b: number): number {
    return (255 << 24 | b << 16 | g << 8 | r) >>> 0;
}

/** Its red, green and blue back from a packed colour. */
export function unpackRgb(colour: number): [number, number, number] {
    return [colour & 255, (colour >>> 8) & 255, (colour >>> 16) & 255];
}

/**
 * The palette's colour at `norm` (0–1), packed: the same colour as gui-core's normalizedColor gives, worked out
 * without the arrays it makes, as it is asked once per pixel.
 */
export function paletteColour(norm: number, palette: Palette): number {
    norm = norm >= 0 ? Math.min(norm, 1) : 0;
    const stops = palette.stops;
    const position = norm * (stops.length - 1), lower = Math.floor(position), upper = Math.min(lower + 1, stops.length - 1), fraction = position - lower;
    const round = palette.rounding === 'floor' ? Math.floor : Math.round;
    const a = stops[lower], b = stops[upper];
    return packRgb(round(a[0] + (b[0] - a[0]) * fraction), round(a[1] + (b[1] - a[1]) * fraction), round(a[2] + (b[2] - a[2]) * fraction));
}
