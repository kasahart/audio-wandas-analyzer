/**
 * The webview's half of the spectrogram's shared test data: the `colour_range` and `cell_index` cases of
 * python-backend/tests/fixtures/figure_heatmap_cases.json, recorded from the code before the figure service (gone now)
 * and replayed here through the same
 * calls (helpers/figureHeatmapRun.ts). The backend's half is python-backend/test_figure_heatmap_cases.py; the figure
 * service's heatmap replays the same file (python-backend/test_figures_heatmap.py).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { jsonNumber, runColourRange, type CellIndexInput, type ColourRangeInput } from './helpers/figureHeatmapRun';

const repoRoot = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(repoRoot, 'python-backend', 'tests', 'fixtures', 'figure_heatmap_cases.json');

type Case<I> = { id: string; description: string; input: I; expected: unknown; source: string };
const TABLE = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { colour_range: Array<Case<ColourRangeInput>>; cell_index: Array<Case<CellIndexInput>> };

const FIX = 'This recorded case of python-backend/tests/fixtures/figure_heatmap_cases.json is no longer answered as it was. '
    + 'The file is the behaviour recorded before the figure service, kept as the heatmap\'s shared test data: the code that made it is gone, '
    + 'so fix the function; change a case only on purpose, by hand, with the case named in the stage\'s list of changed tests.';

const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === 'number' ? jsonNumber(item) : item)));

test('the webview\'s sections of the heatmap\'s recorded cases are there, each case with its id, description, input, expected and old-path source', () => {
    for (const section of ['colour_range', 'cell_index'] as const) {
        const cases: Array<Case<unknown>> = TABLE[section];
        assert.ok(cases.length > 0, `${section}: no case`);
        for (const item of cases) {
            assert.ok(item.id && item.description && item.input !== undefined && item.expected !== undefined, `${section}: ${item.id} is incomplete`);
            assert.match(item.source, /^old path: /u, `${section}: ${item.id} names no old-path source`);
        }
        assert.equal(new Set(cases.map(item => item.id)).size, cases.length, `${section}: ids repeat`);
    }
});

for (const item of TABLE.colour_range) {
    test(`heatmap colour range ${item.id}`, () => { assert.deepEqual(asJson(runColourRange(item.input)), item.expected, `${item.id}: ${item.description} ${FIX}`); });
}
