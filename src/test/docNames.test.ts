/**
 * The contributor docs name only files and code that exist. A co-developer learns the project from these docs, so a
 * file that was moved or a function that was renamed (a doc that still sent readers to `waveformRenderer.ts` years
 * after it was gone) is a wrong instruction, not a typo.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..', '..');

/** A name a doc may give that is not in the repository, with why. An entry no doc gives any more fails the test. */
const NOT_IN_REPOSITORY: ReadonlyArray<{ doc: string; name: string; why: string }> = [
    { doc: 'CLAUDE.md', name: '.claude/settings.local.json', why: 'each contributor\'s own file, gitignored' },
    { doc: 'CLAUDE.md', name: 'TodoWrite', why: 'a Claude Code tool, not code of this repository' },
    { doc: 'python-backend/recipes/README.md', name: 'loudness_zwst', why: 'a wandas method' },
    { doc: 'docs/plot-contracts-guide.md', name: 'src/webview/runtime/myPane.ts', why: 'the guide\'s example of a new file' },
    { doc: 'docs/plot-contracts-guide.md', name: 'plotContracts.test.js', why: 'tsc\'s output of plotContracts.test.ts, under dist/' },
    { doc: 'docs/ux-cognitive-audit.md', name: 'UX_AUDIT_REPORT.md', why: 'the report the audit writes, not kept in the repository' },
    { doc: 'docs/architecture.md', name: 'comparisonRuntime.js', why: 'the tree of dist/webview/, which scripts/build-webview.js writes' },
    { doc: 'docs/figure-design.md', name: 'src/webview/state', why: 'the folder the table plans, marked まだ無い there' },
    { doc: 'docs/display-rules.md', name: 'waveformLayer.ts', why: 'R16 names how the implementation before the figure rebuild (#805) did it, as history' },
    { doc: 'docs/display-rules.md', name: 'moveLaneDrag', why: 'R17 names how the implementation before the figure rebuild (#805) did it, as history' },
];

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter(Boolean);

/** The docs a contributor reads: the agent guides, the READMEs and docs/. */
const docs = tracked.filter(file => file.endsWith('.md')
    && (!file.includes('/') || file.startsWith('docs/') || file.startsWith('.github/') || /(^|\/)README(\.ja)?\.md$/.test(file))
    && !file.startsWith('.agents/') && !file.startsWith('.claude/') && file !== 'CHANGELOG.md');

/** Every tail of every tracked path (`figures/pick.py` names python-backend/figures/pick.py), and the folders. */
const pathTails = new Set<string>();
for (const file of tracked) {
    const parts = file.split('/');
    for (let start = 0; start < parts.length; start += 1) {
        for (let end = start + 1; end <= parts.length; end += 1) pathTails.add(parts.slice(start, end).join('/'));
    }
}

const CODE = /\.(ts|js|mjs|cjs|py|json|toml|ya?ml|sh|ps1)$/;
// This file is left out: its own list would make every name it allows look like code.
const codeWords = new Set(tracked.filter(file => CODE.test(file) && file !== 'src/test/docNames.test.ts')
    .flatMap(file => readFileSync(path.join(repoRoot, file), 'utf8').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []));

interface Named { doc: string; line: number; name: string; kind: 'path' | 'code' }

/**
 * What a doc names in backticks outside code blocks, and the files of a file tree: a path (has a `/` under a known top folder, or ends in a source extension) or a name
 * of code (`camelCase`, `snake_case`, optionally `()`). Plain words, commands and patterns are not checked.
 */
function named(doc: string): Named[] {
    const found: Named[] = [];
    let fence: string | null = null;
    readFileSync(path.join(repoRoot, doc), 'utf8').split('\n').forEach((text, index) => {
        const opens = /^```(\w*)/.exec(text);
        if (opens) {
            fence = fence === null ? opens[1] : null;
            return;
        }
        // A file tree in a plain block (`index.ts   activate: …`) names a file by its first word.
        const treeFile = fence === '' || fence === 'text' ? /^\s+([\w.-]+\.(?:ts|js|mjs|py))\s/.exec(text) : null;
        if (treeFile) found.push({ doc, line: index + 1, name: treeFile[1], kind: 'path' });
        if (fence !== null) return;
        for (const [, raw] of text.matchAll(/`([^`\s]+)`/g)) {
            const token = raw.split('::')[0].replace(/\.(ts|py|js):\w+$/, '.$1').replace(/:\d+(-\d+)?$/, '').replace(/\/$/, '');
            if (/^(https?:|dist\/|node_modules|\.venv|\.vscode-test|\.worktrees|~|\/)/.test(token) || /[*<>{}$]/.test(token)) continue;
            const isPath = /^[\w.-]+(\/[\w.-]+)*$/.test(token) && !/^\.[\w.]+$/.test(token)
                && (/\.(ts|js|mjs|py|md|json|sh|ps1|toml|ya?ml)$/.test(token) || /^(src|python-backend|scripts|docs|media|browser|runtime|\.github)\//.test(token));
            if (isPath) {
                found.push({ doc, line: index + 1, name: token, kind: 'path' });
                continue;
            }
            const code = /^([A-Za-z_][A-Za-z0-9_]*)(\(\))?$/.exec(token);
            if (code && (/[a-z][A-Z]/.test(code[1]) || code[1].includes('_'))) found.push({ doc, line: index + 1, name: code[1], kind: 'code' });
        }
    });
    return found;
}

const allNamed = docs.flatMap(named);
const allowed = (item: Named) => NOT_IN_REPOSITORY.some(entry => entry.doc === item.doc && entry.name === item.name);

test('every file and folder a contributor doc names in backticks exists in the repository', () => {
    const missing = allNamed.filter(item => item.kind === 'path' && !pathTails.has(item.name) && !allowed(item));
    assert.deepEqual(missing.map(item => `${item.doc}:${item.line} \`${item.name}\``), [],
        'Rule: a doc names only files that exist (AGENTS.md §7: read this file before any change; a moved file is a wrong instruction). '
        + 'Fix: write the file\'s path as it is now (any tail of it is enough: `figures/pick.py`), or remove the sentence if what it describes is gone. '
        + 'A name that is deliberately not in the repository goes in NOT_IN_REPOSITORY in src/test/docNames.test.ts with why.');
});

test('every function, constant or field a contributor doc names in backticks is in the code', () => {
    const missing = allNamed.filter(item => item.kind === 'code' && !codeWords.has(item.name) && !allowed(item));
    assert.deepEqual(missing.map(item => `${item.doc}:${item.line} \`${item.name}\``), [],
        'Rule: a doc names only code that exists, so a reader can grep for it. '
        + 'Fix: write the name the code uses now, or remove the sentence if what it describes is gone. '
        + 'A name that is deliberately not in the repository goes in NOT_IN_REPOSITORY in src/test/docNames.test.ts with why.');
});

test('every NOT_IN_REPOSITORY entry is still named by its doc and still not in the repository', () => {
    const stale = NOT_IN_REPOSITORY.filter(entry => !allNamed.some(item => item.doc === entry.doc && item.name === entry.name)
        || pathTails.has(entry.name) || codeWords.has(entry.name));
    assert.deepEqual(stale.map(entry => `${entry.doc} \`${entry.name}\``), [],
        'Rule: the list of names allowed to be missing only shrinks. Fix: remove these entries from NOT_IN_REPOSITORY in src/test/docNames.test.ts.');
});
