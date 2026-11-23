/**
 * A figure's PNG with its lines named. On the page a Figure's legend is beside the canvas (HTML), so an image of the
 * canvas alone does not say which line is which recording: the names go on a strip above the figure, each after a
 * stroke of its line's colour, in the order given, on as many rows as they need. Names and colours are handed in (what
 * the page's legend showed when the export was asked): nothing here reads a picture or makes a number of one.
 */
export interface LegendEntry {
    name: string;
    colour: string;
}

/** The strip's measures, in CSS px (drawn at the canvas's own pixel ratio). */
const ROW = 18, PAD = 8, STROKE = 18, GAP = 6, BETWEEN = 16, FONT = 11;
const NAME_COLOUR = '#888';

/** `text` as it fits in `width` (CSS px): its middle left out (…) when it is wider. */
function fitted(ctx: CanvasRenderingContext2D, text: string, width: number): string {
    if (ctx.measureText(text).width <= width) return text;
    // By characters (a pair of code units is one), down to the mark alone where nothing else fits.
    const chars = Array.from(text);
    let keep = chars.length - 1;
    const cut = (): string => `${chars.slice(0, Math.floor(keep / 2)).join('')}…${chars.slice(chars.length - Math.ceil(keep / 2)).join('')}`;
    while (keep > 0 && ctx.measureText(cut()).width > width) keep -= 1;
    return cut();
}

/**
 * `figure` under a legend of `entries`, as a new canvas; `figure` itself when there is nothing to name or no 2D
 * context. `cssWidth`: the width the figure was drawn for (its canvas may hold more pixels a CSS px).
 */
export function withLegend(document: Document, figure: HTMLCanvasElement, entries: readonly LegendEntry[], cssWidth: number): HTMLCanvasElement {
    if (!entries.length || cssWidth <= 0) return figure;
    const out = document.createElement('canvas');
    const ctx = out.getContext('2d');
    if (!ctx) return figure;
    const ratio = figure.width / cssWidth;
    ctx.font = `${FONT}px sans-serif`;
    // Each entry's place (CSS px): the next row when it would pass the right edge.
    const places: Array<{ entry: LegendEntry; name: string; x: number; row: number }> = [];
    let x = PAD, row = 0;
    for (const entry of entries) {
        // A name wider than a whole row is written with its middle left out (its end, a channel or a suffix, stays).
        const name = fitted(ctx, entry.name, cssWidth - 2 * PAD - STROKE - GAP);
        const wide = STROKE + GAP + ctx.measureText(name).width;
        if (x > PAD && x + wide > cssWidth - PAD) { x = PAD; row += 1; }
        places.push({ entry, name, x, row });
        x += wide + BETWEEN;
    }
    const strip = (row + 1) * ROW;
    out.width = figure.width;
    out.height = Math.round(strip * ratio) + figure.height;
    // (Sizing a canvas clears its state: the scale and the font are set after.)
    ctx.scale(ratio, ratio);
    ctx.font = `${FONT}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineWidth = 2;
    for (const { entry, name, x: left, row: at } of places) {
        const y = at * ROW + ROW / 2;
        ctx.strokeStyle = entry.colour;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + STROKE, y);
        ctx.stroke();
        ctx.fillStyle = NAME_COLOUR;
        ctx.fillText(name, left + STROKE + GAP, y);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(figure, 0, Math.round(strip * ratio));
    return out;
}
