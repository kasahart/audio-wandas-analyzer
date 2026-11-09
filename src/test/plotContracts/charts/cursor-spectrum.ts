import { RT, SP, t, tt, type ChartContract } from '../model';

/** カーソルスペクトル */
export const cursorSpectrum: ChartContract = {
    chart: {
        id: 'cursor-spectrum', name: 'カーソルスペクトル',
        paintedBy: ['src/webview/runtime/overlaySpectrumPainter.ts:paintOverlaySpectrum', `${RT}:renderOverlaySpectrum`],
        requires: ['readout', 'step', 'order', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'cursor-spectrum.readout', value: 'readout', what: '読み値（周波数・レベル）',
            computedIn: ['src/webview/runtime/spectrumRuntime.ts:spectrumReadoutValues', 'src/webview/runtime/spectrumRuntime.ts:spectrumReadoutText', 'src/webview/runtime/overlaySpectrumPainter.ts:readout', 'src/webview/runtime/overlaySpectrumPainter.ts:spectrumLayer', `${RT}:renderOverlaySpectrum`, 'src/webview/runtime/laneReads.ts:createLaneReads'],
            from: 'full', trace: '表示用に切ったスライスは laneReads.slice で全ビンの行を読み直し、全ビンの行はその場で読む（localLine）。帯は全帯。',
            tests: [
                tt('src/test/overlaySpectrumPainter.test.ts', 'a slice too dense to draw whole is read at its real bins: a bin thinned out of the line, and every bin by the arrow keys (R7)'),
                tt('src/test/fullRead.test.ts', 'a cursor spectrum read at its real bins writes its frequency to the digits those bins need, not the drawn points\' (R7)'),
                tt('python-backend/test_known_answers.py', 'test_the_cursor_spectrums_cut_row_and_every_bin_row_read_the_same_peaks'),
            ],
        },
        {
            id: 'cursor-spectrum.pending', value: 'pending', what: 'バックエンドのスライスが届くまでのカーソルスペクトル（線と読み値）、トラックの終わりの後の床',
            computedIn: ['src/webview/spectrum/cursorSpectrum.ts:extractSpectrumAtCursor', 'src/webview/spectrum/cursorSpectrum.ts:makeSilentSpectrumSlice', `${RT}:cursorSpectrumFor`, 'src/webview/runtime/overlaySpectrumPainter.ts:spectrumLayer'],
            from: 'full', trace: 'このカーソルのスライス（同じ設定で、このカーソルで変換したもの。sliceIsAtCursor）がまだないとき、前のカーソルのスライスがキャッシュにあってもそれは使わず、レーンの表示用スペクトログラムのカーソルの列を描くだけで（帯は前の帯を描くだけで）、standIn: \'pending\' の印を付ける。spectrumLayer はその線を読まない（読み値は届くまで空、R7）し、その値から levelBins を作らない。トラックの終わりの後の床は standIn: \'silence\' で、読みも測りもしない（帯も線として描き、描いたままは読まない）。届いたスライスは全ビンから読む。',
            tests: [
                tt('src/test/overlaySpectrumPainter.test.ts', 'until the backend\'s slice comes, the cursor spectrum draws the lane\'s averaged spectrogram column and reads nothing of it; past the end, nothing (R7)'),
                t('src/test/cursorSpectrum.test.ts', 'extractSpectrumAtCursor: cursor in middle picks middle bin'),
                tt('src/test/cursorSpectrum.test.ts', 'a cached slice from an earlier cursor is never drawn or read as this cursor\'s (R7)'),
            ],
        },
        {
            id: 'cursor-spectrum.step', value: 'step', what: '← / → で進む先（次のビン）',
            computedIn: [`${SP}:stageStep`],
            from: 'full', trace: '全ビンの行の次のビン。',
            tests: [
                t('src/test/overlaySpectrumPainter.test.ts', 'an arrow key reads the next bin the cursor spectrum drew, from the one the pointer read (R7)'),
                tt('src/test/overlaySpectrumPainter.test.ts', 'a slice too dense to draw whole is read at its real bins: a bin thinned out of the line, and every bin by the arrow keys (R7)'),
            ],
        },
        {
            id: 'cursor-spectrum.order', value: 'order', what: '重ねる順（静かな線が上）',
            computedIn: ['src/webview/runtime/overlaySpectrumPainter.ts:spectrumLayer', `${SP}:screenLevels`, `${SP}:overlayOrder`, 'python-backend/full_read.py:read_level'],
            from: 'full', trace: '全ビンの行は手元の全ビンから levelBins を作る。表示用に切ったスライス（frequenciesHz があるもの）は levelBins を作らず measured とし、画面に見えている範囲の全ビンを laneReads の level で測る。',
            tests: [
                tt('src/test/overlaySpectrumPainter.test.ts', 'the cursor spectrum orders a slice cut for display by every bin on screen, not by the points kept to draw it (R6, R2)'),
                t('src/test/stagePanes.test.ts', 'a cursor spectrum on a linear axis counts its 0 Hz bin in its level (R6)'),
            ],
        },
        {
            id: 'cursor-spectrum.range', value: 'range', what: 'レベルの軸の自動の範囲（左右の軸）',
            computedIn: ['src/webview/runtime/spectrumRuntime.ts:spectrumSeriesRange', 'src/webview/runtime/spectrumRuntime.ts:spectrumLevelRange', `${SP}:stageRange`, 'src/webview/runtime/spectrumRuntime.ts:overlayLevelAxes', `${RT}:applySpectrumDisplaySettings`, 'python-backend/analysis_service.py:spectrum_slice'],
            from: 'full', trace: 'slice.minDb / maxDb はバックエンドが行を表示用に切る（min_max_spectrum）前の全ビンの最小と最大。スライスが届くまでの代わりの列は表示用スペクトログラムの minDb / maxDb（全 STFT のマスの端）。全部の線の端を比較台の dB の線と同じ規則（stageRange: 5/10/20/25 dB 刻み、幅は 100 dB まで）で丸める。入力した端はそのまま。',
            tests: [
                t('src/test/spectrumPath.test.ts', 'the cursor spectrum\'s level axis follows the dB line rule: round steps, at most 100 dB, a silent line squashes nothing (R9)'),
                tt('python-backend/test_analysis_service.py', 'test_cursor_spectrum_level_range_is_every_bins_not_the_row_cut_for_display'),
                t('src/test/renderScript.integration.test.ts', 'renderScript: lazy spectrum slices apply display range settings'),
            ],
        },
        {
            id: 'cursor-spectrum.ticks', value: 'ticks', what: '周波数とレベルの目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。右の第 2 のレベル軸は自分の範囲の目盛り（valueAxisTicks）をその値の位置に書く。',
            tests: [
                t('src/test/overlaySpectrumPainter.test.ts', 'zoomed between two log ticks, the frequency axis still labels where it is'),
                t('src/test/stagePanes.test.ts', 'the right-hand level axis writes its own round ticks, each at the place of its own value, never the left axis\'s places relabelled (R4, R9)'),
            ],
        },
        {
            id: 'cursor-spectrum.axis', value: 'axis', what: '周波数とレベルの軸の名前、凡例の頭のレベルの名前',
            computedIn: ['src/webview/runtime/overlaySpectrumPainter.ts:paintOverlaySpectrum', 'src/webview/runtime/overlaySpectrumPainter.ts:renderSpectrumAxisLegend'],
            from: 'words', trace: 'レベルは比較台と同じ名前（基準・未校正）、周波数 [Hz]。',
            tests: [
                t('src/test/uiSmoke/spectrumOctaveBands.spec.ts', 'the cursor spectrum names its level axis as Compare does, uncalibrated, and its lines in a legend'),
                t('src/test/overlaySpectrumPainter.test.ts', 'paintOverlaySpectrum names the frequency axis at the right end of its ticks, as the comparison does'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
    ],
    knownGaps: {
    },
};
