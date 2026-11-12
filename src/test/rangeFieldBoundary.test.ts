/**
 * Display rule R9, by symbol and type (never by a name's spelling): a range box writes its ends with exactFieldText
 * (the shortest text that parses back to the end painted), and the numbers it writes are never rounded on their way
 * there. Where the exact text would be long because the range itself is an artefact (a float step of a zoom, a norm
 * times a peak, an automatic range), the range is made at the field's numbers where it is made (figureModel:
 * fieldWindow, windowEnds, laneAmplitudeRange, colourScale), never the text.
 *
 * The scan starts at every place that fills a range popover's fields: each call of `RangePopover.open`
 * (src/webview/rangePopover.ts), its request's `min` and `max` (and a spread that gives them), and each call of
 * `openAxisPart` with the `shown` ends it writes. From there it follows what those values are made of: a local or
 * module const to its initializer, a call to what the function it names returns (an object's one property when only
 * that is read), and every argument passed. Anything it reaches that rounds a number (`toFixed`, `toPrecision`,
 * `toExponential`, `Math.round` / `floor` / `ceil` / `trunc`) outside figureModel.ts (where ranges are made) is a
 * failure, and so is a field written without exactFieldText at all. exactFieldText itself (plotText.ts) writes
 * without rounding; any other function of plotText.ts is followed like any other (one that writes "to a thousandth
 * of the span" rounds). The second half proves the scan finds each way of breaking it.
 */
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = path.resolve(__dirname, '..', '..');
const POPOVER = 'src/webview/rangePopover.ts';
const TEXT = 'src/webview/plot/plotText.ts';
/** The module that may round a range's ends: figureModel makes the ranges at the field's numbers (fieldWindow and the rest). */
const ROUNDING_MODULES: ReadonlySet<string> = new Set(['src/webview/runtime/figureModel.ts']);
/** Whether `symbol` is exactFieldText, the one way a range box writes an end: the shortest text that parses back to it. */
const isExactFieldText = (symbol: ts.Symbol | undefined): boolean => symbol?.name === 'exactFieldText' && declaredIn(symbol, TEXT);
const ROUNDING_METHODS = new Set(['toFixed', 'toPrecision', 'toExponential']);
const ROUNDING_MATH = new Set(['round', 'floor', 'ceil', 'trunc']);

function productSources(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(path.join(repoRoot, dir)).sort()) {
            const rel = `${dir}/${name}`;
            if (rel === 'src/test' || rel === 'src/e2e') continue;
            if (statSync(path.join(repoRoot, rel)).isDirectory()) walk(rel);
            else if (rel.endsWith('.ts') && !rel.endsWith('.d.ts')) found.push(rel);
        }
    };
    walk('src');
    return found;
}

let base: ts.Program | undefined;
/** The product code with its types; `overlay` (repo-relative path → source) adds files, for the violations below. */
function program(overlay: ReadonlyMap<string, string> = new Map()): ts.Program {
    const config = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
    const options: ts.CompilerOptions = { ...config?.options, noEmit: true };
    base ??= ts.createProgram(productSources().map(file => path.join(repoRoot, file)), options);
    if (!overlay.size) return base;
    const whole = base;
    const host = ts.createCompilerHost(options, true);
    const added = new Map([...overlay].map(([file, text]) => [path.join(repoRoot, file), text]));
    const own = host.getSourceFile.bind(host), exists = host.fileExists.bind(host), reads = host.readFile.bind(host);
    host.getSourceFile = (fileName, version, onError, create) => {
        const text = added.get(path.resolve(fileName));
        return text !== undefined ? ts.createSourceFile(fileName, text, version, true) : whole.getSourceFile(fileName) ?? own(fileName, version, onError, create);
    };
    host.fileExists = fileName => added.has(path.resolve(fileName)) || exists(fileName);
    host.readFile = fileName => added.get(path.resolve(fileName)) ?? reads(fileName);
    return ts.createProgram([...whole.getRootFileNames(), ...added.keys()], options, host);
}

