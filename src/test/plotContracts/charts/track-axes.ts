import { TICK_PLACES, RT, SP, t, type ChartContract } from '../model';

/** トラックのレーンの軸（振幅・周波数の軸、上の時間の目盛り） */
export const trackAxes: ChartContract = {
    chart: {
        id: 'track-axes', name: 'トラックのレーンの軸（振幅・周波数の軸、上の時間の目盛り）',
        paintedBy: [`${RT}:renderRuler`, `${SP}:paintSideAxis`],
        requires: ['ticks', 'axis'],
    },
    rows: [
        {
            id: 'track-axes.ticks', value: 'ticks', what: '時間の目盛り（上の定規）と横の軸のキャンバスの目盛り',
            computedIn: [`${RT}:renderRuler`, `${RT}:laneVisibleSeconds`, 'src/webview/runtime/laneAxes.ts:laneTimeTicks', `${SP}:paintSideAxis`, `${SP}:paintTimeAxis`],
            from: 'axis', trace: '見えている時間の窓から、比較台と同じ規則で決める。',
            tests: [
                TICK_PLACES.lanes,
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'track-axes.axis', value: 'axis', what: '時間の軸の名前（定規の右端）',
            computedIn: [`${RT}:renderRuler`, `${SP}:paintTimeAxis`],
            from: 'words', trace: '「時間 [s]」。部品（paintTimeAxis）が定規に描き、ダブルクリックで時間の範囲を入れる（openTimeRangePopup）。',
            tests: [
                t('src/test/laneAxes.test.ts', 'a lane axis names its quantity, unit and calibration as Compare\'s waveform axis does'),
            ],
            names: { quantity: true, unit: true },
        },
    ],
    knownGaps: {},
};
