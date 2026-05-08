import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

interface PendingRequest {
    resolve: (result: { channels: unknown[] }) => void;
    reject: (err: Error) => void;
}

export class WaveformServer {
    private proc: ChildProcess | null = null;
    private pending = new Map<string, PendingRequest>();
    private lineBuf = '';
    private startPromise: Promise<void> | null = null;

    constructor(private readonly extensionPath: string) {}

    /** Pre-warm: start the server so the first range request is fast. */
    warmup(): void {
        void this.ensureRunning().catch(() => { /* startup failure is surfaced on first request */ });
    }

    async requestRange(
        filePath: string,
        startNorm: number,
        endNorm: number,
        points: number,
        requestId: string,
    ): Promise<{ channels: unknown[] }> {
        await this.ensureRunning();

        return new Promise<{ channels: unknown[] }>((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            const cmd = JSON.stringify({ cmd: 'range', requestId, filePath, startNorm, endNorm, points });
            this.proc!.stdin!.write(cmd + '\n');
        });
    }

    dispose(): void {
        this.proc?.kill();
        this.proc = null;
        this.rejectAll(new Error('WaveformServer disposed'));
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
            const scriptPath = path.join(this.extensionPath, 'python-backend', 'waveform_server.py');

            this.proc = spawn(pythonCommand, [scriptPath], {
                cwd: this.extensionPath,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            // Timeout if wandas takes too long to load
            const timeout = setTimeout(() => {
                reject(new Error('WaveformServer startup timed out'));
            }, 15_000);

            this.proc.stdout!.on('data', (chunk: Buffer | string) => {
                this.lineBuf += chunk.toString();
                const lines = this.lineBuf.split('\n');
                this.lineBuf = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.trim()) { continue; }
                    try {
                        const msg = JSON.parse(line) as Record<string, unknown>;

                        if (msg['type'] === 'ready') {
                            clearTimeout(timeout);
                            this.startPromise = null;
                            resolve();
                            continue;
                        }

                        if (typeof msg['requestId'] === 'string') {
                            const pending = this.pending.get(msg['requestId']);
                            if (pending) {
                                this.pending.delete(msg['requestId']);
                                if (typeof msg['error'] === 'string') {
                                    pending.reject(new Error(msg['error']));
                                } else {
                                    pending.resolve(msg as { channels: unknown[] });
                                }
                            }
                        }
                    } catch { /* ignore malformed JSON lines */ }
                }
            });

            this.proc.stderr!.on('data', () => { /* suppress Python tracebacks from UI */ });

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
                this.rejectAll(new Error('WaveformServer exited unexpectedly'));
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
