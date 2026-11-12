/**
 * What the compiler cannot say of `Whole` and `Drawn` (src/shared/provenance.ts), said here by symbol and type, never
 * by a name's spelling:
 *
 * 1. Only the mint modules (MINT_MODULES) refer to wholeMint.ts, each claims its mint into a const of its own, and
 *    that mint never leaves the module: it is not exported, passed on or stored, only called. (A second claim of a
 *    holder also throws at run time, wholeMint.ts.) Product code uses nothing under src/test, where the tests'
 *    own way of making a `Whole` lives.
 * 2. No code casts a value to a type that holds `Whole` (`3 as Whole`, `as unknown as FullPoints`), and none
 *    declares a type predicate that would (`value is Whole`). The entries that hold a line or cells whole
 *    (fullRead.ts localLine, localCells) take `Whole` values, so an array reaches them only from a mint module: a
 *    backend field the protocol marks `x-whole` (wholeAnswers.ts), or a number computed of such values
 *    (computedWhole). The one entry that takes plain numbers, `layoutLine` (numbers a figure is laid out with, not
 *    measurements), is used only by the layout modules (LAYOUT_MODULES).
 *    A full-data source (FullSource) is made only by fullRead.ts: one written by hand or by spreading another does
 *    not compile, so the only source that reads nothing is the named `NO_FULL_DATA`.
 * 3. Only the drawing modules (DRAWING_MODULES) refer to drawnPoints.ts, where a `Drawn` becomes a number.
 * 4. No code turns a `Drawn` into a number or text another way: a cast that drops it, a predicate that narrows it,
 *    `typeof`, unary `+`, `'' + value`, a template, or passing it where a parameter is `any` (`Number(value)`).
 *
 * With these, the compiler's own rules (a plain number is not a `Whole`; a `Drawn` is not a number) mean a number a
 * readout, a headline or an export takes came through a mint module, and a point thinned to be drawn reaches only
 * the canvas. The second half of this file proves the routes are closed: each deliberate violation is compiled or
 * scanned and must fail. See docs/plot-contracts-guide.md for what to do when a check here fails, and for what
 * these checks cannot guarantee.
 */
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = path.resolve(__dirname, '..', '..');
const PROVENANCE = 'src/shared/provenance.ts';
const MINTS = 'src/shared/wholeMint.ts';
const UNWRAPS = 'src/shared/drawnPoints.ts';

/**
 * The modules that may call a mint. Adding one widens what every readout trusts: do it only for a module whose
 * whole job is reading full data, and say in its header which data and why it is full.
 */
const MINT_MODULES: ReadonlySet<string> = new Set([
    // A full read's points (the backend's answer to full_read.py) and arrays a caller holds every value of.
    'src/webview/runtime/fullRead.ts',
    // The backend's numbers that the protocol says are taken of every value (a Δ's peak, a range, an order's power).
    'src/webview/runtime/wholeAnswers.ts',
]);

/**
 * The modules that may turn a `Drawn` into a number (drawnPoints.ts): each only to put it on a canvas, or for the
 * reason it gives. A number unwrapped here is a plain number: it still cannot reach a readout, which takes `Whole`.
 * Adding a module widens where thinned points can be computed with: add one only for code that draws.
 */
const DRAWING_MODULES: ReadonlyMap<string, string> = new Map([
    ['src/webview/runtime/stagePanes.ts', 'the plot component: draws every picture\'s lines, bars and cells'],
    ['src/webview/plot/waveformLayer.ts', 'draws a signal\'s envelope'],
    ['src/webview/runtime/trackCanvasPainter.ts', 'places a lane\'s envelope on the lanes\' time axis to draw it'],
    ['src/webview/runtime/overlaySpectrumPainter.ts', 'thins a stand-in spectrum (drawn while the real slice is on its way) as it is drawn'],
    ['src/webview/runtime/pictureSummary.ts', 'the end-to-end tests\' summary of what is on the canvas; shown nowhere'],
]);

