import { SP, t, type ChartContract } from '../model';

/** カラーバー（比較台の熱図、スペクトログラムのレーン、入口の概観帯） */
export const colourBar: ChartContract = {
    chart: {
        id: 'colour-bar', name: 'カラーバー（比較台の熱図、スペクトログラムのレーン、入口の概観帯）',
        paintedBy: [`${SP}:paintColourBar`],
        requires: ['ticks', 'axis'],
    },
    rows: [
        {
            id: 'colour-bar.ticks', value: 'ticks', what: 'カラーバーの両端の数の書き方',
            computedIn: [`${SP}:paintPlot`, `${SP}:endText`, `${SP}:levelTick`],
            from: 'axis', trace: '呼ぶ側の範囲の両端を書く（範囲の出どころは各熱図の range の行）。',
            tests: [
                t('src/test/stagePanes.test.ts', 'a colour or value range not in dB is widened to round ends, as a dB range is'),
            ],
        },
        {
            id: 'colour-bar.axis', value: 'axis', what: 'カラーバーの名前（量・単位・基準）',
            computedIn: [`${SP}:paintColourBar`, `${SP}:stageAxes`],
            from: 'words', trace: '熱図の色が表す量・単位・基準。目盛りの横に入らなければ上の行に図の幅で書き、軸の名前と同じく縮めるが、量と単位を必ず描く（UI テスト全件で data-plot-colour と描いた文字を照合）。',
            tests: [
                t('src/test/stagePanes.test.ts', 'a heatmap names what its colour measures, with its unit and reference, for its colour bar'),
                t('src/test/stagePanes.test.ts', 'a colour bar stays inside a narrow plot and never leaves out its name: beside the scale, else above it, shortened only as every axis name is (R4)'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
    ],
    knownGaps: {},
};
