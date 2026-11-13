import { TICK_PLACES, CLICK_READ, CLICK_TEST, PRESS_READ_TEST, SP, t, type ChartContract } from '../model';

/** 入口の分布図（群ごとの行と下の値の軸） */
export const entryDistribution: ChartContract = {
    chart: {
        id: 'entry-distribution', name: '入口の分布図（群ごとの行と下の値の軸）',
        paintedBy: ['src/webview/runtime/entryDistributionPane.ts:paint'],
        requires: ['readout', 'step', 'count', 'median', 'range', 'ticks', 'axis', 'click'],
    },
    rows: [
        {
            id: 'entry-distribution.readout', value: 'readout', what: '分布図の読み値（ビンの範囲と数、点の録音と値、スロット、基準の中央値）',
            computedIn: ['src/webview/runtime/entryDistribution.ts:distributionRows', 'src/webview/runtime/entryTableHtml.ts:plotValueText', 'src/webview/runtime/entryRuntime.ts:format'],
            from: 'whole', trace: 'ビン・点・目盛りのしるしは間引かず全部描き、層ごとにその全部の値を InlineFullSource（localLine）として持って読む。値は表の値（スキャンの全データの値）。',
            tests: [
                t('src/test/plotText.test.ts', 'the distribution reads a value as a plot does, not as the table column writes it (R7)'),
                t('src/test/plotText.test.ts', 'neighbouring distribution bins never read the same: the bins\' width adds the digits it needs (R7)'),
                t('src/test/entryDistributionPane.test.ts', 'each group is a row of the plot component: its dots, its slots and the base on it'),
            ],
        },
        {
            id: 'entry-distribution.step', value: 'step', what: '分布図の ← / →',
            computedIn: [`${SP}:stageStep`, 'src/webview/runtime/fullRead.ts:localLine'],
            from: 'whole', trace: '層が持つ全部の値（InlineFullSource）の次のビン・点。',
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
            computedIn: ['src/webview/runtime/entryBase.ts:groupBase', 'src/webview/runtime/comparePanes.ts:setMedian', 'src/webview/runtime/entryDistribution.ts:distributionRows', 'src/webview/runtime/figureModel.ts:figureUsed'],
            from: 'whole', trace: '比較が Δ を測る基準群（entryBase.resolve と同じ録音: 比較中の行・ほかのスロット・除外・別の単位を除く）の中央値を、その一つの FigureSet（figureModel.figureUsed）から setMedian で取り、その値に線を引く。行の点の中央値ではない。（描くために間引いた形はない）',
            tests: [
                t('src/test/entryBase.test.ts', 'one base group everywhere: the distribution\'s base line, the comparison\'s Δ and the entry CSV\'s Δ are of the same recordings'),
                t('src/test/entryBase.test.ts', 'only the entry base builds a comparison or a base group: no screen, file or report makes its own'),
            ],
        },
        {
            id: 'entry-distribution.range', value: 'range', what: '値の軸の範囲',
            computedIn: ['src/shared/dataset/distribution.ts:distribution', 'src/webview/runtime/figureModel.ts:plainRange'],
            from: 'whole', trace: '軸の基準のすべての値の端を niceRange で広げる。別の基準のレベルは軸に置かず数える（onLevelAxis）。（描くために間引いた形はない）',
            tests: [
                t('src/test/distribution.test.ts', 'the distribution\'s value axis opens at round ends, as every automatic range does (R9)'),
                t('src/test/distribution.test.ts', 'a range far narrower than its values keeps ends that hold every value, never rounded inward past them (R9)'),
                t('src/test/distribution.test.ts', 'levels of another reference than the value axis\'s are never placed on it: they are left off its range and counted apart'),
            ],
        },
        {
            id: 'entry-distribution.ticks', value: 'ticks', what: '値の軸の目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:colourEndText`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                TICK_PLACES.distribution,
                t('src/test/distribution.test.ts', 'ticks fall on round values without floating-point drift'),
            ],
        },
        {
            id: 'entry-distribution.axis', value: 'axis', what: '値の軸と縦の名前',
            computedIn: ['src/webview/runtime/entryDistributionPane.ts:paint', 'src/webview/runtime/entrySidePlots.ts:createSidePlots', 'src/shared/utils/format.ts:commonLevelLabel', 'src/webview/runtime/figureModel.ts:plainNames', 'src/webview/runtime/figureModel.ts:templatedLevelName'],
            from: 'words', trace: '値の名前（「Leq A特性 [基準]」、未校正なら「Leq A特性 未校正 [dBFS]」）と「縦：{単位}数（群ごと）」。基準は録音に最も多いもので、素の dB にしない（levelName）。',
            tests: [
                t('src/test/entrySidePlots.test.ts', 'the overview colour scale and the dataset table name the recordings\' most common level reference, never plain dB, and say uncalibrated (R4)'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s distribution answers the same gestures as every plot: each group\'s row, on the value axis below them (R13)'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
        {
            id: 'entry-distribution.axis-csv', value: 'axis', what: 'CSV の列の値の軸（「{列}（CSV の列）」）',
            computedIn: ['src/webview/runtime/entryDistributionPane.ts:paint', 'src/webview/runtime/figureModel.ts:plainNames'],
            from: 'words', trace: 'csvAxisName は列の名前に書いた単位（「温度 [°C]」「温度 (°C)」）を軸の単位にし、書いていなければ「[単位不明]」と書く（R4）。',
            tests: [
                t('src/test/axisNames.test.ts', 'a CSV column\'s value axis names the unit its header gives, and says when it gives none'),
            ],
            names: { quantity: true, unit: true },
        },
        {
            id: 'entry-distribution.click', value: 'click', what: 'クリックが選ぶもの（点・ラグ・スロットの目盛りの行、棒のビン、点のない所は読み値が言う値のビン）',
            computedIn: [...CLICK_READ, 'src/webview/runtime/entryDistributionPane.ts:tap', 'src/webview/runtime/entryDistribution.ts:distributionClick', 'src/webview/runtime/entryDistribution.ts:binRange'],
            from: 'whole', trace: '押した所で読み値が読んだ点（PlotHoverLayer.clicked）を clickOnRead が tap に渡し、その点の層が言うもの（DistributionRow.clickOf: 点とラグは StageLayer.identity の録音、スロットの目盛りはその行、棒はその番号のビン、基準の中央値は何もしない）を選ぶ。点を読まない所は読み値の言葉（words.none）と同じ valueAt の値のビン、「値なし」は何もしない。クリック自身の当たり判定はない。',
            tests: [
                t('src/test/entryDistributionPane.test.ts', 'a click on a row acts on what its readout reads at the press, never on a hit test of its own: on a dot beside another of its height, that dot\'s row; half way between, the first; off any point, the bin of the value the readout says; a double click\'s second press puts the table back (R7, R13)'),
                t('src/test/pickCases.test.ts', 'every pick case of the table is read by the webview as the table says: nearest, under, a click, ← and → (R7)'),
                t('src/test/plotInteraction.test.ts', PRESS_READ_TEST),
                t('src/test/uiSmoke/plotContract.spec.ts', CLICK_TEST),
            ],
        },
    ],
    knownGaps: {
    },
};
