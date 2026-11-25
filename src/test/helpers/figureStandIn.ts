/**
 * A page with Figures (src/webview/figure/) and a stand-in for the figure service (python-backend/figures/), for the
 * Figure's node:test tests (figure-design.md 第 9 節: サービスはテスト用の代役). The stand-in answers with what
 * the case says: the picture of the shared test data's spectrum scene (figure_overlay_cases.json) and the point each
 * read is given. It never picks a point itself: which point a read reads is layer 2's and is the case's input here.
 */
import { JSDOM } from 'jsdom';
import { createFigureAnswers, type FigureAnswers, type FigureRequests } from '../../webview/answers/figureRequests';
import { createFigure, type Figure, type FigureOptions, type FigureWords } from '../../webview/figure/figure';
import type { FigureRequestMessage, FigureCancelMessage } from '../../shared/protocol/figureMessages';
import type { FigureDrawn, FigureDrawPayload, FigureDrawResult, FigureKey, FigurePoint, FigureReadPayload, FigureReadResult, FigureSpec } from '../../shared/protocol/generated/backendProtocolSchema';
import type { Scene } from './figureOverlayRun';

export const WORDS: FigureWords = {
    axisFrequency: 'Frequency [Hz]', axisTime: 'Time [s]', axisDelta: 'Difference Δ [dB]', deltaPair: 'Compare {n} − Base', axisLevelCal: 'Level [{label}]', axisLevelUncal: 'Level (uncalibrated) [{label}]', axisUnitUnknown: 'unit unknown',
    pairWaiting: 'computing…', stageCombineFailed: 'failed', stageTooLarge: 'too large', stageBusy: 'busy', waveRangeAxisAmplitude: 'Amplitude', dsDistCountAxis: 'Count per group [{unit}]', dsUnitRecording: 'recordings', plotNoValue: '— (no value here)', axisUncalibrated: ', uncalibrated',
    stageMaxDelta: 'Largest Δ {delta} at {at}', stageNoDelta: '— (no Δ)', stageNoDeltaRate: '— (no Δ: other rates)', stageNoDeltaUnit: '— (no Δ: other units)',
    axisQuefrency: 'Quefrency [s]', axisBand: 'Band centre [Hz]', axisTriggerTime: 'Time from trigger [s]', axisBark: 'Critical band [Bark]', axisLag: 'Lag [s]', axisGain: 'Gain [dB]', axisTransferLevel: 'Transfer level [{unit}]', axisCoherence: 'Coherence γ² [–]', pairPhaseLabel: 'Phase [°]', axisCepstrum: 'Real cepstrum [–]', axisCorrelation: 'Correlation coefficient [–]',
    axisLevelOf: 'Level', axisRms: 'RMS', axisRmsTimeWeighted: 'Time-weighted RMS', axisPower: 'Power', axisRaised: '{quantity}^{p}', axisQuantityUnknown: 'Value',
    axisLoudness: 'Loudness', axisSharpness: 'Sharpness', axisRoughness: 'Roughness', axisSpecificRoughness: 'Specific roughness', stagePairBase: 'vs base',
    range: { title: 'Range', min: 'Min', max: 'Max', apply: 'Apply', auto: 'Auto', close: '×', invalid: 'Min must be smaller than Max' },
};
export const LABELS: Record<string, string> = { median: 'median', compare: 'compare', other: 'other', delta: 'Δ' };

/** The spectrum scene's spec: the overlay lane (median, compare, other) and the Δ lane, each key with its state and version. */
export function sceneSpec(states: Partial<Record<string, FigureKey['state']>> = {}, versions: Partial<Record<string, string>> = {}): FigureSpec {
    const keys = ['b1', 'b2', 'b3', 'cmp', 'oth'];
    return {
        lanes: [
            { id: 'overlay', kind: 'lines', lines: [{ id: 'median', of: { median: ['b1', 'b2', 'b3'] }, role: 'base' }, { id: 'compare', of: { key: 'cmp' }, role: 'compare1' }, { id: 'other', of: { key: 'oth' } }] },
            { id: 'delta', kind: 'lines', lines: [{ id: 'delta', of: { delta: { compare: 'cmp', base: ['b1', 'b2', 'b3'] } }, role: 'compare1' }] },
        ],
        keys: keys.map(key => ({ key, state: states[key] ?? 'usable', version: versions[key] ?? 'v1' })),
    };
}

