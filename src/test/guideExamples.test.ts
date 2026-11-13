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
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import { ANSWER_DECLARATIONS, answerProgram, findAnswerWrites } from './answerBoundary';
import { NOT_ANSWER_WRITES, type Listed } from './answerBoundaryAllowlist';
import { functionSites, rowsOutsideFigureModel, siteProblems, type Sites } from './figureSites';
import {
    checkBackendReaders, checkChartFilesGathered, checkContractDoc, checkGaps, checkNamedFunctionsExist, checkNamedTestsRun, checkNumberWriters, checkPlotCallers, checkProofs,
    checkProtocolFields, checkRowsAndKinds, checkRuleQuotes, codeWith, protocolFields, pythonFlowReaders, pythonSources, rowsOf, TABLE, withProofs, type Code, type Table,
} from './plotContracts/checks';
import type { ChartContract } from './plotContracts/model';
import { renderContractDoc } from './plotContracts/render';
import { pythonExecutable } from './namedTest';
import type { StageView } from '../shared/protocol/backendProtocol';
import { stageRange } from '../webview/runtime/stagePanes';
import { SCHEMA_FIELDS } from './plotContracts/schema';
import { BACKEND_READERS, type BackendReader } from './plotContracts/values';

const repoRoot = path.resolve(__dirname, '..', '..');
const GUIDE = 'docs/plot-contracts-guide.md';

interface Block {
    /** The line of the guide the block's code starts on (1-based). */
    line: number;
    /** The file it is compiled as, or undefined when the block has no guide-check comment. */
    file?: string;
    hidden: string[];
    code: string[];
    /** A block of the worked example (`<!-- guide-example … -->`): built and checked by the example's test below. */
    example?: boolean;
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
        if (/^\s*<!-- guide-example .*-->\s*$/u.test(lines[index])) {
            check = { file: '', hidden: [] };
            continue;
        }
        const fence = /^(\s*)```ts\s*$/u.exec(lines[index]);
        if (fence) {
            const code: string[] = [];
            const first = index + 2;
            // A block inside a list is indented: its indent is the fence's.
            for (index++; index < lines.length && !/^\s*```\s*$/u.test(lines[index]); index++) code.push(lines[index].slice(Math.min(fence[1].length, lines[index].length - lines[index].trimStart().length)));
            blocks.push({ line: first, ...(check?.file === '' ? { hidden: [], example: true } : check ? { file: check.file, hidden: check.hidden } : { hidden: [] }), code });
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
        if (block.file === undefined && !block.example) problems.push(`${GUIDE}:${block.line}: this \`\`\`ts block has no "<!-- guide-check file=… -->" comment right above it, so nothing compiles it. Add one (see the top of src/test/guideExamples.test.ts).`);
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
    const honest = guide('import { localLine } from \'./fullRead\';\nimport type { WholeLine } from \'../../shared/provenance\';\ndeclare const values: WholeLine;', 'export const full = localLine([1, 2], values);');
    assert.deepEqual(problems(honest), []);
    assert.match(problems(guide('declare const view: { x: number };', 'export const made = mintWhole(view.x);')).join('\n'), /does not compile: Cannot find name 'mintWhole'/u);
    assert.match(problems(guide('', 'export const made = 1;', false)).join('\n'), /has no "<!-- guide-check/u);
    assert.match(problems(guide('', 'export const made: number = 1;   // error: not refused at all')).join('\n'), /but it compiles/u);
    assert.match(problems(guide('const hidden: string = 1;', 'export const made = 1;')).join('\n'), /hidden lines .* do not compile/u);
});

// ── The worked example, run through the structural checks in memory ──
//
// The guide's checklist names every registry a new chart and a new number enter, and its worked example (a kurtosis
// chart and its headline) follows every step in code blocks marked `<!-- guide-example file=… -->` (a file, or code
// added to an existing one) or `<!-- guide-example entries=… -->` (entries of a registry). Here those blocks become
// files and table entries in memory, never on disk, and the structural checks of plotContracts.test.ts,
// figureModel.test.ts and answerStoreBoundary.test.ts run on them (plotContracts/checks.ts, figureSites.ts,
// answerBoundary.ts). With every step the example passes; with any one step left out it fails, naming that step's
// fix. Each step of the checklist's first table has its omission here and each omission its step there, so neither
// can change alone.

