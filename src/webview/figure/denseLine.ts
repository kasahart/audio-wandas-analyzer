/**
 * Dense lines (time signals thinned to each bucket's lowest and highest sample, several points a pixel) painted as
 * the pixels their strokes cover, worked out here and put on the canvas as one image. Stroked by the canvas, a line
 * that goes up and down the lane a few times a pixel took 130 to 250 ms to paint for three of them, and over 600 ms
 * zoomed to a second or so (a tone's cycles a few pixels apart); worked out here, a few tens of ms.
 *
 * What is covered is what a round pen of the line's width covers moving along it (each segment a capsule): in each
 * device pixel column, the parts of the column within half the width of a segment, which may be several apart (the
 * background between a tone's cycles shows, as stroked). Pixels are whole: no antialiasing at the edges.
 */

/** Points a CSS px across, at least, for a line to be painted here rather than stroked. */
export const DENSE_POINTS_PER_PX = 2;

type Point = readonly [number, number];

/** Whether `points` (CSS px; null: a gap) are dense enough across to be painted here (DENSE_POINTS_PER_PX). */
export function isDense(points: ReadonlyArray<Point | null>): boolean {
    let count = 0, left = Infinity, right = -Infinity;
    for (const point of points) {
        if (!point) continue;
        count += 1;
        if (point[0] < left) left = point[0];
        if (point[0] > right) right = point[0];
    }
    return count > 2 && count >= DENSE_POINTS_PER_PX * Math.max(1, right - left);
}

/**
 * Where a capsule (the segment from a to b, widened by `r` all round) crosses the vertical line at `x`: its top and
 * bottom, or null where it does not. All in one measure (device px).
 */
export function capsuleAt(ax: number, ay: number, bx: number, by: number, r: number, x: number): [number, number] | null {
    let low = Infinity, high = -Infinity;
    // The round ends.
    for (const [px, py] of [[ax, ay], [bx, by]]) {
        const d = x - px;
        if (Math.abs(d) <= r) { const h = Math.sqrt(r * r - d * d); low = Math.min(low, py - h); high = Math.max(high, py + h); }
    }
    // The band between them: within r of the segment's line, between its two ends (two conditions linear in y).
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
    if (length > 0) {
        const ux = dx / length, uy = dy / length, along = x - ax;
        let top = -Infinity, bottom = Infinity, inside = true;
        // across = ux * (y - ay) - uy * along ∈ [-r, r];  ahead = uy * (y - ay) + ux * along ∈ [0, length]
        for (const [slope, base, min, max] of [[ux, -uy * along, -r, r], [uy, ux * along, 0, length]]) {
            if (Math.abs(slope) < 1e-12) { if (base < min || base > max) inside = false; continue; }
            let one = ay + (min - base) / slope, other = ay + (max - base) / slope;
            if (one > other) [one, other] = [other, one];
            top = Math.max(top, one);
            bottom = Math.min(bottom, other);
        }
        if (inside && top <= bottom) { low = Math.min(low, top); high = Math.max(high, bottom); }
    }
    return high >= low ? [low, high] : null;
}

/** A line to paint: its points (CSS px, null a gap), colour (#rrggbb), width (CSS px), and the stretch across it is painted over (CSS px). */
export interface DenseLine {
    points: ReadonlyArray<Point | null>;
    colour: string;
    width: number;
    from: number;
    to: number;
}

