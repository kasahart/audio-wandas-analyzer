export class RequestGeneration {
    private revision = 0;

    get current(): number { return this.revision; }
    advance(): number { return ++this.revision; }
    isCurrent(revision: number): boolean { return revision === this.revision; }
}

export interface AnalysisBatch<S, R> {
    isCurrent(): boolean;
    isSelected?(source: S): boolean;
    progress?(source: S, index: number, total: number): void;
    analyze(source: S): Promise<R>;
    commit(source: S, result: R): void | Promise<void>;
    failed?(source: S, error: unknown, remaining: readonly S[]): boolean;
}

export async function runAnalysisBatch<S, R>(sources: readonly S[], batch: AnalysisBatch<S, R>): Promise<void> {
    for (const [index, source] of sources.entries()) {
        if (!batch.isCurrent()) return;
        if (batch.isSelected && !batch.isSelected(source)) continue;
        batch.progress?.(source, index, sources.length);
        try {
            const result = await batch.analyze(source);
            if (!batch.isCurrent()) return;
            if (!batch.isSelected || batch.isSelected(source)) await batch.commit(source, result);
        } catch (error) {
            if (!batch.isCurrent()) return;
            if (batch.isSelected && !batch.isSelected(source)) continue;
            if (!batch.failed) throw error;
            if (!batch.failed(source, error, sources.slice(index + 1))) return;
        }
    }
}
