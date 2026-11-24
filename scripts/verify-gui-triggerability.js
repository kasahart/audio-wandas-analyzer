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

function collectWebviewActionIdsFromSource(source) {
    const literalActions = Array.from(
        source.matchAll(/(?<!\[)data-action="([^"]+)"/gu),
        (match) => match[1],
    );
    const assignedActions = Array.from(
        source.matchAll(/\.setAttribute\(\s*['"]data-action['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gu),
        (match) => match[1],
    );
    return sortUnique([...literalActions, ...assignedActions]);
}

function webviewSourcePaths(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { return webviewSourcePaths(full); }
        return entry.name.endsWith('.ts') ? [full] : [];
    }).sort();
}

function collectWebviewActionIds(repoRoot) {
    const source = webviewSourcePaths(path.join(repoRoot, 'src', 'webview'))
        .map((sourcePath) => fs.readFileSync(sourcePath, 'utf8'))
        .join('\n');
    return collectWebviewActionIdsFromSource(source);
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
const EXTRA_INVENTORY_TRIGGERS = ['analyze-selected-files', 'welcome-drop-target', 'browser-drop-wav', 'waveform-axis-dblclick', 'spectrogram-axis-dblclick', 'python-missing-open-browser'];

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

const INVENTORY = 'src/shared/gui/guiTriggerabilityInventory.ts';
/** What each kind of finding means and how to fix it (AGENTS.md §6, "GUI triggerability audit boundary"). */
const FIXES = {
    missingCommands: `in the inventory but not contributed by package.json. Fix: remove it from ${INVENTORY} (its id list and the triggers of the feature that names it), or contribute the command.`,
    unexpectedCommands: `contributed by package.json but not in the inventory. Fix: add it to GUI_TRIGGERABILITY_SCOPED_COMMAND_IDS (user-facing) or GUI_TRIGGERABILITY_EXCLUDED_COMMAND_IDS (debug only) in ${INVENTORY}.`,
    missingWebviewActions: `in the inventory but no data-action under src/webview/ has it. Fix: remove it from GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS and from the triggers of the feature that names it in ${INVENTORY}.`,
    unexpectedWebviewActions: `a data-action under src/webview/ that the inventory does not list. Fix: add it to GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS and to a feature in ${INVENTORY}.`,
    missingShortcuts: `in the inventory but not a row of src/webview/runtime/shortcuts.ts. Fix: remove it from GUI_TRIGGERABILITY_SCOPED_SHORTCUTS and from the triggers of the feature that names it in ${INVENTORY}.`,
    unexpectedShortcuts: `a shortcut row of src/webview/runtime/shortcuts.ts that the inventory does not list. Fix: add it to GUI_TRIGGERABILITY_SCOPED_SHORTCUTS and to a feature in ${INVENTORY}.`,
    orphanScopedCommands: `a user-facing command no feature names. Fix: add it to the triggers of a feature in GUI_TRIGGERABILITY_FEATURES (${INVENTORY}).`,
    orphanWebviewActions: `a data-action no feature names. Fix: add it to the triggers of a feature in GUI_TRIGGERABILITY_FEATURES (${INVENTORY}).`,
    orphanScopedShortcuts: `a shortcut no feature names. Fix: add it to the triggers of a feature in GUI_TRIGGERABILITY_FEATURES (${INVENTORY}).`,
    unknownFeatureTriggers: `a feature names a trigger that is not a known command, data-action or shortcut. Fix: correct the trigger's id in ${INVENTORY}.`,
    featuresWithoutRegressionCoverage: `a feature with no real regression layer. Fix: give it regressionLayers (node:test, ui-smoke or vscode-e2e) with the test that reaches it, or coverageDebt { issue: '#123', reason } while one is written (${INVENTORY}).`,
    invalidRegressionLayers: `a regression layer that is not node:test, ui-smoke or vscode-e2e ('planned' is not a layer). Fix: name the real layer, or use coverageDebt { issue, reason } (${INVENTORY}).`,
    invalidCoverageDebt: `coverageDebt without an issue ('#123' or an issue URL) or a reason. Fix: give both (${INVENTORY}).`,
};

function printReport(report) {
    for (const [label, fix] of Object.entries(FIXES)) {
        const values = report[label];
        if (!values || values.length === 0) {
            continue;
        }
        console.error(`${label}: ${fix}`);
        for (const value of values) {
            console.error(`  - ${value}`);
        }
    }
    console.error('\nRule: every user-facing GUI feature has a reachable entry point, visible feedback and a real regression layer (AGENTS.md §6).');
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
    FIXES,
    collectWebviewActionIdsFromSource,
    verifyGuiTriggerability,
};
