/**
 * The entry screen's overview strip: the table's rows as their 1/3-octave levels (a row per recording's
 * channel, bright = loud), the rows on screen framed, the focused one marked.
 */
import { BAND_CENTERS_HZ, bandLabel, type EntryRow } from './entryTable';
import { FULL_PLOT_WINDOW, type PlotMargins, type PlotWindow } from './plotInteraction';

/** The strip's margins (its colour scale and frequency axis), for placing the pointer on it. */
export const OVERVIEW_MARGINS: PlotMargins = { left: 0, top: 14, right: 0, bottom: 26 };

/** The part of [low, high] a window's range (0–1) shows. */
const part = (low: number, high: number, range: { start: number; end: number }): [number, number] => [low + range.start * (high - low), low + range.end * (high - low)];

/** Numbers on screen use the minus sign, as the table does. */
export const minus = (text: string): string => text.replace(/^-/, '−');

interface Theme { text: string; muted: string; line: string }

function theme(canvas: HTMLCanvasElement): Theme {
    const style = canvas.ownerDocument.defaultView?.getComputedStyle(canvas);
    const read = (name: string, fallback: string): string => style?.getPropertyValue(name).trim() || fallback;
    return {
        text: read('--text', '#ccc'), muted: read('--muted', '#888'), line: read('--line', '#444'),
    };
}

function prepare(canvas: HTMLCanvasElement): { context: CanvasRenderingContext2D; width: number; height: number } | null {
    const ratio = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const width = canvas.clientWidth || 400;
    const height = canvas.clientHeight || 200;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = '10px sans-serif';
    return { context, width, height };
}

const OVERVIEW_TICKS = [0, 5, 10, 14, 17, 20, 23, 26];

export function paintOverview(
    canvas: HTMLCanvasElement,
    rows: EntryRow[],
    bands: ReadonlyMap<string, (number | null)[]>,
    visible: { first: number; last: number },
    focused: string | null,
    /** The part on screen (zoomed): x of the bands, y of the rows (0 at the bottom). */
    window: PlotWindow = FULL_PLOT_WINDOW,
): void {
    const prepared = prepare(canvas);
    if (!prepared) return;
    const { context } = prepared;
    const colors = theme(canvas);
    // Loops, not spreads: a large folder has more levels than a call can take as arguments.
    let low = Infinity, high = -Infinity;
    for (const row of rows) for (const value of bands.get(row.filePath) ?? []) {
        if (value === null) continue;
        low = Math.min(low, value); high = Math.max(high, value);
    }
    if (!Number.isFinite(low)) return;
    // The cells fill the plot inside the margins: the colour scale above, the frequency axis below.
    const { left, top, right, bottom } = OVERVIEW_MARGINS;
    const width = prepared.width - left - right, height = prepared.height - top - bottom;
    const shadeOf = (value: number): string => { const shade = Math.round(30 + (value - low) / Math.max(1e-9, high - low) * 200); return `rgb(${shade},${shade},${shade})`; };
    // Zoomed, the cells stretch: the bands across the window's x, the rows (top first) over its y.
    const cellWidth = width / BAND_CENTERS_HZ.length / (window.x.end - window.x.start || 1);
    const cellHeight = height / Math.max(1, rows.length) / (window.y.end - window.y.start || 1);
    const bandX = (band: number): number => left + (band / BAND_CENTERS_HZ.length - window.x.start) / (window.x.end - window.x.start || 1) * width;
    const rowY = (index: number): number => top + (index / Math.max(1, rows.length) - (1 - window.y.end)) / (window.y.end - window.y.start || 1) * height;
    context.save();
    context.beginPath();
    context.rect(left, top, width, height);
    context.clip();
    rows.forEach((row, index) => {
        (bands.get(row.filePath) ?? []).forEach((value, band) => {
            if (value === null) return;
            context.fillStyle = shadeOf(value);
            context.fillRect(bandX(band), rowY(index), cellWidth + 0.5, cellHeight + 0.5);
        });
    });
    context.strokeStyle = colors.text;
    context.lineWidth = 1;
    if (visible.last >= visible.first) {
        context.strokeRect(left + 0.5, rowY(visible.first) + 0.5, width - 1, (visible.last - visible.first + 1) * cellHeight - 1);
    }
    const at = rows.findIndex(row => row.filePath === focused);
    if (at >= 0) {
        context.fillStyle = colors.text;
        context.fillRect(left, rowY(at), 3, Math.max(2, cellHeight));
    }
    context.restore();
    // The frequency axis: the bands' centres in Hz.
    context.fillStyle = colors.muted;
    context.strokeStyle = colors.muted;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    for (const band of OVERVIEW_TICKS) {
        const x = bandX(band) + cellWidth / 2;
        if (x < left || x > left + width) continue;
        context.beginPath();
        context.moveTo(x, top + height);
        context.lineTo(x, top + height + 3);
        context.stroke();
        context.fillText(bandLabel(band).replace(' kHz', 'k').replace(' Hz', ''), x, top + height + 4);
    }
    context.textAlign = 'right';
    context.fillText('Hz', left + width, top + height + 15);
    // The colour scale: the strip's own darkest and brightest levels.
    const unit = rows.some(row => row.status === 'ok' && !row.uncalibrated) ? 'dB' : 'dBFS';
    const barWidth = 60, barRight = left + width - 2;
    context.textBaseline = 'middle';
    context.fillText(`${minus(high.toFixed(0))} ${unit}`, left + width, top / 2);
    const highText = context.measureText(`${minus(high.toFixed(0))} ${unit}`).width;
    const barEnd = barRight - highText - 4;
    const gradient = context.createLinearGradient(barEnd - barWidth, 0, barEnd, 0);
    gradient.addColorStop(0, shadeOf(low));
    gradient.addColorStop(1, shadeOf(high));
    context.fillStyle = gradient;
    context.fillRect(barEnd - barWidth, top / 2 - 3, barWidth, 6);
    context.fillStyle = colors.muted;
    context.fillText(minus(low.toFixed(0)), barEnd - barWidth - 4, top / 2);
}
