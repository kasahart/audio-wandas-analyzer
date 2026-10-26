/**
 * The entry screen's side panel: a scatter of two columns (the axis names are the axis pickers), the
 * held row's Δ spectrum against its base, and a strip of every file's 1/3-octave levels. Colours keep
 * their roles: blue is the base group, orange an outlier; conditions are told apart by marker shape.
 */
import { BAND_CENTERS_HZ, bandLabel, isOutlierRow, type EntryModel, type EntryRow } from './entryTable';
import { FULL_PLOT_WINDOW, type PlotMargins, type PlotWindow } from './plotInteraction';

/** The plots' margins (their axes' numbers and names), for placing the pointer on them. */
export const SCATTER_MARGINS: PlotMargins = { left: 38, top: 6, right: 6, bottom: 16 };
export const OVERVIEW_MARGINS: PlotMargins = { left: 0, top: 14, right: 0, bottom: 26 };

/** The part of [low, high] a window's range (0–1) shows. */
const part = (low: number, high: number, range: { start: number; end: number }): [number, number] => [low + range.start * (high - low), low + range.end * (high - low)];

/** The scatter's whole axes: each column's values with a little room around them. */
export function scatterExtent(model: EntryModel, xAxis: ScatterAxis, yAxis: ScatterAxis): { x: [number, number]; y: [number, number] } {
    const rows = model.rows.filter(row => row.status === 'ok' && xAxis.value(row) !== null && yAxis.value(row) !== null);
    return { x: extent(rows.map(row => xAxis.value(row)!)), y: extent(rows.map(row => yAxis.value(row)!)) };
}

export interface ScatterAxis {
    id: string;
    label: string;
    value(row: EntryRow): number | null;
}

/** Leq, the Δ of the row's most different band and the table's band, then every numeric metadata column. */
export function scatterAxes(model: EntryModel, maxDeltaLabel = 'Δ max band dB'): ScatterAxis[] {
    const metric = (id: 'leq' | 'band', label: string): ScatterAxis => ({ id, label, value: row => row.values[id] });
    // The Δ of each row's "Δ max band": how far it stands out from its condition at all.
    const axes = [metric('leq', 'Leq dB(A)'), { id: 'peak', label: maxDeltaLabel, value: (row: EntryRow) => row.delta.peak }, metric('band', `${bandLabel(model.band)} dB`)];
    model.columns.forEach((column, position) => {
        if (!column.numeric) return;
        axes.push({
            id: `column:${column.name}`,
            label: column.name,
            value: row => {
                const text = row.cells[position];
                return text === undefined || text === '' ? null : Number(text);
            },
        });
    });
    return axes;
}

const SHAPES = ['circle', 'triangle', 'square', 'diamond', 'cross'] as const;

/** Numbers on screen use the minus sign, as the table does. */
export const minus = (text: string): string => text.replace(/^-/, '−');

interface Theme { text: string; muted: string; line: string; base: string; flag: string; compare: string }

