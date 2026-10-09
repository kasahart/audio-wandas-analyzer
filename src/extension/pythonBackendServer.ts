import { AnalysisClient, analysisPayload, type AnalysisContextPolicy } from '../shared/analysis/analysisClient';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { createInterface } from 'node:readline';
import * as vscode from 'vscode';
import {
    backendStartupError,
    BackendStartupError,
    BackendStartupCancelledError,
    formatPythonImportTiming,
    processStdoutLine,
    waitForBackendStartup,
    type BackendDiagnostic,
    type PendingRequest,
} from './backendIpc';
import {
    parseBackendNotification,
    parseBackendResult,
    rejectPendingRequests,
    type AnalyzePayload,
    type BackendCommand,
    type BackendPayload,
    type BackendResult,
} from '../shared/protocol/backendProtocol';
import { resolveConfiguredPythonCommand } from './pythonEnvironment';

export type AnalyzeOptions = Omit<AnalyzePayload, 'filePath'>;

export class AnalysisRequestError extends Error {
    constructor(
        message: string,
        readonly analysisRevision: number,
        readonly backendStartupFailure = false,
    ) {
        super(message);
        this.name = 'AnalysisRequestError';
    }
}

export class PythonBackendServer extends AnalysisClient {
    private proc: ChildProcess | null = null;
    private pending = new Map<string, PendingRequest>();
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
        private readonly onReady: () => void = () => { /* no-op */ },
        contextPolicy?: AnalysisContextPolicy,
    ) { super(contextPolicy); }

    warmup(): Promise<void> {
        return this.ensureRunning();
    }

    async analyze(
        filePath: string,
        options: AnalyzeOptions,
        cancellation?: vscode.CancellationToken,
    ): Promise<BackendResult<'analyze'>> {
        return this.analyzeWithContext(filePath, options, async resolved => {
            try {
                return await this.request('analyze', analysisPayload(filePath, resolved), undefined, cancellation);
            } catch (error) {
                if (error instanceof BackendStartupCancelledError) {
                    throw new vscode.CancellationError();
                }
                throw new AnalysisRequestError(
                    error instanceof Error ? error.message : String(error),
                    resolved.analysisRevision ?? 0,
                    error instanceof BackendStartupError,
                );
            }
        });
    }

    dispose(): void {
        this.stopWatchdog();
        this.proc?.kill();
        this.proc = null;
        this.startPromise = null;
        this.rejectAll(new Error('PythonBackendServer disposed'));
    }

    protected async request<K extends BackendCommand>(
        command: K,
        payload: BackendPayload<K>,
        requestId?: string,
        cancellation?: vscode.CancellationToken,
    ): Promise<BackendResult<K>> {
        await waitForBackendStartup(this.ensureRunning(), cancellation);
        if (cancellation?.isCancellationRequested) {
            throw new BackendStartupCancelledError();
        }
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
            const importTimingEnabled = globalThis.process.env['AWA_IMPORT_TIME'] === '1';
            const pythonArgs = importTimingEnabled ? ['-X', 'importtime', scriptPath] : [scriptPath];
            const startupStartedAt = Date.now();

            this.onPerfLine(`[ts] backend spawn python=${pythonCommand} import_time=${importTimingEnabled ? 'on' : 'off'}`);
            const child = spawn(pythonCommand, pythonArgs, {
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
                if (this.proc === child) { this.startPromise = null; }
                reject(error);
            };

            const timeout = setTimeout(
                () => {
                    const error = backendStartupError(
                        `PythonBackendServer startup timed out after ${PythonBackendServer.STARTUP_TIMEOUT_MS / 1000} seconds`,
                        startupStderr,
                    );
                    failStartup(error);
                    if (this.proc === child) { this.proc = null; }
                    child.kill();
                },
                PythonBackendServer.STARTUP_TIMEOUT_MS,
            );

            const stdout = createInterface({ input: child.stdout!, crlfDelay: Infinity });
            stdout.on('line', (line: string) => {
                if (startupFinished) {
                    if (this.proc === child) {
                        processStdoutLine(line, this.pending, {
                            onNotification: (message) => {
                                if (message.type === 'heartbeat') { this.onHeartbeat(); }
                            },
                            onDiagnostic: (diagnostic) => { this.reportDiagnostic(diagnostic); },
                        });
                    }
                    return;
                }
                if (!line.trim()) { return; }
                let parsed: unknown;
                try {
                    parsed = JSON.parse(line);
                } catch {
                    this.reportDiagnostic({
                        kind: 'malformed-json',
                        message: 'Backend emitted malformed JSON during startup',
                        rawLine: line,
                    });
                    return;
                }
                const notification = parseBackendNotification(parsed);
                if (notification?.type !== 'ready') {
                    this.reportDiagnostic({
                        kind: 'unknown-notification',
                        message: 'Backend emitted an unexpected startup message',
                        rawLine: line,
                    });
                    return;
                }
                if (startupFinished || this.proc !== child) { return; }
                startupFinished = true;
                clearTimeout(timeout);
                this.startPromise = null;
                this.startWatchdog();
                this.onPerfLine(`[ts] backend ready total_ms=${Date.now() - startupStartedAt}`);
                this.onReady();
                resolve();
            });
            const stderr = createInterface({ input: child.stderr!, crlfDelay: Infinity });
            stderr.on('line', (line: string) => {
                if (!startupFinished) { startupStderr += line + '\n'; }
                if (line.startsWith('[perf]')) {
                    this.onPerfLine(line);
                } else if (importTimingEnabled) {
                    const importTiming = formatPythonImportTiming(line);
                    if (importTiming) { this.onPerfLine(importTiming); }
                }
            });

            child.on('error', (err) => {
                const error = startupFinished
                    ? new Error(`Python backend process error (${pythonCommand}): ${err.message}`)
                    : backendStartupError(`Failed to start Python backend (${pythonCommand}): ${err.message}`, startupStderr);
                const wasCurrent = this.proc === child;
                failStartup(error);
                if (wasCurrent) {
                    this.proc = null;
                    this.rejectAll(error);
                }
            });

            child.on('exit', (code, signal) => {
                stdout.close();
                stderr.close();
                const wasCurrent = this.proc === child;
                const suffix = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
                const error = startupFinished
                    ? new Error(`PythonBackendServer exited unexpectedly (${suffix})`)
                    : backendStartupError(`Python backend exited before ready (${suffix})`, startupStderr);
                failStartup(error);
                if (wasCurrent) {
                    this.stopWatchdog();
                    this.proc = null;
                    this.startPromise = null;
                    this.rejectAll(error);
                }
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
                const child = this.proc;
                const error = new Error('Python backend heartbeat timed out');
                this.stopWatchdog();
                this.proc = null;
                this.startPromise = null;
                this.rejectAll(error);
                child?.kill();
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