const relative = (node: ts.Node): string => path.relative(repoRoot, node.getSourceFile().fileName).split(path.sep).join('/');
const where = (node: ts.Node): string => `${relative(node)}:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
const aliased = (symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined => (symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
const declaredIn = (symbol: ts.Symbol | undefined, file: string): boolean => !!symbol?.declarations?.some(item => relative(item) === file);
const propertyName = (name: ts.PropertyName | undefined): string | undefined => (name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined);

/** A function-like a call reaches through its callee: a function, a method, or a const holding an arrow or function. */
function calledFunction(call: ts.CallExpression, checker: ts.TypeChecker): ts.SignatureDeclaration | undefined {
    const symbol = aliased(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression), checker);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (!declaration) return undefined;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) return declaration.initializer;
    if (ts.isPropertyAssignment(declaration) && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) return declaration.initializer;
    return ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration) ? declaration : undefined;
}

/** What a function answers: its expression body, or each `return` in its block (not in a function inside it). */
function returnsOf(fn: ts.SignatureDeclaration): ts.Expression[] {
    const body = (fn as ts.FunctionLikeDeclaration).body;
    if (!body) return [];
    if (!ts.isBlock(body)) return [body];
    const found: ts.Expression[] = [];
    const walk = (node: ts.Node): void => {
        if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression) found.push(node.expression);
        ts.forEachChild(node, walk);
    };
    ts.forEachChild(body, walk);
    return found;
}

interface Problem { at: string; field: string; text: string }

/**
 * Follows what `start` is made of (see the header) and returns what rounds it, and whether exactFieldText wrote it.
 * `wanted`: the one property of an object read (a field `min`, `shown.max`), so an object's other parts are not judged.
 */
function trace(start: ts.Expression, wanted: string | undefined, checker: ts.TypeChecker): { rounded: string[]; exact: boolean } {
    const rounded: string[] = [];
    let exact = false;
    const seen = new Set<string>();
    const visit = (node: ts.Expression, prop: string | undefined): void => {
        const key = `${node.getSourceFile().fileName}:${node.pos}:${prop ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (ROUNDING_MODULES.has(relative(node))) return;
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) { visit(node.expression, prop); return; }
        if (ts.isConditionalExpression(node)) { visit(node.whenTrue, prop); visit(node.whenFalse, prop); return; }
        if (ts.isBinaryExpression(node)) { visit(node.left, prop); visit(node.right, prop); return; }
        if (ts.isPrefixUnaryExpression(node)) { visit(node.operand, prop); return; }
        if (ts.isTemplateExpression(node)) { node.templateSpans.forEach(span => visit(span.expression, undefined)); return; }
        if (ts.isObjectLiteralExpression(node)) {
            for (const property of node.properties) {
                if (ts.isSpreadAssignment(property)) { visit(property.expression, prop); continue; }
                if (prop !== undefined && propertyName(property.name) !== prop) continue;
                if (ts.isPropertyAssignment(property)) visit(property.initializer, undefined);
                else if (ts.isShorthandPropertyAssignment(property)) visit(property.name, undefined);
            }
            return;
        }
        if (ts.isArrayLiteralExpression(node)) { node.elements.forEach(element => visit(element, undefined)); return; }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const name = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
            visit(node.expression, name);
            return;
        }
        if (ts.isIdentifier(node)) {
            const declaration = aliased(checker.getSymbolAtLocation(node), checker)?.valueDeclaration;
            if (!declaration || ROUNDING_MODULES.has(relative(declaration)) || declaration.getSourceFile().isDeclarationFile) return;
            if (ts.isVariableDeclaration(declaration) && declaration.initializer) visit(declaration.initializer, prop);
            else if (ts.isBindingElement(declaration)) {
                // `const { min } = ends`: the property `min` of what it destructures.
                const holder = declaration.parent.parent;
                const named = propertyName(declaration.propertyName) ?? (ts.isIdentifier(declaration.name) ? declaration.name.text : undefined);
                if (ts.isVariableDeclaration(holder) && holder.initializer) visit(holder.initializer, named);
            }
            return;
        }
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (ts.isPropertyAccessExpression(callee) && ROUNDING_METHODS.has(callee.name.text)) rounded.push(`${callee.name.text} at ${where(node)}`);
            if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Math' && ROUNDING_MATH.has(callee.name.text)
                && aliased(checker.getSymbolAtLocation(callee.expression), checker)?.declarations?.some(item => item.getSourceFile().isDeclarationFile)) {
                rounded.push(`Math.${callee.name.text} at ${where(node)}`);
            }
            const symbol = aliased(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(callee) ? callee.name : callee), checker);
            if (isExactFieldText(symbol)) exact = true;
            // What is passed in can come out (Number(x.toFixed(2)), exactFieldText(end)).
            node.arguments.forEach(argument => visit(argument, undefined));
            if (ts.isPropertyAccessExpression(callee)) visit(callee.expression, undefined);
            const fn = calledFunction(node, checker);
            if (fn && !isExactFieldText(symbol) && !ROUNDING_MODULES.has(relative(fn)) && !fn.getSourceFile().isDeclarationFile) returnsOf(fn).forEach(answer => visit(answer, prop));
        }
    };
    visit(start, wanted);
    return { rounded, exact };
}

