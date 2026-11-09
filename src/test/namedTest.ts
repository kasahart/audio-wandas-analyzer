/** Finds a test by its title in its file, for the lists of tests docs and contract tables name (displayRules, plotContracts). */

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where the test a rule names is in its file, with its body: a node:test or Playwright test from its title to the
 * close of its call (the next line that starts with `})`), a pytest from its def to the next line at the margin; and
 * how it is declared (`test.skip(...)`, a pytest skip mark above it). Null when no test has that name.
 */
export function namedTest(file: string, text: string, name: string): { body: string; declared: string } | null {
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

const ASSERTS = /\b(?:assert|expect)\w*\s*[.(]|^\s+assert\b|\bpytest\.raises\b|\bnp\.testing\.\w+\(/m;

/**
 * Why the test named `name` in `file` (its source `text`) does not check anything, or null when it does: it exists,
 * runs (it is not declared skipped, todo or fixme, nor skipped unconditionally inside), and its body asserts something
 * (assert, expect, or a helper of the file's named expect…/assert…). A skip on a condition (no Python backend) is
 * kept: where the backend is required, the test fails instead.
 */
export function testProblem(file: string, text: string, name: string): string | null {
    const found = namedTest(file, text, name);
    if (!found) return `"${name}" is not a test in ${file}`;
    const { body, declared } = found;
    const where = `"${name}" (${file})`;
    if (file.endsWith('.py')) {
        if (/@pytest\.mark\.(?:skip|xfail)\b(?!if)/.test(declared)) return `${where} is marked skipped`;
        if (/^\s+pytest\.skip\(/m.test(body.split('\n').slice(1, 3).join('\n'))) return `${where} skips before it checks anything`;
    } else {
        if (/^\.(?:skip|todo|fixme|only)$/.test(declared)) return `${where} is declared test${declared}`;
        if (/\btest\.(?:skip|fixme)\(\s*(?:true\s*)?[,)]/.test(body)) return `${where} is skipped unconditionally`;
    }
    // The title's own line is not its body: an assertion has to follow it.
    return ASSERTS.test(body.slice(body.indexOf('\n'))) ? null : `${where} asserts nothing`;
}
