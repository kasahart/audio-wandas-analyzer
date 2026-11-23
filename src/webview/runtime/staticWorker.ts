import type { AnalysisCancellationSignal } from '../../shared/analysis/analysisClient';
import type { SessionRequests } from '../../shared/analysis/analysisSession';
import { BackendProtocolError, PendingBackendRequests, rejectPendingRequests, settleBackendRequest } from '../../shared/protocol/backendProtocol';
import { parseWorkerMessage, parseWorkerResult, type WorkerCommand, type WorkerRequest, type WorkerResult } from './workerProtocol';

export type PythonState = 'starting' | 'ready' | 'failed' | 'stopped';

/** A selected track as the Worker holds it: loaded under `/sources/<sourceId>` from the file's bytes. */
export interface WorkerSource {
    path: string;
    sourceId: string;
    file: { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface WorkerConnectionDeps<S extends WorkerSource> {
    Worker: typeof Worker;
    /** The selected tracks: a Worker that has to be replaced gets them loaded again. */
    sources: { readonly size: number; values(): Iterable<S>; owns(path: string, source: S): boolean };
    sourceGeneration: SessionRequests;
    /** `quiet`: a restart the user did not ask for (after a folder scan) keeps to the footer dot. */
    showState(state: PythonState, quiet?: boolean): void;
    /** The optional packages the booted runtime cannot import. */
    reportLacks(lacks: string[]): void;
    /** Work in flight is being dropped: a reanalysis that started before it must not publish. */
    cancelReanalysis(): void;
    /** The current Worker crashed and has been reset. */
    crashed(): void;
    /** The message requests reject with when a failed boot is replaced. */
    bootFailedReason: string;
}

export interface WorkerConnection {
    /** Boots the first Worker; Pyodide then starts with the page, which keeps that wait off the first file load. */
    start(): void;
    /** Sends `command` once the selected sources are back in a Worker (after a reset they are loaded again first). */
    request<K extends WorkerCommand>(command: WorkerRequest<K>, bytes?: ArrayBuffer, forcedRequestId?: string, cancellation?: AnalysisCancellationSignal): Promise<WorkerResult<K>>;
    /** Stops every Worker and rejects what is waiting with `reason`. */
    reset(reason: Error): void;
    /** Drops every source: an idle Worker only releases them, so Pyodide boots once per page. */
    clear(): void;
    /** True while `requestId` waits for a reply, or while sources are being loaded again. */
    isWaiting(requestId: string): boolean;
    readonly running: boolean;
    readonly recovering: boolean;
}

const WORKER_URL = './audio.worker.js';
const cancelled = (): Error => new Error('Analysis cancelled');

export function createWorkerConnection<S extends WorkerSource>(deps: WorkerConnectionDeps<S>): WorkerConnection {
    const { Worker, sources, sourceGeneration } = deps;
    let worker: Worker | undefined;
    let recovery: Promise<void> | undefined;
    let bootFailed = false;
    const pending = new PendingBackendRequests<unknown, WorkerCommand>('browser-');

    function reset(reason: Error): void {
        deps.cancelReanalysis();
        worker?.terminate(); worker = undefined;
        deps.showState('stopped');
        recovery = undefined;
        rejectPendingRequests(pending, reason);
    }
    function startWorker(quiet = false): Worker {
        const activeWorker = new Worker(WORKER_URL, { type: 'module' });
        bootFailed = false;
        deps.showState('starting', quiet);
        attachWorker(activeWorker);
        return activeWorker;
    }
    /** Routes a Worker's replies to the pending requests while it is the current one. */
    function attachWorker(activeWorker: Worker): void {
        activeWorker.onmessage = (event: MessageEvent<unknown>): void => {
            if (worker !== activeWorker) return;
            const message = parseWorkerMessage(event.data);
            if (!message) return;
            if (message.kind === 'ready') {
                bootFailed = !message.ready;
                if (message.lacks) deps.reportLacks(message.lacks);
                deps.showState(message.ready ? 'ready' : 'failed');
                return;
            }
            // A Worker reply is `{requestId, result}` or `{requestId, error}`; `result` holds no envelope keys.
            const { requestId, result, error, envelope, wellFormed } = message;
            if (error === undefined && !wellFormed) {
                // Rejected before the result validators run, so the error names the envelope rather than the result.
                const request = pending.get(requestId);
                if (!request) return;
                pending.delete(requestId);
                request.reject(new BackendProtocolError(`Invalid ${request.command} response envelope`));
                return;
            }
            settleBackendRequest(pending, requestId, error === undefined ? result : envelope, error);
        };
        activeWorker.onerror = (): void => {
            if (worker !== activeWorker) return;
            reset(cancelled());
            deps.crashed();
        };
    }
    /** Every success reply is checked before it settles: the shared commands by the native validator, the Worker's own by theirs. */
    function send<K extends WorkerCommand>(command: WorkerRequest<K>, bytes?: ArrayBuffer, forcedRequestId?: string): Promise<WorkerResult<K>> {
        if (!worker) {
            if (command.cmd !== 'load' && command.cmd !== 'limits') throw new Error('No selected source; choose the file again.');
            worker = startWorker();
        }
        const target = worker;
        const requestId = forcedRequestId ?? pending.nextId();
        return pending.dispatch(command.cmd, requestId, response => parseWorkerResult(command.cmd, response), () => {
            target.postMessage({ ...command, requestId, bytes }, bytes ? [bytes] : []);
        });
    }
    async function request<K extends WorkerCommand>(
        command: WorkerRequest<K>, bytes?: ArrayBuffer, forcedRequestId?: string, cancellation?: AnalysisCancellationSignal,
    ): Promise<WorkerResult<K>> {
        // A Worker whose boot failed is replaced first, so retained sources are replayed into its successor.
        if (bootFailed) reset(new Error(deps.bootFailedReason));
        if (!worker && !recovery && sources.size) {
            const generation = sourceGeneration.current;
            const restoring = (async () => {
                for (const source of sources.values()) {
                    const sourceBytes = await source.file.arrayBuffer();
                    if (!sourceGeneration.isCurrent(generation) || !sources.owns(source.path, source)) throw cancelled();
                    await send({ cmd: 'load', sourceId: source.sourceId }, sourceBytes);
                }
            })();
            recovery = restoring;
            void restoring.finally(() => { if (recovery === restoring) recovery = undefined; }).catch(() => {});
        }
        if (recovery) await recovery;
        if (cancellation?.isCancellationRequested) throw new Error('Recipe execution cancelled');
        return send(command, bytes, forcedRequestId);
    }
    function clear(): void {
        // Python cannot interrupt a running command, so work still in flight is cancelled by restarting the Worker.
        if (pending.size || recovery) reset(cancelled());
        else if (worker) {
            deps.cancelReanalysis();
            const kept = worker;
            // A Worker that cannot clear (a failed boot, or an older cached script) is replaced so no source outlives Clear.
            send({ cmd: 'clear' }).catch(() => { if (worker === kept) reset(cancelled()); });
        }
    }
    return {
        start: () => { worker = startWorker(); },
        request,
        reset,
        clear,
        isWaiting: requestId => pending.has(requestId) || recovery !== undefined,
        get running() { return worker !== undefined; },
        get recovering() { return recovery !== undefined; },
    };
}
