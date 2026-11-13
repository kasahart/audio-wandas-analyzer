/**
 * The structural checks of the plot contract table, as functions of the code and the table they check, so that the
 * same checks run on the repository (src/test/plotContracts.test.ts) and on code that exists only in memory: the
 * worked example of docs/plot-contracts-guide.md (src/test/guideExamples.test.ts), which adds a chart and a number
 * the way the guide says and must pass, and must fail naming the step whenever one step of the guide's checklist is
 * left out. A check here asserts (node:assert) with the message a newcomer reads; it registers no test.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { pythonDefBodies, pythonDiscovery, pythonExecutable, testProblem } from '../namedTest';
import { CONTRACTS } from './index';
import type { Chart, ChartContract, ContractRow, Severity } from './model';
import { CONTRACT_DOC, renderContractDoc } from './render';
import { NOT_SHOWN, SCHEMA_FIELDS } from './schema';
import { BACKEND_READERS, NOT_CHART_VALUES, PY_DECIMATORS, VALUE_HELPERS, type BackendReader } from './values';

export const repoRoot = path.resolve(__dirname, '..', '..', '..');
export const STAGE_PANES = 'src/webview/runtime/stagePanes.ts';
/** The plot component's entry points: every call of one outside stagePanes.ts draws a chart. */
const PLOT_COMPONENT = new Set(['paintOverlay', 'paintStage', 'paintSideAxis', 'paintTimeAxis']);
/** Number primitives: a call of one turns a number into the text a user reads. */
const NUMBER_TEXT = new Set(['toFixed', 'toPrecision', 'toExponential', 'toLocaleString']);
/** Math's integer roundings: one applied to a value scaled by a power of ten rounds it to decimals, as text does. */
const MATH_ROUNDING = new Set(['round', 'trunc', 'floor', 'ceil']);
const PYTHON = 'python-backend';

// ── The code checked: the repository's, or the repository's with files added or replaced in memory ──

/** The code a check reads: the webview's and shared sources, the backend's modules, and a typed program of them. */
export interface Code {
    /** The webview's and shared TypeScript sources (repo-relative), the overlay's included. */
    readonly files: readonly string[];
    /** Repo-relative path → text of the files added or replaced in memory. */
    readonly overlay: ReadonlyMap<string, string>;
    read(file: string): string;
    has(file: string): boolean;
    parse(file: string): ts.SourceFile;
    /** `files` and every TS file of the overlay (tests too), with their types. */
    program(): ts.Program;
}

function diskSources(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(path.join(repoRoot, dir)).sort()) {
            const rel = `${dir}/${name}`;
            if (statSync(path.join(repoRoot, rel)).isDirectory()) walk(rel);
            else if (rel.endsWith('.ts') && !rel.endsWith('.d.ts')) found.push(rel);
        }
    };
    walk('src/webview');
    walk('src/shared');
    return found;
}

let base: ts.Program | undefined;
/** The repository's webview and shared code with its types. */
function baseProgram(): ts.Program {
    if (!base) {
        const config = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
        base = ts.createProgram(diskSources().map(file => path.join(repoRoot, file)), { ...config?.options, noEmit: true });
    }
    return base;
}

/** The base program with `overlay` (repo-relative path → source) added, or in place of a file's own source. */
function programWith(overlay: ReadonlyMap<string, string>): ts.Program {
    const from = baseProgram();
    if (!overlay.size) return from;
    const options = from.getCompilerOptions();
    const host = ts.createCompilerHost(options, true);
    const added = new Map([...overlay].filter(([file]) => /\.tsx?$/u.test(file)).map(([file, text]) => [path.join(repoRoot, file), text]));
    const own = host.getSourceFile.bind(host), exists = host.fileExists.bind(host), reads = host.readFile.bind(host);
    host.getSourceFile = (fileName, version, onError, create) => {
        const text = added.get(path.resolve(fileName));
        return text !== undefined ? ts.createSourceFile(fileName, text, version, true) : from.getSourceFile(fileName) ?? own(fileName, version, onError, create);
    };
    host.fileExists = fileName => added.has(path.resolve(fileName)) || exists(fileName);
    host.readFile = fileName => added.get(path.resolve(fileName)) ?? reads(fileName);
    return ts.createProgram([...new Set([...from.getRootFileNames(), ...added.keys()])], options, host);
}

/** The repository's code, with `overlay` (repo-relative path → text) added or in place of files: for injections. */
export function codeWith(overlay: ReadonlyMap<string, string> = new Map()): Code {
    const parsed = new Map<string, ts.SourceFile>();
    const own = (file: string): boolean => /^src\/(?:webview|shared)\/.*\.ts$/u.test(file) && !file.endsWith('.d.ts');
    const files = [...new Set([...diskSources(), ...[...overlay.keys()].filter(own)])].sort();
    let program: ts.Program | undefined;
    const code: Code = {
        files,
        overlay,
        read: file => overlay.get(file) ?? readFileSync(path.join(repoRoot, file), 'utf8'),
        has: file => overlay.has(file) || existsSync(path.join(repoRoot, file)),
        parse(file) {
            let source = parsed.get(file);
            if (!source) {
                source = ts.createSourceFile(file, code.read(file), ts.ScriptTarget.Latest, true);
                parsed.set(file, source);
            }
            return source;
        },
        program: () => (program ??= programWith(overlay)),
    };
    return code;
}

/** The repository's code as it is. */
export const REPO: Code = codeWith();

// ── The table checked ──

/** The table the checks hold the code to: the charts' files and the lists beside them. */
export interface Table {
    readonly contracts: readonly ChartContract[];
    /** The ids of the files in plotContracts/charts (`<id>.ts`). */
    readonly chartFiles: readonly string[];
    readonly valueHelpers: readonly string[];
    readonly notChartValues: Readonly<Record<string, string>>;
    readonly schemaFields: Readonly<Record<string, readonly string[] | string>>;
    readonly backendReaders: Readonly<Record<string, BackendReader>>;
    readonly decimators: readonly string[];
}

export const TABLE: Table = {
    contracts: CONTRACTS,
    chartFiles: readdirSync(path.join(repoRoot, 'src/test/plotContracts/charts')).filter(name => name.endsWith('.ts')).map(name => name.replace(/\.ts$/u, '')).sort(),
    valueHelpers: VALUE_HELPERS,
    notChartValues: NOT_CHART_VALUES,
    schemaFields: SCHEMA_FIELDS,
    backendReaders: BACKEND_READERS,
    decimators: PY_DECIMATORS,
};

export const chartsOf = (table: Table): Chart[] => table.contracts.map(contract => contract.chart);
export const rowsOf = (table: Table): ContractRow[] => table.contracts.flatMap(contract => contract.rows.map(row => ({ ...row, chart: contract.chart.id })));
export const knownGapsOf = (table: Table): Record<string, Severity> => Object.assign({}, ...table.contracts.map(contract => contract.knownGaps)) as Record<string, Severity>;

// ── Syntax helpers ──

export function each(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, child => each(child, visit));
}