/** Every block marked `guide-example`, any language: a file's code, or a registry's entries. */
export function exampleBlocks(markdown: string): Array<{ line: number; file?: string; entries?: string; code: string }> {
    const lines = markdown.split('\n');
    const found: Array<{ line: number; file?: string; entries?: string; code: string }> = [];
    for (let index = 0; index < lines.length; index++) {
        const marked = /^\s*<!-- guide-example (file|entries)=(\S+) -->\s*$/u.exec(lines[index]);
        if (!marked) continue;
        const fence = /^(\s*)```\w+\s*$/u.exec(lines[index + 1] ?? '');
        assert.ok(fence, `${GUIDE}:${index + 1}: a guide-example comment is right above a code block`);
        const code: string[] = [];
        for (index += 2; index < lines.length && !/^\s*```\s*$/u.test(lines[index]); index++) code.push(lines[index].slice(Math.min(fence[1].length, lines[index].length - lines[index].trimStart().length)));
        found.push({ line: index - code.length + 1, [marked[1]]: marked[2], code: code.join('\n') });
    }
    return found;
}

/** The ids of the checklist's first table (the steps the example is checked for in memory), in its order. */
export function checklistSteps(markdown: string): string[] {
    const lines = markdown.split('\n');
    const at = lines.findIndex(line => line.trim() === '<!-- guide-checklist in-memory -->');
    assert.ok(at >= 0, `${GUIDE} has its checklist (<!-- guide-checklist in-memory -->)`);
    const steps: string[] = [];
    for (let index = at + 3; index < lines.length && lines[index].startsWith('|'); index++) {
        const step = /^\|\s*`([\w-]+)`\s*\|/u.exec(lines[index]);
        assert.ok(step, `${GUIDE}:${index + 1}: a checklist line starts with its step's id in backticks`);
        steps.push(step[1]);
    }
    return steps;
}

/** A `guide-example` ts block run as a CommonJS module, its relative imports resolved from where `file` would be. */
function evaluated(code: string, file: string, prelude = ''): Record<string, unknown> {
    const js = ts.transpileModule(`${prelude}${code}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const from = path.join(repoRoot, 'dist', path.dirname(file).replace(/^src\//u, ''));
    const load = createRequire(__filename);
    const module = { exports: {} as Record<string, unknown> };
    // In this realm, so its arrays and objects are this realm's (node:assert compares prototypes).
    const run = runInThisContext(`(function (require, module, exports) {\n${js}\n})`) as (require: (specifier: string) => unknown, module: { exports: Record<string, unknown> }, exports: Record<string, unknown>) => void;
    run(specifier => load(specifier.startsWith('.') ? path.join(from, specifier) : specifier), module, module.exports);
    return module.exports;
}

const KURTOSIS_TEST = 'src/test/kurtosisPane.test.ts';

/** The example as code and tables: everything one omission changes. */
interface Example {
    files: Map<string, string>;
    contract: ChartContract;
    schemaFields: Record<string, readonly string[] | string>;
    readers: Record<string, BackendReader>;
    allowed: Sites;
    answerWrites: Record<string, Listed>;
    /** Whether docs/plot-contracts.md is regenerated with the example's chart. */
    doc: boolean;
}

/** The example as the guide writes it, every step followed. */
function guideExample(markdown: string): Example {
    const blocks = exampleBlocks(markdown);
    const files = new Map<string, string>();
    for (const block of blocks.filter(item => item.file)) {
        const file = block.file ?? '';
        files.set(file, `${files.get(file) ?? (existsSync(path.join(repoRoot, file)) ? readFileSync(path.join(repoRoot, file), 'utf8') : '')}\n${block.code}\n`);
    }
    const entries = (name: string): string => {
        const found = blocks.filter(item => item.entries === name);
        assert.equal(found.length, 1, `${GUIDE} has one guide-example block of ${name}'s entries`);
        return found[0].code;
    };
    const chart = files.get('src/test/plotContracts/charts/kurtosis.ts');
    assert.ok(chart, `${GUIDE} has the example's chart file`);
    const contract = evaluated(chart, 'src/test/plotContracts/charts/kurtosis.ts').kurtosis as ChartContract;
    return {
        files,
        contract,
        schemaFields: { ...SCHEMA_FIELDS, ...(evaluated(`module.exports = {\n${entries('SCHEMA_FIELDS')}\n};`, 'src/test/plotContracts/schema.ts') as Record<string, readonly string[] | string>) },
        readers: { ...BACKEND_READERS, ...(JSON.parse(`{${entries('readers')}}`) as Record<string, BackendReader>) },
        allowed: evaluated(`module.exports = {\n${entries('ALLOWED')}\n};`, 'src/test/figureModel.test.ts') as Sites,
        answerWrites: { ...NOT_ANSWER_WRITES, ...evaluated(`module.exports = {\n${entries('NOT_ANSWER_WRITES')}\n};`, 'src/test/answerBoundaryAllowlist.ts', "const { notAnswer } = require('./answerBoundaryAllowlist');\n") as Record<string, Listed> },
        doc: true,
    };
}