/**
 * The modules that may call fullRead.ts `layoutLine`, the one way to hold a line of plain numbers as readable: each
 * for numbers it makes to lay a figure out, with what they are. A measured value never belongs here: it arrives as
 * `Whole` from the backend (wholeAnswers.ts) or is computed of whole values (fullRead.ts computedWhole).
 */
const LAYOUT_MODULES: ReadonlyMap<string, string> = new Map([
    ['src/webview/runtime/entryDistribution.ts', 'a histogram\'s counts, the height each dot is stacked at, and the marks of the slots and the base'],
]);
const FULL_READ = 'src/webview/runtime/fullRead.ts';

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

const relative = (source: ts.SourceFile): string => path.relative(repoRoot, source.fileName).split(path.sep).join('/');
const declaredIn = (symbol: ts.Symbol | undefined, file: string): boolean => !!symbol?.declarations?.some(item => relative(item.getSourceFile()) === file);

/** Whether `type` is, or holds (a union's member, an array's item, a property), the brand declared as `brand` in provenance.ts. */
function holds(type: ts.Type, brand: string, checker: ts.TypeChecker, depth = 0, seen = new Set<ts.Type>()): boolean {
    if (depth > 4 || seen.has(type)) return false;
    seen.add(type);
    const isBrand = (symbol: ts.Symbol | undefined): boolean => symbol?.name === brand && declaredIn(symbol, PROVENANCE);
    if (isBrand(type.aliasSymbol) || isBrand(type.getSymbol())) return true;
    if (type.isUnionOrIntersection()) return type.types.some(member => holds(member, brand, checker, depth, seen));
    if (!(type.flags & ts.TypeFlags.Object)) return false;
    const items = checker.isArrayType(type) || checker.isTupleType(type) ? checker.getTypeArguments(type as ts.TypeReference) : [];
    if (items.some(item => holds(item, brand, checker, depth + 1, seen))) return true;
    // A function is not a holder: calling one that answers `Whole` is how full data is read.
    if (type.getCallSignatures().length) return false;
    return type.getProperties().some(property => {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        return !!declaration && holds(checker.getTypeOfSymbolAtLocation(property, declaration), brand, checker, depth + 1, seen);
    });
}

type Rule = 'mint' | 'mint-kept' | 'layout' | 'empty-read' | 'test-code' | 'cast' | 'predicate' | 'unwrap' | 'drawn-cast' | 'drawn-predicate' | 'drawn-coerced';
interface Problem { file: string; line: number; rule: Rule; text: string }

/** Whether a value of `type` is itself a `Drawn` (not a holder of one): what arithmetic and text must not take. */
function isDrawn(type: ts.Type): boolean {
    const thinned = (member: ts.Type): boolean => member.getSymbol()?.name === 'Thinned' && declaredIn(member.getSymbol(), PROVENANCE);
    return thinned(type) || (type.isUnion() && type.types.some(thinned));
}

