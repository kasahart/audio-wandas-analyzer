/**
 * The step bar's view of a wandas Recipe: one chip per node, the parameters each one takes, the Frame
 * each gives, and edits written back in the Recipe's own encoding: a parameter set, a step added after
 * another or taken out. Which operations exist and which Frame each takes and gives is wandas' registry
 * (recipeCatalog.ts), with each parameter's default and choices from wandas' own description; how the
 * analyzer lets one be set (kind, unit, bounds, what a new step starts with) is listed here.
 */
import type { RecipeDocument } from './recipeSelection';
import { operationGroup } from './operationGuide';
import { catalogOperation, INPUT_FRAME, isSegments, metricSeries, outputOf, WANDAS_OPERATIONS, type CatalogOperation, type CatalogParam } from './recipeCatalog';

/**
 * `default`: what wandas uses when the Recipe leaves the parameter out (from its description), shown and
 * written as the actual value. `initial`: what a new step starts with for a parameter wandas has no default for.
 * `nullable`: None is a value of it (wandas then picks one itself): an empty number field, or "none" in a choice.
 */
export type StepParam =
    | { name: string; kind: 'float'; unit?: string; min?: number; max?: 'nyquist' | number; nullable?: boolean; default?: number; initial?: number }
    | { name: string; kind: 'int'; min?: number; max?: number; powerOfTwo?: boolean; nullable?: boolean; default?: number; initial?: number; belowChannels?: boolean; channel?: 'output' | 'input' | 'watched' }
    | { name: string; kind: 'enum'; options: readonly string[]; nullable?: boolean; default?: string }
    | { name: string; kind: 'bool'; default?: boolean }
    | { name: string; kind: 'str'; nullable?: boolean; default?: string };

const WINDOWS = ['hann', 'hamming', 'blackman', 'boxcar'] as const;

/** The level trigger: cuts every event where a channel crosses a level into wandas' ChannelFrameSegments. */
export const TRIGGER = 'wandas.audio.trigger';
/** What takes a trigger's events: their mean, and their transfer function and coherence averaged over them. */
export const SEGMENTS_TRANSFER = 'wandas.segments.transfer_function';
export const SEGMENTS_COHERENCE = 'wandas.segments.coherence';

/** What the analyzer lets the step bar edit, per wandas operation id, before wandas' defaults are added. */
const SETTABLE: Record<string, readonly StepParam[]> = {
    'wandas.audio.highpass_filter': [{ name: 'cutoff', kind: 'float', unit: 'Hz', min: 0, max: 'nyquist', initial: 20 }, { name: 'order', kind: 'int', min: 1, max: 10 }],
    'wandas.audio.lowpass_filter': [{ name: 'cutoff', kind: 'float', unit: 'Hz', min: 0, max: 'nyquist', initial: 1000 }, { name: 'order', kind: 'int', min: 1, max: 10 }],
    'wandas.audio.bandpass_filter': [
        { name: 'low_cutoff', kind: 'float', unit: 'Hz', min: 0, max: 'nyquist', initial: 100 },
        { name: 'high_cutoff', kind: 'float', unit: 'Hz', min: 0, max: 'nyquist', initial: 1000 },
        { name: 'order', kind: 'int', min: 1, max: 10 },
    ],
    'wandas.audio.welch': [
        { name: 'n_fft', kind: 'int', min: 64, max: 65536, powerOfTwo: true },
        { name: 'window', kind: 'enum', options: WINDOWS },
    ],
    'wandas.audio.stft': [
        { name: 'n_fft', kind: 'int', min: 64, max: 65536, powerOfTwo: true },
        { name: 'window', kind: 'enum', options: WINDOWS },
    ],
    'wandas.audio.noct_spectrum': [
        { name: 'fmin', kind: 'float', unit: 'Hz', min: 0, max: 'nyquist' },
        // wandas' 20 kHz is above what most files give (MoSQITo stops at 0.88 × Nyquist): a new step starts at 6.3 kHz.
        { name: 'fmax', kind: 'float', unit: 'Hz', min: 0, max: 'nyquist', initial: 6300 },
        { name: 'n', kind: 'int', min: 1, max: 24 },
    ],
    // A spectrum's 1/N-octave levels: wandas has no default band range, so a new step starts at 25 Hz–6.3 kHz.
    'wandas.spectral.noct_synthesis': [
        { name: 'fmin', kind: 'float', unit: 'Hz', min: 0, max: 'nyquist', initial: 25 },
        { name: 'fmax', kind: 'float', unit: 'Hz', min: 0, max: 'nyquist', initial: 6300 },
        { name: 'n', kind: 'int', min: 1, max: 24 },
    ],
    // wandas declares both of its selectors optional, but one is needed: the step bar sets the channel.
    'wandas.frame.get_channel': [{ name: 'channel_idx', kind: 'int', min: 0, max: 63, initial: 0, belowChannels: true }],
    // Likewise one of length or duration is needed: a new step starts at the region's length (StepLimits.lengthS).
    'wandas.audio.fix_length': [{ name: 'duration', kind: 'float', unit: 's', min: 0, max: 3600, initial: 1 }],
    // A lifter keeps the quefrencies below (low) or above (high) its cutoff: wandas has no default cutoff, so a new
    // step starts at 2 ms, the spectral-envelope split wandas' own examples use. A cutoff the cepstrum is too short
    // for is wandas' to refuse.
    'wandas.cepstral.lifter': [{ name: 'cutoff', kind: 'float', unit: 's', min: 0, initial: 0.002 }, { name: 'mode', kind: 'enum', options: ['low', 'high'] }],
    'wandas.cepstrogram.lifter': [{ name: 'cutoff', kind: 'float', unit: 's', min: 0, initial: 0.002 }, { name: 'mode', kind: 'enum', options: ['low', 'high'] }],
    'wandas.audio.resampling': [{ name: 'target_sr', kind: 'float', unit: 'Hz', min: 0, max: 384000, initial: 16000 }],
    'wandas.audio.rms_trend': [
        { name: 'frame_length', kind: 'int', min: 16, max: 65536 },
        { name: 'hop_length', kind: 'int', min: 1, max: 65536 },
    ],
    'wandas.audio.fade': [{ name: 'fade_ms', kind: 'float', unit: 'ms', min: 0, max: 10000 }],
    // Every channel pair over every lag is large (8 channels of 30 s: GBs): a new step keeps ±0.1 s, the delays
    // a room or a machine gives.
    'wandas.audio.cross_correlation': [{ name: 'max_lag', kind: 'float', unit: 's', min: 0, max: 3600, initial: 0.1 }],
    // A level trigger: the channel it watches, the level it fires at (the waveform's unit; a new step starts at half
    // the tracks' peak, StepBarState.peak), each event's length and the part before the trigger it keeps.
    [TRIGGER]: [
        { name: 'channel', kind: 'int', min: 0, max: 63, belowChannels: true, channel: 'watched' },
        { name: 'threshold', kind: 'float', initial: 0.1 },
        { name: 'duration', kind: 'float', unit: 's', min: 0, max: 60, initial: 0.2 },
        { name: 'pre', kind: 'float', unit: 's', max: 60 },
        { name: 'slope', kind: 'enum', options: ['rising', 'falling'] },
    ],
    // The pair a cross-channel step is drawn and measured for: the compared channel over the reference (wandas'
    // source indices from 0; the step bar shows them from 1, as ch1, ch2).
    'wandas.frame.select_pair': [
        { name: 'output', kind: 'int', min: 0, max: 63, initial: 1, belowChannels: true, channel: 'output' },
        { name: 'input', kind: 'int', min: 0, max: 63, initial: 0, belowChannels: true, channel: 'input' },
    ],
};

