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
            from: 'full', trace: 'スライスがまだないときはレーンの表示用スペクトログラムのカーソルの列を描くだけで、standIn: \'pending\' の印を付ける。spectrumLayer はその線を読まない（読み値は届くまで空、R7）し、その値から levelBins を作らない。トラックの終わりの後の床は standIn: \'silence\' で、読みも測りもしない（帯も線として描き、描いたままは読まない）。届いたスライスは全ビンから読む。',
            tests: [
                tt('src/test/overlaySpectrumPainter.test.ts', 'until the backend\'s slice comes, the cursor spectrum draws the lane\'s averaged spectrogram column and reads nothing of it; past the end, nothing (R7)'),
                t('src/test/cursorSpectrum.test.ts', 'extractSpectrumAtCursor: cursor in middle picks middle bin'),
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
            computedIn: ['src/webview/runtime/spectrumRuntime.ts:spectrumSeriesRange', 'src/webview/runtime/spectrumRuntime.ts:overlayLevelAxes', `${RT}:applySpectrumDisplaySettings`, 'python-backend/analysis_service.py:spectrum_slice'],
            from: 'extremes', trace: 'slice.minDb / maxDb はバックエンドが min_max_spectrum で切った行（各区間の最小・最大のビン）の最小と最大。端は全ビンと同じ。niceRange で丸める。',
            tests: [
                t('src/test/renderScript.integration.test.ts', 'renderScript: lazy spectrum slices apply display range settings'),
            ],
            gap: { severity: 'P2', why: '範囲を切った行から求めている。全ビンの最小・最大と一致することを確かめるテストがない。' },
        },
        {
            id: 'cursor-spectrum.ticks', value: 'ticks', what: '周波数とレベルの目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickText`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                t('src/test/overlaySpectrumPainter.test.ts', 'zoomed between two log ticks, the frequency axis still labels where it is'),
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
        'cursor-spectrum.range': 'P2',
    },
};
