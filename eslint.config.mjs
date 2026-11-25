// Type-aware lint for src/ (TypeScript) and scripts/ (plain Node, no type info): `npm run lint`, run by verify.
// Formatting is not ESLint's job here: .editorconfig covers whitespace, and no stylistic rules are enabled.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SHARED_RULES = {
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
};

/** An import a folder may not make: anything but the specifiers its row of 第 8 節 allows (`allowed`, regexes). */
const only = (allowed, message, options = {}) => ({ regex: `^(?!(?:${allowed.join('|')}))`, message, ...options });
const LAYER_MESSAGE = 'docs/figure-design.md 第 8 節: this folder imports only';
/** The new path's own drawn points (rule B): their type never leaves src/webview/figure/. */
const DRAWN_POINTS = { regex: '(?:^|/)figure/picturePoints$', message: 'docs/figure-design.md 第 2 節 B: the drawn points of the Figure (figure/picturePoints.ts) are its own; nothing outside src/webview/figure/ imports them.' };
const FIGURE_DRAWN = {
    regex: '(?:protocol/generated/backendProtocolSchema|protocol/backendProtocol|answers/protocol)$', importNames: ['FigureDrawn'],
    message: 'docs/figure-design.md 第 2 節 B: a figure picture\'s drawn point (FigureDrawn) is drawn by src/webview/figure/ alone.',
};
/** Rule C: canvas and pointer code are the Figure's only (src/webview/figure/). Checked in the new folders. */
const NO_CANVAS_OR_POINTER = [
    { selector: "CallExpression[callee.property.name='getContext']", message: 'docs/figure-design.md 第 2 節 C: only src/webview/figure/ draws on a canvas.' },
    {
        selector: "CallExpression[callee.property.name='addEventListener'][arguments.0.value=/^(?:pointer|mouse|touch|gesture|wheel|click|dblclick|contextmenu|drag|drop|key)/]",
        message: 'docs/figure-design.md 第 2 節 C: only src/webview/figure/ takes the pointer and the keys of a figure.',
    },
];
/** A folder's refused imports; outside figure/ the Figure's drawn points are refused too (flat config replaces a rule's options). */
const restricted = (patterns, inFigure = false) => ({ '@typescript-eslint/no-restricted-imports': ['error', { patterns: inFigure ? patterns : [...patterns, DRAWN_POINTS, FIGURE_DRAWN] }] });
const LAYER_RULES = [
    {
        // Everything outside the Figure: its drawn points are not reachable.
        files: ['src/**/*.ts'],
        ignores: ['src/webview/figure/**', 'src/webview/answers/protocol.ts'],
        rules: restricted([]),
    },
    {
        files: ['src/webview/figure/**/*.ts'],
        rules: restricted([only(['\\./', '\\.\\./answers/', '\\.\\./shell/', '\\.\\./\\.\\./shared/utils/(?:ticks|graphemes)$'], `${LAYER_MESSAGE} answers/, shell/ and src/shared's tick values and characters as seen (never runtime/, the screens' own code).`)], true),
    },
    {
        files: ['src/webview/answers/**/*.ts'],
        rules: {
            ...restricted([only(['\\./', '\\.\\./\\.\\./shared/protocol/(?:backendProtocol|figureMessages|generated/backendProtocolSchema)$'], `${LAYER_MESSAGE} the protocol's types.`)]),
            'no-restricted-syntax': ['error', ...NO_CANVAS_OR_POINTER],
        },
    },
    {
        // answers/ hands the protocol's types to the Figure, its drawn point among them (the Figure alone draws it).
        files: ['src/webview/answers/protocol.ts'],
        rules: restricted([only(['\\./', '\\.\\./\\.\\./shared/protocol/generated/backendProtocolSchema$'], `${LAYER_MESSAGE} the protocol's types.`)], true),
    },
    {
        // The tests' stand-in for the figure service makes a picture's drawn points, as the service does.
        files: ['src/test/helpers/figureStandIn.ts'],
        rules: restricted([], true),
    },
    {
        files: ['src/webview/charts/**/*.ts'],
        rules: {
            ...restricted([
                only(['\\./', '\\.\\./figure(?:/index)?$', '\\.\\./state/'], `${LAYER_MESSAGE} the figure spec's types and the state's types.`),
                // The allowed ones, for types only: a pattern that allows a type import lets it past every pattern.
                { regex: '^\\.\\./(?:figure(?:/index)?$|state/)', allowTypeImports: true, message: `${LAYER_MESSAGE} types (a chart is data: its spec).` },
            ]),
            'no-restricted-syntax': ['error', ...NO_CANVAS_OR_POINTER],
        },
    },
    {
        files: ['src/webview/screens/**/*.ts'],
        rules: {
            ...restricted([only(['\\./', '\\.\\./charts/', '\\.\\./figure(?:/index)?$', '\\.\\./answers/', '\\.\\./state/', '\\.\\./shell/'], `${LAYER_MESSAGE} charts/, figure/ (its index: making a Figure and its signals), answers/, state/ and shell/.`)]),
            'no-restricted-syntax': ['error', ...NO_CANVAS_OR_POINTER],
        },
    },
    {
        files: ['src/webview/state/**/*.ts'],
        rules: { ...restricted([only(['\\./'], `${LAYER_MESSAGE} itself.`)]), 'no-restricted-syntax': ['error', ...NO_CANVAS_OR_POINTER] },
    },
    {
        files: ['src/webview/shell/**/*.ts'],
        rules: { ...restricted([only(['\\./'], `${LAYER_MESSAGE} itself.`)]), 'no-restricted-syntax': ['error', ...NO_CANVAS_OR_POINTER] },
    },
    {
        // Not a figure's pointer: the axis range popover's own buttons and the press outside it that closes it, and
        // the one window key listener every key context goes through (src/test/plotGestures.test.ts lists both).
        files: ['src/webview/shell/rangePopover.ts', 'src/webview/shell/keyRouter.ts'],
        rules: { 'no-restricted-syntax': 'off' },
    },
];

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
    // ── The layers' folders (docs/figure-design.md 第 8 節, rules C and F of 第 2 節) ─────────────────
    // Each folder of the table may import only the folders its row names; everything else (runtime/, the screens'
    // own code not yet split into the folders) is refused. Whitelists, so a new module there is refused
    // too. src/test/figureImportRules.test.ts proves each fires.
    ...LAYER_RULES,
    {
        // Written by scripts/generate-protocol-types.mjs: an empty result schema becomes an empty interface.
        files: ['src/shared/protocol/generated/**/*.ts'],
        rules: { '@typescript-eslint/no-empty-object-type': 'off' },
    },
    {
        // Tests build partial fixtures with `as any` (fake vscode APIs, jsdom windows, stub backends);
        // the no-unsafe-* family would only flag those fixtures, so it is relaxed here and nowhere else.
        // A test's `!` fails the test loudly when its assumption breaks, which is what a test wants.
        files: ['src/test/**/*.ts', 'src/e2e/**/*.ts'],
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
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
