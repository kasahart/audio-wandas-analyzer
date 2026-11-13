import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { namedTest, testProblem } from './namedTest';
import { CHARTS, CONTRACTS, GAP_CEILING, KNOWN_GAPS, ROWS } from './plotContracts/index';
import { CLICK_READ, CLICK_TEST, type ContractRow } from './plotContracts/model';
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
 *
 * What this is for, and what it is not: it keeps the table's list of number-writing functions complete for these
 * direct forms, so a reviewer knows where to look. It does not follow text kept in a property or a field and
 * written later (`row.label = n.toFixed(1)` … `el.textContent = row.label`), nor a number that leaves through
 * `any`. It is not what keeps a chart's value from being a thinned point: that is the types (a readout, a headline
 * and an export take `Whole`; a thinned point is `Drawn` and cannot be formatted; provenanceBoundary.test.ts).
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
 * a template). A function that makes a surface and is not listed fails, so a new chart drawn its own way is found.
 *
 * This scan is a ledger of where surfaces are made. It is NOT the guarantee that every chart is drawn by the plot
 * component, and it does not look inside a function that is already listed: a registered painter that also draws
 * on its canvas by hand passes here. The guarantee is the audit every UI test runs in a real browser
 * (src/test/uiSmoke/canvasAudit.ts): a canvas on screen that the component did not mark, and any 2D drawing call
 * made into a plot's canvas while the component is not painting, fail the test. See "Adding a canvas or an SVG" in
 * docs/plot-contracts-guide.md for what the audit sees and what it cannot.
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

/**
 * Every plot's click (the `tap` handed to attachPlotInteraction), as `file:function`: the function that makes the click,
 * the tap itself or the function of its file it hands the click to, and whether that function acts through
 * clickOnRead (the readout's read, R7, R13).
 */
function plotClicks(sources: ReadonlyArray<{ file: string; source: ts.SourceFile }> = sourceFiles().filter(file => read(file).includes('attachPlotInteraction(')).map(file => ({ file, source: parse(file) }))): Map<string, boolean> {
    const clicks = new Map<string, boolean>();
    for (const { file, source } of sources) {
        // The file's own functions by name (a declaration, or an arrow given to a const), never a property of an object.
        const named = new Map<string, ts.Node>();
        each(source, node => {
            const name = ts.isFunctionDeclaration(node) && node.name ? node.name.text
                : (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : null;
            if (name && !named.has(name)) named.set(name, node);
        });
        const acts = (node: ts.Node | undefined): boolean => !!node && /\bclickOnRead\(/u.test(node.getText(source));
        each(source, node => {
            if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'attachPlotInteraction') return;
            const deps = node.arguments[3];
            if (!deps || !ts.isObjectLiteralExpression(deps)) return;
            for (const property of deps.properties) {
                if (!property.name || property.name.getText(source) !== 'tap') continue;
                // The tap: a function of the file it names, or written here (a method, an arrow).
                const own = ts.isShorthandPropertyAssignment(property) ? named.get('tap')
                    : ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer) ? named.get(property.initializer.text) : property;
                const ownName = ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer) ? property.initializer.text : 'tap';
                if (acts(own)) { clicks.set(`${file}:${ownName}`, true); continue; }
                // A tap that hands the click to a function of its file (the lanes' endLaneDrag).
                let handed: string | null = null;
                if (own) each(own, inner => { if (!handed && ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && acts(named.get(inner.expression.text))) handed = inner.expression.text; });
                clicks.set(`${file}:${handed ?? ownName}`, !!handed);
            }
        });
    }
    return clicks;
}