/** Steps that compare the channels of one recording, pair by pair: they need two channels. */
export const CROSS_CHANNEL: ReadonlySet<string> = new Set(['wandas.audio.coherence', 'wandas.audio.cross_correlation', 'wandas.audio.csd', 'wandas.audio.transfer_function', 'wandas.spectrogram.csd', SEGMENTS_TRANSFER, SEGMENTS_COHERENCE]);
/**
 * Steps that need two channels: the cross-channel ones, and channel_difference, which on one channel subtracts the
 * only channel from itself (all zeros).
 */
export const NEEDS_TWO_CHANNELS: ReadonlySet<string> = new Set([...CROSS_CHANNEL, 'wandas.audio.channel_difference']);
export const SELECT_PAIR = 'wandas.frame.select_pair';
/**
 * Cross-channel steps that come with their pair (select_pair after them). A CSD does not: coherence and the
 * transfer function derived from it need its auto-spectra, which select_pair would leave out.
 */
export const PAIRED_ON_ADD: ReadonlySet<string> = new Set(['wandas.audio.coherence', 'wandas.audio.cross_correlation', 'wandas.audio.transfer_function', SEGMENTS_TRANSFER, SEGMENTS_COHERENCE]);
/**
 * Cross-channel steps that can take the base slot's recording as their reference: those on a time signal, which is
 * where the two recordings are joined (wandas joins time signals; a spectrogram's CSD and a trigger's events have no
 * such join).
 */
export const SLOT_REFERABLE: ReadonlySet<string> = new Set([...CROSS_CHANNEL].filter(id => id !== 'wandas.spectrogram.csd' && id !== SEGMENTS_TRANSFER && id !== SEGMENTS_COHERENCE));

/** Steps that leave one channel: one picked, or all summed or averaged into one. */
const ONE_CHANNEL: ReadonlySet<string> = new Set(['wandas.audio.sum', 'wandas.audio.mean']);

/** wandas' Frames of channel pairs (PairwiseFrame, PairwiseSpectralFrame and its kinds). */
const PAIRWISE_FRAMES: ReadonlySet<string> = new Set(['PairwiseFrame', 'PairwiseSpectralFrame', 'CrossSpectralFrame', 'CoherenceFrame', 'TransferFunctionFrame', 'CrossCorrelationFrame']);

/**
 * The channels a step leaves of `channels`: one after sum or mean, one fewer after remove_channel, and after
 * get_channel as many as it selects (one index: one; a list: its length; a query or a mask: not known here).
 */
function channelsAfter(node: RecipeNode, channels: number | undefined, frame: string): number | undefined {
    if (channels === undefined) return undefined;
    // A pairwise Frame's rows are pairs: selecting some keeps the recording's channels.
    if (PAIRWISE_FRAMES.has(frame)) return channels;
    if (ONE_CHANNEL.has(node.operation)) return 1;
    if (node.operation === 'wandas.frame.get_channel') {
        const index = node.params?.entries?.find(([name]) => name === 'channel_idx')?.[1] as { $type?: string; items?: unknown[] } | number | undefined;
        if (typeof index === 'number') return 1;
        return index?.$type === 'list' && Array.isArray(index.items) && index.items.every(item => typeof item === 'number') ? index.items.length : undefined;
    }
    if (node.operation === 'wandas.channel.remove_channel') return Math.max(1, channels - 1);
    return channels;
}

/**
 * Parameters a step's form leaves out although they are one plain value, because the app sets them elsewhere; with
 * why. Every other parameter wandas describes as one plain value is a field (recipeSteps.test.ts checks it).
 */
export const APP_SET_PARAMS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    'wandas.frame.get_channel': { validate_query_keys: 'goes with query, which the step bar does not use: it picks channels by index' },
    'wandas.frame.time_slice': { reference: "the region chip's start and end are the file's own seconds" },
};