/** Every place that breaks rules 1 to 4 above. */
function provenanceProblems(scanned: ts.Program): Problem[] {
    const checker = scanned.getTypeChecker();
    const problems: Problem[] = [];
    for (const source of scanned.getSourceFiles()) {
        const file = relative(source);
        if (!file.startsWith('src/') || file.startsWith('src/test/') || file.startsWith('src/e2e/') || file === PROVENANCE || file === MINTS || file === UNWRAPS || file.includes('/generated/')) continue;
        const drawn = (node: ts.Expression): boolean => isDrawn(checker.getTypeAtLocation(node));
        const at = (node: ts.Node, rule: Rule): void => { problems.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, rule, text: node.getText().slice(0, 80) }); };
        /** Whether `node` is a call of wholeMint.ts's claimMint, by what its callee declares. */
        const claims = (node: ts.Node): boolean => {
            if (!ts.isCallExpression(node)) return false;
            const callee = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression);
            const declared = callee && callee.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(callee) : callee;
            return declared?.name === 'claimMint' && declaredIn(declared, MINTS);
        };
        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node)) {
                const found = checker.getSymbolAtLocation(node);
                const target = found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
                if (!MINT_MODULES.has(file) && declaredIn(target, MINTS)) at(node, 'mint');
                if (!DRAWING_MODULES.has(file) && declaredIn(target, UNWRAPS)) at(node, 'unwrap');
                if (file !== FULL_READ && !LAYOUT_MODULES.has(file) && target?.name === 'layoutLine' && declaredIn(target, FULL_READ)) at(node, 'layout');
                if (target?.declarations?.some(declaration => relative(declaration.getSourceFile()).startsWith('src/test/'))) at(node, 'test-code');
                // A claimed mint is only called (`mint.value(…)`): never exported, passed on or stored.
                const holder = target?.valueDeclaration;
                if (holder && ts.isVariableDeclaration(holder) && holder.initializer && claims(holder.initializer)) {
                    const exported = ts.isVariableStatement(holder.parent.parent) && !!ts.getModifiers(holder.parent.parent)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
                    const called = ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && ts.isCallExpression(node.parent.parent) && node.parent.parent.expression === node.parent;
                    if (holder.name === node ? exported : !called) at(node, 'mint-kept');
                }
            }
            // A claim is the initializer of a const, so the rule above can follow the mint.
            if (claims(node) && !(ts.isVariableDeclaration(node.parent) && node.parent.initializer === node && ts.isIdentifier(node.parent.name))) at(node, 'mint-kept');
            if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
                const to = checker.getTypeFromTypeNode(node.type);
                // Dropping null or undefined of what is already whole is no claim.
                if (holds(to, 'Whole', checker) && !checker.isTypeAssignableTo(checker.getNonNullableType(checker.getTypeAtLocation(node.expression)), to)) at(node, 'cast');
                // A cast that drops `Drawn` (`view.values as number[]`, `value as number`, `as any`) is an unwrap.
                if (!ts.isConstTypeReference(node.type) && holds(checker.getTypeAtLocation(node.expression), 'Thinned', checker) && !holds(to, 'Thinned', checker)) at(node, 'drawn-cast');
            }
            if (ts.isTypePredicateNode(node) && node.type && ts.isIdentifier(node.parameterName) && !holds(checker.getTypeFromTypeNode(node.type), 'Thinned', checker)) {
                const narrowed = checker.getSymbolAtLocation(node.parameterName);
                const declaration = narrowed?.valueDeclaration;
                if (narrowed && declaration && isDrawn(checker.getTypeOfSymbolAtLocation(narrowed, declaration))) at(node, 'drawn-predicate');
            }
            // A `Drawn` made a number or text without drawnPoints.ts.
            if (ts.isTypeOfExpression(node) && drawn(node.expression)) at(node, 'drawn-coerced');
            if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.PlusToken && drawn(node.operand)) at(node, 'drawn-coerced');
            if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.PlusToken || node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) && (drawn(node.left) || drawn(node.right))) at(node, 'drawn-coerced');
            if (ts.isTemplateSpan(node) && drawn(node.expression)) at(node, 'drawn-coerced');
            // A read given to a source (fullSource, sourceWith) that can only answer null or nothing reads no data.
            if (file !== FULL_READ && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
                const called = checker.getSymbolAtLocation(node.expression);
                const made = called && called.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(called) : called;
                const reads = node.arguments[1];
                if (made && ['fullSource', 'sourceWith'].includes(made.name) && declaredIn(made, FULL_READ) && reads) {
                    const nothing = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never;
                    for (const read of checker.getTypeAtLocation(reads).getProperties()) {
                        if (!['line', 'cells', 'level'].includes(read.name)) continue;
                        const answers = checker.getTypeOfSymbolAtLocation(read, reads).getCallSignatures().map(signature => signature.getReturnType());
                        const only = (type: ts.Type): boolean => (type.isUnion() ? type.types.every(only) : !!(type.flags & nothing));
                        if (answers.length && answers.every(only)) { at(reads, 'empty-read'); break; }
                    }
                }
            }
            if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
                const signature = checker.getResolvedSignature(node);
                (node.arguments ?? []).forEach((argument, index) => {
                    if (!signature || ts.isSpreadElement(argument) || !drawn(argument)) return;
                    const parameters = signature.getParameters();
                    const parameter = parameters[Math.min(index, parameters.length - 1)];
                    if (!parameter) return;
                    let type = checker.getTypeOfSymbolAtLocation(parameter, node);
                    // A rest parameter's element (`...data: any[]`).
                    if (index >= parameters.length - 1 && checker.isArrayType(type)) type = checker.getTypeArguments(type as ts.TypeReference)[0] ?? type;
                    if (type.flags & ts.TypeFlags.Any) at(argument, 'drawn-coerced');
                });
            }
            if (ts.isTypePredicateNode(node) && node.type && holds(checker.getTypeFromTypeNode(node.type), 'Whole', checker)) at(node, 'predicate');
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return problems;
}

