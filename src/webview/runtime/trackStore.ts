import type {
    ComparisonTrackState,
    LazyRequestState,
    SpectrumSlice,
    TimelineSpan,
    TrackId,
    TrackRuntimeState,
    WaveformCoverage,
    WaveformRangeCache,
} from './types';
import type { SpectrogramData } from '../../shared/analysis/analysisTypes';
import { HostRequests } from './hostRequests';
import { OWN_COLORS } from '../../shared/gui/roleColors';

export interface TrackRecord {
    readonly id: TrackId;
    result: ComparisonTrackState;
    protocolIndex: number;
    active: boolean;
    readonly runtime: TrackRuntimeState;
    waveformCoverage: WaveformCoverage | null;
    rangeCache: WaveformRangeCache | null;
    /** What the track asked the host for: its waveform range ('range'), spectrogram ('detail') and cursor spectrum ('slice'). */
    readonly requests: HostRequests<LazyRequestState | null>;
    /** The host's answer when the spectrogram failed: shown in the lane, and asked again only after a pause. */
    detailError: { settingsSignature: string; message: string; at: number } | null;
    /** A zoomed lane's spectrogram window, asked again at full resolution (R3); drawn while it covers the view. */
    spectrogramZoom: SpectrogramZoom | null;
    readonly spectrumSliceCache: Map<number, SpectrumSlice>;
}

export interface SpectrogramZoom {
    startNorm: number;
    endNorm: number;
    analysisId: string;
    settingsSignature: string;
    /** Per channel, as the whole file's spectrograms are. */
    spectrograms: Array<SpectrogramData | null>;
}

export interface ReconcileResult {
    added: TrackId[];
    removed: TrackId[];
    protocolOrderChanged: boolean;
}

export class TrackStore {
    private readonly records = new Map<TrackId, TrackRecord>();
    private readonly locallyRemovedIds = new Map<TrackId, string>();
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
            this.assignOwnColor(record);
        });
    }

    /**
     * Gives a new track the own colour (roleColors.ownColor) the tracks on screen use least, the first such: up to as many
     * tracks as there are colours, each has a different one. A track keeps its colour while it stays.
     */
    private assignOwnColor(record: TrackRecord): void {
        const uses = OWN_COLORS.map(() => 0);
        this.records.forEach((other) => {
            if (other !== record && other.active && other.runtime.ownColorIndex !== undefined) uses[other.runtime.ownColorIndex % uses.length]++;
        });
        record.runtime.ownColorIndex = uses.indexOf(Math.min(...uses));
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

    globalSpan(): TimelineSpan {
        let startSec = Infinity, endSec = -Infinity;
        this.activeIds().forEach((id) => {
            const record = this.require(id);
            if (record.runtime.hidden || record.result.error) {
                return;
            }
            const off = record.runtime.offsetSeconds;
            const dur = record.result.durationSeconds || 0;
            startSec = Math.min(startSec, off);
            endSec = Math.max(endSec, off + dur);
        });
        if (!isFinite(startSec)) {
            startSec = 0;
        }
        if (!isFinite(endSec) || endSec <= startSec) {
            endSec = startSec + 1;
        }
        return { startSec, endSec, spanSec: endSec - startSec };
    }

    remove(id: TrackId): boolean {
        const record = this.records.get(id);
        if (!record?.active) {
            return false;
        }
        record.active = false;
        this.locallyRemovedIds.set(id, record.result.filePath);
        this.clearAsyncState(record);
        this.records.delete(id);
        this.displayOrder = this.displayOrder.filter((candidate) => candidate !== id);
        // A track taken off frees what the host holds for it, which may be why another one failed.
        this.clearDetailErrors();
        return true;
    }

    clearDetailErrors(): void {
        this.activeIds().forEach((activeId) => { this.require(activeId).detailError = null; });
    }

    allowExplicitSelection(filePath: string): void {
        this.locallyRemovedIds.forEach((removedPath, id) => {
            if (removedPath === filePath) {
                this.locallyRemovedIds.delete(id);
            }
        });
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

    /** The results of the active tracks, in protocol order: what the runtime's protocol indices point into. */
    activeResults(): ComparisonTrackState[] {
        return this.activeIds().map(id => this.require(id).result);
    }

    /**
     * The host's new results replace the old ones: each track keeps its identity, its runtime state and the audio
     * source it already plays from. Returns what changed and the new protocol-ordered results.
     */
    applyAnalysisUpdate(results: ComparisonTrackState[]): ReconcileResult & { results: ComparisonTrackState[] } {
        const reconciliation = this.reconcile(results, (nextResult, previousResult) =>
            Object.assign({}, nextResult, { audioSource: previousResult?.audioSource || nextResult.audioSource || '' }));
        return { ...reconciliation, results: this.activeResults() };
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
        this.locallyRemovedIds.forEach((filePath) => {
            locallyRemovedByPath.set(filePath, (locallyRemovedByPath.get(filePath) ?? 0) + 1);
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
                this.records.delete(record.id);
            }
        });
        nextProtocolOrder.forEach((id, protocolIndex) => {
            this.require(id).protocolIndex = protocolIndex;
        });
        // Colours for the new tracks once the tracks gone have given theirs back.
        added.forEach((id) => this.assignOwnColor(this.require(id)));
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
            requests: new HostRequests(),
            detailError: null,
            spectrogramZoom: null,
            spectrumSliceCache: new Map(),
        };
        result.trackId = id;
        this.records.set(id, record);
        return record;
    }

    private clearAnalysisState(record: TrackRecord): void {
        record.waveformCoverage = null;
        record.rangeCache = null;
        this.clearAsyncState(record);
    }

    private clearAsyncState(record: TrackRecord): void {
        record.requests.clear();
        record.detailError = null;
        record.spectrogramZoom = null;
        record.spectrumSliceCache.clear();
    }
}
