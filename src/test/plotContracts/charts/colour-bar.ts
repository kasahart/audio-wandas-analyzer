import { SP, t, type ChartContract } from '../model';

/** カラーバー（比較台の熱図、スペクトログラムのレーン、入口の概観帯） */
export const colourBar: ChartContract = {
    chart: {
        id: 'colour-bar', name: 'カラーバー（比較台の熱図、スペクトログラムのレーン、入口の概観帯）',
        paintedBy: [`${SP}:paintColourBar`],
        requires: ['ticks', 'axis', 'range'],
    },
    rows: [
        {
            id: 'colour-bar.ticks', value: 'ticks', what: 'カラーバーの両端の数の書き方',
            computedIn: [`${SP}:paintPlot`, `${SP}:endText`, `${SP}:colourEndText`, 'src/webview/runtime/figureModel.ts:colourScale'],
            from: 'axis', trace: '呼ぶ側の範囲から作ったカラースケール（figureModel.colourScale：自動の端は書く桁まで外へ広げ、手で入れた端はそのまま）の両端を、丸めずに書く。色もこのスケールで塗る（R9）。',
            tests: [
                t('src/test/stagePanes.test.ts', 'a colour or value range not in dB is widened to round ends, as a dB range is'),
                t('src/test/colourScale.test.ts', 'a colour bar\'s end numbers are its colour scale: each, read back, is the end the colours are painted from, auto or typed, on the screen and in a report (R9)'),
                t('src/test/colourScale.test.ts', 'every place that makes a colour range gives a scale whose ends are written exactly: the comparison\'s images, their differences, the entry strip and the spectrogram lanes (R9)'),
            ],
        },
        {
            id: 'colour-bar.axis', value: 'axis', what: 'カラーバーの名前（量・単位・基準）',
            computedIn: [`${SP}:paintColourBar`, `${SP}:stageAxes`, 'src/webview/runtime/figureModel.ts:stageNames'],
            from: 'words', trace: '熱図の色が表す量・単位・基準。目盛りの横に入らなければ上の行に図の幅で書き、軸の名前と同じく縮めるが、量と単位を必ず描く（UI テスト全件で data-plot-colour と描いた文字を照合）。',
            tests: [
                t('src/test/stagePanes.test.ts', 'a heatmap names what its colour measures, with its unit and reference, for its colour bar'),
                t('src/test/stagePanes.test.ts', 'a colour bar stays inside a narrow plot and never leaves out its name: beside the scale, else above it, shortened only as every axis name is (R4)'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
        {
            id: 'colour-bar.range', value: 'range', what: 'カラーバーの上の軸の操作が動かす窓（Ctrl+ホイール、+ / − / 0、ドラッグ）と、ダブルクリックで開く色の範囲',
            computedIn: [`${SP}:stagePlotPoint`, 'src/webview/runtime/plotInteraction.ts:centredZoomWindow', 'src/webview/runtime/comparisonRuntime.ts:openSpectrogramRangePopup', 'src/webview/runtime/figureModel.ts:colourScale'],
            from: 'axis', trace: '帯の上かどうかは 1 つのヒットテスト（stagePlotPoint が部品の返した StagePlot.colourBar を見る）で決め、トラック表示のレーン、比較の熱図、入口の概観帯が同じものを使う。帯の上は値の軸で、Ctrl+ホイールは横軸を真ん中を中心に拡大（centredZoomWindow）、ドラッグは矩形を描かない。ダブルクリックは、トラック表示のレーンでは帯が書く端の数（StagePlot.colourScale）で色の範囲の入力を開き、ほかのグラフでは拡大を戻す（R13）。',
            tests: [
                t('src/test/uiSmoke/plotContract.spec.ts', 'every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)'),
                t('src/test/trackStageGestures.test.ts', 'over a heatmap\'s colour bar every axis gesture answers as on an axis, by the one hit test of it (stagePlotPoint): Ctrl+wheel zooms the horizontal axis about its middle, a press draws no box, a hover reads no cell, a double-click resets the zoom (R13)'),
                t('src/test/trackCanvasPainter.test.ts', 'a spectrogram lane is drawn by the plot component over its whole width, with the colour bar every coloured picture draws in its top right (R13)'),
            ],
        },
    ],
    knownGaps: {},
};
