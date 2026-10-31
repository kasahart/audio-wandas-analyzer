// Type-aware lint for src/ (TypeScript) and scripts/ (plain Node, no type info): `npm run lint`, run by verify.
// Formatting is not ESLint's job here: .editorconfig covers whitespace, and no stylistic rules are enabled.
import { existsSync } from 'node:fs';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Burn-down list for @typescript-eslint/no-non-null-assertion, which is an error everywhere else.
// A file leaves this list once its `!` assertions are gone; none may be added. Kept alphabetised.
const NON_NULL_ASSERTION_BURN_DOWN = [
    'src/e2e/suite/index.ts',
    'src/extension/index.ts',
    'src/extension/pythonBackendServer.ts',
    'src/shared/analysis/entryMetadata.ts',
    'src/shared/analysis/entryScan.ts',
    'src/shared/dataset/datasetTable.ts',
    'src/shared/protocol/backendProtocol.ts',
    'src/shared/protocol/schemaValidation.ts',
    'src/shared/recipe/channelSelection.ts',
    'src/shared/recipe/recipeSteps.ts',
    'src/test/analysisBridge.test.ts',
    'src/test/analysisReport.test.ts',
    'src/test/audioFade.test.ts',
    'src/test/batchBundle.test.ts',
    'src/test/benchReport.test.ts',
    'src/test/calibrationContracts.test.ts',
    'src/test/canvasDrawers.test.ts',
    'src/test/channelSelection.test.ts',
    'src/test/chartSpecRangeControl.test.ts',
    'src/test/comparePanes.test.ts',
    'src/test/comparisonRuntimeModules.test.ts',
    'src/test/cursorSpectrum.test.ts',
    'src/test/datasetTable.test.ts',
    'src/test/entryMetadata.test.ts',
    'src/test/entryScan.test.ts',
    'src/test/entryTable.test.ts',
    'src/test/exportDownloads.test.ts',
    'src/test/exportFlows.test.ts',
    'src/test/globalKeyboardEvents.test.ts',
    'src/test/guiCore.test.ts',
    'src/test/hintFooter.test.ts',
    'src/test/pairSpectrum.test.ts',
    'src/test/panelControllerPathTrust.test.ts',
    'src/test/panelControllerSelection.test.ts',
    'src/test/pythonBackendServer.test.ts',
    'src/test/pythonEnvironment.test.ts',
    'src/test/reanalyzeOverlay.test.ts',
    'src/test/recipeCatalog.test.ts',
    'src/test/recipeFlow.test.ts',
    'src/test/recipeSteps.test.ts',
    'src/test/renderScript.integration.test.ts',
    'src/test/saveRecipe.test.ts',
    'src/test/selectionLayoutHtml.test.ts',
    'src/test/sharedFormat.test.ts',
    'src/test/spectrogramSettingsPopover.test.ts',
    'src/test/spectrumSnap.test.ts',
    'src/test/stagePanes.test.ts',
    'src/test/staticHost.test.ts',
    'src/test/toolbarEvents.test.ts',
    'src/test/trackLaneActions.test.ts',
    'src/test/trackReorderDrag.test.ts',
    'src/test/uiSmoke/allButtons.spec.ts',
    'src/test/uiSmoke/analysisWindow.spec.ts',
    'src/test/uiSmoke/batch.spec.ts',
    'src/test/uiSmoke/chips.spec.ts',
    'src/test/uiSmoke/distribution.spec.ts',
    'src/test/uiSmoke/entry.spec.ts',
    'src/test/uiSmoke/entryHelpers.ts',
    'src/test/uiSmoke/keyboard.spec.ts',
    'src/test/uiSmoke/laneCulling.spec.ts',
    'src/test/uiSmoke/linkScales.spec.ts',
    'src/test/uiSmoke/pairSpectrum.spec.ts',
    'src/test/uiSmoke/panelCollapse.spec.ts',
    'src/test/uiSmoke/playbackCursor.spec.ts',
    'src/test/uiSmoke/roleChips.spec.ts',
    'src/test/uiSmoke/scale100k.spec.ts',
    'src/test/uiSmoke/session.spec.ts',
    'src/test/uiSmoke/spectrumDock.spec.ts',
    'src/test/uiSmoke/spectrumOverlayDblclick.spec.ts',
    'src/test/uiSmoke/stageReturn.spec.ts',
    'src/test/uiSmoke/toolbar.spec.ts',
    'src/test/uiSmoke/trackCompare.spec.ts',
    'src/test/uiSmoke/trackIdentity.spec.ts',
    'src/test/uiSmoke/trackStage.spec.ts',
    'src/test/uiSmoke/trackSwipe.spec.ts',
    'src/test/webviewTestEnv.test.ts',
    'src/webview/plot/waveformLayer.ts',
    'src/webview/rangePopover.ts',
    'src/webview/runtime/browserAdapter.ts',
    'src/webview/runtime/calibrationDecorations.ts',
    'src/webview/runtime/chartSpecRuntime.ts',
    'src/webview/runtime/comparePanes.ts',
    'src/webview/runtime/compareReport.ts',
    'src/webview/runtime/entryPlots.ts',
    'src/webview/runtime/entryRuntime.ts',
    'src/webview/runtime/entryTable.ts',
    'src/webview/runtime/entryTableHtml.ts',
    'src/webview/runtime/pairSpectrumPanel.ts',
    'src/webview/runtime/separatorKeys.ts',
    'src/webview/runtime/spectrogramSettingsPopover.ts',
    'src/webview/runtime/stagePanes.ts',
    'src/webview/runtime/stageSource.ts',
    'src/webview/runtime/staticHost.ts',
    'src/webview/runtime/stepBar.ts',
    'src/webview/runtime/toolbarEvents.ts',
    'src/webview/runtime/trackStageMode.ts',
];
NON_NULL_ASSERTION_BURN_DOWN.forEach((file, index, list) => {
    if (!existsSync(new URL(file, import.meta.url))) throw new Error(`eslint.config.mjs: burn-down entry ${file} does not exist`);
    if (index > 0 && list[index - 1] >= file) throw new Error(`eslint.config.mjs: burn-down list is not alphabetised at ${file}`);
});