function theme(canvas: HTMLCanvasElement): Theme {
    const style = canvas.ownerDocument.defaultView?.getComputedStyle(canvas);
    const read = (name: string, fallback: string): string => style?.getPropertyValue(name).trim() || fallback;
    return {
        text: read('--text', '#ccc'), muted: read('--muted', '#888'), line: read('--line', '#444'),
        base: read('--entry-base', '#3b82f6'), flag: read('--entry-flag', '#e8833a'), compare: read('--entry-compare', '#d4b20f'),
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

function extent(values: number[]): [number, number] {
    if (!values.length) return [0, 1];
    let low = Infinity, high = -Infinity;
    for (const value of values) { low = Math.min(low, value); high = Math.max(high, value); }
    if (low === high) { low -= 1; high += 1; }
    const pad = (high - low) * 0.05;
    return [low - pad, high + pad];
}

function marker(context: CanvasRenderingContext2D, shape: typeof SHAPES[number], x: number, y: number, size: number): void {
    context.beginPath();
    if (shape === 'circle') context.arc(x, y, size, 0, Math.PI * 2);
    else if (shape === 'triangle') { context.moveTo(x, y - size); context.lineTo(x + size, y + size); context.lineTo(x - size, y + size); context.closePath(); }
    else if (shape === 'square') context.rect(x - size, y - size, size * 2, size * 2);
    else if (shape === 'diamond') { context.moveTo(x, y - size); context.lineTo(x + size, y); context.lineTo(x, y + size); context.lineTo(x - size, y); context.closePath(); }
    else { context.moveTo(x - size, y - size); context.lineTo(x + size, y + size); context.moveTo(x + size, y - size); context.lineTo(x - size, y + size); }
}

export interface ScatterPoint { filePath: string; x: number; y: number }

/**
 * Plots every comparable row. `baseGroup` rows are blue, outliers ringed orange, the focused row
 * drawn larger; each condition gets its own marker shape. Returns the plotted positions for picking.
 */
export function paintScatter(
    canvas: HTMLCanvasElement,
    model: EntryModel,
    xAxis: ScatterAxis,
    yAxis: ScatterAxis,
    baseGroup: string | undefined,
    focused: string | null,
    slots: readonly (string | null)[] = [],
    /** The part of each axis on screen (zoomed). */
    window: PlotWindow = FULL_PLOT_WINDOW,
): ScatterPoint[] {
    const prepared = prepare(canvas);
    if (!prepared) return [];
    const { context, width, height } = prepared;
    const colors = theme(canvas);
    const rows = model.rows.filter(row => row.status === 'ok' && xAxis.value(row) !== null && yAxis.value(row) !== null);
    const whole = scatterExtent(model, xAxis, yAxis);
    const [x0, x1] = part(...whole.x, window.x);
    const [y0, y1] = part(...whole.y, window.y);
    const { left, bottom, right, top } = SCATTER_MARGINS;
    const px = (value: number): number => left + (value - x0) / (x1 - x0) * (width - left - right);
    const py = (value: number): number => top + (1 - (value - y0) / (y1 - y0)) * (height - top - bottom);
    context.strokeStyle = colors.line;
    context.fillStyle = colors.muted;
    context.strokeRect(left, top, width - left - right, height - top - bottom);
    for (const fraction of [0, 0.5, 1]) {
        const xValue = x0 + fraction * (x1 - x0), yValue = y0 + fraction * (y1 - y0);
        context.fillText(minus(xValue.toFixed(Math.abs(x1 - x0) < 1 ? 2 : Math.abs(x1 - x0) < 10 ? 1 : 0)), px(xValue) - (fraction === 1 ? 24 : fraction ? 10 : 0), height - 3);
        context.fillText(minus(yValue.toFixed(Math.abs(y1 - y0) < 1 ? 2 : Math.abs(y1 - y0) < 10 ? 1 : 0)), 2, py(yValue) + (fraction === 1 ? 9 : 3));
    }
    const shapes = new Map<string, typeof SHAPES[number]>();
    const points: ScatterPoint[] = [];
    // The base group last, so it reads above the rest; the focused row last of all.
    const ordered = [...rows].sort((a, b) => Number(a.group === baseGroup) - Number(b.group === baseGroup) || Number(a.filePath === focused) - Number(b.filePath === focused));
    for (const row of ordered) {
        const key = row.group ?? '';
        if (!shapes.has(key)) shapes.set(key, SHAPES[shapes.size % SHAPES.length]);
        const x = px(xAxis.value(row)!), y = py(yAxis.value(row)!);
        // Zoomed, a point outside the plot is neither drawn nor picked.
        if (x < left - 0.5 || x > width - right + 0.5 || y < top - 0.5 || y > height - bottom + 0.5) continue;
        points.push({ filePath: row.filePath, x, y });
        const size = row.filePath === focused ? 5 : 3;
        marker(context, shapes.get(key)!, x, y, size);
        const color = row.group !== undefined && row.group === baseGroup ? colors.base : colors.muted;
        context.fillStyle = color;
        context.strokeStyle = color;
        context.lineWidth = 1;
        if (shapes.get(key) === 'cross') context.stroke(); else context.fill();
        if (isOutlierRow(row)) {
            context.strokeStyle = colors.flag;
            context.lineWidth = 1.5;
            marker(context, 'circle', x, y, size + 3);
            context.stroke();
        }
        // Rings keep their roles: blue the slot-0 base, yellow a slotted compare, neutral the focused row.
        const slot = slots.indexOf(row.filePath);
        const ring = slot === 0 ? colors.base : slot > 0 ? colors.compare : row.filePath === focused ? colors.text : null;
        if (ring) {
            context.strokeStyle = ring;
            context.lineWidth = 2;
            marker(context, 'circle', x, y, size + 6);
            context.stroke();
        }
    }
    return points;
}

/**
 * Every file's 1/3-octave levels as one row of a strip, in table order: a glance shows which files
 * stand out in which band. The rows on screen are framed; the focused one is marked.
 */
/** The bands the strip's frequency axis names: one per octave or so, 20 Hz to 8 kHz. */
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
    // Outliers keep their orange at the strip's right edge, so the strip shows where they are among all files.
    context.fillStyle = colors.flag;
    rows.forEach((row, index) => { if (isOutlierRow(row)) context.fillRect(left + width - 4, rowY(index), 4, Math.max(2, cellHeight)); });
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
