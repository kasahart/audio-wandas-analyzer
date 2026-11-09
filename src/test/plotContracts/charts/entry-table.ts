import { t, type ChartContract } from '../model';

/** 入口の表（値の列、Δ、見出しの数、D の差、表の CSV） */
export const entryTable: ChartContract = {
    chart: {
        id: 'entry-table', name: '入口の表（値の列、Δ、見出しの数、D の差、表の CSV）',
        paintedBy: ['src/webview/runtime/entryTableHtml.ts:datasetRowsHtml', 'src/webview/runtime/entryTable.ts:entryCsv'],
        requires: ['summary', 'delta', 'count', 'export'],
    },
    rows: [
        {
            id: 'entry-table.cells', value: 'summary', what: '表の値の列（Leq、ピーク周波数、波高率、帯）と凡例の値',
            computedIn: ['src/webview/runtime/entryTableHtml.ts:formatValue', 'src/webview/runtime/entryTableHtml.ts:datasetRowsHtml', 'src/webview/runtime/entryRuntime.ts:formatColumn', 'src/webview/runtime/entryTable.ts:fileValues', 'src/webview/runtime/entryTable.ts:bandLevels', 'python-backend/scan_service.py:measure'],
            from: 'whole', trace: 'スキャンが Frame の全サンプル・全ビンから求めた値（ピークは Welch の全ビン、帯は noct_spectrum）。チャンネルはパワー平均。（描くために間引いた形はない）',
            tests: [
                t('python-backend/test_scan_service.py', 'test_scan_measures_the_analysis_spec_metrics'),
                t('src/test/entryTable.test.ts', 'unreadable files and files of another shape show no numbers'),
            ],
        },
        {
            id: 'entry-table.delta', value: 'delta', what: 'entry-table.csv の Δ・最大の帯・基準群 n（画面の比較と同じ基準に対して）',
            computedIn: ['src/webview/runtime/entryBase.ts:fileComparison', 'src/webview/runtime/compareReport.ts:entryMeasure', 'src/webview/runtime/entryTable.ts:entryCsv', 'src/webview/runtime/entryTable.ts:maxBandDelta', 'src/webview/runtime/entryTable.ts:mostTellingBand', 'src/webview/runtime/figureModel.ts:figureUsed', 'src/webview/runtime/figureModel.ts:scanAnswer'],
            from: 'whole', trace: 'スキャンの全データの値と、比較が使う基準（entryBase.resolve: スロット 0、または除外・絞り込み・スロット・単位・チャンネルを考えた群の中央値）。CSV が自分で群を作ることはない。（描くために間引いた形はない）',
            tests: [
                t('src/test/entryTable.test.ts', 'a file row has no Δ of its own: the CSV writes what `measure` (the screen\'s base) gives, the band centre as its column names it'),
                t('src/test/entryBase.test.ts', 'one base group everywhere: the distribution\'s base line, the comparison\'s Δ and the entry CSV\'s Δ are of the same recordings'),
                t('src/test/entryTable.test.ts', 'every band centre is written in the CSV as its column header names it, never rounded to a whole Hz'),
                t('src/test/entryTable.test.ts', 'on the scanned entry100 fixture the three resonances stand 10 dB above their groups at 3.15 kHz, one ✕ and one ≠'),
            ],
        },
        {
            id: 'entry-table.derived', value: 'delta', what: 'D で固定した差（行の下の「└ Δ」）',
            computedIn: ['src/webview/runtime/entryRuntime.ts:derivedItems'],
            from: 'whole', trace: '固定したスキャンの Leq・帯（全データ）とその基準の差。（描くために間引いた形はない）',
            tests: [
                t('src/test/entryTable.test.ts', 'a derived row sits under its parent with the parent\'s condition and Δ against its own base, and counts toward no group'),
            ],
        },
        {
            id: 'entry-table.count', value: 'count', what: '見出し・フィルタ・チェックの一覧の数',
            computedIn: ['src/webview/runtime/entryTableHtml.ts:datasetHeadHtml', 'src/webview/runtime/entryTableHtml.ts:trackHeadHtml', 'src/webview/runtime/entryTableHtml.ts:filterChipsHtml', 'src/webview/runtime/entryTableHtml.ts:checkListHtml', 'src/webview/runtime/entryTableHtml.ts:say'],
            from: 'whole', trace: '表のすべての行を数える。（描くのは画面に入る行だけだが、数は描かない行も含む）',
            tests: [
                t('src/test/uiSmoke/entry.spec.ts', 'a folder of 1000 recordings draws only the rows on screen, but its head and its filter lists count every row, not the rows drawn'),
            ],
        },
        {
            id: 'entry-table.mismatch', value: 'label', what: '比べられない理由（≠ の kHz など）と区間の名札',
            computedIn: ['src/webview/runtime/entryTable.ts:mismatchLabel', 'src/webview/runtime/entryTable.ts:regionLabel'],
            from: 'input', trace: 'ファイルのメタデータと利用者の区間。',
            tests: [
                t('src/test/entryTable.test.ts', 'on the scanned entry100 fixture the three resonances stand 10 dB above their groups at 3.15 kHz, one ✕ and one ≠'),
            ],
        },
        {
            id: 'entry-table.csv', value: 'export', what: '表の CSV',
            computedIn: ['src/webview/runtime/entryTable.ts:entryCsv', 'src/webview/runtime/entryTable.ts:csvCell', 'src/webview/runtime/entryTable.ts:dB', 'src/webview/runtime/entryTable.ts:regionCells', 'src/webview/runtime/figureModel.ts:levelColumns', 'src/webview/runtime/entryTable.ts:levelReferenceCell'],
            from: 'whole', trace: '表と同じ全データの値を決まった桁で書く。（描くために間引いた形はない）',
            tests: [
                t('src/test/entryTable.test.ts', 'the CSV has the agreed columns, a BOM, and the same bytes every time'),
            ],
        },
    ],
    knownGaps: {},
};
