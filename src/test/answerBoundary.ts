/**
 * What the answer store's boundary test looks for in a source (answerStoreBoundary.test.ts): collections that outlive
 * a call, and names of a failure pause or retry of its own.
 */
import ts from 'typescript';

const COLLECTIONS = new Set(['Map', 'WeakMap', 'Set', 'WeakSet']);
/** Calls that put something in an array: an array they are called on keeps what it is given. */
const ARRAY_PUTS = new Set(['push', 'unshift', 'splice']);
/** A name for when a failure is asked again, or how long it stands: those are the store's (FAILED_RETRY_MS, UNANSWERED_RETRY_MS). */
const RETRY_NAME = /RETRY_MS|FAILED_HOLD|[fF]ailedAt$|^retryAt$/;

export interface HeldCollection {
    file: string;
    name: string;
    kind: string;
    line: number;
}

/** Array methods whose callback runs within the call: a function passed to one does not outlive it. */
const RUN_NOW = new Set(['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'reduce', 'reduceRight', 'flatMap', 'sort', 'toSorted', 'from']);
const deciding = new Set<ts.Node>();

/**
 * A function that may run after the call that made it: one returned, put in an object, handed to a call that keeps it
 * (a listener, a timer), or a local helper that is itself kept so. A callback run at once (map, filter) and a local
 * helper only used within the call do not.
 */
function outlives(node: ts.Node): boolean {
    if (!ts.isFunctionLike(node)) return false;
    const known = outlived.get(node);
    if (known !== undefined) return known;
    const decided = decideOutlives(node);
    outlived.set(node, decided);
    return decided;
}

const outlived = new WeakMap<ts.Node, boolean>();

function decideOutlives(node: ts.Node): boolean {
    const parent = node.parent;
    if (parent && ts.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression)) {
        return !(ts.isPropertyAccessExpression(parent.expression) && RUN_NOW.has(parent.expression.name.text));
    }
    const named = ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? { at: parent as ts.Node, name: parent.name.text }
        : ts.isFunctionDeclaration(node) && node.name ? { at: node as ts.Node, name: node.name.text } : null;
    if (!named) return true;
    if (deciding.has(named.at)) return true;
    deciding.add(named.at);
    try {
        return persists(named.at, named.name);
    } finally {
        deciding.delete(named.at);
    }
}

/** The function (or source file) a node is declared in. */
function scopeOf(node: ts.Node): ts.Node {
    let scope: ts.Node = node.parent;
    while (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
    return scope;
}

/** Whether `name`, declared in `scope`, is used by a function inside it that outlives the call (a closure kept by a factory). */
function keptByClosure(scope: ts.Node, name: string): boolean {
    let found = false;
    const scan = (node: ts.Node, inner: boolean): void => {
        if (found) return;
        if (inner && ts.isIdentifier(node) && node.text === name) { found = true; return; }
        ts.forEachChild(node, child => scan(child, inner || outlives(child)));
    };
    scan(scope, false);
    return found;
}

const persisted = new WeakMap<ts.Node, boolean>();

function persists(declaration: ts.Node, name: string): boolean {
    const known = persisted.get(declaration);
    if (known !== undefined) return known;
    const scope = scopeOf(declaration);
    const decided = ts.isSourceFile(scope) || keptByClosure(scope, name);
    persisted.set(declaration, decided);
    return decided;
}

/** Whether `name` is put into with push / unshift / splice anywhere in `scope`. */
function putInto(scope: ts.Node, name: string): boolean {
    let found = false;
    const scan = (node: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ARRAY_PUTS.has(node.expression.name.text)
            && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === name) { found = true; return; }
        ts.forEachChild(node, scan);
    };
    scan(scope);
    return found;
}

/**
 * Every Map, WeakMap, Set or WeakSet that outlives a call (in a module, a class, an object a factory keeps, or a
 * closure a factory returns), and every array kept that way and put into: the places answers could be cached.
 */
export function findHeldCollections(file: string, source: ts.SourceFile): HeldCollection[] {
    const found: HeldCollection[] = [];
    const at = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const visit = (node: ts.Node): void => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && COLLECTIONS.has(node.expression.text)) {
            const kind = node.expression.text;
            const parent = node.parent;
            if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && persists(parent, parent.name.text)) found.push({ file, name: parent.name.text, kind, line: at(node) });
            else if (ts.isPropertyDeclaration(parent)) found.push({ file, name: parent.name.getText(source), kind, line: at(node) });
            else if (ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) {
                // A field of an object kept past the call (a record a store holds, a factory's state).
                let holder: ts.Node = parent.parent.parent;
                while (ts.isPropertyAssignment(holder) || ts.isObjectLiteralExpression(holder) || ts.isParenthesizedExpression(holder) || ts.isAsExpression(holder)) holder = holder.parent;
                const kept = ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name) ? persists(holder, holder.name.text) : ts.isReturnStatement(holder) || ts.isPropertyDeclaration(holder) || ts.isBinaryExpression(holder);
                if (kept) found.push({ file, name: parent.name.getText(source), kind, line: at(node) });
            } else if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === node) {
                const target = parent.left;
                if (ts.isPropertyAccessExpression(target) && target.expression.kind === ts.SyntaxKind.ThisKeyword) found.push({ file, name: target.name.text, kind, line: at(node) });
            }
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.length === 0) {
            const name = node.name.text;
            const scope = scopeOf(node);
            if (persists(node, name) && putInto(scope, name)) found.push({ file, name, kind: 'Array', line: at(node) });
        }
        if (ts.isPropertyDeclaration(node) && node.initializer && ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.length === 0) {
            found.push({ file, name: node.name.getText(source), kind: 'Array', line: at(node) });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    // One entry per name in a file: a name kept twice is one place.
    const seen = new Set<string>();
    return found.filter(held => {
        const key = `${held.name}|${held.kind}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Every declared name of a failure pause or retry (a `…RETRY_MS`, a `failedAt` map), as `file#name`. */
export function findOwnRetryPolicies(file: string, source: ts.SourceFile): string[] {
    const found = new Set<string>();
    const visit = (node: ts.Node): void => {
        const name = (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isPropertyAssignment(node)) && (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) ? node.name.text : undefined;
        if (name && RETRY_NAME.test(name)) found.add(`${file}#${name}`);
        ts.forEachChild(node, visit);
    };
    visit(source);
    return [...found];
}

/**
 * Every answerKey call that names a file but says its version is carried by the ask (`version: { by }`): a file's own
 * answer names its own version and calibration (fileVersion and calibration, or a basis), never leaves it to the ask.
 */
export function findFileKeysWithoutVersion(file: string, source: ts.SourceFile): string[] {
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'answerKey') {
            const parts = node.arguments[0];
            if (parts && ts.isObjectLiteralExpression(parts)) {
                const prop = (name: string) => parts.properties.find(item => item.name && ts.isIdentifier(item.name) && item.name.text === name);
                const version = prop('version');
                const by = version && ts.isPropertyAssignment(version) && ts.isObjectLiteralExpression(version.initializer)
                    && version.initializer.properties.some(item => item.name && ts.isIdentifier(item.name) && item.name.text === 'by');
                if (prop('file') && (!version || by)) found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

/**
 * The files that declare what the host and the backend answer (the messages a handler takes, the backend's results,
 * the analysis a track is drawn from, the entry screen's publications): a value of a type declared in one of them is
 * a host answer, whatever the variable holding it is called.
 */
export const ANSWER_DECLARATIONS = [
    'src/webview/runtime/hostMessaging.ts',
    'src/shared/protocol/backendProtocol.ts',
    'src/shared/protocol/generated/backendProtocolSchema.ts',
    'src/shared/analysis/analysisTypes.ts',
    'src/shared/analysis/entryScan.ts',
    'src/shared/session/comparisonSessionController.ts',
];
/** Fields of a page element: a text or handler written from a message is shown, not kept. */
const PAGE_FIELDS = new Set(['textContent', 'innerHTML', 'title', 'className', 'onmessage', 'hidden', 'value', 'checked']);
/** An element's data attribute (`el.dataset.x`): written for the page and the tests to read, not kept. */
const isDataAttribute = (node: ts.Expression): boolean => ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'dataset';

/** The webview's sources with a type checker, so an answer is known by its type (answerStoreBoundary.test.ts). */
export function answerProgram(repoRoot: string, files: readonly string[], extra: Record<string, string> = {}): ts.Program {
    const options: ts.CompilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], strict: true, esModuleInterop: true, skipLibCheck: true, noEmit: true, types: [] };
    const host = ts.createCompilerHost(options, true);
    const read = host.getSourceFile.bind(host);
    const virtual = new Map(Object.entries(extra).map(([file, text]) => [ts.sys.resolvePath(`${repoRoot}/${file}`), text]));
    host.getSourceFile = (name, version, onError, create) => {
        const text = virtual.get(ts.sys.resolvePath(name));
        return text !== undefined ? ts.createSourceFile(name, text, version, true) : read(name, version, onError, create);
    };
    const fileExists = host.fileExists.bind(host);
    host.fileExists = name => virtual.has(ts.sys.resolvePath(name)) || fileExists(name);
    return ts.createProgram([...files, ...Object.keys(extra)].map(file => `${repoRoot}/${file}`), options, host);
}

/** Whether a type is, holds (an array's items, a union's members, a type's arguments) or is part of a host answer. */
function isAnswerType(type: ts.Type, checker: ts.TypeChecker, answerFiles: ReadonlySet<string>, depth = 0): boolean {
    if (depth > 4) return false;
    const declared = (symbol: ts.Symbol | undefined): boolean => !!symbol?.declarations?.some(item => answerFiles.has(ts.sys.resolvePath(item.getSourceFile().fileName)));
    if (declared(type.aliasSymbol) || declared(type.getSymbol())) return true;
    if (type.isUnionOrIntersection()) return type.types.some(member => isAnswerType(member, checker, answerFiles, depth + 1));
    const args = [...(type.aliasTypeArguments ?? []), ...(checker.isArrayType(type) || checker.isTupleType(type) || (type.flags & ts.TypeFlags.Object && ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)) ? checker.getTypeArguments(type as ts.TypeReference) : [])];
    return args.some(arg => isAnswerType(arg, checker, answerFiles, depth + 1));
}

/** Whether an expression reads a host answer: any name in it whose value is of an answer's type (not a function that makes one). */
function readsAnswer(node: ts.Node, checker: ts.TypeChecker, answerFiles: ReadonlySet<string>): boolean {
    let found = false;
    const visit = (inner: ts.Node): void => {
        if (found) return;
        if (ts.isFunctionLike(inner)) return;
        if (ts.isIdentifier(inner) && !(ts.isPropertyAccessExpression(inner.parent) && inner.parent.name === inner) && !(ts.isPropertyAssignment(inner.parent) && inner.parent.name === inner)) {
            const type = checker.getTypeAtLocation(inner);
            if (!type.getCallSignatures().length && isAnswerType(type, checker, answerFiles)) { found = true; return; }
        }
        ts.forEachChild(inner, visit);
    };
    visit(node);
    return found;
}

/**
 * Every write of a host answer outside the store, known by its type (ANSWER_DECLARATIONS), whatever its names: into a
 * field of an object (`record.range = { … msg … }`, `target[i].spectrogram = channel.spectrogram`), as `file#target`,
 * or into a `let` that outlives the call (a module's, or a closure's a factory keeps), as `file#let name`. A class's
 * own fields (`this.x`) are its state and found as collections.
 */
export function findAnswerWrites(file: string, source: ts.SourceFile, checker: ts.TypeChecker, answerFiles: ReadonlySet<string>): string[] {
    const found = new Set<string>();
    const lets = new Map<ts.Node, string>();
    const visitLets = (node: ts.Node): void => {
        if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Let) {
            for (const declaration of node.declarations) if (ts.isIdentifier(declaration.name) && persists(declaration, declaration.name.text)) {
                const symbol = checker.getSymbolAtLocation(declaration.name);
                const decl = symbol?.valueDeclaration;
                if (decl) lets.set(decl, declaration.name.text);
                if (declaration.initializer && readsAnswer(declaration.initializer, checker, answerFiles)) found.add(`${file}#let ${declaration.name.text}`);
            }
        }
        ts.forEachChild(node, visitLets);
    };
    visitLets(source);
    const visit = (node: ts.Node): void => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && readsAnswer(node.right, checker, answerFiles)) {
            const left = node.left;
            if ((ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) && left.expression.kind !== ts.SyntaxKind.ThisKeyword) {
                const field = ts.isPropertyAccessExpression(left) ? left.name.text : '';
                if (!PAGE_FIELDS.has(field) && !isDataAttribute(left)) found.add(`${file}#${left.getText(source)}`);
            } else if (ts.isIdentifier(left)) {
                const decl = checker.getSymbolAtLocation(left)?.valueDeclaration;
                const name = decl && lets.get(decl);
                if (name) found.add(`${file}#let ${name}`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return [...found];
}
