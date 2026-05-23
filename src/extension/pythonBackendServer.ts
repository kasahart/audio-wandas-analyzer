import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { processStdoutChunk, type PendingRequest } from './backendIpc';

export interface AnalyzeStftOptions {
    nFft: number;
    hopSize: number;
    window: string;
}

export interface AnalyzeOptions {
    peakCount: number;
    stftOptions?: AnalyzeStftOptions;
}

export class PythonBackendServer {
    private proc: ChildProcess | null = null;
    private pending = new Map<string, PendingRequest>();
    private stdoutBuf = { value: '' };
    private stderrBuf = '';
    private startPromise: Promise<void> | null = null;
    private nextId = 1;

    constructor(
        private readonly extensionPath: string,
        private readonly onPerfLine: (line: string) => void = () => { /* no-op */ },
    ) {}

    warmup(): void {
        void this.ensureRunning().catch(() => { /* surfaced on first request */ });
    }

    async analyze(filePath: string, options: AnalyzeOptions): Promise<unknown> {
        return this.request('analyze', {
            filePath,
            peakCount: options.peakCount,
            ...(options.stftOptions ? { stftOptions: options.stftOptions } : {}),
        });
    }

    async requestRange(
        filePath: string,
        startNorm: number,
        endNorm: number,
        points: number,
        requestId?: string,
    ): Promise<{ channels: unknown[] }> {
        return this.request(
            'range',
            { filePath, startNorm, endNorm, points },
            requestId,
        ) as Promise<{ channels: unknown[] }>;
    }

    dispose(): void {
        this.proc?.kill();
        this.proc = null;
        this.rejectAll(new Error('PythonBackendServer disposed'));
    }

    private async request(cmd: string, payload: Record<string, unknown>, requestId?: string): Promise<unknown> {
        await this.ensureRunning();
        const id = requestId ?? `r${this.nextId++}`;
        return new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            const line = JSON.stringify({ cmd, requestId: id, ...payload });
            this.proc!.stdin!.write(line + '\n');
        });
    }

    private ensureRunning(): Promise<void> {
        if (this.proc && !this.proc.killed) {
            return Promise.resolve();
        }
        if (!this.startPromise) {
            this.startPromise = this.startServer();
        }
        return this.startPromise;
    }

    private startServer(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
            const pythonCommand = config.get<string>('pythonCommand', 'python3');
            const cacheMb = Math.max(64, config.get<number>('cacheMemoryMb', 1024));
            const scriptPath = path.join(this.extensionPath, 'python-backend', 'backend_server.py');

            this.proc = spawn(pythonCommand, [scriptPath], {
                cwd: this.extensionPath,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...globalThis.process.env,
                    AWA_CACHE_MB: String(cacheMb),
                    // AWA_PERF_LOG: inherit from env (default '0' = opt-in)
                },
            });

            const timeout = setTimeout(
                () => reject(new Error('PythonBackendServer startup timed out')),
                30_000,
            );

            const handleReadyOrLine = (chunk: Buffer | string): void => {
                this.stdoutBuf.value += chunk.toString();
                const lines = this.stdoutBuf.value.split('\n');
                this.stdoutBuf.value = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) { continue; }
                    try {
                        const msg = JSON.parse(line) as Record<string, unknown>;
                        if (msg['type'] === 'ready') {
                            clearTimeout(timeout);
                            this.startPromise = null;
                            this.proc!.stdout!.off('data', handleReadyOrLine);
                            this.proc!.stdout!.on('data', (c: Buffer | string) => {
                                processStdoutChunk(this.stdoutBuf, c.toString(), this.pending);
                            });
                            resolve();
                            return;
                        }
                    } catch { /* ignore */ }
                }
            };
            this.proc.stdout!.on('data', handleReadyOrLine);

            this.proc.stderr!.on('data', (chunk: Buffer | string) => {
                this.stderrBuf += chunk.toString();
                const lines = this.stderrBuf.split('\n');
                this.stderrBuf = lines.pop() ?? '';
                for (const line of lines) {
                    if (line.startsWith('[perf]')) {
                        this.onPerfLine(line);
                    }
                }
            });

            this.proc.on('error', (err) => {
                clearTimeout(timeout);
                this.proc = null;
                this.startPromise = null;
                this.rejectAll(err);
                reject(err);
            });

            this.proc.on('exit', () => {
                clearTimeout(timeout);
                this.proc = null;
                this.startPromise = null;
                this.rejectAll(new Error('PythonBackendServer exited unexpectedly'));
            });
        });
    }

    private rejectAll(err: Error): void {
        for (const p of this.pending.values()) {
            p.reject(err);
        }
        this.pending.clear();
    }
}
