#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function sortUnique(values) {
    return [...new Set(values)].sort();
}

function diff(expected, actual) {
    return {
        missing: expected.filter((value) => !actual.includes(value)),
        unexpected: actual.filter((value) => !expected.includes(value)),
    };
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireBuiltModule(repoRoot, relativePath) {
    const fullPath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Missing built module ${relativePath}. Run \`npm run compile\` first.`);
    }
    return require(fullPath);
}

function collectPackageCommands(repoRoot) {
    const packageJson = readJson(path.join(repoRoot, 'package.json'));
    const commands = Array.isArray(packageJson.contributes?.commands)
        ? packageJson.contributes.commands
        : [];
    return sortUnique(commands
        .map((command) => command.command)
        .filter((command) => typeof command === 'string' && command.startsWith('audioWandasAnalyzer.')));
}

function collectWebviewActionIds(repoRoot) {
    const source = fs.readFileSync(path.join(repoRoot, 'src', 'webview', 'comparisonRenderScript.ts'), 'utf8');
    return sortUnique(Array.from(source.matchAll(/data-action="([^"]+)"/gu), (match) => match[1]));
}

function collectShortcutLabels(repoRoot) {
    const renderScriptModule = requireBuiltModule(repoRoot, path.join('dist', 'webview', 'comparisonRenderScript.js'));
    const shortcutRows = Array.isArray(renderScriptModule.SHORTCUT_ROWS) ? renderScriptModule.SHORTCUT_ROWS : [];
    return sortUnique(shortcutRows
        .map((row) => row?.shortcut)
        .filter((shortcut) => typeof shortcut === 'string'));
}

function loadInventory(repoRoot) {
    return requireBuiltModule(repoRoot, path.join('dist', 'shared', 'gui', 'guiTriggerabilityInventory.js'));
}

function verifyGuiTriggerability(repoRoot) {
    const inventory = loadInventory(repoRoot);
    const knownCommands = sortUnique([
        ...inventory.GUI_TRIGGERABILITY_SCOPED_COMMAND_IDS,
        ...inventory.GUI_TRIGGERABILITY_EXCLUDED_COMMAND_IDS,
    ]);
    const knownWebviewActions = sortUnique(inventory.GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS);
    const knownShortcuts = sortUnique(inventory.GUI_TRIGGERABILITY_SCOPED_SHORTCUTS);

    const commandDiff = diff(knownCommands, collectPackageCommands(repoRoot));
    const actionDiff = diff(knownWebviewActions, collectWebviewActionIds(repoRoot));
    const shortcutDiff = diff(knownShortcuts, collectShortcutLabels(repoRoot));

    return {
        missingCommands: commandDiff.missing,
        unexpectedCommands: commandDiff.unexpected,
        missingWebviewActions: actionDiff.missing,
        unexpectedWebviewActions: actionDiff.unexpected,
        missingShortcuts: shortcutDiff.missing,
        unexpectedShortcuts: shortcutDiff.unexpected,
    };
}

function hasFailures(report) {
    return Object.values(report).some((values) => Array.isArray(values) && values.length > 0);
}

function printReport(report) {
    const lines = [
        ['missingCommands', report.missingCommands],
        ['unexpectedCommands', report.unexpectedCommands],
        ['missingWebviewActions', report.missingWebviewActions],
        ['unexpectedWebviewActions', report.unexpectedWebviewActions],
        ['missingShortcuts', report.missingShortcuts],
        ['unexpectedShortcuts', report.unexpectedShortcuts],
    ];

    for (const [label, values] of lines) {
        if (values.length === 0) {
            continue;
        }
        console.error(`${label}:`);
        for (const value of values) {
            console.error(`  - ${value}`);
        }
    }
}

if (require.main === module) {
    const repoRoot = path.resolve(__dirname, '..');
    const report = verifyGuiTriggerability(repoRoot);
    if (hasFailures(report)) {
        console.error('GUI triggerability audit failed:\n');
        printReport(report);
        process.exit(1);
    }
    console.log('gui triggerability audit: OK');
}

module.exports = {
    verifyGuiTriggerability,
};