const FIX: Record<Rule, string> = {
    'mint-kept': 'A module that holds the mint of Whole keeps it: `const mint = claimMint(…)` at the top of the module, not exported, and used only as `mint.value(…)`. Handing the mint to other code would let any number become full data. Export a function that reads or adapts one kind of full data instead (as localLine, backendPeak).',
    layout: 'Only the layout modules (LAYOUT_MODULES in this file) may call layoutLine, which holds plain numbers as a readable line. If these numbers are measurements, take them whole instead: a backend field through wholeAnswers.ts (scanWhole, pairWhole), or computedWhole for a number computed of whole values, then localLine. If they are numbers this module makes to lay a figure out (counts, stacking heights), add the module to LAYOUT_MODULES with what they are.',
    'empty-read': 'A read given to fullSource / sourceWith here can only answer null or nothing, so the source would be declared as full data and read none. If the layer has no full data, pass NO_FULL_DATA; if its data went out of date (its file changed), pass STALE_FULL_DATA; if it is a stand-in whose real picture is on its way, pass PENDING_FULL_DATA (all in fullRead.ts). A read that can fail must also be able to answer points: give its function the return type FullAnswer.',
    'test-code': 'Product code may not use anything under src/test: the tests\' helpers (such as wholeValue, which makes a Whole of a made-up number) are for tests only. Read the value through a FullSource or an adapter of wholeAnswers.ts.',
    mint: 'Only fullRead.ts and wholeAnswers.ts may use the mint (src/shared/wholeMint.ts). To read a value for a readout, read it through the layer\'s FullSource; for a new backend number taken of every value, add an adapter to wholeAnswers.ts.',
    cast: 'A cast to a type holding `Whole` claims a number is full data without a mint. Take the value from a FullSource or an adapter of wholeAnswers.ts instead.',
    predicate: 'A type predicate to `Whole` is a mint by another name. Take the value from a FullSource or an adapter of wholeAnswers.ts instead.',
    unwrap: 'Only the drawing modules (DRAWING_MODULES in this file) may call drawnPoints.ts. If this code draws, add its module there with what it draws. If it needs a number to show, compute or export, read it from the full data: the layer\'s FullSource, or the backend\'s valueRange / peak / levelBins.',
    'drawn-cast': 'This cast makes thinned points plain numbers. To draw them, call drawable / drawableLine in a drawing module; to read a value, use the full data (FullSource, wholeAnswers.ts).',
    'drawn-predicate': 'This predicate narrows a thinned point to a number. To draw it, call drawable in a drawing module; to read a value, use the full data.',
    'drawn-coerced': 'A thinned point is turned into a number or text here (typeof, unary +, + with text, a template, or an `any` parameter such as Number() or String()). To draw it, call drawable in a drawing module; to show a number, read it from the full data.',
};
const told = (problems: readonly Problem[]): string => problems.map(problem => `${problem.file}:${problem.line} ${problem.rule}: ${problem.text}\n    ${FIX[problem.rule]}`).join('\n');

test('a value of the full data (`Whole`) is made only in the mint modules, and a point thinned to be drawn (`Drawn`) becomes a number only in the drawing modules', () => {
    const problems = provenanceProblems(program());
    assert.equal(problems.length, 0, `\n${told(problems)}\nSee docs/plot-contracts-guide.md ("Adding a number a user reads").`);
});

