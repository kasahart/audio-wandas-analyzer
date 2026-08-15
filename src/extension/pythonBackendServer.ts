import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    backendStartupError,
    processStdoutChunk,
    rejectPendingRequests,
    type BackendDiagnostic,
    type PendingRequest,
} from './backendIpc';
import {
    parseBackendNotification,
    parseBackendResult,
    type AnalyzePayload,
    type BackendCommand,
    type BackendPayload,
    type BackendResult,
    type CalibrationRequestContext,
    type ExportWavLoopResult,
    type RangeResult,
    type SpectrumSlicePayload,
    type SpectrumSliceResult,
    type TrackDetailPayload,
    type TrackDetailResult,
} from './backendProtocol';
import { resolveConfiguredPythonCommand } from './pythonEnvironment';

export type AnalyzeOptions = Omit<AnalyzePayload, 'filePath'>;

export class AnalysisRequestError extends Error {
    constructor(message: string, readonly analysisRevision: number) {
        super(message);
        this.name = 'AnalysisRequestError';
    }
}

export class PythonBackendServer {
    private proc: ChildProcess | null = null;
    private pending = new Map<string, PendingRequest>();
    private stdoutBuf = { value: '' };
    private stderrBuf = '';
    private startPromise: Promise<void> | null = null;
    private nextId = 1;
    private lastHeartbeatAt = 0;
    private watchdogTimer: ReturnType<typeof setInterval> | null = null;
    private static readonly HEARTBEAT_TIMEOUT_MS = 15_000;
    private static readonly WATCHDOG_INTERVAL_MS = 5_000;
    private static readonly STARTUP_TIMEOUT_MS = 120_000;

    constructor(
        private readonly extensionPath: string,
        private readonly onPerfLine: (line: string) => void = () => { /* no-op */ },
    ) {}

    warmup(): void {
        void this.ensureRunning().catch(() => { /* surfaced on first request */ });
    }

    async analyze(filePath: string, options: AnalyzeOptions): Promise<BackendResult<'analyze'>> {
        const analysisRevision = options.analysisRevision ?? 0;
        try {
            return await this.request('analyze', {
                filePath,
                ...(options.stftOptions ? { stftOptions: options.stftOptions } : {}),
                ...this.calibrationPayload(options),
            });
        } catch (error) {
            throw new AnalysisRequestError(
                error instanceof Error ? error.message : String(error),
                analysisRevision,
            );
        }
    }

    async requestRange(
        filePath: string,
        startNorm: number,
        endNorm: number,
        points: number,
        requestId?: string,
        calibration: CalibrationRequestContext = {},
    ): Promise<RangeResult> {
        return this.request(
            'range',
            { filePath, startNorm, endNorm, points, ...this.calibrationPayload(calibration) },
            requestId,
        );
    }

    async requestTrackDetail(
        filePath: string,
        payload: Omit<TrackDetailPayload, 'filePath'>,
        requestId: string,
    ): Promise<TrackDetailResult> {
        return this.request(
            'track-detail',
            {
                filePath,
                trackIndex: payload.trackIndex,
                analysisId: payload.analysisId,
                settingsSignature: payload.settingsSignature,
                ...(payload.stftOptions ? { stftOptions: payload.stftOptions } : {}),
                ...this.calibrationPayload(payload),
            },
            requestId,
        );
    }

    async releaseTrackDetail(filePath: string): Promise<void> {
        await this.request('release-track-detail', { filePath });
    }

    async requestSpectrumSlice(
        filePath: string,
        payload: Omit<SpectrumSlicePayload, 'filePath'>,
        requestId: string,
    ): Promise<SpectrumSliceResult> {
        return this.request(
            'spectrum-slice',
            {
                filePath,
                trackIndex: payload.trackIndex,
                analysisId: payload.analysisId,
                settingsSignature: payload.settingsSignature,
                cursorNorm: payload.cursorNorm,
                ...(payload.stftOptions ? { stftOptions: payload.stftOptions } : {}),
                ...this.calibrationPayload(payload),
            },
            requestId,
        );
    }

    async exportWavLoop(
        filePath: string,
        startNorm: number,
        endNorm: number,
    ): Promise<ExportWavLoopResult> {
        return this.request(
            'export-wav-loop',
            { filePath, startNorm, endNorm },
        );
    }

    dispose(): void {
        this.stopWatchdog();
        this.proc?.kill();
        this.proc = null;
        this.rejectAll(new Error('PythonBackendServer disposed'));
    }

    private calibrationPayload(context: CalibrationRequestContext): CalibrationRequestContext {
        return {
            ...(context.calibrationProfile ? { calibrationProfile: context.calibrationProfile } : {}),
            analysisRevision: context.analysisRevision ?? 0,
        };
    }