test('every plot\'s click is a click row of the table and acts on the point its readout reads, through clickOnRead, never a hit test of its own (R7, R13)', () => {
    const clicks = plotClicks();
    assert.ok(clicks.size >= 4, `the scan finds the plots' clicks (${[...clicks.keys()].join(', ')})`);
    const own = [...clicks].filter(([, through]) => !through).map(([at]) => at);
    assert.deepEqual(own, [], 'Rule (docs/display-rules.md R7, R13: "a click acts on the point the readout reads"): every plot\'s click acts on what its readout read at the press, the same pick and the same identity. These taps do not act through clickOnRead (plotHoverLayer.ts), so they decide by a hit test of their own. Fix: return clickOnRead(marks, plot, current, got => ...) from the tap, acting on got.read (or, where the readout reads no point, on what its words say there), and delete the tap\'s own geometry.');
    const rows = ROWS.filter(row => row.value === 'click');
    const listed = new Set(rows.flatMap(row => row.computedIn));
    assert.deepEqual([...clicks.keys()].filter(at => !listed.has(at)).sort(), [], 'Rule (R7, R13): every plot with a click has a click row in the contract table, which the browser test (CLICK_TEST in src/test/plotContracts/model.ts) clicks at ties, overlapping points, bin edges and gaps. These clicks have none. Fix: add a row of value \'click\' to the chart\'s file in src/test/plotContracts/charts (computedIn: ...CLICK_READ and this function), add \'click\' to its requires, and give it a case in plotContract.spec.ts CLICK_CASES.');
    for (const row of rows) {
        assert.ok(CLICK_READ.every(at => row.computedIn.includes(at)), `${row.id}: a click row names the readout's read it acts on (CLICK_READ)`);
        assert.ok(row.tests.some(item => item.file === 'src/test/uiSmoke/plotContract.spec.ts' && item.name === CLICK_TEST), `${row.id}: a click row is held by the browser test of every plot's click (CLICK_TEST)`);
    }
});

test('the click scan finds a plot\'s own hit test: a tap that does not act through clickOnRead', () => {
    const text = [
        'function handOn(current) { return clickOnRead(marks, plot, current, got => act(got.read)); }',
        'attachPlotInteraction(a, document, ".a", { tap: (plot, event, current) => handOn(current) });',
        // The old distribution's click: the first dot within 5 px of the pointer, a hit test of its own.
        'const tap = (plot, event) => { const dot = dotAt(plot, event.clientX, event.clientY); return dot ? () => go(dot) : undefined; };',
        'attachPlotInteraction(b, document, ".b", { tap });',
    ].join('\n');
    const clicks = plotClicks([{ file: 'fixture.ts', source: ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true) }]);
    assert.deepEqual([...clicks].sort(), [['fixture.ts:handOn', true], ['fixture.ts:tap', false]]);
});

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
        if (typeof whose === 'string') assert.ok(whose.trim().length > 0, `${where}: says no why. Rule: a surface that is no chart's says in one sentence why it draws no data. Fix: write that sentence as its entry in src/test/plotContracts/surfaces.ts.`);
        else assert.deepEqual(whose.charts.filter(chart => !charts.has(chart)), [], `${where}: names charts that do not exist. Rule: a surface that holds a chart's canvas names that chart by its id. Fix: use an id from src/test/plotContracts/charts (the chart's \`id\`), or remove the ones that were renamed or deleted.`);
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
            assert.ok(existsSync(path.join(repoRoot, named.file)), `${row.id}: names a test in ${named.file}, which does not exist. Rule: every test a row of the contract table names is a test that runs. Fix: give the file's path from the repository root as it is now in that row's tests (src/test/plotContracts/charts/${row.chart}.ts).`);
            const problem = testProblem(named.file, read(named.file), named.name);
            assert.equal(problem, null, `${row.id}: ${problem}. Rule: every test a row names runs and asserts something. Fix: name it by its title as written in ${named.file} (src/test/plotContracts/charts/${row.chart}.ts), or make the test assert.`);
        }
    }
});

test('every function the table names exists, as a function of its file or a def of its Python module', () => {
    const named = [...ROWS.flatMap(row => row.computedIn), ...VALUE_HELPERS, ...Object.keys(NOT_CHART_VALUES)];
    assert.deepEqual([...new Set(named)].filter(entry => !exists(entry)).sort(), [], 'Rule: every function the contract table names (a row\'s computedIn in src/test/plotContracts/charts, VALUE_HELPERS or NOT_CHART_VALUES in src/test/plotContracts/values.ts) is a function of that file today, or a def of that Python module. These are not. Fix: if the function was renamed or moved, write its new `file:function` (`python-backend/module.py:def` for Python) where it is listed; if it is gone, remove the entry (and, for a row, name the function that computes the value now).');
});