/** '#rrggbb' (or '#rgb') as a pixel of the canvas's memory (little-endian RGBA, opaque); null for any other colour. */
export function pixelOf(colour: string): number | null {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(colour.trim())?.[1];
    if (!hex) return null;
    const full = hex.length === 3 ? hex.split('').map(digit => digit + digit).join('') : hex;
    const [r, g, b] = [0, 2, 4].map(at => parseInt(full.slice(at, at + 2), 16));
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * The covered pixels of `lines`, in their order (a later one over an earlier), in a frame of `width` × `height`
 * device px whose top left is at (`left`, `top`) device px: one pixel a word (pixelOf), 0 where none is covered.
 */
export function coveredPixels(lines: readonly DenseLine[], frame: { left: number; top: number; width: number; height: number }, ratio: number): Uint32Array {
    const { width, height } = frame;
    const pixels = new Uint32Array(width * height);
    for (const line of lines) {
        const pixel = pixelOf(line.colour);
        if (pixel === null) continue;
        const r = Math.max(0.5, line.width * ratio / 2);
        const firstColumn = Math.max(0, Math.floor(line.from * ratio) - frame.left), lastColumn = Math.min(width - 1, Math.ceil(line.to * ratio) - frame.left - 1);
        if (lastColumn < firstColumn) continue;
        // Each column's covered parts, gathered per column (a column is crossed by a few segments), then joined and set.
        const parts: number[][] = Array.from({ length: lastColumn - firstColumn + 1 }, () => []);
        let before: Point | null = null;
        for (const point of line.points) {
            if (!point) { before = null; continue; }
            if (before) {
                const ax = before[0] * ratio - frame.left, ay = before[1] * ratio - frame.top, bx = point[0] * ratio - frame.left, by = point[1] * ratio - frame.top;
                const a = Math.max(firstColumn, Math.floor(Math.min(ax, bx) - r)), b = Math.min(lastColumn, Math.ceil(Math.max(ax, bx) + r));
                for (let column = a; column <= b; column += 1) {
                    const at = capsuleAt(ax, ay, bx, by, r, column + 0.5);
                    if (at) parts[column - firstColumn].push(at[0], at[1]);
                }
            } else {
                // A point alone (a gap on each side) is a dot.
                const x = point[0] * ratio - frame.left, y = point[1] * ratio - frame.top;
                for (let column = Math.max(firstColumn, Math.floor(x - r)); column <= Math.min(lastColumn, Math.ceil(x + r)); column += 1) {
                    const at = capsuleAt(x, y, x, y, r, column + 0.5);
                    if (at) parts[column - firstColumn].push(at[0], at[1]);
                }
            }
            before = point;
        }
        for (let index = 0; index < parts.length; index += 1) {
            const own = parts[index];
            if (!own.length) continue;
            const column = firstColumn + index;
            const order = Array.from({ length: own.length / 2 }, (_, at) => at).sort((one, other) => own[2 * one] - own[2 * other]);
            let start = Infinity, end = -Infinity;
            const set = (): void => {
                // A row is covered when its middle is: rows round(start) to round(end) - 1, at least the one the part is in.
                let first = Math.round(start), last = Math.round(end) - 1;
                if (last < first) { first = Math.floor((start + end) / 2); last = first; }
                for (let row = Math.max(0, first); row <= Math.min(height - 1, last); row += 1) pixels[row * width + column] = pixel;
            };
            for (const at of order) {
                const low = own[2 * at], high = own[2 * at + 1];
                if (low > end) { if (end >= start) set(); start = low; end = high; } else if (high > end) end = high;
            }
            if (end >= start) set();
        }
    }
    return pixels;
}

/**
 * Paints `lines` over `frame` (CSS px) on `ctx` (whose transform is the ratio's scale), in their order: their covered
 * pixels as one image, put over what is drawn there (only the covered pixels change). `scratch` is the canvas the
 * image is made on (kept by the caller, made again at most when the frame's size changes).
 */
export function paintDenseLines(ctx: CanvasRenderingContext2D, scratch: HTMLCanvasElement, lines: readonly DenseLine[], frame: { left: number; top: number; width: number; height: number }, ratio: number): boolean {
    const device = { left: Math.floor(frame.left * ratio), top: Math.floor(frame.top * ratio), width: 0, height: 0 };
    device.width = Math.max(1, Math.ceil((frame.left + frame.width) * ratio) - device.left);
    device.height = Math.max(1, Math.ceil((frame.top + frame.height) * ratio) - device.top);
    if (scratch.width !== device.width) scratch.width = device.width;
    if (scratch.height !== device.height) scratch.height = device.height;
    const own = scratch.getContext('2d');
    if (!own) return false;
    const image = own.createImageData(device.width, device.height);
    new Uint32Array(image.data.buffer).set(coveredPixels(lines, device, ratio));
    own.putImageData(image, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scratch, device.left, device.top);
    ctx.restore();
    return true;
}
