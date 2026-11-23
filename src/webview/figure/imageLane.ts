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

type Rgb = readonly [number, number, number];

/**
 * How an image's values are coloured: grey levels from the low end to the high end, signed about zero, or viridis
 * from the low end to the high end (a Tracks row's spectrogram: the colours its lanes have always had).
 */
export type ImagePalette = 'grey' | 'signed' | 'viridis';

/** Viridis at five evenly spaced stops (matplotlib's), drawn in 256 steps between them. */
const VIRIDIS_STOPS: readonly Rgb[] = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
const VIRIDIS: readonly Rgb[] = Array.from({ length: 256 }, (_, shade): Rgb => {
    const place = (shade / 255) * (VIRIDIS_STOPS.length - 1);
    const from = Math.min(VIRIDIS_STOPS.length - 2, Math.floor(place)), part = place - from;
    const mix = (at: 0 | 1 | 2): number => Math.round(VIRIDIS_STOPS[from][at] + (VIRIDIS_STOPS[from + 1][at] - VIRIDIS_STOPS[from][at]) * part);
    return [mix(0), mix(1), mix(2)];
});

/** A value's colour on the colour axis `low` … `high` as red, green, blue. Signed: by its share of the larger end's magnitude, blue below zero, red above. */
function rgbOf(value: number, low: number, high: number, palette: ImagePalette): Rgb {
    if (palette === 'grey') { const shade = shadeOf(value, low, high); return [shade, shade, shade]; }
    if (palette === 'viridis') return VIRIDIS[shadeOf(value, low, high)];
    const amount = Math.max(-1, Math.min(1, value / Math.max(Math.abs(low), Math.abs(high), 1e-9)));
    const fade = Math.round(255 * (1 - Math.abs(amount)));
    return amount >= 0 ? [255, fade, fade] : [fade, fade, 255];
}

/** A value's colour on the colour axis `low` … `high`, as a canvas writes it. */
export function colourOf(value: number, low: number, high: number, palette: ImagePalette): string {
    const [r, g, b] = rgbOf(value, low, high, palette);
    return `rgb(${r},${g},${b})`;
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

/** Where no cell is: the low end's colour under levels (silence), the zero's white under signed values. */
export const emptyColourOf = (palette: ImagePalette): string => (palette === 'signed' ? '#fff' : palette === 'viridis' ? colourOf(0, 0, 1, 'viridis') : '#000');

/**
 * An image's cells as pixels: where they are when the plot is `plotWidth` × `height` pixels on the axes `x` and `y`.
 * The pixels are measured from the image's own first edge, not from the plot's side: an image moved across (a pan)
 * has the same pixels and is only put somewhere else, so it is not made again for every move. `left` says where its
 * first pixel is from the plot's left side. An image far wider than the plot (looked at closely) is made for the
 * plot's part alone: then its pixels are of this place and are made again when it moves (`whole` false).
 */
export interface ImagePixels {
    readonly left: number;
    readonly width: number;
    readonly height: number;
    /** True when the pixels are the whole image's: another place across needs no other pixels. */
    readonly whole: boolean;
    /** Red, green, blue, alpha a pixel, rows from the top; a pixel no cell covers is clear (alpha 0). */
    readonly data: () => Uint8ClampedArray;
}

/** As many pixels across as an image is kept whole for; a wider one is made for the plot's part alone. */
export const WHOLE_IMAGE_PIXELS = 8192;

export function imagePixelsOf(image: DrawnImage, plotWidth: number, height: number, x: AxisScale, y: AxisScale, colour: readonly [number, number], palette: ImagePalette = 'grey'): ImagePixels {
    const first = x.fraction(image.columnEdges[0]);
    // Whole pixels from the image's first edge, so neighbouring cells meet without a seam wherever the image is put.
    const across = image.columnEdges.map(edge => Math.round((x.fraction(edge) - first) * plotWidth));
    const up = image.rowEdges.map(edge => Math.round((1 - y.fraction(edge)) * height));
    const start = Math.round(first * plotWidth);
    const span = across.reduce((most, edge) => Math.max(most, edge), 1);
    const whole = span <= WHOLE_IMAGE_PIXELS;
    const left = whole ? start : 0, width = whole ? span : Math.max(1, plotWidth);
    const shift = whole ? 0 : start;
    const data = (): Uint8ClampedArray => {
        const out = new Uint8ClampedArray(width * height * 4);
        // Which column a pixel across is of, and which row a pixel down is of (-1: no cell).
        const columnAt = new Int32Array(width).fill(-1), rowAt = new Int32Array(height).fill(-1);
        for (let c = 0; c + 1 < across.length; c += 1) {
            const from = Math.max(0, across[c] + shift), to = Math.min(width, across[c + 1] + shift);
            for (let px = from; px < to; px += 1) columnAt[px] = c;
        }
        for (let r = 0; r + 1 < up.length; r += 1) {
            const from = Math.max(0, Math.min(up[r], up[r + 1])), to = Math.min(height, Math.max(up[r], up[r + 1]));
            for (let py = from; py < to; py += 1) rowAt[py] = r;
        }
        // A level's colour is one of 256 (its shade); a signed value's is worked out for the value itself.
        const shades: readonly Rgb[] | null = palette === 'signed' ? null : Array.from({ length: 256 }, (_, shade): Rgb => (palette === 'viridis' ? VIRIDIS[shade] : [shade, shade, shade]));
        for (let py = 0; py < height; py += 1) {
            if (rowAt[py] < 0) continue;
            const row = image.cells[rowAt[py]];
            let at = py * width * 4;
            for (let px = 0; px < width; px += 1, at += 4) {
                const cell = columnAt[px] < 0 ? null : row[columnAt[px]];
                if (cell === null || cell === undefined) continue;
                const rgb = shades ? shades[shadeOf(cell, colour[0], colour[1])] : rgbOf(cell, colour[0], colour[1], palette);
                out[at] = rgb[0]; out[at + 1] = rgb[1]; out[at + 2] = rgb[2]; out[at + 3] = 255;
            }
        }
        return out;
    };
    return { left, width, height, whole, data };
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
