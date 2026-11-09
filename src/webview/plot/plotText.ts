/**
 * How every plot writes a number it reads out (R7): the pointer's readout, a headline's place and value. One rule
 * per kind of number, so the same value reads the same on every plot (the comparison, the cursor spectrum, the track
 * lanes), and a negative number always has a true minus sign (−), never a hyphen.
 */

/** A number's text with a true minus sign (and an exponent's: "2.5e−7"). */
export function withMinus(text: string): string {
    return text.replace(/^-/, '−').replace('e-', 'e−').replace('e+', 'e');
}

/**
 * The one rule for how many decimals a number needs (R7): enough that points `step` apart (neighbouring samples,
 * bins, frames, lags, ticks) never read the same, and never fewer than `least`; `most` at most. A time, a frequency,
 * a quefrency, a lag, a tick and a range field all take their decimals from it.
 */
export function spacingDecimals(step: number | undefined, least = 0, most = 9): number {
    if (step === undefined || !(step > 0) || !Number.isFinite(step)) return least;
    return Math.max(least, Math.min(most, Math.ceil(-Math.log10(step) - 1e-9)));
}

/**
 * A tick's number, written exactly as the value it is at and to the digits that tell it from ticks `step` apart
 * (spacingDecimals, and the step's own digits: 2.5 apart, "997.5"), trailing zeros dropped; with a true minus.
 */
export function stepText(value: number, step: number | undefined): string {
    let decimals = spacingDecimals(step);
    while (step !== undefined && decimals < 9 && Math.abs(step * 10 ** decimals - Math.round(step * 10 ** decimals)) > 1e-6) decimals++;
    const text = value.toFixed(decimals);
    return withMinus(text.includes('.') ? text.replace(/\.?0+$/, '') : text);
}

/**
 * An end of a range typed into a field (the axis range popover): to the digits that keep the range `span` wide to a
 * thousandth of itself (spacingDecimals), at least to 0.001, so a range applied unchanged is the range it was
 * (1.23456–1.23461 s stays so, never "1.235"–"1.235"). With a hyphen minus, as a field is typed and parsed.
 */
export function fieldNumberText(value: number, span: number): string {
    return String(Number(value.toFixed(spacingDecimals(Math.abs(span) / 1000, 3, 15))));
}

/** Trailing zeros of a decimal fraction dropped ("3.150" → "3.15", "2.000" → "2"). */
const trimmed = (text: string): string => (text.includes('.') ? text.replace(/\.?0+$/, '') : text);

/**
 * A frequency: below 1 kHz in Hz (a tenth where it is not whole: a bin at 15.6 Hz), from 1 kHz in kHz to the hertz
 * ("1.016 kHz", "3.15 kHz", "12.5 kHz"). `stepHz`, the spacing of the points it is read among, adds the digits that
 * spacing needs, so two neighbouring bins never read the same (0.73 Hz apart: "1.0027 kHz", "1.0034 kHz").
 */
export function frequencyText(hz: number, stepHz?: number): string {
    // Decimals in Hz that tell points `stepHz` apart: a resolution no coarser than the step.
    const needed = spacingDecimals(stepHz);
    if (Math.abs(hz) < 1000) {
        if (needed > 1) return `${withMinus(trimmed(hz.toFixed(needed)))} Hz`;
        const whole = Math.round(hz);
        return `${withMinus(Math.abs(hz - whole) < 0.05 ? String(whole) : hz.toFixed(1))} Hz`;
    }
    return `${withMinus(trimmed((hz / 1000).toFixed(3 + needed)))} kHz`;
}

/**
 * A stretch of time, "1.00–3.00 s": to 10 ms, and finer where it is so short its ends would read alike (to a
 * tenth of its length, spacingDecimals); with a true minus.
 */
export function secondsSpanText(start: number, end: number): string {
    const digits = spacingDecimals(Math.abs(end - start) / 10, 2, 9);
    return `${withMinus(start.toFixed(digits))}–${withMinus(end.toFixed(digits))} s`;
}

