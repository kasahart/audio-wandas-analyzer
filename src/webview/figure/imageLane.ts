/**
 * An image lane of a Figure (a spectrogram, a roughness, a cepstrogram): its cells painted where the picture says
 * they are (配置: each cell's edges are layer 2's, figures/thinning.py), its colour bar, and the scale of its axis up
 * (logarithmic for frequencies). Signed values (a cepstrogram's coefficients) are painted blue below zero, white at
 * zero and red above, as wandas draws them (RdBu_r); every other value in grey levels. Layer 3's
 * alone: a colour is a conversion between a level and what is seen, never a value; the colour range is the picture's
 * confirmed one (計算イ), not decided here. No cell is chosen or averaged here: every cell the picture sends is drawn.
 */
import type { AxisScale, ValueScale } from './axisScale';
import type { DrawnImage } from './picturePoints';

/** The room right of an image lane's plot for its colour bar: a gap, the bar, its tick labels and its name. */
export const COLOUR_BAR = { gap: 8, width: 10, labels: 34, name: 14 };
export const COLOUR_BAR_ROOM = COLOUR_BAR.gap + COLOUR_BAR.width + COLOUR_BAR.labels + COLOUR_BAR.name;

type Box = { left: number; top: number; width: number; height: number };

/** A level's shade on the colour axis `low` … `high`: black at and under the low end, white at and over the high end. */
export function shadeOf(value: number, low: number, high: number): number {
    const fraction = Math.max(0, Math.min(1, (value - low) / (high - low || 1)));
    return Math.round(fraction * 255);
}

const grey = (shade: number): string => `rgb(${shade},${shade},${shade})`;

/**
 * How an image's values are coloured: grey levels from the low end to the high end, signed about zero, or viridis
 * from the low end to the high end (a Tracks row's spectrogram: the colours its lanes have always had).
 */
export type ImagePalette = 'grey' | 'signed' | 'viridis';

/** Viridis at five evenly spaced stops (matplotlib's), drawn in 256 steps between them. */
const VIRIDIS_STOPS: ReadonlyArray<readonly [number, number, number]> = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
const VIRIDIS: readonly string[] = Array.from({ length: 256 }, (_, shade) => {
    const place = (shade / 255) * (VIRIDIS_STOPS.length - 1);
    const from = Math.min(VIRIDIS_STOPS.length - 2, Math.floor(place)), part = place - from;
    const [r, g, b] = [0, 1, 2].map(at => Math.round(VIRIDIS_STOPS[from][at] + (VIRIDIS_STOPS[from + 1][at] - VIRIDIS_STOPS[from][at]) * part));
    return `rgb(${r},${g},${b})`;
});

/** A value's colour on the colour axis `low` … `high`. Signed: by its share of the larger end's magnitude, blue below zero, red above. */
export function colourOf(value: number, low: number, high: number, palette: ImagePalette): string {
    if (palette === 'grey') return grey(shadeOf(value, low, high));
    if (palette === 'viridis') return VIRIDIS[shadeOf(value, low, high)];
    const amount = Math.max(-1, Math.min(1, value / Math.max(Math.abs(low), Math.abs(high), 1e-9)));
    const fade = Math.round(255 * (1 - Math.abs(amount)));
    return amount >= 0 ? `rgb(255,${fade},${fade})` : `rgb(${fade},${fade},255)`;
}

/** The axis up a box as a ValueScale, from an AxisScale (logarithmic for a frequency axis). */
export function upScale(scale: AxisScale, box: { top: number; height: number }): ValueScale {
    const yOf = (value: number): number => box.top + (1 - scale.fraction(value)) * box.height;
    return {
        yOf,
        yAt: value => Math.max(box.top, Math.min(box.top + box.height, yOf(value))),
        pixelsPerUnit: scale.log ? box.height / Math.log(scale.high / scale.low) : box.height / (scale.high - scale.low || 1),
        levelOf: y => scale.at(1 - (y - box.top) / box.height),
    };
}

/** Where each cell edge falls in the box (px, whole pixels so neighbouring cells meet without a seam). */
const edgePixels = (edges: readonly number[], start: number, length: number, fraction: (value: number) => number, flip: boolean): number[] =>
    edges.map(edge => { const at = fraction(edge); return Math.round(start + (flip ? 1 - at : at) * length); });

/**
 * Paints `image`'s cells in `frame` on the axes `x` (across) and `y` (up), coloured on `colour` (low, high). The
 * caller clips to the frame: a cell reaching past the confirmed range is cut at the frame's side.
 */
export function paintImage(ctx: CanvasRenderingContext2D, image: DrawnImage, frame: Box, x: AxisScale, y: AxisScale, colour: readonly [number, number], palette: ImagePalette = 'grey'): void {
    const across = edgePixels(image.columnEdges, frame.left, frame.width, x.fraction, false);
    const up = edgePixels(image.rowEdges, frame.top, frame.height, y.fraction, true);
    // Where no cell is: the low end's colour under levels (silence), the zero's white under signed values.
    ctx.fillStyle = palette === 'signed' ? '#fff' : palette === 'viridis' ? VIRIDIS[0] : '#000';
    ctx.fillRect(frame.left, frame.top, frame.width, frame.height);
    image.cells.forEach((row, r) => {
        const top = Math.min(up[r], up[r + 1]), height = Math.abs(up[r] - up[r + 1]);
        if (!(height > 0)) return;
        row.forEach((cell, c) => {
            if (cell === null) return;
            const width = across[c + 1] - across[c];
            if (!(width > 0)) return;
            ctx.fillStyle = colourOf(cell, colour[0], colour[1], palette);
            ctx.fillRect(across[c], top, width, height);
        });
    });
}

/** The colour bar's box right of `frame`. */
export const colourBarBox = (frame: Box): Box => ({ left: frame.left + frame.width + COLOUR_BAR.gap, top: frame.top, width: COLOUR_BAR.width, height: frame.height });

/** Paints the colour bar right of `frame`: the colours from the low end (bottom) to the high end (top) of `colour`. */
export function paintColourBar(ctx: CanvasRenderingContext2D, frame: Box, colour: readonly [number, number] = [0, 1], palette: ImagePalette = 'grey'): void {
    const bar = colourBarBox(frame);
    const steps = Math.max(1, Math.round(bar.height));
    for (let at = 0; at < steps; at += 1) {
        ctx.fillStyle = colourOf(colour[1] - (at / Math.max(1, steps - 1)) * (colour[1] - colour[0]), colour[0], colour[1], palette);
        ctx.fillRect(bar.left, bar.top + at, bar.width, 1);
    }
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(bar.left, bar.top, bar.width, bar.height);
}