/** The name a function node is known by in its file: its own name, or the variable or property it is assigned to. */
export function functionName(node: ts.Node): string | null {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isGetAccessor(node)) && node.name) {
        return node.name.getText();
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) && ts.isIdentifier(node.parent.name)) {
        return node.parent.name.text;
    }
    return null;
}

/** The innermost named function a node is in, `<module>` outside any. */
export function enclosing(node: ts.Node): string {
    for (let at = node.parent as ts.Node | undefined; at; at = at.parent) {
        const name = functionName(at);
        if (name) return name;
    }
    return '<module>';
}

/** The function node a node is in, if any. */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
    for (let at = node.parent as ts.Node | undefined; at; at = at.parent) if (ts.isFunctionLike(at)) return at;
    return undefined;
}

/** A numeric literal that is a power of ten other than 1 (10, 100, 1e6, 0.1). */
function powerOfTen(node: ts.Node): boolean {
    if (!ts.isNumericLiteral(node)) return false;
    const exponent = Math.log10(Number(node.text));
    return exponent !== 0 && Math.abs(exponent - Math.round(exponent)) < 1e-9;
}

/** A value multiplied or divided by a power of ten, at its top or inside it (`v * 10`, `(a - b) * 100`). */
function scaledByTen(node: ts.Node): boolean {
    let found = false;
    each(node, inner => {
        if (ts.isBinaryExpression(inner) && [ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken].includes(inner.operatorToken.kind) && (powerOfTen(inner.left) || powerOfTen(inner.right))) found = true;
    });
    return found;
}

/**
 * A call that rounds a number to decimals by arithmetic: Math.round/trunc/floor/ceil of a value scaled by a power of
 * ten, or whose result is divided by one (`Math.round(v * 10) / 10`). Rounding of this kind is a number written, as
 * toFixed is: a value rounded and then computed with (a Δ of rounded levels) is a value the user is given wrong.
 */
function decimalRounding(node: ts.CallExpression): string | undefined {
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression) || callee.expression.text !== 'Math' || !MATH_ROUNDING.has(callee.name.text)) return undefined;
    let outer: ts.Node = node;
    while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
    const divided = ts.isBinaryExpression(outer.parent) && outer.parent.left === outer && outer.parent.operatorToken.kind === ts.SyntaxKind.SlashToken && powerOfTen(outer.parent.right);
    return divided || node.arguments.some(scaledByTen) ? `Math.${callee.name.text}` : undefined;
}

const namesIn = new WeakMap<Code, Map<string, Set<string>>>();
function functionsOf(code: Code, file: string): Set<string> {
    const byFile = namesIn.get(code) ?? new Map<string, Set<string>>();
    namesIn.set(code, byFile);
    let names = byFile.get(file);
    if (!names) {
        const found = new Set<string>();
        each(code.parse(file), node => {
            const name = functionName(node);
            if (name) found.add(name);
        });
        names = found;
        byFile.set(file, names);
    }
    return names;
}

/** Whether `file:name` names a function: a TS function, method or arrow by its name, or a Python def. */
export function exists(entry: string, code: Code = REPO): boolean {
    const at = entry.lastIndexOf(':');
    const file = entry.slice(0, at);
    const name = entry.slice(at + 1);
    if (!code.has(file)) return false;
    if (file.endsWith('.py')) return [...pythonDefBodies(code.read(file)).keys()].some(def => def.slice(def.lastIndexOf('.') + 1) === name);
    return functionsOf(code, file).has(name);
}

// ── Who writes a number ──

/** The helpers a file can call, by the local name it calls them: its own, and those it imports from a relative path. */
function helpersIn(code: Code, file: string, helpers: ReadonlySet<string>): Map<string, string> {
    const local = new Map<string, string>();
    for (const helper of helpers) {
        const at = helper.lastIndexOf(':');
        if (helper.slice(0, at) === file) local.set(helper.slice(at + 1), helper);
    }
    for (const statement of code.parse(file).statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const bindings = statement.importClause?.namedBindings;
        const specifier = statement.moduleSpecifier.text;
        if (!bindings || !ts.isNamedImports(bindings) || !specifier.startsWith('.')) continue;
        const target = path.posix.join(path.posix.dirname(file), `${specifier}.ts`);
        for (const element of bindings.elements) {
            const helper = `${target}:${(element.propertyName ?? element.name).text}`;
            if (helpers.has(helper)) local.set(element.name.text, helper);
        }
    }
    return local;
}

/** The functions of one file that write a number (call a number primitive or a value helper), with what they call. */
export function writersIn(file: string, helpers: ReadonlySet<string>, writers: Map<string, Set<string>>, code: Code = REPO): void {
    const local = helpersIn(code, file, helpers);
    each(code.parse(file), node => {
        // A local alias of a helper (`const hz = frequencyText`) is the helper.
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(node.initializer)) {
            const helper = local.get(node.initializer.text);
            if (helper) local.set(node.name.text, helper);
        }
        if (!ts.isCallExpression(node)) return;
        const callee = node.expression;
        const called = ts.isPropertyAccessExpression(callee) && NUMBER_TEXT.has(callee.name.text) ? callee.name.text
            : decimalRounding(node) ?? (ts.isIdentifier(callee) ? local.get(callee.text) : undefined);
        if (!called) return;
        const writer = `${file}:${enclosing(node)}`;
        if (writer === called) return;
        const calls = writers.get(writer) ?? new Set<string>();
        calls.add(called);
        writers.set(writer, calls);
    });
}

/**
 * Every function in src/webview and src/shared that writes a number a user reads: one that calls a number primitive
 * or a value helper (by its own name, an imported name, or a local alias of either), with what it calls.
 */
export function numberWriters(code: Code = REPO, table: Table = TABLE): Map<string, Set<string>> {
    const helpers = new Set(table.valueHelpers);
    const writers = new Map<string, Set<string>>();
    for (const file of code.files) writersIn(file, helpers, writers, code);
    // A function that rounds to decimals by arithmetic (`round1`) is a helper too: whoever calls it writes a number.
    for (const [writer, calls] of writers) if ([...calls].some(call => call.startsWith('Math.'))) helpers.add(writer);
    writers.clear();
    for (const file of code.files) writersIn(file, helpers, writers, code);
    // And every number written into text a user reads, by its type (String(n), `${n}`, n + ' Hz', a number itself).
    // Text made by a function a row already names (`loopRegionClockText`) is that row's: writing it is not a new path.
    const registered = new Set(rowsOf(table).flatMap(row => row.computedIn));
    for (const [writer, how] of numericTextWriters(code.program(), code.files)) {
        const fresh = [...how].filter(call => !registered.has(call.split(' ')[0]));
        if (!fresh.length) continue;
        const calls = writers.get(writer) ?? new Set<string>();
        for (const call of fresh) calls.add(call);
        writers.set(writer, calls);
    }
    return writers;
}

