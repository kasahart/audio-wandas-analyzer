import * as path from 'path';
import * as vscode from 'vscode';
import type { AnalysisResult, AnalysisResultWithError, StftOptions } from '../shared/analysis/analysisTypes';
import type { AnalyzeOptions } from './pythonBackendServer';

export interface AnalysisBackend {
    analyze(filePath: string, options: AnalyzeOptions): Promise<AnalysisResult>;
    warmup(): void;
}

export interface ProgressMessageSink {
    postMessage(message: unknown): Thenable<boolean>;
}

export interface AnalysisHost {
    getDefaultPeakCount(): number;
    withProgress<T>(
        options: vscode.ProgressOptions,
        task: (
            progress: vscode.Progress<{ message?: string; increment?: number }>,
            token: vscode.CancellationToken,
        ) => Thenable<T>,
    ): Thenable<T>;
}

const defaultHost: AnalysisHost = {
    getDefaultPeakCount: () => vscode.workspace
        .getConfiguration('audioWandasAnalyzer')
        .get<number>('defaultPeakCount', 5),
    withProgress: (options, task) => vscode.window.withProgress(options, task),
};

function errorAnalysisRevision(error: unknown): number {
    if (!error || typeof error !== 'object') { return 0; }
    const revision = (error as { analysisRevision?: unknown }).analysisRevision;
    return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

export class AnalysisOrchestrator {
    constructor(
        private readonly backend: AnalysisBackend,
        private readonly logPerf: (line: string) => void,
        private readonly host: AnalysisHost = defaultHost,
    ) {}

    warmup(): void {
        this.backend.warmup();
    }

    async analyzeFiles(
        filePaths: string[],
        stftOptions?: StftOptions,
        titleOverride?: string,
        progressSink?: ProgressMessageSink,
        cancellable = true,
    ): Promise<AnalysisResultWithError[]> {
        return this.host.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: titleOverride ?? `Analyzing ${filePaths.length} files with wandas`,
                cancellable,
            },
            async (progress, token) => {
                const results: AnalysisResultWithError[] = [];
                for (let index = 0; index < filePaths.length; index++) {
                    if (token.isCancellationRequested) { throw new vscode.CancellationError(); }
                    const filePath = filePaths[index];
                    const fileName = path.basename(filePath);
                    progress.report({
                        increment: Math.floor(100 / filePaths.length),
                        message: `(${index + 1}/${filePaths.length}) ${fileName}`,
                    });
                    void progressSink?.postMessage({
                        type: 'analysis-file-progress',
                        current: index + 1,
                        total: filePaths.length,
                        fileName,
                    });
                    try {
                        results.push(await this.analyzeFile(filePath, stftOptions));
                    } catch (error) {
                        results.push({
                            filePath,
                            fileName,
                            sampleRateHz: 0,
                            durationSeconds: 0,
                            channelCount: 0,
                            sampleCount: 0,
                            channels: [],
                            analysisRevision: errorAnalysisRevision(error),
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                return results;
            },
        );
    }

    private async analyzeFile(filePath: string, stftOptions?: StftOptions): Promise<AnalysisResult> {
        const fileLabel = path.basename(filePath);
        const startedAt = Date.now();
        this.logPerf(`[ts] analyze start file=${fileLabel}`);
        try {
            const result = await this.backend.analyze(filePath, {
                peakCount: this.host.getDefaultPeakCount(),
                stftOptions,
            });
            this.logPerf(`[ts] analyze done  file=${fileLabel} total_ms=${Date.now() - startedAt}`);
            return result;
        } catch (error) {
            this.logPerf(`[ts] analyze fail  file=${fileLabel} total_ms=${Date.now() - startedAt}`);
            throw error;
        }
    }
}