// ── The routes are closed: each violation fails the compiler or the scan above ──

const HEAD = [
    'import type { Derived, Whole, WholeLine } from \'../../shared/provenance\';',
    'import type { FullPoints } from \'./fullRead\';',
    'import type { StageLayer, StageRead } from \'./stagePanes\';',
    'import type { StageView } from \'../../shared/protocol/backendProtocol\';',
    'import type { WaveformEnvelope } from \'../../shared/analysis/analysisTypes\';',
    'import type { SpectrumSlice } from \'./types\';',
    'import { computedLine, computedWhole, localCells, localLine } from \'./fullRead\';',
    'export type Used = Derived | WholeLine | typeof computedLine | Whole | FullPoints | StageLayer | StageRead | StageView | WaveformEnvelope | SpectrumSlice | typeof localLine | typeof localCells | typeof computedWhole;',
].join('\n');
const FIRST = 'const first = (view: StageView) => (view.values ?? [])[0] ?? 0;';

/** A deliberate violation (or an honest form), written as a module of the webview: what it shows and its source. */
interface Mutant { what: string; body: string; imports?: string }

/** What tsc must refuse: a plain number, or a drawn point, where full data is required or a number is computed. */
const MUST_NOT_COMPILE: readonly Mutant[] = [
    { what: 'a plain number named Whole', body: 'export const made: Whole = 3;' },
    { what: 'a plain number handed to a layer\'s readout', body: 'export const text = (layer: StageLayer, plain: number): string[] => layer.readout?.(0, { x: plain, value: plain }) ?? [];' },
    { what: 'a readout built from plain numbers', body: 'export const read = (was: StageRead, plain: number): StageRead => ({ ...was, at: plain, value: plain });' },
    { what: 'full points made of plain arrays', body: 'export const points: FullPoints = { xs: [1], values: [2], start: null, end: null, complete: true };' },
    { what: 'arithmetic passed off as full data', body: 'export const sum = (a: Whole, b: Whole): Whole => a + b;' },
    { what: 'the largest drawn point', body: 'export const top = (view: StageView): number => Math.max(...(view.values ?? []).map(value => value ?? 0));' },
    { what: 'a drawn point written as text', body: 'export const text = (view: StageView): string | undefined => view.values?.[0]?.toFixed(1);' },
    { what: 'arithmetic on a drawn point', body: 'export const twice = (view: StageView): number => (view.values?.[0] ?? 0) * 2;' },
    { what: 'a drawn point compared', body: 'export const loud = (view: StageView): boolean => (view.values?.[0] ?? 0) > -20;' },
    { what: 'a drawn cell handed to a readout', body: 'export const text = (layer: StageLayer, view: StageView): string[] => layer.readout?.(0, { x: view.matrix?.[0]?.[0] ?? 0, value: view.matrix?.[0]?.[0] ?? 0 }) ?? [];' },
    { what: 'a picture\'s drawn points given as its full data', body: 'export const full = (view: StageView) => localLine(view.xs ?? [], view.values ?? []);' },
    { what: 'plain numbers held as a line\'s full data', body: 'export const full = (xs: number[], values: number[]) => localLine(xs, values);' },
    { what: 'plain numbers held as cells\' full data', body: 'export const full = (xs: number[], ys: number[], matrix: number[][]) => localCells(xs, ys, matrix);' },
    { what: 'an envelope\'s picked samples (drawn points) held as a line\'s full data', body: 'export const full = (envelope: WaveformEnvelope) => localLine(envelope.samples ?? [], envelope.samples ?? []);' },
    { what: 'a number computed of drawn points made whole', body: 'export const top = (view: StageView) => computedWhole([(view.values ?? [])[0]], 3);' },
    { what: 'a number computed of plain numbers made whole', body: 'export const top = (plain: number) => computedWhole([plain], 3);' },
    { what: 'a number computed of nothing made whole', body: 'export const top = computedWhole([], 123);' },
    { what: 'a number computed of a list that may be empty made whole', body: 'export const top = (values: Whole[]) => computedWhole(values, 123);' },
    { what: 'a number computed of gaps alone made whole', body: 'export const top = computedWhole([null], 123);' },
    { what: 'a plain number where a computed whole is asked for', body: 'export const top: Derived = 3;' },
    { what: 'a measured whole value passed off as a computed one', body: 'export const top = (value: Whole): Derived => value;' },
    { what: 'whole values filtered, then held as the whole line', body: 'export const full = (xs: number[], line: WholeLine) => localLine(xs, line.filter(value => value !== null));' },
    { what: 'whole values sliced, then held as the whole line', body: 'export const full = (xs: number[], line: WholeLine) => localLine(xs, line.slice(0, 3));' },
    { what: 'an array of whole values, not known to be every one, held as the whole line', body: 'export const full = (xs: number[], values: Whole[]) => localLine(xs, values);' },
    { what: 'whole values mapped by hand, then held as the whole line', body: 'export const full = (xs: number[], line: WholeLine<Whole>) => localLine(xs, line.map(value => computedWhole([value], value * 2)));' },
    { what: 'a line computed of no line', body: 'export const line = computedLine([], () => 1);' },
    { what: 'a line computed of plain arrays', body: 'export const line = (plain: number[]) => computedLine([plain], bin => plain[bin]);' },
    { what: 'a range taken of values not known to be every one', imports: 'import { heldValueRange } from \'./fullRead\';', body: 'export const range = (values: Whole[]) => heldValueRange(values, false);' },
    { what: 'a range taken of plain numbers', imports: 'import { heldValueRange } from \'./fullRead\';', body: 'export const range = (values: number[]) => heldValueRange(values, false);' },
    { what: 'the order\'s level bins made of plain numbers', imports: 'import { levelBinsOf } from \'./stagePanes\';', body: 'export const bins = (xs: number[], values: number[]) => levelBinsOf(xs, values, [0, 1], false);' },
    { what: 'the order\'s level bins made of a picture\'s drawn points', imports: 'import { levelBinsOf } from \'./stagePanes\';', body: 'export const bins = (view: StageView) => levelBinsOf(view.xs ?? [], view.values ?? [], [0, 1], false);' },
    { what: 'a level of the full data summed outside a source', imports: 'import { levelOfValues } from \'./fullRead\';', body: 'export const level = (xs: number[], values: number[]) => levelOfValues(xs, values, { x0: 0, x1: 1, square: false });' },
    { what: 'a full-data source written by hand, which could read nothing', imports: 'import { cannotRead, noEvent, type FullSource } from \'./fullRead\';', body: 'export const none: FullSource = { held: \'fetched\', line: cannotRead, cells: cannotRead, level: cannotRead, event: noEvent };' },
    { what: 'a full-data source made by spreading another', imports: 'import { NO_FULL_DATA, type FullSource } from \'./fullRead\';', body: 'export const none: FullSource = { ...NO_FULL_DATA, held: \'fetched\' };' },
    { what: 'a full-data source made with no read', imports: 'import { fullSource } from \'./fullRead\';', body: 'export const none = fullSource(\'fetched\', {});' },
    { what: 'a picture drawn alone without saying where its numbers are read', imports: 'import { paintStage } from \'./stagePanes\';\nimport { emptyFigure } from \'./figureModel\';', body: 'export const draw = (canvas: HTMLCanvasElement, view: StageView) => paintStage(canvas, view, emptyFigure().range, \'\', emptyFigure().names);' },
    { what: 'a layer without its full data', body: 'export const layer = (view: StageView): StageLayer => ({ view, color: \'\' });' },
    { what: 'an envelope\'s buckets taken as samples', body: 'export const peak = (envelope: WaveformEnvelope): number => Math.max(...envelope.max);' },
    { what: 'a slice\'s drawn values taken as numbers', body: 'export const bins = (slice: SpectrumSlice): number[] => slice.values;' },
];

