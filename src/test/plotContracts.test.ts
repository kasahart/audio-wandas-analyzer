import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { namedTest, testProblem } from './namedTest';
import { CHARTS, CONTRACTS, GAP_CEILING, KNOWN_GAPS, ROWS } from './plotContracts/index';
import type { ContractRow } from './plotContracts/model';
import { CONTRACT_DOC, renderContractDoc } from './plotContracts/render';
import { NOT_SHOWN, SCHEMA_FIELDS } from './plotContracts/schema';
import { DRAWN_ACCESSORS, DRAWN_FIELDS, DRAWN_READERS, NOT_CHART_VALUES, PY_DECIMATORS, VALUE_HELPERS, type DrawnReader } from './plotContracts/values';
import { SURFACES } from './plotContracts/surfaces';
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
    // And every number written into text a user reads, by its type (String(n), `${n}`, n + ' Hz', a number itself).
    // Text made by a function a row already names (`loopRegionClockText`) is that row's: writing it is not a new path.
    const registered = new Set(ROWS.flatMap(row => row.computedIn));
    for (const [writer, how] of numericTextWriters(typed(), sourceFiles())) {
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
 */
function numericTextWriters(program: ts.Program, files: readonly string[]): Map<string, Set<string>> {
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

/** The function node a node is in, if any. */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
    for (let at = node.parent as ts.Node | undefined; at; at = at.parent) if (ts.isFunctionLike(at)) return at;
    return undefined;
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
    assert.deepEqual([...plotCallers()].filter(caller => !painted.has(caller)).sort(), [], 'Rule: every call of the plot component (paintOverlay, paintStage, paintSideAxis, paintTimeAxis) belongs to a chart of the contract table. These functions call it but no chart lists them. Fix: add each to the paintedBy of its chart in src/test/plotContracts/charts/<chart>.ts, or add a new chart file there (and to index.ts) with a row for every value a user reads off it. See docs/plot-contracts-guide.md.');
    assert.deepEqual([...painted].filter(entry => !exists(entry)).sort(), [], 'a chart is drawn by a function that does not exist');
    const registered = CHARTS.flatMap(chart => chart.registry ?? []);
    assert.deepEqual(PLOTS_PENDING.map(plot => plot.selector).filter(selector => !registered.includes(selector)), [], 'a plot plotRegistry.ts lists is in no chart');
    assert.deepEqual(registered.filter(selector => !PLOTS_PENDING.some(plot => plot.selector === selector)), [], 'a chart lists a canvas plotRegistry.ts does not');
});

/**
 * Every place in `files` that makes a drawing surface, by the function it is in: a canvas's context taken (by the
 * receiver's type, HTMLCanvasElement or OffscreenCanvas), a canvas or an SVG element created (createElement,
 * createElementNS with the SVG namespace, new OffscreenCanvas), or written as markup (`<canvas`, `<svg` in a string or
 * a template). A chart that bypasses the plot component still needs one, so it cannot be drawn without being found.
 */
function drawingSurfaces(program: ts.Program, files: readonly string[]): Map<string, Set<string>> {
    const checker = program.getTypeChecker();
    const found = new Map<string, Set<string>>();
    const add = (node: ts.Node, what: string): void => {
        const where = `${path.relative(repoRoot, node.getSourceFile().fileName).split(path.sep).join('/')}:${enclosing(node)}`;
        const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const set = found.get(where) ?? new Set<string>();
        set.add(`${what} at line ${line}`);
        found.set(where, set);
    };
    const canvasTyped = (node: ts.Expression): boolean => {
        const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
        return (type.isUnion() ? type.types : [type]).some(part => ['HTMLCanvasElement', 'OffscreenCanvas'].includes(part.getSymbol()?.getName() ?? ''));
    };
    for (const file of files) {
        const source = program.getSourceFile(path.join(repoRoot, file));
        if (!source) continue;
        each(source, node => {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
                const method = node.expression.name.text;
                const first = node.arguments[0];
                if (method === 'getContext' && canvasTyped(node.expression.expression)) add(node, 'a canvas\'s context');
                if (method === 'createElement' && first && ts.isStringLiteralLike(first) && ['canvas', 'svg'].includes(first.text.toLowerCase())) add(node, `a ${first.text} created`);
                if (method === 'createElementNS' && first && ts.isStringLiteralLike(first) && first.text.includes('svg')) add(node, 'an SVG element created');
            }
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'OffscreenCanvas') add(node, 'an OffscreenCanvas');
            const text = ts.isStringLiteralLike(node) ? node.text : ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) ? node.text : undefined;
            const tag = text !== undefined ? /<(canvas|svg)\b/iu.exec(text)?.[1] : undefined;
            if (tag) add(node, `<${tag.toLowerCase()}> markup`);
        });
    }
    return found;
}

test('every drawing surface of the webview (a canvas or an SVG made, or a context taken) is the plot component\'s, a chart\'s, or says why it is no chart', () => {
    const found = drawingSurfaces(typed(), sourceFiles().filter(file => file !== STAGE_PANES));
    const painted = new Set(CHARTS.flatMap(chart => chart.paintedBy));
    const charts = new Set(CHARTS.map(chart => chart.id));
    const unlisted = [...found].filter(([where]) => !painted.has(where) && !Object.hasOwn(SURFACES, where)).map(([where, what]) => `${where} (${[...what].join(', ')})`).sort();
    assert.deepEqual(unlisted, [], 'Rule: every canvas or SVG the webview makes or draws on is the plot component\'s, a chart\'s, or explained. These functions make one (a context taken, an element created, <canvas>/<svg> markup) and nothing lists them. Fix: if it shows data, draw it with the plot component (paintOverlay) and add the function to its chart\'s paintedBy in src/test/plotContracts/charts; if it only holds a chart\'s canvas, add it to src/test/plotContracts/surfaces.ts as { charts: [...] }; if it draws no data (an icon, a cursor layer), add it there with one sentence saying why. See docs/plot-contracts-guide.md.');
    assert.deepEqual(Object.keys(SURFACES).filter(where => !found.has(where)).sort(), [], 'Rule: surfaces.ts lists only functions that make a drawing surface today. Fix: remove these lines from src/test/plotContracts/surfaces.ts (the function was renamed, moved, or no longer makes a canvas or SVG).');
    for (const [where, whose] of Object.entries(SURFACES)) {
        if (typeof whose === 'string') assert.ok(whose.trim().length > 0, `${where}: says no why`);
        else assert.deepEqual(whose.charts.filter(chart => !charts.has(chart)), [], `${where}: no such chart`);
    }
});

