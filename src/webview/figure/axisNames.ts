/**
 * The words an axis is named in (第 4 節: 軸の名前の言葉 are the Figure's; what they name, the quantity, unit,
 * reference and calibration, comes from layer 2). One rule for the old panes (comparePanes.paneAxes names a level
 * axis by it) and the Figure: a level axis always names its reference (R4), and says when it is uncalibrated.
 */

/** The words a level axis is named with (UiStrings' axisLevelCal / axisLevelUncal, a `{label}` in each). */
export interface LevelAxisWords {
    axisLevelCal: string;
    axisLevelUncal: string;
    axisUnitUnknown: string;
}

/**
 * A level axis's name: its reference's label in the calibrated or the uncalibrated words. With no reference known
 * (`label` null) it says so, never a default dBFS (R4).
 */
export function levelAxisName(words: LevelAxisWords, label: string | null, calibration: 'calibrated' | 'uncalibrated' | 'unknown'): string {
    if (label === null) return words.axisLevelCal.replace('{label}', words.axisUnitUnknown);
    return (calibration === 'uncalibrated' ? words.axisLevelUncal : words.axisLevelCal).replace('{label}', label);
}

// ── A lane of lines: what its axes are named, and how a point of it is written ─────────────────────────────────────

/** What a lane of lines says of its axes (the picture's `axis`, protocol_schema.py FigureAxis): layer 2's, never guessed here. */
export interface LineAxis {
    quantity: 'level' | 'delta' | 'value' | 'count';
    referenceLabel: string;
    calibration: 'calibrated' | 'uncalibrated' | 'unknown';
    /** What is across (a frequency where it is not said: a spectrum). */
    x?: 'frequency' | 'time' | 'quefrency' | 'lag' | 'band' | 'triggerTime';
    /** What the values measure, or (on a Δ lane) what the Δ is of (a level where it is not said). */
    of?: 'level' | 'gain' | 'value' | 'coherence' | 'phase' | 'cepstrum' | 'correlation' | 'roughness';
    /** The unit the values are written in (none said: not known). */
    valueUnit?: string;
    /** What a series over time is of (stage_view.measure_of), and the power it is raised to. */
    measure?: 'amplitude' | 'rms' | 'timeWeightedRms' | 'power' | 'unknown';
    measureExponent?: number;
    /** A cross-channel answer's pair: the compared channel over the reference, from 1 (`base`: the recording over the base's). */
    pair?: { output: number; input: number; base?: boolean };
}

/** The words a lane of lines is named with (UiStrings' names). */
export interface LineAxisWords extends LevelAxisWords {
    axisFrequency: string;
    pairPhaseLabel: string;
    axisBand: string;
    axisTime: string;
    axisQuefrency: string;
    axisBark: string;
    axisLag: string;
    axisDelta: string;
    axisGain: string;
    axisTransferLevel: string;
    axisCoherence: string;
    axisCepstrum: string;
    axisCorrelation: string;
    axisLevelOf: string;
    axisRms: string;
    axisRmsTimeWeighted: string;
    axisPower: string;
    axisRaised: string;
    axisQuantityUnknown: string;
    axisLoudness: string;
    axisSharpness: string;
    axisRoughness: string;
    axisSpecificRoughness: string;
    waveRangeAxisAmplitude: string;
    axisUncalibrated: string;
    stagePairBase: string;
}

/** Whether a lane's values are dB (a level, a gain): a point is written as a level, a Δ of them in dB. */
export const inDb = (axis: Pick<LineAxis, 'of'>): boolean => (axis.of ?? 'level') === 'level' || axis.of === 'gain';

/** Whether a metric's unit names what it measures (loudness in sone, …, a level in dB). */
const namedByUnit = (unit: string | undefined): boolean => unit === 'sone' || unit === 'acum' || unit === 'asper' || unit === 'asper/Bark' || !!unit?.startsWith('dB');

/** An exponent as the backend writes it in the unit (Python's `:g`: 3, 0.5, 0.333333). */
const exponentText = (exponent: number): string => String(Number(exponent.toPrecision(6)));

/** What a metric over time measures, named by its unit (stage_view.METRIC_SERIES_UNITS); the signal's amplitude otherwise. */
function metricName(words: LineAxisWords, unit: string | undefined): string {
    if (unit === 'sone') return words.axisLoudness;
    if (unit === 'acum') return words.axisSharpness;
    if (unit === 'asper') return words.axisRoughness;
    if (unit === 'asper/Bark') return words.axisSpecificRoughness;
    if (unit?.startsWith('dB')) return words.axisLevelOf;
    return words.waveRangeAxisAmplitude;
}

/**
 * The value axis's name of a lane of lines, before any Δ: one rule per quantity. The quantity, unit, measure, pair
 * and calibration are the picture's; only the words are here.
 */
