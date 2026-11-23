/**
 * The folders' import rules (figure-design.md 第 8 節, rules B, C and F of 第 2 節) as eslint.config.mjs says
 * them: each new folder imports only what its row allows, the Figure's drawn points never leave src/webview/figure/,
 * and canvas and pointer code is the Figure's alone. Each rule is proved to fire on a snippet linted as if it were a
 * file of that folder, and to let the allowed imports through (the real files pass `npm run lint`).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

const repoRoot = path.resolve(__dirname, '..', '..');
// The snippets are not files of the project, so they are linted without type information (the import rules need none).
const eslint = new ESLint({ cwd: repoRoot, overrideConfig: [tseslint.configs.disableTypeChecked] });

async function messages(file: string, code: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
    // One entry per refused line and rule (an import two patterns refuse is one refusal).
    return [...new Set(result.messages.filter(message => message.ruleId === '@typescript-eslint/no-restricted-imports' || message.ruleId === 'no-restricted-syntax').map(message => `${message.line}:${message.ruleId}`))];
}

const OLD_IMPORTS = [
    "import { createStageSource } from '../runtime/stageSource';",
    "import { attachPlotInteraction } from '../runtime/plotInteraction';",
    "import { countedSet } from '../runtime/figureModel';",
    "import { stageSpec } from '../runtime/trackStageMode';",
];

test('figure/ and answers/ cannot import runtime/ (the screens\' own code)', async () => {
    for (const folder of ['src/webview/figure/probe.ts', 'src/webview/answers/probe.ts']) {
        for (const line of OLD_IMPORTS) {
            assert.deepEqual(await messages(folder, `${line}\nexport const used = 1;\n`), ['1:@typescript-eslint/no-restricted-imports'], `${folder}: ${line}`);
        }
    }
});

test('each new folder imports only its row of 第 8 節', async () => {
    const cases: Array<[string, string, boolean]> = [
        ['src/webview/figure/probe.ts', "import { figureKey } from '../answers/figureKeys';", true],
        ['src/webview/figure/probe.ts', "import { withMinus } from '../shell/numberText';", true],
        ['src/webview/figure/probe.ts', "import { compareOverlay } from '../charts/compareOverlay';", false],
        ['src/webview/figure/probe.ts', "import { store } from '../state/store';", false],
        ['src/webview/answers/probe.ts', "import type { FigureSpec } from '../../shared/protocol/generated/backendProtocolSchema';", true],
        ['src/webview/answers/probe.ts', "import { createFigure } from '../figure/figure';", false],
        ['src/webview/answers/probe.ts', "import { withMinus } from '../shell/numberText';", false],
        ['src/webview/charts/probe.ts', "import type { FigureSpec } from '../figure';", true],
        ['src/webview/charts/probe.ts', "import { createFigure } from '../figure';", false],
        ['src/webview/charts/probe.ts', "import type { Picture } from '../figure/figure';", false],
        ['src/webview/charts/probe.ts', "import { figureKey } from '../answers/figureKeys';", false],
        ['src/webview/screens/probe.ts', "import { createFigure } from '../figure';", true],
        ['src/webview/screens/probe.ts', "import { createFigure } from '../figure/figure';", false],
        ['src/webview/screens/probe.ts', "import { createFigureAnswers } from '../answers/figureRequests';", true],
        ['src/webview/screens/probe.ts', "import { stageSpec } from '../runtime/trackStageMode';", false],
        ['src/webview/state/probe.ts', "import { withMinus } from '../shell/numberText';", false],
        ['src/webview/shell/probe.ts', "import { createFigure } from '../figure';", false],
        ['src/webview/shell/probe.ts', "import { niceTicks } from './ticks';", true],
    ];
    for (const [file, line, allowed] of cases) {
        assert.deepEqual(await messages(file, `${line}\nexport const used = 1;\n`), allowed ? [] : ['1:@typescript-eslint/no-restricted-imports'], `${file}: ${line} should be ${allowed ? 'allowed' : 'refused'}`);
    }
});

test('the Figure\'s drawn points are not exported outside figure/: neither its type nor the protocol\'s FigureDrawn', async () => {
    for (const file of ['src/webview/runtime/probe.ts', 'src/webview/screens/probe.ts', 'src/shared/probe.ts']) {
        assert.deepEqual(await messages(file, "import type { DrawnLine } from '../figure/picturePoints';\nexport const used = 1;\n"), ['1:@typescript-eslint/no-restricted-imports'], `${file}: figure/picturePoints`);
    }
    assert.deepEqual(await messages('src/webview/runtime/probe.ts', "import type { FigureDrawn } from '../../shared/protocol/generated/backendProtocolSchema';\nexport const used = 1;\n"), ['1:@typescript-eslint/no-restricted-imports']);
    assert.deepEqual(await messages('src/webview/screens/probe.ts', "import type { FigureDrawn } from '../answers/protocol';\nexport const used = 1;\n"), ['1:@typescript-eslint/no-restricted-imports']);
    assert.deepEqual(await messages('src/webview/figure/probe.ts', "import type { DrawnLine } from './picturePoints';\nimport type { FigureDrawn } from '../answers/protocol';\nexport const used = 1;\n"), [], 'inside figure/ they are the Figure\'s own');
    // Old code may use what moved into figure/ (the arbitration, the transform, the ticks).
    assert.deepEqual(await messages('src/webview/runtime/probe.ts', "import { pagePresses } from '../figure/pressArbiter';\nexport const used = 1;\n"), []);
});

test('canvas and pointer code is the Figure\'s alone (rule C): the new folders other than figure/ may not draw or take the pointer', async () => {
    const canvas = 'export const draw = (canvas: HTMLCanvasElement): unknown => canvas.getContext(\'2d\');\n';
    const pointer = 'export const take = (element: HTMLElement): void => { element.addEventListener(\'pointerdown\', () => undefined); };\n';
    const keys = 'export const take = (element: HTMLElement): void => { element.addEventListener(\'keydown\', () => undefined); };\n';
    for (const folder of ['answers', 'charts', 'screens', 'state', 'shell']) {
        for (const code of [canvas, pointer, keys]) assert.deepEqual(await messages(`src/webview/${folder}/probe.ts`, code), ['1:no-restricted-syntax'], `${folder}: ${code}`);
    }
    for (const code of [canvas, pointer, keys]) assert.deepEqual(await messages('src/webview/figure/probe.ts', code), [], 'the Figure draws and takes the pointer');
});
