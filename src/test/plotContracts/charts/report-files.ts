import { t, type ChartContract } from '../model';

/** レポートの 要約.png の頭書き・報告.csv・定義.json */
export const reportFiles: ChartContract = {
    chart: {
        id: 'report-files', name: 'レポートの 要約.png の頭書き・報告.csv・定義.json',
        paintedBy: ['src/webview/runtime/compareReport.ts:summaryPng', 'src/webview/runtime/compareReport.ts:reportCsv'],
        requires: ['export', 'label'],
    },
    rows: [
        {
            id: 'report-files.csv', value: 'export', what: '報告.csv（最大の帯、Leq、基準の Leq、帯ごとの Δ、群の数、D の行）',
            computedIn: ['src/webview/runtime/compareReport.ts:reportCsv', 'src/webview/runtime/compareReport.ts:maxBandCells', 'src/webview/runtime/compareReport.ts:dB', 'src/webview/runtime/compareReport.ts:bandLevel'],
            from: 'whole', trace: 'スキャンの全データの帯と Leq（群は中央値）、dB は 0.1 まで。（描くために間引いた形はない）',
            tests: [
                t('src/test/benchReport.test.ts', '報告.csv has one row per slot in the agreed columns: dB to one decimal, Hz whole, missing values empty'),
                t('src/test/benchReport.test.ts', 'the report says what the comparison was taken from: the value, the filters, each base with its channel, the memo, and the D rows'),
            ],
        },
        {
            id: 'report-files.region', value: 'label', what: '要約.png の頭書きと図の題の区間',
            computedIn: ['src/webview/runtime/compareReport.ts:summaryPng', 'src/webview/runtime/compareReport.ts:summaryRegionText', 'src/webview/runtime/compareReport.ts:slotRegions', 'src/webview/runtime/compareReport.ts:regionSeconds', 'src/webview/runtime/compareReport.ts:regionText'],
            from: 'input', trace: '利用者の区間。要約.png の頭書きは各ファイルを測った区間（そのファイル自身の長さの中で端の 0.15 s を除く）で、ファイルどうしで違えばスロットごとに書く。図の題は利用者の区間。',
            tests: [
                t('src/test/benchReport.test.ts', 'the report Recipe carries the region as its time slice and still loads in wandas'),
                t('src/test/benchReport.test.ts', 'each compared file\'s row, Recipe and heading give the region that file was measured over, cut within its own length'),
            ],
        },
    ],
    knownGaps: {},
};
