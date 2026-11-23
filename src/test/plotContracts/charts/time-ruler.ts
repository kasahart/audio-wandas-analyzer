import { RT, t, type ChartContract } from '../model';

/**
 * トラックの時間の定規（行の上の 1 本）。行の図（波形とスペクトログラム）は新しい図の経路にあり、この表の行ではない
 * （docs/figure-list.md）。画面が自分で描くのは、行が共有する時間の軸の目盛りと名前だけ。
 */
export const timeRuler: ChartContract = {
    chart: {
        id: 'time-ruler', name: 'トラックの時間の定規',
        paintedBy: [`${RT}:renderRuler`, 'src/webview/runtime/timeRuler.ts:paintTimeRuler'],
        requires: ['ticks', 'axis'],
    },
    rows: [
        {
            id: 'time-ruler.ticks', value: 'ticks', what: '時間の目盛り',
            computedIn: [`${RT}:renderRuler`, 'src/webview/runtime/timeRuler.ts:timeRulerTicks', 'src/webview/runtime/timeRuler.ts:linearWindowEnds'],
            from: 'axis', trace: '見えている時間の窓から、図の部品と同じ規則（figure/ticks.ts の alongAxisTicks）で決め、行の幅の上のその時刻の位置に描く。',
            tests: [
                t('src/test/timeRuler.test.ts', 'the ruler\'s ticks are the Figure\'s time ticks, each at its time\'s place over the rows\' width'),
            ],
        },
        {
            id: 'time-ruler.axis', value: 'axis', what: '時間の軸の名前（定規の右端）',
            computedIn: [`${RT}:renderRuler`, 'src/webview/runtime/timeRuler.ts:paintTimeRuler'],
            from: 'words', trace: '「時間 [s]」。定規の右端に、どの軸の名前とも同じ合わせ方（fitAxisTitle）で描く。ダブルクリックで時間の範囲を入れる（openTimeRangePopup）。',
            tests: [
                t('src/test/timeRuler.test.ts', 'the ruler names its axis at its right end, fitted as every axis name is, and leaves out a number the name would cover'),
            ],
            names: { quantity: true, unit: true },
        },
    ],
    knownGaps: {},
};
