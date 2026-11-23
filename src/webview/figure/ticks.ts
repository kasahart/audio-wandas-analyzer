/**
 * Where an axis's ticks go and what they say (layer 3's: 目盛りの位置と文字, figure-design.md 第 1 節), in one
 * place. Ticks are placed from the confirmed range and the plot's size; they never decide a range.
 */
import { niceTicks } from '../../shared/utils/ticks';
import { stepText, withMinus } from '../shell/numberText';

/** A tick: its text and its place up (or along) the axis, 0 at the frame's low edge and 1 at its high edge. */
export type AxisTick = Readonly<{ text: string; fraction: number }>;

/** A value range's ends. */
export interface TickRange {
    readonly min: number;
    readonly max: number;
}

/** The round values an axis from `low` to `high` gets ticks at (a log frequency axis at its round values). */
export function alongTickValues(low: number, high: number, log: boolean): number[] {
    if (log) {
        const inside = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(value => value > low * 1.05 && value < high * 0.95);
        if (inside.length > 1) return inside;
        // Zoomed between two of them: round values inside the window (1001, 1002, … Hz), each written where it is
        // (tickTexts), so no tick names a frequency it is not at.
        return niceTicks(low, high, 4).filter(value => value > 0 && value >= low && value <= high);
    }
    return niceTicks(low, high, 8);
}

/** How tall a tick label is (PLOT_TEXT_FONT's size), and the least room left between two on one axis. */
export const TICK_LABEL_PX = 10;
const TICK_LABEL_GAP_PX = 2;

/**
 * Where a value axis's tick label is drawn up an axis `height` px tall, from its top: as the Figure paints it (figure.ts), the
 * top tick hangs below the top edge, the bottom one stands on the bottom edge, the others are centred on their place.
 */
export function tickLabelSpan(fraction: number, height: number): { top: number; bottom: number } {
    const y = (1 - fraction) * height;
    if (fraction >= 1) return { top: y, bottom: y + TICK_LABEL_PX };
    if (fraction <= 0) return { top: y - TICK_LABEL_PX, bottom: y };
    return { top: y - TICK_LABEL_PX / 2, bottom: y + TICK_LABEL_PX / 2 };
}

/** Whether no two of the ticks' labels touch on an axis `height` px tall (TICK_LABEL_GAP_PX apart at least). */
export function ticksFit(ticks: readonly AxisTick[], height: number): boolean {
    if (!Number.isFinite(height)) return true;
    const spans = ticks.map(tick => tickLabelSpan(tick.fraction, height)).sort((a, b) => a.top - b.top);
    return spans.every((span, index) => index === 0 || span.top - spans[index - 1].bottom >= TICK_LABEL_GAP_PX);
}

/**
 * The ticks whose labels fit up an axis `height` px tall: from the bottom up, each one that would touch the last one
 * kept is left out (its value stays readable from its neighbours), so no two labels on one axis ever overlap.
 */
export function spacedTicks<T extends AxisTick>(ticks: readonly T[], height: number): T[] {
    const kept: T[] = [];
    for (const tick of [...ticks].sort((a, b) => a.fraction - b.fraction)) {
        if (tick.fraction < -1e-9 || tick.fraction > 1 + 1e-9) continue;
        const last = kept[kept.length - 1];
        if (!last || ticksFit([last, tick], height)) kept.push(tick);
    }
    return kept;
}

/**
 * A level or amplitude axis's ticks over `range`, as fractions up the axis: the one rule for every plot's value axis
 * (Compare's panes and the track lanes' amplitude axis), with as many decimals as the span needs. On an axis
 * `height` px tall, as many round steps as fit without their labels touching: fewer on a short plot.
 */
