import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { namedTest, testProblem } from './namedTest';
import { CHARTS, CONTRACTS, GAP_CEILING, KNOWN_GAPS, ROWS } from './plotContracts/index';
import type { ContractRow } from './plotContracts/model';
import { CONTRACT_DOC, renderContractDoc } from './plotContracts/render';
import { NOT_SHOWN, SCHEMA_FIELDS } from './plotContracts/schema';
import { BACKEND_READERS, NOT_CHART_VALUES, PY_DECIMATORS, VALUE_HELPERS } from './plotContracts/values';
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

/**
 * Every use of the plot component outside it, by the function that makes it. Found by symbol: any name that resolves
 * to one of stagePanes.ts's painters, whatever it is imported as (`paintOverlay as draw`, `panes.paintOverlay`) and
 * whether it is called there or handed on as a value.
 */
function plotCallers(program: ts.Program = typed(), files: readonly string[] = sourceFiles()): Set<string> {
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

test('a use of the plot component is found under any name: imported under another, through a namespace, or handed on as a value', () => {
    const file = 'src/webview/runtime/injectedPainter.ts';
    const program = typedWith(new Map([[file, [
        "import { paintOverlay as draw } from './stagePanes';",
        "import * as panes from './stagePanes';",
        'export function renamed(...args: Parameters<typeof draw>) { return draw(...args); }',
        'export function spaced(...args: Parameters<typeof panes.paintStage>) { return panes.paintStage(...args); }',
        'export function handedOn() { const painter = panes.paintOverlay; return painter; }',
        "export function unrelated() { const paintOverlay = (): number => 1; return paintOverlay(); }",
    ].join('\n')]]));
    assert.deepEqual([...plotCallers(program, [file])].sort(), ['handedOn', 'renamed', 'spaced'].map(name => `${file}:${name}`));
});

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
    assert.deepEqual(['python-backend/scan_service.py:_peak_of', 'python-backend/stage_combine.py:_top_of'].filter(def => python.has(def) && !Object.hasOwn(BACKEND_READERS, def)), ['python-backend/scan_service.py:_peak_of', 'python-backend/stage_combine.py:_top_of']);
});

