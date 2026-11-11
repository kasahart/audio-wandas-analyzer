import { RT, SP, t, tt, type ChartContract } from '../model';

/** トラックのスペクトログラムのレーン */
export const trackSpectrogram: ChartContract = {
    chart: {
        id: 'track-spectrogram', name: 'トラックのスペクトログラムのレーン',
        paintedBy: ['src/webview/runtime/trackCanvasPainter.ts:paintTrackSpectrogram', `${RT}:drawSpectrogram`],
        requires: ['readout', 'step', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'track-spectrogram.readout', value: 'readout', what: 'スペクトログラムのレーンの読み値（時刻・周波数・レベル）',
            computedIn: ['src/webview/runtime/trackLaneHover.ts:spectrogramReadoutText', `${SP}:cellRead`, 'src/webview/runtime/laneReads.ts:createLaneReads'],
            from: 'full', trace: 'laneReads.spectrogram が本当の STFT のマスを取り寄せる。描くための平均したマスは読まない。',
            tests: [
                tt('src/test/trackLaneHover.test.ts', 'the pointer on a spectrogram lane reads the real STFT cell under it, not the cell averaged to draw it, and ← / → the next frame (R7)'),
                t('src/test/uiSmoke/spectrogramZoom.spec.ts', 'a spectrogram lane boxed to a narrow band asks for that band\'s own bins and draws and reads them, not the whole range\'s rows stretched (R3)'),
            ],
        },
        {
            id: 'track-spectrogram.step', value: 'step', what: 'スペクトログラムの ← / →（次のフレーム）',
            computedIn: [`${SP}:imageStep`],
            from: 'full', trace: '本当のマスの次の列。',
            tests: [
                tt('src/test/fullRead.test.ts', 'a spectrogram is read at its real cells, never the cells averaged to draw it, and stepped a frame at a time (R7)'),
            ],
        },
        {
            id: 'track-spectrogram.range', value: 'range', what: '色の自動の範囲（カラーバーの両端の数）',
            computedIn: ['src/webview/runtime/spectrogramRaster.ts:spectrogramDisplayBounds', 'python-backend/analyzer.py:_build_spectrogram', 'src/webview/runtime/figureModel.ts:roundedRange'],
            from: 'full', trace: 'spec.minDb / maxDb は _build_spectrogram が表示用に平均する前の全 STFT のマスの最小と最大（-inf のマスだけ除く。無音の -240 dB も数える）。上は全マスの最大、下は max(全マスの最小, 上 − 100 dB)（R9：デジタル無音が下端を決めない）を niceRange で丸めてカラーバーの両端に出す。',
            tests: [
                tt('python-backend/test_analyzer.py', 'test_spectrogram_colour_range_is_every_full_cells_not_the_cells_averaged_to_draw'),
                t('python-backend/test_analyzer.py', 'test_spectrogram_colour_range_counts_digital_silence_as_its_own_level'),
                t('src/test/uiSmoke/colourRangeRounding.spec.ts', 'the auto colour scale opens with round dB ends, and typed ends are kept as typed'),
                t('src/test/spectrogramDisplayBounds.test.ts', 'a track spectrogram\'s auto colours reach no more than 100 dB under its loudest STFT cell: digital silence (−240 dB) does not set the bottom (R9)'),
            ],
        },
        {
            id: 'track-spectrogram.ticks', value: 'ticks', what: '周波数の目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:colourEndText`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '周波数の範囲（ナイキストか入れた範囲）から部品が決める。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'track-spectrogram.axis', value: 'axis', what: '周波数の軸と色の名前',
            computedIn: ['src/webview/runtime/trackCanvasPainter.ts:paintTrackSpectrogram', 'src/webview/runtime/figureModel.ts:plainNames'],
            from: 'words', trace: '周波数 [Hz]、色はレベルの名前と基準。',
            tests: [
                t('src/test/trackCanvasPainter.test.ts', 'a spectrogram lane is drawn by the plot component over its whole width, with the colour bar every coloured picture draws in its top right (R13)'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'the track view\'s waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13)'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
    ],
    knownGaps: {},
};
