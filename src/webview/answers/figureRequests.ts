/**
 * The request side of the figure service (figure-design.md 第 6 節): what a Figure asks of layer 2 and which
 * replies it may use. answers/ owns the keys, the counting and the retries; it computes nothing and draws nothing.
 *
 * - Every Figure gets its own id; every request kind (draw, read, export, count) is numbered apart, per Figure.
 * - Per Figure and kind, at most one request runs and one waits (the latest); an older waiting one is dropped. A read
 *   a click waits for is counted apart from the hover's (`forClick`), so a later hover never drops it.
 * - A draw reply is used only when it answers the Figure's newest draw; a newer draw makes the running one stale (VS
 *   Code: it is cancelled; the browser's Worker cannot cancel and runs it out). The one exception is a draw that
 *   only moved (`moved`: the same spec, another range or size, as while the user scrolls or zooms on): the running
 *   draw is let finish and its picture is delivered though a newer draw waits, so the Figure has a picture to show
 *   of where it was a moment ago instead of none until the gesture ends. The Figure draws it on the newest range
 *   and reads nothing of it.
 * - Disposing a Figure releases its holdings; a draw reply that arrives after that releases them again.
 * - "no-picture" asks for a redraw; two in a row with no successful read between say the picture failed.
 * - A draw answered "busy" (it did not fit beside the requests running: the process's one budget) is asked once
 *   more a little later, if it is still the Figure's newest; busy again, the Figure is told so.
 * - A number column of the user's table is named in a spec by a versioned key, and its values are handed once: with
 *   the first request whose spec names it (第 5 節). A picture that counts the column as not kept is asked once more
 *   with the column handed again.
 * - Web (spec 4): while a long computation (a scan, a recipe recomputed, an export) is under way no read is sent, the
 *   replies to reads sent before it began are not used, and when the last one ends the Figures read again.
 */
import type {
    FigureColumn, FigureCountPayload, FigureCountResult, FigureDrawPayload, FigureDrawResult, FigureExportPayload, FigureExportResult, FigureReadPayload, FigureReadResult,
} from '../../shared/protocol/generated/backendProtocolSchema';
import type { FigureCancelMessage, FigureCommand, FigureRequestMessage, FigureResultMessage } from '../../shared/protocol/figureMessages';

/** How figure requests reach the host (the webview's post), and what the host can do with them. */
export interface FigureHostChannel {
    post(message: FigureRequestMessage | FigureCancelMessage): void;
    /** A running request can be cancelled (VS Code); the browser's Worker cannot. */
    readonly cancels: boolean;
    /** Long computations hold the readout (spec 4: the browser build; VS Code is unchanged). */
    readonly holdsReadsWhileComputing: boolean;
}

/** The long computations under way (spec 4): counted from asked (waiting for the Worker too) to answered (failed too). */
export interface LongComputations {
    /** One began; the function returned says it ended (once; later calls do nothing). */
    begin(): () => void;
    count(): number;
    /** Told when the count leaves 0 (true) and comes back to it (false). */
    onChange(listener: (computing: boolean) => void): () => void;
}

export type RequestKind = 'draw' | 'read' | 'clickRead' | 'export' | 'count';
/** Why an export will never be answered: a newer one took its place, or its Figure was disposed. */
export type ExportDropReason = 'superseded' | 'disposed';
type ReplyOf = { draw: FigureDrawResult; read: FigureReadResult; clickRead: FigureReadResult; export: FigureExportResult; count: FigureCountResult };

/** A read on its way: a click may claim it, so its reply is kept for the click (counted apart from the hover's). */
export interface ReadTicket {
    readonly requestNumber: number;
    /** The click at its place waits for this read: it is not dropped by a later hover. */
    claimForClick(deliver: (reply: FigureReadResult | null) => void): void;
}

