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
 *    (fullRead.ts localLine, localCells) take `WholeLine` / `WholeCells`, so an array reaches them only from a mint
 *    module: a backend field the protocol marks `x-whole` (wholeAnswers.ts), or a line or cells mapped value by
 *    value of such (computedLine, computedCells; one number: computedWhole). The one entry that takes plain numbers,
 *    `layoutLine` (numbers a figure is laid out with, not measurements), is used only by the layout modules
 *    (LAYOUT_MODULES).
 *    The map a whole line or cells are computed with, and the compute of a whole number, are written at the call and
 *    use every value they are handed (rule `computed-unused`): a result named whole is made of the whole values the
 *    call names, never of a plain array read by index or a constant (display rules R7).
 *    A full-data source (FullSource) is made only by fullRead.ts: one written by hand or by spreading another does
 *    not compile, so the only source that reads nothing is the named `NO_FULL_DATA`.
 * 3. Only the drawing modules (DRAWING_MODULES) refer to drawnPoints.ts, where a `Drawn` becomes a number.
 * 4. No code turns a `Drawn` into a number or text another way: a cast that drops it, a predicate that narrows it,
 *    `typeof`, unary `+`, `'' + value`, a template, or passing it where a parameter is `any` (`Number(value)`).
 * 5. Outside the drawing modules a picture's drawn points are opaque: no code counts them (`.length`), indexes them
 *    (`[i]`, `.at(i)`), iterates them (`for … of`, `[a, b] = …`) or spreads them (`[...values]`, `f(...values)`).
 *    That holds of every array of `Drawn` (by type) and of the places they sit at, a picture's `xs` and `ys`
 *    (PICTURE_PLACES, by symbol, through a local const too). How many points were drawn, and where the first and the
 *    last sit, are the thinning's, not the data's: an axis, a range or a count comes from the source (the picture's
 *    source axis, valueRange, the full data), never from them.
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
const SCHEMA = 'src/shared/protocol/generated/backendProtocolSchema.ts';
/**
 * The places of a picture's drawn points (rule 5): fields of the protocol's StageView, which say where each value of
 * `values` (`xs`) and each row of `matrix` (`ys`) is drawn. They are as thinned as the points.
 */
const PICTURE_PLACES: ReadonlyArray<readonly [string, string]> = [['StageView', 'xs'], ['StageView', 'ys']];

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

type Rule = 'mint' | 'mint-kept' | 'layout' | 'computed-unused' | 'empty-read' | 'test-code' | 'cast' | 'predicate' | 'unwrap' | 'drawn-cast' | 'drawn-predicate' | 'drawn-coerced' | 'drawn-read';
interface Problem { file: string; line: number; rule: Rule; text: string }

/** Whether a value of `type` is itself a `Drawn` (not a holder of one): what arithmetic and text must not take. */
function isDrawn(type: ts.Type): boolean {
    const thinned = (member: ts.Type): boolean => member.getSymbol()?.name === 'Thinned' && declaredIn(member.getSymbol(), PROVENANCE);
    return thinned(type) || (type.isUnion() && type.types.some(thinned));
}

/** What a symbol stands for, through an import. */
const aliased = (symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined => (symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);

/** What each answer of a type can be: 'null' (failed), 'nothing' (undefined, void, never) or 'something'. */
function answerKinds(type: ts.Type): Array<'null' | 'nothing' | 'something'> {
    if (type.isUnion()) return type.types.flatMap(answerKinds);
    if (type.flags & ts.TypeFlags.Null) return ['null'];
    return type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never) ? ['nothing'] : ['something'];
}

/**
 * The answers a source's read can give, one list of kinds per way it answers: each `return` of the function written
 * for it (an arrow, a method, or a function it names), an expression body, or ending with no return; else, for a read
 * passed on from elsewhere, what its type says it answers.
 */