test('every function that writes a number in the webview is in the table, a value helper, or not a chart\'s value with why', () => {
    const writers = numberWriters();
    const listed = new Set([...ROWS.flatMap(row => row.computedIn), ...VALUE_HELPERS, ...Object.keys(NOT_CHART_VALUES)]);
    const unlisted = [...writers].filter(([writer]) => !listed.has(writer)).map(([writer, calls]) => `${writer} (${[...calls].sort().join(', ')})`).sort();
    assert.deepEqual(unlisted, [], 'Rule: every function that writes a number a user can read belongs to the contract table. These write one (the parentheses say how and where) and nothing lists them. Fix, one of: (1) it is a value of a chart: add the function to computedIn of its row in src/test/plotContracts/charts/<chart>.ts (or add a row); (2) it only formats or computes for others: add it to VALUE_HELPERS in src/test/plotContracts/values.ts; (3) it is not a chart\'s value (a setting\'s field, a test attribute, a CSS size): add it to NOT_CHART_VALUES there with one sentence saying why. See docs/plot-contracts-guide.md.');
    // A function that no longer writes a number is no longer not a chart's value.
    assert.deepEqual(Object.keys(NOT_CHART_VALUES).filter(entry => !writers.has(entry)).sort(), [], 'Rule: NOT_CHART_VALUES lists only functions that write a number today. Fix: remove these lines from src/test/plotContracts/values.ts.');
    for (const [entry, why] of Object.entries(NOT_CHART_VALUES)) assert.ok(why.trim().length > 0, `${entry}: says no why. Rule: a number writer that is no chart's value says why in one sentence. Fix: write it as its entry in NOT_CHART_VALUES (src/test/plotContracts/values.ts).`);
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
    '(3) assert it is not the answer the drawn points give: assertNotDrawn(answer, drawnAnswer) from src/test/fullNotDrawn.ts (pytest: assert_not_drawn from conftest.py), with the code\'s answer first and drawnAnswer worked out in the test from the thinned data, never null or a constant. No other assertion (notEqual, a margin) counts. (2) and (3) are of the same value: write the same expression in both.',
    'If this test cannot do that, mark it t(...) instead and give the row another tt(...) test that does. See docs/plot-contracts-guide.md.',
].join(' ');

test('every test a row says tells full data from drawn points proves it: it reaches the row\'s code and asserts its answer is not the drawn points\' answer', () => {
    assert.deepEqual(tellsProblems(), []);
});

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
function callersOf(program: ts.Program): Map<ts.Node, Set<ts.Node>> {
    let graph = callerGraphs.get(program);
    if (graph) return graph;
    const checker = program.getTypeChecker();
    const found = new Map<ts.Node, Set<ts.Node>>();
    for (const file of sourceFiles()) {
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
function proofProblem(targets: readonly string[], proof: Proof, program: ts.Program = proofProgram()): string | null {
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
    const callers = callersOf(program);
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
function pythonProof(targets: readonly string[], proof: Proof): string | null {
    const key = (item: { targets: readonly string[]; proof: Proof }): string => JSON.stringify([item.targets, item.proof.file, item.proof.name]);
    const ask = (items: ReadonlyArray<{ targets: readonly string[]; proof: Proof }>): Array<string | null> => {
        const venv = path.join(repoRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        const python = existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';
        const input = JSON.stringify(items.map(item => ({ targets: item.targets, file: item.proof.file, name: item.proof.name })));
        const run = spawnSync(python, ['scripts/check_test_proofs.py'], { cwd: repoRoot, encoding: 'utf8', input });
        assert.equal(run.status, 0, `check_test_proofs.py: ${run.stderr}`);
        return JSON.parse(run.stdout) as Array<string | null>;
    };
    if (!pythonAnswers) {
        const items = ROWS.flatMap(row => row.tests.filter(item => item.tells && item.file.endsWith('.py')).map(item => ({ targets: row.computedIn, proof: { file: item.file, name: item.name } })));
        const answers = ask(items);
        pythonAnswers = new Map(items.map((item, index) => [key(item), answers[index]]));
    }
    const asked = { targets, proof };
    if (!pythonAnswers.has(key(asked))) pythonAnswers.set(key(asked), ask([asked])[0]);
    return pythonAnswers.get(key(asked)) ?? null;
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
        // One answer stated outright and another told apart: the two halves must be of the same value.
        { name: 'two values', body: [full, outright, "    assertNotDrawn(stageRange([line([-43, -12], { min: -60, max: -2 })]).max, stageRange([line([-43, -12])]).max);"], problem: /states one value outright .* and tells another apart/u },
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
    assert.deepEqual(gaps, { ...KNOWN_GAPS }, 'Rule: the rows marked as gaps (a row\'s `gap` in src/test/plotContracts/charts) are exactly KNOWN_GAPS, each at its severity. Fix: a row whose gap you closed: take its `gap` off and its line out of KNOWN_GAPS. A new gap is not allowed (GAP_CEILING): make the row\'s value come from the full data and name the test that tells it from the drawn points instead.');
    for (const row of ROWS) {
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
