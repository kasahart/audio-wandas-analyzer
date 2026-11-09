import { SP, t, type ChartContract } from '../model';

/** 入口の分布図（群ごとの行と下の値の軸） */
export const entryDistribution: ChartContract = {
    chart: {
        id: 'entry-distribution', name: '入口の分布図（群ごとの行と下の値の軸）',
        paintedBy: ['src/webview/runtime/entryDistributionPane.ts:paint'],
        requires: ['readout', 'step', 'count', 'median', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'entry-distribution.readout', value: 'readout', what: '分布図の読み値（ビンの範囲と数、点の録音と値、スロット、基準の中央値）',
            computedIn: ['src/webview/runtime/entryDistribution.ts:distributionRows', 'src/webview/runtime/entryTableHtml.ts:plotValueText', 'src/webview/runtime/entryRuntime.ts:format'],
            from: 'whole', trace: 'ビン・点・目盛りのしるしは間引かず全部描く（full: \'drawn\'）。値は表の値（スキャンの全データの値）。',
            tests: [
                t('src/test/plotText.test.ts', 'the distribution reads a value as a plot does, not as the table column writes it (R7)'),
                t('src/test/plotText.test.ts', 'neighbouring distribution bins never read the same: the bins\' width adds the digits it needs (R7)'),
                t('src/test/entryDistributionPane.test.ts', 'each group is a row of the plot component: its dots, its slots and the base on it'),
            ],
            exception: { rule: 'R7', quote: '描いた点がそのまま全部の点であるもの（棒、帯、ペアの図の全ビン、分布のビン）は \'drawn\'' },
        },
        {
            id: 'entry-distribution.step', value: 'step', what: '分布図の ← / →',
            computedIn: [`${SP}:stageStep`],
            from: 'whole', trace: '描いた次のビン・点。',
            tests: [
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s distribution answers the same gestures as every plot: each group\'s row, on the value axis below them (R13)'),
            ],
        },
        {
            id: 'entry-distribution.count', value: 'count', what: 'ビンの数、群の数、「最大 n」、選んだ行の数',
            computedIn: ['src/webview/runtime/entryDistribution.ts:distributionRows', 'src/shared/dataset/distribution.ts:binCounts', 'src/webview/runtime/entryDistributionPane.ts:paint', 'src/webview/runtime/entryRuntime.ts:pick'],
            from: 'whole', trace: '群のすべての行を数える。（描くために間引いた形はない）',
            tests: [
                t('src/test/distribution.test.ts', 'bins line up across groups; the range marks what it takes'),
                t('src/test/distribution.test.ts', 'a CSV value counts each recording once per group; a computed one counts channels and says how many are not computed'),
            ],
        },
        {
            id: 'entry-distribution.median', value: 'median', what: '基準の群の中央値の線',
            computedIn: ['src/webview/runtime/entryDistribution.ts:distributionRows', 'src/shared/dataset/distribution.ts:median'],
            from: 'whole', trace: '群のすべての値の中央値。（描くために間引いた形はない）',
            tests: [
                t('src/test/distribution.test.ts', 'groups sort by number when numeric, as text otherwise, the blank last; the median of an even count is the mean of the middle two'),
            ],
        },
        {
            id: 'entry-distribution.range', value: 'range', what: '値の軸の範囲',
            computedIn: ['src/shared/dataset/distribution.ts:distribution'],
            from: 'whole', trace: 'すべての値の端を niceRange で広げる。（描くために間引いた形はない）',
            tests: [
                t('src/test/distribution.test.ts', 'the distribution\'s value axis opens at round ends, as every automatic range does (R9)'),
                t('src/test/distribution.test.ts', 'a range far narrower than its values keeps ends that hold every value, never rounded inward past them (R9)'),
            ],
        },
        {
            id: 'entry-distribution.ticks', value: 'ticks', what: '値の軸の目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickText`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                t('src/test/distribution.test.ts', 'ticks fall on round values without floating-point drift'),
            ],
        },
        {
            id: 'entry-distribution.axis', value: 'axis', what: '値の軸と縦の名前',
            computedIn: ['src/webview/runtime/entryDistributionPane.ts:paint'],
            from: 'words', trace: '値の名前（「Leq A特性 [基準]」など）と「縦：{単位}数（群ごと）」。',
            tests: [
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s distribution answers the same gestures as every plot: each group\'s row, on the value axis below them (R13)'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
        {
            id: 'entry-distribution.axis-csv', value: 'axis', what: 'CSV の列の値の軸（「{列}（CSV の列）」）',
            computedIn: ['src/webview/runtime/entryDistributionPane.ts:paint'],
            from: 'words', trace: 'csvAxisName は列の名前に書いた単位（「温度 [°C]」「温度 (°C)」）を軸の単位にし、書いていなければ「[単位不明]」と書く（R4）。',
            tests: [
                t('src/test/axisNames.test.ts', 'a CSV column\'s value axis names the unit its header gives, and says when it gives none'),
            ],
            names: { quantity: true, unit: true },
        },
    ],
    knownGaps: {
    },
};
