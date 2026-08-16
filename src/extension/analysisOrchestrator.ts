import * as path from 'path';
import * as vscode from 'vscode';
import type { AnalysisResult, AnalysisResultWithError, StftOptions } from '../shared/analysis/analysisTypes';
import type { AnalyzeOptions } from './pythonBackendServer';

export interface AnalysisBackend {
    analyze(
        filePath: string,
        options: AnalyzeOptions,
        cancellation?: vscode.CancellationToken,
    ): Promise<AnalysisResult>;
    warmup(): Promise<void>;
}

export interface ProgressMessageSink {
    postMessage(message: unknown): Thenable<boolean>;
}

export interface AnalysisHost {
    withProgress<T>(
        options: vscode.ProgressOptions,
        task: (
            progress: vscode.Progress<{ message?: string; increment?: number }>,
            token: vscode.CancellationToken,
        ) => Thenable<T>,
    ): Thenable<T>;
}

const defaultHost: AnalysisHost = {
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
        void this.backend.warmup().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logPerf(`[ts] backend warmup failed error=${message}`);
        });
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
                        results.push(await this.analyzeFile(filePath, stftOptions, cancellable ? token : undefined));
                    } catch (error) {
                        if (error instanceof vscode.CancellationError) { throw error; }
                        const message = error instanceof Error ? error.message : String(error);
                        results.push(this.errorResult(filePath, message, errorAnalysisRevision(error)));
                        if (this.isBackendStartupFailure(error)) {
                            for (const skippedPath of filePaths.slice(index + 1)) {
                                results.push(this.errorResult(skippedPath, message, errorAnalysisRevision(error)));
                            }
                            break;
                        }
                    }
                }
                return results;
            },
        );
    }

    private isBackendStartupFailure(error: unknown): boolean {
        return Boolean(error && typeof error === 'object'
            && (error as { backendStartupFailure?: unknown }).backendStartupFailure === true);
    }

    private errorResult(filePath: string, message: string, analysisRevision: number): AnalysisResultWithError {
        return {
            filePath,
            fileName: path.basename(filePath),
            sampleRateHz: 0,
            durationSeconds: 0,
            channelCount: 0,
            sampleCount: 0,
            channels: [],
            analysisRevision,
            error: message,
        };
    }

    private async analyzeFile(
        filePath: string,
        stftOptions?: StftOptions,
        cancellation?: vscode.CancellationToken,
    ): Promise<AnalysisResult> {
        const fileLabel = path.basename(filePath);
        const startedAt = Date.now();
        this.logPerf(`[ts] analyze start file=${fileLabel}`);
        try {
            const result = await this.backend.analyze(filePath, {
                stftOptions,
            }, cancellation);
            this.logPerf(`[ts] analyze done  file=${fileLabel} total_ms=${Date.now() - startedAt}`);
            return result;
        } catch (error) {
            this.logPerf(`[ts] analyze fail  file=${fileLabel} total_ms=${Date.now() - startedAt}`);
            throw error;
        }
    }
}
