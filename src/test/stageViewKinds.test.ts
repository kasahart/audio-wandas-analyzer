import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isCharted } from '../shared/recipe/recipeCatalog';
import { reachableFrameKinds } from './helpers/frameKinds';

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'stageViewKinds.json'), 'utf8')) as Record<string, { frame: string; kind: string }>;

test('every Frame kind a step from ＋ can give that the app draws has its backend picture in the fixture the plot contract is run on (R7)', () => {
    const drawn = [...reachableFrameKinds().keys()].filter(isCharted).sort();
    assert.deepEqual(Object.keys(fixture).sort(), drawn, 'Rule: every Frame kind a step from ＋ can give and the app draws has its backend picture in src/test/fixtures/stageViewKinds.json, so the plot contract draws it. Fix: add the kind to _kinds in python-backend/test_stage_view_kinds.py and run `python python-backend/test_stage_view_kinds.py --write` (docs/plot-layers.md, "Adding a new Frame kind", step 4).');
    for (const [kind, view] of Object.entries(fixture)) {
        assert.equal(view.frame, kind);
        assert.ok(['line', 'bar', 'heatmap'].includes(view.kind), `${kind} is drawn`);
    }
});
