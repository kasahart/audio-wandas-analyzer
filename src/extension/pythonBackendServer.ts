import { AnalysisClient, analysisPayload, type AnalysisContextPolicy, type AnalyzeOptions } from '../shared/analysis/analysisClient';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { createInterface } from 'node:readline';
import * as vscode from 'vscode';
import {
    backendStartupError,
    BackendRequestCancelledError,
    BackendStartupError,
    BackendStartupCancelledError,
    formatPythonImportTiming,
    processStdoutLine,
    StderrLineSplitter,
    StderrTail,
    waitForBackendStartup,
    type BackendDiagnostic,
} from './backendIpc';
import {
    parseBackendNotification,
    parseBackendResult,
    PendingBackendRequests,
    rejectPendingRequests,
    type BackendCommand,
    type BackendPayload,
    type BackendResult,
} from '../shared/protocol/backendProtocol';
import type { BackendCancelControl } from '../shared/protocol/generated/backendProtocolSchema';
import { getPythonCommand, resolveConfiguredPythonCommand } from './pythonEnvironment';
import { AnalysisRequestError } from './analysisRequestError';

export { AnalysisRequestError };

/** The backend was killed to stop one request; the others it held are sent again to its successor. */
class BackendRestartReplayError extends Error {}

export class BackendRequestTimeoutError extends Error {
    constructor(command: BackendCommand, ms: number) {
        super(`Python backend ${command} request timed out after ${ms / 1000} seconds`);
        this.name = 'BackendRequestTimeoutError';
    }
}

export interface BackendServerEvents {
    /** Python's stderr (other than `[perf]` lines) and the host's own diagnostics about the backend. */
    log?(line: string): void;
    /** The backend died after it was ready; `error` carries the end of its stderr. */
    crashed?(error: Error): void;
}

export class PythonBackendServer extends AnalysisClient {
    private proc: ChildProcess | null = null;
    private pending = new PendingBackendRequests<Record<string, unknown>, BackendCommand>('r');
    private startPromise: Promise<void> | null = null;
    private disposalGeneration = 0;
    private lastHeartbeatAt = 0;
    private watchdogTimer: ReturnType<typeof setInterval> | null = null;
    /** Requests given up on whose reply may still be on its way; it is dropped rather than reported as an orphan. */
    private readonly abandoned = new Set<string>();
    private readyAt = 0;
    private crashes = 0;
    private restartNotBefore = 0;
    private static readonly HEARTBEAT_TIMEOUT_MS = 15_000;
    private static readonly WATCHDOG_INTERVAL_MS = 5_000;
    private static readonly STARTUP_TIMEOUT_MS = 120_000;
    private static readonly ABANDONED_LIMIT = 256;
    private static readonly RESTART_BACKOFF_MS = 1_000;
    private static readonly RESTART_BACKOFF_MAX_MS = 30_000;
    /** A backend that ran this long before dying starts the backoff over. */
    private static readonly STABLE_RUN_MS = 60_000;

    /** How long each command may take before the backend is presumed stuck and restarted; 0 leaves it to the caller. */
    protected requestTimeoutsMs: Record<BackendCommand, number> = {
        analyze: 600_000,
        range: 60_000,
        'track-detail': 300_000,
        'release-track-detail': 60_000,
        'spectrum-slice': 60_000,
        'pair-spectrum': 300_000,
        'export-wav-loop': 300_000,
        // AnalysisClient.runRecipe times the Recipe out itself.
        'run-recipe': 0,
        'build-recipe': 120_000,
        scan: 300_000,
    };

