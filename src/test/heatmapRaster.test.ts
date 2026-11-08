import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedColor, viridis, type Palette } from '../shared/gui-core/index';
import { packRgb, paletteColour, rasterizeHeatmap, unpackRgb, type HeatmapRasterInput } from '../webview/plot/heatmapRaster';

type Cell = number | null | undefined;
type Span = readonly [number, number] | null;

/** A small deterministic generator, so a failing case can be run again. */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}

/**
 * The rule written out as plainly as it reads: each pixel shows the strongest of the cells it covers, the first met
 * in row order (then column order) when several are as strong; empty cells (and NaN, no number) are skipped.
 */
function referenceCell(matrix: readonly (readonly Cell[])[], rows: Span, columns: Span, signed: boolean): { row: number; column: number } {
    let row = -1, column = -1, bestKey = -Infinity;
    if (!rows || !columns) return { row, column };
    for (let r = rows[0]; r < rows[1]; r++) {
        for (let c = columns[0]; c < columns[1]; c++) {
            const value = matrix[r]?.[c];
            if (value === null || value === undefined || Number.isNaN(value)) continue;
            const key = signed ? Math.abs(value) : value;
            if (row < 0 || key > bestKey) { row = r; column = c; bestKey = key; }
        }
    }
    return { row, column };
}

/** Spans of cells for `pixels` pixels over `cells` cells (each pixel at least one cell when zoomed in), some empty. */
function spans(next: () => number, pixels: number, cells: number): Span[] {
    return Array.from({ length: pixels }, (_, index) => {
        if (next() < 0.05) return null;
        const first = Math.floor(index / pixels * cells);
        const after = Math.max(first + 1, Math.floor((index + 1) / pixels * cells));
        return [Math.min(first, cells - 1), Math.min(after, cells)] as const;
    });
}

function caseOf(seed: number, rows: number, columns: number, width: number, height: number, signed: boolean): HeatmapRasterInput {
    const next = random(seed);
    const matrix: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => {
        const pick = next();
        if (pick < 0.04) return null;
        if (pick < 0.06) return undefined;
        if (pick < 0.07) return Number.NaN;
        if (pick < 0.09) return Number.NEGATIVE_INFINITY;
        // Few distinct levels, so ties are common.
        return Math.round((next() * 2 - 1) * 8) * 5;
    }));
    return {
        matrix, width, height, signed,
        rowSpans: spans(next, height, rows),
        columnSpans: spans(next, width, columns),
        colour: (cell, row, column) => packRgb(row & 255, column & 255, Number.isFinite(cell) ? (cell + 128) & 255 : 7),
    };
}

const SHAPES = [
    // Zoomed out: many columns and rows per pixel.
    { rows: 120, columns: 900, width: 40, height: 12 },
    // Zoomed in: a cell over several pixels.
    { rows: 30, columns: 20, width: 90, height: 60 },
    // Many rows per line, one column per pixel (a lane's spectrogram).
    { rows: 300, columns: 64, width: 64, height: 20 },
];

test('each pixel of a heatmap shows the strongest cell it covers, the first in row order on a tie, either way it is found (R2)', () => {
    for (const [index, shape] of SHAPES.entries()) {
        for (const signed of [false, true]) {
            const input = caseOf(17 + index, shape.rows, shape.columns, shape.width, shape.height, signed);
            for (const way of ['cheaper', 'scan', 'row-peaks'] as const) {
                const pixels = new Uint32Array(shape.width * shape.height);
                const raster = rasterizeHeatmap(input, pixels, way);
                for (let py = 0; py < shape.height; py++) {
                    for (let px = 0; px < shape.width; px++) {
                        const expected = referenceCell(input.matrix, input.rowSpans[py], input.columnSpans[px], signed);
                        const label = `shape ${index} signed ${signed} ${way} (${px}, ${py})`;
                        assert.deepEqual(raster.cellAt(px, py), expected, label);
                        const colour = expected.row < 0 ? 0 : input.colour(input.matrix[expected.row][expected.column] as number, expected.row, expected.column);
                        assert.equal(pixels[py * shape.width + px], colour, label);
                    }
                }
            }
        }
    }
});

test('a pixel covering no cell, or past the raster, keeps what was there and reads no cell', () => {
    const input = caseOf(5, 4, 4, 4, 4, false);
    const blank = { ...input, rowSpans: [null, null, null, null] };
    const pixels = new Uint32Array(16).fill(123);
    const raster = rasterizeHeatmap(blank, pixels);
    assert.ok(pixels.every(value => value === 123));
    assert.deepEqual(raster.cellAt(0, 0), { row: -1, column: -1 });
    assert.deepEqual(rasterizeHeatmap(input, new Uint32Array(16)).cellAt(4, 0), { row: -1, column: -1 });
});

test('a heatmap reads each cell about once per pixel it can show it in, not once per row of every pixel line (no regression to the slow lanes)', () => {
    // A lane's spectrogram after a zoom: 862 pixel columns over 1,500 STFT frames, 96 pixel lines over 513 bins.
    const width = 862, height = 96, rows = 513, columns = 1500;
    const next = random(3);
    const cells = Array.from({ length: rows }, () => Array.from({ length: columns }, () => next() * 100 - 120));
    let reads = 0;
    const counted = cells.map(row => new Proxy(row, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } }));
    const span = (pixels: number, count: number): Span[] => Array.from({ length: pixels }, (_, index) =>
        [Math.floor(index / pixels * count), Math.max(Math.floor(index / pixels * count) + 1, Math.floor((index + 1) / pixels * count))] as const);
    let colours = 0;
    rasterizeHeatmap({ matrix: counted, width, height, rowSpans: span(height, rows), columnSpans: span(width, columns), signed: false, colour: () => { colours++; return 0; } }, new Uint32Array(width * height));
    // Every cell once (the scan reads each pixel's own cells; one more read per pixel for its colour).
    assert.ok(reads <= rows * columns + width * height, `${reads} reads`);
    assert.ok(colours <= width * height, `${colours} colours`);
});

test('a palette colour, packed, is the colour gui-core\'s normalizedColor gives at every level', () => {
    const floor: Palette = { stops: [[0, 0, 0], [10, 200, 255], [255, 255, 255]], rounding: 'floor' };
    for (const palette of [viridis, floor]) {
        for (const norm of [-1, 0, 1e-9, 0.25, 0.3333, 0.5, 0.75, 0.999999, 1, 2, Number.NaN, ...Array.from({ length: 512 }, (_, index) => index / 511)]) {
            assert.deepEqual(unpackRgb(paletteColour(norm, palette)), normalizedColor(norm, palette), `${norm}`);
        }
    }
});