function answersOf(read: ts.Symbol, at: ts.Node, checker: ts.TypeChecker): Array<Array<'null' | 'nothing' | 'something'>> {
    const declaration = read.valueDeclaration;
    let written: ts.Node | undefined = declaration && ts.isPropertyAssignment(declaration) ? declaration.initializer
        : declaration && ts.isMethodDeclaration(declaration) ? declaration
            : declaration && ts.isShorthandPropertyAssignment(declaration) ? checker.getShorthandAssignmentValueSymbol(declaration)?.valueDeclaration : undefined;
    if (written && ts.isIdentifier(written)) written = aliased(checker.getSymbolAtLocation(written), checker)?.valueDeclaration;
    if (written && ts.isVariableDeclaration(written)) written = written.initializer;
    if (written && (ts.isArrowFunction(written) || ts.isFunctionExpression(written) || ts.isFunctionDeclaration(written) || ts.isMethodDeclaration(written)) && written.body) {
        if (!ts.isBlock(written.body)) return [answerKinds(checker.getTypeAtLocation(written.body))];
        const answers: Array<Array<'null' | 'nothing' | 'something'>> = [];
        const walk = (node: ts.Node): void => {
            if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
            if (ts.isReturnStatement(node)) answers.push(node.expression ? answerKinds(checker.getTypeAtLocation(node.expression)) : ['nothing']);
            ts.forEachChild(node, walk);
        };
        ts.forEachChild(written.body, walk);
        // A body that can run to its end answers undefined there too; only the answers are judged, so it adds 'nothing'.
        return answers.length ? answers : [['nothing']];
    }
    return checker.getTypeOfSymbolAtLocation(read, at).getCallSignatures().map(signature => answerKinds(signature.getReturnType()));
}

/** The symbols of PICTURE_PLACES in `scanned`: one per entry while the protocol still has the field. */
function picturePlaces(scanned: ts.Program): Set<ts.Symbol> {
    const checker = scanned.getTypeChecker();
    const found = new Set<ts.Symbol>();
    const schema = scanned.getSourceFile(path.join(repoRoot, SCHEMA));
    if (schema) ts.forEachChild(schema, node => {
        if (!ts.isInterfaceDeclaration(node)) return;
        for (const member of node.members) {
            if (!member.name || !ts.isIdentifier(member.name) || !PICTURE_PLACES.some(([owner, field]) => owner === node.name.text && field === (member.name as ts.Identifier).text)) continue;
            const symbol = checker.getSymbolAtLocation(member.name);
            if (symbol) found.add(symbol);
        }
    });
    return found;
}

/** fullRead.ts's producers of whole collections and numbers, each given the function its result is computed with. */
const COMPUTED: ReadonlySet<string> = new Set(['computedLine', 'computedCells', 'computedWhole']);

/**
 * Whether a call of a COMPUTED producer computes its result of what it is handed: its function is written at the
 * call and uses every parameter it declares, at least one; computedWhole's declares one for each value of `from`
 * written as a list (or a rest parameter). How the function computes is the reader's (docs/plot-contracts-guide.md).
 */
function computesOfItsValues(call: ts.CallExpression, name: string, checker: ts.TypeChecker): boolean {
    const written = call.arguments[1];
    if (!written || !(ts.isArrowFunction(written) || ts.isFunctionExpression(written))) return false;
    const parameters = written.parameters;
    if (!parameters.length || parameters.some(parameter => !ts.isIdentifier(parameter.name))) return false;
    const used = new Set<ts.Symbol>();
    const walk = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) { const symbol = checker.getSymbolAtLocation(node); if (symbol) used.add(symbol); }
        ts.forEachChild(node, walk);
    };
    walk(written.body);
    // computedLine / computedCells: the value (the first parameter); the index or row and column are optional.
    const needed = name === 'computedWhole' ? parameters : parameters.slice(0, 1);
    if (needed.some(parameter => { const symbol = checker.getSymbolAtLocation(parameter.name); return !symbol || !used.has(symbol); })) return false;
    const from = call.arguments[0];
    const rest = parameters.some(parameter => !!parameter.dotDotDotToken);
    return name !== 'computedWhole' || rest || !from || !ts.isArrayLiteralExpression(from) || from.elements.some(ts.isSpreadElement) || parameters.length >= from.elements.length;
}

