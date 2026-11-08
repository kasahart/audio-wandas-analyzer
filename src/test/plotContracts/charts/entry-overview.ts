import { SP, t, type ChartContract } from '../model';

/** 入口の概観帯 */
export const entryOverview: ChartContract = {
    chart: {
        id: 'entry-overview', name: '入口の概観帯',
        paintedBy: ['src/webview/runtime/entryPlots.ts:paintOverview'],
        requires: ['readout', 'step', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'entry-overview.readout', value: 'readout', what: '概観帯の読み値（録音・帯・レベル）',
            computedIn: ['src/webview/runtime/entryPlots.ts:overviewCells', `${SP}:cellRead`],
            from: 'full', trace: '描く絵は行が多いと画素の行ごとに一番大きい帯のレベルにするが、読み値は表の本当の行（overviewCells）を読む。',
            tests: [
                t('src/test/uiSmoke/entry.spec.ts', 'the overview strip has a row per channel, as the table does: its readout names the channel of a recording of several'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s overview strip answers the same gestures as every plot (R13)'),
            ],
            gap: { severity: 'P2', why: '全データと描いた点が違うデータで確かめるテストがない（今のテストは描いた点でも通る）。' },
        },
        {
            id: 'entry-overview.step', value: 'step', what: '概観帯の ← / →（次の帯）',
            computedIn: [`${SP}:imageStep`],
            from: 'full', trace: '表の本当の行の次の帯。',
            tests: [
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s overview strip answers the same gestures as every plot (R13)'),
            ],
            gap: { severity: 'P2', why: '全データと描いた点が違うデータで確かめるテストがない（今のテストは描いた点でも通る）。' },
        },
        {
            id: 'entry-overview.range', value: 'range', what: '色の範囲（カラーバーの両端）',
            computedIn: ['src/webview/runtime/entryPlots.ts:overviewPicture'],
            from: 'full', trace: '表のすべての行のすべての帯のレベルの最小と最大を 1 dB に切り下げ・切り上げる（niceRange ではない）。',
            tests: [],
            gap: { severity: 'P2', why: '範囲を確かめるテストがない。端の丸めも R9 の切りのよい値（niceRange）ではない。' },
        },
        {
            id: 'entry-overview.ticks', value: 'ticks', what: '帯と行の目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickText`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '行は表の上からの番号（yTickText）。',
            tests: [
                t('src/test/entrySidePlots.test.ts', 'the strip is a heatmap of the table: a row per table row counted down from the top, the loudest per line when they outnumber its lines'),
            ],
        },
        {
            id: 'entry-overview.axis', value: 'axis', what: '帯・行・色の名前',
            computedIn: ['src/webview/runtime/entryPlots.ts:paintOverview'],
            from: 'words', trace: '帯域中心 [Hz]、行（表の順）、色はレベルと共有の基準。',
            tests: [
                t('src/test/entrySidePlots.test.ts', 'the overview colour scale and the dataset table name the recordings\' shared level reference, plain dB once they differ'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
    ],
    knownGaps: {
        'entry-overview.readout': 'P2',
        'entry-overview.step': 'P2',
        'entry-overview.range': 'P2',
    },
};
