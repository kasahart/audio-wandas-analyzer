#!/usr/bin/env node
// .agents/skills/ is the single source of the repo's agent skills; .claude/skills/ is a copy for Claude Code.
// `node scripts/sync-skills.mjs` rewrites the copy; `--check` (run by verify) fails when it has drifted.
// Codex-only metadata (a skill's agents/ folder) is not copied.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.agents', 'skills');
const copy = join(root, '.claude', 'skills');
const codexOnly = path => relative(source, path).split(/[\\/]/)[1] === 'agents';

function files(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter(entry => entry.isFile())
        .map(entry => relative(dir, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
        .sort();
}

if (process.argv.includes('--check')) {
    const expected = files(source).filter(file => !codexOnly(join(source, file)));
    const actual = files(copy);
    const text = (dir, file) => readFileSync(join(dir, file), 'utf8').replaceAll('\r\n', '\n');
    const drift = [
        ...expected.filter(file => !actual.includes(file) || text(source, file) !== text(copy, file)),
        ...actual.filter(file => !expected.includes(file)),
    ];
    if (drift.length) {
        console.error(`.claude/skills differs from .agents/skills: ${drift.join(', ')}\nRun: node scripts/sync-skills.mjs`);
        process.exit(1);
    }
    console.log('.claude/skills matches .agents/skills');
} else {
    rmSync(copy, { recursive: true, force: true });
    cpSync(source, copy, { recursive: true, filter: path => !codexOnly(path) });
    console.log('.claude/skills rewritten from .agents/skills');
}
