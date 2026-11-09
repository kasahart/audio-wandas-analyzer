import { SP, t, tt, type ChartContract } from '../model';

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
            from: 'full', trace: '描く絵は行が多いと行の区間ごとに帯の最小と最大の 2 本にするが（R2）、読み値は表の本当の行（overviewCells）を読む。',
            tests: [
                tt('src/test/entrySidePlots.test.ts', 'the strip is read at the table row under the pointer, never a row its bucket draws, and ← / → step that row\'s bands (R7)'),
                t('src/test/uiSmoke/entry.spec.ts', 'the overview strip has a row per channel, as the table does: its readout names the channel of a recording of several'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s overview strip answers the same gestures as every plot (R13)'),
            ],
        },
        {
            id: 'entry-overview.step', value: 'step', what: '概観帯の ← / →（次の帯）',
            computedIn: [`${SP}:imageStep`],
            from: 'full', trace: '表の本当の行の次の帯。',
            tests: [
                tt('src/test/entrySidePlots.test.ts', 'the strip is read at the table row under the pointer, never a row its bucket draws, and ← / → step that row\'s bands (R7)'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s overview strip answers the same gestures as every plot (R13)'),
            ],
        },
        {
            id: 'entry-overview.range', value: 'range', what: '色の範囲（カラーバーの両端）',
            computedIn: ['src/webview/runtime/entryPlots.ts:overviewPicture', 'src/shared/utils/ticks.ts:heatmapDbRange'],
            from: 'full', trace: '表のすべての行のすべての帯のレベル（区間ごとに最小と最大だけを描くが、描かない行も）の最大を上、max(最小, 最大 − 100 dB) を下にして（heatmapDbRange）切りのよい値に広げる（R9）。',
            tests: [
                tt('src/test/entrySidePlots.test.ts', 'the strip\'s colour range holds every table row\'s level, not only the rows the window draws, and opens at round ends (R9)'),
                t('src/test/entrySidePlots.test.ts', 'the strip\'s colours reach no more than 100 dB under its loudest level: a digitally silent recording (−300 dB) does not set the bottom (R9)'),
            ],
        },
        {
            id: 'entry-overview.ticks', value: 'ticks', what: '帯と行の目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickText`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '行は表の上からの番号（yTickText）。',
            tests: [
                t('src/test/entrySidePlots.test.ts', 'the strip is a heatmap of the table: a row per table row counted down from the top, each bucket\'s quietest and loudest when they outnumber its lines (R2)'),
            ],
        },
        {
            id: 'entry-overview.axis', value: 'axis', what: '帯・行・色の名前',
            computedIn: ['src/webview/runtime/entryPlots.ts:paintOverview'],
            from: 'words', trace: '帯域中心 [Hz]、行（表の順）、色はレベルと録音に最も多い基準（素の dB にしない。未校正なら未校正と書く）。その基準の録音の帯だけを塗る（commonLevelLabel、entrySidePlots の reference）。',
            tests: [
                t('src/test/entrySidePlots.test.ts', 'the overview colour scale and the dataset table name the recordings\' most common level reference, never plain dB, and say uncalibrated (R4)'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
    ],
    knownGaps: {},
};
