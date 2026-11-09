import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { namedTest, testProblem } from './namedTest';
import { CHARTS, CONTRACTS, GAP_CEILING, KNOWN_GAPS, ROWS } from './plotContracts/index';
import type { ContractRow } from './plotContracts/model';
import { CONTRACT_DOC, renderContractDoc } from './plotContracts/render';
import { NOT_SHOWN, SCHEMA_FIELDS } from './plotContracts/schema';
import { DRAWN_ACCESSORS, DRAWN_FIELDS, DRAWN_READERS, NOT_CHART_VALUES, PY_DECIMATORS, VALUE_HELPERS } from './plotContracts/values';
import { PLOTS_PENDING } from './uiSmoke/plotRegistry';

const repoRoot = path.resolve(__dirname, '..', '..');
const STAGE_PANES = 'src/webview/runtime/stagePanes.ts';
/** The plot component's entry points: every call of one outside stagePanes.ts draws a chart. */
const PLOT_COMPONENT = new Set(['paintOverlay', 'paintStage', 'paintSideAxis', 'paintTimeAxis']);
/** Number primitives: a call of one turns a number into the text a user reads. */
const NUMBER_TEXT = new Set(['toFixed', 'toPrecision', 'toExponential', 'toLocaleString']);
/** Math's integer roundings: one applied to a value scaled by a power of ten rounds it to decimals, as text does. */
const MATH_ROUNDING = new Set(['round', 'trunc', 'floor', 'ceil']);

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

const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

function sourceFiles(): string[] {
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

const parsed = new Map<string, ts.SourceFile>();
function parse(file: string): ts.SourceFile {
    let source = parsed.get(file);
    if (!source) {
        source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
        parsed.set(file, source);
    }
    return source;
}

/** The name a function node is known by in its file: its own name, or the variable or property it is assigned to. */
function functionName(node: ts.Node): string | null {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isGetAccessor(node)) && node.name) {
        return node.name.getText();
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) && ts.isIdentifier(node.parent.name)) {
        return node.parent.name.text;
    }
    return null;
}

/** The innermost named function a node is in, `<module>` outside any. */
function enclosing(node: ts.Node): string {
    for (let at = node.parent as ts.Node | undefined; at; at = at.parent) {
        const name = functionName(at);
        if (name) return name;
    }
    return '<module>';
}

function each(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, child => each(child, visit));
}

const namesIn = new Map<string, Set<string>>();
function functionsOf(file: string): Set<string> {
    let names = namesIn.get(file);
    if (!names) {
        const found = new Set<string>();
        each(parse(file), node => {
            const name = functionName(node);
            if (name) found.add(name);
        });
        names = found;
        namesIn.set(file, names);
    }
    return names;
}

/** Whether `file:name` names a function: a TS function, method or arrow by its name, or a Python def. */
function exists(entry: string): boolean {
    const at = entry.lastIndexOf(':');
    const file = entry.slice(0, at);
    const name = entry.slice(at + 1);
    if (!existsSync(path.join(repoRoot, file))) return false;
    if (file.endsWith('.py')) return new RegExp(`^[ \\t]*(?:async\\s+)?def ${name}\\(`, 'm').test(read(file));
    return functionsOf(file).has(name);
}

