/**
 * vscode モジュールをスタブ化してから ComparisonPanel をロードし、
 * renderScript() の文字列を返すヘルパー。
 *
 * テストから直接 ComparisonPanel を import すると vscode が解決できないため、
 * このファイルが require() の前に Module._load を差し替える。
 */

type ComparisonPanelModule = {
    renderComparisonHtml(
        webview: { asWebviewUri: (_uri: unknown) => { toString(): string }; cspSource: string },
        state: unknown,
        extensionUri: { fsPath: string; toString(): string },
    ): string;
    renderComparisonScript(): string;
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
                    Uri: { joinPath: (..._args: unknown[]) => ({ fsPath: '' }) },
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

/** ComparisonPanel.renderScript() が返す JavaScript 文字列を取得する */
export function getRenderScript(): string {
    return loadComparisonPanelModule().renderComparisonScript();
}

/** ComparisonPanel.renderStyles() が返す CSS 文字列を取得する */
export function getRenderStyles(): string {
    return loadComparisonPanelModule().renderComparisonStyles();
}

/** ComparisonPanel.renderHtml() 相当の HTML をテスト用スタブ Webview で生成する */
export function getRenderHtml(state: unknown): string {
    return loadComparisonPanelModule().renderComparisonHtml(
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
