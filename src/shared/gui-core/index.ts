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