const codes = new Map<string, Code>();
const flows = new Map<string, Record<string, string[]>>();
const answerPrograms = new Map<string, ts.Program>();
const siteCache = new Map<Code, Sites>();
const keyOf = (files: ReadonlyMap<string, string>): string => JSON.stringify([...files]);

/** What fails of the example, check by check: `check: message`. Empty when every step is followed. */
function exampleProblems(example: Example): string[] {
    const table: Table = { ...TABLE, contracts: [...TABLE.contracts, example.contract].filter(contract => contract.chart.id !== 'kurtosis' || contract === example.contract), chartFiles: [...TABLE.chartFiles, 'kurtosis'], schemaFields: example.schemaFields, backendReaders: example.readers };
    const own: Table = { ...table, contracts: table.contracts.filter(contract => contract.chart.id === 'kurtosis') };
    const files = new Map(example.files);
    files.set('docs/plot-contracts.md', example.doc ? renderContractDoc(table.contracts) : readFileSync(path.join(repoRoot, 'docs/plot-contracts.md'), 'utf8'));
    const key = `${keyOf(example.files)} doc:${String(example.doc)}`;
    // One program for the example's files and the tests its rows give as proof.
    const code = codes.get(key) ?? withProofs(rowsOf(own), codeWith(files));
    codes.set(key, code);
    const written = [...example.files.keys()].filter(file => /^src\/.*\.ts$/u.test(file));
    const problems: string[] = [];
    const run = (check: string, body: () => void): void => {
        try { body(); } catch (error) { problems.push(`${check}: ${error instanceof Error ? error.message : String(error)}`); }
    };
    run('compile', () => {
        const program = code.program();
        const failed = written.flatMap(file => ts.getPreEmitDiagnostics(program, program.getSourceFile(path.join(repoRoot, file))).map(item => `${file}: ${ts.flattenDiagnosticMessageText(item.messageText, ' ')}`));
        assert.deepEqual(failed, [], 'the example does not compile');
    });
    run('painted-by', () => checkPlotCallers(code, table));
    run('index', () => checkChartFilesGathered(table));
    run('rows', () => checkRowsAndKinds(table));
    run('figure-rows', () => assert.deepEqual(rowsOutsideFigureModel(rowsOf(own)), [], 'Rule: a row of a level axis, a range or a file count names the figureModel.ts function that makes it (docs/plot-layers.md). These name none. Fix: add it to the row\'s computedIn (figureModel.ts stageNames, dataRange, …).'));
    run('functions', () => checkNamedFunctionsExist(code, table));
    run('tests', () => checkNamedTestsRun(code, own));
    run('tt', () => checkGaps(own));
    run('not-drawn', () => checkProofs(rowsOf(own), code));
    run('number-writer', () => checkNumberWriters(code, table));
    run('axis-namer', () => {
        const sites = siteCache.get(code) ?? functionSites(code.program());
        siteCache.set(code, sites);
        const mine = Object.fromEntries(Object.entries(sites).filter(([rel]) => written.includes(`src/${rel}`)));
        assert.deepEqual(siteProblems(mine, example.allowed), []);
    });
    run('answer-writes', () => {
        const program = answerPrograms.get(key) ?? answerProgram(repoRoot, [], Object.fromEntries(example.files));
        answerPrograms.set(key, program);
        const answerFiles = new Set(ANSWER_DECLARATIONS.map(file => ts.sys.resolvePath(path.join(repoRoot, file))));
        const found = written.filter(file => file.startsWith('src/webview/')).flatMap(file => findAnswerWrites(file, program.getSourceFile(path.join(repoRoot, file)) as ts.SourceFile, program.getTypeChecker(), answerFiles));
        assert.deepEqual(found.filter(entry => !(entry in example.answerWrites)), [], 'An answer is kept in answerStore.ts (createAnswerSlot for one per track), not in an object\'s field or a let: one that holds no answer goes in NOT_ANSWER_WRITES (src/test/answerBoundaryAllowlist.ts) with what it holds');
    });
    run('readers', () => {
        const flow = flows.get(key) ?? pythonFlowReaders(pythonSources(code));
        flows.set(key, flow);
        checkBackendReaders(flow, code, table);
    });
    run('schema-fields', () => checkProtocolFields(protocolFields(code), table));
    run('doc', () => checkContractDoc(code, table));
    run('rule-quotes', () => checkRuleQuotes(code, own));
    return problems;
}

