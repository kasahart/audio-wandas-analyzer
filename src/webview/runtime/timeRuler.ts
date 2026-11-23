/**
 * The time ruler above the Tracks rows: the one time axis every row's Figure is stacked on, drawn on a canvas of its
 * own. Its ticks and their numbers are the Figure's (figure/ticks.ts), its ends are made as a Figure's zoomed axis
 * makes them (figure/axisScale.ts), and its name is fitted as every axis name is (figure/axisTitle.ts).
 */
import { fieldWindow } from './figureModel';
import type { NormalizedRange } from './waveformInteraction';
import { alongAxisTicks } from '../figure/ticks';
import { axisScale, windowedScale } from '../figure/axisScale';
import { fitAxisTitle, scaledFont } from '../figure/axisTitle';

/** The text the ruler is written in, as every plot's axes are. */
const RULER_FONT = '10px sans-serif';
/** The least room between two numbers along the ruler. */
const LABEL_GAP_PX = 4;

/**
 * The ends a linear axis from `low` to `high` shows over the part `window` (fractions of it). A zoomed part's ends
 * are made at the decimals its range popover writes (figureModel.fieldWindow, R9), so the ruler is painted from the
 * very numbers the popover writes; the whole axis keeps its own ends.
 */
export function linearWindowEnds(low: number, high: number, window: NormalizedRange): { min: number; max: number } {
    const shown = windowedScale(axisScale(low, high, false), window, fieldWindow);
    return { min: shown.low, max: shown.high };
}

/** The time ticks across `width` pixels showing `startSec`..`endSec`: the Figure's rule for a time axis. */
export function timeRulerTicks(startSec: number, endSec: number, width: number): Array<{ x: number; text: string }> {
    const span = endSec - startSec || 1;
    return alongAxisTicks(startSec, endSec).map(tick => ({ x: (tick.value - startSec) / span * width, text: tick.text }));
}

/**
 * Paints the ruler: its ticks along the bottom over `width` pixels, their numbers, and its name at the right end; a
 * number the name would cover, or that would touch the one before it, is left out. The canvas is marked as an axis
 * canvas (`data-plot-axis-canvas`) and painted while the page knows an axis is being drawn (`__plotPainting`), so the
 * browser audit of what is drawn on the page (src/test/uiSmoke/canvasAudit.ts) holds it to this painter.
 */
export function paintTimeRuler(canvas: HTMLCanvasElement, ticks: ReadonlyArray<{ x: number; text: string }>, title: string, width: number, colors: { muted: string; line: string; text: string }, ratio = 1): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    const scope = globalThis as { __plotPainting?: number };
    scope.__plotPainting = (scope.__plotPainting ?? 0) + 1;
    try {
        if (canvas.dataset) canvas.dataset.plotAxisCanvas = '';
        // `ratio`: the device's pixels to a CSS pixel. The bitmap is that much larger than the ruler as shown, and
        // everything here is placed in CSS pixels.
        const height = canvas.height / ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, canvas.width / ratio, height);
        context.font = RULER_FONT;
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        // Its name fitted as every axis name is (fitAxisTitle: smaller, its quantity shortened, never dropped).
        const fitted = fitAxisTitle(title, width / 2, part => context.measureText(part).width);
        const fittedTitle = fitted.lines.join(' ');
        const titleLeft = Math.max(0, width - context.measureText(fittedTitle).width * fitted.scale - 2);
        context.fillStyle = colors.muted;
        context.strokeStyle = colors.line;
        context.lineWidth = 1;
        context.beginPath();
        let labelsEnd = -Infinity;
        for (const tick of ticks) {
            const x = Math.round(tick.x) + 0.5;
            context.moveTo(x, height - 4);
            context.lineTo(x, height);
            const end = tick.x + 2 + context.measureText(tick.text).width;
            if (end < titleLeft - 4 && tick.x + 2 >= labelsEnd + LABEL_GAP_PX) { context.fillText(tick.text, tick.x + 2, height - 6); labelsEnd = end; }
        }
        context.stroke();
        context.fillStyle = colors.text;
        context.font = scaledFont(RULER_FONT, fitted.scale);
        context.fillText(fittedTitle, titleLeft, height - 6);
        context.font = RULER_FONT;
    } finally {
        scope.__plotPainting = (scope.__plotPainting ?? 1) - 1;
    }
}
