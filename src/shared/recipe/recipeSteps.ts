/**
 * The step bar's view of a wandas Recipe: one chip per node, the parameters each one takes, the Frame
 * each gives, and edits written back in the Recipe's own encoding: a parameter set, a step added after
 * another or taken out. Which operations exist and which Frame each takes and gives is wandas' registry
 * (recipeCatalog.ts), with each parameter's default and choices from wandas' own description; how the
 * analyzer lets one be set (kind, unit, bounds, what a new step starts with) is listed here.
 */
import type { RecipeDocument } from './recipeSelection';
import { catalogOperation, INPUT_FRAME, outputOf, WANDAS_OPERATIONS, type CatalogOperation } from './recipeCatalog';

/**
 * `default`: what wandas uses when the Recipe leaves the parameter out (from its description), shown and
 * written as the actual value. `initial`: what a new step starts with for a parameter wandas has no default for.
 */
export type StepParam =
    | { name: string; kind: 'float'; unit?: string; min?: number; max?: 'nyquist' | number; optional?: boolean; default?: number; initial?: number }
    | { name: string; kind: 'int'; min: number; max: number; powerOfTwo?: boolean; optional?: boolean; default?: number; initial?: number; belowChannels?: boolean }
    | { name: string; kind: 'enum'; options: readonly string[]; default?: string };

const WINDOWS = ['hann', 'hamming', 'blackman', 'boxcar'] as const;

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
    'wandas.audio.resampling': [{ name: 'target_sr', kind: 'float', unit: 'Hz', min: 0, max: 384000, initial: 16000 }],
    'wandas.audio.rms_trend': [
        { name: 'frame_length', kind: 'int', min: 16, max: 65536 },
        { name: 'hop_length', kind: 'int', min: 1, max: 65536 },
    ],
    'wandas.audio.fade': [{ name: 'fade_ms', kind: 'float', unit: 'ms', min: 0, max: 10000 }],
};

/** The settable parameters, each with the default wandas describes for it. */
export const STEP_PARAMS: Record<string, readonly StepParam[]> = Object.fromEntries(Object.entries(SETTABLE).map(([id, params]) => [id, params.map(param => {
    const described = catalogOperation(id)?.params.find(item => item.name === param.name)?.default;
    return described === undefined || typeof described === 'boolean' || (param.kind === 'enum') !== (typeof described === 'string') ? param : { ...param, default: described } as StepParam;
})]));

export const TIME_SLICE = 'wandas.frame.time_slice';

interface RecipeNode {
    id: string;
    operation: string;
    version: number;
    inputs: string[];
    params: { $type: 'map'; entries: Array<[string, unknown]> };
}

type ParamValue = number | string | null;

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
    return ((recipe as unknown as { version?: number }).version ?? 0) >= 3;
}

export function decodeParam(value: unknown): ParamValue {
    if (value === null || typeof value === 'number' || typeof value === 'string') return value;
    const encoded = value as { $type?: string; kind?: string; data?: string };
    if (encoded?.$type === 'number' && encoded.kind === 'python-float' && typeof encoded.data === 'string' && /^[0-9a-f]{16}$/.test(encoded.data)) {
        const view = new DataView(new ArrayBuffer(8));
        encoded.data.match(/../g)!.forEach((pair, index) => view.setUint8(index, parseInt(pair, 16)));
        return view.getFloat64(0);
    }
    return null;
}

function nodes(recipe: RecipeDocument): RecipeNode[] {
    const list = (recipe as unknown as { nodes?: unknown }).nodes;
    return Array.isArray(list) ? list as RecipeNode[] : [];
}