/** A parameter's field from wandas' description of it alone: its kind, and whether None is a value of it. */
function describedParam(param: CatalogParam): StepParam | undefined {
    const nullable = param.nullable ? { nullable: true } : {};
    switch (param.kind) {
        case 'enum': return { name: param.name, kind: 'enum', options: param.choices ?? [], ...nullable };
        case 'bool': return { name: param.name, kind: 'bool' };
        case 'int': return { name: param.name, kind: 'int', ...nullable };
        case 'float': return { name: param.name, kind: 'float', ...nullable };
        // A window is any of SciPy's names: the step bar offers the ones it draws with (as welch's and stft's).
        case 'str': return param.name === 'window' ? { name: param.name, kind: 'enum', options: WINDOWS } : { name: param.name, kind: 'str', ...nullable };
        default: return undefined;
    }
}

/** `param` with the default wandas describes for it, when that default is a value of its kind. */
function withDescribedDefault(param: StepParam, described: CatalogParam['default']): StepParam {
    if (described === undefined) return param;
    const fits = param.kind === 'bool' ? typeof described === 'boolean'
        : param.kind === 'enum' || param.kind === 'str' ? typeof described === 'string'
            : typeof described === 'number';
    return fits ? { ...param, default: described } as StepParam : param;
}

/**
 * Every operation's form fields: those the analyzer lists (SETTABLE: units, bounds, a new step's value) first, then
 * every other parameter wandas describes as one plain value, in wandas' order, each with wandas' default.
 */
export const STEP_PARAMS: Record<string, readonly StepParam[]> = Object.fromEntries([...new Set([...WANDAS_OPERATIONS.map(operation => operation.id), ...Object.keys(SETTABLE)])].map((id): [string, StepParam[]] => {
    const described = catalogOperation(id)?.params ?? [];
    const listed = SETTABLE[id] ?? [];
    const others = described.filter(param => !listed.some(item => item.name === param.name) && !(APP_SET_PARAMS[id]?.[param.name]))
        .flatMap(param => describedParam(param) ?? []);
    return [id, [...listed, ...others].map(param => withDescribedDefault(param, described.find(item => item.name === param.name)?.default))];
}).filter(([, params]) => params.length));

/** What a new step starts with for `param`, when the analyzer sets one (a number wandas has no default for). */
const initialOf = (param: StepParam): number | undefined => ((param.kind === 'int' || param.kind === 'float') ? param.initial : undefined);

export const TIME_SLICE = 'wandas.frame.time_slice';

export interface RecipeNode {
    id: string;
    operation: string;
    version: number;
    inputs: string[];
    params: { $type: 'map'; entries: Array<[string, unknown]> };
}

type ParamValue = number | string | boolean | null;

/** A wandas Recipe number: integers as they are, floats as their big-endian IEEE 754 bytes. */
/**
 * A number as the Recipe stores it. Schema 3 (wandas 0.10) writes a finite float as a plain JSON number
 * and refuses the tagged form; schema 2 needs the tagged form, so `plain` follows the Recipe's schema.
 */
export function encodeNumber(value: number, kind: 'float' | 'int', plain = false): unknown {
    // A non-integer is kept as typed, so validation refuses it instead of rounding it silently.
    if (kind === 'int') return Number.isInteger(value) ? value : encodeNumber(value, 'float', plain);
    if (plain && Number.isFinite(value)) return value;
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const data = Array.from(new Uint8Array(view.buffer), byte => byte.toString(16).padStart(2, '0')).join('');
    return { $type: 'number', kind: 'python-float', data };
}

/** Whether the Recipe's schema stores floats as plain JSON numbers (wandas 0.10's schema 3 and later). */
export function plainFloats(recipe: RecipeDocument): boolean {
    return typeof recipe.version === 'number' && recipe.version >= 3;
}

export function decodeParam(value: unknown): ParamValue {
    if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
    const encoded = value as { $type?: string; kind?: string; data?: string };
    if (encoded?.$type === 'number' && encoded.kind === 'python-float' && typeof encoded.data === 'string' && /^[0-9a-f]{16}$/.test(encoded.data)) {
        const view = new DataView(new ArrayBuffer(8));
        (encoded.data.match(/../g) ?? []).forEach((pair, index) => view.setUint8(index, parseInt(pair, 16)));
        return view.getFloat64(0);
    }
    return null;
}

/** The Recipe's nodes as wandas writes them (RecipeDocument leaves `nodes` untyped); none for a missing Recipe. */
export function recipeNodes(recipe: RecipeDocument | null | undefined): RecipeNode[] {
    const list = recipe?.['nodes'];
    return Array.isArray(list) ? list as RecipeNode[] : [];
}

/** An operation's name: the last part of its dotted id ("wandas.audio.welch" → "welch"). */
const lastSegment = (id: string): string => id.slice(id.lastIndexOf('.') + 1);

/** The nodes from the input to the output, in order: the entry Recipe is one chain. */
export function recipeChain(recipe: RecipeDocument): RecipeNode[] {
    const byId = new Map(recipeNodes(recipe).map(node => [node.id, node]));
    const chain: RecipeNode[] = [];
    let id = typeof recipe.output === 'string' ? recipe.output : undefined;
    for (let node = id ? byId.get(id) : undefined; node; node = id ? byId.get(id) : undefined) {
        chain.unshift(node);
        id = node.inputs[0];
    }
    return chain;
}

