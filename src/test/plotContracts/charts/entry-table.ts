import { t, type ChartContract } from '../model';

/** 入口の表（CSV の列、ファイルの情報の列、見出しの数）。解析の値は無い：入口は録音を選ぶ所で、答えを作らない。 */
export const entryTable: ChartContract = {
    chart: {
        id: 'entry-table', name: '入口の表（CSV の列、ファイルの情報の列、見出しの数）',
        paintedBy: ['src/webview/runtime/entryTableHtml.ts:datasetRowsHtml'],
        requires: ['summary', 'count'],
    },
    rows: [
        {
            id: 'entry-table.cells', value: 'summary', what: '表の値の列（CSV の数の列）と、ファイルの情報の列（長さ、標本化周波数、校正）',
            computedIn: ['src/webview/runtime/entryTableHtml.ts:formatValue', 'src/webview/runtime/entryTableHtml.ts:datasetRowsHtml', 'src/webview/runtime/entryTableHtml.ts:infoCell', 'src/webview/runtime/entryRuntime.ts:rowInfo', 'src/webview/runtime/entryRuntime.ts:formatColumn'],
            from: 'input', trace: '利用者が選んだ CSV のセルと、ファイルのヘッダが言う長さ・標本化周波数・ホストが言う校正。読むだけで、計算しない（解析の値の列は無い）。',
            tests: [
                t('src/test/datasetTable.test.ts', 'rows are a recording and its channel; CSV attributes and the file\'s own information follow every channel'),
                t('src/test/keptRows.test.ts', 'a file\'s information that arrives goes into the cells that were drawn while its header was not read: no row or cell is drawn anew (#781)'),
                t('src/test/entryNoAnalysis.test.ts', 'putting recordings in starts no analysis: the entry sends the host only its open, its header reads and its session, never a scan'),
            ],
        },
        {
            id: 'entry-table.count', value: 'count', what: '見出し・フィルタ・チェックの一覧の数、分布図で範囲を選んだあとの行の数の知らせ',
            computedIn: ['src/webview/runtime/entryRuntime.ts:pickValueRange', 'src/webview/runtime/entryTableHtml.ts:datasetHeadHtml', 'src/webview/runtime/entryTableHtml.ts:trackHeadHtml', 'src/webview/runtime/entryTableHtml.ts:filterChipsHtml', 'src/webview/runtime/entryTableHtml.ts:checkListHtml', 'src/webview/runtime/entryTableHtml.ts:say'],
            from: 'whole', trace: '表のすべての行を数える。（描くのは画面に入る行だけだが、数は描かない行も含む）',
            tests: [
                t('src/test/uiSmoke/entry.spec.ts', 'a folder of 1000 recordings draws only the rows on screen, but its head and its filter lists count every row, not the rows drawn'),
            ],
        },
    ],
    knownGaps: {},
};
