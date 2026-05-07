import * as path from 'path';
import * as vscode from 'vscode';
import { runCommand, type CommandResult } from './testCommandRunner';
import { parseNodeTestDefinitions, type DiscoveredTestNode } from './testDiscovery';
import { buildNodeTestNamePattern, parseTapTestResults } from './tapParser';

const TEST_CONTROLLER_ID = 'audioWandasAnalyzer.workspaceTests';
const TEST_CONTROLLER_LABEL = 'Audio Wandas Analyzer Tests';
const DEBUG_PROFILE_LABEL = 'Debug Workspace Tests';
const TEST_FILE_SUFFIX = '.test.ts';

interface TestHostPaths {
    rootPath: string;
    rootUri: vscode.Uri;
    sourceTestsUri: vscode.Uri;
}

interface TestItemMetadata {
    kind: 'file' | 'suite' | 'test';
    sourceUri: vscode.Uri;
    compiledPath: string;
    titlePath: string[];
}

interface TestExecutionTarget {
    item: vscode.TestItem;
    metadata: TestItemMetadata;
    pattern?: string;
}

type TestMetadataRegistry = Map<string, TestItemMetadata>;

export function registerWorkspaceTests(context: vscode.ExtensionContext): void {
    const controller = vscode.tests.createTestController(TEST_CONTROLLER_ID, TEST_CONTROLLER_LABEL);
    const metadata = new Map<string, TestItemMetadata>();
    const hostPaths = createTestHostPaths(context.extensionUri);

    context.subscriptions.push(controller);

    controller.resolveHandler = async (item) => {
        if (!item) {
            await refreshAllTests(controller, metadata, hostPaths);
        }
    };

    const runProfile = controller.createRunProfile(
        'Run Workspace Tests',
        vscode.TestRunProfileKind.Run,
        async (request, token) => {
            await runWorkspaceTests(controller, metadata, hostPaths, request, token);
        },
        true,
    );

    const debugProfile = controller.createRunProfile(
        DEBUG_PROFILE_LABEL,
        vscode.TestRunProfileKind.Debug,
        async (request, token) => {
            await debugWorkspaceTests(controller, metadata, hostPaths, request, token);
        },
        true,
    );

    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(hostPaths.sourceTestsUri, `**/*${TEST_FILE_SUFFIX}`));
    watcher.onDidCreate(async () => {
        await refreshAllTests(controller, metadata, hostPaths);
    });
    watcher.onDidChange(async () => {
        await refreshAllTests(controller, metadata, hostPaths);
    });
    watcher.onDidDelete(async () => {
        await refreshAllTests(controller, metadata, hostPaths);
    });

    context.subscriptions.push(runProfile, debugProfile, watcher);

    void refreshAllTests(controller, metadata, hostPaths);
}

async function refreshAllTests(
    controller: vscode.TestController,
    metadata: TestMetadataRegistry,
    hostPaths: TestHostPaths,
): Promise<void> {
    try {
        const files = await findTestFiles(hostPaths.sourceTestsUri);
        const discoveredFiles = await Promise.allSettled(files.map((uri) => createFileTestItem(controller, uri, hostPaths)));

        metadata.clear();

        const items: vscode.TestItem[] = [];
        for (const result of discoveredFiles) {
            if (result.status === 'fulfilled') {
                registerMetadata(metadata, result.value.metadata);
                items.push(result.value.item);
                continue;
            }

            console.error(`[${TEST_CONTROLLER_ID}] Failed to discover tests`, result.reason);
        }

        controller.items.replace(items);
    } catch (error) {
        console.error(`[${TEST_CONTROLLER_ID}] Failed to refresh tests`, error);
        metadata.clear();
        controller.items.replace([]);
    }
}