test('the surface scan finds a chart drawn its own way: a canvas made and drawn, an SVG chart, markup of either', () => {
    const file = 'src/webview/runtime/fakeChart.ts';
    const program = typedWith(new Map([[file, [
        'export function ownCanvas(host: HTMLElement): void { const canvas = document.createElement("canvas"); host.append(canvas); canvas.getContext("2d")?.fillRect(0, 0, 4, 4); }',
        'export function drawsOn(canvas: HTMLCanvasElement | null): void { const ctx = canvas?.getContext("2d"); ctx?.stroke(); }',
        'export function svgChart(host: HTMLElement): void { host.append(document.createElementNS("http://www.w3.org/2000/svg", "svg")); }',
        'export function markup(height: number): string { return `<div><canvas height="${height}"></canvas></div>`; }',
        "export function svgMarkup(): string { return '<svg viewBox=\"0 0 4 4\"><path d=\"M0 0L4 4\"/></svg>'; }",
        'export function offscreen(): void { new OffscreenCanvas(4, 4).getContext("2d"); }',
        // A context of anything else, and words, are no surface.
        'export function other(element: { getContext(kind: string): unknown }): void { element.getContext("2d"); }',
        'export function words(): string { return "a canvas of svg"; }',
    ].join('\n')]]));
    const found = drawingSurfaces(program, [file]);
    assert.deepEqual([...found.keys()].map(name => name.slice(file.length + 1)).sort(), ['drawsOn', 'markup', 'offscreen', 'ownCanvas', 'svgChart', 'svgMarkup']);
    // Not in a chart, not in SURFACES: the inventory test fails on each.
    const painted = new Set(CHARTS.flatMap(chart => chart.paintedBy));
    assert.ok([...found.keys()].every(where => !painted.has(where) && !Object.hasOwn(SURFACES, where)));
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
    assert.deepEqual(unlisted, [], 'Rule: every function that writes a number a user can read belongs to the contract table. These write one (the parentheses say how and where) and nothing lists them. Fix, one of: (1) it is a value of a chart: add the function to computedIn of its row in src/test/plotContracts/charts/<chart>.ts (or add a row); (2) it only formats or computes for others: add it to VALUE_HELPERS in src/test/plotContracts/values.ts; (3) it is not a chart\'s value (a setting\'s field, a test attribute, a CSS size): add it to NOT_CHART_VALUES there with one sentence saying why. See docs/plot-contracts-guide.md.');
    // A function that no longer writes a number is no longer not a chart's value.
    assert.deepEqual(Object.keys(NOT_CHART_VALUES).filter(entry => !writers.has(entry)).sort(), [], 'Rule: NOT_CHART_VALUES lists only functions that write a number today. Fix: remove these lines from src/test/plotContracts/values.ts.');
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


test('the detector finds a number written into text by its type: String(n), a template, n + text, a local, a function that makes such text, and a number itself', () => {
    const file = 'src/webview/runtime/fakeText.ts';
    const program = typedWith(new Map([[file, [
        'export function viaString(el: HTMLElement, value: number): void { el.textContent = String(value); }',
        'export function viaTemplate(el: HTMLElement, value: number): void { el.textContent = `${value} dB`; }',
        "export function viaJoin(ctx: CanvasRenderingContext2D, value: number): void { ctx.fillText(value + ' Hz', 0, 0); }",
        'export function viaLocal(el: HTMLElement, value: number): void { const label = `${value}`; el.title = label; }',
        'function made(value: number): string { return `${value.toString()} s`; }',
        'export function viaMaker(el: HTMLElement, value: number): void { el.innerHTML = `<b>${made(value)}</b>`; }',
        'export function viaAttribute(el: HTMLElement, value: number): void { el.setAttribute(\'aria-valuetext\', String(value)); el.dataset.level = `${value}`; }',
        'export function viaNumbers(el: HTMLElement, values: number[]): void { el.append(values.join(\', \')); }',
        'export function itself(input: HTMLInputElement, value: number): void { input.valueAsNumber = value; (input as unknown as { textContent: number }).textContent = value; }',
        // Words, and a number given to a style, are no number a user reads.
        'export function words(el: HTMLElement, name: string, width: number): void { el.textContent = `${name}!`; el.style.width = `${width}px`; }',
    ].join('\n')]]));
    const found = numericTextWriters(program, [file]);
    const names = [...found.keys()].map(name => name.slice(file.length + 1)).sort();
    assert.deepEqual(names, ['itself', 'viaAttribute', 'viaJoin', 'viaLocal', 'viaMaker', 'viaNumbers', 'viaString', 'viaTemplate'], [...found].map(([name, how]) => `${name}: ${[...how].join(', ')}`).join('\n'));
    assert.match([...found.get(`${file}:viaMaker`) ?? []].join(), /fakeText\.ts:made/u);
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

/** `typed()` with `overlay` (repo-relative path → source) added, or in place of a file's own source: for injections. */
function typedWith(overlay: ReadonlyMap<string, string>): ts.Program {
    const base = typed();
    const options = base.getCompilerOptions();
    const host = ts.createCompilerHost(options, true);
    const added = new Map([...overlay].map(([file, text]) => [path.join(repoRoot, file), text]));
    const own = host.getSourceFile.bind(host), exists = host.fileExists.bind(host), reads = host.readFile.bind(host);
    host.getSourceFile = (fileName, version, onError, create) => {
        const text = added.get(path.resolve(fileName));
        return text !== undefined ? ts.createSourceFile(fileName, text, version, true) : base.getSourceFile(fileName) ?? own(fileName, version, onError, create);
    };
    host.fileExists = fileName => added.has(path.resolve(fileName)) || exists(fileName);
    host.readFile = fileName => added.get(path.resolve(fileName)) ?? reads(fileName);
    return ts.createProgram([...new Set([...base.getRootFileNames(), ...added.keys()])], options, host);
}

/** What the scan of drawn points finds: who reads them (and what), where each read is, and every function by its name. */
interface DrawnScan {
    program: ts.Program;
    found: Map<string, Set<string>>;
    /** The expressions (and binding names) that read a drawn field or call a drawn accessor, by the function they are in. */
    reads: Map<string, ts.Node[]>;
    /** Every function of the scanned files by `file:name`, and its node (a declaration of a variable holds its arrow). */
    functions: Map<string, ts.FunctionLikeDeclaration>;
    /** What a call, a callback or an alias names, as `file:name` of a scanned function. */
    target(node: ts.Expression): string | undefined;
}

const relative = (source: ts.SourceFile): string => path.relative(repoRoot, source.fileName).split(path.sep).join('/');

/**
 * Every webview and shared function that reads drawn points, found with the type checker by the symbol of the field
 * read, whatever its form: `view.values`, `view['values']` (or a key of that literal type), `const { values } = view`,
 * a parameter `({ values }: StageView)`, a destructuring assignment, on an alias of the type or a Pick of it; a call of
 * a DRAWN_ACCESSORS function. A reader passes its read on to whoever calls it, in its file or another (an import, an
 * alias of it, a callback): a private reader that does not only draw, and any reader that is neither 'draws' nor
 * 'whole' (a 'whole' one is proven to make its number of full data; an exported 'draws' one is checked to only draw).
 */
function drawnScan(within: ts.Program = typed(), files: readonly string[] = sourceFiles(), readers: Readonly<Record<string, DrawnReader>> = DRAWN_READERS): DrawnScan {
    const checker = within.getTypeChecker();
    const sources = files.map(file => within.getSourceFile(path.join(repoRoot, file))).filter((source): source is ts.SourceFile => !!source);
    // The declarations of the drawn fields, of every type DRAWN_FIELDS names (both SpectrumSlice types, say).
    const members = new Map<ts.Node, string>();
    for (const source of within.getSourceFiles()) {
        if (source.isDeclarationFile || !relative(source).startsWith('src/')) continue;
        for (const statement of source.statements) {
            if (!(ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) || !Object.hasOwn(DRAWN_FIELDS, statement.name.text)) continue;
            const symbol = checker.getSymbolAtLocation(statement.name);
            if (!symbol) continue;
            const type = checker.getDeclaredTypeOfSymbol(symbol);
            for (const field of DRAWN_FIELDS[statement.name.text]) for (const declaration of checker.getPropertyOfType(type, field)?.declarations ?? []) members.set(declaration, `${statement.name.text}.${field}`);
        }
    }
    const fieldOf = (symbol: ts.Symbol | undefined): string | undefined => {
        for (const declaration of symbol?.declarations ?? []) { const field = members.get(declaration); if (field) return field; }
        return undefined;
    };
    const propertyOf = (type: ts.Type, name: string): string | undefined => {
        const plain = checker.getNonNullableType(type);
        for (const part of plain.isUnion() ? plain.types : [plain]) { const field = fieldOf(checker.getPropertyOfType(part, name)); if (field) return field; }
        return undefined;
    };
    /** A key of an element access or a computed name: its literal text, or the literals of its type. */
    const keysOf = (node: ts.Node): string[] => {
        if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return [node.text];
        const type = checker.getTypeAtLocation(node);
        return (type.isUnion() ? type.types : [type]).filter(part => part.isStringLiteral()).map(part => (part).value);
    };
    const nameOf = (name: ts.PropertyName | ts.BindingName): string[] => (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? [name.text] : ts.isComputedPropertyName(name) ? keysOf(name.expression) : []);

    const functions = new Map<string, ts.FunctionLikeDeclaration>();
    const byNode = new Map<ts.Node, string>();
    const known = within.getSourceFiles().filter(source => !source.isDeclarationFile && /^src\/(?:webview|shared)\//u.test(relative(source)));
    for (const source of new Set([...sources, ...known])) {
        const file = relative(source);
        each(source, node => {
            const name = functionName(node);
            if (!name || !ts.isFunctionLike(node) || !('body' in node)) return;
            const key = `${file}:${name}`;
            if (!functions.has(key)) functions.set(key, node);
            byNode.set(node, key);
            if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) byNode.set(node.parent, key);
        });
    }
    const target = (expression: ts.Expression): string | undefined => {
        let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
        for (let hops = 0; symbol && hops < 8; hops++) {
            if (symbol.flags & ts.SymbolFlags.Alias) { symbol = checker.getAliasedSymbol(symbol); continue; }
            const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
            if (!declaration) return undefined;
            const key = byNode.get(declaration);
            if (key) return key;
            // A local alias of a function (`const f = reader`, `const f = module.reader`) is the function.
            const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
            if (!initializer || !(ts.isIdentifier(initializer) || ts.isPropertyAccessExpression(initializer))) return undefined;
            symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(initializer) ? initializer.name : initializer);
        }
        return undefined;
    };

    const found = new Map<string, Set<string>>();
    const reads = new Map<string, ts.Node[]>();
    const add = (where: string, what: string, node: ts.Node): void => {
        const set = found.get(where) ?? new Set<string>();
        set.add(what);
        found.set(where, set);
        reads.set(where, [...(reads.get(where) ?? []), node]);
    };
    const accessors = new Set(DRAWN_ACCESSORS);
    for (const source of sources) {
        const file = relative(source);
        each(source, node => {
            const where = (): string => `${file}:${enclosing(node)}`;
            if (ts.isPropertyAccessExpression(node)) {
                const field = fieldOf(checker.getSymbolAtLocation(node.name)) ?? propertyOf(checker.getTypeAtLocation(node.expression), node.name.text);
                if (field) add(where(), field, node);
            } else if (ts.isElementAccessExpression(node)) {
                for (const key of keysOf(node.argumentExpression)) { const field = propertyOf(checker.getTypeAtLocation(node.expression), key); if (field) add(where(), field, node); }
            } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && !node.dotDotDotToken) {
                for (const key of nameOf(node.propertyName ?? node.name)) { const field = propertyOf(checker.getTypeAtLocation(node.parent), key); if (field) add(where(), field, node.name); }
            } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(node.left)) {
                // `({ values } = view)`: each name taken from the right-hand side's type.
                const type = checker.getTypeAtLocation(node.right);
                for (const property of node.left.properties) {
                    if (!(ts.isShorthandPropertyAssignment(property) || ts.isPropertyAssignment(property))) continue;
                    for (const key of nameOf(property.name)) { const field = propertyOf(type, key); if (field) add(where(), field, ts.isPropertyAssignment(property) ? property.initializer : property.name); }
                }
            } else if (ts.isCallExpression(node)) {
                const called = target(node.expression);
                if (called && accessors.has(called) && called !== where()) add(where(), called, node);
            }
        });
    }
    // A reader's read reaches whoever calls it, names it as a callback, or calls an alias of it.
    const passesOn = (where: string): boolean => {
        const use = readers[where]?.use;
        if (use === 'draws') return false;
        const at = where.lastIndexOf(':');
        const source = within.getSourceFile(path.join(repoRoot, where.slice(0, at)));
        return !source || !exportedIn(source).has(where.slice(at + 1)) || use !== 'whole';
    };
    for (let grown = true; grown;) {
        grown = false;
        for (const source of sources) {
            const file = relative(source);
            each(source, node => {
                if (!ts.isCallExpression(node)) return;
                for (const named of [node.expression, ...node.arguments]) {
                    if (!(ts.isIdentifier(named) || ts.isPropertyAccessExpression(named))) continue;
                    const reader = target(named);
                    const where = `${file}:${enclosing(node)}`;
                    if (!reader || reader === where || !found.has(reader) || !passesOn(reader) || found.get(where)?.has(reader)) continue;
                    add(where, reader, named === node.expression ? node : named);
                    grown = true;
                }
            });
        }
    }
    return { program: within, found, reads, functions, target };
}

/** Every webview and shared function that reads drawn points (drawnScan), with what it reads. */
function drawnReaders(): Map<string, Set<string>> {
    return drawnScan().found;
}

/** The names a file exports (functions and variables). */
function exportedOf(file: string): Set<string> {
    return exportedIn(parse(file));
}

function exportedIn(source: ts.SourceFile): Set<string> {
    const names = new Set<string>();
    for (const statement of source.statements) {
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

/**
 * The backend's defs that read drawn points: those that call a decimator (PY_DECIMATORS), and every def whose own
 * code computes with drawn points however they reached it (a returned view's values, a dict, an attribute, a
 * subscript, a call in another module), as check_decimation_flow.py follows them through the backend's AST.
 */
function pythonDrawn(readers: Readonly<Record<string, readonly string[]>> = pythonFlowReaders()): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    const decimators = PY_DECIMATORS.map(entry => ({ entry, name: entry.slice(entry.lastIndexOf(':') + 1) }));
    for (const [def, body] of pythonDefs()) {
        const calls = decimators.filter(item => item.entry !== def && new RegExp(`\\b${item.name}\\(`).test(body.slice(body.indexOf('\n'))));
        if (calls.length) found.set(def, new Set(calls.map(item => item.entry)));
    }
    for (const [def, origins] of Object.entries(readers)) {
        if (PY_DECIMATORS.includes(def)) continue;
        found.set(def, new Set([...(found.get(def) ?? []), ...origins]));
    }
    return found;
}

/** check_decimation_flow.py's readers: every backend def computing with drawn points, by the AST data flow. */
function pythonFlowReaders(sources?: Readonly<Record<string, string>>): Record<string, string[]> {
    const venv = path.join(repoRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';
    const script = sources
        ? ['-c', 'import json,sys; sys.path.insert(0, "scripts"); import check_decimation_flow as c; print(json.dumps(c.find_readers(json.load(sys.stdin))))']
        : ['scripts/check_decimation_flow.py', '--readers'];
    const run = spawnSync(python, script, { cwd: repoRoot, encoding: 'utf8', input: sources ? JSON.stringify(sources) : undefined });
    assert.equal(run.status, 0, `check_decimation_flow.py --readers: ${run.stderr}`);
    return JSON.parse(run.stdout) as Record<string, string[]>;
}

/** The backend's modules (not its tests), by module name, as check_decimation_flow.py reads them. */
function pythonSources(): Record<string, string> {
    return Object.fromEntries(readdirSync(path.join(repoRoot, PYTHON)).filter(item => item.endsWith('.py') && !item.startsWith('test_') && item !== 'conftest.py').map(name => [name.slice(0, -3), read(`${PYTHON}/${name}`)]));
}

test('the drawn-points scan finds a read in every form by the field\'s symbol, and passes it on across modules', () => {
    const a = 'src/webview/runtime/fakeDrawnA.ts', b = 'src/webview/runtime/fakeDrawnB.ts';
    const overlay = new Map([
        [a, [
            "import type { StageView } from '../../shared/protocol/backendProtocol';",
            'type Picture = StageView;',
            "const KEY = 'values' as const;",
            'export function dot(view: StageView): number { return view.values?.length ?? 0; }',
            "export function bracket(view: StageView): number { return view['values']?.length ?? 0; }",
            'export function keyed(view: StageView): number { return view[KEY]?.length ?? 0; }',
            'export function destructured(view: StageView): number { const { values } = view; return values?.length ?? 0; }',
            'export function renamed(view: StageView): number { const { values: drawn } = view; return drawn?.length ?? 0; }',
            'export const parameter = ({ values }: StageView): number => values?.length ?? 0;',
            "export function assigned(view: StageView): number { let values: StageView['values']; ({ values } = view); return values?.length ?? 0; }",
            'export function aliased(picture: Picture): number { const other = picture; return other.matrix?.length ?? 0; }',
            "export function picked(view: Pick<StageView, 'events'>): number { return view.events?.length ?? 0; }",
            'export function none(view: StageView): string { return view.frame + String(view.xs?.length); }',
        ].join('\n')],
        [b, [
            "import type { StageView } from '../../shared/protocol/backendProtocol';",
            "import { dot as count, bracket } from './fakeDrawnA';",
            "import * as drawn from './fakeDrawnA';",
            'const alias = bracket;',
            'export function imported(view: StageView): number { return count(view); }',
            'export function viaAlias(view: StageView): number { return alias(view); }',
            'export function viaNamespace(view: StageView): number { return drawn.keyed(view); }',
            'export function asCallback(views: StageView[]): number[] { return views.map(drawn.destructured); }',
            'export function twoAway(view: StageView): number { return imported(view) + 1; }',
        ].join('\n')],
    ]);
    const scan = drawnScan(typedWith(overlay), [a, b], {});
    const found = Object.fromEntries([...scan.found].map(([where, reads]) => [where, [...reads].sort()]));
    assert.deepEqual(found, {
        [`${a}:dot`]: ['StageView.values'],
        [`${a}:bracket`]: ['StageView.values'],
        [`${a}:keyed`]: ['StageView.values'],
        [`${a}:destructured`]: ['StageView.values'],
        [`${a}:renamed`]: ['StageView.values'],
        [`${a}:parameter`]: ['StageView.values'],
        [`${a}:assigned`]: ['StageView.values'],
        [`${a}:aliased`]: ['StageView.matrix'],
        [`${a}:picked`]: ['StageView.events'],
        [`${b}:imported`]: [`${a}:dot`],
        [`${b}:viaAlias`]: [`${a}:bracket`],
        [`${b}:viaNamespace`]: [`${a}:keyed`],
        [`${b}:asCallback`]: [`${a}:destructured`],
        [`${b}:twoAway`]: [`${b}:imported`],
    });
    // A reader classified as only drawing passes nothing on: its callers are not readers (its own flow is checked).
    const drawsOnly = drawnScan(typedWith(overlay), [a, b], { [`${a}:dot`]: { use: 'draws', why: 'x' } });
    assert.equal(drawsOnly.found.has(`${b}:imported`), false);
});

test('the backend\'s readers are found by data flow: a def that takes a returned view\'s values and sends their max is one, with no decimator call in it', () => {
    const sources = pythonSources();
    // Injected (Codex round 1, P2): no decimator is called here; the drawn values come back from stage_view.
    sources.scan_service += '\n\ndef _peak_of(frame):\n    view = stage_view(frame)\n    return {"peakDb": float(np.max(view["values"]))}\n';
    sources.stage_combine += '\n\ndef _top_of(view):\n    return max(view["values"])\n';
    sources.scan_service += '\n\nfrom stage_combine import _top_of\n\n\ndef _send_top(frame):\n    return {"peakDb": _top_of({"p": stage_view(frame)}["p"])}\n';
    const found = pythonFlowReaders(sources);
    assert.ok(found['python-backend/scan_service.py:_peak_of']?.some(origin => origin.startsWith('stage_view:')), JSON.stringify(found['python-backend/scan_service.py:_peak_of']));
    assert.ok(found['python-backend/stage_combine.py:_top_of'], 'a helper in another module given the drawn view through a dict is a reader');
    // As the contract test reads them, both are unclassified readers: the injection fails it.
    const python = pythonDrawn(found);
    assert.deepEqual(['python-backend/scan_service.py:_peak_of', 'python-backend/stage_combine.py:_top_of'].filter(def => python.has(def) && !Object.hasOwn(DRAWN_READERS, def)), ['python-backend/scan_service.py:_peak_of', 'python-backend/stage_combine.py:_top_of']);
});

test('every function that reads drawn points says what it does with them, and a row\'s source agrees with what its functions read', () => {
    const scanned = drawnReaders();
    assert.deepEqual(DRAWN_ACCESSORS.filter(accessor => !scanned.has(accessor)), [], 'a drawn accessor reads no drawn field itself');
    const python = pythonDrawn();
    assert.deepEqual(PY_DECIMATORS.filter(entry => !exists(entry)), [], 'a decimator the scan looks for does not exist');
    // Every def that reads drawn points is classified, the backend's as the webview's, whether a row names it or not.
    const found = new Map([...scanned, ...python]);
    const unclassified = [...found].filter(([where]) => !Object.hasOwn(DRAWN_READERS, where)).map(([where, reads]) => `${where} (${[...reads].sort().join(', ')})`).sort();
    assert.deepEqual(unclassified, [], 'Rule: every function that reads points thinned to draw (a view\'s values, a waveform envelope, a decimator\'s result) says what it does with them. Fix: add each to DRAWN_READERS in src/test/plotContracts/values.ts as use: \'draws\' (it only draws them; checked by data flow), \'value\' (it makes a number of them: its row must then say from thinned or extremes, and is a gap), or \'whole\' (it is given full data: name a proof test). Prefer computing from the full data instead. See docs/plot-contracts-guide.md.');
    assert.deepEqual(Object.keys(DRAWN_READERS).filter(where => !found.has(where) && !python.has(where)).sort(), [], 'Rule: DRAWN_READERS lists only functions that read drawn points today. Fix: remove these lines from src/test/plotContracts/values.ts.');
    for (const row of ROWS) {
        const values = row.computedIn.filter(where => DRAWN_READERS[where]?.use === 'value' && (scanned.has(where) || python.has(where)));
        if (row.from === 'extremes' || row.from === 'thinned') {
            assert.ok(values.length > 0, `${row.id} says it is from ${row.from} points, but names no function the scan finds making a number of drawn points`);
        } else {
            assert.deepEqual(values, [], `${row.id} says it is from ${row.from}, but names functions that make a number of drawn points`);
        }
    }
});

// ── What a 'draws' reader does with drawn points ──

/** Canvas and path calls: drawn points given to one of these are drawn. */
const CANVAS_TYPES = new Set(['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D', 'Path2D', 'CanvasDrawCtx', 'ImageData']);
/** Calls that only say whether a value is there to draw: a decision, not a number of it. */
const PRESENCE_CALLS = new Set(['isFinite', 'isNaN', 'isArray', 'isInteger']);
/** Number methods that write a number as text. */
const TEXT_METHODS = new Set([...NUMBER_TEXT, 'toString', 'join']);
const COMPARISONS = new Set([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);
const ASSIGNMENTS = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);

/**
 * Why each reader classified 'draws' does more than draw, by following the drawn points it reads (drawnScan's reads)
 * through its code with the type checker: through locals, destructuring, loops, array methods and their callbacks,
 * arithmetic and the functions of the scanned files it hands them to (each followed in turn). Drawn points may reach
 * canvas and path calls, a picture handed on to be drawn (an object of a DRAWN_FIELDS type), and decisions of whether
 * there is anything to draw (a field's presence, a null or finite check). A 'draws' reader fails when they, or a value
 * or decision made of them, are returned, written as text (a template, String(), toFixed, a value helper), or kept
 * outside the function: then a number of drawn points leaves the drawing, and the reader is 'value' (or 'whole', with
 * its proof). Python's defs are not followed (they make the drawn points: their numbers are checked by
 * check_decimation_flow.py).
 */
function drawsFlowProblems(scan: DrawnScan, readers: Readonly<Record<string, DrawnReader>> = DRAWN_READERS): string[] {
    const checker = scan.program.getTypeChecker();
    const helpers = new Set(VALUE_HELPERS);
    const problems: string[] = [];
    const primitive = (node: ts.Node): boolean => {
        const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
        return (type.isUnion() ? type.types : [type]).every(part => !!(part.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.StringLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.EnumLike)));
    };
    const isNullish = (node: ts.Node): boolean => node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined') || ts.isVoidExpression(node);
    const typeName = (node: ts.Node): string | undefined => {
        const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
        return (type.aliasSymbol ?? type.getSymbol())?.getName();
    };
    /** Whether an object literal is a picture handed on to be drawn: its type (or contextual type) is a DRAWN_FIELDS type. */
    const drawnTypes: ts.Type[] = [];
    for (const source of scan.program.getSourceFiles()) {
        if (source.isDeclarationFile || !relative(source).startsWith('src/')) continue;
        for (const statement of source.statements) {
            if (!(ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) || !Object.hasOwn(DRAWN_FIELDS, statement.name.text)) continue;
            const symbol = checker.getSymbolAtLocation(statement.name);
            if (symbol) drawnTypes.push(checker.getDeclaredTypeOfSymbol(symbol));
        }
    }
    const picture = (literal: ts.ObjectLiteralExpression): boolean => {
        const types = [checker.getContextualType(literal), checker.getTypeAtLocation(literal)].filter((type): type is ts.Type => !!type);
        return types.some(type => (type.isUnion() ? type.types : [type]).some(part => Object.hasOwn(DRAWN_FIELDS, (part.aliasSymbol ?? part.getSymbol())?.getName() ?? '') || drawnTypes.some(drawn => checker.isTypeAssignableTo(part, drawn))));
    };
    const memo = new Map<string, { returns: boolean; returnedAt: string; problems: string[] }>();

    /** Follows `seeds` (drawn expressions) through `fn`: whether a value of them is returned, and what else is done with them. */
    function follow(key: string, fn: ts.FunctionLikeDeclaration, seeds: ts.Node[], stack: ReadonlySet<string>): { returns: boolean; returnedAt: string; problems: string[] } {
        const found: string[] = [];
        let returns = false;
        let returnedAt = '';
        const inside = (node: ts.Node): boolean => node.pos >= fn.pos && node.end <= fn.end;
        const own = (node: ts.Node): boolean => {
            for (let at: ts.Node | undefined = node.parent; at; at = at.parent) if (ts.isFunctionLike(at)) return at === fn;
            return false;
        };
        // Every reference to each local of the function, to follow a value kept in one.
        const refs = new Map<ts.Symbol, ts.Node[]>();
        each(fn, node => {
            if (!ts.isIdentifier(node)) return;
            const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
            if (symbol) refs.set(symbol, [...(refs.get(symbol) ?? []), node]);
        });
        const done = new Set<ts.Node>();
        const queue: ts.Node[] = [];
        const taint = (node: ts.Node): void => { if (!done.has(node)) { done.add(node); queue.push(node); } };
        const local = (symbol: ts.Symbol | undefined): boolean => !!symbol?.declarations?.some(inside);
        const bind = (name: ts.Node): void => {
            if (ts.isIdentifier(name)) {
                const symbol = checker.getSymbolAtLocation(name);
                for (const ref of (symbol && refs.get(symbol)) ?? []) if (ref !== name) taint(ref);
            } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
                for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name);
            }
        };
        const where = (node: ts.Node): string => `${relative(node.getSourceFile())}:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText().replace(/\s+/gu, ' ').slice(0, 60)}`;
        const problem = (node: ts.Node, what: string): void => { found.push(`${what} (${where(node)})`); };
        /**
         * The value leaves the function it is in as its result (a return, an arrow's body): this function's own result,
         * or a callback's, whose method (map, reduce, find) then makes a value of it.
         */
        const returned = (node: ts.Node): void => {
            if (own(node)) { if (!returns) returnedAt = where(node); returns = true; return; }
            let at: ts.Node | undefined = node.parent;
            while (at && !ts.isFunctionLike(at)) at = at.parent;
            // A local function handed by name to an array method (`values.map(toLevel)`): its result is what the
            // method makes at each place it was handed.
            for (const site of (at && callbackSites.get(at)) ?? []) {
                const method = ts.isPropertyAccessExpression(site.expression) ? site.expression.name.text : '';
                if (primitive(node) || ['map', 'flatMap', 'reduce', 'reduceRight'].includes(method)) taint(site);
            }
            if (!at || !inside(at) || !(ts.isArrowFunction(at) || ts.isFunctionExpression(at)) || !ts.isCallExpression(at.parent) || !at.parent.arguments.includes(at)) return;
            // A test of a field's presence (`views.every(view => view.waveform)`) is no value; map's result is what it returns.
            const method = ts.isPropertyAccessExpression(at.parent.expression) ? at.parent.expression.name.text : '';
            if (primitive(node) || ['map', 'flatMap', 'reduce', 'reduceRight'].includes(method)) taint(at.parent);
        };
        /** A local function handed by name as a callback, to the array-method calls it was handed to. */
        const callbackSites = new Map<ts.Node, ts.CallExpression[]>();
        /**
         * A callback handed by name (`values.map(toLevel)`, `values.reduce(maxOf, -Infinity)`), not written inline: a
         * local function's parameters are bound as an inline one's; a scanned function of another place is followed as
         * a call given the points at that parameter (reduce's second: its first is the running result).
         */
        const namedCallback = (argument: ts.Expression, site: ts.CallExpression, method: string): void => {
            const index = method === 'reduce' || method === 'reduceRight' ? 1 : 0;
            const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(argument) ? argument.name : argument);
            const resolved = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            const declaration = resolved?.declarations?.[0];
            const local = declaration && inside(declaration) ? (ts.isFunctionDeclaration(declaration) ? declaration : ts.isVariableDeclaration(declaration) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) ? declaration.initializer : undefined) : undefined;
            if (local) {
                const parameters = method === 'reduce' || method === 'reduceRight' ? local.parameters.slice(0, 2) : local.parameters.slice(0, 1);
                parameters.forEach(parameter => bind(parameter.name));
                callbackSites.set(local, [...(callbackSites.get(local) ?? []), site]);
                return;
            }
            const result = followCall(argument, index);
            if (result === undefined) { taint(site); return; }
            for (const inner of result.problems) found.push(`passes it to ${scan.target(argument)}, which ${inner}`);
            if (result.returns && ['map', 'flatMap', 'reduce', 'reduceRight', 'find', 'findLast'].includes(method)) taint(site);
        };
        /** Counts of drawn points (`values.length`, and locals holding one): compared, they check an answer's shape. */
        const counts = new Set<ts.Symbol>();
        const count = (node: ts.Node): boolean => (ts.isPropertyAccessExpression(node) && node.name.text === 'length') || (ts.isIdentifier(node) && counts.has(checker.getSymbolAtLocation(node)!));
        const store = (target: ts.Expression, node: ts.Node): void => {
            let base: ts.Expression = target;
            while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base) || ts.isParenthesizedExpression(base) || ts.isNonNullExpression(base)) {
                // Into a picture's drawn field, or a canvas's pixels: drawn.
                if ((ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) && CANVAS_TYPES.has(typeName(base.expression) ?? '')) return;
                if (typeName(base) === 'Uint8ClampedArray') return;
                base = base.expression;
            }
            const symbol = ts.isIdentifier(base) ? checker.getSymbolAtLocation(base) : undefined;
            if (local(symbol)) { for (const ref of refs.get(symbol!) ?? []) taint(ref); return; }
            problem(node, 'keeps it outside the function');
        };
        const call = (node: ts.CallExpression | ts.NewExpression, index: number): void => {
            const callee = node.expression;
            const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
            if (ts.isPropertyAccessExpression(callee)) {
                if (CANVAS_TYPES.has(typeName(callee.expression) ?? '')) return;
                if (ts.isIdentifier(callee.expression) && ['Number', 'Array', 'Object'].includes(callee.expression.text) && PRESENCE_CALLS.has(name)) return;
                // A WeakMap keyed by the drawn picture is a memo of its drawing (an envelope on screen), read back by it.
                if (['set', 'get', 'has'].includes(name) && typeName(callee.expression) === 'WeakMap') return;
                if (['push', 'unshift', 'set', 'add', 'splice', 'fill'].includes(name)) { store(callee.expression, node); return; }
            }
            if (name === 'String' || (ts.isIdentifier(callee) && PRESENCE_CALLS.has(name))) { if (name === 'String') problem(node, 'writes it as text'); return; }
            const called = scan.target(callee);
            if (called && helpers.has(called)) { problem(node, `writes it as text (${called})`); return; }
            const result = followCall(callee, index);
            if (result !== undefined) {
                for (const inner of result.problems) found.push(`passes it to ${called}, which ${inner}`);
                if (result.returns) taint(node);
                return;
            }
            // Anything else (Math.max, a library): what it makes of them is made of drawn points too.
            taint(node);
        };
        /**
         * A scanned function (`callee` resolves to one) given drawn points at parameter `index`, followed (memoised):
         * null when it takes no such parameter or is already being followed, undefined when it is no scanned one.
         */
        function followCall(callee: ts.Expression, index: number): { returns: boolean; returnedAt: string; problems: string[] } | undefined {
            const called = scan.target(callee);
            const fn2 = called ? scan.functions.get(called) : undefined;
            if (!called || !fn2) return undefined;
            if (stack.has(called)) return { returns: false, returnedAt: '', problems: [] };
            const parameter = fn2.parameters[Math.min(index, fn2.parameters.length - 1)];
            if (!parameter) return { returns: false, returnedAt: '', problems: [] };
            const memoKey = `${called}#${index}`;
            let result = memo.get(memoKey);
            if (!result) {
                const seeds2: ts.Node[] = [];
                const collect = (name: ts.BindingName): void => {
                    if (ts.isIdentifier(name)) { const symbol = checker.getSymbolAtLocation(name); each(fn2, ref => { if (ts.isIdentifier(ref) && ref !== name && checker.getSymbolAtLocation(ref) === symbol) seeds2.push(ref); }); }
                    else for (const element of name.elements) if (ts.isBindingElement(element)) collect(element.name);
                };
                collect(parameter.name);
                result = follow(called, fn2, seeds2, new Set([...stack, called]));
                memo.set(memoKey, result);
            }
            return result;
        }
        seeds.forEach(taint);
        while (queue.length) {
            const node = queue.pop()!;
            const parent = node.parent;
            if (!parent) continue;
            if (ts.isBindingElement(parent) && parent.name === node) bind(node);
            else if (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isTypeAssertionExpression(parent)) taint(parent);
            else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
                const name = parent.name.text;
                if (ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
                    // A method of the drawn points: its callbacks are given them, and what it makes is made of them.
                    if (TEXT_METHODS.has(name)) { problem(parent.parent, 'writes it as text'); continue; }
                    for (const argument of parent.parent.arguments) {
                        if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) argument.parameters.slice(0, name === 'reduce' ? 2 : 1).forEach(parameter => bind(parameter.name));
                        // A callback handed by name is followed as the inline one (its parameters, what it returns).
                        else if ((ts.isIdentifier(argument) || ts.isPropertyAccessExpression(argument)) && argument === parent.parent.arguments[0]) namedCallback(argument, parent.parent, name);
                    }
                    // map, flatMap and reduce make what their callbacks return (followed there); the rest are of the points.
                    if (!['forEach', 'map', 'flatMap', 'reduce', 'reduceRight', 'every', 'some', 'findIndex', 'findLastIndex'].includes(name)) taint(parent.parent);
                } else if (name === 'length' || !primitive(parent) || ts.isArrayTypeNode(parent)) taint(parent);
                else if (checker.isArrayLikeType(checker.getNonNullableType(checker.getTypeAtLocation(node)))) taint(parent);
                // A primitive field of an object among them (an event's id, a unit) is not a drawn value.
            } else if (ts.isElementAccessExpression(parent) && parent.expression === node) taint(parent);
            else if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node as ts.Expression)) call(parent, parent.arguments.indexOf(node as ts.Expression));
            else if (ts.isSpreadElement(parent)) {
                const outer = parent.parent;
                if ((ts.isCallExpression(outer) || ts.isNewExpression(outer)) && outer.arguments) call(outer, outer.arguments.indexOf(parent));
                else taint(outer);
            } else if (ts.isArrayLiteralExpression(parent)) taint(parent);
            else if ((ts.isPropertyAssignment(parent) && parent.initializer === node) || ts.isShorthandPropertyAssignment(parent) || ts.isSpreadAssignment(parent)) {
                if (!picture(parent.parent)) taint(parent.parent);
            } else if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
                if (count(node) && ts.isIdentifier(parent.name)) { const symbol = checker.getSymbolAtLocation(parent.name); if (symbol) counts.add(symbol); }
                bind(parent.name);
            }
            else if (ts.isForOfStatement(parent) && parent.expression === node) {
                const declared = parent.initializer;
                if (ts.isVariableDeclarationList(declared)) declared.declarations.forEach(declaration => bind(declaration.name));
            } else if (ts.isBinaryExpression(parent)) {
                const kind = parent.operatorToken.kind;
                const other = parent.left === node ? parent.right : parent.left;
                if (ASSIGNMENTS.has(kind) && parent.right === node) store(parent.left, parent);
                else if (COMPARISONS.has(kind)) { if (!isNullish(other) && !count(node)) taint(parent); }
                else if (kind === ts.SyntaxKind.PlusToken && checker.getTypeAtLocation(other).flags & ts.TypeFlags.StringLike) problem(parent, 'writes it as text');
                else if (kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.left === node && !primitive(node)) { /* present: the right is not of them */ }
                else if (kind === ts.SyntaxKind.CommaToken) { if (parent.right === node) taint(parent); }
                else if (kind !== ts.SyntaxKind.InKeyword && kind !== ts.SyntaxKind.InstanceOfKeyword) taint(parent);
            } else if (ts.isPrefixUnaryExpression(parent)) {
                // `!picture.events` says only whether there are any; `!value` and `-value` are of the value.
                if (parent.operator !== ts.SyntaxKind.ExclamationToken || primitive(node)) taint(parent);
            } else if (ts.isPostfixUnaryExpression(parent)) taint(parent);
            else if (ts.isConditionalExpression(parent)) {
                // A value chosen by one of them is of them; by a field's presence, it is not.
                if (parent.condition !== node || primitive(node)) taint(parent);
            } else if (ts.isIfStatement(parent) && parent.expression === node && primitive(node)) {
                // A branch taken on a value of them that returns: the result is chosen by drawn points.
                let chooses = false;
                const look = (inner: ts.Node): void => { if (ts.isReturnStatement(inner) && inner.expression && own(inner)) chooses = true; if (!ts.isFunctionLike(inner)) ts.forEachChild(inner, look); };
                look(parent.thenStatement);
                if (parent.elseStatement) look(parent.elseStatement);
                if (chooses) returned(parent);
            } else if (ts.isReturnStatement(parent)) returned(parent);
            else if (ts.isArrowFunction(parent) && parent.body === node) returned(node);
            else if (ts.isTemplateSpan(parent)) problem(parent.parent, 'writes it as text (a template)');
        }
        void key;
        return { returns, returnedAt, problems: [...new Set(found)] };
    }

    for (const [where, entry] of Object.entries(readers)) {
        if (entry.use !== 'draws' || where.endsWith('.py') || where.startsWith(`${PYTHON}/`)) continue;
        const fn = scan.functions.get(where);
        const seeds = scan.reads.get(where) ?? [];
        if (!fn) { if (scan.found.has(where)) problems.push(`${where}: no function to follow`); continue; }
        const result = follow(where, fn, seeds, new Set([where]));
        // An accessor hands its drawn points on: its callers are scanned as readers of them.
        if (result.returns && !DRAWN_ACCESSORS.includes(where)) problems.push(`${where}: 'draws', but returns a value made of drawn points, or chosen by one (${result.returnedAt})`);
        for (const inner of result.problems) problems.push(`${where}: 'draws', but ${inner}`);
    }
    return problems;
}

