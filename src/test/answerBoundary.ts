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