/** The honest forms, which must compile and pass the scan. */
const ALLOWED: readonly Mutant[] = [
    { what: 'a value read from full points', body: 'export const first = (points: FullPoints): Whole | undefined => points.xs[0];' },
    { what: 'a whole line held, a line computed of it, and a number computed of two of its values', body: 'export const full = (xs: number[], line: WholeLine<Whole>) => [localLine(xs, line), localLine(xs, computedLine([line], bin => line[bin] * 2))];\nexport const delta = (a: Whole, b: Whole): Derived => computedWhole([a, b], a - b);' },
    { what: 'dropping null of what is already whole', body: 'export const kept = (value: Whole | null): Whole => value as Whole;' },
    { what: 'a picture passed on, its gaps dropped and its points counted', body: 'export const copy = (view: StageView): StageView => ({ ...view, values: (view.values ?? []).filter(value => value !== null) });\nexport const count = (view: StageView): number => (view.values ?? []).length;' },
];

/** What compiles but the scan must refuse, with the rule it breaks. */
const MUST_NOT_PASS: ReadonlyArray<Mutant & { rule: Rule; also?: Rule[] }> = [
    { rule: 'mint', what: 'the mint claimed outside the mint modules', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'const mint = claimMint(\'fullRead\');\nexport const made = mint.value(3);' },
    { rule: 'mint', what: 'the mint reached through a namespace import', imports: 'import * as mints from \'../../shared/wholeMint\';', body: 'const mint = mints.claimMint(\'wholeAnswers\');\nexport const made = mint.everyBin([3]);' },
    { rule: 'mint', also: ['mint-kept'], what: 'a claimed mint exported', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'export const mint = claimMint(\'fullRead\');' },
    { rule: 'mint', also: ['mint-kept'], what: 'a claimed mint handed on as a value', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'const mint = claimMint(\'fullRead\');\nexport const leak = () => mint;' },
    { rule: 'mint', also: ['mint-kept'], what: 'a claimed mint\'s method handed on', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'const mint = claimMint(\'fullRead\');\nexport const make = mint.value;' },
    { rule: 'mint', also: ['mint-kept'], what: 'a claim that is not a const of the module', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'export const made = claimMint(\'fullRead\').value(3);' },
    { rule: 'layout', what: 'plain numbers held as a readable line outside the layout modules', imports: 'import { layoutLine } from \'./fullRead\';', body: 'export const full = (xs: number[], values: number[]) => layoutLine(xs, values);' },
    { rule: 'empty-read', what: 'a source whose read can only answer null', imports: 'import { fullSource } from \'./fullRead\';', body: 'export const none = fullSource(\'fetched\', { line: () => null });' },
    { rule: 'empty-read', what: 'a source whose read answers nothing', imports: 'import { fullSource } from \'./fullRead\';', body: 'export const none = fullSource(\'inline\', { cells() { return undefined; }, level: () => null });' },
    { rule: 'test-code', what: 'the tests\' way of making a Whole used in product code', imports: 'import { wholeValue } from \'../../test/helpers/whole\';', body: 'export const made = wholeValue(3);' },
    { rule: 'cast', what: 'a cast to Whole', body: 'export const made = 3 as Whole;' },
    { rule: 'cast', what: 'a cast to Whole through unknown', body: 'export const made = 3 as unknown as Whole;' },
    { rule: 'cast', what: 'a cast to full points', body: 'export const made = { xs: [1], start: null, end: null, complete: true } as unknown as FullPoints;' },
    { rule: 'cast', what: 'an angle-bracket cast to Whole', body: 'export const made = <Whole[]><unknown>[3];' },
    { rule: 'predicate', what: 'a type predicate to Whole', body: 'export const isWhole = (value: number): value is Whole => true;' },
    { rule: 'unwrap', what: 'drawnPoints.ts used outside the drawing modules', imports: 'import { drawable } from \'../../shared/drawnPoints\';', body: 'export const made = drawable(0);' },
    { rule: 'drawn-cast', what: 'drawn points cast to numbers', body: 'export const made = (view: StageView): number[] => view.values as number[];' },
    { rule: 'drawn-cast', what: 'a drawn point cast to a number', body: `${FIRST}\nexport const made = (view: StageView): number => first(view) as number;` },
    { rule: 'drawn-cast', what: 'a drawn point cast through unknown', body: `${FIRST}\nexport const made = (view: StageView): number => first(view) as unknown as number;` },
    { rule: 'drawn-cast', what: 'a picture cast to any', body: 'export const made = (view: StageView): number => (view as any).values[0];' },
    { rule: 'drawn-predicate', what: 'a predicate narrowing drawn points to numbers', body: 'export const made = (view: StageView): number[] => (view.values ?? []).filter((value): value is number => value !== null);' },
    ...['typeof first(view) === \'number\' ? 1 : 0', '+first(view)', 'Number(first(view))', 'String(first(view)).length', '(\'\' + first(view)).length', '`${first(view)}`.length'].map(coerced => (
        { rule: 'drawn-coerced' as const, what: `a drawn point coerced: ${coerced}`, body: `${FIRST}\nexport const made = (view: StageView): number => ${coerced};` })),
];

