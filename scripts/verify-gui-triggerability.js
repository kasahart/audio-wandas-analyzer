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
    const sourcePaths = [
        path.join(repoRoot, 'src', 'webview', 'runtime', 'comparisonRuntime.ts'),
        path.join(repoRoot, 'src', 'webview', 'calibrationRenderScript.ts'),
    ];
    const source = sourcePaths.map((sourcePath) => fs.readFileSync(sourcePath, 'utf8')).join('\n');
    return sortUnique(Array.from(source.matchAll(/data-action="([^"]+)"/gu), (match) => match[1]));
}

function collectShortcutLabels(repoRoot) {
    const shortcutsModule = requireBuiltModule(repoRoot, path.join('dist', 'webview', 'runtime', 'shortcuts.js'));
    const shortcutRows = Array.isArray(shortcutsModule.SHORTCUT_ROWS) ? shortcutsModule.SHORTCUT_ROWS : [];
    return sortUnique(shortcutRows
        .map((row) => row?.shortcut)
        .filter((shortcut) => typeof shortcut === 'string'));
}

function loadInventory(repoRoot) {
    return requireBuiltModule(repoRoot, path.join('dist', 'shared', 'gui', 'guiTriggerabilityInventory.js'));
}

const ALLOWED_REGRESSION_LAYERS = ['node:test', 'ui-smoke', 'vscode-e2e'];
const COVERAGE_DEBT_ISSUE_PATTERN = /^(#\d+|https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/\d+)$/u;
const EXTRA_INVENTORY_TRIGGERS = ['analyze-selected-files', 'welcome-drop-target'];

function collectFeatureTriggers(features) {
    return sortUnique(features.flatMap((feature) => Array.isArray(feature.triggers) ? feature.triggers : []));
}

function collectInvalidRegressionLayers(features) {
    return features.flatMap((feature) => {
        const layers = Array.isArray(feature.regressionLayers) ? feature.regressionLayers : [];
        return layers
            .filter((layer) => !ALLOWED_REGRESSION_LAYERS.includes(layer))
            .map((layer) => feature.id + ': ' + layer);
    }).sort();
}

function collectFeaturesWithoutRegressionCoverage(features) {
    return features
        .filter((feature) => {
            const layers = Array.isArray(feature.regressionLayers) ? feature.regressionLayers : [];
            return layers.length === 0 && !feature.coverageDebt;
        })
        .map((feature) => feature.id)
        .sort();
}

function collectInvalidCoverageDebt(features) {
    return features
        .filter((feature) => feature.coverageDebt)
        .filter((feature) => {
            const debt = feature.coverageDebt;
            return typeof debt.issue !== 'string'
                || !COVERAGE_DEBT_ISSUE_PATTERN.test(debt.issue)
                || typeof debt.reason !== 'string'
                || debt.reason.trim().length === 0;
        })
        .map((feature) => feature.id)
        .sort();
}

function verifyGuiTriggerability(repoRoot) {
    const inventory = loadInventory(repoRoot);
    const scopedCommands = sortUnique(inventory.GUI_TRIGGERABILITY_SCOPED_COMMAND_IDS);
    const excludedCommands = sortUnique(inventory.GUI_TRIGGERABILITY_EXCLUDED_COMMAND_IDS);
    const knownCommands = sortUnique([
        ...scopedCommands,
        ...excludedCommands,
    ]);
    const knownWebviewActions = sortUnique(inventory.GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS);
    const knownShortcuts = sortUnique(inventory.GUI_TRIGGERABILITY_SCOPED_SHORTCUTS);
    const features = Array.isArray(inventory.GUI_TRIGGERABILITY_FEATURES)
        ? inventory.GUI_TRIGGERABILITY_FEATURES
        : [];
    const featureTriggers = collectFeatureTriggers(features);
    const knownFeatureTriggers = sortUnique([
        ...scopedCommands,
        ...knownWebviewActions,
        ...knownShortcuts,
        ...EXTRA_INVENTORY_TRIGGERS,
    ]);

    const commandDiff = diff(knownCommands, collectPackageCommands(repoRoot));
    const actionDiff = diff(knownWebviewActions, collectWebviewActionIds(repoRoot));
    const shortcutDiff = diff(knownShortcuts, collectShortcutLabels(repoRoot));
    const featureTriggerDiff = diff(knownFeatureTriggers, featureTriggers);

    return {
        missingCommands: commandDiff.missing,
        unexpectedCommands: commandDiff.unexpected,
        missingWebviewActions: actionDiff.missing,
        unexpectedWebviewActions: actionDiff.unexpected,
        missingShortcuts: shortcutDiff.missing,
        unexpectedShortcuts: shortcutDiff.unexpected,
        orphanScopedCommands: scopedCommands.filter((command) => !featureTriggers.includes(command)),
        orphanWebviewActions: knownWebviewActions.filter((action) => !featureTriggers.includes(action)),
        orphanScopedShortcuts: knownShortcuts.filter((shortcut) => !featureTriggers.includes(shortcut)),
        unknownFeatureTriggers: featureTriggerDiff.unexpected,
        featuresWithoutRegressionCoverage: collectFeaturesWithoutRegressionCoverage(features),
        invalidRegressionLayers: collectInvalidRegressionLayers(features),
        invalidCoverageDebt: collectInvalidCoverageDebt(features),
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
        ['orphanScopedCommands', report.orphanScopedCommands],
        ['orphanWebviewActions', report.orphanWebviewActions],
        ['orphanScopedShortcuts', report.orphanScopedShortcuts],
        ['unknownFeatureTriggers', report.unknownFeatureTriggers],
        ['featuresWithoutRegressionCoverage', report.featuresWithoutRegressionCoverage],
        ['invalidRegressionLayers', report.invalidRegressionLayers],
        ['invalidCoverageDebt', report.invalidCoverageDebt],
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