/** Properties whose value is text a user reads: an element's text or markup, a field's value, a tooltip. */
const TEXT_PROPERTIES = new Set(['textContent', 'innerText', 'innerHTML', 'outerHTML', 'nodeValue', 'value', 'title', 'placeholder', 'alt', 'ariaLabel', 'ariaValueText', 'ariaValueNow']);
/** Calls whose argument (by index) is text a user reads: canvas text, a text node, an attribute, inserted content. */
const TEXT_CALLS: Readonly<Record<string, readonly number[]>> = {
    fillText: [0], strokeText: [0], createTextNode: [0], setAttribute: [1], setAttributeNS: [2], insertAdjacentText: [1], insertAdjacentHTML: [1],
    append: [0, 1, 2, 3], prepend: [0, 1, 2, 3], replaceChildren: [0, 1, 2, 3], after: [0, 1, 2], before: [0, 1, 2], replaceWith: [0, 1, 2], write: [0],
};

/**
 * Every function of `files` that writes a number into text a user reads, found by type, not by a call's name: a
 * number-typed value given to a text sink (TEXT_PROPERTIES, TEXT_CALLS, a `data-` attribute), or text made of one
 * (`String(n)`, `${n}`, `n + ' Hz'`, `n.toString()`, a join of numbers), directly or through a local, or returned by
 * a function that makes such text (then whoever writes its result writes a number, by that function).
 *
 * What this is for, and what it is not: it keeps the table's list of number-writing functions complete for these
 * direct forms, so a reviewer knows where to look. It does not follow text kept in a property or a field and
 * written later (`row.label = n.toFixed(1)` … `el.textContent = row.label`), nor a number that leaves through
 * `any`. It is not what keeps a chart's value from being a thinned point: that is the types (a readout, a headline
 * and an export take `Whole`; a thinned point is `Drawn` and cannot be formatted; provenanceBoundary.test.ts).
 */
const textWriters = new WeakMap<ts.Program, Map<string, Map<string, Set<string>>>>();
export function numericTextWriters(program: ts.Program, files: readonly string[]): Map<string, Set<string>> {
    // The same program and files give the same writers: found once (the guide's example asks again for each omission).
    const byFiles = textWriters.get(program) ?? new Map<string, Map<string, Set<string>>>();
    textWriters.set(program, byFiles);
    const key = files.join('\n');
    const known = byFiles.get(key);
    if (known) return known;
    const found = findNumericTextWriters(program, files);
    byFiles.set(key, found);
    return found;
}

function findNumericTextWriters(program: ts.Program, files: readonly string[]): Map<string, Set<string>> {
    const checker = program.getTypeChecker();
    const numeric = (node: ts.Node): boolean => {
        const type = checker.getTypeAtLocation(node);
        const parts = type.isUnion() ? type.types : [type];
        return parts.some(part => (part.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike)) !== 0);
    };
    const numericArray = (node: ts.Node): boolean => {
        const type = checker.getTypeAtLocation(node);
        const element = checker.isArrayType(type) ? checker.getTypeArguments(type as ts.TypeReference)[0] : undefined;
        return !!element && ((element.isUnion() ? element.types : [element]).some(part => (part.flags & ts.TypeFlags.NumberLike) !== 0));
    };
    const sources = files.map(file => program.getSourceFile(path.join(repoRoot, file))).filter((source): source is ts.SourceFile => !!source);
    const fileOf = (node: ts.Node): string => path.relative(repoRoot, node.getSourceFile().fileName).split(path.sep).join('/');
    const nameOf = (node: ts.Node): string => `${fileOf(node)}:${enclosing(node)}`;
    // Functions whose result is text made of a number, by their declaration: found to a fixed point.
    const makers = new Map<ts.Node, string>();
    const declarationOf = (callee: ts.Expression): ts.Node | undefined => {
        let symbol = checker.getSymbolAtLocation(callee);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const declaration = symbol?.valueDeclaration;
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isFunctionLike(declaration.initializer)) return declaration.initializer;
        return declaration;
    };
    const seen = new Set<ts.Node>();
    /** What makes `node` text of a number, if anything does: a conversion's name, or a maker's `file:function`. */
    const textOfNumber = (node: ts.Node): string | undefined => {
        if (seen.has(node)) return undefined;
        seen.add(node);
        try {
            if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return textOfNumber(node.expression);
            if (ts.isTemplateExpression(node)) {
                for (const span of node.templateSpans) if (numeric(span.expression)) return 'a template of a number';
                for (const span of node.templateSpans) { const inner = textOfNumber(span.expression); if (inner) return inner; }
                return undefined;
            }
            if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && !numeric(node)) {
                if (numeric(node.left) || numeric(node.right)) return 'a number joined to text';
                return textOfNumber(node.left) ?? textOfNumber(node.right);
            }
            if (ts.isConditionalExpression(node)) return textOfNumber(node.whenTrue) ?? textOfNumber(node.whenFalse);
            if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return textOfNumber(node.left) ?? textOfNumber(node.right);
            if (ts.isCallExpression(node)) {
                const callee = node.expression;
                if (ts.isIdentifier(callee) && callee.text === 'String' && node.arguments[0] && numeric(node.arguments[0])) return 'String of a number';
                if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'toString' && numeric(callee.expression)) return 'a number\'s toString';
                if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'join' && numericArray(callee.expression)) return 'a join of numbers';
                const declaration = declarationOf(callee);
                const maker = declaration ? makers.get(declaration) : undefined;
                if (maker) return maker;
                return undefined;
            }
            if (ts.isIdentifier(node)) {
                const declaration = declarationOf(node);
                if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && declaration.getSourceFile() === node.getSourceFile()) return textOfNumber(declaration.initializer);
            }
            return undefined;
        } finally {
            seen.delete(node);
        }
    };
    /** Where each maker's text of a number is made, first: what a write through it is told by. */
    const roots = new Map<string, string>();
    for (let grown = true; grown;) {
        grown = false;
        for (const source of sources) each(source, node => {
            if (!ts.isFunctionLike(node) || makers.has(node) || !functionName(node)) return;
            const body = (node as ts.FunctionLikeDeclaration).body;
            if (!body) return;
            const returned: ts.Expression[] = [];
            if (!ts.isBlock(body)) returned.push(body);
            else each(body, inner => { if (ts.isReturnStatement(inner) && inner.expression && enclosingFunction(inner) === node) returned.push(inner.expression); });
            const making = returned.find(expression => !numeric(expression) && textOfNumber(expression));
            if (making) {
                const name = `${fileOf(node)}:${functionName(node)}`;
                makers.set(node, name);
                const reason = textOfNumber(making) ?? '';
                roots.set(name, roots.get(reason) ?? `${reason} at ${fileOf(making)}:${making.getSourceFile().getLineAndCharacterOfPosition(making.getStart()).line + 1}`);
                grown = true;
            }
        });
    }
    const writers = new Map<string, Set<string>>();
    const write = (at: ts.Node, value: ts.Expression): void => {
        const how = numeric(value) ? 'a number' : textOfNumber(value);
        if (!how) return;
        const writer = nameOf(at);
        if (writer === how) return;
        const calls = writers.get(writer) ?? new Set<string>();
        const root = roots.get(how);
        calls.add(`${how}${root ? ` (${root})` : ''} at line ${at.getSourceFile().getLineAndCharacterOfPosition(at.getStart()).line + 1}`);
        writers.set(writer, calls);
    };
    for (const source of sources) each(source, node => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))) {
            const target = node.left;
            const property = ts.isPropertyAccessExpression(target) ? target.name.text : undefined;
            const dataset = ts.isPropertyAccessExpression(target.expression) && target.expression.name.text === 'dataset';
            if ((property && TEXT_PROPERTIES.has(property)) || dataset) write(node, node.right);
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const indices = Object.hasOwn(TEXT_CALLS, node.expression.name.text) ? TEXT_CALLS[node.expression.name.text] : undefined;
            if (indices) for (const index of indices) if (node.arguments[index]) write(node, node.arguments[index]);
        }
    });
    return writers;
}