const ALL_MUTANTS: readonly Mutant[] = [...MUST_NOT_COMPILE, ...ALLOWED, ...MUST_NOT_PASS];
const fileOf = (mutant: Mutant): string => `src/webview/runtime/provenanceMutant${ALL_MUTANTS.indexOf(mutant)}.ts`;
let mutated: ts.Program | undefined;
/** The product code with every mutant added as a module of its own: compiled once for all the checks below. */
const withMutants = (): ts.Program => (mutated ??= program(new Map(ALL_MUTANTS.map(mutant => [fileOf(mutant), `${HEAD}\n${mutant.imports ?? ''}\n${mutant.body}\n`]))));

/** The compiler's errors in a mutant. */
function compileErrors(mutant: Mutant): string[] {
    const source = withMutants().getSourceFile(path.join(repoRoot, fileOf(mutant)));
    assert.ok(source, 'the mutant is compiled');
    return withMutants().getSemanticDiagnostics(source).map(item => ts.flattenDiagnosticMessageText(item.messageText, ' '));
}

let scanned: Problem[] | undefined;
/** The rules the scan finds broken in a mutant. */
function scanRules(mutant: Mutant): Rule[] {
    scanned ??= provenanceProblems(withMutants());
    return [...new Set(scanned.filter(problem => problem.file === fileOf(mutant)).map(problem => problem.rule))];
}

