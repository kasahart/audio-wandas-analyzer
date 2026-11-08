import { SP, t, type ChartContract } from '../model';

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
            from: 'whole', trace: '帯の Δ = round(比較, 0.1) − round(基準, 0.1)、スキャンの全データの帯から。（描くために間引いた形はない）',
            tests: [
                t('src/test/comparePanes.test.ts', 'a tone that leaks into the neighbouring bands heads the list alone: only peaks of |Δ| across bands count'),
                t('src/test/comparePanes.test.ts', 'against one base file, a band within the chance spread of its condition is not headline material'),
            ],
        },
        {
            id: 'report-delta.range', value: 'range', what: 'Δ の軸の範囲',
            computedIn: ['src/webview/runtime/compareReport.ts:deltaFigure', `${SP}:stageDiffRange`],
            from: 'extremes', trace: '全ビンの Δ を binsView で間引いた線と帯の Δ から決める。帯だけのときは全帯。',
            tests: [
                t('src/test/comparePanes.test.ts', 'the report\'s Δ figure without bins draws the 1/3-octave Δ, its range holding every band (R1)'),
            ],
            gap: { severity: 'P2', why: '全ビンがあるときの範囲を間引いた線から求めている。テストは帯だけの場合しか見ていない。' },
        },
        {
            id: 'report-delta.ticks', value: 'ticks', what: '目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickText`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'report-delta.axis', value: 'axis', what: 'Δ の軸の名前（「Δ [dB]」）',
            computedIn: ['src/webview/runtime/comparePanes.ts:paneAxes'],
            from: 'words', trace: 'paneAxes の delta は「Δ [dB]」。',
            tests: [
                t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files'),
            ],
            names: { quantity: false, unit: true, reference: false },
            gap: { severity: 'P2', why: '「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。' },
            inFlight: 'claude/axis-quantity-unit',
        },
    ],
    knownGaps: {
        'report-delta.range': 'P2',
        'report-delta.axis': 'P2',
    },
};