export interface RecipeStep {
    id: string;
    operation: string;
    /** Short name of the operation: "highpass_filter", "welch". */
    name: string;
    params: Record<string, ParamValue>;
    editable: readonly StepParam[];
    /** The Frame the step takes (what the step before gives) and the Frame it gives. */
    input: string;
    output: string;
    /** The parameter that breaks the step for this folder, if any ("" for the step itself); such a step is left out. */
    invalid?: string;
    /** Bypassed in the step bar: kept in the chain but skipped, so it passes on the Frame it took. */
    bypassed?: boolean;
    /** A cross-channel step's reference is the comparison's base slot (another recording), not a channel. */
    reference?: 'slot';
    /** The channels of the Frame after it, when the folder's are known. */
    channels?: number;
    /** The sampling rate (Hz) after it, when the folder's is known (a resampling step changes it). */
    sampleRate?: number;
    /**
     * A metric's time series (rms_trend, loudness…) after it: a ChannelFrame, though not a sound signal, whose
     * refusals the catalog names apart (`ChannelFrame:<metric>`, operation_probe.metric_series).
     */
    series?: string;
    /**
     * Why: the value must stay below `limit`, or be a power of two from 64 up to `limit`; the step cannot
     * take the Frame before it (`frame`); it failed on a file (`failed`, wandas' own words in `text`); it runs
     * at one sampling rate only (`rate`: `limit`, the rate there in `text`); or a step before it cannot run
     * (`after`, that step's id in `text`), so nothing after it can either.
     */
    reason?: { kind: 'below' | 'above' | 'pow2' | 'integer' | 'frame' | 'failed' | 'after' | 'channels' | 'pair' | 'rate'; limit: number; text?: string };
}

export interface StepLimits {
    sampleRate?: number;
    /** Samples in the shortest file: an FFT longer than that has nothing to average. */
    shortestSamples?: number;
    /** Channels of the folder's files (the fewest): a channel index must stay below it, a channel pair needs two. */
    channels?: number;
    /** Steps that failed on a file, with wandas' reason: left out until the Recipe changes. */
    failed?: Readonly<Record<string, string>>;
}

type Invalid = { param: string; reason: NonNullable<RecipeStep['reason']> } | undefined;

/**
 * Operations wandas runs at one sampling rate only, raising otherwise: SpectralFrame.noct_synthesis takes 48 kHz
 * (MoSQITo's filter bank). ＋ greys them out at another rate, and a chain holding one marks it, rather than the
 * comparison drawing an empty plot (test_operation_catalog.py checks wandas still refuses the other rates).
 */
export const FIXED_RATE: Readonly<Record<string, number>> = { 'wandas.spectral.noct_synthesis': 48000 };

/**
 * The rate of a metric's series, where wandas fixes it whatever the input's rate (MoSQITo's time steps):
 * test_operation_catalog.py checks wandas still gives these. rms_trend's is the input's over its hop.
 */
export const METRIC_RATE: Readonly<Record<string, number>> = {
    'wandas.audio.loudness_zwtv': 500, 'wandas.audio.sharpness_din': 500, 'wandas.audio.roughness_dw': 10,
};

/**
 * The sampling rate after a step: a resampling step's target; a metric's series' rate (METRIC_RATE, or the input's
 * over rms_trend's hop), so a filter or an FFT after it is judged at the rate it runs at; unknown after the other
 * metrics over time (roughness_dw_spec), so FIXED_RATE is not judged on a stale rate; else the rate before it.
 */
function rateAfter(node: RecipeNode, rate: number | undefined): number | undefined {
    const value = (name: string): ParamValue | undefined => {
        const found = node.params.entries.find(([key]) => key === name)?.[1];
        return found === undefined ? undefined : decodeParam(found);
    };
    if (node.operation in METRIC_RATE) return METRIC_RATE[node.operation];
    if (node.operation === 'wandas.audio.rms_trend') {
        const hop = value('hop_length') ?? 512;
        return rate !== undefined && typeof hop === 'number' && hop > 0 ? rate / hop : undefined;
    }
    // A level over time and a trigger's segments keep the recording's rate.
    if (['wandas.audio.sound_level', 'wandas.audio.trigger', 'wandas.segments.average'].includes(node.operation)) return rate;
    if (operationGroup(node.operation) === 'time') return undefined;
    if (node.operation !== 'wandas.audio.resampling') return rate;
    const target = value('target_sr');
    return typeof target === 'number' && Number.isFinite(target) && target > 0 ? target : undefined;
}

/** Whether `operation` cannot run at `rate`: it needs another one (FIXED_RATE). Unknown rates are not judged. */
export function wrongRate(operation: string, rate: number | undefined): number | undefined {
    const required = FIXED_RATE[operation];
    return required !== undefined && rate !== undefined && Math.round(rate) !== required ? required : undefined;
}