/**
 * Every use of the plot component outside it, by the function that makes it. Found by symbol: any name that resolves
 * to one of stagePanes.ts's painters, whatever it is imported as (`paintOverlay as draw`, `panes.paintOverlay`) and
 * whether it is called there or handed on as a value.
 */
export function plotCallers(program: ts.Program = REPO.program(), files: readonly string[] = REPO.files): Set<string> {
    const checker = program.getTypeChecker();
    const callers = new Set<string>();
    for (const file of files) {
        if (file === STAGE_PANES) continue;
        const source = program.getSourceFile(path.join(repoRoot, file));
        if (!source) continue;
        each(source, node => {
            if (!ts.isIdentifier(node) || ts.isImportSpecifier(node.parent) || ts.isExportSpecifier(node.parent)) return;
            const found = checker.getSymbolAtLocation(node);
            const target = found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
            const painter = target?.declarations?.some(declaration => path.relative(repoRoot, declaration.getSourceFile().fileName).split(path.sep).join('/') === STAGE_PANES && PLOT_COMPONENT.has(target.name));
            if (painter) callers.add(`${file}:${enclosing(node)}`);
        });
    }
    return callers;
}

// ── The backend's readers of thinned points ──

/** The backend's modules (not its tests), by module name, as check_decimation_flow.py reads them; the overlay's too. */
export function pythonSources(code: Code = REPO): Record<string, string> {
    const names = new Set([
        ...readdirSync(path.join(repoRoot, PYTHON)),
        ...[...code.overlay.keys()].filter(file => file.startsWith(`${PYTHON}/`) && !file.slice(PYTHON.length + 1).includes('/')).map(file => file.slice(PYTHON.length + 1)),
    ]);
    return Object.fromEntries([...names].filter(item => item.endsWith('.py') && !item.startsWith('test_') && item !== 'conftest.py').sort().map(name => [name.slice(0, -3), code.read(`${PYTHON}/${name}`)]));
}

/** Every def of the backend's modules (not its tests), with its body. */
function pythonDefs(code: Code): Map<string, string> {
    const defs = new Map<string, string>();
    const files = Object.keys(pythonSources(code)).map(name => `${PYTHON}/${name}.py`);
    // Every def by the one Python discovery (namedTest.ts pythonDiscovery), a method by its own name as the table names it.
    pythonDiscovery(files.map(file => code.read(file)));
    for (const file of files) {
        for (const [name, body] of pythonDefBodies(code.read(file))) {
            const own = name.slice(name.lastIndexOf('.') + 1);
            if (!defs.has(`${file}:${own}`)) defs.set(`${file}:${own}`, body);
        }
    }
    return defs;
}

/** check_decimation_flow.py's readers: every backend def computing with drawn points, by the AST data flow. */
export function pythonFlowReaders(sources?: Readonly<Record<string, string>>): Record<string, string[]> {
    const python = pythonExecutable();
    const script = sources
        ? ['-c', 'import json,sys; sys.path.insert(0, "scripts"); import check_decimation_flow as c; print(json.dumps(c.find_readers(json.loads(sys.stdin.buffer.read().decode("utf-8")))))']
        : ['scripts/check_decimation_flow.py', '--readers'];
    const run = spawnSync(python, script, { cwd: repoRoot, encoding: 'utf8', input: sources ? JSON.stringify(sources) : undefined });
    assert.equal(run.status, 0, `check_decimation_flow.py --readers: ${run.stderr}`);
    return JSON.parse(run.stdout) as Record<string, string[]>;
}

/**
 * The backend's defs that read drawn points: those that call a decimator, and every def whose own code computes
 * with drawn points however they reached it (a returned view's values, a dict, an attribute, a subscript, a call in
 * another module), as check_decimation_flow.py follows them through the backend's AST.
 */
export function pythonDrawn(readers: Readonly<Record<string, readonly string[]>> = pythonFlowReaders(), code: Code = REPO, decimatorsListed: readonly string[] = TABLE.decimators): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    const decimators = decimatorsListed.map(entry => ({ entry, name: entry.slice(entry.lastIndexOf(':') + 1) }));
    for (const [def, body] of pythonDefs(code)) {
        const calls = decimators.filter(item => item.entry !== def && new RegExp(`\\b${item.name}\\(`).test(body.slice(body.indexOf('\n'))));
        if (calls.length) found.set(def, new Set(calls.map(item => item.entry)));
    }
    for (const [def, origins] of Object.entries(readers)) {
        if (decimatorsListed.includes(def)) continue;
        found.set(def, new Set([...(found.get(def) ?? []), ...origins]));
    }
    return found;
}

// ── Proofs: a test that tells the full data from the drawn points ──

/** Why a row is not yet held, if it is not. */
export function reasons(row: ContractRow): string[] {
    return [
        ...(row.tests.length === 0 ? ['no test holds it'] : []),
        ...(row.from === 'thinned' || row.from === 'extremes' ? [`it is computed from thinned points (${row.from})`] : []),
        ...(row.from === 'full' && !row.tests.some(item => item.tells) ? ['no test it names tells the full data from the drawn points'] : []),
        ...(row.breaks ? [`it breaks ${row.breaks.rule}`] : []),
        ...(row.names && !(row.names.quantity && row.names.unit && row.names.reference !== false) ? ['its axis name lacks its quantity, unit or reference'] : []),
    ];
}

/** A test given as proof that code computes from the full data, not the drawn points. */
export interface Proof { file: string; name: string }

/** What a newcomer needs when a proof fails: the rule, and what to write. */
const PROOF_HELP = [
    'Rule: a test marked tt(...) in src/test/plotContracts/charts must prove its row is computed from the full data, not the points thinned to draw.',
    'It must (1) use one of the row\'s computedIn functions (itself, a function of its file that calls it, or a helper of the test file that does; a pytest: an import that calls it);',
    '(2) assert that code\'s answer outright (assert.equal / deepEqual / match, or pytest `==`); and',
    '(3) assert it is not the answer the drawn points give: assertNotDrawn(answer, drawnAnswer) from src/test/fullNotDrawn.ts (pytest: assert_not_drawn from conftest.py), with the code\'s answer first and drawnAnswer worked out in the test from the thinned data, never null or a constant. No other assertion (notEqual, a margin) counts. (2) and (3) are of the same value: write the same expression in both.',
    'If this test cannot do that, mark it t(...) instead and give the row another tt(...) test that does. See docs/plot-contracts-guide.md.',
].join(' ');

/**
 * Every test a row marks `tells` (model.ts `tt`), checked by what it does, not its words: why each is no proof.
 * `rows` and `check` are parameters for the injections.
 */
