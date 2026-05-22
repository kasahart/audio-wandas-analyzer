import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..', '..');
const snapshotPath = path.join(repoRoot, 'src', 'test', '__snapshots__', 'chartSpec.schema.json');
const backendDir = path.join(repoRoot, 'python-backend');

function findPython(): string | null {
    const candidates = [
        path.join(repoRoot, '.venv', 'bin', 'python'),
        path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
        process.env.WANDAS_PYTHON,
        'python3',
        'python',
    ].filter((p): p is string => typeof p === 'string' && p.length > 0);
    for (const c of candidates) {
        if (c === 'python3' || c === 'python') {
            const probe = spawnSync(c, ['--version'], { stdio: 'ignore' });
            if (probe.status === 0) { return c; }
            continue;
        }
        if (existsSync(c)) { return c; }
    }
    return null;
}

test('ChartSpec schema snapshot matches python-backend chart_spec.dump_schema()', () => {
    const py = findPython();
    if (py === null) {
        // No Python available — skip rather than fail. The hosted CI provides one.
        return;
    }
    const result = spawnSync(py, ['chart_spec.py'], {
        cwd: backendDir,
        encoding: 'utf-8',
        timeout: 30_000,
    });
    assert.equal(
        result.status,
        0,
        `python chart_spec.py exited with status ${result.status}.\n` +
            `stderr:\n${result.stderr}`,
    );
    const live = JSON.parse(result.stdout);
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    assert.deepEqual(
        live,
        snapshot,
        'ChartSpec JSON schema drifted from snapshot. ' +
            'If python-backend/chart_spec.py changed intentionally, ' +
            'regenerate snapshot:\n' +
            '  python python-backend/chart_spec.py > src/test/__snapshots__/chartSpec.schema.json',
    );
});
