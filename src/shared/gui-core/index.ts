export type Range = Readonly<{
    min: number;
    max: number;
}>;
export type Level = Readonly<{
    quantity: string;
    unit: string;
    axisLabel: string;
    referenceValue?: number;
    referenceUnit?: string;
    levelReferenceLabel?: string;
}>;
export type Palette = Readonly<{
    stops: readonly (readonly [
        number,
        number,
        number
    ])[];
    rounding: 'round' | 'floor';
}>;
export const blue: Palette = { stops: [[11, 20, 40], [18, 54, 95], [36, 111, 159], [110, 180, 212], [238, 248, 255]], rounding: 'round' };
export const viridis: Palette = { stops: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]], rounding: 'floor' };
export const magma: Palette = { stops: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]], rounding: 'floor' };
export type RasterSource = {
    layout: 'flat';
    values: ArrayLike<number>;
    bins: number;
    floor?: number;
    level?: Level;
} | {
    layout: 'rows';
    values: readonly (readonly number[])[];
    bins: number;
    floor?: number;
    level?: Level;
};
export type RasterPlan = Readonly<{
    columns: readonly (readonly [
        number,
        number
    ] | null)[];
    rows: readonly (readonly [
        number,
        number
    ] | null)[];
    peakMode?: 'finite' | 'comparison';
}>;
// Product adapters choose source intervals; this kernel never changes their axes or level references.
export function rasterize(source: RasterSource, plan: RasterPlan, limits: Range, palette: Palette, destination?: Uint8ClampedArray) {
    const width = plan.columns.length, height = plan.rows.length;
    const rgba = destination ?? new Uint8ClampedArray(width * height * 4);
    if (rgba.length !== width * height * 4)
        throw new RangeError('Raster destination shape');
    if (palette.stops.length < 2)
        throw new RangeError('Palette');
    rgba.fill(0);
    const stops = palette.stops, round = palette.rounding === 'floor' ? Math.floor : Math.round, span = limits.max - limits.min;
    for (let x = 0; x < width; x++)
        for (let y = 0; y < height; y++) {
            const t = plan.columns[x], f = plan.rows[y];
            if (!t || !f)
                continue;
            let peak = -Infinity;
            for (let c = t[0]; c < t[1]; c++) {
                const values = source.layout === 'rows' ? source.values[c] : source.values;
                if (!values)
                    continue;
                const base = source.layout === 'rows' ? 0 : c * source.bins;
                for (let b = f[0]; b < f[1]; b++) {
                    const value = values[base + b];
                    if (value !== undefined && (plan.peakMode === 'comparison' || Number.isFinite(value)) && (source.floor === undefined || value > source.floor) && value > peak)
                        peak = value;
                }
            }
            const value = Number.isFinite(peak) ? peak : limits.min;
            const norm = span !== 0 ? Math.max(0, Math.min(1, (value - limits.min) / span)) : 0;
            if (Number.isNaN(norm)) {
                rgba[((height - 1 - y) * width + x) * 4 + 3] = 255;
                continue;
            }
            const position = norm * (stops.length - 1), lower = Math.floor(position), upper = Math.min(lower + 1, stops.length - 1), fraction = position - lower;
            const a = stops[lower], b = stops[upper], offset = ((height - 1 - y) * width + x) * 4;
            rgba[offset] = round(a[0] + (b[0] - a[0]) * fraction);
            rgba[offset + 1] = round(a[1] + (b[1] - a[1]) * fraction);
            rgba[offset + 2] = round(a[2] + (b[2] - a[2]) * fraction);
            rgba[offset + 3] = 255;
        }
    return { width, height, pixels: rgba };
}
export function normalizedColor(norm: number, palette: Palette): [
    number,
    number,
    number
] {
    norm = norm >= 0 ? Math.min(norm, 1) : 0;
    const position = norm * (palette.stops.length - 1), lower = Math.floor(position), upper = Math.min(lower + 1, palette.stops.length - 1), fraction = position - lower;
    const round = palette.rounding === 'floor' ? Math.floor : Math.round;
    return [0, 1, 2].map(i => round(palette.stops[lower][i] + (palette.stops[upper][i] - palette.stops[lower][i]) * fraction)) as [
        number,
        number,
        number
    ];
}
// Plot chrome shared by the consumers' canvas plots. Drawing goes through the structural context below, so the kernel still needs no DOM types.
export type PlotContext = {
    fillStyle: unknown;
    strokeStyle: unknown;
    font: string;
    lineWidth: number;
    textAlign: 'left' | 'right' | 'center' | 'start' | 'end';
    textBaseline: 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom';
    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(angle: number): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
    setLineDash(segments: number[]): void;
    fillText(text: string, x: number, y: number): void;
    measureText(text: string): {
        width: number;
    };
};
export type PlotFrame = Readonly<{
    left: number;
    top: number;
    width: number;
    height: number;
}>;
/** `fraction` runs from 0 at the bottom edge of the frame to 1 at its top edge. */
export type AxisTick = Readonly<{
    text: string;
    fraction: number;
}>;
export type ValueAxisStyle = Readonly<{
    color: string;
    font?: string;
    /** Canvas x the turned title is centred on, inside the gutter left of the tick labels. */
    titleX: number;
}>;
export const PLOT_FONT = '9px monospace';
/** `count` frames of equal height stacked top to bottom inside `frame`, `gap` apart. */
export function stackFrames(frame: PlotFrame, count: number, gap: number): PlotFrame[] {
    // Gaps shrink before lanes would leave the frame, so a frame too short for them still holds every lane.
    const spacing = count > 1 ? Math.min(gap, frame.height / (count - 1)) : 0;
    const height = (frame.height - spacing * Math.max(count - 1, 0)) / Math.max(count, 1);
    return Array.from({ length: count }, (_, i) => ({ left: frame.left, top: frame.top + i * (height + spacing), width: frame.width, height }));
}
/** The title itself when it fits along `length`, else its bracketed unit, so `Phase [°]` becomes `°` in a short lane; the unit is drawn even if it still does not fit. */
export function fittedAxisTitle(title: string, length: number, measure: (text: string) => number): string {
    if (measure(title) <= length)
        return title;
    const unit = /\[([^\]]+)\]\s*$/.exec(title);
    return unit ? unit[1] : title;
}
/** Tick labels right-aligned against the frame's left edge and the quantity title turned along the gutter, as on a time-series lane. */
export function drawValueAxis(ctx: PlotContext, frame: PlotFrame, ticks: readonly AxisTick[], title: string, style: ValueAxisStyle): void {
    ctx.save();
    ctx.fillStyle = style.color;
    ctx.font = style.font ?? PLOT_FONT;
    ctx.textAlign = 'right';
    for (const tick of ticks) {
        ctx.textBaseline = tick.fraction >= 1 ? 'top' : tick.fraction <= 0 ? 'bottom' : 'middle';
        ctx.fillText(tick.text, frame.left - 2, frame.top + (1 - tick.fraction) * frame.height);
    }
    if (title) {
        ctx.translate(style.titleX, frame.top + frame.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fittedAxisTitle(title, frame.height, text => ctx.measureText(text).width), 0, 0);
    }
    ctx.restore();
}
/** Dashed cursor lines across a frame; `y` null draws only the vertical one. */
export function drawCrosshair(ctx: PlotContext, frame: PlotFrame, x: number, y: number | null, verticalColor: string, horizontalColor: string): void {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = verticalColor;
    ctx.beginPath();
    ctx.moveTo(x, frame.top);
    ctx.lineTo(x, frame.top + frame.height);
    ctx.stroke();
    if (y !== null) {
        ctx.strokeStyle = horizontalColor;
        ctx.beginPath();
        ctx.moveTo(frame.left, y);
        ctx.lineTo(frame.left + frame.width, y);
        ctx.stroke();
    }
    ctx.restore();
}
/** One cursor readout line: series, frequency or time, then each value, in the same order on every plot. */
export function readoutText(parts: readonly string[]): string {
    return parts.join(' / ');
}