export function tellsProblems(rows: readonly ContractRow[] = rowsOf(TABLE), check: (targets: readonly string[], proof: Proof) => string | null = proofProblem): string[] {
    const problems: string[] = [];
    for (const row of rows) {
        for (const named of row.tests.filter(item => item.tells)) {
            const problem = check(row.computedIn, named);
            if (problem) problems.push(`${row.id}: ${problem}. ${PROOF_HELP}`);
        }
    }
    return problems;
}

/** What declares a function: itself, or for an arrow the variable or property it is assigned to. */
function functionDeclared(node: ts.Node): ts.Node | undefined {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node)) return node;
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent))) return node.parent;
    return undefined;
}

const callerGraphs = new WeakMap<ts.Program, Map<ts.Node, Set<ts.Node>>>();
/**
 * Who uses each function of the product code, across files: a function's declaration → the declarations of the
 * functions that call it or hand it on. Built once for a program, by what each name declares, so a function moved
 * to another module (or re-exported from one) is still reached by the same callers.
 */
function callersOf(program: ts.Program, files: readonly string[]): Map<ts.Node, Set<ts.Node>> {
    let graph = callerGraphs.get(program);
    if (graph) return graph;
    const checker = program.getTypeChecker();
    const found = new Map<ts.Node, Set<ts.Node>>();
    for (const file of files) {
        const source = program.getSourceFile(path.join(repoRoot, file));
        if (!source) continue;
        const walk = (node: ts.Node, within: ts.Node | undefined): void => {
            const inside = functionDeclared(node) ?? within;
            if (inside && ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && !ts.isExportSpecifier(node.parent)) {
                const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
                const declared = (symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)?.declarations?.[0];
                const used = declared && (functionDeclared(declared) ?? (ts.isVariableDeclaration(declared) || ts.isPropertyAssignment(declared) ? declared.initializer && functionDeclared(declared.initializer) : undefined));
                if (used && used !== inside) {
                    const callers = found.get(used) ?? new Set<ts.Node>();
                    callers.add(inside);
                    found.set(used, callers);
                }
            }
            ts.forEachChild(node, child => walk(child, inside));
        };
        walk(source, undefined);
    }
    graph = found;
    callerGraphs.set(program, graph);
    return graph;
}

/** The one way a proof says "not the drawn points' answer": this function, found by its declaration, not its name. */
const NOT_DRAWN = { file: 'src/test/fullNotDrawn.ts', name: 'assertNotDrawn' };
/** The node:assert calls that state an answer outright. */
const OUTRIGHT = new Set(['equal', 'deepEqual', 'strictEqual', 'deepStrictEqual', 'match']);

/** `code` with every TS test `rows` give as proof in its program, so a name in a test is known by what it declares. */
export function withProofs(rows: readonly ContractRow[], code: Code = REPO): Code {
    const files = new Set(rows.flatMap(row => row.tests).filter(item => item.tells && item.file.endsWith('.ts') && code.has(item.file)).map(item => item.file));
    return codeWith(new Map([...code.overlay, ...[...files].filter(file => !code.overlay.has(file)).map(file => [file, code.read(file)] as const)]));
}

let proofs: Code | undefined;
const repoProofs = (): Code => (proofs ??= withProofs(rowsOf(TABLE)));

/** The function a `test('name', () => { … })` call of `source` runs. */
function testBody(source: ts.SourceFile, name: string): ts.Node | undefined {
    let body: ts.Node | undefined;
    each(source, node => {
        if (body || !ts.isCallExpression(node)) return;
        const callee = node.expression;
        const isTest = (ts.isIdentifier(callee) && callee.text === 'test') || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'test');
        const title = node.arguments[0];
        if (isTest && title && ts.isStringLiteralLike(title) && title.text === name) body = node.arguments.find(argument => ts.isFunctionLike(argument));
    });
    return body;
}

/**
 * Why `proof` does not show that one of `targets` (`file:function`) is given the full data where the drawn points
 * differ, or null. Every name is followed to its declaration with the type checker, so an import under another name,
 * a namespace import or a look-alike local of the same spelling changes nothing. The test must:
 *
 * 1. use the code under test: one of the targets, a function of the product that reaches one (in any file, so a
 *    function moved to another module keeps its proofs), or a helper of the test file that does;
 * 2. state that code's answer outright with node:assert (OUTRIGHT);
 * 3. call `assertNotDrawn(answer, drawnAnswer)` (src/test/fullNotDrawn.ts) with that code's answer first and, second,
 *    something worked out in the test: not a constant, a local holding one, or the first argument again.
 * 4. do 2 and 3 of the same value: the expression stated outright is the one told apart, as text.
 *
 * What this cannot see: whether `drawnAnswer` really is what the thinned points would give, and whether the answer
 * asserted is the value the row is about. Those are for the reviewer (docs/plot-contracts-guide.md).
 */