test('every reader classified \'draws\' only draws: no value of its drawn points is returned, written or kept', () => {
    assert.deepEqual(drawsFlowProblems(drawnScan()), [], 'Rule: a reader classified use: \'draws\' in DRAWN_READERS may only draw its thinned points. Each line names one that returns, writes or keeps a number made of them. Fix: compute that number from the full data (the backend\'s valueRange / levelBins / a full read), or reclassify the reader as \'value\' and mark its row from thinned. See docs/plot-contracts-guide.md.');
});

test('the draws check fails on a reader that computes a number of drawn points while said to draw', () => {
    const a = 'src/webview/runtime/fakeDraws.ts';
    const overlay = new Map([[a, [
        "import type { StageView } from '../../shared/protocol/backendProtocol';",
        "import { levelText } from '../plot/plotText';",
        'export function peak(view: StageView): number { return Math.max(...(view.values ?? []).map(value => value ?? -Infinity)); }',
        'export function loud(view: StageView): string { const { values } = view; let top = -Infinity; for (const value of values ?? []) if (value !== null && value > top) top = value; return levelText(top, "dB"); }',
        'export function label(view: StageView): string { return `${view.values?.[0]}`; }',
        'export function chosen(view: StageView): string { return (view.values?.[0] ?? 0) > 0 ? "loud" : "quiet"; }',
        'const kept: number[] = [];',
        'export function keeps(view: StageView): void { for (const value of view.values ?? []) if (value !== null) kept.push(value); }',
        'function largest(values: readonly (number | null)[]): number { return Math.max(...values.map(value => value ?? -Infinity)); }',
        "export function handsOn(view: StageView): number { return largest(view['values'] ?? []); }",
        'const toLevel = (value: number | null): number => value ?? -Infinity;',
        'export function viaNamed(view: StageView): number { return Math.max(...(view.values ?? []).map(toLevel)); }',
        'function maxOf(top: number, value: number | null): number { return Math.max(top, value ?? -Infinity); }',
        'export function viaReduce(view: StageView): number { return (view.values ?? []).reduce(maxOf, -Infinity); }',
        'const levels = { of: (value: number | null): number => value ?? -Infinity };',
        'export function viaMember(view: StageView): number[] { return (view.values ?? []).map(levels.of); }',
        'export function strokes(context: CanvasRenderingContext2D, view: StageView): boolean {',
        '    const values = view.values ?? [];',
        '    values.forEach((value, index) => { if (value === null || !Number.isFinite(value)) return; context.lineTo(index, value * 2); });',
        '    return !!view.events;',
        '}',
    ].join('\n')]]);
    const program = typedWith(overlay);
    const names = ['peak', 'loud', 'label', 'chosen', 'keeps', 'handsOn', 'viaNamed', 'viaReduce', 'viaMember', 'strokes'];
    const readers = Object.fromEntries(names.map(name => [`${a}:${name}`, { use: 'draws' as const, why: 'x' }]));
    const problems = drawsFlowProblems(drawnScan(program, [a], readers), readers).join('\n');
    assert.match(problems, /fakeDraws\.ts:peak: 'draws', but returns/u, problems);
    assert.match(problems, /fakeDraws\.ts:loud: 'draws', but writes it as text/u);
    assert.match(problems, /fakeDraws\.ts:label: 'draws', but writes it as text \(a template\)/u);
    assert.match(problems, /fakeDraws\.ts:chosen: 'draws', but returns/u);
    assert.match(problems, /fakeDraws\.ts:keeps: 'draws', but keeps it outside the function/u);
    assert.match(problems, /fakeDraws\.ts:handsOn: 'draws', but returns/u);
    // A callback passed by name (a const arrow, a function, a member) is followed as an inline one is.
    assert.match(problems, /fakeDraws\.ts:viaNamed: 'draws', but returns/u);
    assert.match(problems, /fakeDraws\.ts:viaReduce: 'draws', but returns/u);
    assert.match(problems, /fakeDraws\.ts:viaMember: 'draws', but returns/u);
    // Drawing them, and saying whether there are events, is drawing.
    assert.doesNotMatch(problems, /fakeDraws\.ts:strokes/u);
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

/**
 * Every test a row marks `tells` (model.ts `tt`), checked by what it does, not its words: why each is no proof.
 * `rows` and `check` are parameters for the injections below.
 */
function tellsProblems(rows: readonly ContractRow[] = ROWS, check: (targets: readonly string[], proof: Proof) => string | null = proofProblem): string[] {
    const problems: string[] = [];
    for (const row of rows) {
        for (const named of row.tests.filter(item => item.tells)) {
            const problem = check(row.computedIn, named);
            if (problem) problems.push(`${row.id}: ${problem}. ${PROOF_HELP}`);
        }
    }
    return problems;
}

/** What a newcomer needs when a proof fails: the rule, and what to write. */
const PROOF_HELP = [
    'Rule: a test marked tt(...) in src/test/plotContracts/charts must prove its row is computed from the full data, not the points thinned to draw.',
    'It must (1) call one of the row\'s computedIn functions (directly, or an exported function of that file or a pytest import that calls it);',
    '(2) assert the answer outright (assert.equal / deepEqual, or pytest `==`); and',
    '(3) assert it is not the answer the drawn points give: assertNotDrawn(answer, drawnAnswer) from src/test/fullNotDrawn.ts (pytest: assert_not_drawn from conftest.py), where drawnAnswer is worked out in the test from the thinned data, never null or a constant.',
    'If this test cannot do that, mark it t(...) instead and give the row another tt(...) test that does. See docs/plot-contracts-guide.md.',
].join(' ');

test('every test a row says tells full data from drawn points proves it: it reaches the row\'s code and asserts its answer is not the drawn points\' answer', () => {
    assert.deepEqual(tellsProblems(), []);
});

/** What each function of a file calls or names (a command table's entry), by the function it is in. */
const graphs = new Map<string, Map<string, Set<string>>>();
function callGraph(file: string): Map<string, Set<string>> {
    let graph = graphs.get(file);
    if (graph) return graph;
    const own = functionsOf(file);
    const found = new Map<string, Set<string>>();
    each(parse(file), node => {
        if (!ts.isIdentifier(node) || !own.has(node.text)) return;
        // A declaration's own name, or a property of something else, is not a use of the file's function.
        if ((node.parent as { name?: ts.Node }).name === node) return;
        const from = enclosing(node);
        const to = found.get(from) ?? new Set<string>();
        to.add(node.text);
        found.set(from, to);
    });
    graph = found;
    graphs.set(file, graph);
    return graph;
}

/** The functions of a file that reach `name` (it among them): what a test can call to give it data. */
function reachersOf(file: string, name: string): Set<string> {
    const graph = callGraph(file);
    const reach = new Set([name]);
    for (let grown = true; grown;) {
        grown = false;
        for (const [from, to] of graph) if (!reach.has(from) && [...to].some(callee => reach.has(callee))) { reach.add(from); grown = true; }
    }
    return reach;
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Why a 'whole' reader's classification is not proven: each names a test (its proof) that runs, asserts, tells the
 * full data from the drawn points (TELLS), and reaches the reader: it imports the reader's module and calls an
 * exported function of it that calls the reader, or sends the command (`via`) the reader's file maps to one.
 * Without it, the table alone would say a decimated array never reaches a reader that makes a number of it.
 */
function wholeProofProblems(readers: Readonly<Record<string, DrawnReader>>): string[] {
    const problems: string[] = [];
    for (const [where, entry] of Object.entries(readers)) {
        if (entry.use !== 'whole') continue;
        if (!entry.proof) { problems.push(`${where}: 'whole' names no test showing it is given full data`); continue; }
        const problem = proofProblem([where], entry.proof);
        if (problem) problems.push(`${where}: ${problem}`);
    }
    return problems;
}

/** A test given as proof that code computes from the full data, not the drawn points. */
interface Proof { file: string; name: string; via?: string }

/**
 * Why `proof` does not show that one of `targets` (`file:function`, a webview function or a backend def) is given
 * the full data where the drawn points differ, or null: it must run and assert, speak of what is thinned (TELLS),
 * reach a target (call an exported function of its file that calls it, or send the command `via` its file maps to
 * one; a pytest calls a def of its module that reaches it), and assert the code's answer outright and not equal to
 * an answer made of other inputs (distinguishes / python_proof.py).
 */
function proofProblem(targets: readonly string[], proof: Proof): string | null {
    if (!existsSync(path.join(repoRoot, proof.file))) return `no file ${proof.file}`;
    if (SELF_REFERENTIAL.includes(proof.file)) return `"${proof.name}" checks the plot against its own answer`;
    if (proof.file.endsWith('.py')) return pythonProofs([{ targets, proof }])[0] ?? null;
    const problem = testProblem(proof.file, read(proof.file), proof.name);
    if (problem) return problem;
    const own = namedTest(proof.file, read(proof.file), proof.name)?.body ?? '';
    if (!TELLS.test(`${proof.name}\n${own}`)) return `"${proof.name}" does not tell the full data from the drawn points`;
    // The test file's own helpers the test calls (a `lanes(...)` that paints) are part of what it runs.
    const helpers = new Map<string, string>();
    for (const statement of parse(proof.file).statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) helpers.set(statement.name.text, statement.getText());
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isFunctionLike(declaration.initializer)) helpers.set(declaration.name.text, declaration.getText());
    }
    const used = new Set<string>();
    let body = own;
    for (let grown = true; grown;) {
        grown = false;
        for (const [name, text] of helpers) if (!used.has(name) && new RegExp(`\\b${escapeRe(name)}\\(`).test(body)) { used.add(name); body += `\n${text}`; grown = true; }
    }
    const reach = new Set<string>();
    let commanded = false;
    for (const target of targets) {
        if (target.endsWith('.py') || target.includes('.py:')) continue;
        const at = target.lastIndexOf(':');
        const file = target.slice(0, at), name = target.slice(at + 1);
        if (!existsSync(path.join(repoRoot, file))) continue;
        const reachers = reachersOf(file, name);
        const exported = exportedOf(file);
        const module = path.basename(file, '.ts');
        const imports = new RegExp(`from ['"][^'"]*/${escapeRe(module)}['"]`).test(read(proof.file));
        for (const caller of reachers) if (imports && exported.has(caller) && new RegExp(`\\b${escapeRe(caller)}\\(`).test(body)) reach.add(caller);
        const mapped = proof.via ? new RegExp(`['"]${escapeRe(proof.via)}['"]\\s*:\\s*(\\w+)\\b`).exec(read(file))?.[1] : undefined;
        if (!!proof.via && body.includes(proof.via) && !!mapped && reachers.has(mapped)) commanded = true;
    }
    // A UI smoke test drives the whole app: what it reads off the page is the code's answer, whichever function made it.
    if (proof.file.startsWith('src/test/uiSmoke/')) commanded = true;
    // A UI smoke test drives the whole app: what it reads off the page is the code's answer, whichever function made it.
    if (proof.file.startsWith('src/test/uiSmoke/')) commanded = true;
    if (!reach.size && !commanded) return `"${proof.name}" never reaches it`;
    // What a reached function is called by in the test: every reacher of every target (the test may call another).
    const callable = new Set<string>();
    for (const target of targets) {
        const at = target.lastIndexOf(':');
        if (!target.includes('.py:') && existsSync(path.join(repoRoot, target.slice(0, at)))) for (const caller of reachersOf(target.slice(0, at), target.slice(at + 1))) callable.add(caller);
    }
    // A helper of the test file that calls the code gives its answer too.
    for (const name of used) if ([...callable].some(caller => new RegExp(`\\b${escapeRe(caller)}\\(`).test(helpers.get(name) ?? ''))) callable.add(name);
    if (!distinguishes(proof.file, proof.name, commanded ? null : callable)) return `"${proof.name}" asserts no case where the full data and the drawn points give different answers`;
    return null;
}

/** What scripts/check_test_proofs.py finds of each pytest given as proof (its problem, or null), in order. */
function pythonProofs(items: ReadonlyArray<{ targets: readonly string[]; proof: Proof }>): Array<string | null> {
    const venv = path.join(repoRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';
    const input = JSON.stringify(items.map(({ targets, proof }) => ({ targets, file: proof.file, name: proof.name })));
    const run = spawnSync(python, ['scripts/check_test_proofs.py'], { cwd: repoRoot, encoding: 'utf8', input });
    assert.equal(run.status, 0, `check_test_proofs.py: ${run.stderr}`);
    return JSON.parse(run.stdout) as Array<string | null>;
}

const NEGATIVE_ASSERTS = new Set(['assertNotDrawn', 'notEqual', 'notDeepEqual', 'notStrictEqual', 'notDeepStrictEqual', 'doesNotMatch']);
const POSITIVE_ASSERTS = new Set(['equal', 'deepEqual', 'strictEqual', 'deepStrictEqual', 'match', 'toEqual', 'toBe', 'toBeCloseTo', 'toStrictEqual', 'toHaveText', 'toContain', 'toMatch']);

/**
 * Whether the test `name` of `file` tells the full data from the drawn points by what it asserts, not its words: it
 * asserts the answer of the code under test (a call of one of `reach`, or of anything for a test that sends a
 * command) is not what another case gives (notEqual, notDeepEqual, doesNotMatch, `.not.`, `ok(a !== b)`: the drawn
 * points' answer), and asserts an answer outright (equal, deepEqual, toBe…: the full data's). Both sides of that
 * negative assertion must be answers of the code under test, and not the same expression: a comparison against null
 * or a constant does not tell one input from the other.
 */
function distinguishes(file: string, name: string, reach: ReadonlySet<string> | null): boolean {
    let body: ts.Node | undefined;
    each(parse(file), node => {
        if (body || !ts.isCallExpression(node)) return;
        const callee = node.expression;
        const isTest = (ts.isIdentifier(callee) && callee.text === 'test') || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'test');
        const title = node.arguments[0];
        if (isTest && title && ts.isStringLiteralLike(title) && title.text === name) body = node.arguments.find(argument => ts.isFunctionLike(argument));
    });
    if (!body) return false;
    // The locals of the test made of the code under test (`const range = stageRange(...)`).
    const answers = new Set<string>();
    const answer = (node: ts.Node): boolean => {
        let found = reach === null;
        each(node, inner => {
            if (ts.isCallExpression(inner) && reach?.has((ts.isPropertyAccessExpression(inner.expression) ? inner.expression.name : inner.expression).getText())) found = true;
            if (ts.isIdentifier(inner) && answers.has(inner.text)) found = true;
        });
        return found;
    };
    // A canvas (or a recorder) given to the code under test holds its answer too (`canvas.dataset.plotOrder`).
    each(body, node => {
        if (ts.isCallExpression(node) && reach?.has((ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression).getText())) for (const argument of node.arguments) if (ts.isIdentifier(argument)) answers.add(argument.text);
    });
    for (let grown = true; grown;) {
        grown = false;
        each(body, node => {
            if (!ts.isVariableDeclaration(node) || !node.initializer || !answer(node.initializer)) return;
            // `const range = f(...)`, and every name of `const { drawn, canvases } = f(...)`.
            const bound: string[] = [];
            each(node.name, inner => { if (ts.isIdentifier(inner) && !(ts.isBindingElement(inner.parent) && inner.parent.propertyName === inner)) bound.push(inner.text); });
            for (const name of bound) if (!answers.has(name)) { answers.add(name); grown = true; }
        });
    }
    // A side with no name in it but constants (null, a number, a pattern, a literal of those, a local holding one) is
    // no input's answer.
    const constants = new Set(['undefined', 'NaN', 'Infinity']);
    const constant = (node: ts.Node): boolean => {
        let named = false;
        each(node, inner => { if (ts.isIdentifier(inner) && !constants.has(inner.text) && !((ts.isPropertyAccessExpression(inner.parent) || ts.isPropertyAssignment(inner.parent)) && inner.parent.name === inner)) named = true; });
        return !named;
    };
    // A local holding a literal that the test also hands on (to the code under test, or into other data) is an
    // input, not a constant: only one used in assertions alone tells nothing.
    const inputs = new Set<string>();
    const inAssertion = (node: ts.Node): boolean => {
        for (let at: ts.Node | undefined = node.parent; at && at !== body; at = at.parent) {
            if (ts.isCallExpression(at)) {
                const text = at.expression.getText();
                if (/^(?:assert\b|expect\b)/u.test(text) || NEGATIVE_ASSERTS.has(text)) return true;
            }
        }
        return false;
    };
    each(body, node => {
        if (ts.isIdentifier(node) && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) && !((ts.isPropertyAccessExpression(node.parent) || ts.isPropertyAssignment(node.parent)) && node.parent.name === node) && !inAssertion(node)) inputs.add(node.text);
    });
    for (let grown = true; grown;) {
        grown = false;
        each(body, node => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !constants.has(node.name.text) && !inputs.has(node.name.text) && constant(node.initializer)) { constants.add(node.name.text); grown = true; }
        });
    }
    let negative = false, positive = false;
    each(body, node => {
        if (!ts.isCallExpression(node)) return;
        const callee = node.expression;
        const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
        // expect(x).not.toBe(y): negated; expect(x).toBe(y): outright.
        const negated = ts.isPropertyAccessExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'not';
        const subject = (negated ? ((callee).expression as ts.PropertyAccessExpression).expression : ts.isPropertyAccessExpression(callee) ? callee.expression : undefined);
        const expectArgs = subject && ts.isCallExpression(subject) && ts.isIdentifier(subject.expression) && subject.expression.text === 'expect' ? subject.arguments : undefined;
        const args = [...node.arguments, ...(expectArgs ?? [])];
        const asserting = (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'assert') || !!expectArgs || (ts.isIdentifier(callee) && (callee.text === 'assert' || NEGATIVE_ASSERTS.has(callee.text)));
        if (!asserting || !args.some(answer)) return;
        const first = node.arguments[0];
        const inequality = (method === 'ok' || method === 'assert') && first && ts.isBinaryExpression(first) && [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken].includes(first.operatorToken.kind);
        if (NEGATIVE_ASSERTS.has(method) || negated || inequality) {
            // Told apart only when one side is an answer of the code under test and the other is made of the test's
            // inputs too (the drawn points' answer), never the same expression: `notEqual(result, null)`, or a match
            // against a constant or a local holding one, tells nothing.
            // `ok(answer - drawn > 3)` or `ok(Math.abs(answer - drawn) > 3)`: apart by more than a margin.
            const gapOf = (node: ts.Expression): ts.BinaryExpression | undefined => {
                let inner = node;
                while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
                if (ts.isCallExpression(inner) && inner.expression.getText() === 'Math.abs' && inner.arguments[0]) inner = inner.arguments[0];
                while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
                return ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.MinusToken ? inner : undefined;
            };
            const gap = inequality && ts.isBinaryExpression(first) && first.operatorToken.kind === ts.SyntaxKind.GreaterThanToken ? gapOf(first.left) : undefined;
            const sides = gap ? [gap.left, gap.right] : inequality && ts.isBinaryExpression(first) ? [first.left, first.right] : negated ? [expectArgs?.[0], node.arguments[0]] : [...node.arguments.slice(0, 2)];
            const [left, right] = sides;
            if (left && right && !constant(left) && !constant(right) && (answer(left) || answer(right)) && left.getText() !== right.getText()) negative = true;
        } else if (POSITIVE_ASSERTS.has(method)) positive = true;
    });
    return negative && positive;
}