const USED: Record<string, string[]> = { median: ['b1', 'b2', 'b3'], compare: ['cmp'], other: ['oth'], delta: ['cmp', 'b1', 'b2', 'b3'] };
const numberOf = (value: number | string): number => (typeof value === 'number' ? value : value === 'nan' ? NaN : value === 'inf' ? Infinity : -Infinity);
const asDrawn = (values: ReadonlyArray<number | null>): Array<FigureDrawn | null> => values as unknown as Array<FigureDrawn | null>;

/** The stand-in's picture of the scene for a draw: confirmed range = the specified ends, else the scene's whole axes. */
export function scenePicture(scene: Scene, draw: FigureDrawPayload, picture: string, whole = { x: [20, 20000], overlay: [-60, -10], delta: [-32, 32] }, keys: Record<string, string> = SCENE_KEYS): FigureDrawResult {
    const x = draw.view?.x ?? [null, null];
    const yOf = (lane: 'overlay' | 'delta'): number[] => {
        const y = draw.view?.lanes?.find(item => item.lane === lane)?.y ?? [null, null];
        return [y[0] ?? whole[lane][0], y[1] ?? whole[lane][1]];
    };
    const line = (id: 'median' | 'compare' | 'other' | 'delta', role?: string) => ({
        id, ...(role ? { role } : {}), ...(keys[id] ? { key: keys[id] } : {}), xs: scene.lines[id].xs,
        values: asDrawn(scene.lines[id].values.map(value => { const n = numberOf(value); return Number.isFinite(n) ? n : null; })),
    });
    const axis = (quantity: 'level' | 'delta') => ({ quantity, unit: 'FS', reference: 1, referenceLabel: 'dBFS', calibration: 'uncalibrated' as const, xScale: 'log' as const, yScale: 'linear' as const });
    const range = (lane: 'overlay' | 'delta') => ({ x: [x[0] ?? whole.x[0], x[1] ?? whole.x[1]], y: yOf(lane) });
    return {
        status: 'picture', figureId: draw.figureId, generation: draw.generation, requestNumber: draw.requestNumber, pictureId: picture, dataId: `data-${picture}`,
        lanes: [
            { id: 'overlay', axis: axis('level'), range: range('overlay'), whole: { x: whole.x, y: whole.overlay }, lines: [line('median', 'base'), line('compare', 'compare1'), line('other')] },
            { id: 'delta', axis: axis('delta'), range: range('delta'), whole: { x: whole.x, y: whole.delta }, lines: [line('delta', 'compare1')] },
        ],
        headlines: [],
        members: {
            shown: { used: ['b1', 'b2', 'b3', 'cmp', 'oth'], n: 5, excluded: [] }, combined: { used: ['b1', 'b2', 'b3'], n: 3, excluded: [] }, calibration: 'uncalibrated',
            lines: Object.entries(USED).map(([id, used]) => ({ line: id, drawn: true, used, excluded: [] })),
        },
    };
}

/** A point of a scene line as a read names it (its data step: the nearer neighbour's distance, as pick.py's data_step). */
export function scenePoint(scene: Scene, line: string, index: number): FigurePoint {
    const xs = scene.lines[line as keyof Scene['lines']].xs;
    const gaps = [index - 1, index].filter(at => at >= 0 && at < xs.length - 1).map(at => Math.abs(xs[at + 1] - xs[at])).filter(gap => gap > 0);
    return { index, x: xs[index], value: numberOf(scene.lines[line as keyof Scene['lines']].values[index]), ...(gaps.length ? { xStep: Math.min(...gaps) } : {}) };
}