export function proofProblem(targets: readonly string[], proof: Proof, program: ts.Program = repoProofs().program(), files: readonly string[] = REPO.files): string | null {
    // A UI test drives the whole app: nothing ties what it reads off the page to this row's code, so it is support
    // (t(...)), never the proof. The proof is a unit test that calls the row's code with data whose drawn points differ.
    if (proof.file.startsWith('src/test/uiSmoke/')) return `"${proof.name}" is a UI test, which cannot show which code made the value it reads: mark it t(...) and give the row a unit test as its tt(...) proof`;
    if (proof.file.endsWith('.py')) return existsSync(path.join(repoRoot, proof.file)) ? pythonProof(targets, { file: proof.file, name: proof.name }) : `no file ${proof.file}`;
    const source = program.getSourceFile(path.join(repoRoot, proof.file));
    if (!source) return `no file ${proof.file}`;
    const problem = testProblem(proof.file, source.text, proof.name);
    if (problem) return problem;
    const body = testBody(source, proof.name);
    if (!body) return `"${proof.name}" is not written as test('…', () => { … }) in ${proof.file}`;
    const checker = program.getTypeChecker();
    const symbolAt = (node: ts.Node): ts.Symbol | undefined => (ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node));
    /** What a name declares, through imports and re-exports. */
    const declarationOf = (node: ts.Node): ts.Node | undefined => {
        const symbol = symbolAt(node);
        return (symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)?.declarations?.[0];
    };
    const names = (node: ts.Node): ts.Identifier[] => {
        const found: ts.Identifier[] = [];
        each(node, inner => { if (ts.isIdentifier(inner)) found.push(inner); });
        return found;
    };

    // The code under test: the row's functions, and every function of the product that reaches one, in any file.
    const under = new Set<ts.Node>();
    for (const target of targets) {
        const at = target.lastIndexOf(':');
        const file = target.slice(0, at), name = target.slice(at + 1);
        const code = file.endsWith('.ts') ? program.getSourceFile(path.join(repoRoot, file)) : undefined;
        if (!code) continue;
        each(code, node => {
            const declared = functionName(node) === name ? functionDeclared(node) : undefined;
            if (declared) under.add(declared);
        });
    }
    const callers = callersOf(program, files);
    for (const reached of under) for (const caller of callers.get(reached) ?? []) under.add(caller);
    const reaches = (node: ts.Node): boolean => names(node).some(name => { const declared = declarationOf(name); return !!declared && under.has(declared); });
    // A helper of the test file that runs the code under test gives its answer too.
    for (let grown = true; grown;) {
        grown = false;
        for (const statement of source.statements) {
            const helpers = ts.isFunctionDeclaration(statement) ? [statement] : ts.isVariableStatement(statement) ? statement.declarationList.declarations.filter(item => item.initializer && ts.isFunctionLike(item.initializer)) : [];
            for (const helper of helpers) if (!under.has(helper) && reaches(helper)) { under.add(helper); grown = true; }
        }
    }
    if (!reaches(body)) return `"${proof.name}" never uses the row's code (${targets.join(', ')})`;

    // The locals that hold an answer of the code under test: bound from it (`const range = stageRange(...)`, every
    // name of `const { drawn, canvases } = f(...)`), or handed to it to fill (a canvas, a recorder).
    const answers = new Set<ts.Symbol>();
    const answer = (node: ts.Node): boolean => reaches(node) || names(node).some(name => { const symbol = symbolAt(name); return !!symbol && answers.has(symbol); });
    const hold = (name: ts.Node): boolean => {
        const symbol = symbolAt(name);
        if (!symbol || answers.has(symbol)) return false;
        answers.add(symbol);
        return true;
    };
    each(body, node => {
        if (ts.isCallExpression(node) && reaches(node.expression)) for (const argument of node.arguments) if (ts.isIdentifier(argument)) hold(argument);
    });
    for (let grown = true; grown;) {
        grown = false;
        each(body, node => {
            if (!ts.isVariableDeclaration(node) || !node.initializer || !answer(node.initializer)) return;
            for (const name of names(node.name)) if (!(ts.isBindingElement(name.parent) && name.parent.propertyName === name) && hold(name)) grown = true;
        });
    }
    const notDrawn = program.getSourceFile(path.join(repoRoot, NOT_DRAWN.file))?.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === NOT_DRAWN.name);
    const isNotDrawn = (call: ts.CallExpression): boolean => !!notDrawn && declarationOf(ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression) === notDrawn;
    /** Whether `node` is the `assert` of node:assert, by its import. */
    const isAssert = (node: ts.Node): boolean => {
        let declared: ts.Node | undefined = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node)?.declarations?.[0] : undefined;
        while (declared && !ts.isImportDeclaration(declared)) declared = declared.parent;
        return !!declared && ts.isStringLiteral(declared.moduleSpecifier) && /^(?:node:)?assert(?:\/strict)?$/u.test(declared.moduleSpecifier.text);
    };
    const asserting = (node: ts.Node): boolean => {
        for (let at = node.parent; at !== body; at = at.parent) {
            if (ts.isCallExpression(at) && (isNotDrawn(at) || isAssert(at.expression) || (ts.isPropertyAccessExpression(at.expression) && isAssert(at.expression.expression)))) return true;
        }
        return false;
    };
    // A constant: literals, and locals of the test that hold only literals and are used in assertions alone. A local
    // of literals that the test also hands on (to the code under test, or into other data) is an input, not a constant.
    const fixed = new Set<ts.Symbol>();
    const constant = (node: ts.Node): boolean => names(node).every(name => {
        if (['undefined', 'NaN', 'Infinity'].includes(name.text)) return true;
        if ((ts.isPropertyAccessExpression(name.parent) || ts.isPropertyAssignment(name.parent)) && name.parent.name === name) return true;
        const symbol = symbolAt(name);
        return !!symbol && fixed.has(symbol);
    });
    const handedOn = new Set<ts.Symbol>();
    for (const name of names(body)) {
        const symbol = (ts.isVariableDeclaration(name.parent) && name.parent.name === name) || asserting(name) ? undefined : symbolAt(name);
        if (symbol) handedOn.add(symbol);
    }
    for (let grown = true; grown;) {
        grown = false;
        each(body, node => {
            const symbol = ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && constant(node.initializer) ? symbolAt(node.name) : undefined;
            if (symbol && !fixed.has(symbol) && !handedOn.has(symbol)) { fixed.add(symbol); grown = true; }
        });
    }

    // The value stated outright and the value told apart from the drawn points must be the same one: the same
    // expression, compared as text (`read?.value` twice), not two answers of the same code.
    const same = (node: ts.Node): string => node.getText().replace(/\s+/gu, '').replace(/\?\./gu, '.').replace(/!/gu, '');
    const stated = new Set<string>();
    const told: string[] = [];
    each(body, node => {
        if (!ts.isCallExpression(node)) return;
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee) && OUTRIGHT.has(callee.name.text) && isAssert(callee.expression)) for (const argument of node.arguments.slice(0, 2)) if (answer(argument)) stated.add(same(argument));
        if (!isNotDrawn(node)) return;
        const [mine, drawn] = node.arguments;
        if (mine && drawn && answer(mine) && !constant(drawn) && mine.getText() !== drawn.getText()) told.push(same(mine));
    });
    if (!stated.size) return `"${proof.name}" never asserts the answer of the row's code outright (assert.equal, deepEqual or match on what it returns)`;
    if (!told.length) return `"${proof.name}" asserts no case where the full data and the drawn points give different answers`;
    if (!told.some(text => stated.has(text))) return `"${proof.name}" states one value outright (${[...stated].slice(0, 3).join('; ')}) and tells another apart from the drawn points (${told.slice(0, 3).join('; ')}): assert.equal(X, expected) and assertNotDrawn(X, drawnAnswer) must be of the same expression X`;
    return null;
}

let pythonAnswers: Map<string, string | null> | undefined;
/**
 * What scripts/check_test_proofs.py finds of a pytest given as proof (its problem, or null). The script is run once
 * for every pytest the table names (it reads the whole backend to follow calls), and asked again only for a proof
 * that is not in the table (an injection).
 */
export function pythonProof(targets: readonly string[], proof: Proof): string | null {
    const key = (item: { targets: readonly string[]; proof: Proof }): string => JSON.stringify([item.targets, item.proof.file, item.proof.name]);
    const ask = (items: ReadonlyArray<{ targets: readonly string[]; proof: Proof }>): Array<string | null> => {
        const python = pythonExecutable();
        const input = JSON.stringify(items.map(item => ({ targets: item.targets, file: item.proof.file, name: item.proof.name })));
        const run = spawnSync(python, ['scripts/check_test_proofs.py'], { cwd: repoRoot, encoding: 'utf8', input });
        assert.equal(run.status, 0, `check_test_proofs.py: ${run.stderr}`);
        return JSON.parse(run.stdout) as Array<string | null>;
    };
    if (!pythonAnswers) {
        const items = rowsOf(TABLE).flatMap(row => row.tests.filter(item => item.tells && item.file.endsWith('.py')).map(item => ({ targets: row.computedIn, proof: { file: item.file, name: item.name } })));
        const answers = ask(items);
        pythonAnswers = new Map(items.map((item, index) => [key(item), answers[index]]));
    }
    const asked = { targets, proof };
    if (!pythonAnswers.has(key(asked))) pythonAnswers.set(key(asked), ask([asked])[0]);
    return pythonAnswers.get(key(asked)) ?? null;
}

