import { graphemes } from '../../shared/utils/graphemes';

const EXPORT_BACKGROUND = '#1e1e1e';

export function triggerAnchorDownload(document: Document, href: string, fileName: string): void {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
}

/** The words a row says in place of what it cannot draw (waiting, failed, too short), where they are on show. */
export function rowSays(piece: Element): string {
    const host = piece.matches('.track-row-figure') ? piece : piece.closest('.track-row-figure');
    const says = host?.querySelector<HTMLElement>('.track-row-says');
    return says && !says.hidden ? says.textContent?.trim() ?? '' : '';
}

/** A row's words and where the page lays them in its box (CSS px from its top; null: over the whole box). */
export interface PlacedWords { text: string; top: number | null; height: number | null }

/** `rowSays` with the place: one lane's words lie over that lane (the row's screen sets their top and height). */
export function rowSaysPlaced(piece: Element): PlacedWords {
    const host = piece.matches('.track-row-figure') ? piece : piece.closest('.track-row-figure');
    const says = host?.querySelector<HTMLElement>('.track-row-says');
    const px = (value: string | undefined): number | null => (value && value.endsWith('px') && Number.isFinite(parseFloat(value)) ? parseFloat(value) : null);
    return { text: rowSays(piece), top: px(says?.style.top), height: px(says?.style.height) };
}

const isCanvas = (piece: HTMLElement): piece is HTMLCanvasElement => typeof (piece as HTMLCanvasElement).getContext === 'function' || typeof (piece as HTMLCanvasElement).width === 'number';

/**
 * What the image is made of, in the page's order: the canvases on show (not a row's layer of lines, which the composer
 * lays over its Figure), and the box of a row that has no Figure and says why (its answers failed, or have not come):
 * the row keeps its place in the image, with its words.
 */
export function visibleExportCanvases(wrapper: Element | null): HTMLElement[] {
    if (!wrapper) {
        return [];
    }
    return Array.from(wrapper.querySelectorAll<HTMLElement>('canvas:not(.track-row-layer), .track-row-figure')).filter(piece =>
        piece.offsetParent !== null && (piece.tagName === 'CANVAS' || (!piece.querySelector('canvas:not(.track-row-layer)') && rowSays(piece) !== '')));
}

/** `text` as it fits in `width`: its middle left out (…) when it is wider, so its end (the channel, a suffix) stays. */
export function fittedText(ctx: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, width: number): string {
    if (typeof ctx.measureText !== 'function' || ctx.measureText(text).width <= width) return text;
    // By characters as seen (graphemes: an emoji, a base with its combining mark), down to the mark alone where nothing else fits.
    const chars = graphemes(text);
    let keep = chars.length - 1;
    const cut = (): string => `${chars.slice(0, Math.floor(keep / 2)).join('')}…${chars.slice(chars.length - Math.ceil(keep / 2)).join('')}`;
    while (keep > 0 && ctx.measureText(cut()).width > width) keep -= 1;
    return cut();
}

/** The height (CSS px) of the line a row's name is written on, above its Figure in the image. */
const NAME_LINE_PX = 18;
const NAME_COLOUR = '#cccccc';

const SAYS_COLOUR = '#9d9d9d';

/** A canvas's pixels per CSS px (1 where it is not laid out). */
const ratioOf = (canvas: HTMLCanvasElement): number => (canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1);

/**
 * The rows as one image: the ruler over each row's Figure as drawn (each carries its own axis room), stacked, with a
 * row's layer of lines (the cursor, the loop, the analysis window) over its Figure, as on screen. The Figures are the
 * screen's own (the figure service's pictures), copied: no number is made for the image. `nameOf` says whose a canvas
 * is (the recording and channel, which the page shows beside the row, outside the canvas): written on a line above it,
 * so the image says which recording each row is on its own. No name ('' or no `nameOf`), no line. Each canvas is put
 * as far from the left as the page has it (the ruler starts where the rows' plots do, right of their axis room), so
 * the ruler's ticks stand over the times they name. `saysOf`: the words a piece shows on the page in place of what it
 * cannot draw (they are HTML over the canvas): written in the image where the page has them, so a row that failed or
 * is still waiting is not a blank or a missing row there. A piece that is no canvas (a row with no Figure) is its box.
 */
export function composeTrackCanvases(document: Document, pieces: HTMLElement[], nameOf?: (piece: HTMLElement) => string, saysOf?: (piece: HTMLElement) => string | PlacedWords): HTMLCanvasElement | null {
    const lefts = pieces.map(piece => (typeof piece.getBoundingClientRect === 'function' ? piece.getBoundingClientRect().left : 0));
    const leftmost = Math.min(...lefts);
    // A box is drawn at the pixel ratio the canvases have.
    const first = pieces.find(isCanvas);
    const boxRatio = first ? ratioOf(first) : 1;
    const named = pieces.map((piece, at) => {
        const name = nameOf?.(piece) ?? '';
        const canvas = isCanvas(piece) ? piece : null;
        const ratio = canvas ? ratioOf(canvas) : boxRatio;
        return {
            piece, canvas, name, ratio, says: ((said: string | PlacedWords): PlacedWords => (typeof said === 'string' ? { text: said, top: null, height: null } : said))(saysOf?.(piece) ?? ''),
            width: canvas ? canvas.width : Math.round(piece.clientWidth * ratio), height: canvas ? canvas.height : Math.round(piece.clientHeight * ratio),
            room: name ? Math.round(NAME_LINE_PX * ratio) : 0, x: Math.round((lefts[at] - leftmost) * ratio),
        };
    });
    const offscreen = document.createElement('canvas');
    offscreen.width = named.reduce((max, item) => Math.max(max, item.x + item.width), 0);
    offscreen.height = named.reduce((sum, item) => sum + item.room + item.height, 0);
    const ctx = offscreen.getContext('2d');
    if (!ctx) {
        return null;
    }
    ctx.fillStyle = EXPORT_BACKGROUND;
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    let y = 0;
    named.forEach(({ canvas, name, says, ratio, width, height, room, x }) => {
        if (room) {
            ctx.fillStyle = NAME_COLOUR;
            ctx.font = `${Math.round(12 * ratio)}px sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(fittedText(ctx, name, offscreen.width - Math.round(16 * ratio)), Math.round(8 * ratio), y + room / 2);
            y += room;
        }
        if (canvas) {
            ctx.drawImage(canvas, x, y);
            const layer = canvas.parentElement?.querySelector<HTMLCanvasElement>('canvas.track-row-layer');
            if (layer && layer !== canvas && layer.width > 0 && layer.height > 0) ctx.drawImage(layer, x, y, canvas.width, canvas.height);
        }
        if (says.text) {
            // In the middle of the piece, or of the lane the page lays them over; a line of the page's words a line.
            const middle = says.top !== null && says.height !== null ? (says.top + says.height / 2) * ratio : height / 2;
            const lines = says.text.split('\n').map(line => line.trim()).filter(Boolean), step = Math.round(15 * ratio);
            ctx.fillStyle = SAYS_COLOUR;
            ctx.font = `${Math.round(11 * ratio)}px sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            lines.forEach((line, at) => ctx.fillText(fittedText(ctx, line, width - Math.round(16 * ratio)), x + width / 2, y + middle + (at - (lines.length - 1) / 2) * step));
        }
        y += height;
    });
    return offscreen;
}
