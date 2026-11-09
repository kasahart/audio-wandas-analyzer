/** The step bar's words: a chip's label, a value as a field shows it, and why a step cannot run. */
import { secondsSpanText } from '../plot/plotText';
import { SLOT_REFERABLE, type RecipeStep, type StepParam } from '../../shared/recipe/recipeSteps';
import { type RegionRange, type StepBarState, type StepBarStrings } from './stepBarModel';

/**
 * The one-line reason a step cannot run, shown in the footer while the field or chip has focus or the pointer.
 * Steps are named by their chips' labels; `steps` names the step a later one cannot run after.
 */
export function invalidReason(step: RecipeStep, strings: StepBarStrings, steps: readonly RecipeStep[] = []): string {
    const reason = step.reason;
    if (!reason) return '';
    const limit = Number.isFinite(reason.limit) ? String(Math.round(reason.limit * 1000) / 1000) : '∞';
    // A channel is shown from 1: one below `limit` (wandas' index from 0) is the last channel there is.
    if (reason.kind === 'below' && step.editable.some(param => param.kind === 'int' && param.channel && param.name === step.invalid)) {
        return strings.stepNeedChannel.replace('{n}', limit);
    }
    switch (reason.kind) {
        case 'channels': {
            // A step before it left one channel (get_channel, sum, mean), or the files have one.
            const before = reason.text ? steps.find(item => item.id === reason.text) : undefined;
            if (before) return strings.stepNarrowedChannels.replace('{op}', stepChipLabel(before, strings));
            // Only a step that can take the base slot's recording as its reference has that way out (⚙).
            return SLOT_REFERABLE.has(step.operation) ? strings.stepNeedChannels : strings.stepNeedChannelsRemove;
        }
        case 'pair': return strings.stepPairSelf;
        case 'pow2': return strings.stepNeedPow2.replace('{max}', limit);
        case 'above': return strings.stepNeedAbove.replace('{min}', limit);
        case 'integer': return strings.stepNeedInteger;
        case 'frame': return strings.stepNeedFrame.replace('{op}', stepChipLabel(step, strings)).replace('{frame}', reason.text ?? '');
        case 'after': { const before = steps.find(item => item.id === reason.text); return strings.stepAfterBroken.replace('{op}', before ? stepChipLabel(before, strings) : reason.text ?? ''); }
        case 'failed': return strings.stepFailedOn.replace('{reason}', reason.text ?? '');
        case 'rate': return strings.stepNeedRate.replace('{op}', stepChipLabel(step, strings)).replace('{rate}', hzLabel(reason.limit)).replace('{here}', hzLabel(Number(reason.text)));
        default: return strings.stepNeedBelow.replace('{max}', limit);
    }
}

// eslint-disable-next-line @typescript-eslint/no-base-to-string -- Recipe params are JSON scalars
export const formatNumber = (value: unknown): string => (typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value ?? ''));

/**
 * A number as a form field holds it: the stored value itself (to 12 significant digits, which hides float noise), not
 * the chip's three decimals, so a 0.0015 s cutoff reads 0.0015 and typing what is shown changes nothing.
 */
export const fieldNumber = (value: unknown): string => (typeof value === 'number' ? String(Number(value.toPrecision(12))) : formatNumber(value));

/** A wandas channel index (from 0) as the bar shows it, from 1. */
/** A channel index as shown, from 1; a negative one (from the last) as its channel when the channels are known. */
export const channelText = (value: unknown, channels?: number): string => (typeof value !== 'number' ? '?' : value >= 0 ? String(value + 1) : channels ? String(value + channels + 1) : String(value));
/**
 * A channel parameter's value as typed (from 1), back to wandas' index (from 0). A negative one (from the last, as an
 * imported Recipe may have it) stays as it is; there is no channel 0.
 */
export const fromShown = (param: StepParam, value: number): number => (!(param.kind === 'int' && param.channel) || value < 0 ? value : value > 0 ? value - 1 : NaN);

/** A sampling rate as the bar names it: "48 kHz", "44.1 kHz"; "?" when unknown. */
export const hzLabel = (value: number | undefined): string => (value === undefined || !Number.isFinite(value) ? '?' : value >= 1000 ? `${Math.round(value / 100) / 10} kHz` : `${Math.round(value)} Hz`);

const hzText = (value: unknown): string => (typeof value === 'number' ? (value >= 1000 ? `${Math.round(value / 100) / 10} kHz` : `${Math.round(value)} Hz`) : '');
const bandRange = (p: Record<string, unknown>): string => (p['fmin'] !== undefined ? `${hzText(p['fmin'])}–${hzText(p['fmax'])}` : '');

/** A step's chip label; `expanded` (the bar opened with …) adds a band range to the 1/3-octave chip. */
export function stepLabel(step: RecipeStep, strings: StepBarStrings, state: Pick<StepBarState, 'regionRange' | 'region' | 'channels'>, expanded: boolean): string {
    const p = step.params;
    // Measured against the base slot's recording: the chip says so (a channel reference has its pair chip after it).
    if (step.reference === 'slot') return `${step.name} · ${strings.stagePairBase}`;
    switch (step.name) {
        case 'highpass_filter': return `${strings.stepHighpass} ${formatNumber(p['cutoff'])} Hz`;
        case 'lowpass_filter': return `${strings.stepLowpass} ${formatNumber(p['cutoff'])} Hz`;
        case 'bandpass_filter': return `${strings.stepBandpass} ${formatNumber(p['low_cutoff'])}–${formatNumber(p['high_cutoff'])} Hz`;
        case 'time_slice': return `${strings.stepRegion} ${state.regionRange ? secondsSpanText(state.regionRange.start, state.regionRange.end) : state.region ?? strings.stepAll}`;
        case 'welch': return strings.stepAverageFft.replace('{name}', strings.stepAverage).replace('{n}', formatNumber(p['n_fft']));
        case 'stft': return `STFT ${formatNumber(p['n_fft'])}`;
        case 'resampling': return `→ ${hzText(p['target_sr'])}`;
        // The level it fires at, and the channel it watches when that is not the first.
        case 'trigger': return `${strings.stepTrigger}${typeof p['channel'] === 'number' && p['channel'] !== 0 ? ` ch${channelText(p['channel'], step.channels ?? state.channels)}` : typeof p['channel'] === 'string' ? ` ${p['channel']}` : ''} ${formatNumber(p['threshold'])}`;
        // Source ids ("c1") are named as wandas has them; indices as channels from 1.
        case 'select_pair': return typeof p['output'] === 'string' || typeof p['input'] === 'string' ? `${String(p['output'])} / ${String(p['input'])}`
            : strings.stepPair.replace('{output}', channelText(p['output'], step.channels ?? state.channels)).replace('{input}', channelText(p['input'], step.channels ?? state.channels));
        case 'noct_spectrum': {
            const octave = p['n'] !== undefined && p['n'] !== 3 ? `1/${formatNumber(p['n'])} oct` : strings.stepOctave;
            return expanded && bandRange(p) ? `${octave} ${bandRange(p)}` : octave;
        }
        default: return step.name;
    }
}

/** A step's chip label, as the bar names it (the comparison's headline names bypassed steps by it too). */
export function stepChipLabel(step: RecipeStep, strings: StepBarStrings, regionRange?: RegionRange | null): string {
    return stepLabel(step, strings, { regionRange }, false);
}