// ── The checks: each asserts with the message that names the rule and the fix ──

export function checkRowsAndKinds(table: Table = TABLE): void {
    const rows = rowsOf(table), charts = chartsOf(table).map(chart => chart.id);
    const ids = rows.map(row => row.id);
    assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), [], 'row ids repeat');
    assert.deepEqual(charts.filter((id, index) => charts.indexOf(id) !== index), [], 'chart ids repeat');
    for (const row of rows) {
        assert.ok(charts.includes(row.chart), `${row.id}: no chart ${row.chart}`);
        assert.ok(row.id.startsWith(`${row.chart}.`), `${row.id}: its id does not start with its chart`);
        assert.ok(row.computedIn.length > 0, `${row.id}: says nowhere it is computed`);
    }
    for (const chart of chartsOf(table)) {
        const kinds = new Set(rows.filter(row => row.chart === chart.id).map(row => row.value));
        assert.deepEqual(chart.requires.filter(kind => !kinds.has(kind)), [], `${chart.id} has no row for these values it shows. Rule: a chart has a row for every kind of value in its \`requires\`. Fix: add a row of each kind to src/test/plotContracts/charts/${chart.id}.ts.`);
    }
}

export function checkPlotCallers(code: Code = REPO, table: Table = TABLE): void {
    const painted = new Set(chartsOf(table).flatMap(chart => chart.paintedBy));
    assert.deepEqual([...plotCallers(code.program(), code.files)].filter(caller => !painted.has(caller)).sort(), [], 'Rule: every call of the plot component (paintOverlay, paintStage, paintSideAxis, paintTimeAxis) belongs to a chart of the contract table. These functions call it but no chart lists them. Fix: add each to the paintedBy of its chart in src/test/plotContracts/charts/<chart>.ts, or add a new chart file there (and to index.ts) with a row for every value a user reads off it. See docs/plot-contracts-guide.md.');
    assert.deepEqual([...painted].filter(entry => !exists(entry, code)).sort(), [], 'a chart is drawn by a function that does not exist');
}

export function checkNamedTestsRun(code: Code = REPO, table: Table = TABLE): void {
    for (const row of rowsOf(table)) {
        for (const named of row.tests) {
            assert.ok(code.has(named.file), `${row.id}: names a test in ${named.file}, which does not exist. Rule: every test a row of the contract table names is a test that runs. Fix: give the file's path from the repository root as it is now in that row's tests (src/test/plotContracts/charts/${row.chart}.ts).`);
            const problem = testProblem(named.file, code.read(named.file), named.name);
            assert.equal(problem, null, `${row.id}: ${problem}. Rule: every test a row names runs and asserts something. Fix: name it by its title as written in ${named.file} (src/test/plotContracts/charts/${row.chart}.ts), or make the test assert.`);
        }
    }
}

export function checkNamedFunctionsExist(code: Code = REPO, table: Table = TABLE): void {
    const named = [...rowsOf(table).flatMap(row => row.computedIn), ...table.valueHelpers, ...Object.keys(table.notChartValues)];
    assert.deepEqual([...new Set(named)].filter(entry => !exists(entry, code)).sort(), [], 'Rule: every function the contract table names (a row\'s computedIn in src/test/plotContracts/charts, VALUE_HELPERS or NOT_CHART_VALUES in src/test/plotContracts/values.ts) is a function of that file today, or a def of that Python module. These are not. Fix: if the function was renamed or moved, write its new `file:function` (`python-backend/module.py:def` for Python) where it is listed; if it is gone, remove the entry (and, for a row, name the function that computes the value now).');
}

export function checkNumberWriters(code: Code = REPO, table: Table = TABLE): void {
    const writers = numberWriters(code, table);
    const listed = new Set([...rowsOf(table).flatMap(row => row.computedIn), ...table.valueHelpers, ...Object.keys(table.notChartValues)]);
    const unlisted = [...writers].filter(([writer]) => !listed.has(writer)).map(([writer, calls]) => `${writer} (${[...calls].sort().join(', ')})`).sort();
    assert.deepEqual(unlisted, [], 'Rule: every function that writes a number a user can read belongs to the contract table. These write one (the parentheses say how and where) and nothing lists them. Fix, one of: (1) it is a value of a chart: add the function to computedIn of its row in src/test/plotContracts/charts/<chart>.ts (or add a row); (2) it only formats or computes for others: add it to VALUE_HELPERS in src/test/plotContracts/values.ts; (3) it is not a chart\'s value (a setting\'s field, a test attribute, a CSS size): add it to NOT_CHART_VALUES there with one sentence saying why. See docs/plot-contracts-guide.md.');
    // A function that no longer writes a number is no longer not a chart's value.
    assert.deepEqual(Object.keys(table.notChartValues).filter(entry => !writers.has(entry)).sort(), [], 'Rule: NOT_CHART_VALUES lists only functions that write a number today. Fix: remove these lines from src/test/plotContracts/values.ts.');
    for (const [entry, why] of Object.entries(table.notChartValues)) assert.ok(why.trim().length > 0, `${entry}: says no why. Rule: a number writer that is no chart's value says why in one sentence. Fix: write it as its entry in NOT_CHART_VALUES (src/test/plotContracts/values.ts).`);
}

export function checkChartFilesGathered(table: Table = TABLE): void {
    assert.deepEqual([...table.chartFiles].sort(), chartsOf(table).map(chart => chart.id).sort(), 'Rule: a chart\'s file in src/test/plotContracts/charts is named by its chart\'s id, and index.ts lists every one (CONTRACTS). Fix: add the chart to CONTRACTS in src/test/plotContracts/index.ts, or name its file by its id.');
    for (const contract of table.contracts) {
        const own = new Set(contract.rows.map(row => row.id));
        assert.deepEqual(Object.keys(contract.knownGaps).filter(id => !own.has(id)), [], `${contract.chart.id} lists gaps of rows not its own`);
    }
}

export function checkBackendReaders(readers: Readonly<Record<string, readonly string[]>> = pythonFlowReaders(), code: Code = REPO, table: Table = TABLE): void {
    const python = pythonDrawn(readers, code, table.decimators);
    assert.deepEqual(table.decimators.filter(entry => !exists(entry, code)), [], 'Rule: every decimator in python-backend/drawn_points_contract.json is a def of the backend. Fix: remove or rename these.');
    const unclassified = [...python].filter(([where]) => !Object.hasOwn(table.backendReaders, where)).map(([where, reads]) => `${where} (${[...reads].sort().join(', ')})`).sort();
    assert.deepEqual(unclassified, [], 'Rule: every backend function that computes with points thinned to draw (it calls a decimator, or is handed its result) says what it does with them. Fix: add each to "readers" in python-backend/drawn_points_contract.json as use "draws" (it only makes the picture; scripts/check_decimation_flow.py checks that by data flow). If it makes a number of them, take that number from the full data it is given, before thinning, so it only draws: classifying it "value" makes its row a gap, which GAP_CEILING (0) does not allow. See docs/plot-contracts-guide.md.');
    assert.deepEqual(Object.keys(table.backendReaders).filter(where => !python.has(where)).sort(), [], 'Rule: "readers" in python-backend/drawn_points_contract.json lists only functions that compute with thinned points today. Fix: remove these entries.');
    for (const row of rowsOf(table)) {
        const values = row.computedIn.filter(where => table.backendReaders[where]?.use === 'value');
        if (row.from === 'extremes' || row.from === 'thinned') continue;
        assert.deepEqual(values, [], `${row.id} says it is from ${row.from}, but names backend functions that make a number of thinned points`);
    }
}

