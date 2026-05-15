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
const { ComparisonPanel } = require('../../webview/panels/ComparisonPanel');

/** ComparisonPanel.renderScript() が返す JavaScript 文字列を取得する */
export function getRenderScript(): string {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return (ComparisonPanel as { renderScript(): string }).renderScript();
}

/** ComparisonPanel.renderStyles() が返す CSS 文字列を取得する */
export function getRenderStyles(): string {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return (ComparisonPanel as { renderStyles(): string }).renderStyles();
}
