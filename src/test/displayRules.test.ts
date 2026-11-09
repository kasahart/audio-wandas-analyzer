import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { namedTest, testProblem } from './namedTest';

const repoRoot = path.resolve(__dirname, '..', '..');
const rulesPath = path.join(repoRoot, 'docs', 'display-rules.md');

/**
 * Rules that still list a screen or a Frame kind their tests do not reach ("未"). A PR that covers the rest removes
 * the 未 line from docs/display-rules.md and the rule from here; adding one is a change review should stop.
 */
const PENDING: string[] = [];

interface Rule { id: string; tests: Array<{ file: string; name: string }>; pending: boolean }

function rules(): Rule[] {
    const found: Rule[] = [];
    for (const line of readFileSync(rulesPath, 'utf8').split(/\r?\n/)) {
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

test('the rules still marked 未 are exactly the pending list', () => {
    assert.deepEqual(rules().filter(rule => rule.pending).map(rule => rule.id), PENDING);
});
