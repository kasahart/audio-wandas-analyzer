import { SP, t, tt, type ChartContract } from '../model';

/** トリガーのイベント図の下のレーン */
export const triggerLanes: ChartContract = {
    chart: {
        id: 'trigger-lanes', name: 'トリガーのイベント図の下のレーン',
        paintedBy: ['src/webview/runtime/triggerLanes.ts:paintTriggerLanes'],
        requires: ['readout', 'step', 'range', 'ticks', 'axis', 'count'],
    },
    rows: [
        {
            id: 'trigger-lanes.readout', value: 'readout', what: 'イベント図の下のレーン（録音の時間信号）の読み値',
            computedIn: [`${SP}:lineRead`, 'src/webview/runtime/triggerLanes.ts:paintTriggerLanes'],
            from: 'full', trace: 'frame.fullOf（stageReader.of）で録音の全サンプルを読む。',
            tests: [
                t('src/test/uiSmoke/plotContract.spec.ts', 'a trigger\'s events plot and the lanes under it answer the same gestures as every plot (R13)'),
                tt('python-backend/test_full_read.py', 'test_a_signals_samples_are_read_one_by_one'),
            ],
        },
        {
            id: 'trigger-lanes.step', value: 'step', what: 'レーンの ← / →',
            computedIn: [`${SP}:stageStep`],
            from: 'full', trace: '全サンプルの次の点。',
            tests: [
                tt('src/test/triggerLanes.test.ts', 'a trigger lane is read at every sample: the pointer reads a sample between the envelope\'s points, and ← / → go one sample at a time (R7)'),
                t('src/test/plotHoverLayer.test.ts', 'an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot\'s left edge (R7)'),
                t('src/test/fullRead.test.ts', 'an arrow key crosses silent points past one fetched window to the next point with a value (R7)'),
            ],
        },
        {
            id: 'trigger-lanes.range', value: 'range', what: 'レーンの振幅の範囲（しきい値を含む）',
            computedIn: ['src/webview/runtime/triggerLanes.ts:paintTriggerLanes', 'src/webview/runtime/triggerLanes.ts:rangeOf', 'src/webview/plot/waveformLayer.ts:waveformRange', 'src/webview/runtime/comparePanes.ts:levelIdentityOf'],
            from: 'full', trace: '同じレベルの同一性（levelIdentityOf）のレーンどうしで、時間信号は absolutePeak（全サンプルの絶対値の最大）の ±1.05 倍に、しきい値が入るよう広げ、端を切りのよい値に広げる（niceRange、R9）。別の同一性のレーンは範囲を共有しない。',
            tests: [
                t('src/test/triggerLanes.test.ts', 'trigger lanes of another level identity never share a range: a lane in Pa is not on a full-scale lane\'s scale (A43, R1, R4)'),
                tt('src/test/triggerLanes.test.ts', 'the trigger lanes of one level identity share a range holding every sample\'s peak of each recording and the trigger\'s level, not the envelope drawn (R1)'),
            ],
        },
        {
            id: 'trigger-lanes.ticks', value: 'ticks', what: 'レーンの目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:colourEndText`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'trigger-lanes.axis', value: 'axis', what: 'レーンの両軸の名前',
            computedIn: [`${SP}:stageAxes`, `${SP}:amplitudeAxisTitle`],
            from: 'words', trace: '振幅（単位、未校正）と時間。',
            tests: [
                t('src/test/uiSmoke/plotContract.spec.ts', 'a trigger\'s events plot and the lanes under it answer the same gestures as every plot (R13)'),
            ],
            names: { quantity: true, unit: true },
        },
        {
            id: 'trigger-lanes.count', value: 'count', what: '使ったイベントの数と全体の数（角の表示）、しきい値の名札',
            computedIn: ['src/webview/runtime/triggerLanes.ts:paintTriggerLanes'],
            from: 'whole', trace: '数はバックエンドが切り出した全イベントと除いたものの数。しきい値は利用者の値。（描くために間引いた形はない）',
            tests: [
                t('src/test/uiSmoke/trackCompare.spec.ts', 'a trigger added from ＋ fires at half the tracks\' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events'),
            ],
        },
    ],
    knownGaps: {},
};
