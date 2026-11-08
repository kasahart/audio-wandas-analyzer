/**
 * How every plot writes a number it reads out (R7): the pointer's readout, a headline's place and value. One rule
 * per kind of number, so the same value reads the same on every plot (the comparison, the cursor spectrum, the track
 * lanes), and a negative number always has a true minus sign (−), never a hyphen.
 */

/** A number's text with a true minus sign (and an exponent's: "2.5e−7"). */
export function withMinus(text: string): string {
    return text.replace(/^-/, '−').replace('e-', 'e−').replace('e+', 'e');
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
    const needed = stepHz !== undefined && stepHz > 0 && Number.isFinite(stepHz) ? Math.max(0, Math.ceil(-Math.log10(stepHz) - 1e-9)) : 0;
    if (Math.abs(hz) < 1000) {
        if (needed > 1) return `${withMinus(trimmed(hz.toFixed(needed)))} Hz`;
        const whole = Math.round(hz);
        return `${withMinus(Math.abs(hz - whole) < 0.05 ? String(whole) : hz.toFixed(1))} Hz`;
    }
    return `${withMinus(trimmed((hz / 1000).toFixed(3 + needed)))} kHz`;
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
    const size = Math.abs(value);
    if (size >= 1000 && size < 1e6) return String(Number(value.toPrecision(3)));
    return withMinus(value.toPrecision(3));
}

/** A value to three significant figures, in its unit where it has one (° with no space). */
export function amountText(value: number, unit?: string | null): string {
    const number = withMinus(significant(value));
    return unit ? `${number}${unit === '°' ? '°' : ` ${unit}`}` : number;
}

/** A quefrency in milliseconds: to 10 µs under 10 ms, to 0.1 ms from there ("2.50 ms", "12.5 ms"). */
export function quefrencyText(seconds: number): string {
    return `${withMinus((seconds * 1000).toFixed(Math.abs(seconds) < 0.01 ? 2 : 1))} ms`;
}

/**
 * A signed lag in milliseconds: the output later than the input when positive. To 10 µs at any lag (a sample at
 * 96 kHz, since a delay is read sample by sample), and no sign on none ("+1.25 ms", "−0.50 ms", "0.00 ms").
 */
export function lagText(seconds: number): string {
    const ms = (Math.abs(seconds) * 1000).toFixed(2);
    return `${Number(ms) === 0 ? '' : seconds > 0 ? '+' : '−'}${ms} ms`;
}

/** A Bark value to a tenth ("12.5 Bark"). */
export function barkText(bark: number): string {
    return `${withMinus(bark.toFixed(1))} Bark`;
}

/** A level to a tenth of a decibel, in its unit ("−42.3 dB", "61.0 dB SPL"). */
export function levelText(db: number, unit = 'dB'): string {
    return `${withMinus(db.toFixed(1))} ${unit}`;
}

/** A signed number with a sign always written: to a tenth by default ("+23.7", "−1.4"). */
export function signedNumberText(value: number, digits = 1): string {
    return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;
}

/** A signed difference: dB to a tenth with its unit, other values to three significant figures ("+3.2 dB", "−0.125"). */
export function signedText(value: number, db = true): string {
    return db ? `${signedNumberText(value)} dB` : `${value >= 0 ? '+' : '−'}${significant(Math.abs(value))}`;
}