export function valueAxisTicks(range: TickRange, height = Infinity): ValueTick[] {
    const span = range.max - range.min || 1;
    const at = (count: number): ValueTick[] => {
        const values = niceTicks(range.min, range.max, count);
        return values.map(value => ({ value, text: valueTickTexts(values)(value), fraction: (value - range.min) / span }));
    };
    const full = at(4);
    if (ticksFit(full, height)) return full;
    // Coarser round steps, or every k-th of the finest (−80, −40, 0): whichever keeps the most labels apart.
    const everyKth = Array.from({ length: full.length }, (_, k) => Array.from({ length: k + 1 }, (_, offset) => full.filter((_, index) => index % (k + 1) === offset))).flat();
    const candidates = [at(3), at(2), at(1), ...everyKth, spacedTicks(full, height)].filter(ticks => ticksFit(ticks, height));
    return candidates.reduce<ValueTick[]>((best, ticks) => (ticks.length > best.length ? ticks : best), []);
}

/** A tick of a value or row axis: its text, the value it is at (what the text writes), and its place up the axis. */
export type ValueTick = AxisTick & { value: number };

/**
 * How a value axis writes its ticks: with as many decimals as their step needs (a step of 0.25 two, a step of 1
 * none), the same on every tick; a step finer than 0.00001 in powers of ten ("2.5e−7"), so a quiet signal's ticks
 * still read their own values. Each tick's place is a whole number of steps, so the step's decimals are all it needs.
 */
export function valueTickTexts(values: readonly number[]): (value: number) => string {
    const step = values.length > 1 ? Math.abs(values[1] - values[0]) : Math.abs(values[0] ?? 0);
    const whole = (x: number): boolean => Math.abs(x - Math.round(x)) <= 1e-6 * Math.max(1, Math.abs(x));
    let decimals = step > 0 && Number.isFinite(step) ? Math.max(0, Math.floor(-Math.log10(step))) : 0;
    while (decimals < 20 && step > 0 && !whole(step * 10 ** decimals)) decimals++;
    const minus = withMinus;
    // In powers of ten, to the figures that tell ticks a step apart (a window of a few millionths around 0.0897:
    // "8.96728e−2", "8.96730e−2"), at most 15 (as many as a double holds).
    const largest = Math.max(...values.map(Math.abs));
    const figures = Math.min(15, Math.max(6, Math.ceil(Math.log10(largest / step) - 1e-9) + 1));
    if (decimals > 5) return value => (value === 0 ? '0' : minus((+value.toPrecision(figures)).toExponential()));
    return value => minus(decimals ? value.toFixed(decimals) : String(Math.round(value)));
}

/** A time or frequency axis's ticks between `low` and `high` (a log frequency axis's at its round values), with their text. */
export function alongAxisTicks(low: number, high: number, log = false): Array<{ value: number; text: string }> {
    const values = alongTickValues(low, high, log);
    const texts = tickTexts(values, log);
    // A window finer than the digits' cap (under a nanosecond) writes each number once, as rowAxisTicks does (C3).
    return values.map((value, index) => ({ value, text: texts[index] })).filter((tick, index) => texts.indexOf(tick.text) === index);
}

/**
 * An axis's tick texts, each to the digits that tell it from its neighbours (shell/numberText.ts spacingDecimals, the rule
 * every readout's digits follow), so two ticks never read the same and none reads a value it is not at. A log
 * frequency axis writes kHz from 1 kHz ("500", "1k", "1.002k"), all of a window under a decade that crosses 1 kHz
 * in kHz ("0.998k", "1k"), never "1000" beside "1k". A negative tick (a lag, the time from a trigger) with a true minus.
 */
export function tickTexts(values: readonly number[], log: boolean): string[] {
    const gaps = values.slice(1).map((value, index) => Math.abs(value - values[index])).filter(gap => gap > 0);
    const step = gaps.length ? Math.min(...gaps) : undefined;
    if (!log) return values.map(value => (step === undefined ? withMinus(String(value)) : stepText(value, step)));
    const low = Math.min(...values), high = Math.max(...values);
    const allK = high >= 1000 && low < 1000 && high / low < 10;
    return values.map(value => (value >= 1000 || allK ? `${stepText(value / 1000, step === undefined ? undefined : step / 1000)}k` : stepText(value, step)));
}
