/**
 * The one way the webview keeps track of what it asked the host for on demand: a track's waveform range, its
 * spectrogram, its cursor spectrum, a screen's step pictures. Each owner (a track, a screen's picture source)
 * holds its requests in named slots: a new request in a slot supersedes the one there, and an answer counts
 * for a slot only while its request is that slot's current one. A superseded request is still known until it
 * is settled, for an owner that keeps what such a request brought (the step pictures, cached per spec).
 */

export interface HostRequest<Meta> {
    readonly requestId: string;
    readonly slot: string;
    /** What was asked, for telling whether a request in flight already asks for it. */
    readonly key: string;
    readonly meta: Meta;
}

let requestCounter = 0;

/** A request id unique in this webview: `prefix-owner-time-counter`. */
export function nextRequestId(prefix: string, owner: number | string): string {
    requestCounter += 1;
    return `${prefix}-${owner}-${Date.now()}-${requestCounter.toString(36)}`;
}

export class HostRequests<Meta = undefined> {
    private readonly known = new Map<string, HostRequest<Meta>>();
    private readonly current = new Map<string, string>();

    /** Starts a request in `slot` (superseding the one there) and hands it to `send`. */
    ask(slot: string, requestId: string, key: string, meta: Meta, send?: (request: HostRequest<Meta>) => void): HostRequest<Meta> {
        const request: HostRequest<Meta> = { requestId, slot, key, meta };
        this.known.set(requestId, request);
        this.current.set(slot, requestId);
        send?.(request);
        return request;
    }

    /** The slot's current request, while it is not answered. */
    pending(slot: string): HostRequest<Meta> | undefined {
        const requestId = this.current.get(slot);
        return requestId === undefined ? undefined : this.known.get(requestId);
    }

    /** The request an answer is for while it is still its slot's current one; undefined for a stale answer. */
    answering(slot: string, requestId: string): HostRequest<Meta> | undefined {
        return this.current.get(slot) === requestId ? this.known.get(requestId) : undefined;
    }

    /** Any request not yet settled, current or superseded. */
    find(requestId: string): HostRequest<Meta> | undefined {
        return this.known.get(requestId);
    }

    /** The request is answered (or failed): it is forgotten and its slot is free unless a newer one took it. */
    settle(requestId: string): void {
        const request = this.known.get(requestId);
        if (!request) return;
        this.known.delete(requestId);
        if (this.current.get(request.slot) === requestId) this.current.delete(request.slot);
    }

    /** Forgets the slot's request: its answer, if it comes, is stale. */
    drop(slot: string): void {
        const requestId = this.current.get(slot);
        if (requestId !== undefined) this.known.delete(requestId);
        this.current.delete(slot);
    }

    /** Forgets every request (a new analysis, a track removed): their answers are stale. */
    clear(): void {
        this.known.clear();
        this.current.clear();
    }
}
