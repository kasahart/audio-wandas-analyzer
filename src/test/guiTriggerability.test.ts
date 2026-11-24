import assert from 'node:assert/strict';
import test from 'node:test';

interface GuiFeatureInventoryModule {
    GUI_TRIGGERABILITY_EXCLUDED_COMMAND_IDS: readonly string[];
    GUI_TRIGGERABILITY_SCOPED_COMMAND_IDS: readonly string[];
    GUI_TRIGGERABILITY_SCOPED_SHORTCUTS: readonly string[];
    GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS: readonly string[];
    GUI_TRIGGERABILITY_FEATURES: ReadonlyArray<{
        id: string;
        label: string;
        triggers: readonly string[];
        regressionLayers: readonly string[];
        coverageDebt?: {
            issue: string;
            reason: string;
        };
    }>;
}

interface GuiTriggerabilityAuditModule {
    FIXES: Record<string, string>;
    collectWebviewActionIdsFromSource(source: string): string[];
    verifyGuiTriggerability(repoRoot: string): {
        missingCommands: string[];
        unexpectedCommands: string[];
        missingWebviewActions: string[];
        unexpectedWebviewActions: string[];
        missingShortcuts: string[];
        unexpectedShortcuts: string[];
        orphanScopedCommands: string[];
        orphanWebviewActions: string[];
        orphanScopedShortcuts: string[];
        unknownFeatureTriggers: string[];
        featuresWithoutRegressionCoverage: string[];
        invalidRegressionLayers: string[];
        invalidCoverageDebt: string[];
    };
}

test('GUI triggerability collector distinguishes controls from selector guards', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audit = require('../../scripts/verify-gui-triggerability.js') as GuiTriggerabilityAuditModule;
    const source = `
        root.querySelector('[data-action="guard-only"]');
        button.setAttribute('data-action', 'assigned-action');
        const html = '<button data-action="literal-action">Run</button>';
    `;

    assert.deepEqual(audit.collectWebviewActionIdsFromSource(source), [
        'assigned-action',
        'literal-action',
    ]);
});

test('GUI triggerability inventory lists in-scope commands and excludes debug-only command', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const inventory = require('../shared/gui/guiTriggerabilityInventory') as GuiFeatureInventoryModule;

    assert.deepEqual(inventory.GUI_TRIGGERABILITY_SCOPED_COMMAND_IDS, [
        'audioWandasAnalyzer.analyzeFile',
        'audioWandasAnalyzer.analyzeThisTarget',
        'audioWandasAnalyzer.selectPythonEnvironment',
        'audioWandasAnalyzer.configureCalibration',
    ]);
    assert.deepEqual(inventory.GUI_TRIGGERABILITY_EXCLUDED_COMMAND_IDS, [
        'audioWandasAnalyzer.analyzeDebugFile',
    ]);
    assert.ok(inventory.GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS.includes('entry-row-slot'));
    assert.ok(inventory.GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS.includes('track-split-drag'));
    assert.ok(inventory.GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS.includes('toggle-playback'));
    assert.ok(inventory.GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS.includes('configure-calibration'));
    assert.ok(inventory.GUI_TRIGGERABILITY_SCOPED_SHORTCUTS.includes('? / F1'));
    assert.ok(inventory.GUI_TRIGGERABILITY_SCOPED_SHORTCUTS.includes('Esc'));
    assert.ok(inventory.GUI_TRIGGERABILITY_FEATURES.some((feature) => feature.id === 'welcome-open-target'));
    assert.ok(inventory.GUI_TRIGGERABILITY_FEATURES.some((feature) => feature.id === 'export-report'));
    assert.ok(inventory.GUI_TRIGGERABILITY_FEATURES.some((feature) => feature.id === 'calibration'));
});

test('GUI triggerability inventory has no planned regression layer or uncovered feature', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const inventory = require('../shared/gui/guiTriggerabilityInventory') as GuiFeatureInventoryModule;
    const allLayers = inventory.GUI_TRIGGERABILITY_FEATURES.flatMap((feature) => feature.regressionLayers);

    assert.ok(!allLayers.includes('planned'));
    assert.deepEqual(
        inventory.GUI_TRIGGERABILITY_FEATURES
            .filter((feature) => feature.regressionLayers.length === 0 && !feature.coverageDebt)
            .map((feature) => feature.id),
        []
    );
});

test('GUI triggerability coverage debt references issue IDs in the accepted formats', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const inventory = require('../shared/gui/guiTriggerabilityInventory') as GuiFeatureInventoryModule;
    const issuePattern = /^(#\d+|https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/\d+)$/u;

    for (const feature of inventory.GUI_TRIGGERABILITY_FEATURES) {
        if (!feature.coverageDebt) {
            continue;
        }
        assert.match(feature.coverageDebt.issue, issuePattern, feature.id);
        assert.ok(feature.coverageDebt.reason.trim().length > 0, feature.id);
    }
});

test('GUI triggerability audit stays aligned with commands, webview actions, and shortcuts', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audit = require('../../scripts/verify-gui-triggerability.js') as GuiTriggerabilityAuditModule;
    const report = audit.verifyGuiTriggerability(process.cwd());
    const fixes = Object.entries(report).filter(([, values]) => values.length > 0).map(([label]) => `${label}: ${audit.FIXES[label]}`);

    assert.deepEqual(report, {
        missingCommands: [],
        unexpectedCommands: [],
        missingWebviewActions: [],
        unexpectedWebviewActions: [],
        missingShortcuts: [],
        unexpectedShortcuts: [],
        orphanScopedCommands: [],
        orphanWebviewActions: [],
        orphanScopedShortcuts: [],
        unknownFeatureTriggers: [],
        featuresWithoutRegressionCoverage: [],
        invalidRegressionLayers: [],
        invalidCoverageDebt: [],
    }, `Rule: every user-facing GUI feature has a reachable entry point, visible feedback and a real regression layer (AGENTS.md §6).\n${fixes.join('\n')}`);
});

test('every kind of finding of the GUI triggerability audit says how to fix it', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audit = require('../../scripts/verify-gui-triggerability.js') as GuiTriggerabilityAuditModule;
    const kinds = Object.keys(audit.verifyGuiTriggerability(process.cwd())).sort();
    assert.deepEqual(Object.keys(audit.FIXES).sort(), kinds, 'Fix: give the new kind of finding its line in FIXES in scripts/verify-gui-triggerability.js (what it means and what to change).');
    for (const [kind, fix] of Object.entries(audit.FIXES)) assert.match(fix, /Fix: /, kind);
});
