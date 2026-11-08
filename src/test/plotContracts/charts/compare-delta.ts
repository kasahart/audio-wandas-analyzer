import { SP, t, tt, type ChartContract } from '../model';

/** 比較台の Δ 欄 */
export const compareDelta: ChartContract = {
    chart: {
        id: 'compare-delta', name: '比較台の Δ 欄',
        paintedBy: ['src/webview/runtime/trackStagePainter.ts:paintStageOverlay'],
        requires: ['readout', 'step', 'delta', 'headline', 'range', 'ticks', 'axis'],
    },
    rows: [
        {
            id: 'compare-delta.delta', value: 'delta', what: 'Δ（比較 − 基準）の値そのもの',
            computedIn: ['python-backend/stage_combine.py:combine'],
            from: 'full', trace: 'バックエンドが全ビン・全サンプルで引いてから描くために間引く。単位や校正やサンプリング周波数が違えば出さない。',
            tests: [
                tt('python-backend/test_stage_combine.py', 'test_a_narrow_difference_is_taken_bin_by_bin_and_kept_when_drawn'),
                tt('python-backend/test_stage_combine.py', 'test_a_time_signals_difference_is_compare_minus_base_sample_by_sample'),
                t('python-backend/test_stage_combine.py', 'test_values_in_other_units_have_no_difference_whatever_the_frame'),
            ],
        },
        {
            id: 'compare-delta.readout', value: 'readout', what: 'Δ の読み値',
            computedIn: [`${SP}:lineRead`, `${SP}:cellRead`, 'src/webview/runtime/stageReader.ts:createStageReader', 'python-backend/full_read.py:read_line'],
            from: 'full', trace: 'Δ の層の full は stageReader.combined(base, compare, \'diff\')。バックエンドが全データの Δ からマウスのまわりを返す。',
            tests: [
                tt('python-backend/test_full_read.py', 'test_a_difference_is_read_bin_by_bin'),
                t('src/test/fullRead.test.ts', 'every line and image a plot draws says where its full data is read; bars are whole (R7)'),
            ],
        },
        {
            id: 'compare-delta.step', value: 'step', what: 'Δ の ← / → で進む先',
            computedIn: [`${SP}:stageStep`],
            from: 'full', trace: '読み値と同じ全データの Δ の次の点。',
            tests: [
                t('src/test/plotHoverLayer.test.ts', 'an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot\'s left edge (R7)'),
                t('src/test/fullRead.test.ts', 'an arrow key crosses silent points past one fetched window to the next point with a value (R7)'),
                tt('python-backend/test_full_read.py', 'test_a_difference_is_read_bin_by_bin'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)'),
            ],
        },
        {
            id: 'compare-delta.headline', value: 'headline', what: 'Δ の見出し（差が最大の位置と値）',
            computedIn: [`${SP}:stageHeadline`, `${SP}:atValue`, 'python-backend/stage_combine.py:difference_peak'],
            from: 'full', trace: 'バックエンドが画面に見えている部分の全データの Δ から |Δ| が最大の位置と値を探し（difference_peak、STFT の詰め物の列とケフレンシー 0 は除く）、Δ の peak として送る。webview は書くだけ。',
            tests: [
                tt('src/test/stagePanes.test.ts', 'the Δ pane\'s headline writes the backend\'s largest difference, found before thinning, never the largest point drawn'),
                tt('python-backend/test_stage_combine.py', 'test_the_headlines_largest_difference_is_found_among_every_value_at_its_own_place'),
                tt('python-backend/test_stage_combine.py', 'test_the_headline_is_found_before_rounding'),
                t('python-backend/test_stage_combine.py', 'test_the_headline_leaves_out_padding_columns_the_zero_quefrency_and_whatever_is_off_screen'),
            ],
        },
        {
            id: 'compare-delta.range', value: 'range', what: 'Δ の軸の自動の範囲（線）',
            computedIn: [`${SP}:stageDiffRange`, `${SP}:roundEdge`],
            from: 'extremes', trace: 'stageDiffRange は粗い Δ の絵（各区間の最小と最大）の端から ± を決める。',
            tests: [],
            gap: { severity: 'P2', why: '範囲を間引いた Δ から求めている。全データの Δ の端と一致することを確かめるテストがない。' },
        },
        {
            id: 'compare-delta.range-image', value: 'range', what: 'Δ の熱図の色の範囲（カラーバーの両端）',
            computedIn: [`${SP}:stageDiffRange`],
            from: 'thinned', trace: 'Δ の熱図の matrix はブロックごとに平均したマスで、その端を両端の数にする。',
            tests: [],
            gap: { severity: 'P1', why: 'カラーバーの両端の数を、描くために平均した Δ のマスから求めている。' },
        },
        {
            id: 'compare-delta.ticks', value: 'ticks', what: 'Δ の軸の目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickText`, `${SP}:levelTick`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'compare-delta.axis', value: 'axis', what: 'Δ の軸の名前（「Δ [dB]」）',
            computedIn: [`${SP}:stageAxes`],
            from: 'words', trace: 'dB の Δ は axisDelta（「Δ [dB]」）。何の Δ か（量）と基準を書かない。dB でない量は「Δ 量 [単位]」。',
            tests: [
                t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files'),
            ],
            names: { quantity: false, unit: true, reference: false },
            gap: { severity: 'P2', why: '「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。' },
            inFlight: 'claude/axis-quantity-unit',
        },
        {
            id: 'compare-delta.no-delta', value: 'label', what: 'Δ が出せない理由（見出しと図）',
            computedIn: ['src/webview/runtime/combineSource.ts:noDeltaNote'],
            from: 'input', trace: 'サンプリング周波数・単位・データの大きさの違いを理由として書く。数は出さない。',
            tests: [
                t('src/test/trackStagePainter.test.ts', 'with no difference, the Δ headline says the same reason as its plot: other rates, other units, too much data'),
            ],
        },
    ],
    knownGaps: {
        'compare-delta.range': 'P2',
        'compare-delta.range-image': 'P1',
        'compare-delta.axis': 'P2',
    },
};
