import { SP, t, tt, type ChartContract } from '../model';

/** ペアの図（利得・位相・γ²） */
export const pairView: ChartContract = {
    chart: {
        id: 'pair-view', name: 'ペアの図（利得・位相・γ²）',
        paintedBy: ['src/webview/runtime/pairSpectrumPanel.ts:render'],
        requires: ['readout', 'step', 'order', 'range', 'ticks', 'axis', 'summary'],
    },
    rows: [
        {
            id: 'pair-view.readout', value: 'readout', what: '利得・位相・γ² の読み値',
            computedIn: ['src/webview/runtime/pairSpectrum.ts:pairLanes', `${SP}:lineRead`, 'src/webview/runtime/fullRead.ts:localLine', 'python-backend/analysis_service.py:pair_spectrum'],
            from: 'whole', trace: 'バックエンドが全ビンをそれぞれの周波数で返し、図はその全部をつなぐ。読み値は各応答の全ビンを持つ InlineFullSource（localLine）から読み、描いた線からは読まない。',
            tests: [
                t('src/test/pairSpectrum.test.ts', 'the plot under the pointer reads its nearest line in the row above, in its unit, and the others follow its frequency (R7, R8)'),
                t('python-backend/test_analysis_service.py', 'test_pair_spectrum_keeps_every_bin_at_its_own_frequency_so_a_narrow_notch_stays'),
            ],
        },
        {
            id: 'pair-view.step', value: 'step', what: '← / → で進む先',
            computedIn: [`${SP}:stageStep`, 'src/webview/runtime/fullRead.ts:localLine'],
            from: 'whole', trace: '全ビンを持つ InlineFullSource の次のビン。',
            tests: [
                t('src/test/uiSmoke/plotContract.spec.ts', 'the pair view\'s gain, phase and γ² plots answer the same gestures as every plot (R13)'),
            ],
        },
        {
            id: 'pair-view.order', value: 'order', what: '利得の線の重ねる順',
            computedIn: ['src/webview/runtime/pairSpectrum.ts:lines', `${SP}:levelBinsOf`],
            from: 'full', trace: '利得の levelBins を見えている周波数の全ビンから作る。',
            tests: [
                tt('src/test/pairSpectrum.test.ts', 'the pair view orders its gains by every bin on screen: the quieter response is drawn last, on top (R6)'),
            ],
        },
        {
            id: 'pair-view.order-unranked', value: 'order', what: '位相と γ² の線の順（渡された順）',
            computedIn: [`${SP}:overlayOrder`],
            from: 'input', trace: 'dB でない線はレベルで並べず、レベルのある線の後に渡された順のまま描く。',
            tests: [
                t('src/test/stagePanes.test.ts', 'every plot draws its overlaid lines loudest first and the quietest last on top, whatever order the caller gives them (R6)'),
            ],
            exception: { rule: 'R6', quote: 'dB でない線（位相、γ²、分布の目盛りの線など）は、レベルのある線の後に、渡された順のまま描きます。' },
        },
        {
            id: 'pair-view.range', value: 'range', what: '利得の軸の自動の範囲',
            computedIn: ['src/webview/runtime/pairSpectrum.ts:gainRange'],
            from: 'full', trace: '見えている周波数の全ビンの利得の最小・最大（幅は少なくとも 6 dB）を niceRange で切りのよい値に広げる（R9）。',
            tests: [
                tt('src/test/pairSpectrum.test.ts', 'the pair view\'s gain axis opens at round ends holding every bin on screen, a one-bin notch too, and only those (R9)'),
            ],
        },
        {
            id: 'pair-view.ticks', value: 'ticks', what: '目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める（位相は ±180°、γ² は 0〜1）。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'pair-view.axis', value: 'axis', what: '周波数・利得・位相の軸の名前',
            computedIn: ['src/webview/runtime/pairSpectrum.ts:pairLanes'],
            from: 'words', trace: '利得はバックエンドの axisLabel、位相 [°]、周波数 [Hz]。',
            tests: [
                t('src/test/pairSpectrum.test.ts', 'the pair view is three plots on one frequency axis, each named with its quantity and unit, drawing ok responses only'),
            ],
            names: { quantity: true, unit: true },
        },
        {
            id: 'pair-view.axis-coherence', value: 'axis', what: 'コヒーレンスの軸の名前（「γ²」）',
            computedIn: ['src/webview/runtime/pairSpectrum.ts:pairLanes'],
            from: 'words', trace: 'pairCoherenceLabel は「コヒーレンス γ² [–]」。狭いと記号「γ² [–]」に縮めるが単位は残す（axisTitle.ts）。',
            tests: [
                t('src/test/axisNames.test.ts', 'every axis a picture is drawn on names its quantity and unit, whatever it measures, with or without a unit, Δ or not (R4)'),
                t('src/test/pairSpectrum.test.ts', 'the pair view is three plots on one frequency axis, each named with its quantity and unit, drawing ok responses only'),
            ],
            names: { quantity: true, unit: true },
        },
        {
            id: 'pair-view.summary', value: 'summary', what: '見出し（H1・平均回数・時間の範囲）',
            computedIn: ['src/webview/runtime/pairSpectrum.ts:pairHeader', 'src/webview/runtime/pairSpectrum.ts:formatSeconds'],
            from: 'whole', trace: 'バックエンドが返した各応答の平均回数（最少）と範囲。（描くために間引いた形はない）',
            tests: [
                t('src/test/pairSpectrum.test.ts', 'the header shows the fewest averages and the whole averaged range, warning below 8'),
            ],
        },
    ],
    knownGaps: {},
};
