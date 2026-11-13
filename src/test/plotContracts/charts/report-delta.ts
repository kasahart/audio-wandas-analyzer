import { TICK_PLACES, SP, t, tt, type ChartContract } from '../model';

/** レポートの Δ 図（差 n.png、要約.png の下段） */
export const reportDelta: ChartContract = {
    chart: {
        id: 'report-delta', name: 'レポートの Δ 図（差 n.png、要約.png の下段）',
        paintedBy: ['src/webview/runtime/compareReport.ts:paintDeltaFigure'],
        requires: ['headline', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'report-delta.headline', value: 'headline', what: '図の題（見出しの帯の Δ と Leq の Δ）',
            computedIn: ['src/webview/runtime/comparePanes.ts:diffHeadline', 'src/webview/runtime/comparePanes.ts:buildCompareModel', 'src/webview/runtime/compareReport.ts:reportFiles'],
            from: 'whole', trace: '帯の Δ = 比較 − 基準、スキャンの全データの帯の丸める前の値どうしで引き（levelDelta）、書くときだけ 0.1 dB に丸める（R1）。（描くために間引いた形はない）',
            tests: [
                t('src/test/comparePanes.test.ts', 'a tone that leaks into the neighbouring bands heads the list alone: only peaks of |Δ| across bands count'),
                t('src/test/comparePanes.test.ts', 'against one base file, a band within the chance spread of its condition is not headline material'),
            ],
        },
        {
            id: 'report-delta.range', value: 'range', what: 'Δ の軸の範囲',
            computedIn: ['src/webview/runtime/compareReport.ts:deltaFigure', `${SP}:stageDiffRange`, 'src/webview/runtime/comparePanes.ts:binsView', 'src/webview/runtime/figureModel.ts:diffRange'],
            from: 'full', trace: '全ビンがあるときは binsView がすべてのビンの Δ の最小・最大を valueRange として付け、それから決める。帯だけのときは全帯。',
            tests: [
                t('src/test/comparePanes.test.ts', 'the report\'s Δ figure without bins draws the 1/3-octave Δ, its range holding every band (R1)'),
                tt('src/test/comparePanes.test.ts', 'a spectrum drawn from its bins carries every bin\'s lowest and highest value in its span as its range, the silent floor left out (R1)'),
            ],
        },
        {
            id: 'report-delta.ticks', value: 'ticks', what: '目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:colourEndText`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                TICK_PLACES.report,
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'report-delta.axis', value: 'axis', what: 'Δ の軸の名前（「Δ [dB]」）',
            computedIn: ['src/webview/runtime/comparePanes.ts:paneAxes', 'src/webview/runtime/figureModel.ts:paneNames'],
            from: 'words', trace: 'dB の Δ は axisDelta（「差 Δ [dB]」）。量（差）と単位を書く。同じ基準の 2 つのレベルの差なので、差そのものの基準はない（基準は凡例と重ね図の軸）。dB でない量は「Δ 量 [単位]」。',
            tests: [
                t('src/test/axisNames.test.ts', 'every axis a picture is drawn on names its quantity and unit, whatever it measures, with or without a unit, Δ or not (R4)'),
                t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files'),
            ],
            names: { quantity: true, unit: true },
        },
    ],
    knownGaps: {
    },
};
