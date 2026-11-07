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
const PENDING = ['R2', 'R5', 'R7', 'R13'];

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

test('every test a display rule names exists under that name', () => {
    for (const rule of rules()) {
        for (const { file, name } of rule.tests) {
            const source = path.join(repoRoot, file);
            assert.ok(existsSync(source), `${rule.id}: ${file} does not exist`);
            const text = readFileSync(source, 'utf8');
            // A pytest name is a def; a node:test or Playwright name is a whole quoted title (quotes may be escaped).
            const present = file.endsWith('.py')
                ? new RegExp(`def ${escape(name)}\\(`).test(text)
                : new RegExp(`\\btest(?:\\.\\w+)?\\(\\s*(['"\`])${escape(name)}\\1`).test(text.replace(/\\'/g, "'"));
            assert.ok(present, `${rule.id}: "${name}" is not a test in ${file}`);
        }
    }
});

test('the rules still marked 未 are exactly the pending list', () => {
    assert.deepEqual(rules().filter(rule => rule.pending).map(rule => rule.id), PENDING);
});
