import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { namedTest, testProblem } from './namedTest';

const repoRoot = path.resolve(__dirname, '..', '..');
const rulesPath = path.join(repoRoot, 'docs', 'display-rules.md');

interface Rule { id: string; tests: Array<{ file: string; name: string }>; pending: boolean }

function rules(): Rule[] {
    const found: Rule[] = [];
    for (const line of readFileSync(rulesPath, 'utf8').split('\n')) {
        const heading = /^## (R\d+) /.exec(line);
        if (heading) {
            found.push({ id: heading[1], tests: [], pending: false });
            continue;
        }
        const rule = found[found.length - 1];
        const listed = /^- テスト: `([^`]+)` › (.+)$/.exec(line);
        if (rule && listed) rule.tests.push({ file: listed[1], name: listed[2].trim() });
        if (rule && line.startsWith('- 未: ')) rule.pending = true;
    }
    return found;
}

test('every display rule is numbered in order and names at least one test', () => {
    const found = rules();
    assert.ok(found.length > 0);
    found.forEach((rule, index) => {
        assert.equal(rule.id, `R${index + 1}`);
        assert.ok(rule.tests.length > 0, `${rule.id} names no test`);
    });
});

test('every test a display rule names exists under that name', () => {
    for (const rule of rules()) {
        for (const { file, name } of rule.tests) {
            const source = path.join(repoRoot, file);
            assert.ok(existsSync(source), `${rule.id}: ${file} does not exist`);
            // A pytest name is a def; a node:test or Playwright name is a whole quoted title (quotes may be escaped).
            assert.ok(namedTest(file, readFileSync(source, 'utf8'), name), `${rule.id}: "${name}" is not a test in ${file}`);
        }
    }
});

/** A rule's test checks it (namedTest.ts testProblem): it runs, and its body asserts something. */
test('every test a display rule names runs and asserts something', () => {
    for (const rule of rules()) {
        for (const { file, name } of rule.tests) {
            const text = readFileSync(path.join(repoRoot, file), 'utf8');
            if (!namedTest(file, text, name)) continue;
            const problem = testProblem(file, text, name);
            assert.equal(problem, null, `${rule.id}: ${problem}`);
        }
    }
});

test('a named test\'s body ends where its own call or def does, at any indent, so a later test\'s assertion is not its', () => {
    const ts = ["describe('group', () => {", "    test('empty', () => {", '        const x = 1;', '    });', "    test('checks', () => {", '        assert.equal(1, 1);', '    });', '});'].join('\n');
    assert.doesNotMatch(namedTest('a.test.ts', ts, 'empty')!.body, /assert/);
    assert.match(namedTest('a.test.ts', ts, 'checks')!.body, /assert\.equal/);
    const py = ['class TestGroup:', '    async def test_empty(', '        self,', '    ) -> None:', '        x = 1', '', '    def test_checks(self) -> None:', '        assert 1 == 1', ''].join('\n');
    assert.doesNotMatch(namedTest('test_a.py', py, 'test_empty')!.body, /assert/);
    assert.match(namedTest('test_a.py', py, 'test_checks')!.body, /assert 1 == 1/);
});

/** Every rule's screens and Frame kinds are reached by its tests: a rule is never left marked 未 (not yet checked). */
test('no display rule is marked 未: each is checked on every screen and Frame kind it names', () => {
    assert.deepEqual(rules().filter(rule => rule.pending).map(rule => rule.id), [], 'docs/display-rules.md marks these rules 未');
});
