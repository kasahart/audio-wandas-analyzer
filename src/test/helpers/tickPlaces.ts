/**
 * The node twin of the ui-smoke audit's tickPlaces (src/test/uiSmoke/canvasAudit.ts), for a plot painted off screen
 * (a report's figure, which no browser test shows): every number a plot's vertical axes write, read as a user reads it
 * (a true minus, "k" for a thousand), held to the place the plot's own transform paints that number
 * (`__plotTickPlaces`, set by paintOverlay), within half a pixel (display rules R9, R14).
 */
import type { TickPlacedCanvas } from '../../webview/runtime/stagePanes';

/** A text drawn on a canvas, where (in the context's own units: the plot's CSS pixels) and how it was aligned. */
export interface WrittenText { text: string; x: number; y: number; align: string }

/** A 2D context that records each text drawn with its place and alignment; the canvas keeps its data attributes. */
export function placeRecordingCanvas(size: { width: number; height: number }): { canvas: HTMLCanvasElement; written: WrittenText[] } {
    const written: WrittenText[] = [];
    const state = { textAlign: 'start', font: '10px sans-serif' };
    const saved: Array<typeof state> = [];
    const context = new Proxy({}, {
        get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key === 'fillText' ? (text: string, x: number, y: number) => { written.push({ text: String(text), x, y, align: state.textAlign }); }
            : key === 'save' ? () => { saved.push({ ...state }); } : key === 'restore' ? () => { Object.assign(state, saved.pop() ?? state); }
            : key === 'textAlign' || key === 'font' ? state[key]
            : key === 'createImageData' || key === 'getImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : () => undefined,
        set: (_target, key, value) => { if (key === 'textAlign' || key === 'font') state[key] = String(value); return true; },
    });
    const canvas = { width: 0, height: 0, clientWidth: size.width, clientHeight: size.height, ownerDocument: {}, dataset: {}, setAttribute: () => undefined, getContext: () => context } as unknown as HTMLCanvasElement;
    return { canvas, written };
}

const NUMBER = /^[−+-]?\d[\d.]*(e[−+-]?\d+)?k?$/u;
const read = (text: string): number => (text.endsWith('k') ? Number(text.slice(0, -1).replace(/−/gu, '-')) * 1000 : Number(text.replace(/−/gu, '-')));

/**
 * The tick labels of the plot's vertical axes (right-aligned at its left edge, left-aligned past its right edge, as
 * paintOverlay writes them) that are not where its axes paint their numbers; `judged` counts those read.
 */
export function misplacedTicks(canvas: HTMLCanvasElement, written: readonly WrittenText[]): { declared: boolean; judged: number; wrong: string[] } {
    const places = (canvas as TickPlacedCanvas).__plotTickPlaces;
    const frame = (canvas.dataset.plotFrame ?? '').split(' ').map(Number);
    if (!places || frame.length !== 4 || !frame.every(Number.isFinite)) return { declared: false, judged: 0, wrong: [] };
    const [left, , width] = frame;
    const wrong: string[] = [];
    let judged = 0;
    for (const item of written) {
        if (!NUMBER.test(item.text)) continue;
        const where = item.align === 'right' && Math.abs(item.x - (left - 2)) <= 0.5 ? places.left
            : item.align === 'left' && Math.abs(item.x - (left + width + 4)) <= 0.5 ? places.right : undefined;
        if (!where) continue;
        judged += 1;
        const expected = where(read(item.text));
        if (!(Math.abs(item.y - expected) <= 0.5)) wrong.push(`"${item.text}" is written at y = ${item.y.toFixed(2)} px, where its axis paints ${item.text} at y = ${expected.toFixed(2)} px`);
    }
    return { declared: true, judged, wrong };
}
