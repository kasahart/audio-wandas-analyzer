/** Finds a test by its title in its file, for the lists of tests docs and contract tables name (displayRules, plotContracts). */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');

/** The Python the repository's checks run: the project's .venv when there is one. */
export function pythonExecutable(): string {
    const venv = path.join(repoRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    return existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';
}

/** A test or def of a Python file as scripts/check_test_proofs.py --tests finds it: its lines, from 1. */
interface PythonDef { line: number; end: number; declared?: string[] }
interface PythonDiscovery { tests: Record<string, PythonDef>; defs: Record<string, PythonDef> }
const discovered = new Map<string, PythonDiscovery>();

/**
 * The tests and defs of Python sources, by scripts/check_test_proofs.py's AST discovery (`tests_of`, `defs_of`):
 * there is one discovery of pytests, and both the TypeScript checks and the proof check name a test by it
 * (`test_y`, `TestX::test_y`). Asked once per source text, many texts in one run.
 */
export function pythonDiscovery(texts: readonly string[]): PythonDiscovery[] {
    const asked = [...new Set(texts.filter(text => !discovered.has(text)))];
    if (asked.length) {
        const run = spawnSync(pythonExecutable(), ['scripts/check_test_proofs.py', '--tests'], { cwd: repoRoot, encoding: 'utf8', input: JSON.stringify(asked), maxBuffer: 1 << 28 });
        if (run.status !== 0) throw new Error(`scripts/check_test_proofs.py --tests: ${run.stderr || run.error}`);
        const found = JSON.parse(run.stdout) as PythonDiscovery[];
        asked.forEach((text, index) => discovered.set(text, found[index]));
    }
    return texts.map(text => discovered.get(text)!);
}

/** Lines `first` to `last` (from 1) of `text`. */
const linesOf = (text: string, first: number, last: number): string => text.split('\n').slice(first - 1, last).join('\n');

/** Every def of a Python module (`function`, `Class.method`) with its body, from the same discovery. */
export function pythonDefBodies(text: string): Map<string, string> {
    const [found] = pythonDiscovery([text]);
    return new Map(Object.entries(found.defs).map(([name, at]) => [name, linesOf(text, at.line, at.end)]));
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where the test a rule names is in its file, with its body: a node:test or Playwright test from its title to the
 * close of its call (the next line that starts with `})`), a pytest as pytest collects it (`test_y`, or
 * `TestX::test_y` for a method of a test class: pythonDiscovery) from its def to its last line; and how it is
 * declared (`test.skip(...)`, the pytest marks on it and on its classes). Null when no test has that name.
 */
export function namedTest(file: string, text: string, name: string): { body: string; declared: string } | null {
    if (file.endsWith('.py')) {
        const at = pythonDiscovery([text])[0].tests[name];
        return at ? { body: linesOf(text, at.line, at.end), declared: (at.declared ?? []).map(mark => `@${mark}`).join('\n') } : null;
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