function invalidParam(params: Record<string, ParamValue>, editable: readonly StepParam[], limits: StepLimits, channels: number | undefined): Invalid {
    const nyquist = limits.sampleRate ? limits.sampleRate / 2 : Infinity;
    for (const param of editable) {
        const value = params[param.name];
        if (value === null || value === undefined) continue;
        if (param.kind === 'enum') { if (!param.options.includes(String(value))) return { param: param.name, reason: { kind: 'below', limit: 0 } }; continue; }
        // On or off, or text: wandas judges the value (a refusal marks the step with wandas' reason).
        if (param.kind === 'bool' || param.kind === 'str') continue;
        if (param.kind === 'int') {
            // A channel named by its source id (select_pair's "c1") is wandas' to resolve: kept as it is.
            if (param.channel && typeof value === 'string') continue;
            // 2.5 is not an order: refused, not rounded.
            if (typeof value === 'number' && !Number.isInteger(value)) return { param: param.name, reason: { kind: 'integer', limit: 0 } };
            // A negative channel counts from the last, as wandas resolves it.
            if (param.channel && typeof value === 'number' && value < 0) {
                if (channels !== undefined && value < -channels) return { param: param.name, reason: { kind: 'below', limit: channels } };
                continue;
            }
            // The largest power of two that fits the shortest file, so the limit itself is a value one can type.
            // A parameter without bounds here (one only wandas describes) is wandas' to judge past being an integer.
            const max = param.max ?? Infinity;
            const limit = param.powerOfTwo && limits.shortestSamples ? Math.min(max, 2 ** Math.floor(Math.log2(limits.shortestSamples)))
                : param.belowChannels && channels ? Math.min(max, channels - 1) : max;
            const ok = typeof value === 'number' && Number.isInteger(value) && value >= (param.min ?? -Infinity) && value <= limit && (!param.powerOfTwo || (value & (value - 1)) === 0);
            if (!ok) return { param: param.name, reason: param.powerOfTwo ? { kind: 'pow2', limit } : { kind: 'below', limit: limit + 1 } };
            continue;
        }
        const max = param.max === 'nyquist' ? nyquist : param.max ?? Infinity;
        // The bound that is broken is the one named: above the minimum, or below the maximum.
        if (typeof value === 'number' && param.min !== undefined && value <= param.min) return { param: param.name, reason: { kind: 'above', limit: param.min } };
        if (typeof value !== 'number' || !Number.isFinite(value) || value >= max) {
            return { param: param.name, reason: { kind: 'below', limit: max } };
        }
    }
    // A channel over itself is 1 (coherence), 0 dB (gain): nothing compared.
    // Negative channels from the last, when the channels are known.
    const resolved = (value: ParamValue | undefined): ParamValue | undefined => (typeof value === 'number' && value < 0 && channels !== undefined ? value + channels : value);
    const output = resolved(params['output']), input = resolved(params['input']);
    if (editable.some(param => param.kind === 'int' && param.channel) && (typeof output === 'number' || typeof output === 'string') && output === input) return { param: 'output', reason: { kind: 'pair', limit: 0 } };
    const low = params['low_cutoff'], high = params['high_cutoff'];
    if (typeof low === 'number' && typeof high === 'number' && low >= high) return { param: 'high_cutoff', reason: { kind: 'below', limit: Math.min(nyquist, Infinity) } };
    const fmin = params['fmin'], fmax = params['fmax'];
    if (typeof fmin === 'number' && typeof fmax === 'number' && fmin >= fmax) return { param: 'fmax', reason: { kind: 'below', limit: nyquist } };
    return undefined;
}

/** The Frame an operation gives for `input`: from wandas' registry, or undefined when it cannot take it. */
function stepOutput(operation: string, input: string): string | undefined {
    const known = catalogOperation(operation);
    // Not in this wandas' registry: taken as giving what it took.
    return known ? outputOf(known, input) : input;
}

/** What an operation gives when it does run, whatever it was handed: for naming the Frames past a break. */
function declaredOutput(operation: string, input: string): string {
    const known = catalogOperation(operation);
    return known && known.output !== '*' ? known.output : input;
}

/**
 * The Recipe as step-bar chips, each with its parameters, the Frame it takes and gives, and whether it is
 * valid for the folder (`limits`, or a sample rate). The first step that cannot run breaks the chain: every
 * step after it cannot run either (`after`), and keeps the Frames it would take and give had it run.
 */
export function recipeSteps(recipe: RecipeDocument, limits?: number | StepLimits): RecipeStep[] {
    const bounds: StepLimits = typeof limits === 'number' ? { sampleRate: limits } : limits ?? {};
    let frame = INPUT_FRAME;
    let broken: string | undefined;
    // The channels the Frame here has, as far as the steps say (get_channel leaves one).
    let channels = bounds.channels;
    let rate = bounds.sampleRate;
    // Samples in the shortest file here: a metric's series or a resampling has as many fewer as its rate is lower.
    let samples = bounds.shortestSamples;
    // The step that left one channel, if one did (rather than the files having one).
    let narrowedBy: string | undefined;
    // The metric the time signal here came through, as stage_view.metric_operation reads it from the history.
    let metric: string | undefined;
    const skipped = new Set(bypassedSteps(recipe));
    const slotted = new Set(slotReferenced(recipe));
    return recipeChain(recipe).map(node => {
        const editable = STEP_PARAMS[node.operation] ?? [];
        // A parameter the Recipe leaves out has wandas' default: shown as that value, not as an empty field.
        const params: Record<string, ParamValue> = Object.fromEntries(editable.flatMap(param => (param.default === undefined ? [] : [[param.name, param.default]])));
        for (const [name, value] of node.params.entries) params[name] = decodeParam(value);
        const output = stepOutput(node.operation, frame);
        const failed = bounds.failed?.[node.id];
        const invalid: Invalid = broken !== undefined ? { param: '', reason: { kind: 'after', limit: 0, text: broken } }
            // A bypassed step does not run, so the Frame before it is not its to take (a pair after a bypassed coherence).
            : output === undefined && !skipped.has(node.id) ? { param: '', reason: { kind: 'frame', limit: 0, text: frame } }
            : failed !== undefined ? { param: '', reason: { kind: 'failed', limit: 0, text: failed } }
            : !skipped.has(node.id) && wrongRate(node.operation, rate) !== undefined ? { param: '', reason: { kind: 'rate', limit: wrongRate(node.operation, rate) ?? 0, text: String(rate) } }
            // One channel has nothing to be compared with: its only pair is itself (a channel difference is all zeros). A bypassed step does not run,
            // so the channels there do not bound it.
            : NEEDS_TWO_CHANNELS.has(node.operation) && !skipped.has(node.id) && !slotted.has(node.id) && channels !== undefined && channels < 2 ? { param: '', reason: { kind: 'channels', limit: 2, ...(narrowedBy ? { text: narrowedBy } : {}) } }
                // A pairwise Frame's rows are its pairs (n² of n channels): get_channel there picks a row.
                : invalidParam(params, editable, { ...bounds, sampleRate: rate, shortestSamples: samples }, skipped.has(node.id) ? undefined : PAIRWISE_FRAMES.has(frame) && node.operation === 'wandas.frame.get_channel' && channels !== undefined ? channels * channels : channels);
        const step: RecipeStep = {
            id: node.id, operation: node.operation, name: lastSegment(node.operation), params, editable,
            input: frame, output: output ?? declaredOutput(node.operation, frame), ...(invalid ? { invalid: invalid.param, reason: invalid.reason } : {}),
            ...(skipped.has(node.id) ? { bypassed: true } : {}),
            ...(slotted.has(node.id) ? { reference: 'slot' as const } : {}),
        };
        if (invalid && broken === undefined) broken = step.id;
        // Past a break the Frames are the ones the steps would take and give, to name and place them.
        if ((!invalid || invalid.reason.kind === 'after') && !step.bypassed) {
            frame = step.output;
            const before = channels;
            // Measured against the base slot, it runs on the joined pair: a channel of each recording.
            channels = channelsAfter(node, slotted.has(node.id) ? 2 : channels, step.input);
            if (before !== undefined && before > 1 && channels === 1) narrowedBy = step.id;
            const next = rateAfter(node, rate);
            samples = samples !== undefined && rate !== undefined && next !== undefined ? Math.floor(samples * next / rate) : next === rate ? samples : undefined;
            rate = next;
            metric = metricSeries(node.operation) !== undefined ? node.operation : metric;
        }
        const series = metric !== undefined && frame === INPUT_FRAME ? metricSeries(metric) : undefined;
        if (series !== undefined) step.series = series;
        if (channels !== undefined) step.channels = channels;
        if (rate !== undefined) step.sampleRate = rate;
        return step;
    });
}

