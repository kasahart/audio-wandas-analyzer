/**
 * What the compiler cannot say of `Whole` (src/shared/provenance.ts), said here by symbol and type, never by a name's
 * spelling:
 *
 * 1. Only the mint modules (MINT_MODULES) refer to a mint of wholeMint.ts.
 * 2. No code casts a value to a type that holds `Whole` (`3 as Whole`, `as unknown as FullPoints`), and none
 *    declares a type predicate that would (`value is Whole`).
 *
 * With these two, the compiler's own rule (a plain number is not a `Whole`) means a number a readout, a headline, a
 * range or an order takes came through a mint module. The second half of this file proves the route is closed: each
 * deliberate violation is compiled or scanned and must fail. See docs/plot-contracts-guide.md for what to do when a
 * check here fails, and for what these checks cannot guarantee.
 */
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = path.resolve(__dirname, '..', '..');
const PROVENANCE = 'src/shared/provenance.ts';
const MINTS = 'src/shared/wholeMint.ts';

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

interface Problem { file: string; line: number; rule: 'mint' | 'cast' | 'predicate'; text: string }

/** Every place outside the mint modules that would make a `Whole` of a plain number (rules 1 and 2 above). */
function wholeProblems(scanned: ts.Program): Problem[] {
    const checker = scanned.getTypeChecker();
    const problems: Problem[] = [];
    for (const source of scanned.getSourceFiles()) {
        const file = relative(source);
        if (!file.startsWith('src/') || file.startsWith('src/test/') || file.startsWith('src/e2e/') || file === PROVENANCE || file === MINTS) continue;
        const at = (node: ts.Node, rule: Problem['rule']): void => { problems.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, rule, text: node.getText().slice(0, 80) }); };
        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node) && !MINT_MODULES.has(file)) {
                const found = checker.getSymbolAtLocation(node);
                const target = found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
                if (declaredIn(target, MINTS)) at(node, 'mint');
            }
            if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
                const to = checker.getTypeFromTypeNode(node.type);
                // Dropping null or undefined of what is already whole is no claim.
                if (holds(to, 'Whole', checker) && !checker.isTypeAssignableTo(checker.getNonNullableType(checker.getTypeAtLocation(node.expression)), to)) at(node, 'cast');
            }
            if (ts.isTypePredicateNode(node) && node.type && holds(checker.getTypeFromTypeNode(node.type), 'Whole', checker)) at(node, 'predicate');
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return problems;
}

const FIX: Record<Problem['rule'], string> = {
    mint: 'Only fullRead.ts and wholeAnswers.ts may call a mint (src/shared/wholeMint.ts). To read a value for a readout, read it through the layer\'s FullSource; for a new backend number taken of every value, add an adapter to wholeAnswers.ts.',
    cast: 'A cast to a type holding `Whole` claims a number is full data without a mint. Take the value from a FullSource or an adapter of wholeAnswers.ts instead.',
    predicate: 'A type predicate to `Whole` is a mint by another name. Take the value from a FullSource or an adapter of wholeAnswers.ts instead.',
};
const told = (problems: readonly Problem[]): string => problems.map(problem => `${problem.file}:${problem.line} ${problem.rule}: ${problem.text}\n    ${FIX[problem.rule]}`).join('\n');

test('a value of the full data (`Whole`) is made only in the mint modules: no other code calls a mint, casts to it or declares a predicate for it', () => {
    const problems = wholeProblems(program());
    assert.equal(problems.length, 0, `\n${told(problems)}\nSee docs/plot-contracts-guide.md ("Adding a number a user reads").`);
});

// ── The route is closed: each violation fails the compiler or the scan above ──

const MUTANT = 'src/webview/runtime/provenanceMutant.ts';
const HEAD = [
    'import type { Whole } from \'../../shared/provenance\';',
    'import type { FullPoints } from \'./fullRead\';',
    'import type { StageLayer, StageRead } from \'./stagePanes\';',
].join('\n');

/** The compiler's errors in the mutant file. */
function compileErrors(body: string): string[] {
    const mutated = program(new Map([[MUTANT, `${HEAD}\n${body}\nexport type Used = Whole | FullPoints | StageLayer | StageRead;\n`]]));
    const source = mutated.getSourceFile(path.join(repoRoot, MUTANT));
    assert.ok(source, 'the mutant is compiled');
    return mutated.getSemanticDiagnostics(source).map(item => ts.flattenDiagnosticMessageText(item.messageText, ' '));
}

/** The rules the scan finds broken in the mutant file. */
function scanRules(body: string, head = HEAD): string[] {
    const mutated = program(new Map([[MUTANT, `${head}\n${body}\nexport type Used = Whole | FullPoints | StageLayer | StageRead;\n`]]));
    return [...new Set(wholeProblems(mutated).filter(problem => problem.file === MUTANT).map(problem => problem.rule))];
}

test('the compiler refuses a plain number where a readout takes full data', () => {
    const refused: Array<[string, string]> = [
        ['a plain number named Whole', 'export const made: Whole = 3;'],
        ['a drawn value handed to a layer\'s readout', 'export const text = (layer: StageLayer, drawn: number): string[] => layer.readout?.(0, { x: drawn, value: drawn }) ?? [];'],
        ['a readout built from plain numbers', 'export const read = (was: StageRead, drawn: number): StageRead => ({ ...was, at: drawn, value: drawn });'],
        ['full points made of plain arrays', 'export const points: FullPoints = { xs: [1], values: [2], start: null, end: null, complete: true };'],
        ['arithmetic passed off as full data', 'export const sum = (a: Whole, b: Whole): Whole => a + b;'],
    ];
    for (const [what, body] of refused) assert.ok(compileErrors(body).some(message => message.includes('Whole')), `${what} must not compile: ${body}`);
    // The honest forms compile: a value read from full points, and a number computed of whole values.
    assert.deepEqual(compileErrors('import { wholeOf } from \'../../shared/provenance\';\nexport const first = (points: FullPoints): Whole | undefined => points.xs[0];\nexport const delta = (a: Whole, b: Whole): Whole => wholeOf((x, y) => x - y, a, b);'), []);
});

test('the scan refuses a mint, a cast or a predicate outside the mint modules', () => {
    assert.deepEqual(scanRules('export const made = mintWhole(3);', `${HEAD}\nimport { mintWhole } from '../../shared/wholeMint';`), ['mint']);
    assert.deepEqual(scanRules('export const made = mint.mintWholes([3]);', `${HEAD}\nimport * as mint from '../../shared/wholeMint';`), ['mint']);
    assert.deepEqual(scanRules('export const made = 3 as Whole;'), ['cast']);
    assert.deepEqual(scanRules('export const made = 3 as unknown as Whole;'), ['cast']);
    assert.deepEqual(scanRules('export const made = { xs: [1], start: null, end: null, complete: true } as unknown as FullPoints;'), ['cast']);
    assert.deepEqual(scanRules('export const made = <Whole[]><unknown>[3];'), ['cast']);
    assert.deepEqual(scanRules('export const isWhole = (value: number): value is Whole => true;'), ['predicate']);
    // Not a violation: narrowing what is already whole.
    assert.deepEqual(scanRules('export const kept = (value: Whole | null): Whole => value as Whole;'), []);
});