test('every backend function that computes with thinned points says what it does with them (drawn_points_contract.json)', () => {
    const python = pythonDrawn();
    assert.deepEqual(PY_DECIMATORS.filter(entry => !exists(entry)), [], 'Rule: every decimator in python-backend/drawn_points_contract.json is a def of the backend. Fix: remove or rename these.');
    const unclassified = [...python].filter(([where]) => !Object.hasOwn(BACKEND_READERS, where)).map(([where, reads]) => `${where} (${[...reads].sort().join(', ')})`).sort();
    assert.deepEqual(unclassified, [], 'Rule: every backend function that computes with points thinned to draw (it calls a decimator, or is handed its result) says what it does with them. Fix: add each to "readers" in python-backend/drawn_points_contract.json as use "draws" (it only makes the picture; scripts/check_decimation_flow.py checks that by data flow) or "value" (a number is made of them: its row must then say from thinned or extremes, and is a gap). Prefer computing from the full data instead. See docs/plot-contracts-guide.md.');
    assert.deepEqual(Object.keys(BACKEND_READERS).filter(where => !python.has(where)).sort(), [], 'Rule: "readers" in python-backend/drawn_points_contract.json lists only functions that compute with thinned points today. Fix: remove these entries.');
    for (const row of ROWS) {
        const values = row.computedIn.filter(where => BACKEND_READERS[where]?.use === 'value');
        if (row.from === 'extremes' || row.from === 'thinned') continue;
        assert.deepEqual(values, [], `${row.id} says it is from ${row.from}, but names backend functions that make a number of thinned points`);
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
            else if (/\b(?:number|Drawn)\b/.test(member.type.getText())) fields.push(name);
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
    'It must (1) use one of the row\'s computedIn functions (itself, a function of its file that calls it, or a helper of the test file that does; a pytest: an import that calls it);',
    '(2) assert that code\'s answer outright (assert.equal / deepEqual / match, or pytest `==`); and',
    '(3) assert it is not the answer the drawn points give: assertNotDrawn(answer, drawnAnswer) from src/test/fullNotDrawn.ts (pytest: assert_not_drawn from conftest.py), with the code\'s answer first and drawnAnswer worked out in the test from the thinned data, never null or a constant. No other assertion (notEqual, a margin) counts.',
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

/** A test given as proof that code computes from the full data, not the drawn points. */
interface Proof { file: string; name: string }

/** The one way a proof says "not the drawn points' answer": this function, found by its declaration, not its name. */
const NOT_DRAWN = { file: 'src/test/fullNotDrawn.ts', name: 'assertNotDrawn' };
/** The node:assert calls that state an answer outright. */
const OUTRIGHT = new Set(['equal', 'deepEqual', 'strictEqual', 'deepStrictEqual', 'match']);

let proofs: ts.Program | undefined;
/** The typed program with every TS test a row gives as proof in it, so a name in a test is known by what it declares. */
function proofProgram(): ts.Program {
    if (!proofs) {
        const files = new Set(ROWS.flatMap(row => row.tests).filter(item => item.tells && item.file.endsWith('.ts') && existsSync(path.join(repoRoot, item.file))).map(item => item.file));
        proofs = typedWith(new Map([...files].map(file => [file, read(file)])));
    }
    return proofs;
}

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
 * 1. use the code under test: one of the targets, a function of a target's file that reaches one, or a helper of
 *    the test file that does;
 * 2. state that code's answer outright with node:assert (OUTRIGHT);
 * 3. call `assertNotDrawn(answer, drawnAnswer)` (src/test/fullNotDrawn.ts) with that code's answer first and, second,
 *    something worked out in the test: not a constant, a local holding one, or the first argument again.
 *
 * What this cannot see: whether `drawnAnswer` really is what the thinned points would give, and whether the answer
 * asserted is the value the row is about. Those are for the reviewer (docs/plot-contracts-guide.md).
 */
function proofProblem(targets: readonly string[], proof: Proof, program: ts.Program = proofProgram()): string | null {
    // A UI test drives the whole app: nothing ties what it reads off the page to this row's code, so it is support
    // (t(...)), never the proof. The proof is a unit test that calls the row's code with data whose drawn points differ.
    if (proof.file.startsWith('src/test/uiSmoke/')) return `"${proof.name}" is a UI test, which cannot show which code made the value it reads: mark it t(...) and give the row a unit test as its tt(...) proof`;
    if (proof.file.endsWith('.py')) return existsSync(path.join(repoRoot, proof.file)) ? pythonProofs([{ targets, proof }])[0] ?? null : `no file ${proof.file}`;
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

    // The code under test: the row's functions, and every function of their files that reaches one.
    const under = new Set<ts.Node>();
    for (const target of targets) {
        const at = target.lastIndexOf(':');
        const file = target.slice(0, at);
        const code = file.endsWith('.ts') ? program.getSourceFile(path.join(repoRoot, file)) : undefined;
        if (!code) continue;
        const reachers = reachersOf(file, target.slice(at + 1));
        each(code, node => {
            const name = functionName(node);
            // A function is declared by itself; an arrow, by the variable or property it is assigned to.
            if (name && reachers.has(name)) under.add(ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) ? node.parent : node);
        });
    }
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

    let outright = false, apart = false;
    each(body, node => {
        if (!ts.isCallExpression(node)) return;
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee) && OUTRIGHT.has(callee.name.text) && isAssert(callee.expression) && node.arguments.some(answer)) outright = true;
        if (!isNotDrawn(node)) return;
        const [mine, drawn] = node.arguments;
        if (mine && drawn && answer(mine) && !constant(drawn) && mine.getText() !== drawn.getText()) apart = true;
    });
    if (!outright) return `"${proof.name}" never asserts the answer of the row's code outright (assert.equal, deepEqual or match on what it returns)`;
    if (!apart) return `"${proof.name}" asserts no case where the full data and the drawn points give different answers`;
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

test('the proof check follows names to what they declare: only a use of the row\'s code, its answer asserted outright, and assertNotDrawn(answer, drawnAnswer) make a proof', () => {
    // Proofs written here for the injection, compiled over the real sources and never written to disk.
    const file = 'src/test/injectedWholeProof.test.ts';
    const range = 'src/webview/runtime/stagePanes.ts:stageRange';
    const full = "    const full = stageRange([line([-43, -12], { min: -61, max: -2 })]);";
    const outright = "    assert.deepEqual(full, stageRange([line([-61, -2])]));";
    const cases: Array<{ name: string; body: string[]; problem: RegExp | null }> = [
        // A drawn line whose extremes were thinned away: its full range asserted, and told from the drawn points'.
        { name: 'proven', body: [full, outright, "    assertNotDrawn(full, stageRange([line([-43, -12])]));"], problem: null },
        // The same under other names: the import renamed, the code reached through a namespace.
        { name: 'renamed', body: ["    const full = panes.stageRange([line([-43, -12], { min: -61, max: -2 })]);", "    assert.deepEqual(full, panes.stageRange([line([-61, -2])]));", "    apart(full, panes.stageRange([line([-43, -12])]));"], problem: null },
        // Full and drawn data that give one answer say nothing of which one the code takes.
        { name: 'no helper', body: [full, outright], problem: /asserts no case where the full data and the drawn points give different answers/u },
        // Another negative assertion is not the helper: one form, so a reader finds every proof the same way.
        { name: 'another assertion', body: [full, outright, "    assert.notDeepEqual(full, stageRange([line([-43, -12])]));"], problem: /asserts no case/u },
        // A function of the helper's spelling that is not the helper.
        { name: 'look-alike', body: ["    const assertNotDrawn = (..._: unknown[]): void => undefined;", full, outright, "    assertNotDrawn(full, stageRange([line([-43, -12])]));"], problem: /asserts no case/u },
        // Told apart from null, a constant, a local holding one, or itself is not told apart from the drawn points.
        { name: 'null', body: [full, outright, "    assertNotDrawn(full, null);"], problem: /asserts no case/u },
        { name: 'constant', body: [full, outright, "    assertNotDrawn(full, { min: 0, max: 0 });"], problem: /asserts no case/u },
        { name: 'local constant', body: [full, outright, "    const zero = { min: 0, max: 0 };", "    assertNotDrawn(full, zero);"], problem: /asserts no case/u },
        { name: 'itself', body: [full, outright, "    assertNotDrawn(full, full);"], problem: /asserts no case/u },
        // The answer never stated: only that it differs.
        { name: 'not outright', body: [full, "    assertNotDrawn(full, stageRange([line([-43, -12])]));"], problem: /never asserts the answer of the row's code outright/u },
        // A test that never uses the row's code proves nothing of it, whatever it asserts.
        { name: 'unreached', body: ["    const full = { min: -61, max: -2 }, drawn = [full].map(item => ({ ...item, min: -43 }))[0];", "    assert.deepEqual(full, { min: -61, max: -2 });", "    assertNotDrawn(full, drawn);"], problem: /never uses the row's code/u },
    ];
    const program = typedWith(new Map([[file, [
        "import assert from 'node:assert/strict';",
        "import test from 'node:test';",
        "import type { StageView } from '../shared/protocol/backendProtocol';",
        "import { stageRange } from '../webview/runtime/stagePanes';",
        "import * as panes from '../webview/runtime/stagePanes';",
        "import { assertNotDrawn, assertNotDrawn as apart } from './fullNotDrawn';",
        "const line = (values: number[], valueRange?: StageView['valueRange']): StageView => ({ frame: 'SpectralFrame', kind: 'line', xs: values.map((_, i) => i), values, ...(valueRange ? { valueRange } : {}) });",
        ...cases.flatMap(item => [`test('${item.name}', () => {`, ...item.body, '});']),
    ].join('\n')]]));
    for (const item of cases) {
        const problem = proofProblem([range], { file, name: item.name }, program);
        if (item.problem) assert.match(problem ?? 'no problem', item.problem, item.name);
        else assert.equal(problem, null, item.name);
    }
    // A row's failure says the rule and what to write.
    const row = tellsProblems([{ id: 'injected.range', chart: 'injected', value: 'range', what: 'x', computedIn: [range], from: 'full', trace: 'x', tests: [{ file, name: 'null', tells: true }] }], (targets, proof) => proofProblem(targets, proof, program));
    assert.match(row.join('\n'), /injected\.range: .* asserts no case where the full data and the drawn points give different answers\. Rule: .*assertNotDrawn\(answer, drawnAnswer\)/u);
    // A UI test is never the proof.
    assert.match(proofProblem([range], { file: 'src/test/uiSmoke/plotContract.spec.ts', name: 'any' }) ?? '', /is a UI test/u);
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