/** The first step that cannot run, if any: the chain is broken there and nothing after it runs. */
export function brokenStep(recipe: RecipeDocument, limits?: number | StepLimits): RecipeStep | undefined {
    return recipeSteps(recipe, limits).find(step => step.invalid !== undefined);
}

/** The Frame the chain would give, past a break too (what decides whether it has the 1/3-octave branch). */
export function chainEnd(recipe: RecipeDocument, limits?: number | StepLimits): string {
    const steps = recipeSteps(recipe, limits).filter(step => !step.bypassed && (step.invalid === undefined || step.reason?.kind === 'after'));
    return steps.length ? steps[steps.length - 1].output : INPUT_FRAME;
}

/** The Frame the chain gives once its invalid steps are left out. */
export function chainOutput(recipe: RecipeDocument, limits?: number | StepLimits): string {
    const valid = recipeSteps(recipe, limits).filter(step => step.invalid === undefined && !step.bypassed);
    return valid.length ? valid[valid.length - 1].output : INPUT_FRAME;
}

/**
 * Whether the chain ends with a trigger's events: wandas runs a Recipe only to a Frame (their mean, transfer
 * function or coherence), so such a chain is compared on screen but cannot be exported to run on files.
 */
export function endsInEvents(recipe: RecipeDocument, limits?: number | StepLimits): boolean {
    return isSegments(chainOutput(recipe, limits));
}

/**
 * The step whose Frame is the chain's time signal: the last of the valid steps from the input that all
 * give a ChannelFrame (the scan's Leq and its 1/3-octave branch read it; scan_service.py's `signal`).
 */
export function timeSignalStep(recipe: RecipeDocument, limits?: number | StepLimits): RecipeStep | undefined {
    let last: RecipeStep | undefined;
    for (const step of recipeSteps(recipe, limits).filter(item => item.invalid === undefined && !item.bypassed)) {
        if (step.output !== INPUT_FRAME) break;
        last = step;
    }
    return last;
}

/** The Recipe up to one of its steps, which becomes its output. */
export function upToStep(recipe: RecipeDocument, stepId: string): RecipeDocument {
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument & { nodes: RecipeNode[]; output: string };
    const keep = new Set<string>();
    const pending = [stepId];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
        const node = copy.nodes.find(item => item.id === id);
        if (!node || keep.has(id)) continue;
        keep.add(id);
        pending.push(...node.inputs);
    }
    copy.nodes = copy.nodes.filter(node => keep.has(node.id));
    copy.output = stepId;
    return copy;
}

/** An operation the step bar's ＋ offers at one place in the chain, and why it is off if it is. */
export interface AddableOperation {
    operation: CatalogOperation;
    name: string;
    /**
     * Set when it cannot be added here: it does not take this Frame, it fails on it whatever the file
     * (`refuses`, with wandas' reason in `why`), it runs at another sampling rate only (`rate`, the rate it
     * needs in `why`), or it needs a value the app cannot set.
     */
    off?: 'frame' | 'refuses' | 'unavailable' | 'required' | 'channels' | 'rate';
    why?: string;
    /** Whether the step bar can set its parameters (STEP_PARAMS), or it has none; without, it runs with wandas' defaults. */
    settable: boolean;
}

/**
 * What ＋ offers after a step that gives `frame`: every operation of wandas' registry a chain can hold,
 * those that take this Frame first. The time slice is the region's and is not added twice.
 */
/**
 * Operations the ＋ menu leaves out: the region is the step bar's own, and wandas.numpy.ufunc (wandas 0.10)
 * needs a NumPy function name the app has no way to set, so it would only be a greyed entry; so do the segment
 * operations that take lists.
 */
const MENU_HIDDEN: ReadonlySet<string> = new Set([TIME_SLICE, 'wandas.numpy.ufunc',
    // Events cut at given times, and events dropped or picked by their IDs: lists of values the step bar has no field for.
    'wandas.audio.segment', 'wandas.segments.drop', 'wandas.segments.select']);

