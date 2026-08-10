import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** vscode モジュールをスタブ化してから ComparisonPanel をロードするヘルパー。 */

type ComparisonPanelModule = {
    renderComparisonHtml(
        webview: { asWebviewUri: (_uri: unknown) => { toString(): string }; cspSource: string },
        state: unknown,
        extensionUri: { fsPath: string; toString(): string },
    ): string;
    renderComparisonStyles(): string;
};

let cachedModule: ComparisonPanelModule | undefined;

/**
 * ComparisonPanel を vscode スタブ環境下で読み込む。
 * モジュールキャッシュが有効なので 2 回目以降は即座に返る。
 */
function loadComparisonPanelModule(): ComparisonPanelModule {
    if (cachedModule) {
        return cachedModule;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module');
    const originalLoad = NodeModule._load;

    try {
        // vscode をスタブに差し替える一時フック
        NodeModule._load = function (id: string, ...rest: unknown[]) {
            if (id === 'vscode') {
                return {
                    window: {},
                    ViewColumn: { One: 1, Active: 1, Beside: 2 },
                    Uri: {
                        joinPath: (base: { fsPath?: string }, ...parts: string[]) => ({
                            fsPath: join(base.fsPath ?? '', ...parts),
                        }),
                    },
                    workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
                };
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return originalLoad.call(this, id, ...rest);
        };

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        cachedModule = require('../../webview/panels/ComparisonPanel') as ComparisonPanelModule;
        return cachedModule;
    } finally {
        // 必ず元に戻す
        NodeModule._load = originalLoad;
    }
}

/** build-webview が生成した通常の TypeScript entry bundle を取得する。 */
export function getRenderScript(): string {
    return readFileSync(join(__dirname, '..', '..', 'webview', 'comparisonRuntime.js'), 'utf8');
}

/** ComparisonPanel.renderStyles() が返す CSS 文字列を取得する */
export function getRenderStyles(): string {
    return loadComparisonPanelModule().renderComparisonStyles();
}

/** ComparisonPanel.renderHtml() 相当の HTML をテスト用スタブ Webview で生成する */
export function getRenderHtml(state: unknown): string {
    return loadComparisonPanelModule().renderComparisonHtml(
        {
            asWebviewUri: (uri: unknown) => ({
                toString: () => (uri as { fsPath?: string }).fsPath?.endsWith('comparisonRuntime.js')
                    ? '__COMPARISON_RUNTIME__'
                    : '__WAVEFORM_PIPELINE__',
            }),
            cspSource: 'data:',
        },
        state,
        {
            fsPath: '/ext',
            toString: () => '/ext',
        },
    );
}