test('every reader classified \'whole\' names a test that gives it full data where the drawn points differ, and reaches it', () => {
    assert.deepEqual(wholeProofProblems(DRAWN_READERS), [], `Rule: a reader classified use: 'whole' in DRAWN_READERS names a proof test showing it is given full data. ${PROOF_HELP}`);
});

test('the whole-reader check fails on a misclassified reader: one that makes a number of drawn points called \'whole\'', () => {
    const summary = 'src/webview/runtime/trackStageModel.ts:pictureSummary';
    assert.equal(DRAWN_READERS[summary]?.use, 'value', 'the injection starts from a reader the table says makes a number of drawn points');
    const range = DRAWN_READERS[`src/webview/runtime/stagePanes.ts:stageRange`];
    const inject = (entry: DrawnReader): string[] => wholeProofProblems({ ...DRAWN_READERS, [summary]: entry });
    // pictureSummary takes a count and median of the drawn points: called 'whole' with no proof, or with another
    // reader's proof (a test that never reaches it), or with a test that says nothing of thinning, it is caught.
    assert.match(inject({ use: 'whole', why: 'x' }).join('\n'), /pictureSummary: 'whole' names no test/u);
    assert.match(inject({ use: 'whole', why: 'x', proof: range?.proof }).join('\n'), /pictureSummary: .* never reaches it/u);
    assert.match(inject({ use: 'whole', why: 'x', proof: { file: 'src/test/trackStageModel.test.ts', name: 'no such test' } }).join('\n'), /is not a test/u);
    assert.match(inject({ use: 'whole', why: 'x', proof: { file: 'src/test/uiSmoke/plotContract.spec.ts', name: 'x' } }).join('\n'), /its own answer/u);
    // A command named that the reader's file does not map to it is no proof either.
    const csv = DRAWN_READERS['src/webview/runtime/comparisonRuntime.ts:writeCsvWhenDetailed'];
    assert.match(wholeProofProblems({ ...DRAWN_READERS, 'src/webview/runtime/comparisonRuntime.ts:writeCsvWhenDetailed': { ...csv, proof: { ...csv.proof!, via: 'export-png' } } }).join('\n'), /writeCsvWhenDetailed: .* never reaches it/u);
});