/** Every place that breaks rules 1 to 5 above. */
function provenanceProblems(scanned: ts.Program): Problem[] {
    const checker = scanned.getTypeChecker();
    const problems: Problem[] = [];
    const places = picturePlaces(scanned);
    /**
     * Whether `type` is an array of drawn points (a line's values, a row of a picture's cells, an envelope), or a union
     * holding one. An array of such arrays is not: picking one of them (a channel's line, a row) reads no point.
     */
    const drawnArray = (type: ts.Type): boolean => (type.isUnion() ? type.types : [type]).some(member => (checker.isArrayType(member) || checker.isTupleType(member))
        && checker.getTypeArguments(member as ts.TypeReference).some(isDrawn));
    /** Whether `node` is a picture's places (PICTURE_PLACES), read from the picture or through a local const of them. */
    const placed = (node: ts.Expression, depth = 0): boolean => {
        if (depth > 4) return false;
        if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return placed(node.expression, depth);
        if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) return placed(node.left, depth);
        if (ts.isPropertyAccessExpression(node)) { const field = checker.getSymbolAtLocation(node.name); return !!field && places.has(field); }
        if (!ts.isIdentifier(node)) return false;
        const local = checker.getSymbolAtLocation(node)?.valueDeclaration;
        return !!local && ts.isVariableDeclaration(local) && !!local.initializer && ts.isVariableDeclarationList(local.parent) && !!(local.parent.flags & ts.NodeFlags.Const) && placed(local.initializer, depth + 1);
    };
    const drawnPoints = (node: ts.Expression): boolean => drawnArray(checker.getTypeAtLocation(node)) || placed(node);
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
            // A whole collection or number computed with a function that is not written at the call, or ignores what
            // it is handed (rule 2: computed-unused).
            if (ts.isCallExpression(node)) {
                const callee = aliased(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression), checker);
                if (callee && COMPUTED.has(callee.name) && declaredIn(callee, FULL_READ) && !computesOfItsValues(node, callee.name, checker)) at(node, 'computed-unused');
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
            // Rule 5: a picture's drawn points (and their places) counted, indexed, iterated or spread.
            if (!DRAWING_MODULES.has(file)) {
                if (ts.isPropertyAccessExpression(node) && ['length', 'at'].includes(node.name.text) && drawnPoints(node.expression)) at(node, 'drawn-read');
                if (ts.isElementAccessExpression(node) && drawnPoints(node.expression)) at(node, 'drawn-read');
                if (ts.isForOfStatement(node) && drawnPoints(node.expression)) at(node.expression, 'drawn-read');
                if (ts.isSpreadElement(node) && drawnPoints(node.expression)) at(node, 'drawn-read');
                if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && drawnPoints(node.initializer)) at(node, 'drawn-read');
            }
            // A read given to a source (fullSource, sourceWith, or fullRead.ts's own `new Source`) whose every answer is
            // null fails every time: it reads no data, yet the source would count as one that reads (readsFullData).
            // What it answers is taken of its body's returns where the read is written there, so a function typed to
            // answer points (FullAnswer) that returns null on every path is no read either. A read whose every answer
            // is "on its way" (undefined) waits for ever: only fullRead.ts makes one (pendingSource, a stand-in's wait on its request).
            if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)) {
                const made = aliased(checker.getSymbolAtLocation(node.expression), checker);
                const reads = node.arguments?.[1];
                if (made && ['fullSource', 'sourceWith', 'Source'].includes(made.name) && declaredIn(made, FULL_READ) && reads) {
                    for (const read of checker.getTypeAtLocation(reads).getProperties()) {
                        if (!['line', 'cells', 'level'].includes(read.name)) continue;
                        const answers = answersOf(read, reads, checker);
                        const nothing = answers.length > 0 && answers.every(answer => answer.length > 0 && answer.every(kind => kind !== 'something'));
                        if (nothing && (file !== FULL_READ || answers.some(answer => answer.includes('null')))) { at(reads, 'empty-read'); break; }
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
    'computed-unused': 'Display rules R7 (a whole collection is made only by its producers): computedLine, computedCells and computedWhole name their result full data because it is computed of the whole values they hand their function. Here that function is not written at the call, declares no parameter, or leaves one unused (computedLine / computedCells: the value; computedWhole: each value of `from`), so the result could be made of something else: a plain array read by index, a thinned point, a constant. Write the function at the call and compute the result of the value(s) it is handed; read other whole lines at the same index inside it, next to the value (`computedLine(a, (value, bin) => value - b[bin])`). A line of numbers that are not of the data is layoutLine\'s (LAYOUT_MODULES).',
    layout: 'Only the layout modules (LAYOUT_MODULES in this file) may call layoutLine, which holds plain numbers as a readable line. If these numbers are measurements, take them whole instead: a backend field through wholeAnswers.ts (scanWhole, pairWhole), or computedWhole for a number computed of whole values, then localLine. If they are numbers this module makes to lay a figure out (counts, stacking heights), add the module to LAYOUT_MODULES with what they are.',
    'empty-read': 'A read given to a source here can only answer null (it fails every time), or, outside fullRead.ts, only nothing: the source would count as full data and read none. If the layer has no full data, pass NO_FULL_DATA (fullRead.ts); a picture that must not be read at all (its file changed since it was analysed) is painted with `readout: false`. A stand-in whose real picture is on its way passes pendingSource(its request). A kind of read the source does not have is left out (it becomes cannotRead). A read that can fail must also be able to answer points on some path.',
    'test-code': 'Product code may not use anything under src/test: the tests\' helpers (such as wholeValue, which makes a Whole of a made-up number) are for tests only. Read the value through a FullSource or an adapter of wholeAnswers.ts.',
    mint: 'Only fullRead.ts and wholeAnswers.ts may use the mint (src/shared/wholeMint.ts). To read a value for a readout, read it through the layer\'s FullSource; for a new backend number taken of every value, add an adapter to wholeAnswers.ts.',
    cast: 'A cast to a type holding `Whole` claims a number is full data without a mint. Take the value from a FullSource or an adapter of wholeAnswers.ts instead.',
    predicate: 'A type predicate to `Whole` is a mint by another name. Take the value from a FullSource or an adapter of wholeAnswers.ts instead.',
    unwrap: 'Only the drawing modules (DRAWING_MODULES in this file) may call drawnPoints.ts. If this code draws, add its module there with what it draws. If it needs a number to show, compute or export, read it from the full data: the layer\'s FullSource, or the backend\'s valueRange / peak / levelBins.',
    'drawn-cast': 'This cast makes thinned points plain numbers. To draw them, call drawable / drawableLine in a drawing module; to read a value, use the full data (FullSource, wholeAnswers.ts).',
    'drawn-predicate': 'This predicate narrows a thinned point to a number. To draw it, call drawable in a drawing module; to read a value, use the full data.',
    'drawn-read': 'A picture\'s drawn points, or the places they are drawn at (its xs / ys), are counted, indexed, iterated or spread here, outside the drawing modules. They are as many, and start and end where, the thinning left them: a count, an axis, a range or a value taken of them is of the picture, not the data. Take it from the source instead: the picture\'s source axis for its extent, valueRange / levelBins for its values, its FullSource for a point, a slice\'s frequencyBins for its size. If this code draws, add its module to DRAWING_MODULES with what it draws.',
    'drawn-coerced': 'A thinned point is turned into a number or text here (typeof, unary +, + with text, a template, or an `any` parameter such as Number() or String()). To draw it, call drawable in a drawing module; to show a number, read it from the full data.',
};
const told = (problems: readonly Problem[]): string => problems.map(problem => `${problem.file}:${problem.line} ${problem.rule}: ${problem.text}\n    ${FIX[problem.rule]}`).join('\n');

test('a value of the full data (`Whole`) is made only in the mint modules, and a point thinned to be drawn (`Drawn`) becomes a number only in the drawing modules', () => {
    const problems = provenanceProblems(program());
    assert.equal(problems.length, 0, `\n${told(problems)}\nSee docs/plot-contracts-guide.md ("Adding a number a user reads").`);
});

test('every picture place the scan follows (PICTURE_PLACES) is a field of the protocol today', () => {
    assert.equal(picturePlaces(program()).size, PICTURE_PLACES.length, `PICTURE_PLACES names ${PICTURE_PLACES.map(([owner, field]) => `${owner}.${field}`).join(', ')}; not each is a field of ${SCHEMA} now. Rule: rule 5 follows a picture's places by these fields. Fix: name the fields that now hold where a picture's drawn points sit (regenerate the schema if it moved).`);
});

// ── The routes are closed: each violation fails the compiler or the scan above ──

const HEAD = [
    'import type { Derived, Drawn, Whole, WholeCells, WholeLine } from \'../../shared/provenance\';',
    'import type { FullPoints } from \'./fullRead\';',
    'import type { StageLayer, StageRead } from \'./stagePanes\';',
    'import type { StageView } from \'../../shared/protocol/backendProtocol\';',
    'import type { WaveformEnvelope } from \'../../shared/analysis/analysisTypes\';',
    'import type { SpectrumSlice } from \'./types\';',
    'import { computedCells, computedLine, computedWhole, localCells, localLine } from \'./fullRead\';',
    'export type Used = Derived | Drawn | WholeLine | WholeCells | typeof computedLine | typeof computedCells | Whole | FullPoints | StageLayer | StageRead | StageView | WaveformEnvelope | SpectrumSlice | typeof localLine | typeof localCells | typeof computedWhole;',
].join('\n');
// A drawn point, however it was had (taking one out of a picture is itself refused, rule 5).
const FIRST = 'declare function first(view: StageView): Drawn;';

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
    { what: 'a number computed of drawn points made whole', body: 'export const top = (view: StageView) => computedWhole([(view.values ?? [])[0]], value => value);' },
    { what: 'a number computed of plain numbers made whole', body: 'export const top = (plain: number) => computedWhole([plain], value => value);' },
    { what: 'a number computed of nothing made whole', body: 'export const top = computedWhole([], () => 123);' },
    { what: 'a number computed of a list that may be empty made whole', body: 'export const top = (values: Whole[]) => computedWhole(values, (...all) => all.length);' },
    { what: 'a number computed of gaps alone made whole', body: 'export const top = computedWhole([null], value => value ?? 0);' },
    { what: 'a plain number where a computed whole is asked for', body: 'export const top: Derived = 3;' },
    { what: 'a measured whole value passed off as a computed one', body: 'export const top = (value: Whole): Derived => value;' },
    { what: 'whole values filtered, then held as the whole line', body: 'export const full = (xs: number[], line: WholeLine) => localLine(xs, line.filter(value => value !== null));' },
    { what: 'whole values sliced, then held as the whole line', body: 'export const full = (xs: number[], line: WholeLine) => localLine(xs, line.slice(0, 3));' },
    { what: 'an array of whole values, not known to be every one, held as the whole line', body: 'export const full = (xs: number[], values: Whole[]) => localLine(xs, values);' },
    { what: 'whole values mapped by hand, then held as the whole line', body: 'export const full = (xs: number[], line: WholeLine<Whole>) => localLine(xs, line.map(value => computedWhole([value], whole => whole * 2)));' },
    { what: 'a line computed of no line', body: 'export const line = computedLine([], () => 1);' },
    { what: 'a line computed of a plain array', body: 'export const line = (plain: number[]) => computedLine(plain, value => value);' },
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
    { what: 'a whole line held, a line computed of it, and a number computed of two of its values', body: 'export const full = (xs: number[], line: WholeLine<Whole>) => [localLine(xs, line), localLine(xs, computedLine(line, value => value * 2))];\nexport const delta = (a: Whole, b: Whole): Derived => computedWhole([a, b], (x, y) => x - y);' },
    { what: 'a Δ of two whole lines, the other read at the same index', body: 'export const delta = (a: WholeLine<Whole>, b: WholeLine<Whole>) => computedLine(a, (value, bin) => value - b[bin]);\nexport const mean = (values: [Whole, ...Whole[]]) => computedWhole(values, (...all) => all.reduce((sum, value) => sum + value, 0) / all.length);' },
    { what: 'whole cells held, and cells computed of them', body: 'export const full = (xs: number[], ys: number[], cells: WholeCells<Whole>) => [localCells(xs, ys, cells), localCells(xs, ys, computedCells(cells, value => value * 2))];' },
    { what: 'dropping null of what is already whole', body: 'export const kept = (value: Whole | null): Whole => value as Whole;' },
    { what: 'a read that can fail, and answers points otherwise', imports: 'import { fullSource, type FetchedFullSource } from \'./fullRead\';', body: 'export const some = (held: FetchedFullSource, late: boolean) => fullSource(\'fetched\', { line(query, ready) { if (late) return null; return held.line(query, ready); } });' },
    { what: 'a picture passed on, its gaps dropped', body: 'export const copy = (view: StageView): StageView => ({ ...view, values: (view.values ?? []).filter(value => value !== null) });' },
    { what: 'a picture\'s full points counted and indexed', body: 'export const last = (points: FullPoints): Whole | undefined => points.xs[points.xs.length - 1];' },
];

/** What compiles but the scan must refuse, with the rule it breaks. */
const MUST_NOT_PASS: ReadonlyArray<Mutant & { rule: Rule; also?: Rule[] }> = [
    { rule: 'mint', what: 'the mint claimed outside the mint modules', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'const mint = claimMint(\'fullRead\');\nexport const made = mint.value(3);' },
    { rule: 'mint', what: 'the mint reached through a namespace import', imports: 'import * as mints from \'../../shared/wholeMint\';', body: 'const mint = mints.claimMint(\'wholeAnswers\');\nexport const made = mint.field({ x: 3 }, \'x\');' },
    { rule: 'mint', also: ['mint-kept'], what: 'a claimed mint exported', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'export const mint = claimMint(\'fullRead\');' },
    { rule: 'mint', also: ['mint-kept'], what: 'a claimed mint handed on as a value', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'const mint = claimMint(\'fullRead\');\nexport const leak = () => mint;' },
    { rule: 'mint', also: ['mint-kept'], what: 'a claimed mint\'s method handed on', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'const mint = claimMint(\'fullRead\');\nexport const make = mint.value;' },
    { rule: 'mint', also: ['mint-kept'], what: 'a claim that is not a const of the module', imports: 'import { claimMint } from \'../../shared/wholeMint\';', body: 'export const made = claimMint(\'fullRead\').value(3);' },
    { rule: 'layout', what: 'plain numbers held as a readable line outside the layout modules', imports: 'import { layoutLine } from \'./fullRead\';', body: 'export const full = (xs: number[], values: number[]) => layoutLine(xs, values);' },
    { rule: 'empty-read', what: 'a source whose read can only answer null', imports: 'import { fullSource } from \'./fullRead\';', body: 'export const none = fullSource(\'fetched\', { line: () => null });' },
    { rule: 'empty-read', what: 'a source whose read answers nothing', imports: 'import { fullSource } from \'./fullRead\';', body: 'export const none = fullSource(\'inline\', { cells() { return undefined; }, level: () => null });' },
    { rule: 'empty-read', what: 'a source whose read only waits, made outside fullRead.ts', imports: 'import { fullSource } from \'./fullRead\';', body: 'export const waits = fullSource(\'fetched\', { line: () => undefined });' },
    { rule: 'empty-read', what: 'a read typed to answer points that returns null on every path', imports: 'import { fullSource, type FullAnswer } from \'./fullRead\';', body: 'export const none = (late: boolean) => fullSource(\'fetched\', { line(): FullAnswer { if (late) return null; return null; } });' },
    { rule: 'empty-read', what: 'a read that names a function that only fails', imports: 'import { fullSource, type FullAnswer } from \'./fullRead\';', body: 'function failed(): FullAnswer { return null; }\nexport const none = fullSource(\'fetched\', { line: failed });' },
    { rule: 'empty-read', what: 'a read of a source replaced by one that only fails', imports: 'import { sourceWith, type FetchedFullSource } from \'./fullRead\';', body: 'export const none = (source: FetchedFullSource) => sourceWith(source, { line: () => null });' },
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
    ...([
        ['its points counted', 'export const count = (view: StageView): number => (view.values ?? []).length;'],
        ['a point taken by its index', 'export const first = (view: StageView) => (view.values ?? [])[0] ?? null;'],
        ['its last point taken with at', 'export const last = (view: StageView) => (view.values ?? []).at(-1) ?? null;'],
        ['its points iterated', 'export const seen = (view: StageView): number => { let n = 0; for (const value of view.values ?? []) if (value !== null) n += 1; return n; };'],
        ['its points spread into another array', 'export const both = (view: StageView, other: StageView) => [...(view.values ?? []), ...(other.values ?? [])];'],
        ['its first points destructured', 'export const two = (view: StageView) => { const [a, b] = view.values ?? []; return a === b; };'],
        ['a row of its cells counted', 'export const width = (view: StageView): number => (view.matrix ?? [[]])[0]?.length ?? 0;'],
        ['its envelope counted', 'export const count = (view: StageView): number => view.waveform?.min.length ?? 0;'],
        ['the place of its first point', 'export const start = (view: StageView): number => view.xs?.[0] ?? 0;'],
        ['the place of its last point, through a const', 'export const end = (view: StageView): number => { const xs = view.xs ?? []; return xs[xs.length - 1] ?? 0; };'],
        ['how many rows it was drawn with', 'export const rows = (view: StageView): number => (view.ys ?? []).length;'],
        ['the points of a slice counted', 'export const bins = (slice: SpectrumSlice): number => slice.values.length;'],
    ] as const).map(([how, body]) => ({ rule: 'drawn-read' as const, what: `a picture's drawn points read outside the drawing modules: ${how}`, body })),
    ...['typeof first(view) === \'number\' ? 1 : 0', '+first(view)', 'Number(first(view))', 'String(first(view)).length', '(\'\' + first(view)).length', '`${first(view)}`.length'].map(coerced => (
        { rule: 'drawn-coerced' as const, what: `a drawn point coerced: ${coerced}`, body: `${FIRST}\nexport const made = (view: StageView): number => ${coerced};` })),
];

/**
 * Display rules R7, "a whole collection is made only by its producers": a `WholeLine` is as long as the whole line it
 * is mapped of (computedLine takes a map, never a length or an array of values), `WholeCells` are every row (rows
 * each whole are not enough), and a computed whole number is computed of the values it names. The number beside its
 * value, the thinned line, the line by index of a plain array and the two forms of rows not known to be every row
 * compiled when computedLine took lines, a callback by index and a length, localCells took rows of WholeLine and
 * computedWhole took a number; the others guard the same rule another way (there must never be an overload of
 * computedLine that takes an array of values).
 */
const WHOLE_COLLECTIONS_MUST_NOT_COMPILE: readonly Mutant[] = [
    { what: 'a number named whole beside the whole value it claims to be of, not computed of it', body: 'export const top = (whole: Whole, unrelated: number) => computedWhole([whole], unrelated);' },
    { what: 'a number named whole of two values whose compute takes only the first', body: 'export const top = (a: Whole, b: Whole) => computedWhole([a, b], x => x * 2);' },
    { what: 'a line thinned to every other value, named whole by a length of its own', body: 'export const thinned = (line: WholeLine<Whole>) => localLine([], computedLine([line], index => line[index * 2], Math.ceil(line.length / 2)));' },
    { what: 'a line computed by index of plain arrays, named whole beside a whole one', body: 'export const line = (line: WholeLine<Whole>, plain: number[]) => computedLine([line], bin => plain[bin]);' },
    { what: 'a line handed in as an array of values, not mapped', body: 'export const line = (line: WholeLine<Whole>, plain: number[]) => computedLine(line, plain);' },
    { what: 'a whole line\'s values filtered and handed in as the line computed', body: 'export const line = (line: WholeLine<Whole>) => computedLine(line, line.filter((_, index) => index % 2 === 0));' },
    { what: 'every other row of whole cells, with their places, held as the cells', body: 'export const full = (xs: number[], ys: number[], rows: ReadonlyArray<WholeLine>) => localCells(xs, ys.filter((_, index) => index % 2 === 0), rows.filter((_, index) => index % 2 === 0));' },
    { what: 'rows each whole, not known to be every row, held as the cells', body: 'export const full = (xs: number[], ys: number[], rows: WholeLine[]) => localCells(xs, ys, rows);' },
    { what: 'every other row of WholeCells held as the cells', body: 'export const full = (xs: number[], ys: number[], cells: WholeCells) => localCells(xs, ys.filter((_, index) => index % 2 === 0), cells.filter((_, index) => index % 2 === 0));' },
    { what: 'cells sliced to some columns held as the cells', body: 'export const full = (xs: number[], ys: number[], cells: WholeCells) => localCells(xs, ys, cells.map(row => row.slice(0, 2)));' },
    { what: 'a picture\'s drawn cells held as the cells', body: 'export const full = (view: StageView) => localCells([], [], view.matrix ?? []);' },
];

/** The same rule where only the scan can see it: the function a whole result is computed with ignores what it is handed. */
const WHOLE_COLLECTIONS_MUST_NOT_PASS: ReadonlyArray<Mutant & { rule: Rule }> = [
    { rule: 'computed-unused', what: 'a number named whole of a whole value its compute ignores', body: 'export const top = (whole: Whole, unrelated: number) => computedWhole([whole], () => unrelated);' },
    { rule: 'computed-unused', what: 'a number named whole of two values, the first ignored', body: 'export const top = (a: Whole, b: Whole) => computedWhole([a, b], (_x, y) => y * 2);' },
    { rule: 'computed-unused', what: 'a number named whole by a compute passed in, not written at the call', body: 'export const top = (a: Whole, compute: (value: Whole) => number) => computedWhole([a], compute);' },
    { rule: 'computed-unused', what: 'a line of a plain array read by index, its whole line\'s values ignored', body: 'export const line = (line: WholeLine<Whole>, plain: number[]) => computedLine(line, (_value, bin) => plain[bin]);' },
    { rule: 'computed-unused', what: 'a line made with a map passed in, not written at the call', body: 'export const line = (line: WholeLine<Whole>, map: (value: Whole) => number) => computedLine(line, map);' },
    { rule: 'computed-unused', what: 'cells of a constant, their whole cells ignored', body: 'export const cells = (cells: WholeCells<Whole>) => computedCells(cells, () => 0);' },
];

const ALL_MUTANTS: readonly Mutant[] = [...MUST_NOT_COMPILE, ...ALLOWED, ...MUST_NOT_PASS, ...WHOLE_COLLECTIONS_MUST_NOT_COMPILE, ...WHOLE_COLLECTIONS_MUST_NOT_PASS];
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

test('a whole line, whole cells and a computed whole number are made only by their producers: a thinned, filtered or handed-in line, rows not known to be every row, and a number beside its values do not compile (R7)', () => {
    for (const mutant of WHOLE_COLLECTIONS_MUST_NOT_COMPILE) {
        assert.notDeepEqual(compileErrors(mutant), [], `${mutant.what} must not compile:\n${mutant.body}\nRule: display rules R7, a whole collection is made only by its producers. If a change to fullRead.ts (computedLine, computedCells, computedWhole, localCells) or provenance.ts (WholeLine, WholeCells) let this compile, put back what refused it: a line is mapped of one whole line (no length, no array of values), cells are WholeCells, a computed number is the answer of a compute handed its values.`);
    }
});

test('a whole result computed with a function that is not written at the call, or that ignores the values it is handed, is refused by the scan (R7)', () => {
    for (const mutant of WHOLE_COLLECTIONS_MUST_NOT_PASS) {
        assert.deepEqual(compileErrors(mutant), [], `${mutant.what} compiles (the scan, not tsc, must catch it):\n${mutant.body}`);
        assert.deepEqual(scanRules(mutant), [mutant.rule], `${mutant.what}:\n${mutant.body}\nRule: display rules R7; the scan's rule \`computed-unused\` (computesOfItsValues in this file) must find it.`);
    }
});

test('the honest forms compile and pass the scan', () => {
    for (const mutant of ALLOWED) {
        assert.deepEqual(compileErrors(mutant), [], `${mutant.what}:\n${mutant.body}`);
        assert.deepEqual(scanRules(mutant), [], `${mutant.what}:\n${mutant.body}`);
    }
});

test('inside fullRead.ts too, a source whose read can only fail is refused; a read that only waits is made there alone (pendingSource)', () => {
    const own = program().getSourceFile(path.join(repoRoot, FULL_READ));
    assert.ok(own, 'fullRead.ts is compiled');
    const added = ['export const FAILS = new Source(\'fetched\', { line: () => null, cells: () => null });', 'export const WAITS = new Source(\'fetched\', { level: () => undefined });'];
    const scannedHere = provenanceProblems(program(new Map([[FULL_READ, `${own.text}\n${added.join('\n')}\n`]]))).filter(problem => problem.file === FULL_READ);
    const failsAt = own.text.split('\n').length + 1;
    assert.deepEqual(scannedHere.map(problem => `${problem.line} ${problem.rule}`), [`${failsAt} empty-read`], told(scannedHere));
});

test('the mint of a holder can be claimed once: its own module claims it as it loads, and a second claim throws', async () => {
    const { claimMint } = await import('../shared/wholeMint');
    await import('../webview/runtime/fullRead');
    await import('../webview/runtime/wholeAnswers');
    assert.throws(() => claimMint('fullRead'), /claimed twice/u);
    assert.throws(() => claimMint('wholeAnswers'), /claimed twice/u);
});