/** Every range popover's fields in `scanned`, and what is wrong with each (R9). */
function scan(scanned: ts.Program): { problems: Problem[]; fields: number } {
    const checker = scanned.getTypeChecker();
    const problems: Problem[] = [];
    let fields = 0;
    const judge = (expression: ts.Expression, wanted: string | undefined, field: string, needsExact: boolean): void => {
        fields++;
        const { rounded, exact } = trace(expression, wanted, checker);
        for (const text of rounded) problems.push({ at: where(expression), field, text: `rounds it: ${text}` });
        if (needsExact && !exact) problems.push({ at: where(expression), field, text: 'is not written by exactFieldText' });
    };
    for (const source of scanned.getSourceFiles()) {
        if (source.isDeclarationFile || !relative(source).startsWith('src/') || relative(source).startsWith('src/test/')) continue;
        const walk = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'open') {
                const open = aliased(checker.getSymbolAtLocation(node.expression.name), checker);
                const request = node.arguments[0];
                // RangePopover.open: its request's min and max are what the fields show.
                if (open?.declarations?.some(item => relative(item) === POPOVER && ts.isMethodSignature(item) && ts.isInterfaceDeclaration(item.parent) && item.parent.name.text === 'RangePopover') && request) {
                    if (ts.isObjectLiteralExpression(request)) {
                        for (const end of ['min', 'max']) {
                            const property = request.properties.find(item => !ts.isSpreadAssignment(item) && propertyName(item.name) === end);
                            if (property && ts.isPropertyAssignment(property)) judge(property.initializer, undefined, end, true);
                            else if (property && ts.isShorthandPropertyAssignment(property)) judge(property.name, undefined, end, true);
                            else request.properties.filter(ts.isSpreadAssignment).forEach(spread => judge(spread.expression, end, end, true));
                        }
                    } else {
                        for (const end of ['min', 'max']) judge(request, end, end, true);
                    }
                }
            }
            if (ts.isCallExpression(node)) {
                const symbol = aliased(checker.getSymbolAtLocation(node.expression), checker);
                const axis = node.arguments[0] && node.arguments[1];
                // openAxisPart writes its `shown` ends: what they are made of is judged too.
                if (symbol?.name === 'openAxisPart' && declaredIn(symbol, POPOVER) && axis && ts.isObjectLiteralExpression(axis)) {
                    const shown = axis.properties.find(item => !ts.isSpreadAssignment(item) && propertyName(item.name) === 'shown');
                    if (shown && ts.isPropertyAssignment(shown)) { judge(shown.initializer, 'min', 'shown.min', false); judge(shown.initializer, 'max', 'shown.max', false); }
                    else if (shown && ts.isShorthandPropertyAssignment(shown)) { judge(shown.name, 'min', 'shown.min', false); judge(shown.name, 'max', 'shown.max', false); }
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(source);
    }
    return { problems, fields };
}

const FIX = 'R9 (docs/display-rules.md): a range box writes the very ends the axis is painted with. Write each end with exactFieldText '
    + '(src/webview/plot/plotText.ts), never rounded; if the exact text is long because the range is an artefact (a zoom\'s float step, '
    + 'a norm times a peak, an automatic range), make the range at the field\'s numbers where it is made, in src/webview/runtime/figureModel.ts '
    + '(fieldWindow, windowEnds, laneAmplitudeRange, colourScale), and paint from it.';

test('every range box writes the ends it is painted with by exactFieldText, and nothing on their way there rounds them outside figureModel (R9)', () => {
    const { problems, fields } = scan(program());
    assert.deepEqual(problems.map(problem => `${problem.at} ${problem.field} ${problem.text}`), [], FIX);
    // The popovers of the lanes, the cursor spectrum, the pair view, the steps mode, the entry's plots and its distribution.
    assert.ok(fields >= 26, `the scan reaches the range popovers (${fields} fields)`);
});

test('the range field scan finds a rounded end: in the field, in a helper, through a local, a destructured const, a spread, another plotText writer, and in openAxisPart\'s shown ends (R9)', () => {
    const file = 'src/webview/rangeFieldViolation.ts';
    const head = `import type { RangePopover } from './rangePopover';\nimport { linearAxis, openAxisPart } from './rangePopover';\nimport { exactFieldText } from './plot/plotText';\n`;
    const request = (min: string, max: string) => `{ axisLabel: '', horizontal: false, min: ${min}, max: ${max}, clientX: 0, clientY: 0, apply() { /* none */ }, auto() { /* none */ } }`;
    const cases: Array<[string, string]> = [
        ['in the field', `export function f(p: RangePopover, v: number): void { p.open(${request('String(v.toPrecision(4))', 'String(Math.round(v))')}); }`],
        ['in a helper', `const field = (v: number): string => String(Number(v.toFixed(2)));\nexport function f(p: RangePopover, v: number): void { p.open(${request('field(v)', 'field(v)')}); }`],
        ['through a local', `export function f(p: RangePopover, v: number): void { const end = Math.round(v); p.open(${request('exactFieldText(end)', 'exactFieldText(end)')}); }`],
        ['through a destructured const', `function ends(v: number) { return { min: Number(v.toPrecision(3)), max: v }; }\nexport function f(p: RangePopover, v: number): void { const { min, max } = ends(v); p.open(${request('exactFieldText(min)', 'exactFieldText(max * 2)')}); }`],
        ['in a spread', `class View { fields(v: number) { return { min: v.toFixed(1), max: v.toFixed(1) }; } }\nexport function f(p: RangePopover, v: number): void { p.open({ axisLabel: '', horizontal: false, ...new View().fields(v), clientX: 0, clientY: 0, apply() { /* none */ }, auto() { /* none */ } }); }`],
        ['by another of plotText\'s writers', `import { stepText } from './plot/plotText';\nexport function f(p: RangePopover, v: number): void { p.open(${request('stepText(v, 0.1)', 'exactFieldText(v)')}); }`],
        ['without exactFieldText', `export function f(p: RangePopover, v: number): void { p.open(${request('String(v)', 'String(v)')}); }`],
        ['in openAxisPart\'s shown ends', `export function f(p: RangePopover, v: number): void { openAxisPart(p, { mapping: linearAxis(0, 1, ''), horizontal: true, current: { start: 0, end: 1 }, clientX: 0, clientY: 0, invalid: '', set() { /* none */ }, shown: { min: Math.floor(v), max: v } }); }`],
    ];
    for (const [name, body] of cases) {
        const found = scan(program(new Map([[file, head + body]]))).problems.filter(problem => problem.at.startsWith(file));
        assert.ok(found.length > 0, `R9 scan: a rounded range field ${name} goes unnoticed`);
    }
    // The honest form passes: the ends written exactly, a range made by figureModel.
    const honest = `import { fieldWindow } from './runtime/figureModel';\nexport function f(p: RangePopover, v: number): void { const ends = fieldWindow(v, v + 1); p.open(${request('exactFieldText(ends.min)', 'exactFieldText(ends.max)')}); }`;
    assert.deepEqual(scan(program(new Map([[file, head + honest]]))).problems.filter(problem => problem.at.startsWith(file)), []);
});
