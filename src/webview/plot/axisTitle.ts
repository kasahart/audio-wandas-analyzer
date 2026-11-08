/**
 * An axis name is its quantity and its unit in closing brackets (R4): "Phase [°]", "Level [dB SPL re 20 µPa]". A
 * quantity with no unit says so with DIMENSIONLESS ("Coherence γ² [–]"); one whose unit is not known says that in
 * words (the strings' axisUnitUnknown). Where the name does not fit, it is written smaller, then on two lines
 * (quantity, then unit), then with its quantity shortened, but never without its quantity or its unit.
 */

/** The unit of a dimensionless quantity (a coefficient, a ratio, a count's index), in every language. */
export const DIMENSIONLESS = '–';

const NAME = /^(.*\S)\s*\[([^\]]+)\]$/su;

/** The quantity and unit an axis name gives, or null when it gives no unit in closing brackets. */
export function axisNameParts(name: string): { quantity: string; unit: string } | null {
    const match = NAME.exec(name.trim());
    return match && match[2].trim() ? { quantity: match[1], unit: match[2] } : null;
}

/** "{quantity} [{unit}]", the one way every axis name is written. */
export function axisName(quantity: string, unit: string): string {
    return `${quantity} [${unit}]`;
}

/** The smallest the name's font is scaled to before its quantity is shortened. */
export const MIN_TITLE_SCALE = 0.8;
const SCALES = [1, 0.9, MIN_TITLE_SCALE];

/** What is drawn for an axis name: its lines (one, or the quantity then the unit) at `scale` times the font. */
export interface FittedAxisTitle { lines: string[]; scale: number }

/**
 * The quantity, shorter: its symbol when it ends in one ("Coherence γ²" → "γ²"), then its first characters with an
 * ellipsis, longest first. Every form keeps at least one character of the quantity.
 */
export function shortQuantities(quantity: string): string[] {
    const words = quantity.trim().split(/\s+/u);
    const last = words[words.length - 1];
    const symbol = words.length > 1 && [...last].length <= 3 && /\p{L}/u.test(last) && !/[A-Za-z0-9]/u.test(last) ? [last] : [];
    const chars = [...quantity];
    const cut = Array.from({ length: Math.max(chars.length - 1, 0) }, (_, index) => `${chars.slice(0, chars.length - 1 - index).join('').trimEnd()}…`)
        .filter(text => text.length > 1);
    return [...symbol, ...cut];
}

/**
 * The name as it fits along `length` pixels, `measure` giving a text's width at the font's own size: whole on one
 * line, down to MIN_TITLE_SCALE of the font; then on two lines (when `lines` is 2), quantity then unit; then with the
 * quantity shortened (shortQuantities) at the smallest size.
 * When even the shortest form does not fit it is still drawn, so the axis never loses its quantity or its unit.
 */
export function fitAxisTitle(name: string, length: number, measure: (text: string) => number, options: { lines?: 1 | 2; minScale?: number } = {}): FittedAxisTitle {
    const parts = axisNameParts(name);
    if (!parts) return { lines: name ? [name] : [], scale: 1 };
    const twoLines = (options.lines ?? 1) === 2;
    const fits = (lines: readonly string[], scale: number): boolean => lines.every(line => measure(line) * scale <= length);
    const forms = (quantity: string): string[][] => [[axisName(quantity, parts.unit)], ...(twoLines ? [[quantity, `[${parts.unit}]`]] : [])];
    const scales = SCALES.filter(scale => scale >= (options.minScale ?? MIN_TITLE_SCALE));
    const smallest = scales[scales.length - 1];
    for (const lines of forms(parts.quantity)) {
        for (const scale of scales) if (fits(lines, scale)) return { lines, scale };
    }
    const shortest = shortQuantities(parts.quantity);
    for (const quantity of shortest) {
        for (const lines of forms(quantity)) if (fits(lines, smallest)) return { lines, scale: smallest };
    }
    const last = forms(shortest[shortest.length - 1] ?? parts.quantity);
    return { lines: last[last.length - 1], scale: smallest };
}

/** `font` with its pixel size times `scale`: "10px sans-serif" at 0.8 is "8px sans-serif". */
export function scaledFont(font: string, scale: number): string {
    return scale === 1 ? font : font.replace(/(\d+(?:\.\d+)?)px/u, (_, size: string) => `${Math.round(Number(size) * scale * 10) / 10}px`);
}

/** A font's size in pixels: "10px sans-serif" is 10. */
export function fontPixels(font: string): number {
    return Number(/(\d+(?:\.\d+)?)px/u.exec(font)?.[1] ?? 10);
}
