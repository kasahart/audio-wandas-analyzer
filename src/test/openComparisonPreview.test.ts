import test from 'node:test';
import assert from 'node:assert/strict';

// We need to test the parseMode function, but it's not exported.
// We'll test it indirectly by running the module and checking error messages.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

function runOpenComparisonPreview(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve) => {
        const scriptPath = join(__dirname, '..', '..', 'dist', 'tools', 'openComparisonPreview.js');
        const child = spawn('node', [scriptPath, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (exitCode) => {
            resolve({ stdout, stderr, exitCode });
        });
    });
}

test('openComparisonPreview --mode with no value shows clear error', async () => {
    const { stderr, exitCode } = await runOpenComparisonPreview(['--mode']);
    
    assert.match(stderr, /--mode requires a value \(results \| selection\)/);
    assert.equal(exitCode, 1);
});

test('openComparisonPreview --mode followed by another flag shows clear error', async () => {
    const { stderr, exitCode } = await runOpenComparisonPreview(['--mode', '--other-flag']);
    
    assert.match(stderr, /--mode requires a value \(results \| selection\)/);
    assert.equal(exitCode, 1);
});

test('openComparisonPreview --mode invalid-value shows unknown mode error', async () => {
    const { stderr, exitCode } = await runOpenComparisonPreview(['--mode', 'invalid']);
    
    assert.match(stderr, /Unknown preview mode: invalid/);
    assert.equal(exitCode, 1);
});