/**
 * Each step of the checklist, left out of the example: how the example is without it, and the message the checks
 * must fail with. A step's omission is what a newcomer would forget, and nothing else.
 */
const OMISSIONS: Readonly<Record<string, { without: (example: Example) => Example; fails: RegExp }>> = {
    'painted-by': {
        without: example => ({ ...example, contract: { ...example.contract, chart: { ...example.contract.chart, paintedBy: [] } } }),
        fails: /^painted-by: Rule: every call of the plot component .*kurtosisPane\.ts:paintKurtosis/msu,
    },
    index: {
        without: example => ({ ...example, contract: { ...example.contract, chart: { ...example.contract.chart, id: 'not-in-index' }, rows: [] } }),
        fails: /^index: Rule: a chart's file in src\/test\/plotContracts\/charts is named by its chart's id, and index\.ts lists every one/mu,
    },
    rows: {
        without: example => ({ ...example, contract: { ...example.contract, rows: example.contract.rows.filter(row => row.value !== 'headline') } }),
        fails: /^rows: kurtosis has no row for these values it shows.*headline/msu,
    },
    'figure-rows': {
        without: example => ({ ...example, contract: { ...example.contract, rows: example.contract.rows.map(row => (row.value === 'range' ? { ...row, computedIn: row.computedIn.filter(at => !at.includes('figureModel.ts')) } : row)) } }),
        fails: /^figure-rows: Rule: a row of a level axis, a range or a file count names the figureModel\.ts function.*kurtosis\.range/msu,
    },
    functions: {
        without: example => ({ ...example, contract: { ...example.contract, rows: example.contract.rows.map(row => ({ ...row, computedIn: row.computedIn.map(at => at.replace(':kurtosis_peak', ':peak')) })) } }),
        fails: /^functions: Rule: every function the contract table names .*kurtosis_view\.py:peak/msu,
    },
    tests: {
        without: example => ({ ...example, files: new Map([...example.files].filter(([file]) => file !== KURTOSIS_TEST)) }),
        fails: /^tests: kurtosis\.headline: names a test in src\/test\/kurtosisPane\.test\.ts, which does not exist/mu,
    },
    tt: {
        without: example => ({ ...example, contract: { ...example.contract, rows: example.contract.rows.map(row => (row.value === 'headline' ? { ...row, tests: row.tests.map(item => ({ file: item.file, name: item.name })) } : row)) } }),
        fails: /^tt: kurtosis\.headline .* is not marked a gap, but these say it is one/mu,
    },
    'not-drawn': {
        without: example => ({ ...example, files: new Map([...example.files].map(([file, text]) => [file, file === KURTOSIS_TEST ? text.replace(/^\s*assertNotDrawn\(.*$/mu, '') : text])) }),
        fails: /^not-drawn: .*kurtosis\.headline: "the kurtosis headline .*" asserts no case where the full data and the drawn points give different answers/msu,
    },
    'number-writer': {
        without: example => ({ ...example, contract: { ...example.contract, rows: example.contract.rows.map(row => ({ ...row, computedIn: row.computedIn.filter(at => !at.endsWith(':kurtosisHeadline')) })) } }),
        fails: /^number-writer: Rule: every function that writes a number a user can read belongs to the contract table.*kurtosisPane\.ts:kurtosisHeadline/msu,
    },
    'axis-namer': {
        without: example => ({ ...example, allowed: {} }),
        fails: /^axis-namer: .*src\/webview\/runtime\/kurtosisPane\.ts: paintKurtosis names an axis by a picture .*add 'paintKurtosis' to ALLOWED\['webview\/runtime\/kurtosisPane\.ts'\]\['axis-namer'\]/msu,
    },
    'answer-writes': {
        without: example => ({ ...example, answerWrites: NOT_ANSWER_WRITES }),
        fails: /^answer-writes: An answer is kept in answerStore\.ts .*NOT_ANSWER_WRITES.*kurtosisPane\.ts#let drawn/msu,
    },
    readers: {
        without: example => ({ ...example, readers: BACKEND_READERS }),
        fails: /^readers: Rule: every backend function that computes with points thinned to draw .*kurtosis_view\.py:kurtosis_view/msu,
    },
    'schema-fields': {
        without: example => ({ ...example, schemaFields: SCHEMA_FIELDS }),
        fails: /^schema-fields: Rule: every number the backend's protocol sends back is a value of a row.*StageView\.kurtosisPeak\.value/msu,
    },
    doc: {
        without: example => ({ ...example, doc: false }),
        fails: /^doc: docs[/\\]plot-contracts\.md is generated from src\/test\/plotContracts\/ and is not the table it renders/mu,
    },
};

test('the guide\'s worked example, a new chart and its new number, passes every structural check in memory with the checklist followed', () => {
    assert.deepEqual(exampleProblems(guideExample(readFileSync(path.join(repoRoot, GUIDE), 'utf8'))), []);
});

test('the guide\'s checklist names every step the example is checked for, and the example fails naming the step whenever one is left out', () => {
    const markdown = readFileSync(path.join(repoRoot, GUIDE), 'utf8');
    assert.deepEqual(checklistSteps(markdown), Object.keys(OMISSIONS), `the checklist's first table in ${GUIDE} and OMISSIONS (src/test/guideExamples.test.ts) list the same steps in the same order: a step added to one is added to the other`);
    const example = guideExample(markdown);
    for (const [step, { without, fails }] of Object.entries(OMISSIONS)) {
        const problems = exampleProblems(without(example));
        assert.match(problems.join('\n'), fails, `without step ${step}, the checks fail naming it. They said:\n${problems.join('\n') || '(nothing)'}`);
    }
});

/** The guide's backend module run by Python (never written to disk): `kurtosis_view` of a kurtosis line, as JSON. */
function guideKurtosisView(module: string, times: readonly number[], values: readonly number[], points: number): StageView {
    const script = [
        'import json, sys, types',
        'import numpy as np',
        'sys.path.insert(0, "python-backend")',
        'given = json.loads(sys.stdin.read())',
        'module = types.ModuleType("kurtosis_view")',
        'exec(compile(given["module"], "kurtosis_view.py", "exec"), module.__dict__)',
        'print(json.dumps(module.kurtosis_view(np.array(given["times"]), np.array(given["values"]), given["points"])))',
    ].join('\n');
    const run = spawnSync(pythonExecutable(), ['-c', script], { cwd: repoRoot, encoding: 'utf8', input: JSON.stringify({ module, times, values, points }) });
    assert.equal(run.status, 0, `the guide's kurtosis_view.py runs: ${run.stderr}`);
    return JSON.parse(run.stdout) as StageView;
}

test('the guide\'s backend example sends the full data\'s value range, so the plot\'s range encloses every value, not only the points drawn (R9)', () => {
    const module = exampleBlocks(readFileSync(path.join(repoRoot, GUIDE), 'utf8')).find(block => block.file === 'python-backend/kurtosis_view.py')?.code;
    assert.ok(module, `${GUIDE} has the example's backend module`);
    // 400 frames of kurtosis near 3, one burst to 9.5 and one dip to 1.2, thinned to 8 buckets to draw.
    const times = Array.from({ length: 400 }, (_, index) => index * 0.01);
    const values = times.map((_, index) => (index === 123 ? 9.5 : index === 301 ? 1.2 : 3 + 0.2 * Math.sin(index)));
    const view = guideKurtosisView(module, times, values, 8);
    assert.deepEqual(view.valueRange, { min: 1.2, max: 9.5 });
    const range = stageRange([view]);
    assert.ok(range.min <= 1.2 && range.max >= 9.5, `the plot's range ${JSON.stringify(range)} encloses every value (1.2 to 9.5)`);
    // Without the full data's range the plot keeps its default and the line is off it: why the example sends one.
    const { valueRange: _, ...without } = view;
    assert.ok(!(stageRange([without]).max >= 9.5), 'a view with no valueRange is not ranged to its data');
    assert.deepEqual((view as StageView & { kurtosisPeak?: unknown }).kurtosisPeak, { x: 1.23, value: 9.5 });
});