/** Every number field the protocol answers with (`Definition.path`), from the generated schema and `extra` declarations. */
export function protocolFields(code: Code = REPO, extra: readonly ts.SourceFile[] = []): string[] {
    const fields: string[] = [];
    const members = (prefix: string, list: ts.NodeArray<ts.TypeElement>): void => {
        for (const member of list) {
            if (!ts.isPropertySignature(member) || !member.type) continue;
            const name = `${prefix}.${member.name.getText()}`;
            const literals: ts.TypeLiteralNode[] = [];
            each(member.type, node => { if (ts.isTypeLiteralNode(node) && !literals.some(outer => node.pos >= outer.pos && node.end <= outer.end)) literals.push(node); });
            if (literals.length) literals.forEach(literal => members(name, literal.members));
            else if (/\b(?:number|Drawn)\b/.test(member.type.getText())) fields.push(name);
        }
    };
    // An interface of the schema, or one added to it by `declare module` (what regenerated types add, in memory).
    const interfaces: ts.InterfaceDeclaration[] = [];
    for (const source of [code.parse('src/shared/protocol/generated/backendProtocolSchema.ts'), ...extra]) {
        each(source, node => { if (ts.isInterfaceDeclaration(node)) interfaces.push(node); });
    }
    // Requests and the backend's own notices carry nothing shown: what it answers does.
    for (const statement of interfaces) if (!NOT_SHOWN.some(pattern => pattern.test(statement.name.text))) members(statement.name.text, statement.members);
    return [...new Set(fields)];
}

export function checkProtocolFields(fields: readonly string[] = protocolFields(), table: Table = TABLE): void {
    const ids = new Set(rowsOf(table).map(row => row.id));
    assert.deepEqual(fields.filter(field => !Object.hasOwn(table.schemaFields, field)).sort(), [], 'Rule: every number the backend\'s protocol sends back is a value of a row, or says why it is not shown. These numbers reach the webview: map each to its rows in SCHEMA_FIELDS (src/test/plotContracts/schema.ts), or say there in one sentence why it is not shown.');
    assert.deepEqual(Object.keys(table.schemaFields).filter(field => !fields.includes(field)).sort(), [], 'schema.ts maps a field the protocol does not send');
    for (const [field, to] of Object.entries(table.schemaFields)) {
        if (typeof to === 'string') assert.ok(to.trim().length > 0, `${field}: says no why`);
        else assert.deepEqual(to.filter(id => !ids.has(id)), [], `${field} maps to rows that do not exist`);
    }
}

export function checkProofs(rows: readonly ContractRow[] = rowsOf(TABLE), code?: Code): void {
    const proved = code ? withProofs(rows, code) : undefined;
    assert.deepEqual(tellsProblems(rows, proved ? (targets, proof) => proofProblem(targets, proof, proved.program(), proved.files) : proofProblem), []);
}

export function checkGaps(table: Table = TABLE): void {
    const rows = rowsOf(table);
    const gaps = Object.fromEntries(rows.filter(row => row.gap).map(row => [row.id, row.gap?.severity]));
    assert.deepEqual(gaps, { ...knownGapsOf(table) }, 'Rule: the rows marked as gaps (a row\'s `gap` in src/test/plotContracts/charts) are exactly KNOWN_GAPS, each at its severity. Fix: a row whose gap you closed: take its `gap` off and its line out of KNOWN_GAPS. A new gap is not allowed (GAP_CEILING): make the row\'s value come from the full data and name the test that tells it from the drawn points instead.');
    for (const row of rows) {
        const why = reasons(row);
        if (row.gap) {
            assert.ok(row.gap.why.trim().length > 0, `${row.id}: its gap says no why. Fix: write in its \`gap.why\` (src/test/plotContracts/charts/${row.chart}.ts) what the value is taken of and why that is not yet the full data.`);
            // Every gap is held by one of these, so taking its mark off fails until it is closed.
            assert.ok(why.length > 0, `${row.id}: is marked a gap, but no rule holds it: it is taken from the full data, names a test that tells the full data from the drawn points, and has a whole axis name. Fix: it is no gap any more: take its \`gap\` off (src/test/plotContracts/charts/${row.chart}.ts) and its line out of KNOWN_GAPS.`);
            if (row.from === 'thinned') assert.equal(row.gap.severity, 'P1', `${row.id}: is taken from averaged or cut points (from: 'thinned'), which is always P1 (docs/display-rules.md R1). Fix: set its gap.severity to 'P1', or take the value from the full data.`);
        } else {
            assert.deepEqual(why, [], `${row.id} (src/test/plotContracts/charts/${row.chart}.ts) is not marked a gap, but these say it is one. Fix each, by what it says: "no test holds it": name the test in the row's tests; "computed from thinned points": take the value from the full data before thinning; "no test it names tells …": name (with tt) a test that asserts a case where the full data and the drawn points give different answers (assertNotDrawn); "it breaks Rn": take an exception docs/display-rules.md approves, in its own words, or stop breaking it; "its axis name lacks …": give the row's names its quantity, unit and reference. A gap mark is no way out: GAP_CEILING is 0.`);
        }
    }
}

export function checkRuleQuotes(code: Code = REPO, table: Table = TABLE): void {
    const rules = code.read('docs/display-rules.md').split(/^(?=## R\d+ )/m);
    for (const row of rowsOf(table)) {
        for (const cited of [row.exception, row.breaks]) {
            if (!cited) continue;
            const rule = rules.find(section => section.startsWith(`## ${cited.rule} `));
            assert.ok(rule, `${row.id}: no rule ${cited.rule}`);
            assert.ok(rule.includes(cited.quote), `${row.id}: ${cited.rule} does not say "${cited.quote}"`);
        }
    }
}

export function checkContractDoc(code: Code = REPO, table: Table = TABLE): void {
    // Compared byte for byte, line endings included: the repo stores every text file with LF and checks it out so on
    // every OS (.gitattributes), so a difference here is a difference of content, never of the machine.
    assert.equal(code.read(CONTRACT_DOC.split(path.sep).join('/')), renderContractDoc(table.contracts), `${CONTRACT_DOC} is generated from src/test/plotContracts/ and is not the table it renders. Fix: change the table there, not the document, then run \`npm run compile && node dist/test/plotContracts/render.js\` and commit the document it writes. If the only difference is CR LF line endings, the checkout is not the repository's: git must honour .gitattributes (\`git add --renormalize .\`, then check out again) — never make this comparison ignore them.`);
}