/** One Figure's requests (its id, its numbers, its queues). */
export interface FigureRequests {
    readonly figureId: string;
    /** Whether reads are held now (spec 4, Web: a long computation is under way). */
    readsHeld(): boolean;
    /** `moved`: only the range or the size differs from the draw before (see the file's head): an older picture of the same spec is still delivered. */
    draw(payload: Omit<FigureDrawPayload, 'figureId' | 'requestNumber'>, deliver: (reply: FigureDrawResult | null) => void, moved?: boolean): number;
    /** A read; null when reads are held (spec 4). `deliver` gets null when the host failed the read, and the read's number. */
    read(payload: Omit<FigureReadPayload, 'figureId' | 'requestNumber'>, deliver: (reply: FigureReadResult | null, requestNumber: number) => void): ReadTicket | null;
    /**
     * An export; `dropped` is told when it will never be answered: a newer export took
     * its place while it waited ('superseded'), or the Figure was disposed first ('disposed').
     */
    export(payload: Omit<FigureExportPayload, 'requestNumber'>, deliver: (reply: FigureExportResult | null) => void, dropped?: (reason: ExportDropReason) => void): number;
    count(payload: FigureCountPayload, deliver: (reply: FigureCountResult | null) => void): void;
    /**
     * A read's status, for the retry rule: 'redraw' after a "no-picture" (at most twice in a row with no successful
     * read between), 'failed' past that, 'ok' otherwise. `reset` starts the count again (the spec, view, size or
     * answers' versions changed).
     */
    readStatus(status: FigureReadResult['status']): 'ok' | 'redraw' | 'failed';
    resetRetries(): void;
    /** Told when reads are held (a long computation began, spec 4) and when they may be sent again: read once at the pointer then. */
    onReadsHeld(listener: (held: boolean) => void): () => void;
    /** Releases the Figure's holdings; no reply is used after it. */
    dispose(): void;
    /** How many of each kind run and wait now (for tests and measurements). */
    queued(kind: RequestKind): { running: number; waiting: number };
}

export interface FigureAnswers {
    /** A host message: true when it was a figure reply (used or dropped). */
    handle(message: unknown): boolean;
    /** A new Figure's requests, under a new Figure id. */
    figure(): FigureRequests;
    /**
     * A number column of the user's table, as the table has it now (its key, its version, a value per row): kept by
     * reference and handed to the service once, with the first request whose spec names its key at that version.
     */
    column(column: FigureColumn): void;
    readonly computations: LongComputations;
}

interface Request<K extends RequestKind> {
    kind: K;
    requestId: string;
    command: FigureCommand;
    payload: FigureRequestMessage['payload'];
    number: number;
    epoch: number;
    deliver: (reply: ReplyOf[K] | null) => void;
    /** Ended when its reply comes (an export, a long computation on the browser build). */
    ended?: () => void;
    /** Told when it will never be answered (an export superseded or disposed): its caller settles. */
    dropped?: (reason: ExportDropReason) => void;
    /** A draw asked once more after it was answered "busy": busy again, its reply is delivered. */
    again?: boolean;
    /** A draw that only moved the range or the size: the draw running before it is not stopped. */
    moved?: boolean;
}

/** How long a draw answered "busy" waits before it is asked once more (ms). */
export const BUSY_WAIT_MS = 400;

const COMMAND: Record<RequestKind, FigureCommand> = { draw: 'figure-draw', read: 'figure-read', clickRead: 'figure-read', export: 'figure-export', count: 'figure-count' };

