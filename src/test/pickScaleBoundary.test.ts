/**
 * Display rules R14 and R2, by symbol and type (never by a name's spelling): scale for decisions is exact, and no y is
 * held for painting a line. A value axis's transform (stagePanes.ts `axisTransform`, carried by `StagePlot`) maps a
 * value to its exact y (`yOf`) and has its exact scale (`pixelsPerUnit`); every decision (the pointer's pick, the scale
 * sent to full_read.py, a hit test, the read mark) takes them. A line is painted by the same `yOf` and clipped where it
 * leaves the plot (plot/lineClip.ts, R2), so there is no held painting y (G2's `paintY`, held ten spans past the axis,
 * whose two y's differenced gave 1,050 px per unit where the axis has 50,000, is gone). The one held y is `yAt`, a
 * point's mark held inside the plot.
 *
 * The scan reads the product code with its types and fails:
 * - a value-to-pixel mapping (a member typed `(value: number) => number`) on `StagePlot` or `AxisTransform` that is
 *   not one of the known ones (`yAt`, `yOf`, `levelOf`, and the horizontal `xAt`, `xOf`): a new held y for painting,
 *   as `paintY` was, or any new mapping no rule covers;
 * - outside a painting function (a function, method or const-held function whose name starts with `paint` or
 *   `stroke`), a subtraction of two calls of a y mapping (`yAt`, `yOf` or `levelOf` of either type, or a local const
 *   made of one of them, as `const y = plot.yOf ?? plot.yAt`): a scale made by differencing two mapped values. A
 *   scale is `pixelsPerUnit`.
 * The second half proves the scan finds each way of breaking it.
 */
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = path.resolve(__dirname, '..', '..');
const PANES = 'src/webview/runtime/stagePanes.ts';
/** The types whose y mappings are judged, and those mappings. */
const OWNERS = new Set(['StagePlot', 'AxisTransform']);
const MAPPINGS = new Set(['yAt', 'yOf', 'levelOf']);
/** The horizontal axis's mappings: never held (xAt is exact), so their differences are exact scales. */
const X_MAPPINGS = new Set(['xAt', 'xOf']);
/** A painting function: it puts pixels on a canvas, where y's may be differenced to size what it draws (a bar's body). */
const PAINTING = /^(paint|stroke)/u;

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

/** The y-mapping members of StagePlot and AxisTransform (stagePanes.ts), by their declarations. */
function mappingDeclarations(whole: ts.Program): Map<ts.Declaration, string> {
    const found = new Map<ts.Declaration, string>();
    const source = whole.getSourceFile(path.join(repoRoot, PANES));
    assert.ok(source, `${PANES} is in the program`);
    for (const statement of source.statements) {
        if (!ts.isInterfaceDeclaration(statement) || !OWNERS.has(statement.name.text)) continue;
        for (const member of statement.members) {
            const name = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
            if (name && MAPPINGS.has(name)) found.set(member, `${statement.name.text}.${name}`);
        }
    }
    return found;
}

/** The member a symbol is (through Pick and other mapped types its declarations stay the member's), or undefined. */
function memberOf(symbol: ts.Symbol | undefined, members: Map<ts.Declaration, string>): string | undefined {
    for (const declaration of symbol?.declarations ?? []) {
        const name = members.get(declaration);
        if (name) return name;
    }
    return undefined;
}

/** The name of the nearest named function around `node`: a declared function or method, or a const or property holding one. */
function enclosingName(node: ts.Node): string {
    for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
        if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name && ts.isIdentifier(at.name)) return at.name.text;
        if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && (ts.isVariableDeclaration(at.parent) || ts.isPropertyAssignment(at.parent)) && ts.isIdentifier(at.parent.name)) return at.parent.name.text;
    }
    return '';
}

interface Problem { at: string; within: string; text: string }

function scan(whole: ts.Program): Problem[] {
    const checker = whole.getTypeChecker();
    const members = mappingDeclarations(whole);
    const problems: Problem[] = [];
    /** Which y mapping a callee is: a member read, or a local const made of member reads (`a ?? b`, `c ? a : b`). */
    const mappingOf = (callee: ts.Expression): string | undefined => {
        let node = callee;
        while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
        if (ts.isPropertyAccessExpression(node)) return memberOf(checker.getSymbolAtLocation(node.name), members);
        if (!ts.isIdentifier(node)) return undefined;
        const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
        if (declaration && ts.isBindingElement(declaration)) return memberOf(boundProperty(declaration), members);
        if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) return undefined;
        const made: string[] = [];
        const visit = (part: ts.Expression): void => {
            if (ts.isParenthesizedExpression(part) || ts.isNonNullExpression(part)) { visit(part.expression); return; }
            if (ts.isBinaryExpression(part)) { visit(part.left); visit(part.right); return; }
            if (ts.isConditionalExpression(part)) { visit(part.whenTrue); visit(part.whenFalse); return; }
            if (ts.isPropertyAccessExpression(part)) { const name = memberOf(checker.getSymbolAtLocation(part.name), members); if (name) made.push(name); }
        };
        visit(declaration.initializer);
        return made.length ? made.join(' ?? ') : undefined;
    };
    /** The property a destructured binding takes (`const { paintY } = plot`, `{ paintY: y }`). */
    const boundProperty = (element: ts.BindingElement): ts.Symbol | undefined => {
        const name = element.propertyName ?? element.name;
        if (!ts.isIdentifier(name)) return undefined;
        return checker.getTypeAtLocation(element.parent).getProperty(name.text);
    };
    const called = (node: ts.Expression): string | undefined => {
        let at = node;
        while (ts.isParenthesizedExpression(at)) at = at.expression;
        return ts.isCallExpression(at) ? mappingOf(at.expression) : undefined;
    };
    for (const source of whole.getSourceFiles()) {
        const file = relative(source);
        if (source.isDeclarationFile || !file.startsWith('src/') || file.startsWith('src/test/') || file.startsWith('src/e2e/')) continue;
        const walk = (node: ts.Node): void => {
            // A scale made by differencing two mapped y's.
            if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.MinusToken) {
                const left = called(node.left), right = called(node.right);
                const within = enclosingName(node);
                if (left && right && !PAINTING.test(within)) problems.push({ at: where(node), within, text: `${left}(…) − ${right}(…) differenced` });
            }
            ts.forEachChild(node, walk);
        };
        walk(source);
    }
    return problems;
}