test('the whole-reader check fails on a proof that reaches its reader and speaks of thinning, but asserts no case where full and drawn differ', () => {
    // A proof written here for the injection (removed after): it gives the same answer for full and drawn data.
    const file = 'src/test/injectedWholeProof.test.ts';
    const name = 'a range is the full data\'s, never the points drawn';
    const write = (assertions: string[]): void => writeFileSync(path.join(repoRoot, file), [
        "import assert from 'node:assert/strict';",
        "import test from 'node:test';",
        "import type { StageView } from '../shared/protocol/backendProtocol';",
        "import { stageRange } from '../webview/runtime/stagePanes';",
        "const line = (values: number[], valueRange?: StageView['valueRange']): StageView => ({ frame: 'SpectralFrame', kind: 'line', xs: values.map((_, i) => i), values, ...(valueRange ? { valueRange } : {}) });",
        `test('${name.replace(/'/gu, "\\'")}', () => {`,
        ...assertions,
        '});',
    ].join('\n'));
    const range = 'src/webview/runtime/stagePanes.ts:stageRange';
    const check = (): string[] => {
        parsed.delete(file);
        return wholeProofProblems({ [range]: { use: 'whole', why: 'x', proof: { file, name } } });
    };
    try {
        // Full and drawn data that give one answer: it says nothing of which one the reader takes.
        write(["    assert.deepEqual(stageRange([line([-61, -2], { min: -61, max: -2 })]), stageRange([line([-61, -2])]));"]);
        assert.match(check().join('\n'), /stageRange: .* asserts no case where the full data and the drawn points give different answers/u);
        // Words of a difference without asserting one are no better.
        write(["    // the drawn points differ from the full data", "    assert.ok(stageRange([line([-61, -2])]).max >= -2);"]);
        assert.match(check().join('\n'), /asserts no case/u);
        // Told apart from null, or from a constant, is not told apart from the drawn points.
        write([
            "    assert.deepEqual(stageRange([line([-43, -12], { min: -61, max: -2 })]), stageRange([line([-61, -2])]));",
            "    const full = stageRange([line([-43, -12], { min: -61, max: -2 })]);",
            "    assert.notEqual(full, null);",
            "    assert.notDeepEqual(full, { min: 0, max: 0 });",
            "    assert.ok(full !== undefined);",
            "    assert.notDeepEqual(full, full);",
            "    const zero = { min: 0, max: 0 };",
            "    assert.notDeepEqual(full, zero);",
        ]);
        assert.match(check().join('\n'), /stageRange: .* asserts no case where the full data and the drawn points give different answers/u);
        // A drawn line whose extremes were thinned away, its full range asserted and told from the drawn points': proven.
        write([
            "    assert.deepEqual(stageRange([line([-43, -12], { min: -61, max: -2 })]), stageRange([line([-61, -2])]));",
            "    assert.notDeepEqual(stageRange([line([-43, -12], { min: -61, max: -2 })]), stageRange([line([-43, -12])]));",
        ]);
        assert.deepEqual(check(), []);
        // The same holds for a row's tt(...) test: the shared helper with the drawn points' answer proves it; with
        // null, or with nothing told apart, the row's proof fails and says what to write.
        const row = (): string[] => {
            parsed.delete(file);
            return tellsProblems([{ id: 'injected.range', chart: 'injected', value: 'range', what: 'x', computedIn: [range], from: 'full', trace: 'x', tests: [{ file, name, tells: true }] }]);
        };
        const helper = "    const { assertNotDrawn } = require('./fullNotDrawn') as typeof import('./fullNotDrawn');";
        const full = "    const full = stageRange([line([-43, -12], { min: -61, max: -2 })]);";
        write([helper, full, "    assert.deepEqual(full, stageRange([line([-61, -2])]));", "    assertNotDrawn(full, stageRange([line([-43, -12])]));"]);
        assert.deepEqual(row(), []);
        write([helper, full, "    assert.deepEqual(full, stageRange([line([-61, -2])]));", "    assertNotDrawn(full, null);"]);
        assert.match(row().join('\n'), /injected\.range: .* asserts no case where the full data and the drawn points give different answers\. Rule: .*assertNotDrawn\(answer, drawnAnswer\)/u);
        write([helper, full, "    assert.deepEqual(full, stageRange([line([-61, -2])]));"]);
        assert.match(row().join('\n'), /asserts no case/u);
        // A test that never calls the row's code proves nothing of it, whatever it asserts.
        write([helper, "    const full = { min: -61, max: -2 }, drawn = [full].map(range => ({ ...range, min: -43 }))[0];", "    assert.deepEqual(full, { min: -61, max: -2 });", "    assertNotDrawn(full, drawn);"]);
        assert.match(row().join('\n'), /never reaches it/u);
    } finally {
        rmSync(path.join(repoRoot, file), { force: true });
        parsed.delete(file);
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
