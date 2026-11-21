/**
 * The webview's half of the time signal's shared test data: the `amplitude_range` cases of
 * python-backend/tests/fixtures/figure_signal_cases.json, recorded from the code before the figure service (gone now)
 * and replayed here through the same call
 * (helpers/figureSignalRun.ts). The backend's half is python-backend/test_figure_signal_cases.py; the figure
 * service's time signal replays the same file (python-backend/test_figures_signal.py).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { type AmplitudeRangeInput } from './helpers/figureSignalRun';

const repoRoot = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(repoRoot, 'python-backend', 'tests', 'fixtures', 'figure_signal_cases.json');

type Case<I> = { id: string; description: string; input: I; expected: unknown; source: string };
const TABLE = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { amplitude_range: Array<Case<AmplitudeRangeInput>> };

test('the webview\'s section of the time signal\'s recorded cases is there, each case with its id, description, input, expected and old-path source', () => {
    const cases = TABLE.amplitude_range;
    assert.ok(cases.length > 0, 'amplitude_range: no case');
    for (const item of cases) {
        assert.ok(item.id && item.description && item.input !== undefined && item.expected !== undefined, `${item.id} is incomplete`);
        assert.match(item.source, /^old path: /u, `${item.id} names no old-path source`);
    }
    assert.equal(new Set(cases.map(item => item.id)).size, cases.length, 'ids repeat');
});