/** The recording each line of one key is of: the service puts it on the line drawn and on every point read of it. */
export const SCENE_KEYS: Record<string, string> = { compare: 'cmp', other: 'oth' };
/** The version of a line's answer, as the service names it in a read (its recordings' versions). */
export const sceneVersion = (line: string): string => `${line}@v1`;

/** The points of a scene line with a value inside the confirmed range across (pick.py's candidates for a step). */
function readableIndexes(scene: Scene, line: string, xRange: readonly [number, number]): number[] {
    const spec = scene.lines[line as keyof Scene['lines']];
    const floor = line !== 'delta';
    return spec.xs.map((_, at) => at).filter(at => {
        const value = numberOf(spec.values[at]);
        return Number.isFinite(value) && (!floor || value > -250) && spec.xs[at] >= xRange[0] * (1 - 1e-12) && spec.xs[at] <= xRange[1] * (1 + 1e-12);
    });
}

/** A read's reply for the point `index` of `line`: the one point (no neighbours), its key and its line's answer version. */
export function pointReply(scene: Scene, read: FigureReadPayload, lane: string, line: string, index: number): FigureReadResult {
    const key = SCENE_KEYS[line];
    return {
        status: 'point', figureId: read.figureId, pictureId: read.pictureId, requestNumber: read.requestNumber, lane, line, ...(line === 'median' ? { role: 'base' } : line === 'other' ? {} : { role: 'compare1' }),
        version: sceneVersion(line), point: { ...scenePoint(scene, line, index), ...(key ? { key } : {}) },
    };
}

/**
 * A step's (b) or a name's (c) reply as the service makes it (pick.py `_step`, `_named`): `steps` points with a value
 * on inside the confirmed range across, or "outside" past its side; the point at exactly that place, or "no-point".
 * Of another recording key, or (a step) of another answer version, "no-point".
 */
export function keysReply(scene: Scene, read: FigureReadPayload, xRange: readonly [number, number] = [20, 20000], keys: Record<string, string> = SCENE_KEYS): FigureReadResult {
    const echo = { figureId: read.figureId, pictureId: read.pictureId, requestNumber: read.requestNumber };
    const named = read.step ?? read.name;
    if (!named) throw new Error('not a keys read');
    const asked = { ...named, lane: named.lane ?? (named.line === 'delta' ? 'delta' : 'overlay') };
    if (asked.key !== keys[asked.line] || (read.step && read.step.version !== sceneVersion(read.step.line))) return { status: 'no-point', ...echo, lane: asked.lane };
    const candidates = readableIndexes(scene, asked.line, xRange);
    if (read.step) {
        const { index, steps } = read.step;
        const onward = steps > 0 ? candidates.filter(at => at > index) : candidates.filter(at => at < index).reverse();
        const to = onward[Math.abs(steps) - 1];
        return to === undefined ? { status: 'outside', ...echo, lane: asked.lane } : pointReply(scene, read, asked.lane, asked.line, to);
    }
    const x = read.name!.x;
    const found = candidates.find(at => scene.lines[asked.line as keyof Scene['lines']].xs[at] === x);
    return found === undefined ? { status: 'no-point', ...echo, lane: asked.lane } : pointReply(scene, read, asked.lane, asked.line, found);
}

type Asked = { message: FigureRequestMessage; answer(result: unknown): void; fail(): void };