    private async request<K extends BackendCommand>(
        command: K,
        payload: BackendPayload<K>,
        requestId?: string,
    ): Promise<BackendResult<K>> {
        await this.ensureRunning();
        const id = requestId ?? `r${this.nextId++}`;
        return new Promise<BackendResult<K>>((resolve, reject) => {
            this.pending.set(id, {
                command,
                complete: (response) => { resolve(parseBackendResult(command, response)); },
                reject,
            });
            try {
                const line = JSON.stringify({ cmd: command, requestId: id, ...payload });
                this.proc!.stdin!.write(line + '\n');
            } catch (error) {
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private ensureRunning(): Promise<void> {
        if (this.startPromise) {
            return this.startPromise;
        }
        if (this.proc && !this.proc.killed) {
            return Promise.resolve();
        }
        this.startPromise = this.startServer();
        return this.startPromise;
    }

    private startServer(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
            const pythonCommand = resolveConfiguredPythonCommand(config.get<string>('pythonCommand', 'python3'));
            const cacheMb = Math.max(64, config.get<number>('cacheMemoryMb', 1024));
            const scriptPath = path.join(this.extensionPath, 'python-backend', 'backend_server.py');

            this.stdoutBuf.value = '';
            this.stderrBuf = '';
            const child = spawn(pythonCommand, [scriptPath], {
                cwd: this.extensionPath,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...globalThis.process.env,
                    AWA_CACHE_MB: String(cacheMb),
                    // AWA_PERF_LOG: inherit from env (default '0' = opt-in)
                },
            });
            this.proc = child;

            let startupFinished = false;
            let startupStderr = '';
            const failStartup = (error: Error): void => {
                if (startupFinished) { return; }
                startupFinished = true;
                clearTimeout(timeout);
                this.startPromise = null;
                reject(error);
            };

            const timeout = setTimeout(
                () => {
                    const error = backendStartupError(
                        `PythonBackendServer startup timed out after ${PythonBackendServer.STARTUP_TIMEOUT_MS / 1000} seconds`,
                        startupStderr,
                    );
                    if (this.proc === child) { this.proc = null; }
                    failStartup(error);
                    child.kill();
                },
                PythonBackendServer.STARTUP_TIMEOUT_MS,
            );

            const handleReadyOrLine = (chunk: Buffer | string): void => {
                this.stdoutBuf.value += chunk.toString();
                const lines = this.stdoutBuf.value.split('\n');
                this.stdoutBuf.value = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) { continue; }
                    let parsed: unknown;
                    try {
                        parsed = JSON.parse(line);
                    } catch {
                        this.reportDiagnostic({
                            kind: 'malformed-json',
                            message: 'Backend emitted malformed JSON during startup',
                            rawLine: line,
                        });
                        continue;
                    }
                    const notification = parseBackendNotification(parsed);
                    if (notification?.type !== 'ready') {
                        this.reportDiagnostic({
                            kind: 'unknown-notification',
                            message: 'Backend emitted an unexpected startup message',
                            rawLine: line,
                        });
                        continue;
                    }
                    if (startupFinished || this.proc !== child) { return; }
                    startupFinished = true;
                    clearTimeout(timeout);
                    this.startPromise = null;
                    child.stdout!.off('data', handleReadyOrLine);
                    child.stdout!.on('data', (data: Buffer | string) => {
                        processStdoutChunk(this.stdoutBuf, data.toString(), this.pending, {
                            onNotification: (message) => {
                                if (message.type === 'heartbeat') { this.onHeartbeat(); }
                            },
                            onDiagnostic: (diagnostic) => { this.reportDiagnostic(diagnostic); },
                        });
                    });
                    this.startWatchdog();
                    resolve();
                    return;
                }
            };
            child.stdout!.on('data', handleReadyOrLine);

            child.stderr!.on('data', (chunk: Buffer | string) => {
                const text = chunk.toString();
                if (!startupFinished) { startupStderr += text; }
                this.stderrBuf += text;
                const lines = this.stderrBuf.split('\n');
                this.stderrBuf = lines.pop() ?? '';
                for (const line of lines) {
                    if (line.startsWith('[perf]')) {
                        this.onPerfLine(line);
                    }
                }
            });

            child.on('error', (err) => {
                const error = backendStartupError(`Failed to start Python backend (${pythonCommand}): ${err.message}`, startupStderr);
                if (this.proc === child) { this.proc = null; }
                failStartup(error);
                this.rejectAll(error);
            });

            child.on('exit', (code, signal) => {
                const suffix = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
                const error = backendStartupError(
                    startupFinished
                        ? `PythonBackendServer exited unexpectedly (${suffix})`
                        : `Python backend exited before ready (${suffix})`,
                    startupStderr,
                );
                failStartup(error);
                this.stopWatchdog();
                if (this.proc === child) { this.proc = null; }
                this.startPromise = null;
                this.rejectAll(error);
            });
        });
    }

    private startWatchdog(): void {
        this.lastHeartbeatAt = Date.now();
        if (this.watchdogTimer) { return; }
        this.watchdogTimer = setInterval(() => {
            const elapsed = Date.now() - this.lastHeartbeatAt;
            if (elapsed > PythonBackendServer.HEARTBEAT_TIMEOUT_MS) {
                this.onPerfLine('[watchdog] heartbeat timeout — restarting backend');
                this.proc?.kill();
                this.proc = null;
                this.startPromise = null;
                void this.ensureRunning().catch(() => { /* surfaced on next request */ });
            }
        }, PythonBackendServer.WATCHDOG_INTERVAL_MS);
    }

    private stopWatchdog(): void {
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    private onHeartbeat(): void {
        this.lastHeartbeatAt = Date.now();
    }

    private reportDiagnostic(diagnostic: BackendDiagnostic): void {
        const request = diagnostic.requestId ? ` requestId=${diagnostic.requestId}` : '';
        this.onPerfLine(`[protocol:${diagnostic.kind}]${request} ${diagnostic.message}`);
    }

    private rejectAll(err: Error): void {
        rejectPendingRequests(this.pending, err);
    }
}