async function createFileTestItem(
    controller: vscode.TestController,
    uri: vscode.Uri,
    hostPaths: TestHostPaths,
): Promise<{ item: vscode.TestItem; metadata: TestMetadataRegistry }> {
    const fileMetadata = new Map<string, TestItemMetadata>();
    const compiledPath = toCompiledTestPath(uri, hostPaths.rootPath);
    const document = await vscode.workspace.openTextDocument(uri);
    const definitions = parseNodeTestDefinitions(document.getText());
    const fileItem = controller.createTestItem(createFileItemId(uri), getDisplayPath(uri, hostPaths.rootPath), uri);

    fileItem.canResolveChildren = false;
    if (document.lineCount > 0) {
        fileItem.range = document.lineAt(0).range;
    }

    fileMetadata.set(fileItem.id, {
        kind: 'file',
        sourceUri: uri,
        compiledPath,
        titlePath: [],
    });

    for (const definition of definitions) {
        fileItem.children.add(createDiscoveredTestItem(controller, uri, compiledPath, definition, fileMetadata));
    }

    return { item: fileItem, metadata: fileMetadata };
}

function createDiscoveredTestItem(
    controller: vscode.TestController,
    sourceUri: vscode.Uri,
    compiledPath: string,
    definition: DiscoveredTestNode,
    metadata: TestMetadataRegistry,
): vscode.TestItem {
    const item = controller.createTestItem(createNodeItemId(sourceUri, definition), definition.title, sourceUri);
    item.canResolveChildren = false;
    item.range = new vscode.Range(definition.line, definition.column, definition.line, definition.column + definition.title.length + 2);

    metadata.set(item.id, {
        kind: definition.kind,
        sourceUri,
        compiledPath,
        titlePath: definition.titlePath,
    });

    for (const childDefinition of definition.children) {
        item.children.add(createDiscoveredTestItem(controller, sourceUri, compiledPath, childDefinition, metadata));
    }

    return item;
}

async function runWorkspaceTests(
    controller: vscode.TestController,
    metadata: TestMetadataRegistry,
    hostPaths: TestHostPaths,
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
): Promise<void> {
    const targets = collectExecutionTargets(controller, metadata, request);
    const run = controller.createTestRun(request, TEST_CONTROLLER_LABEL);

    try {
        enqueueTargetItems(run, targets, metadata);

        const compileResult = await runCommand('npm', ['run', 'compile'], hostPaths.rootPath);
        appendOutput(run, '$ npm run compile', compileResult.stdout, compileResult.stderr);

        if (compileResult.exitCode !== 0) {
            markCompileFailure(run, targets, metadata, compileResult.stderr.trim() || 'TypeScript compilation failed.');
            return;
        }

        for (const target of targets) {
            if (token.isCancellationRequested) {
                markTargetSkipped(run, target, metadata);
                continue;
            }

            markTargetStarted(run, target, metadata);
            const testResult = await runNodeTestTarget(target, hostPaths.rootPath);
            appendOutput(run, testResult.command, testResult.result.stdout, testResult.result.stderr);
            applyTargetResults(run, target, metadata, testResult.result);
        }
    } finally {
        run.end();
    }
}

async function debugWorkspaceTests(
    controller: vscode.TestController,
    metadata: TestMetadataRegistry,
    hostPaths: TestHostPaths,
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
): Promise<void> {
    if (token.isCancellationRequested) {
        return;
    }

    const targets = collectExecutionTargets(controller, metadata, request);
    if (targets.length === 0) {
        return;
    }

    const compileResult = await runCommand('npm', ['run', 'compile'], hostPaths.rootPath);
    if (compileResult.exitCode !== 0) {
        void vscode.window.showErrorMessage(compileResult.stderr.trim() || 'TypeScript compilation failed.');
        return;
    }

    try {
        const configuration = createDebugConfiguration(targets, hostPaths.rootPath);
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        await vscode.debug.startDebugging(workspaceFolder, configuration);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(message);
    }
}