/** A page: a JSDOM window, the page's figure requests, the messages posted, and the requests not answered yet. */
export function figurePage(options: { cancels?: boolean; holds?: boolean } = {}) {
    const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { pretendToBeVisual: true });
    const { window } = dom;
    window.HTMLCanvasElement.prototype.getContext = () => null;
    const posted: Array<FigureRequestMessage | FigureCancelMessage> = [];
    const open: Asked[] = [];
    let answers: FigureAnswers | null = null;
    const reply = (requestId: string, command: FigureRequestMessage['command'], body: { result?: unknown; failed?: string }): void => {
        answers?.handle({ type: 'figure-result', requestId, command, ...body });
    };
    answers = createFigureAnswers({
        cancels: options.cancels ?? true,
        holdsReadsWhileComputing: options.holds ?? false,
        post(message) {
            posted.push(message);
            if (message.type !== 'figure-request' || message.command === 'figure-release') return;
            open.push({ message, answer: result => reply(message.requestId, message.command, { result }), fail: () => reply(message.requestId, message.command, { failed: 'backend failed' }) });
        },
    });
    const take = (match: (message: FigureRequestMessage) => boolean): Asked[] => {
        const found = open.filter(item => match(item.message));
        for (const item of found) open.splice(open.indexOf(item), 1);
        return found;
    };
    return {
        dom, window, document: window.document, answers, posted, open,
        host: window.document.getElementById('host') as HTMLElement,
        /** The requests of `command` not answered yet, taken off the list. */
        take,
        draws: () => take(message => message.command === 'figure-draw'),
        reads: () => take(message => message.command === 'figure-read'),
        figure(requests: FigureRequests = answers.figure(), more: Partial<FigureOptions> = {}): Figure {
            const figure = createFigure({ document: window.document, host: window.document.getElementById('host') as HTMLElement, requests, words: WORDS, lineLabel: line => LABELS[line.id] ?? line.id, ...more });
            figure.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 670, height: 422, right: 670, bottom: 422, x: 0, y: 0, toJSON: () => ({}) });
            return figure;
        },
        mouse(target: EventTarget, type: string, clientX: number, clientY: number, extra: MouseEventInit = {}): void {
            target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, detail: 1, ...extra }));
        },
        key(key: string): void { window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); },
    };
}
export type FigurePage = ReturnType<typeof figurePage>;

/** The scene's figure size: frames of 600 × 200 (overlay) and 600 × 160 (Δ), as the shared test data's boxes. */
export const SCENE_SIZE = { size: { width: 670, height: 422 }, laneHeights: { overlay: 200, delta: 160 } };

/**
 * A picture of a Tracks row's spec (a band lane over an image lane), as the figure service answers a draw of it.
 * `evicted`: kept answers the service's store let go, named as left out for that.
 */
export function rowPicture(draw: FigureDrawPayload, evicted: string[] = []): FigureDrawResult {
    const x = [draw.view?.x?.[0] ?? 0, draw.view?.x?.[1] ?? 10];
    const level = { quantity: 'level' as const, unit: 'Pa', reference: 2e-5, referenceLabel: 'dB SPL', calibration: 'calibrated' as const, xScale: 'linear' as const, yScale: 'linear' as const };
    return {
        status: 'picture', figureId: draw.figureId, generation: draw.generation, requestNumber: draw.requestNumber, pictureId: `p-${draw.generation}`, dataId: `d-${draw.generation}`,
        lanes: draw.spec.lanes.map(lane => lane.kind === 'image'
            ? { id: lane.id, kind: 'image' as const, axis: level, lines: [], guides: [], range: { x, y: [0, 24000], colour: [-110, -10] }, whole: { x: [0, 10], y: [0, 24000], colour: [-110, -10] },
                image: { line: 'levels', key: 'img', columnEdges: [0, 5, 10], rowEdges: [0, 12000, 24000], cells: [[-90, -80], [-50, -40]] } as never }
            : { id: lane.id, axis: level, lines: [], range: { x, y: [-1, 1] }, whole: { x: [0, 10], y: [-1, 1] } }),
        headlines: [],
        members: { shown: { used: [], n: 0, excluded: evicted.map(key => ({ key, reason: 'evicted' as const })) }, combined: { used: [], n: 0, excluded: [] }, calibration: 'calibrated', lines: [] },
    };
}
