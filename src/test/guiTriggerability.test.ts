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
    }>;
}

interface GuiTriggerabilityAuditModule {
    verifyGuiTriggerability(repoRoot: string): {
        missingCommands: string[];
        unexpectedCommands: string[];
        missingWebviewActions: string[];
        unexpectedWebviewActions: string[];
        missingShortcuts: string[];
        unexpectedShortcuts: string[];
    };
}

test('GUI triggerability inventory lists in-scope commands and excludes debug-only command', () => {
    const inventory = require('../shared/gui/guiTriggerabilityInventory') as GuiFeatureInventoryModule;

    assert.deepEqual(inventory.GUI_TRIGGERABILITY_SCOPED_COMMAND_IDS, [
        'audioWandasAnalyzer.analyzeFile',
        'audioWandasAnalyzer.analyzeThisTarget',
        'audioWandasAnalyzer.selectPythonEnvironment',
        'audioWandasAnalyzer.runRecipe',
    ]);
    assert.deepEqual(inventory.GUI_TRIGGERABILITY_EXCLUDED_COMMAND_IDS, [
        'audioWandasAnalyzer.analyzeDebugFile',
    ]);
    assert.ok(inventory.GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS.includes('selection-select-all'));
    assert.ok(inventory.GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS.includes('content-spectrogram'));
    assert.ok(inventory.GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS.includes('toggle-playback'));
    assert.ok(inventory.GUI_TRIGGERABILITY_SCOPED_SHORTCUTS.includes('?'));
    assert.ok(inventory.GUI_TRIGGERABILITY_SCOPED_SHORTCUTS.includes('Esc'));
    assert.ok(inventory.GUI_TRIGGERABILITY_FEATURES.some((feature) => feature.id === 'welcome-open-target'));
    assert.ok(inventory.GUI_TRIGGERABILITY_FEATURES.some((feature) => feature.id === 'export-report'));
});

test('GUI triggerability audit stays aligned with commands, webview actions, and shortcuts', () => {
    const audit = require('../../scripts/verify-gui-triggerability.js') as GuiTriggerabilityAuditModule;
    const report = audit.verifyGuiTriggerability(process.cwd());

    assert.deepEqual(report, {
        missingCommands: [],
        unexpectedCommands: [],
        missingWebviewActions: [],
        unexpectedWebviewActions: [],
        missingShortcuts: [],
        unexpectedShortcuts: [],
    });
});