function collectExecutionTargets(
    controller: vscode.TestController,
    metadata: TestMetadataRegistry,
    request: vscode.TestRunRequest,
): TestExecutionTarget[] {
    const selectedItems = request.include ? [...request.include] : [...getControllerItems(controller)];
    const excludedIds = new Set(request.exclude?.map((item) => item.id) ?? []);
    const unique = new Map<string, TestExecutionTarget>();

    for (const item of selectedItems) {
        if (excludedIds.has(item.id)) {
            continue;
        }

        const itemMetadata = metadata.get(item.id);
        if (!itemMetadata) {
            continue;
        }

        unique.set(item.id, {
            item,
            metadata: itemMetadata,
            pattern: itemMetadata.kind === 'file'
                ? undefined
                : buildNodeTestNamePattern(itemMetadata.titlePath, itemMetadata.kind),
        });
    }

    return [...unique.values()];
}

function getControllerItems(controller: vscode.TestController): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];
    controller.items.forEach((item) => {
        items.push(item);
    });
    return items;
}

function enqueueTargetItems(run: vscode.TestRun, targets: TestExecutionTarget[], metadata: TestMetadataRegistry): void {
    for (const target of targets) {
        for (const item of getScopeTestItems(target, metadata)) {
            run.enqueued(item);
        }
    }
}

function markCompileFailure(
    run: vscode.TestRun,
    targets: TestExecutionTarget[],
    metadata: TestMetadataRegistry,
    messageText: string,
): void {
    const message = new vscode.TestMessage(messageText);
    for (const target of targets) {
        for (const item of getScopeTestItems(target, metadata)) {
            run.failed(item, message);
        }
    }
}

function markTargetStarted(run: vscode.TestRun, target: TestExecutionTarget, metadata: TestMetadataRegistry): void {
    for (const item of getScopeTestItems(target, metadata)) {
        run.started(item);
    }
}

function markTargetSkipped(run: vscode.TestRun, target: TestExecutionTarget, metadata: TestMetadataRegistry): void {
    for (const item of getScopeTestItems(target, metadata)) {
        run.skipped(item);
    }
}

async function runNodeTestTarget(
    target: TestExecutionTarget,
    workspaceRoot: string,
): Promise<{ command: string; result: CommandResult }> {
    const args = ['--test', '--test-reporter', 'tap'];
    if (target.pattern) {
        args.push('--test-name-pattern', target.pattern);
    }
    args.push(target.metadata.compiledPath);

    const result = await runCommand(process.execPath, args, workspaceRoot);
    return {
        command: `$ ${process.execPath} ${args.join(' ')}`,
        result,
    };
}

function applyTargetResults(
    run: vscode.TestRun,
    target: TestExecutionTarget,
    metadata: TestMetadataRegistry,
    result: CommandResult,
): void {
    const scopeItems = getScopeTestItems(target, metadata);
    const scopeMap = new Map(
        scopeItems
            .map((item) => {
                const itemMetadata = metadata.get(item.id);
                if (!itemMetadata || itemMetadata.kind !== 'test') {
                    return undefined;
                }

                return [itemMetadata.titlePath.join(' > '), item] as const;
            })
            .filter((entry): entry is readonly [string, vscode.TestItem] => Boolean(entry)),
    );

    const parsedResults = parseTapTestResults(result.stdout).filter((entry) => entry.kind === 'test');
    for (const parsed of parsedResults) {
        const item = scopeMap.get(parsed.fullName);
        if (!item) {
            continue;
        }

        scopeMap.delete(parsed.fullName);

        if (parsed.status === 'passed') {
            run.passed(item, parsed.durationMs);
            continue;
        }

        const failureMessage = parsed.diagnostics || result.stdout.trim() || result.stderr.trim() || 'Test failed.';
        run.failed(item, new vscode.TestMessage(failureMessage), parsed.durationMs);
    }

    for (const item of scopeMap.values()) {
        const fallbackMessage = result.exitCode === 0
            ? 'No matching TAP result was reported for this test item.'
            : result.stdout.trim() || result.stderr.trim() || 'node:test exited with a non-zero status.';
        run.failed(item, new vscode.TestMessage(fallbackMessage), result.duration);
    }
}

function getScopeTestItems(target: TestExecutionTarget, metadata: TestMetadataRegistry): vscode.TestItem[] {
    if (target.metadata.kind === 'test') {
        return [target.item];
    }

    const items = collectDescendantTestItems(target.item, metadata);
    return items.length > 0 ? items : [target.item];
}