export function addableOperations(frame: string, lacks?: ReadonlySet<string>, channels?: number, sampleRate?: number, series?: string): AddableOperation[] {
    return WANDAS_OPERATIONS.filter(operation => !MENU_HIDDEN.has(operation.id)).map(operation => {
        const settable = operation.id in STEP_PARAMS || !operation.params.some(param => param.kind !== undefined);
        const known = new Set((STEP_PARAMS[operation.id] ?? []).filter(param => param.kind === 'enum' || initialOf(param) !== undefined || param.default !== undefined).map(param => param.name));
        const needs = operation.params.filter(param => param.required && !known.has(param.name));
        // After a metric, what fails on its series (a filter's cutoff above its rate, a Welch longer than it).
        const refused = (series !== undefined ? operation.refuses?.[series] : undefined) ?? operation.refuses?.[frame];
        // A package the operation needs that the runtime reports it cannot import (the Web version's).
        const lacking = (operation.needs ?? []).filter(name => lacks?.has(name));
        const required = wrongRate(operation.id, sampleRate);
        const off: AddableOperation['off'] = outputOf(operation, frame) === undefined ? 'frame' : refused !== undefined ? 'refuses'
            // One channel: a step that needs two is greyed, except a cross-channel one that can go against the base slot's recording.
            : lacking.length ? 'unavailable' : required !== undefined ? 'rate' : NEEDS_TWO_CHANNELS.has(operation.id) && !SLOT_REFERABLE.has(operation.id) && channels !== undefined && channels < 2 ? 'channels' : needs.length ? 'required' : undefined;
        const why = refused ?? (lacking.length ? lacking.join(', ') : required !== undefined ? String(required) : undefined);
        return { operation, name: lastSegment(operation.id), settable, ...(off ? { off } : {}), ...(why !== undefined ? { why } : {}) };
    }).sort((a, b) => Number(!!a.off) - Number(!!b.off));
}

function freshId(recipe: RecipeDocument): string {
    const used = new Set(recipeNodes(recipe).map(node => node.id));
    let index = used.size;
    while (used.has(`node-${index}`)) index++;
    return `node-${index}`;
}

/**
 * The Recipe with `operation` added after the step `after` (null: first, after the input). The steps that
 * read `after` read the new step instead; parameters wandas has no default for start at their `initial`.
 */
export function withStep(recipe: RecipeDocument, after: string | null, operation: CatalogOperation, start: Readonly<Record<string, number>> = {}): { recipe: RecipeDocument; id: string } {
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument & { nodes: RecipeNode[]; output: string; inputs: Array<{ id: string }> };
    const source = after ?? recipeChain(copy)[0]?.inputs[0] ?? copy.inputs[0]?.id;
    const id = freshId(copy);
    // `start` overrides an initial value with one from the folder (fix_length's duration: the region's length).
    const entries = (STEP_PARAMS[operation.id] ?? []).flatMap(param => ((param.kind === 'int' || param.kind === 'float') && param.initial !== undefined ? [[param.name, encodeNumber(start[param.name] ?? param.initial, param.kind, plainFloats(recipe))] as [string, unknown]] : []))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    copy.nodes.forEach(node => { node.inputs = node.inputs.map(input => (input === source ? id : input)); });
    // A Recipe lists a node after the node it reads.
    const at = copy.nodes.findIndex(node => node.id === source) + 1;
    copy.nodes.splice(at, 0, { id, operation: operation.id, version: operation.version, inputs: [source], params: { $type: 'map', entries } });
    if (copy.output === source) copy.output = id;
    return { recipe: copy, id };
}

/**
 * The Recipe with the step `stepId` moved to after the step `after` (null: first, after the input), its
 * parameters kept. The steps that read it read its input instead, and the steps that read `after` read it.
 */
export function movedStep(recipe: RecipeDocument, stepId: string, after: string | null): RecipeDocument {
    const node = recipeNodes(recipe).find(item => item.id === stepId);
    if (!node || after === stepId) return recipe;
    const copy = JSON.parse(JSON.stringify(withoutSteps(recipe, [stepId]))) as RecipeDocument & { nodes: RecipeNode[]; output: string; inputs: Array<{ id: string }> };
    const source = after ?? recipeChain(copy)[0]?.inputs[0] ?? copy.inputs[0]?.id;
    copy.nodes.forEach(item => { item.inputs = item.inputs.map(input => (input === source ? stepId : input)); });
    // A Recipe lists a node after the node it reads.
    const at = copy.nodes.findIndex(item => item.id === source) + 1;
    copy.nodes.splice(at, 0, { ...(JSON.parse(JSON.stringify(node)) as RecipeNode), inputs: [source] });
    if (copy.output === source) copy.output = stepId;
    return copy;
}

/**
 * A copy of the Recipe with one parameter of one node set, in wandas' encoding: a choice or text as it is, on/off as
 * true/false, None (wandas picks the value) as null, a number as encodeNumber writes it.
 */
export function withParam(recipe: RecipeDocument, nodeId: string, param: StepParam, value: number | string | boolean | null): RecipeDocument {
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument;
    const node = recipeNodes(copy).find(item => item.id === nodeId);
    if (!node) return copy;
    const encoded = value === null ? null : param.kind === 'bool' ? value === true : param.kind === 'enum' || param.kind === 'str' ? String(value) : encodeNumber(Number(value), param.kind, plainFloats(recipe));
    const entries = node.params.entries.filter(([name]) => name !== param.name);
    entries.push([param.name, encoded]);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    node.params.entries = entries;
    return copy;
}

/** The Recipe with every left-out parameter written as the default wandas uses, so it reads as it runs. */
export function withDefaults(recipe: RecipeDocument): RecipeDocument {
    let next = recipe;
    for (const step of recipeSteps(recipe)) {
        const node = recipeNodes(recipe).find(item => item.id === step.id);
        if (!node) continue;
        for (const param of step.editable) {
            if (param.default === undefined || node.params.entries.some(([name]) => name === param.name)) continue;
            next = withParam(next, step.id, param, param.default);
        }
    }
    return next;
}

