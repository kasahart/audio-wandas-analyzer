import { SP, t, tt, type ChartContract } from '../model';

/** レポートの重ね図（比較 n.png、要約.png の上段） */
export const reportOverlay: ChartContract = {
    chart: {
        id: 'report-overlay', name: 'レポートの重ね図（比較 n.png、要約.png の上段）',
        paintedBy: ['src/webview/runtime/compareReport.ts:paintOverlayFigure'],
        requires: ['headline', 'order', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'report-overlay.headline', value: 'headline', what: '図の題（見出しの帯と Leq の両方のレベル）',
            computedIn: ['src/webview/runtime/comparePanes.ts:levelsHeadline', 'src/webview/runtime/comparePanes.ts:pair', 'src/webview/runtime/comparePanes.ts:buildCompareModel', 'src/webview/runtime/comparePanes.ts:medianSide', 'src/webview/runtime/comparePanes.ts:spreadOf', 'src/webview/runtime/compareReport.ts:reportFiles'],
            from: 'whole', trace: '帯と Leq はスキャンの全データの値（群は帯ごとの中央値）。（描くために間引いた形はない）',
            tests: [
                t('src/test/comparePanes.test.ts', 'the headline gives both levels, and a band far below the loudest does not head it however large its Δ'),
                t('src/test/comparePanes.test.ts', 'a tone that leaks into the neighbouring bands heads the list alone: only peaks of |Δ| across bands count'),
            ],
        },
        {
            id: 'report-overlay.order', value: 'order', what: '基準と比較の重ねる順',
            computedIn: ['src/webview/runtime/comparePanes.ts:binsView', 'src/webview/runtime/comparePanes.ts:sideView'],
            from: 'full', trace: 'binsView は全ビンから levelBins を作り、描く線だけを間引く。帯は全帯。',
            tests: [
                tt('src/test/comparePanes.test.ts', 'the report\'s overlay figure orders base and compared by every bin\'s power, not the points thinned to draw them: the quieter on top (R6)'),
            ],
        },
        {
            id: 'report-overlay.range', value: 'range', what: 'レベルの軸の範囲',
            computedIn: ['src/webview/runtime/compareReport.ts:paintOverlayFigure', `${SP}:stageRange`],
            from: 'extremes', trace: 'binsView で 640 区間の最小・最大に間引いた線から stageRange で決める。',
            tests: [],
            gap: { severity: 'P2', why: '範囲を間引いた線から求めている。全ビンの端と一致することを確かめるテストがない。' },
        },
        {
            id: 'report-overlay.ticks', value: 'ticks', what: '目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickText`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'report-overlay.axis', value: 'axis', what: '軸の名前',
            computedIn: ['src/webview/runtime/comparePanes.ts:paneAxes'],
            from: 'words', trace: 'レベル（基準・未校正）と周波数。',
            tests: [
                t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
    ],
    knownGaps: {
        'report-overlay.range': 'P2',
    },
};