function valueAxisName(words: LineAxisWords, axis: LineAxis): string {
    const of = axis.of ?? 'level';
    const uncal = axis.calibration === 'uncalibrated' ? words.axisUncalibrated : '';
    const unknown = `${words.axisQuantityUnknown} [${words.axisUnitUnknown}]`;
    // A series over time of plain values: what a step measured of the signal (an RMS, a power), raised to the power
    // the backend said, in the signal's unit; the signal's amplitude where no step names it. Never a bare "value".
    if (of === 'value' && (axis.measure || (axis.x === 'time' && !namedByUnit(axis.valueUnit)))) {
        if (axis.measure === 'unknown') return unknown;
        const quantity = axis.measure === 'rms' ? words.axisRms : axis.measure === 'timeWeightedRms' ? words.axisRmsTimeWeighted : axis.measure === 'power' ? words.axisPower : words.waveRangeAxisAmplitude;
        const name = axis.measureExponent === undefined || axis.measureExponent === 1 ? quantity : words.axisRaised.replace('{quantity}', quantity).replace('{p}', exponentText(axis.measureExponent));
        // No unit said is no unit claimed (R4).
        return axis.valueUnit ? `${name}${uncal} [${axis.valueUnit}]` : `${name} [${words.axisUnitUnknown}]`;
    }
    // A level over time (sound_level, rms_trend in dB): the level of what, in the recordings' reference.
    if (of === 'level' && axis.x === 'time') {
        if (axis.measure === 'unknown') return unknown;
        const name = axis.measure === 'rms' ? words.axisRms : axis.measure === 'timeWeightedRms' ? words.axisRmsTimeWeighted : words.axisLevelOf;
        return axis.referenceLabel ? `${name}${uncal} [${axis.referenceLabel}]` : `${name} [${words.axisUnitUnknown}]`;
    }
    const named = of === 'level' ? levelAxisName(words, axis.referenceLabel, axis.calibration)
        // A transfer function of two units is a transfer level in dB re their ratio (A33); of one unit, a gain.
        : of === 'gain' ? (axis.valueUnit ? words.axisTransferLevel.replace('{unit}', axis.valueUnit) : words.axisGain)
            : of === 'coherence' ? words.axisCoherence
                // A transfer function's phase (the pair figure's): in degrees, as its lane's fixed ±180 axis.
                : of === 'phase' ? words.pairPhaseLabel
                : of === 'cepstrum' ? words.axisCepstrum
                    : of === 'correlation' ? words.axisCorrelation
                        : `${metricName(words, axis.valueUnit)} [${axis.valueUnit || words.axisUnitUnknown}]`;
    // A cross-channel answer names its pair after its quantity and before its unit; an uncalibrated gain says so (R4).
    const pair = axis.pair?.base ? ` · ${words.stagePairBase}` : axis.pair ? ` · ch${axis.pair.output} / ch${axis.pair.input}` : '';
    const word = of === 'gain' ? uncal : '';
    if (!pair && !word) return named;
    const at = named.lastIndexOf(' [');
    return at < 0 ? `${named}${word}${pair}` : `${named.slice(0, at)}${word}${pair}${named.slice(at)}`;
}

/** The names of a lane of lines' two axes: across by what is across; up by what its values measure (a Δ of dB: the Δ's own name). */
export function lineAxisNames(words: LineAxisWords, axis: LineAxis): { x: string; y: string } {
    const x = axis.x === 'time' ? words.axisTime : axis.x === 'quefrency' ? words.axisQuefrency : axis.x === 'lag' ? words.axisLag : axis.x === 'band' ? words.axisBand : words.axisFrequency;
    if (axis.quantity !== 'delta') return { x, y: valueAxisName(words, axis) };
    return { x, y: inDb(axis) ? words.axisDelta : `Δ ${valueAxisName(words, axis)}` };
}

/** What an image lane's rows are over (the picture's `axis.y`): a spectrogram's frequencies where it is not said. */
export function rowsAxisName(words: LineAxisWords, rows: 'frequency' | 'bark' | 'quefrency' | undefined): string {
    return rows === 'bark' ? words.axisBark : rows === 'quefrency' ? words.axisQuefrency : words.axisFrequency;
}

/** An image lane's colour axis: the level in its reference, or what its values measure in their unit (as a lane of lines names them). */
export function colourAxisName(words: LineAxisWords, axis: LineAxis): string {
    return lineAxisNames(words, { ...axis, x: undefined }).y;
}

/** A dB axis's unit as its name gives it ("Gain [dB]" → "dB"), written after a level read; none for another axis. */
export function levelUnitOfName(name: string): string {
    const unit = /\[([^\]]+)\]\s*$/u.exec(name)?.[1] ?? '';
    return unit.startsWith('dB') ? unit : '';
}
