import { RequestGeneration } from './analysisCoordinator';

export class SessionRequests extends RequestGeneration {
    latestRequestId: string | undefined;
    private closed = false;

    begin(requestId?: string): number {
        this.latestRequestId = requestId;
        return this.advance();
    }

    override isCurrent(revision: number, requestId?: string): boolean {
        return !this.closed && super.isCurrent(revision)
            && (requestId === undefined || requestId === this.latestRequestId);
    }

    dispose(): void {
        if (this.closed) return;
        this.closed = true;
        this.advance();
    }
}

// Borrowed native caches retain entries when detached. Owned Web sources release
// resources only on drop/clear; selecting a source never changes ownership.
export class SourceResults<S> {
    constructor(
        private records = new Map<string, S>(),
        private readonly release?: (source: S) => void,
    ) {}

    get size(): number { return this.records.size; }
    get(path: string): S | undefined { return this.records.get(path); }
    values(): IterableIterator<S> { return this.records.values(); }
    snapshot<R>(result: (source: S) => R): R[] { return Array.from(this.records.values(), result); }
    owns(path: string, owner: S): boolean { return this.records.get(path) === owner; }
    set(path: string, source: S): void {
        const previous = this.records.get(path);
        this.records.set(path, source);
        if (previous !== undefined && previous !== source) this.release?.(previous);
    }
    delete(path: string): void {
        const source = this.records.get(path);
        if (source === undefined) return;
        this.records.delete(path);
        this.release?.(source);
    }
    clear(): void {
        const records = [...this.records.values()];
        this.records.clear();
        records.forEach(source => this.release?.(source));
    }
    hasRevision(path: string, expected: number, revision: (source: S) => number): boolean {
        const source = this.records.get(path);
        if (source === undefined) return false;
        if (revision(source) === expected) return true;
        this.delete(path);
        return false;
    }
}
