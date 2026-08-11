import type {
    ComparisonTrackState,
    LazyRequestState,
    SpectrumSlice,
    TrackId,
    TrackRuntimeState,
    WaveformCoverage,
    WaveformRangeCache,
} from './types';

export interface TrackRecord {
    readonly id: TrackId;
    result: ComparisonTrackState;
    protocolIndex: number;
    active: boolean;
    readonly runtime: TrackRuntimeState;
    waveformCoverage: WaveformCoverage | null;
    rangeCache: WaveformRangeCache | null;
    pendingRangeRequest: string | null;
    detailRequest: LazyRequestState | null;
    readonly spectrumSliceRequests: Map<number, LazyRequestState>;
    readonly spectrumSliceCache: Map<number, SpectrumSlice>;
    readonly spectrumPainted: Map<number, boolean>;
}

export interface ReconcileResult {
    added: TrackId[];
    removed: TrackId[];
    protocolOrderChanged: boolean;
}

export class TrackStore {
    private readonly records = new Map<TrackId, TrackRecord>();
    private readonly locallyRemovedIds = new Set<TrackId>();
    private protocolOrder: TrackId[] = [];
    private nextTrackId = 1;
    displayOrder: TrackId[] = [];

    constructor(
        results: ComparisonTrackState[],
        private readonly createRuntime: () => TrackRuntimeState,
    ) {
        results.forEach((result, protocolIndex) => {
            const record = this.createRecord(result, protocolIndex);
            this.protocolOrder.push(record.id);
            this.displayOrder.push(record.id);
        });
    }

    get(id: TrackId): TrackRecord | undefined {
        return this.records.get(id);
    }

    require(id: TrackId): TrackRecord {
        const record = this.records.get(id);
        if (!record) {
            throw new Error(`Unknown TrackId: ${id}`);
        }
        return record;
    }

    idAtProtocolIndex(index: number): TrackId | null {
        if (!Number.isInteger(index) || index < 0 || index >= this.protocolOrder.length) {
            return null;
        }
        const id = this.protocolOrder[index];
        const record = this.records.get(id);
        return record?.active ? id : null;
    }

    protocolIndexForId(id: TrackId): number | null {
        const record = this.records.get(id);
        return record?.active ? record.protocolIndex : null;
    }

    activeIds(): TrackId[] {
        return this.protocolOrder.filter((id) => this.records.get(id)?.active);
    }

    remove(id: TrackId): boolean {
        const record = this.records.get(id);
        if (!record?.active) {
            return false;
        }
        record.active = false;
        this.locallyRemovedIds.add(id);
        this.clearAsyncState(record);
        this.displayOrder = this.displayOrder.filter((candidate) => candidate !== id);
        return true;
    }

    reorder(fromId: TrackId, toId: TrackId): boolean {
        const fromPosition = this.displayOrder.indexOf(fromId);
        const toPosition = this.displayOrder.indexOf(toId);
        if (fromPosition === -1 || toPosition === -1) {
            return false;
        }
        this.displayOrder.splice(fromPosition, 1);
        this.displayOrder.splice(toPosition, 0, fromId);
        return true;
    }

    reconcile(
        results: ComparisonTrackState[],
        mergeResult: (next: ComparisonTrackState, previous?: ComparisonTrackState) => ComparisonTrackState,
    ): ReconcileResult {
        const previousProtocolOrder = this.activeIds();
        const previousProtocolIndices = new Map(previousProtocolOrder.map((id) => [id, this.require(id).protocolIndex]));
        const candidatesByPath = new Map<string, TrackRecord[]>();
        this.protocolOrder.forEach((id) => {
            const record = this.records.get(id);
            if (!record?.active) {
                return;
            }
            const candidates = candidatesByPath.get(record.result.filePath) ?? [];
            candidates.push(record);
            candidatesByPath.set(record.result.filePath, candidates);
        });
        const locallyRemovedByPath = new Map<string, number>();
        this.locallyRemovedIds.forEach((id) => {
            const record = this.records.get(id);
            if (!record) {
                return;
            }
            locallyRemovedByPath.set(record.result.filePath, (locallyRemovedByPath.get(record.result.filePath) ?? 0) + 1);
        });

        const previousDisplayOrder = this.displayOrder.slice();
        const nextProtocolOrder: TrackId[] = [];
        const retained = new Set<TrackId>();
        const added: TrackId[] = [];

        results.forEach((nextResult, protocolIndex) => {
            const candidates = candidatesByPath.get(nextResult.filePath);
            const existing = candidates?.shift();
            if (existing) {
                existing.result = mergeResult(nextResult, existing.result);
                existing.result.trackId = existing.id;
                existing.protocolIndex = protocolIndex;
                existing.active = true;
                this.clearAnalysisState(existing);
                retained.add(existing.id);
                nextProtocolOrder.push(existing.id);
                return;
            }
            const tombstoneCount = locallyRemovedByPath.get(nextResult.filePath) ?? 0;
            if (tombstoneCount > 0) {
                locallyRemovedByPath.set(nextResult.filePath, tombstoneCount - 1);
                return;
            }
            const nextProtocolIndex = nextProtocolOrder.length;
            const record = this.createRecord(mergeResult(nextResult), nextProtocolIndex);
            retained.add(record.id);
            added.push(record.id);
            nextProtocolOrder.push(record.id);
        });

        const removed: TrackId[] = [];
        this.records.forEach((record) => {
            if (record.active && !retained.has(record.id)) {
                record.active = false;
                this.clearAsyncState(record);
                removed.push(record.id);
            }
        });
        nextProtocolOrder.forEach((id, protocolIndex) => {
            this.require(id).protocolIndex = protocolIndex;
        });
        this.protocolOrder = nextProtocolOrder;
        const retainedDisplay = previousDisplayOrder.filter((id) => retained.has(id));
        this.displayOrder = retainedDisplay.concat(added);
        const protocolOrderChanged = previousProtocolOrder.length !== nextProtocolOrder.length
            || previousProtocolOrder.some((id, index) => id !== nextProtocolOrder[index])
            || nextProtocolOrder.some((id, index) => previousProtocolIndices.get(id) !== index);
        return { added, removed, protocolOrderChanged };
    }

    private createRecord(result: ComparisonTrackState, protocolIndex: number): TrackRecord {
        const id = `track-${this.nextTrackId++}` as TrackId;
        const record: TrackRecord = {
            id,
            result,
            protocolIndex,
            active: true,
            runtime: this.createRuntime(),
            waveformCoverage: null,
            rangeCache: null,
            pendingRangeRequest: null,
            detailRequest: null,
            spectrumSliceRequests: new Map(),
            spectrumSliceCache: new Map(),
            spectrumPainted: new Map(),
        };
        result.trackId = id;
        this.records.set(id, record);
        return record;
    }

    private clearAnalysisState(record: TrackRecord): void {
        record.waveformCoverage = null;
        record.rangeCache = null;
        this.clearAsyncState(record);
        record.spectrumPainted.clear();
    }

    private clearAsyncState(record: TrackRecord): void {
        record.pendingRangeRequest = null;
        record.detailRequest = null;
        record.spectrumSliceRequests.clear();
        record.spectrumSliceCache.clear();
    }
}