function collectDescendantTestItems(item: vscode.TestItem, metadata: TestMetadataRegistry): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];

    item.children.forEach((child) => {
        const childMetadata = metadata.get(child.id);
        if (childMetadata?.kind === 'test') {
            items.push(child);
            return;
        }

        items.push(...collectDescendantTestItems(child, metadata));
    });

    return items;
}

function createDebugConfiguration(targets: TestExecutionTarget[], workspaceRoot: string): vscode.DebugConfiguration {
    const patterns = [...new Set(targets.map((target) => target.pattern).filter((pattern): pattern is string => Boolean(pattern)))];
    if (patterns.length > 1 || (patterns.length === 1 && targets.length > 1)) {
        throw new Error('Debugging multiple individual test selections at once is not supported. Select one file, suite, or test.');
    }

    const runtimeArgs = ['--test'];
    if (patterns[0]) {
        runtimeArgs.push('--test-name-pattern', patterns[0]);
    }

    for (const compiledPath of [...new Set(targets.map((target) => target.metadata.compiledPath))]) {
        runtimeArgs.push(compiledPath);
    }

    return {
        type: 'node',
        request: 'launch',
        name: DEBUG_PROFILE_LABEL,
        cwd: workspaceRoot,
        runtimeExecutable: process.execPath,
        runtimeArgs,
        console: 'integratedTerminal',
        internalConsoleOptions: 'neverOpen',
        skipFiles: ['<node_internals>/**'],
        outFiles: [path.join(workspaceRoot, 'dist/**/*.js')],
    };
}

function registerMetadata(target: TestMetadataRegistry, source: TestMetadataRegistry): void {
    for (const [key, value] of source.entries()) {
        target.set(key, value);
    }
}

function createTestHostPaths(extensionUri: vscode.Uri): TestHostPaths {
    return {
        rootPath: extensionUri.fsPath,
        rootUri: extensionUri,
        sourceTestsUri: vscode.Uri.joinPath(extensionUri, 'src', 'test'),
    };
}

async function findTestFiles(directoryUri: vscode.Uri): Promise<vscode.Uri[]> {
    const discovered: vscode.Uri[] = [];

    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(directoryUri);
    } catch {
        return discovered;
    }

    for (const [name, type] of entries) {
        const entryUri = vscode.Uri.joinPath(directoryUri, name);
        if ((type & vscode.FileType.Directory) !== 0) {
            discovered.push(...await findTestFiles(entryUri));
            continue;
        }

        if ((type & vscode.FileType.File) !== 0 && name.endsWith(TEST_FILE_SUFFIX)) {
            discovered.push(entryUri);
        }
    }

    discovered.sort((left, right) => left.fsPath.localeCompare(right.fsPath));
    return discovered;
}

function getDisplayPath(uri: vscode.Uri, rootPath: string): string {
    const workspaceRelativePath = vscode.workspace.asRelativePath(uri, false);
    if (workspaceRelativePath && workspaceRelativePath !== uri.fsPath) {
        return workspaceRelativePath;
    }

    return path.relative(rootPath, uri.fsPath).split(path.sep).join('/');
}

function createFileItemId(uri: vscode.Uri): string {
    return `file:${uri.toString()}`;
}

function createNodeItemId(uri: vscode.Uri, definition: DiscoveredTestNode): string {
    return `${definition.kind}:${uri.toString()}#${definition.fullName}`;
}

function toCompiledTestPath(sourceUri: vscode.Uri, workspaceRoot: string): string {
    const sourceRelative = path.relative(path.join(workspaceRoot, 'src'), sourceUri.fsPath);
    return path.join(workspaceRoot, 'dist', sourceRelative).replace(/\.ts$/, '.js');
}

function appendOutput(run: vscode.TestRun, command: string, stdout: string, stderr: string): void {
    const blocks = [command, stdout.trim(), stderr.trim()].filter((part) => part.length > 0);
    if (blocks.length === 0) {
        return;
    }

    run.appendOutput(`${blocks.join('\n\n')}\r\n`);
}