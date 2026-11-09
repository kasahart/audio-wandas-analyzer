import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { levelIdentityOf } from '../webview/runtime/comparePanes';

interface Side { unit: string; ref: number; label: string; status: string }
const CASES = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'levelIdentityCases.json'), 'utf8')) as Array<{ why: string; a: Side; b: Side; same: boolean }>;

/** python-backend/test_level_identity.py holds the backend's level_identity to the same table: the two cannot drift. */
test('levels compare only in one unit, reference and its label, whatever their calibration status: the webview answers the table the backend answers (R1, R4, A34)', () => {
    assert.ok(CASES.length >= 6);
    const of = (side: Side): string => levelIdentityOf({ unit: side.unit, ref: side.ref, levelReferenceLabel: side.label });
    for (const item of CASES) assert.equal(of(item.a) === of(item.b), item.same, item.why);
});
