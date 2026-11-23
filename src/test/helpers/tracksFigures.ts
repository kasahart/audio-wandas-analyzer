/**
 * A stand-in host for the Tracks screen's two bottom figures (the cursor spectrum, the pair figure) in the tests that
 * run the whole page: the answers kept by key as the host tells them (keys, no value of a line), and the figure
 * service's replies to the Figure's own requests (python-backend/figures/ has its own tests; here it answers a fixed
 * line for every line the spec declares).
 */
import type { FigureRequestMessage } from '../../shared/protocol/figureMessages';
import type { FigureDrawPayload, FigureDrawResult, FigureExportPayload, FigureExportResult, FigureSpec } from '../../shared/protocol/generated/backendProtocolSchema';

/** A `request-spectrum-slice` as the page posts it. */
export interface CursorRequest {
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    trackIndex: number;
    filePath: string;
    cursorNorm: number;
}

/** The key a channel's kept line has in these tests: its file, channel and cursor. */
export const cursorKey = (request: Pick<CursorRequest, 'filePath' | 'cursorNorm'>, channel: number): string => `cursor|${request.filePath}|${channel}|${request.cursorNorm}`;

/** What a channel's levels are in. */
export interface TestLevel { unit: string; ref: number; label: string }
export const FULL_SCALE: TestLevel = { unit: 'FS', ref: 1, label: 'dBFS' };

/** The host's answer to a cursor spectrum request: each channel's kept line's key and what its levels are in. */
export function cursorAnswers(request: CursorRequest, channels: readonly number[] = [0], level: (channel: number) => TestLevel = () => FULL_SCALE): Record<string, unknown> {
    return {
        type: 'cursor-answers-result', requestId: request.requestId, analysisId: request.analysisId, settingsSignature: request.settingsSignature,
        trackIndex: request.trackIndex, filePath: request.filePath, cursorNorm: request.cursorNorm, scale: 'linear',
        channels: channels.map(channelIndex => ({ channelIndex, level: level(channelIndex), key: cursorKey(request, channelIndex) })),
        windowStartNorm: Math.max(0, request.cursorNorm - 0.01), windowEndNorm: Math.min(1, request.cursorNorm + 0.01), window: 'hann',
    };
}

interface Env {
    postedMessages: unknown[];
    dom: { window: { dispatchEvent(event: unknown): unknown; MessageEvent: new (type: string, init: { data: unknown }) => unknown } };
}

const send = (env: Env, data: unknown): void => { env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data })); };

/** The page's requests of the figure service so far, by command. */
export function figureRequests<K extends FigureRequestMessage['command']>(env: Env, command: K): Array<FigureRequestMessage<K>> {
    const asked = env.postedMessages.filter((message): message is FigureRequestMessage<K> => (message as FigureRequestMessage).type === 'figure-request' && (message as FigureRequestMessage).command === command);
    // Copies in the test's own realm: the page's arrays are the window's, and deepStrictEqual tells the two apart.
    return JSON.parse(JSON.stringify(asked)) as Array<FigureRequestMessage<K>>;
}

/** The specs the page asked the figure service to draw, oldest first. */
export const drawnSpecs = (env: Env): FigureSpec[] => figureRequests(env, 'figure-draw').map(message => (message.payload).spec);
/** The keys of the lines of the spec asked for last whose first lane is `lane` (''. none asked). */
export function lastDrawnKeys(env: Env, lane: string): string[] {
    const spec = drawnSpecs(env).filter(item => item.lanes[0]?.id === lane).at(-1);
    return spec ? spec.keys.map(key => key.key) : [];
}

/** The line every declared line is answered with: three points over 0 to 20 kHz. */
export const TEST_LINE = { xs: [0, 10000, 20000], values: [-60, -20, -40] } as const;

function picture(draw: FigureDrawPayload, id: string): FigureDrawResult {
    const x = draw.view?.x ?? [null, null];
    return {
        status: 'picture', figureId: draw.figureId, generation: draw.generation, requestNumber: draw.requestNumber, pictureId: id, dataId: `data-${id}`,
        lanes: draw.spec.lanes.map(lane => {
            const y = draw.view?.lanes?.find(item => item.lane === lane.id)?.y ?? [null, null];
            const whole = { x: [0, 20000], y: [-80, 0] };
            return {
                id: lane.id,
                axis: { quantity: 'level', unit: 'FS', reference: 1, referenceLabel: 'dBFS', calibration: 'uncalibrated', xScale: 'linear', yScale: 'linear' },
                range: { x: [x[0] ?? whole.x[0], x[1] ?? whole.x[1]], y: [y[0] ?? whole.y[0], y[1] ?? whole.y[1]] },
                whole,
                lines: lane.lines.map(line => ({ id: line.id, ...('key' in line.of ? { key: line.of.key } : {}), xs: [...TEST_LINE.xs], values: [...TEST_LINE.values] })),
            };
        }),
        headlines: [],
    } as unknown as FigureDrawResult;
}

function table(asked: FigureExportPayload): FigureExportResult {
    return {
        status: 'rows', ...(asked.dataId !== undefined ? { dataId: asked.dataId } : {}),
        columns: asked.spec.lanes.flatMap(lane => lane.lines.map(line => ({
            lane: lane.id, line: line.id, ...('key' in line.of ? { key: line.of.key } : {}), quantity: 'level' as const, xs: [...TEST_LINE.xs], values: [...TEST_LINE.values],
        }))),
    };
}

/**
 * Answers the figure requests posted and not answered yet: a draw with the fixed picture of its spec, an export
 * with the same lines' table, anything else with an empty result. Returns how many it answered.
 */
export function answerFigures(env: Env, answered: Set<string>): number {
    let count = 0;
    for (const message of env.postedMessages as FigureRequestMessage[]) {
        if (message?.type !== 'figure-request' || answered.has(message.requestId)) continue;
        answered.add(message.requestId);
        count += 1;
        const result = message.command === 'figure-draw' ? picture(message.payload as FigureDrawPayload, `p${answered.size}`)
            : message.command === 'figure-export' ? table(message.payload as FigureExportPayload)
                : message.command === 'figure-read' ? { status: 'no-point', figureId: (message.payload as { figureId: string }).figureId, pictureId: (message.payload as { pictureId: string }).pictureId, requestNumber: (message.payload as { requestNumber: number }).requestNumber }
                    : {};
        send(env, { type: 'figure-result', requestId: message.requestId, command: message.command, result });
    }
    return count;
}

/** Answers every cursor spectrum request posted and not answered yet, a line a channel of `channels(request)`. */
export function answerCursorRequests(env: Env, answered: Set<string>, channels: (request: CursorRequest) => readonly number[] = () => [0], level?: (request: CursorRequest, channel: number) => TestLevel): number {
    let count = 0;
    for (const message of env.postedMessages as Array<CursorRequest & { type: string }>) {
        if (message?.type !== 'request-spectrum-slice' || answered.has(message.requestId)) continue;
        answered.add(message.requestId);
        count += 1;
        send(env, cursorAnswers(message, channels(message), level ? channel => level(message, channel) : undefined));
    }
    return count;
}
