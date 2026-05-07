import * as ts from 'typescript';

export interface DiscoveredTestNode {
    kind: 'suite' | 'test';
    title: string;
    titlePath: string[];
    fullName: string;
    line: number;
    column: number;
    children: DiscoveredTestNode[];
}

export function parseNodeTestDefinitions(sourceText: string): DiscoveredTestNode[] {
    const sourceFile = ts.createSourceFile('workspace-test.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return collectTestNodes(sourceFile, sourceFile.statements, []);
}

function collectTestNodes(
    sourceFile: ts.SourceFile,
    statements: ts.NodeArray<ts.Statement>,
    titlePath: string[],
): DiscoveredTestNode[] {
    const discovered: DiscoveredTestNode[] = [];

    for (const statement of statements) {
        const expression = getStatementExpression(statement);
        if (!expression || !ts.isCallExpression(expression)) {
            continue;
        }

        const callKind = getNodeTestCallKind(expression.expression);
        if (!callKind) {
            continue;
        }

        const titleNode = expression.arguments[0];
        const callbackNode = expression.arguments.find(
            (argument): argument is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
        );

        if (!titleNode || !callbackNode) {
            continue;
        }

        const title = getStaticTitle(titleNode);
        if (!title) {
            continue;
        }

        const childTitlePath = [...titlePath, title];
        const position = sourceFile.getLineAndCharacterOfPosition(titleNode.getStart(sourceFile));
        const children = callKind === 'suite' && callbackNode.body && ts.isBlock(callbackNode.body)
            ? collectTestNodes(sourceFile, callbackNode.body.statements, childTitlePath)
            : [];

        discovered.push({
            kind: callKind,
            title,
            titlePath: childTitlePath,
            fullName: childTitlePath.join(' > '),
            line: position.line,
            column: position.character,
            children,
        });
    }

    return discovered;
}

function getStatementExpression(statement: ts.Statement): ts.Expression | undefined {
    if (ts.isExpressionStatement(statement)) {
        return statement.expression;
    }

    if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
            if (declaration.initializer) {
                return declaration.initializer;
            }
        }
    }

    return undefined;
}

function getNodeTestCallKind(expression: ts.Expression): 'suite' | 'test' | undefined {
    const rootName = getCallRootIdentifier(expression);
    if (rootName === 'describe' || rootName === 'suite') {
        return 'suite';
    }

    if (rootName === 'test' || rootName === 'it') {
        return 'test';
    }

    return undefined;
}

function getCallRootIdentifier(expression: ts.Expression): string | undefined {
    if (ts.isIdentifier(expression)) {
        return expression.text;
    }

    if (ts.isPropertyAccessExpression(expression)) {
        return getCallRootIdentifier(expression.expression);
    }

    return undefined;
}

function getStaticTitle(node: ts.Expression): string | undefined {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }

    return undefined;
}