/**
 * The value-to-pixel mappings of StagePlot and AxisTransform (members typed `(value: number) => number`, with what
 * any module augments them with) that no rule knows: neither a y mapping the difference scan covers nor the
 * horizontal axis's.
 */
function unknownMappings(whole: ts.Program): string[] {
    const checker = whole.getTypeChecker();
    const source = whole.getSourceFile(path.join(repoRoot, PANES));
    assert.ok(source, `${PANES} is in the program`);
    const numeric = (type: ts.Type): boolean => !!(checker.getNonNullableType(type).flags & ts.TypeFlags.NumberLike);
    const found: string[] = [];
    for (const statement of source.statements) {
        if (!ts.isInterfaceDeclaration(statement) || !OWNERS.has(statement.name.text)) continue;
        const owner = checker.getTypeAtLocation(statement.name);
        for (const property of owner.getProperties()) {
            const type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(property, statement));
            const mapping = type.getCallSignatures().some(signature => signature.parameters.length === 1
                && numeric(checker.getTypeOfSymbolAtLocation(signature.parameters[0], statement)) && numeric(signature.getReturnType()));
            if (mapping && !MAPPINGS.has(property.name) && !X_MAPPINGS.has(property.name)) found.push(`${statement.name.text}.${property.name}`);
        }
    }
    return found.sort();
}

const FIX = 'R14 and R2 (docs/display-rules.md): scale for decisions is exact, and no y is held for painting a line. '
    + 'For the pick, a hit test, the read mark, the scale sent to full_read.py and the box zoom use the axis\'s exact '
    + 'members (StagePlot / AxisTransform yOf and pixelsPerUnit, made from the range and the box alone in stagePanes.ts '
    + 'axisTransform); never difference two mapped y\'s to get a scale. Paint a line by the exact yOf and clip it '
    + '(plot/lineClip.ts clippedPath); do not add a y held for painting. A new mapping that is no held y goes in '
    + 'MAPPINGS (a y) or X_MAPPINGS (the horizontal axis) here, with its rule in docs/display-rules.md.';

test('the value axis maps a value to a y only exactly (yOf) or to a point\'s mark (yAt), with no y held for painting a line, and outside the painting functions nothing differences two mapped y\'s to get a scale (R2, R14)', () => {
    const whole = program();
    assert.deepEqual(unknownMappings(whole), [], FIX);
    const problems = scan(whole);
    assert.deepEqual(problems.map(problem => `${problem.at} in ${problem.within || '(top level)'}: ${problem.text}`), [], FIX);
});

test('the pick scale scan finds a held painting y added to StagePlot or AxisTransform and a scale made by differencing mapped y\'s (direct, through a local, through a ?? alias) (R2, R14)', () => {
    const file = 'src/webview/runtime/pickScaleViolation.ts';
    const head = `import type { AxisTransform, StagePlot } from './stagePanes';\n`;
    // A y held ten spans past the axis for painting, as paintY was, added to each type by augmentation.
    const held = `declare module './stagePanes' { interface StagePlot { paintY?: (value: number) => number } interface AxisTransform { heldY(value: number): number } }\n`;
    const cases: Array<[string, string]> = [
        ['directScale', `export function directScale(plot: StagePlot, v: number): number { return Math.abs(plot.yOf(v + 1) - plot.yOf(v)); }`],
        ['localScale', `export function localScale(axis: AxisTransform, v: number): number { const y = axis.yAt; return y(v + 1) - y(v); }`],
        ['aliasScale', `export function aliasScale(plot: StagePlot, v: number): number { const y = plot.yAt; const z = plot.levelOf ?? plot.yOf; return (y(v) - y(0)) + (z(v) - z(0)); }`],
    ];
    const honest = [
        `export function honestScale(plot: StagePlot): number { return plot.pixelsPerUnit; }`,
        `export function paintHonest(plot: StagePlot, v: number): number { const y = plot.yOf; return y(v + 1) - y(v); }`,
    ];
    const whole = program(new Map([[file, head + held + [...cases.map(([, body]) => body), ...honest].join('\n')]]));
    assert.deepEqual(unknownMappings(whole), ['AxisTransform.heldY', 'StagePlot.paintY'], 'R2 scan: a y held for painting added to StagePlot or AxisTransform is found');
    const found = scan(whole).filter(problem => problem.at.startsWith(file));
    for (const [name] of cases) assert.ok(found.some(problem => problem.within === name), `R14 scan: ${name} goes unnoticed (${JSON.stringify(found)})`);
    assert.deepEqual(found.filter(problem => problem.within === 'honestScale' || problem.within === 'paintHonest'), [], 'the exact scale, and sizing a painting by y\'s, pass');
});
