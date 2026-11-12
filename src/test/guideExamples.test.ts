/**
 * The code in docs/plot-contracts-guide.md is compiled against the real code, so an example cannot keep naming a
 * function that was renamed or an argument that was removed.
 *
 * The rule, for every ```ts block of the guide:
 * - it has a comment just above it that says which file it would be, and the code it needs but does not show:
 *
 *       <!-- guide-check file=src/webview/runtime/guideExample.ts
 *       declare const view: StageView;
 *       -->
 *
 *   (an HTML comment: readers of the rendered guide do not see it). The file's place matters only for the block's
 *   relative imports; the file is never written.
 * - the block compiles as that file, after the hidden lines, with the repo's own tsconfig;
 * - a line that shows what the compiler refuses ends with a `// error…` comment, and must fail to compile. Any
 *   other line that fails, fails this test.
 *
 * When this fails after you changed product code: fix the guide's block to use the code as it now is. When it fails
 * after you edited the guide: read the compiler's message under the block's line.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = path.resolve(__dirname, '..', '..');
const GUIDE = 'docs/plot-contracts-guide.md';

interface Block {
    /** The line of the guide the block's code starts on (1-based). */
    line: number;
    /** The file it is compiled as, or undefined when the block has no guide-check comment. */
    file?: string;
    hidden: string[];
    code: string[];
}

/** Every ```ts block of `markdown`, with the guide-check comment above it. */
export function tsBlocks(markdown: string): Block[] {
    const lines = markdown.split('\n');
    const blocks: Block[] = [];
    let check: { file: string; hidden: string[] } | undefined;
    for (let index = 0; index < lines.length; index++) {
        const opened = /^\s*<!-- guide-check file=(\S+)\s*$/u.exec(lines[index]);
        if (opened) {
            const hidden: string[] = [];
            for (index++; index < lines.length && !/^\s*-->\s*$/u.test(lines[index]); index++) hidden.push(lines[index]);
            check = { file: opened[1], hidden };
            continue;
        }
        const fence = /^(\s*)```ts\s*$/u.exec(lines[index]);
        if (fence) {
            const code: string[] = [];
            const first = index + 2;
            // A block inside a list is indented: its indent is the fence's.
            for (index++; index < lines.length && !/^\s*```\s*$/u.test(lines[index]); index++) code.push(lines[index].slice(Math.min(fence[1].length, lines[index].length - lines[index].trimStart().length)));
            blocks.push({ line: first, ...(check ? { file: check.file, hidden: check.hidden } : { hidden: [] }), code });
            check = undefined;
        } else if (lines[index].trim()) {
            // The comment belongs to the block right under it.
            check = undefined;
        }
    }
    return blocks;
}

/** What is wrong with the blocks, each as "guide line: what and how to fix it". */
export function blockProblems(blocks: readonly Block[]): string[] {
    const problems: string[] = [];
    const config = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
    assert.ok(config, 'tsconfig.json is read');
    const options: ts.CompilerOptions = { ...config.options, noEmit: true };
    const checked = blocks.filter((block): block is Block & { file: string } => block.file !== undefined);
    for (const block of blocks) {
        if (block.file === undefined) problems.push(`${GUIDE}:${block.line}: this \`\`\`ts block has no "<!-- guide-check file=… -->" comment right above it, so nothing compiles it. Add one (see the top of src/test/guideExamples.test.ts).`);
    }
    // Two blocks may say the same file (two parts of one module): each is compiled by itself.
    const virtual = new Map(checked.map((block, index) => [path.join(repoRoot, block.file.replace(/\.ts$/u, `.guide${index}.ts`)), block]));
    const host = ts.createCompilerHost(options, true);
    const own = host.getSourceFile.bind(host), exists = host.fileExists.bind(host), reads = host.readFile.bind(host);
    const textOf = (block: Block): string => [...block.hidden, ...block.code].join('\n') + '\n';
    host.getSourceFile = (fileName, version, onError, create) => {
        const block = virtual.get(path.resolve(fileName));
        return block ? ts.createSourceFile(fileName, textOf(block), version, true) : own(fileName, version, onError, create);
    };
    host.fileExists = fileName => virtual.has(path.resolve(fileName)) || exists(fileName);
    host.readFile = fileName => { const block = virtual.get(path.resolve(fileName)); return block ? textOf(block) : reads(fileName); };
    const program = ts.createProgram([...config.fileNames, ...virtual.keys()], options, host);
    for (const [fileName, block] of virtual) {
        const source = program.getSourceFile(fileName);
        assert.ok(source, `${block.file} is compiled`);
        const failed = new Map<number, string[]>();
        for (const item of [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]) {
            const at = source.getLineAndCharacterOfPosition(item.start ?? 0).line;
            failed.set(at, [...(failed.get(at) ?? []), ts.flattenDiagnosticMessageText(item.messageText, ' ')]);
        }
        for (const [at, messages] of failed) {
            const inBlock = at - block.hidden.length;
            if (inBlock < 0) problems.push(`${GUIDE}:${block.line}: the hidden lines of this block's guide-check comment do not compile (line ${at + 1} of them): ${messages.join('; ')}`);
            else if (!/\/\/ error/u.test(block.code[inBlock] ?? '')) problems.push(`${GUIDE}:${block.line + inBlock}: this line of the guide does not compile: ${messages.join('; ')}\n    Change the example to use the code as it is now. (If the line is meant to show what the compiler refuses, end it with a "// error…" comment.)`);
        }
        block.code.forEach((text, inBlock) => {
            if (/\/\/ error/u.test(text) && !failed.has(inBlock + block.hidden.length)) problems.push(`${GUIDE}:${block.line + inBlock}: the guide says the compiler refuses this line ("// error"), but it compiles. Either the type that refused it was loosened (fix that), or the example is out of date.`);
        });
    }
    return problems;
}

test('every code block of the plot contracts guide compiles against the code as it is, and each line it says the compiler refuses is refused', () => {
    const blocks = tsBlocks(readFileSync(path.join(repoRoot, GUIDE), 'utf8'));
    assert.ok(blocks.length >= 5, 'the guide\'s blocks are found');
    assert.deepEqual(blockProblems(blocks), []);
});

test('the guide check fails on a block that names a function that does not exist, on an unmarked block, and on an "error" line that compiles', () => {
    const fence = '```';
    const guide = (hidden: string, code: string, comment = true): string => `${comment ? `<!-- guide-check file=src/webview/runtime/guideMutant.ts\n${hidden}\n-->\n` : ''}${fence}ts\n${code}\n${fence}\n`;
    const problems = (markdown: string): string[] => blockProblems(tsBlocks(markdown));
    const honest = guide('import { localLine } from \'./fullRead\';\nimport type { Whole } from \'../../shared/provenance\';\ndeclare const values: Whole[];', 'export const full = localLine([1, 2], values);');
    assert.deepEqual(problems(honest), []);
    assert.match(problems(guide('declare const view: { x: number };', 'export const made = mintWhole(view.x);')).join('\n'), /does not compile: Cannot find name 'mintWhole'/u);
    assert.match(problems(guide('', 'export const made = 1;', false)).join('\n'), /has no "<!-- guide-check/u);
    assert.match(problems(guide('', 'export const made: number = 1;   // error: not refused at all')).join('\n'), /but it compiles/u);
    assert.match(problems(guide('const hidden: string = 1;', 'export const made = 1;')).join('\n'), /hidden lines .* do not compile/u);
});
