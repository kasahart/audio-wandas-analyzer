/**
 * The wandas operations a chain can hold, from wandas' own Recipe registry (generated/wandasOperations.ts,
 * written by python-backend/operation_catalog.py): which Frame each takes and gives, and which of its
 * parameters it cannot do without. The step bar's ＋ lists these.
 */
import { WANDAS_FRAMES, WANDAS_OPERATIONS } from './generated/wandasOperations';

export interface CatalogParam {
    name: string;
    /** No default in wandas: the operation cannot be added unless the app knows how to set it. */
    required: boolean;
    /** What wandas uses when a Recipe leaves it out. */
    default?: number | string | boolean;
    /** The values wandas accepts, when it lists them. */
    choices?: readonly string[];
}

export interface CatalogOperation {
    id: string;
    version: number;
    /** The Frame it takes; "*" for every Frame. */
    input: string;
    /** The Frame it gives; "*" for the Frame it took. */
    output: string;
    params: readonly CatalogParam[];
    /** Frames it is declared to take but fails on in every probe run (operation_probe.py), with wandas' reason. */
    refuses?: Readonly<Record<string, string>>;
    /** Optional packages it needs that the Web version's runtime does not carry (operation_probe.needs). */
    needs?: readonly string[];
}

export interface CatalogFrame {
    name: string;
    /** The Frames it also is: an operation on one of them takes it too. */
    bases: readonly string[];
    /** Whether the app draws it (wandas_to_chart.CHART_FRAME_TYPES). */
    charted: boolean;
}

/** What a Recipe's input is: the recording, a time signal. */
export const INPUT_FRAME = 'ChannelFrame';

export function catalogOperation(id: string): CatalogOperation | undefined {
    return WANDAS_OPERATIONS.find(operation => operation.id === id);
}

/** Whether an operation that takes `wanted` can take a `frame`. */
export function takes(wanted: string, frame: string): boolean {
    return wanted === '*' || wanted === frame || !!WANDAS_FRAMES.find(item => item.name === frame)?.bases.includes(wanted);
}

/** The Frame an operation gives for this input; undefined when it cannot take it. */
export function outputOf(operation: CatalogOperation, input: string): string | undefined {
    if (!takes(operation.input, input)) return undefined;
    return operation.output === '*' ? input : operation.output;
}

/** Whether the app can draw a Frame of this type. */
export function isCharted(frame: string): boolean {
    return !!WANDAS_FRAMES.find(item => item.name === frame)?.charted;
}

/** "highpass_filter" for "wandas.audio.highpass_filter". */
export function operationName(id: string): string {
    return id.split('.').pop() ?? id;
}

export { WANDAS_OPERATIONS };
