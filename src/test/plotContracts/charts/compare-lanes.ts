import { TICK_PLACES, SP, t, tt, type ChartContract } from '../model';

/** 比較台の横並びのレーン */
export const compareLanes: ChartContract = {
    chart: {
        id: 'compare-lanes', name: '比較台の横並びのレーン',
        paintedBy: ['src/webview/runtime/trackStagePainter.ts:paintStageLanes', 'src/webview/runtime/trackStagePainter.ts:paintNoStage'],
        requires: ['readout', 'step', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'compare-lanes.readout', value: 'readout', what: '各レーンの読み値',
            computedIn: [`${SP}:stageHover`, `${SP}:lineRead`, `${SP}:cellRead`, 'src/webview/runtime/trackStagePainter.ts:paintStageLanes'],
            from: 'full', trace: '重ね図と同じ fullOf（stageReader.of）を各レーンの層に付ける。',
            tests: [
                tt('src/test/trackStagePainter.test.ts', 'side by side, each lane is read at its own full data, never the line thinned to draw it: a bin thinned out under the pointer, and ← / → one bin at a time (R7)'),
                t('src/test/fullRead.test.ts', 'every layer a plot draws is given its full data, held or fetched: one given none is marked and reads no number, bars too (R7)'),
                t('src/test/stagePanes.test.ts', 'the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)'),
                t('src/test/trackStagePainter.test.ts', 'side by side, every lane draws its own picture and says it shows the step; the base measured against says so'),
            ],
        },
        {
            id: 'compare-lanes.step', value: 'step', what: '各レーンの ← / →',
            computedIn: [`${SP}:stageStep`],
            from: 'full', trace: '重ね図と同じ。',
            tests: [
                tt('src/test/trackStagePainter.test.ts', 'side by side, each lane is read at its own full data, never the line thinned to draw it: a bin thinned out under the pointer, and ← / → one bin at a time (R7)'),
                t('src/test/plotHoverLayer.test.ts', 'an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot\'s left edge (R7)'),
                t('src/test/fullRead.test.ts', 'an arrow key crosses silent points past one fetched window to the next point with a value (R7)'),
            ],
        },
        {
            id: 'compare-lanes.range', value: 'range', what: 'レーンが共有する値の軸の範囲（線）',
            computedIn: [`${SP}:stageRange`, 'src/webview/runtime/trackStagePainter.ts:paintStageLanes', 'src/webview/runtime/trackStagePainter.ts:rangeOf', 'python-backend/stage_combine.py:value_range', 'src/webview/runtime/figureModel.ts:dataRange', 'src/webview/runtime/figureModel.ts:narrowedRange', 'src/webview/runtime/figureModel.ts:byLevelKey'],
            from: 'full', trace: '各レーンの絵がバックエンドの付けた全データの valueRange を持ち、同じレベルの同一性（R1）のレーンのその端から 1 つの範囲を決める（rangeOf）。',
            tests: [
                tt('src/test/stagePanes.test.ts', 'every range is set from the full data\'s lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)'),
                t('src/test/trackStagePainter.test.ts', 'side by side, lanes share a range only with the lanes in their own reference: a dB SPL lane is never on a dBFS lane\'s scale (A32, C1)'),
                tt('python-backend/test_stage_view.py', 'test_every_pictures_value_range_is_its_full_datas_not_the_points_or_cells_drawn'),
            ],
        },
        {
            id: 'compare-lanes.range-image', value: 'range', what: '熱図のレーンの色の範囲（カラーバーの両端）',
            computedIn: [`${SP}:stageRange`, 'python-backend/stage_combine.py:value_range', 'src/webview/runtime/figureModel.ts:dataRange'],
            from: 'full', trace: '重ね図の熱図と同じく、平均する前の全マスの valueRange から決め、dB は上 − 100 dB より下にしない（R9）。',
            tests: [
                tt('src/test/stagePanes.test.ts', 'every range is set from the full data\'s lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)'),
                tt('python-backend/test_stage_view.py', 'test_every_pictures_value_range_is_its_full_datas_not_the_points_or_cells_drawn'),
                t('src/test/stagePanes.test.ts', 'a heatmap\'s colours reach no more than 100 dB under its loudest value: digital silence (−240 dB) does not set the bottom (R9)'),
            ],
        },
        {
            id: 'compare-lanes.ticks', value: 'ticks', what: '各レーンの目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:colourEndText`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                TICK_PLACES.comparison,
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'compare-lanes.axis', value: 'axis', what: '各レーンの両軸の名前',
            computedIn: [`${SP}:stageAxes`, 'src/webview/runtime/figureModel.ts:stageNames'],
            from: 'words', trace: '重ね図と同じ stageAxes。',
            tests: [
                t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
    ],
    knownGaps: {
    },
};