    constructor(
        private readonly extensionPath: string,
        private readonly onPerfLine: (line: string) => void = () => { /* no-op */ },
        private readonly onReady: () => void = () => { /* no-op */ },
        contextPolicy?: AnalysisContextPolicy,
        private readonly events: BackendServerEvents = {},
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
                if (error instanceof BackendStartupCancelledError || error instanceof BackendRequestCancelledError) {
                    throw new vscode.CancellationError();
                }
                throw new AnalysisRequestError(
                    error instanceof Error ? error.message : String(error),
                    resolved.analysisRevision ?? 0,
                    error instanceof BackendStartupError,
                    { cause: error },
                );
            }
        });
    }

    dispose(): void {
        this.disposalGeneration++;
        this.stopWatchdog();
        this.proc?.kill();
        this.proc = null;
        this.startPromise = null;
        this.crashes = 0;
        this.restartNotBefore = 0;
        this.rejectAll(new Error('PythonBackendServer disposed'));
    }

    /** Stops a request Python may be stuck in: kills the backend and sends its other requests to a fresh one. */
    protected override cancelRequest(requestId: string, reason: Error): void {
        const cancelled = this.pending.get(requestId);
        if (!cancelled) return;
        this.pending.delete(requestId);
        const child = this.proc;
        this.stopWatchdog();
        this.proc = null;
        this.startPromise = null;
        cancelled.reject(reason);
        this.rejectAll(new BackendRestartReplayError('Python backend restarting after an interrupted request'));
        child?.kill();
    }

    /** Gives up on a request without a restart: Python drops it if queued and sends no reply if running. */
    private abandon(requestId: string, reason: Error): void {
        const abandoned = this.pending.get(requestId);
        if (!abandoned) return;
        this.pending.delete(requestId);
        abandoned.reject(reason);
        this.abandoned.add(requestId);
        if (this.abandoned.size > PythonBackendServer.ABANDONED_LIMIT) {
            this.abandoned.delete(this.abandoned.values().next().value!);
        }
        const control: BackendCancelControl = { cmd: 'cancel', requestIds: [requestId] };
        // Without a backend there is nothing left to stop.
        if (this.proc?.stdin?.writable) { this.writeLine(control); }
    }

    private writeLine(message: object): void {
        const stdin = this.proc?.stdin;
        if (!stdin || !stdin.writable) {
            throw new Error('Python backend is not running');
        }
        stdin.write(JSON.stringify(message) + '\n');
    }

    protected async request<K extends BackendCommand>(
        command: K,
        payload: BackendPayload<K>,
        requestId?: string,
        cancellation?: vscode.CancellationToken,
    ): Promise<BackendResult<K>> {
        const generation = this.disposalGeneration;
        await waitForBackendStartup(this.ensureRunning(), cancellation);
        if (cancellation?.isCancellationRequested) {
            throw new BackendStartupCancelledError();
        }
        const id = requestId ?? this.pending.nextId();
        const reply = this.pending.dispatch(command, id, response => parseBackendResult(command, response), () => {
            this.writeLine({ cmd: command, requestId: id, ...payload });
        });
        const entry = this.pending.get(id);
        const ownsId = (): boolean => entry !== undefined && this.pending.get(id) === entry;
        const timeoutMs = this.requestTimeoutsMs[command];
        const timer = timeoutMs > 0 && entry
            ? setTimeout(() => { if (ownsId()) this.cancelRequest(id, new BackendRequestTimeoutError(command, timeoutMs)); }, timeoutMs)
            : undefined;
        const subscription = entry && cancellation?.onCancellationRequested(() => {
            if (ownsId()) this.abandon(id, new BackendRequestCancelledError(command));
        });
        try {
            return await reply;
        } catch (error) {
            if (error instanceof BackendRestartReplayError && generation === this.disposalGeneration) {
                return this.request(command, payload, requestId, cancellation);
            }
            throw error;
        } finally {
            clearTimeout(timer);
            subscription?.dispose();
        }
    }

    private ensureRunning(): Promise<void> {
        if (this.startPromise) {
            return this.startPromise;
        }
        if (this.proc && !this.proc.killed) {
            return Promise.resolve();
        }
        const backoff = this.restartNotBefore - Date.now();
        this.startPromise = backoff > 0 ? this.startAfter(backoff) : this.startServer();
        return this.startPromise;
    }

    private async startAfter(delayMs: number): Promise<void> {
        const generation = this.disposalGeneration;
        this.events.log?.(`[ts] backend restart in ${delayMs} ms after ${this.crashes} crash(es)`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        if (generation !== this.disposalGeneration) {
            throw new Error('PythonBackendServer disposed');
        }
        return this.startServer();
    }

    /** Spaces out restarts of a backend that keeps dying, so a crash loop does not spin the CPU. */
    private noteCrash(): void {
        if (Date.now() - this.readyAt > PythonBackendServer.STABLE_RUN_MS) { this.crashes = 0; }
        this.crashes++;
        this.restartNotBefore = Date.now() + Math.min(
            PythonBackendServer.RESTART_BACKOFF_MAX_MS,
            PythonBackendServer.RESTART_BACKOFF_MS * 2 ** (this.crashes - 1),
        );
    }

    private startServer(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
            const pythonCommand = resolveConfiguredPythonCommand(getPythonCommand());
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
                    // AWA_PERF_LOG is inherited; perf.py logs unless it is '0'.
                },
            });
            this.proc = child;
            this.abandoned.clear();
            // EPIPE when the process dies with a write in flight; 'close' reports the exit itself.
            child.stdin.on('error', (err) => { this.events.log?.(`[ts] backend stdin error: ${err.message}`); });

            let startupFinished = false;
            let startupStderr = '';
            const stderrTail = new StderrTail();
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

            const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
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
                this.readyAt = Date.now();
                this.startWatchdog();
                this.onPerfLine(`[ts] backend ready total_ms=${Date.now() - startupStartedAt}`);
                this.onReady();
                resolve();
            });
            const handleStderrLine = (line: string): void => {
                if (!startupFinished) { startupStderr += line + '\n'; }
                if (line.startsWith('[perf]')) {
                    this.onPerfLine(line);
                    return;
                }
                const importTiming = importTimingEnabled ? formatPythonImportTiming(line) : null;
                if (importTiming) {
                    this.onPerfLine(importTiming);
                } else if (!importTimingEnabled || !line.startsWith('import time:')) {
                    stderrTail.push(line);
                    this.events.log?.(line);
                }
            };
            const stderrLines = new StderrLineSplitter();
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk: string) => { stderrLines.push(chunk).forEach(handleStderrLine); });
            const flushStderr = (): void => {
                const tail = stderrLines.flush();
                if (tail !== null) { handleStderrLine(tail); }
            };

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

            // 'close' waits for the stdio streams, so stderr written just before exit reaches the diagnostic.
            child.on('close', (code, signal) => {
                stdout.close();
                flushStderr();
                const wasCurrent = this.proc === child;
                const suffix = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
                const crashed = startupFinished && wasCurrent;
                const tail = stderrTail.text();
                const error = startupFinished
                    ? new Error(`PythonBackendServer exited unexpectedly (${suffix})${tail ? `:\n${tail}` : ''}`)
                    : backendStartupError(`Python backend exited before ready (${suffix})`, startupStderr);
                failStartup(error);
                if (wasCurrent) {
                    this.stopWatchdog();
                    this.proc = null;
                    this.startPromise = null;
                    this.rejectAll(error);
                }
                if (crashed) {
                    this.noteCrash();
                    this.events.crashed?.(error);
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
                this.events.log?.('[watchdog] heartbeat timeout — restarting backend');
                const child = this.proc;
                const error = new Error('Python backend heartbeat timed out');
                this.noteCrash();
                this.events.crashed?.(error);
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
        if (diagnostic.kind === 'orphan-response' && diagnostic.requestId && this.abandoned.delete(diagnostic.requestId)) {
            return;
        }
        const request = diagnostic.requestId ? ` requestId=${diagnostic.requestId}` : '';
        this.events.log?.(`[protocol:${diagnostic.kind}]${request} ${diagnostic.message}`);
    }

    private rejectAll(err: Error): void {
        rejectPendingRequests(this.pending, err);
    }
}
