import { spawn } from 'child_process';

export interface CommandResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    duration: number;
}

export function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const childProcess = spawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });

        childProcess.stderr.on('data', (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });

        childProcess.on('error', (error) => {
            reject(error);
        });

        childProcess.on('close', (exitCode) => {
            resolve({
                exitCode,
                stdout,
                stderr,
                duration: Date.now() - start,
            });
        });
    });
}