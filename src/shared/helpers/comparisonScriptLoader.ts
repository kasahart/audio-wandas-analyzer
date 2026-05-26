/**
 * vscode モジュールをスタブ化してから ComparisonPanel をロードし、
 * renderScript() の文字列を返すヘルパー。
 *
 * テストから直接 ComparisonPanel を import すると vscode が解決できないため、
 * このファイルが require() の前に Module._load を差し替える。
 */

// Node.js の require フックで 'vscode' をスタブに差し替える
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeModule = require('node:module');
const originalLoad = NodeModule._load;
NodeModule._load = function (id: string, ...rest: unknown[]) {
    if (id === 'vscode') {
        return {
            window: {},
            ViewColumn: { One: 1, Active: 1, Beside: 2 },
            Uri: { joinPath: (..._args: unknown[]) => ({ fsPath: '' }) },
            workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
        };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return originalLoad.call(this, id, ...rest);
};

// vscode スタブが有効な状態で ComparisonPanel をロード
// (require は Module._load 差し替え後に実行されるので安全)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const comparisonPanelModule = require('../../webview/panels/ComparisonPanel') as {
    renderComparisonHtml(
        webview: { asWebviewUri: (_uri: unknown) => { toString(): string }; cspSource: string },
        state: unknown,
        extensionUri: { fsPath: string; toString(): string },
    ): string;
    renderComparisonScript(): string;
    renderComparisonStyles(): string;
};

/** ComparisonPanel.renderScript() が返す JavaScript 文字列を取得する */
export function getRenderScript(): string {
    return comparisonPanelModule.renderComparisonScript();
}

/** ComparisonPanel.renderStyles() が返す CSS 文字列を取得する */
export function getRenderStyles(): string {
    return comparisonPanelModule.renderComparisonStyles();
}

/** ComparisonPanel.renderHtml() 相当の HTML をテスト用スタブ Webview で生成する */
export function getRenderHtml(state: unknown): string {
    return comparisonPanelModule.renderComparisonHtml(
        {
            asWebviewUri: () => ({
                toString: () => '__WAVEFORM_PIPELINE__',
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