test('the compiler refuses a plain number where full data is required, and a point thinned to be drawn wherever a number is computed, written or read out', () => {
    for (const mutant of MUST_NOT_COMPILE) assert.notDeepEqual(compileErrors(mutant), [], `${mutant.what} must not compile:\n${mutant.body}`);
});

test('the scan refuses a mint, a cast or a predicate that makes full data, and every way of making a drawn point a number or text, outside their modules', () => {
    for (const mutant of MUST_NOT_PASS) {
        assert.deepEqual(compileErrors(mutant), [], `${mutant.what} compiles (the scan, not tsc, must catch it):\n${mutant.body}`);
        assert.deepEqual(scanRules(mutant).sort(), [mutant.rule, ...(mutant.also ?? [])].sort(), `${mutant.what}:\n${mutant.body}`);
    }
});

test('the honest forms compile and pass the scan', () => {
    for (const mutant of ALLOWED) {
        assert.deepEqual(compileErrors(mutant), [], `${mutant.what}:\n${mutant.body}`);
        assert.deepEqual(scanRules(mutant), [], `${mutant.what}:\n${mutant.body}`);
    }
});

test('the mint of a holder can be claimed once: its own module claims it as it loads, and a second claim throws', async () => {
    const { claimMint } = await import('../shared/wholeMint');
    await import('../webview/runtime/fullRead');
    await import('../webview/runtime/wholeAnswers');
    assert.throws(() => claimMint('fullRead'), /claimed twice/u);
    assert.throws(() => claimMint('wholeAnswers'), /claimed twice/u);
});