/** The helpers a file can call, by the local name it calls them: its own, and those it imports from a relative path. */
function helpersIn(file: string, helpers: ReadonlySet<string>): Map<string, string> {
    const local = new Map<string, string>();
    for (const helper of helpers) {
        const at = helper.lastIndexOf(':');
        if (helper.slice(0, at) === file) local.set(helper.slice(at + 1), helper);
    }
    for (const statement of parse(file).statements) {
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
function writersIn(file: string, helpers: ReadonlySet<string>, writers: Map<string, Set<string>>): void {
    const local = helpersIn(file, helpers);
    each(parse(file), node => {
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
function numberWriters(): Map<string, Set<string>> {
    const helpers = new Set(VALUE_HELPERS);
    const writers = new Map<string, Set<string>>();
    for (const file of sourceFiles()) writersIn(file, helpers, writers);
    // A function that rounds to decimals by arithmetic (`round1`) is a helper too: whoever calls it writes a number.
    for (const [writer, calls] of writers) if ([...calls].some(call => call.startsWith('Math.'))) helpers.add(writer);
    writers.clear();
    for (const file of sourceFiles()) writersIn(file, helpers, writers);
    return writers;
}

/** Every call of the plot component outside it, by the function that makes it. */
function plotCallers(): Set<string> {
    const callers = new Set<string>();
    for (const file of sourceFiles()) {
        if (file === STAGE_PANES) continue;
        each(parse(file), node => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && PLOT_COMPONENT.has(node.expression.text)) callers.add(`${file}:${enclosing(node)}`);
        });
    }
    return callers;
}

test('every row has its own id, on a chart the table lists, and every chart has a row of each kind it shows', () => {
    const ids = ROWS.map(row => row.id);
    assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), [], 'row ids repeat');
    const charts = CHARTS.map(chart => chart.id);
    assert.deepEqual(charts.filter((id, index) => charts.indexOf(id) !== index), [], 'chart ids repeat');
    for (const row of ROWS) {
        assert.ok(charts.includes(row.chart), `${row.id}: no chart ${row.chart}`);
        assert.ok(row.id.startsWith(`${row.chart}.`), `${row.id}: its id does not start with its chart`);
        assert.ok(row.computedIn.length > 0, `${row.id}: says nowhere it is computed`);
    }
    for (const chart of CHARTS) {
        const kinds = new Set(ROWS.filter(row => row.chart === chart.id).map(row => row.value));
        assert.deepEqual(chart.requires.filter(kind => !kinds.has(kind)), [], `${chart.id} has no row for these values it shows`);
    }
});

test('no row says a difference or a median is taken of rounded values: rounding is for writing only (R1)', () => {
    // "round(a) − round(b)", or "subtracts … (rounded to …)": the contract would invite a "fix" that breaks R1.
    const roundedFirst = [/round\([^)]*\)\s*[−-]\s*round\(/u, /引く（[^）]*丸める）/u, /(中央値|Δ|差)[^。]*を丸めてから/u, /subtract\w*[^.]*\(rounded/iu];
    for (const row of ROWS) {
        for (const pattern of roundedFirst) assert.ok(!pattern.test(row.trace ?? ''), `${row.id}: "${row.trace}" takes a value of rounded numbers`);
    }
    const source = read('src/webview/runtime/comparePanes.ts');
    assert.ok(!/Rounded so that base \+ delta/u.test(source), 'comparePanes.ts says the Δ is of rounded levels');
});

test('every call of the plot component, and every plot plotRegistry.ts lists, is a chart of the table', () => {
    const painted = new Set(CHARTS.flatMap(chart => chart.paintedBy));
    assert.deepEqual([...plotCallers()].filter(caller => !painted.has(caller)).sort(), [], 'these functions draw a plot no chart of plotContracts.ts lists');
    assert.deepEqual([...painted].filter(entry => !exists(entry)).sort(), [], 'a chart is drawn by a function that does not exist');
    const registered = CHARTS.flatMap(chart => chart.registry ?? []);
    assert.deepEqual(PLOTS_PENDING.map(plot => plot.selector).filter(selector => !registered.includes(selector)), [], 'a plot plotRegistry.ts lists is in no chart');
    assert.deepEqual(registered.filter(selector => !PLOTS_PENDING.some(plot => plot.selector === selector)), [], 'a chart lists a canvas plotRegistry.ts does not');
});

test('every test the table names runs and asserts something', () => {
    for (const row of ROWS) {
        for (const named of row.tests) {
            assert.ok(existsSync(path.join(repoRoot, named.file)), `${row.id}: no file ${named.file}`);
            const problem = testProblem(named.file, read(named.file), named.name);
            assert.equal(problem, null, `${row.id}: ${problem}`);
        }
    }
});

test('every function the table names exists, as a function of its file or a def of its Python module', () => {
    const named = [...ROWS.flatMap(row => row.computedIn), ...VALUE_HELPERS, ...Object.keys(NOT_CHART_VALUES)];
    assert.deepEqual([...new Set(named)].filter(entry => !exists(entry)).sort(), []);
});

test('every function that writes a number in the webview is in the table, a value helper, or not a chart\'s value with why', () => {
    const writers = numberWriters();
    const listed = new Set([...ROWS.flatMap(row => row.computedIn), ...VALUE_HELPERS, ...Object.keys(NOT_CHART_VALUES)]);
    const unlisted = [...writers].filter(([writer]) => !listed.has(writer)).map(([writer, calls]) => `${writer} (${[...calls].sort().join(', ')})`).sort();
    assert.deepEqual(unlisted, [], 'a new path writes a number: add it to a row of plotContracts.ts (or VALUE_HELPERS, or NOT_CHART_VALUES with why)');
    // A function that no longer writes a number is no longer not a chart's value.
    assert.deepEqual(Object.keys(NOT_CHART_VALUES).filter(entry => !writers.has(entry)).sort(), [], 'NOT_CHART_VALUES lists a function that writes no number');
    for (const [entry, why] of Object.entries(NOT_CHART_VALUES)) assert.ok(why.trim().length > 0, `${entry}: says no why`);
});

test('the detector finds a number written by a primitive, a helper imported under another name, a local alias of one, and rounding to decimals by arithmetic', () => {
    const file = 'src/webview/runtime/fake.ts';
    const source = ts.createSourceFile(file, [
        "import { frequencyText as hz } from '../plot/plotText';",
        'const fmt = hz;',
        'export function a(value: number): string { return value.toFixed(2); }',
        'export const b = (value: number): string => hz(value);',
        'export function c(value: number): string { return fmt(value); }',
        'export function d(): string { return "none"; }',
        'export function e(value: number, reference: number): number { return Math.round(value * 10) - Math.round(reference * 10); }',
        'const round1 = (value: number): number => Math.round(value * 10) / 10;',
        'export function f(value: number, reference: number): number { return round1(round1(value) - round1(reference)); }',
        'export function g(x: number): number { return Math.round(x) + Math.floor(x / 2); }',
    ].join('\n'), ts.ScriptTarget.Latest, true);
    parsed.set(file, source);
    try {
        const writers = new Map<string, Set<string>>();
        writersIn(file, new Set([...VALUE_HELPERS, `${file}:round1`]), writers);
        assert.deepEqual(Object.fromEntries([...writers].map(([writer, calls]) => [writer, [...calls]])), {
            [`${file}:a`]: ['toFixed'],
            [`${file}:b`]: ['src/webview/plot/plotText.ts:frequencyText'],
            [`${file}:c`]: ['src/webview/plot/plotText.ts:frequencyText'],
            // Rounding to decimals by arithmetic writes a number, and so does a helper that does it: a pixel's Math.round does not.
            [`${file}:e`]: ['Math.round'],
            [`${file}:round1`]: ['Math.round'],
            [`${file}:f`]: [`${file}:round1`],
        });
    } finally {
        parsed.delete(file);
    }
});


test('every chart\'s file in plotContracts/charts is gathered by index.ts, and holds only its own rows\' gaps', () => {
    const files = readdirSync(path.join(repoRoot, 'src/test/plotContracts/charts')).filter(name => name.endsWith('.ts')).map(name => name.replace(/\.ts$/, '')).sort();
    assert.deepEqual(files, CHARTS.map(chart => chart.id).sort(), 'a chart\'s file is named by its chart\'s id, and index.ts lists every one');
    for (const contract of CONTRACTS) {
        const own = new Set(contract.rows.map(row => row.id));
        assert.deepEqual(Object.keys(contract.knownGaps).filter(id => !own.has(id)), [], `${contract.chart.id} lists gaps of rows not its own`);
    }
});

// ── What reads drawn points ──

let program: ts.Program | undefined;
/** The webview and shared code with its types: what a property access is read of. */
function typed(): ts.Program {
    if (!program) {
        const config = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
        program = ts.createProgram(sourceFiles().map(file => path.join(repoRoot, file)), { ...config?.options, noEmit: true });
    }
    return program;
}

/** Every webview and shared function that reads drawn points: a DRAWN_FIELDS access on its type, or a DRAWN_ACCESSORS call. */
function drawnReaders(): Map<string, Set<string>> {
    const checker = typed().getTypeChecker();
    const accessors = new Set(DRAWN_ACCESSORS);
    const found = new Map<string, Set<string>>();
    const add = (where: string, what: string): void => {
        const reads = found.get(where) ?? new Set<string>();
        reads.add(what);
        found.set(where, reads);
    };
    for (const file of sourceFiles()) {
        const source = typed().getSourceFile(path.join(repoRoot, file));
        if (!source) continue;
        const local = helpersIn(file, accessors);
        each(source, node => {
            if (ts.isPropertyAccessExpression(node)) {
                const type = checker.getNonNullableType(checker.getTypeAtLocation(node.expression));
                const name = (type.aliasSymbol ?? type.getSymbol())?.getName();
                if (name && Object.hasOwn(DRAWN_FIELDS, name) && DRAWN_FIELDS[name].includes(node.name.text)) add(`${file}:${enclosing(node)}`, `${name}.${node.name.text}`);
            }
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
                const accessor = local.get(node.expression.text);
                const where = `${file}:${enclosing(node)}`;
                if (accessor && accessor !== where) add(where, accessor);
            }
        });
    }
    // A file's own helper that reads drawn points (not exported: no row names it) passes the read to its callers.
    for (let grown = true; grown;) {
        grown = false;
        for (const file of sourceFiles()) {
            const exported = exportedOf(file);
            const privateReaders = new Map([...found.keys()].filter(where => where.startsWith(`${file}:`) && !exported.has(where.slice(file.length + 1)) && DRAWN_READERS[where]?.use !== 'draws').map(where => [where.slice(file.length + 1), where]));
            if (!privateReaders.size) continue;
            each(parse(file), node => {
                if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
                const reader = privateReaders.get(node.expression.text);
                const where = `${file}:${enclosing(node)}`;
                if (!reader || reader === where || found.get(where)?.has(reader)) return;
                add(where, reader);
                grown = true;
            });
        }
    }
    return found;
}

/** The names a file exports (functions and variables). */
function exportedOf(file: string): Set<string> {
    const names = new Set<string>();
    for (const statement of parse(file).statements) {
        if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
        if (ts.isFunctionDeclaration(statement) && statement.name) names.add(statement.name.text);
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    }
    return names;
}

const PYTHON = 'python-backend';
/** Every def of the backend's modules (not its tests), with its body. */
function pythonDefs(): Map<string, string> {
    const defs = new Map<string, string>();
    for (const name of readdirSync(path.join(repoRoot, PYTHON)).filter(item => item.endsWith('.py') && !item.startsWith('test_') && item !== 'conftest.py').sort()) {
        const file = `${PYTHON}/${name}`;
        const text = read(file);
        for (const match of text.matchAll(/^[ \t]*(?:async\s+)?def (\w+)\(/gm)) {
            const body = namedTest(file, text.slice(match.index), match[1])?.body ?? '';
            if (!defs.has(`${file}:${match[1]}`)) defs.set(`${file}:${match[1]}`, body);
        }
    }
    return defs;
}

/** The backend's defs that call a decimator (PY_DECIMATORS), with the ones they call. */
function pythonDrawn(): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    const decimators = PY_DECIMATORS.map(entry => ({ entry, name: entry.slice(entry.lastIndexOf(':') + 1) }));
    for (const [def, body] of pythonDefs()) {
        const calls = decimators.filter(item => item.entry !== def && new RegExp(`\\b${item.name}\\(`).test(body.slice(body.indexOf('\n'))));
        if (calls.length) found.set(def, new Set(calls.map(item => item.entry)));
    }
    return found;
}

test('every function that reads drawn points says what it does with them, and a row\'s source agrees with what its functions read', () => {
    const scanned = drawnReaders();
    assert.deepEqual(DRAWN_ACCESSORS.filter(accessor => !scanned.has(accessor)), [], 'a drawn accessor reads no drawn field itself');
    const python = pythonDrawn();
    assert.deepEqual(PY_DECIMATORS.filter(entry => !exists(entry)), [], 'a decimator the scan looks for does not exist');
    // Every def that reads drawn points is classified, the backend's as the webview's, whether a row names it or not.
    const found = new Map([...scanned, ...python]);
    const unclassified = [...found].filter(([where]) => !Object.hasOwn(DRAWN_READERS, where)).map(([where, reads]) => `${where} (${[...reads].sort().join(', ')})`).sort();
    assert.deepEqual(unclassified, [], 'these read drawn points: add each to DRAWN_READERS with what it does with them');
    assert.deepEqual(Object.keys(DRAWN_READERS).filter(where => !found.has(where) && !python.has(where)).sort(), [], 'DRAWN_READERS lists a function that reads no drawn points');
    for (const row of ROWS) {
        const values = row.computedIn.filter(where => DRAWN_READERS[where]?.use === 'value' && (scanned.has(where) || python.has(where)));
        if (row.from === 'extremes' || row.from === 'thinned') {
            assert.ok(values.length > 0, `${row.id} says it is from ${row.from} points, but names no function the scan finds making a number of drawn points`);
        } else {
            assert.deepEqual(values, [], `${row.id} says it is from ${row.from}, but names functions that make a number of drawn points`);
        }
    }
});

test('every number the backend\'s protocol sends back is a value of a row, or says why it is not shown', () => {
    const file = 'src/shared/protocol/generated/backendProtocolSchema.ts';
    const fields: string[] = [];
    const members = (prefix: string, list: ts.NodeArray<ts.TypeElement>): void => {
        for (const member of list) {
            if (!ts.isPropertySignature(member) || !member.type) continue;
            const name = `${prefix}.${member.name.getText()}`;
            const literals: ts.TypeLiteralNode[] = [];
            each(member.type, node => { if (ts.isTypeLiteralNode(node) && !literals.some(outer => node.pos >= outer.pos && node.end <= outer.end)) literals.push(node); });
            if (literals.length) literals.forEach(literal => members(name, literal.members));
            else if (/\bnumber\b/.test(member.type.getText())) fields.push(name);
        }
    };
    for (const statement of parse(file).statements) {
        // Requests and the backend's own notices carry nothing shown: what it answers does.
        if (ts.isInterfaceDeclaration(statement) && !NOT_SHOWN.some(pattern => pattern.test(statement.name.text))) members(statement.name.text, statement.members);
    }
    const ids = new Set(ROWS.map(row => row.id));
    assert.deepEqual(fields.filter(field => !Object.hasOwn(SCHEMA_FIELDS, field)).sort(), [], 'these numbers reach the webview: map each to its rows in plotContracts/schema.ts, or say why it is not shown');
    assert.deepEqual(Object.keys(SCHEMA_FIELDS).filter(field => !fields.includes(field)).sort(), [], 'schema.ts maps a field the protocol does not send');
    for (const [field, to] of Object.entries(SCHEMA_FIELDS)) {
        if (typeof to === 'string') assert.ok(to.trim().length > 0, `${field}: says no why`);
        else assert.deepEqual(to.filter(id => !ids.has(id)), [], `${field} maps to rows that do not exist`);
    }
});

// ── Gaps ──

/** A test that tells the full data from the drawn points says so: its title or body speaks of what is thinned or real. */
const TELLS = new RegExp(['thin', 'decimat', 'drawn', 'averag', 'cut for display', 'not the', 'never the', 'every (?:bin|sample|value|cell|band|frame)', 'real (?:bin|cell|sample)', 'bin by bin', 'sample by sample', 'before (?:it is drawn|thinning|rounding)', 'full', 'own (?:bins|samples|cells|place)', 'one by one', 'narrow', 'not its picture'].map(words => words.replace(/ /g, '[ _]')).join('|'), 'i');

/** Why a row is not yet held, if it is not. */
function reasons(row: ContractRow): string[] {
    return [
        ...(row.tests.length === 0 ? ['no test holds it'] : []),
        ...(row.from === 'thinned' || row.from === 'extremes' ? [`it is computed from thinned points (${row.from})`] : []),
        ...(row.from === 'full' && !row.tests.some(item => item.tells) ? ['no test it names tells the full data from the drawn points'] : []),
        ...(row.breaks ? [`it breaks ${row.breaks.rule}`] : []),
        ...(row.names && !(row.names.quantity && row.names.unit && row.names.reference !== false) ? ['its axis name lacks its quantity, unit or reference'] : []),
    ];
}

/**
 * Tests that take their answer from the plot under test itself (the generic UI contract asks the plot's own full
 * source for the next point, and its pages stand the drawn view in for the full data): they hold the wiring
 * together, but cannot tell the full data from the drawn points, whatever words they use.
 */
const SELF_REFERENTIAL = ['src/test/uiSmoke/plotContract.spec.ts'];

test('a test said to tell full data from drawn points is about what is thinned', () => {
    for (const row of ROWS) {
        for (const named of row.tests.filter(item => item.tells)) {
            assert.ok(!SELF_REFERENTIAL.includes(named.file), `${row.id}: "${named.name}" checks the plot against its own answer: it cannot tell full data from drawn`);
            const found = namedTest(named.file, read(named.file), named.name);
            assert.ok(found && TELLS.test(`${named.name}\n${found.body}`), `${row.id}: "${named.name}" is said to tell full data from drawn, but says nothing of thinning`);
        }
    }
});

test('every gap is in its chart\'s knownGaps at its severity, and a row is a gap until a test holds it from full data', () => {
    const gaps = Object.fromEntries(ROWS.filter(row => row.gap).map(row => [row.id, row.gap?.severity]));
    assert.deepEqual(gaps, { ...KNOWN_GAPS });
    for (const row of ROWS) {
        const why = reasons(row);
        if (row.gap) {
            assert.ok(row.gap.why.trim().length > 0, `${row.id}: a gap says no why`);
            // Every gap is held by one of these, so taking its mark off fails until it is closed.
            assert.ok(why.length > 0, `${row.id}: a gap no rule holds (it has a test that tells full from drawn, full data and a whole axis name)`);
            if (row.from === 'thinned') assert.equal(row.gap.severity, 'P1', `${row.id}: a number shown from averaged or cut points is P1`);
        } else {
            assert.deepEqual(why, [], `${row.id} is not a gap, but`);
        }
    }
});

test('the number of gaps of each severity is GAP_CEILING, which only goes down', () => {
    for (const severity of ['P1', 'P2', 'P3'] as const) {
        const count = ROWS.filter(row => row.gap?.severity === severity).length;
        assert.ok(count <= GAP_CEILING[severity], `${count} ${severity} gaps, more than the ${GAP_CEILING[severity]} allowed: a new gap is a change review should stop`);
        assert.equal(GAP_CEILING[severity], count, `${severity} gaps are down to ${count}: lower GAP_CEILING.${severity} to it`);
    }
});

test('every exception a row takes is one docs/display-rules.md approves, and every rule it breaks says so, in the rule\'s own words', () => {
    const rules = read('docs/display-rules.md').split(/^(?=## R\d+ )/m);
    for (const row of ROWS) {
        for (const cited of [row.exception, row.breaks]) {
            if (!cited) continue;
            const rule = rules.find(section => section.startsWith(`## ${cited.rule} `));
            assert.ok(rule, `${row.id}: no rule ${cited.rule}`);
            assert.ok(rule.includes(cited.quote), `${row.id}: ${cited.rule} does not say "${cited.quote}"`);
        }
    }
});

test('docs/plot-contracts.md is the table as plotContracts renders it', () => {
    assert.equal(read(CONTRACT_DOC), renderContractDoc(), 'run: npm run compile && node dist/test/plotContracts/render.js');
});