/** The Recipe without the given steps; the steps after one take its input instead. */
export function withoutSteps(recipe: RecipeDocument, stepIds: readonly string[]): RecipeDocument {
    if (!stepIds.length) return recipe;
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument & { nodes: RecipeNode[]; output: string };
    for (const id of stepIds) {
        const node = copy.nodes.find(item => item.id === id);
        if (!node) continue;
        const replacement = node.inputs[0];
        copy.nodes = copy.nodes.filter(item => item.id !== id);
        copy.nodes.forEach(item => { item.inputs = item.inputs.map(input => (input === id ? replacement : input)); });
        if (copy.output === id) copy.output = replacement;
    }
    return copy;
}

/**
 * Bypassed steps: the step bar's, kept beside the Recipe's nodes (not in them) so the chain keeps them in place.
 * wandas does not know the key: the Recipe run and exported is `runnableRecipe`'s, without these steps or the key.
 */
export const BYPASS_KEY = 'awaBypassed';

export function bypassedSteps(recipe: RecipeDocument): string[] {
    const list = recipe[BYPASS_KEY];
    const ids = new Set(recipeNodes(recipe).map(node => node.id));
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [];
}

/** The Recipe with `stepId` bypassed (or no longer). */
export function withBypass(recipe: RecipeDocument, stepId: string, on: boolean): RecipeDocument {
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument;
    const next = bypassedSteps(recipe).filter(id => id !== stepId).concat(on ? [stepId] : []);
    if (next.length) copy[BYPASS_KEY] = next; else delete copy[BYPASS_KEY];
    return copy;
}

/**
 * The Recipe as wandas runs it: without the bypassed steps and without the step bar's key. The time slice
 * stays: it is where the region goes, and a bypassed region is the whole file (the screen sends no region).
 */
export function withoutBypassed(recipe: RecipeDocument): RecipeDocument {
    if (!(BYPASS_KEY in recipe) && !(REFERENCE_KEY in recipe) && !(EXCLUDED_KEY in recipe)) return recipe;
    const skipped = bypassedSteps(recipe).filter(id => recipeNodes(recipe).find(node => node.id === id)?.operation !== TIME_SLICE);
    const copy = JSON.parse(JSON.stringify(withoutSteps(recipe, skipped))) as RecipeDocument;
    delete copy[BYPASS_KEY];
    delete copy[REFERENCE_KEY];
    delete copy[EXCLUDED_KEY];
    return copy;
}

/** Events left out of a trigger's, per recording (eventExclusion.ts): the comparison's, beside the nodes like the bypass. */
export const EXCLUDED_KEY = 'awaExcludedEvents';

/**
 * Cross-channel steps whose reference is the comparison's base slot (another recording), not a channel of the
 * same one: the step bar's, kept beside the Recipe's nodes like the bypass. The scans pair each compared
 * recording with the base slot's at that step (scan_service.py's `reference`).
 */
export const REFERENCE_KEY = 'awaSlotReference';

export function slotReferenced(recipe: RecipeDocument | null | undefined): string[] {
    if (!recipe) return [];
    const list = recipe[REFERENCE_KEY];
    const ids = new Set(recipeNodes(recipe).filter(node => SLOT_REFERABLE.has(node.operation)).map(node => node.id));
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [];
}

/** The steps measured against the base slot that run: a bypassed one pairs nothing. */
export function activeSlotReferenced(recipe: RecipeDocument | null | undefined): string[] {
    const skipped = recipe ? bypassedSteps(recipe) : [];
    return slotReferenced(recipe).filter(id => !skipped.includes(id));
}

/**
 * The Recipe with the cross-channel step `stepId` referenced to the base slot (or to a channel again). The pair of
 * channels after it goes with the base slot (each recording gives its channel) and comes back with a channel.
 */
export function withSlotReference(recipe: RecipeDocument, stepId: string, on: boolean): RecipeDocument {
    const pair = recipeNodes(recipe).find(node => node.operation === SELECT_PAIR && node.inputs[0] === stepId)?.id;
    let next = on && pair ? withoutSteps(recipe, [pair]) : recipe;
    const select = catalogOperation(SELECT_PAIR);
    // Back to a channel: the pair chip again, where adding the step gives one (a CSD keeps its auto-spectra).
    const operation = recipeNodes(recipe).find(node => node.id === stepId)?.operation ?? '';
    if (!on && !pair && select && PAIRED_ON_ADD.has(operation)) next = withStep(next, stepId, select).recipe;
    const copy = JSON.parse(JSON.stringify(next)) as RecipeDocument;
    const list = slotReferenced(recipe).filter(id => id !== stepId).concat(on ? [stepId] : []);
    if (list.length) copy[REFERENCE_KEY] = list; else delete copy[REFERENCE_KEY];
    return copy;
}

/** A short stable key for a Recipe, so stored scan results are reused only for the same Recipe. */
export function recipeKey(recipe: RecipeDocument | undefined): string {
    if (!recipe) return '';
    const text = JSON.stringify(recipe);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
    return `${text.length}:${hash.toString(16)}`;
}

export function isRecipeChain(value: unknown): value is RecipeDocument {
    if (!value || typeof value !== 'object') return false;
    const recipe = value as { schema?: unknown; nodes?: unknown; output?: unknown };
    return recipe.schema === 'wandas.recipe' && Array.isArray(recipe.nodes) && typeof recipe.output === 'string'
        && recipe.nodes.every(node => !!node && typeof node === 'object'
            && typeof (node as RecipeNode).id === 'string' && typeof (node as RecipeNode).operation === 'string'
            && Array.isArray((node as RecipeNode).inputs) && Array.isArray((node as RecipeNode).params?.entries));
}