/** A time in seconds to `digits` decimals (2 by default: 10 ms). */
export function secondsText(seconds: number, digits = 2): string {
    return `${withMinus(seconds.toFixed(digits))} s`;
}

/**
 * A number to three significant figures ("0.500", "12.3", "123", "1230"): no exponent from 0.001 up to a million,
 * and an exponent outside ("2.50e−7", "1.23e6").
 */
function significant(value: number): string {
    // Decided on the rounded value, so 999.6 (→ 1000) reads as 1000 does.
    const rounded = Number(value.toPrecision(3));
    const size = Math.abs(rounded);
    if (size === 0 || (size >= 0.001 && size < 1e6)) return withMinus(size >= 1000 ? String(rounded) : value.toPrecision(3));
    return withMinus(rounded.toExponential(2));
}

/** A value to three significant figures, in its unit where it has one (° with no space). */
export function amountText(value: number, unit?: string | null): string {
    const number = withMinus(significant(value));
    return unit ? `${number}${unit === '°' ? '°' : ` ${unit}`}` : number;
}

/**
 * A quefrency in seconds, the unit its axis is named in (R4, R7): to 10 µs under 10 ms, to 0.1 ms from there
 * ("0.00250 s", "0.0125 s"), and to the digits that tell points `stepSeconds` apart where they are closer (a sample
 * at 96 kHz: "0.012510 s", "0.012521 s").
 */
export function quefrencyText(seconds: number, stepSeconds?: number): string {
    const digits = Math.max(Math.abs(seconds) < 0.01 ? 5 : 4, spacingDecimals(stepSeconds));
    return `${withMinus(seconds.toFixed(digits))} s`;
}

/**
 * A signed lag in seconds, the unit its axis is named in (R4, R7): the output later than the input when positive.
 * To 10 µs at any lag (a sample at 96 kHz, since a delay is read sample by sample), and no sign on none
 * ("+0.00125 s", "−0.00050 s", "0.00000 s").
 */
export function lagText(seconds: number, stepSeconds?: number): string {
    // Finer than 10 µs apart (a sample past 100 kHz), to the digits that tell neighbouring lags apart.
    const text = Math.abs(seconds).toFixed(spacingDecimals(stepSeconds, 5));
    return `${Number(text) === 0 ? '' : seconds > 0 ? '+' : '−'}${text} s`;
}

/** A Bark value to a tenth ("12.5 Bark"). */
export function barkText(bark: number): string {
    return `${withMinus(bark.toFixed(1))} Bark`;
}

/** A level to a tenth of a decibel, in its unit ("−42.3 dB", "61.0 dB SPL"). */
/** A level and the reference it is in: the caller names it (R4); there is no bare "dB" default. */
export function levelText(db: number, unit: string): string {
    return `${noNegativeZero(withMinus(db.toFixed(1)))}${unit ? ` ${unit}` : ''}`;
}

/** A number written as zero has no sign ("−0.0" is "0.0", A36): a level just below zero is not negative as written. */
const noNegativeZero = (text: string): string => (/^[−-]0(\.0*)?$/u.test(text) ? text.slice(1) : text);

/** A signed number with a sign always written: to a tenth by default ("+23.7", "−1.4"); zero as written is "+0.0", never "−0.0". */
export function signedNumberText(value: number, digits = 1): string {
    const magnitude = Math.abs(value).toFixed(digits);
    return `${value >= 0 || Number(magnitude) === 0 ? '+' : '−'}${magnitude}`;
}

/** A signed difference: dB to a tenth with its unit, other values to three significant figures ("+3.2 dB", "−0.125"). */
export function signedText(value: number, db = true): string {
    return db ? `${signedNumberText(value)} dB` : `${value >= 0 ? '+' : '−'}${significant(Math.abs(value))}`;
}
