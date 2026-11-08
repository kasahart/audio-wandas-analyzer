import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..', '..');
const rulesPath = path.join(repoRoot, 'docs', 'display-rules.md');

/**
 * Rules that still list a screen or a Frame kind their tests do not reach ("未"). A PR that covers the rest removes
 * the 未 line from docs/display-rules.md and the rule from here; adding one is a change review should stop.
 */
const PENDING = ['R2', 'R5', 'R7'];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/**
 * Where the test a rule names is in its file, with its body: a node:test or Playwright test from its title to the
 * close of its call (the next line that starts with `})`), a pytest from its def to the next line at the margin; and
 * how it is declared (`test.skip(...)`, a pytest skip mark above it). Null when no test has that name.
 */
function namedTest(file: string, text: string, name: string): { body: string; declared: string } | null {
    if (file.endsWith('.py')) {
        // A def at any indent (a method of a test class), async or not; its body is the lines indented deeper than it.
        const at = new RegExp(`^([ \\t]*)(?:async\\s+)?def ${escape(name)}\\(`, 'm').exec(text);
        if (!at) return null;
        const indent = at[1].length;
        const rest = text.slice(at.index);
        // A signature over several lines closes at the def's own indent (`) -> None:`).
        const end = new RegExp(`\\n(?=[ \\t]{0,${indent}}[^\\s)])`).exec(rest.slice(1));
        const before = text.slice(0, at.index).split('\n').slice(-4).join('\n');
        return { body: end ? rest.slice(0, end.index + 1) : rest, declared: before };
    }
    const plain = text.replace(/\\'/g, "'");
    const at = new RegExp(`^([ \\t]*)test((?:\\.\\w+)?)\\(\\s*(['"\`])${escape(name)}\\3`, 'm').exec(plain)
        ?? new RegExp(`()\\btest((?:\\.\\w+)?)\\(\\s*(['"\`])${escape(name)}\\3`).exec(plain);
    if (!at) return null;
    const rest = plain.slice(at.index);
    // The test's call closes with `})` at the indent of its title's line (a test inside a describe is indented).
    const end = rest.search(new RegExp(`\\n${at[1]}\\}\\)`));
    return { body: end < 0 ? rest : rest.slice(0, end), declared: at[2] };
}

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

/**
 * A rule's test checks it: it runs (it is not declared skipped, todo or fixme, nor skipped unconditionally inside),
 * and its body asserts something (assert, expect, or a helper of the file's named expect…/assert…). A skip on a
 * condition (no Python backend) is kept: where the backend is required, the test fails instead.
 */
test('every test a display rule names runs and asserts something', () => {
    const asserts = /\b(?:assert|expect)\w*\s*[.(]|^\s+assert\b|\bpytest\.raises\b|\bnp\.testing\.\w+\(/m;
    for (const rule of rules()) {
        for (const { file, name } of rule.tests) {
            const found = namedTest(file, readFileSync(path.join(repoRoot, file), 'utf8'), name);
            if (!found) continue;
            const { body, declared } = found;
            const where = `${rule.id}: "${name}" (${file})`;
            if (file.endsWith('.py')) {
                assert.ok(!/@pytest\.mark\.(?:skip|xfail)\b(?!if)/.test(declared), `${where} is marked skipped`);
                assert.ok(!/^\s+pytest\.skip\(/m.test(body.split('\n').slice(1, 3).join('\n')), `${where} skips before it checks anything`);
            } else {
                assert.ok(!/^\.(?:skip|todo|fixme|only)$/.test(declared), `${where} is declared test${declared}`);
                assert.ok(!/\btest\.(?:skip|fixme)\(\s*(?:true\s*)?[,)]/.test(body), `${where} is skipped unconditionally`);
            }
            // The title's own line is not its body: an assertion has to follow it.
            assert.match(body.slice(body.indexOf('\n')), asserts, `${where} asserts nothing`);
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