/** The page's figure requests: one per webview, shared by every Figure on it. */
export function createFigureAnswers(channel: FigureHostChannel, prefix = 'figure', later: (run: () => void, ms: number) => void = (run, ms) => { setTimeout(run, ms); }): FigureAnswers {
    let figures = 0, ids = 0;
    // Every request on its way, by its id: what to do with its reply.
    const onWay = new Map<string, { request: Request<RequestKind>; settle: (reply: unknown, failed: boolean) => void }>();
    const computations = createComputations();
    // Spec 4: a read sent before a long computation began is of another epoch, and its reply is not used.
    let epoch = 0;
    const holders = new Set<(held: boolean) => void>();
    computations.onChange(computing => {
        if (!channel.holdsReadsWhileComputing) return;
        epoch += 1;
        for (const listener of [...holders]) listener(computing);
    });
    const held = (): boolean => channel.holdsReadsWhileComputing && computations.count() > 0;
    // The table's columns by key, and the version of each the service was handed.
    const columns = new Map<string, FigureColumn>();
    const handed = new Map<string, string>();
    /** `payload` with the columns its spec names that the service has not been handed (marked handed now). */
    const withColumns = <P extends { spec: FigureDrawPayload['spec'] }>(payload: P): P => {
        const owed = payload.spec.keys.flatMap(entry => {
            const column = columns.get(entry.key);
            return column && column.version === entry.version && handed.get(entry.key) !== column.version ? [column] : [];
        });
        for (const column of owed) handed.set(column.key, column.version);
        return owed.length ? { ...payload, columns: owed } : payload;
    };
    /** The columns a picture counted as not kept (the service let them go, or never got them): to be handed again. */
    const columnsNotKept = (reply: FigureDrawResult | null): string[] =>
        (reply?.status === 'picture' ? reply.members?.shown.excluded ?? [] : []).filter(item => (item.reason === 'evicted' || item.reason === 'version') && columns.has(item.key)).map(item => item.key);

    return {
        computations,
        handle(message) {
            if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'figure-result') return false;
            const reply = message as FigureResultMessage;
            const waiting = onWay.get(reply.requestId);
            if (!waiting) return reply.requestId.startsWith(`${prefix}-`);
            onWay.delete(reply.requestId);
            if ('failed' in reply) waiting.settle(null, true);
            else waiting.settle(reply.result, false);
            return true;
        },
        column(column) {
            columns.set(column.key, column);
        },
        figure() {
            const figureId = `${prefix}-${Date.now().toString(36)}-${++figures}`;
            const numbers: Record<'draw' | 'read' | 'export', number> = { draw: 0, read: 0, export: 0 };
            /** The draw number since which every draw only moved (its range or size): an older picture from there on is still delivered. */
            let movedFrom = 0;
            const slots: Record<RequestKind, { running: Request<RequestKind> | null; waiting: Request<RequestKind> | null }> = {
                draw: { running: null, waiting: null }, read: { running: null, waiting: null }, clickRead: { running: null, waiting: null },
                export: { running: null, waiting: null }, count: { running: null, waiting: null },
            };
            let disposed = false;
            let noPictures = 0;
            const ownHolders = new Set<(held: boolean) => void>();
            const release = (): void => { channel.post({ type: 'figure-request', requestId: `${prefix}-r${++ids}`, command: 'figure-release', payload: { figureId } }); };

            const isRead = (kind: RequestKind): boolean => kind === 'read' || kind === 'clickRead';
            const send = (request: Request<RequestKind>): void => {
                slots[request.kind].running = request;
                onWay.set(request.requestId, {
                    request,
                    settle: (reply, failed) => {
                        // Its kind now: a hover's read a click claimed counts as the click's.
                        const slot = slots[request.kind];
                        if (slot.running === request) slot.running = null;
                        request.ended?.();
                        receive(request, failed ? null : reply);
                        sendNext(request.kind);
                    },
                });
                channel.post({ type: 'figure-request', requestId: request.requestId, command: request.command, payload: request.payload });
            };
            const sendNext = (kind: RequestKind): void => {
                const slot = slots[kind];
                if (slot.running || disposed || !slot.waiting) return;
                const next = slot.waiting;
                slot.waiting = null;
                // Spec 4: a read that waited across a long computation is not sent (the Figure reads again after it).
                if (isRead(kind) && channel.holdsReadsWhileComputing && next.epoch !== epoch) return;
                send(next);
            };
            const enqueue = (request: Request<RequestKind>): void => {
                const slot = slots[request.kind];
                if (!slot.running) { send(request); return; }
                // The latest waits; an older waiting one is dropped (its reply never comes: it was never sent), and
                // its caller is told so (an export's promise settles, never hangs).
                slot.waiting?.ended?.();
                slot.waiting?.dropped?.('superseded');
                slot.waiting = request;
                // A newer draw makes the running one stale: VS Code stops it; the Worker runs it out.
                // (Not for a draw that only moved: the running one's picture is shown meanwhile.)
                if (request.kind === 'draw' && channel.cancels && !request.moved) channel.post({ type: 'figure-cancel', requestIds: [slot.running.requestId] });
            };
            const receive = (request: Request<RequestKind>, reply: unknown): void => {
                if (disposed) {
                    // Finished after the Figure was disposed: whatever it made is let go again (第 6 節「取り置きの寿命」).
                    if (request.kind === 'draw') release();
                    return;
                }
                if (request.kind === 'draw') {
                    // Only the newest draw's reply is drawn; an older one is stale, unless every draw since only
                    // moved: its picture is delivered to be shown meanwhile (the Figure knows it is not its newest).
                    if (request.number !== numbers.draw) {
                        if (request.number >= movedFrom && (reply as FigureDrawResult | null)?.status === 'picture') request.deliver(reply as FigureDrawResult);
                        return;
                    }
                    const draw = request as unknown as Request<'draw'>;
                    if ((reply as FigureDrawResult | null)?.status === 'busy' && !draw.again) {
                        // Asked once more a little later, unless a newer draw came or the Figure went meanwhile.
                        later(() => {
                            if (disposed || request.number !== numbers.draw) return;
                            enqueue({ ...draw, requestId: `${prefix}-${++ids}`, again: true } as Request<RequestKind>);
                        }, BUSY_WAIT_MS);
                        return;
                    }
                    const lost = draw.again ? [] : columnsNotKept(reply as FigureDrawResult | null);
                    if (lost.length) {
                        // Asked once more with the columns handed again.
                        for (const key of lost) handed.delete(key);
                        enqueue({ ...draw, payload: withColumns(draw.payload as FigureDrawPayload), requestId: `${prefix}-${++ids}`, again: true } as Request<RequestKind>);
                        return;
                    }
                    request.deliver(reply as FigureDrawResult | null);
                    return;
                }
                if (request.kind === 'read' || request.kind === 'clickRead') {
                    // Spec 4: a read sent before a long computation began, or answered during one, is not used.
                    if (channel.holdsReadsWhileComputing && (request.epoch !== epoch || held())) return;
                    request.deliver(reply as FigureReadResult | null);
                    return;
                }
                request.deliver(reply as never);
            };
            const make = <K extends RequestKind>(kind: K, payload: FigureRequestMessage['payload'], number: number, deliver: (reply: ReplyOf[K] | null) => void): Request<K> => (
                { kind, requestId: `${prefix}-${++ids}`, command: COMMAND[kind], payload, number, epoch, deliver }
            );

            const requests: FigureRequests = {
                figureId,
                readsHeld: held,
                draw(payload, deliver, moved = false) {
                    const number = ++numbers.draw;
                    if (!moved) movedFrom = number;
                    if (disposed) return number;
                    enqueue({ ...make('draw', withColumns({ ...payload, figureId, requestNumber: number }), number, deliver), moved } as Request<RequestKind>);
                    return number;
                },
                read(payload, deliver) {
                    if (disposed || held()) return null;
                    const number = ++numbers.read;
                    const request = make('read', { ...payload, figureId, requestNumber: number }, number, reply => deliver(reply, number));
                    enqueue(request as Request<RequestKind>);
                    return {
                        requestNumber: number,
                        claimForClick(forClick) {
                            const was = request.deliver;
                            request.deliver = reply => { was(reply); forClick(reply); };
                            const hover = slots.read, click = slots.clickRead;
                            const asked = request as Request<RequestKind>;
                            if (hover.waiting === asked) {
                                // Waiting behind a hover: it takes the click's own place in the queue.
                                hover.waiting = null;
                                asked.kind = 'clickRead';
                                if (click.running) click.waiting = asked; else send(asked);
                            } else if (hover.running === asked) {
                                // On its way: it now counts as the click's, so the hover's next one may go. A click
                                // before it whose read is still out is no longer current (a later press came).
                                hover.running = null;
                                asked.kind = 'clickRead';
                                click.running = asked;
                                sendNext('read');
                            }
                        },
                    };
                },
                export(payload, deliver, dropped) {
                    const number = ++numbers.export;
                    if (disposed) { dropped?.('disposed'); return number; }
                    const request = make('export', withColumns({ ...payload, requestNumber: number }), number, deliver);
                    if (dropped) request.dropped = dropped;
                    // An export is a long computation (spec 4): reads are held until it is answered.
                    request.ended = computations.begin();
                    enqueue(request as Request<RequestKind>);
                    return number;
                },
                count(payload, deliver) {
                    if (disposed) return;
                    enqueue(make('count', withColumns(payload), 0, deliver) as Request<RequestKind>);
                },
                readStatus(status) {
                    if (status !== 'no-picture') { noPictures = 0; return 'ok'; }
                    noPictures += 1;
                    return noPictures <= 2 ? 'redraw' : 'failed';
                },
                resetRetries() { noPictures = 0; },
                onReadsHeld(listener) {
                    holders.add(listener);
                    ownHolders.add(listener);
                    return () => { holders.delete(listener); ownHolders.delete(listener); };
                },
                dispose() {
                    if (disposed) return;
                    disposed = true;
                    for (const listener of ownHolders) holders.delete(listener);
                    ownHolders.clear();
                    const running = Object.values(slots).flatMap(slot => (slot.running ? [slot.running] : []));
                    for (const slot of Object.values(slots)) { slot.waiting?.ended?.(); slot.waiting?.dropped?.('disposed'); slot.waiting = null; }
                    // An export on its way is never answered now (its reply is not used after dispose): its long
                    // computation ends, and its caller is told.
                    for (const request of running) { if (request.kind !== 'export') continue; request.ended?.(); request.dropped?.('disposed'); }
                    const draws = running.filter(request => request.kind === 'draw').map(request => request.requestId);
                    if (draws.length && channel.cancels) channel.post({ type: 'figure-cancel', requestIds: draws });
                    release();
                },
                queued(kind) {
                    const slot = slots[kind];
                    return { running: slot.running ? 1 : 0, waiting: slot.waiting ? 1 : 0 };
                },
            };
            return requests;
        },
    };
}

function createComputations(): LongComputations {
    let count = 0;
    const listeners = new Set<(computing: boolean) => void>();
    const tell = (computing: boolean): void => { for (const listener of [...listeners]) listener(computing); };
    return {
        begin() {
            count += 1;
            if (count === 1) tell(true);
            let ended = false;
            return () => {
                if (ended) return;
                ended = true;
                count -= 1;
                if (count === 0) tell(false);
            };
        },
        count: () => count,
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