/** The nodes from the input to the output, in order: the entry Recipe is one chain. */
export function recipeChain(recipe: RecipeDocument): RecipeNode[] {
    const byId = new Map(nodes(recipe).map(node => [node.id, node]));
    const chain: RecipeNode[] = [];
    let id = (recipe as unknown as { output?: string }).output;
    while (id && byId.has(id)) {
        const node = byId.get(id)!;
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
    /**
     * Why: the value must stay below `limit`, or be a power of two from 64 up to `limit`; the step cannot
     * take the Frame before it (`frame`); it failed on a file (`failed`, wandas' own words in `text`); or a
     * step before it cannot run (`after`, that step's id in `text`), so nothing after it can either.
     */
    reason?: { kind: 'below' | 'above' | 'pow2' | 'integer' | 'frame' | 'failed' | 'after'; limit: number; text?: string };
}

export interface StepLimits {
    sampleRate?: number;
    /** Samples in the shortest file: an FFT longer than that has nothing to average. */
    shortestSamples?: number;
    /** Channels of the folder's files: a channel index must stay below it. */
    channels?: number;
    /** Steps that failed on a file, with wandas' reason: left out until the Recipe changes. */
    failed?: Readonly<Record<string, string>>;
}

type Invalid = { param: string; reason: NonNullable<RecipeStep['reason']> } | undefined;

function invalidParam(params: Record<string, ParamValue>, editable: readonly StepParam[], limits: StepLimits): Invalid {
    const nyquist = limits.sampleRate ? limits.sampleRate / 2 : Infinity;
    for (const param of editable) {
        const value = params[param.name];
        if (value === null || value === undefined) continue;
        if (param.kind === 'enum') { if (!param.options.includes(String(value))) return { param: param.name, reason: { kind: 'below', limit: 0 } }; continue; }
        if (param.kind === 'int') {
            // 2.5 is not an order: refused, not rounded.
            if (typeof value === 'number' && !Number.isInteger(value)) return { param: param.name, reason: { kind: 'integer', limit: 0 } };
            // The largest power of two that fits the shortest file, so the limit itself is a value one can type.
            const limit = param.powerOfTwo && limits.shortestSamples ? Math.min(param.max, 2 ** Math.floor(Math.log2(limits.shortestSamples)))
                : param.belowChannels && limits.channels ? Math.min(param.max, limits.channels - 1) : param.max;
            const ok = typeof value === 'number' && Number.isInteger(value) && value >= param.min && value <= limit && (!param.powerOfTwo || (value & (value - 1)) === 0);
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
    const skipped = new Set(bypassedSteps(recipe));
    return recipeChain(recipe).map(node => {
        const editable = STEP_PARAMS[node.operation] ?? [];
        // A parameter the Recipe leaves out has wandas' default: shown as that value, not as an empty field.
        const params: Record<string, ParamValue> = Object.fromEntries(editable.flatMap(param => (param.default === undefined ? [] : [[param.name, param.default]])));
        for (const [name, value] of node.params.entries) params[name] = decodeParam(value);
        const output = stepOutput(node.operation, frame);
        const failed = bounds.failed?.[node.id];
        const invalid: Invalid = broken !== undefined ? { param: '', reason: { kind: 'after', limit: 0, text: broken } }
            : output === undefined ? { param: '', reason: { kind: 'frame', limit: 0, text: frame } }
            : failed !== undefined ? { param: '', reason: { kind: 'failed', limit: 0, text: failed } }
                : invalidParam(params, editable, bounds);
        const step: RecipeStep = {
            id: node.id, operation: node.operation, name: node.operation.split('.').pop()!, params, editable,
            input: frame, output: output ?? declaredOutput(node.operation, frame), ...(invalid ? { invalid: invalid.param, reason: invalid.reason } : {}),
            ...(skipped.has(node.id) ? { bypassed: true } : {}),
        };
        if (invalid && broken === undefined) broken = step.id;
        // Past a break the Frames are the ones the steps would take and give, to name and place them.
        if ((!invalid || invalid.reason.kind === 'after') && !step.bypassed) frame = step.output;
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
    while (pending.length) {
        const id = pending.pop()!;
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
     * (`refuses`, with wandas' reason in `why`), or it needs a value the app cannot set.
     */
    off?: 'frame' | 'refuses' | 'unavailable' | 'required';
    why?: string;
    /** Parameters the step bar can set (STEP_PARAMS); without, it runs with wandas' defaults. */
    settable: boolean;
}

/**
 * What ＋ offers after a step that gives `frame`: every operation of wandas' registry a chain can hold,
 * those that take this Frame first. The time slice is the region's and is not added twice.
 */
/**
 * Operations the ＋ menu leaves out: the region is the step bar's own, and wandas.numpy.ufunc (wandas 0.10)
 * needs a NumPy function name the app has no way to set, so it would only be a greyed entry.
 */
const MENU_HIDDEN: ReadonlySet<string> = new Set([TIME_SLICE, 'wandas.numpy.ufunc']);

export function addableOperations(frame: string, lacks?: ReadonlySet<string>): AddableOperation[] {
    return WANDAS_OPERATIONS.filter(operation => !MENU_HIDDEN.has(operation.id)).map(operation => {
        const settable = operation.id in STEP_PARAMS;
        const known = new Set((STEP_PARAMS[operation.id] ?? []).filter(param => param.kind === 'enum' || param.initial !== undefined || param.default !== undefined).map(param => param.name));
        const needs = operation.params.filter(param => param.required && !known.has(param.name));
        const refused = operation.refuses?.[frame];
        // A package the operation needs that the runtime reports it cannot import (the Web version's).
        const lacking = (operation.needs ?? []).filter(name => lacks?.has(name));
        const off: AddableOperation['off'] = outputOf(operation, frame) === undefined ? 'frame' : refused !== undefined ? 'refuses'
            : lacking.length ? 'unavailable' : needs.length ? 'required' : undefined;
        const why = refused ?? (lacking.length ? lacking.join(', ') : undefined);
        return { operation, name: operation.id.split('.').pop()!, settable, ...(off ? { off } : {}), ...(why !== undefined ? { why } : {}) };
    }).sort((a, b) => Number(!!a.off) - Number(!!b.off));
}

function freshId(recipe: RecipeDocument): string {
    const used = new Set(nodes(recipe).map(node => node.id));
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
    const entries = (STEP_PARAMS[operation.id] ?? []).flatMap(param => (param.kind !== 'enum' && param.initial !== undefined ? [[param.name, encodeNumber(start[param.name] ?? param.initial, param.kind, plainFloats(recipe))] as [string, unknown]] : []))
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
    const node = nodes(recipe).find(item => item.id === stepId);
    if (!node || after === stepId) return recipe;
    const copy = JSON.parse(JSON.stringify(withoutSteps(recipe, [stepId]))) as RecipeDocument & { nodes: RecipeNode[]; output: string; inputs: Array<{ id: string }> };
    const source = after ?? recipeChain(copy)[0]?.inputs[0] ?? copy.inputs[0]?.id;
    copy.nodes.forEach(item => { item.inputs = item.inputs.map(input => (input === source ? stepId : input)); });
    // A Recipe lists a node after the node it reads.
    const at = copy.nodes.findIndex(item => item.id === source) + 1;
    copy.nodes.splice(at, 0, { ...JSON.parse(JSON.stringify(node)), inputs: [source] });
    if (copy.output === source) copy.output = stepId;
    return copy;
}

/** A copy of the Recipe with one parameter of one node set. */
export function withParam(recipe: RecipeDocument, nodeId: string, param: StepParam, value: number | string): RecipeDocument {
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument;
    const node = nodes(copy).find(item => item.id === nodeId);
    if (!node) return copy;
    const encoded = param.kind === 'enum' ? String(value) : encodeNumber(Number(value), param.kind, plainFloats(recipe));
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
        const node = nodes(recipe).find(item => item.id === step.id)!;
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
    const list = (recipe as unknown as Record<string, unknown>)[BYPASS_KEY];
    const ids = new Set(nodes(recipe).map(node => node.id));
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [];
}

/** The Recipe with `stepId` bypassed (or no longer). */
export function withBypass(recipe: RecipeDocument, stepId: string, on: boolean): RecipeDocument {
    const copy = JSON.parse(JSON.stringify(recipe)) as Record<string, unknown>;
    const next = bypassedSteps(recipe).filter(id => id !== stepId).concat(on ? [stepId] : []);
    if (next.length) copy[BYPASS_KEY] = next; else delete copy[BYPASS_KEY];
    return copy as unknown as RecipeDocument;
}

/**
 * The Recipe as wandas runs it: without the bypassed steps and without the step bar's key. The time slice
 * stays: it is where the region goes, and a bypassed region is the whole file (the screen sends no region).
 */
export function withoutBypassed(recipe: RecipeDocument): RecipeDocument {
    if (!(BYPASS_KEY in (recipe as unknown as Record<string, unknown>))) return recipe;
    const skipped = bypassedSteps(recipe).filter(id => nodes(recipe).find(node => node.id === id)?.operation !== TIME_SLICE);
    const copy = JSON.parse(JSON.stringify(withoutSteps(recipe, skipped))) as Record<string, unknown>;
    delete copy[BYPASS_KEY];
    return copy as unknown as RecipeDocument;
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