const SHARED_RULES = {
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
};

export default tseslint.config(
    { ignores: ['dist/**', 'node_modules/**', '.venv/**', '.vscode-test/**', '.worktrees/**', '.claude/**'] },
    { linterOptions: { reportUnusedDisableDirectives: 'error' } },
    {
        files: ['src/**/*.ts'],
        extends: [tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            ...SHARED_RULES,
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/no-floating-promises': ['error', {
                // node:test's test()/describe() return promises the runner itself awaits.
                allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'it', 'describe', 'suite'] }],
            }],
            // A `default:` is a deliberate catch-all; the check still catches a switch over a union that has none.
            '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
            // `_`-prefixed names are the repo's way to say "unused on purpose" (stub parameters, omitted keys).
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                destructuredArrayIgnorePattern: '^_',
                ignoreRestSiblings: true,
            }],
            '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
            // Async stubs of Promise-returning interfaces are the norm here, and `async () => { throw … }` is how
            // they reject; dropping `async` would turn those rejections into synchronous throws.
            '@typescript-eslint/require-await': 'off',
        },
    },
    {
        files: NON_NULL_ASSERTION_BURN_DOWN,
        rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
    {
        // Written by scripts/generate-protocol-types.mjs: an empty result schema becomes an empty interface.
        files: ['src/shared/protocol/generated/**/*.ts'],
        rules: { '@typescript-eslint/no-empty-object-type': 'off' },
    },
    {
        // Tests build partial fixtures with `as any` (fake vscode APIs, jsdom windows, stub backends);
        // the no-unsafe-* family would only flag those fixtures, so it is relaxed here and nowhere else.
        files: ['src/test/**/*.ts', 'src/e2e/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
        },
    },
    {
        files: ['scripts/**/*.js', 'scripts/**/*.mjs'],
        extends: [js.configs.recommended],
        languageOptions: { globals: globals.node },
        rules: SHARED_RULES,
    },
    {
        files: ['scripts/**/*.js'],
        languageOptions: { sourceType: 'commonjs' },
    },
    {
        // Playwright drivers: their page.evaluate() callbacks run in the browser.
        files: ['scripts/test-browser-*.js'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
);
