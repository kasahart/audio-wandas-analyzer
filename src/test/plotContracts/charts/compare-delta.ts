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
                t('python-backend/test_stage_combine.py', 'test_a_time_signals_difference_is_compare_minus_base_sample_by_sample'),
                t('python-backend/test_stage_combine.py', 'test_values_in_other_units_have_no_difference_whatever_the_frame'),
            ],
        },
        {
            id: 'compare-delta.identity', value: 'identity', what: 'Δ と中央値を出す録音の組（レベルの同一性）',
            computedIn: ['src/webview/runtime/comparePanes.ts:levelIdentityOf', 'src/webview/runtime/figureModel.ts:levelKeyOf', 'src/webview/runtime/figureModel.ts:figureUsed', 'src/webview/runtime/figureModel.ts:scanIdentity', 'python-backend/level_identity.py:level_identity', 'python-backend/stage_combine.py:_calibration'],
            from: 'whole', trace: '単位・基準値・レベル基準の名前の 3 つ（伝達関数は描くペアの単位の比の 3 つ）。webview とバックエンドが同じ表（levelIdentityCases.json）に同じ答えを返す。',
            tests: [
                t('src/test/levelIdentity.test.ts', 'levels compare only in one unit, reference and its label, whatever their calibration status: the webview answers the table the backend answers (R1, R4, A34)'),
                t('python-backend/test_level_identity.py', 'test_levels_compare_in_one_unit_reference_and_label_whatever_their_calibration_status'),
                t('python-backend/test_stage_combine.py', 'test_a_transfer_functions_difference_is_gated_by_its_pairs_unit_ratio_not_its_channels_level'),
            ],
            exception: { rule: 'R1', quote: '校正状態は含めません（ゲイン補正した FS の録音と補正していない FS の録音はどちらも dBFS なので比べます）。それでも校正状態の違う線が 1 本の軸に載るときは、未校正の線が読み値と凡例に自分で「未校正」と書きます（R4）。' },
        },
        {
            id: 'compare-delta.readout', value: 'readout', what: 'Δ の読み値',
            computedIn: [`${SP}:lineRead`, `${SP}:cellRead`, 'src/webview/runtime/stageReader.ts:createStageReader', 'python-backend/full_read.py:read_line'],
            from: 'full', trace: 'Δ の層の full は stageReader.combined(base, compare, \'diff\')。バックエンドが全データの Δ からマウスのまわりを返す。',
            tests: [
                tt('python-backend/test_full_read.py', 'test_a_difference_is_read_bin_by_bin'),
                t('src/test/fullRead.test.ts', 'every layer a plot draws is given its full data, held or fetched: one given none is marked and reads no number, bars too (R7)'),
            ],
        },
        {
            id: 'compare-delta.step', value: 'step', what: 'Δ の ← / → で進む先',
            computedIn: [`${SP}:stageStep`],
            from: 'full', trace: '読み値と同じ全データの Δ の次の点。',
            tests: [
                t('src/test/plotHoverLayer.test.ts', 'an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot\'s left edge (R7)'),
                t('src/test/fullRead.test.ts', 'an arrow key crosses silent points past one fetched window to the next point with a value (R7)'),
                t('python-backend/test_full_read.py', 'test_a_difference_is_read_bin_by_bin'),
                tt('src/test/entryHeldPlot.test.ts', '← / → on a held slot\'s Δ step to the next of every bin, not the next point drawn of the Δ thinned to the plot\'s width (R7)'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)'),
            ],
        },
        {
            id: 'compare-delta.headline', value: 'headline', what: 'Δ の見出し（差が最大の位置と値）',
            computedIn: [`${SP}:stageHeadline`, `${SP}:atValue`, 'python-backend/stage_combine.py:difference_peak'],
            from: 'full', trace: 'バックエンドが画面に見えている部分の全データの Δ から |Δ| が最大の位置と値を探し（difference_peak、STFT の詰め物の列とケフレンシー 0 は除く）、Δ の peak として送る。拡大中は、ズームが落ち着いてから webview が画面の窓そのもの（peakX、熱図は peakY も）を送り、詳細の周りの余白ではなくその窓だけで探す（_on_screen）。その窓の Δ が届くまで、見出しは位置を書かない。',
            tests: [
                t('src/test/stagePanes.test.ts', 'the Δ pane\'s headline writes the backend\'s largest difference, found before thinning, never the largest point drawn'),
                tt('python-backend/test_stage_combine.py', 'test_the_headlines_largest_difference_is_found_among_every_value_at_its_own_place'),
                t('python-backend/test_stage_combine.py', 'test_the_headline_is_found_before_rounding'),
                t('python-backend/test_stage_combine.py', 'test_zoomed_the_headlines_peak_is_looked_for_in_the_window_on_screen_alone_not_its_margin'),
                t('src/test/stagePanes.test.ts', 'zoomed, the Δ pane\'s headline names no point until the backend has looked for it in this window (A21, C4)'),
                t('python-backend/test_stage_combine.py', 'test_the_headline_leaves_out_padding_columns_the_zero_quefrency_and_whatever_is_off_screen'),
            ],
        },
        {
            id: 'compare-delta.range', value: 'range', what: 'Δ の軸の自動の範囲（線）',
            computedIn: [`${SP}:stageDiffRange`, `${SP}:roundEdge`, 'python-backend/stage_combine.py:value_range', 'src/webview/runtime/figureModel.ts:diffRange'],
            from: 'full', trace: 'バックエンドが全データの Δ（間引く前）の最小と最大を valueRange として Δ の絵に付け、stageDiffRange はその端から ± を決める。',
            tests: [
                tt('src/test/stagePanes.test.ts', 'every range is set from the full data\'s lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)'),
                t('python-backend/test_stage_combine.py', 'test_a_median_and_a_difference_carry_their_full_datas_value_range'),
            ],
        },
        {
            id: 'compare-delta.range-image', value: 'range', what: 'Δ の熱図の色の範囲（カラーバーの両端）',
            computedIn: [`${SP}:stageDiffRange`, 'python-backend/stage_combine.py:value_range', 'src/webview/runtime/figureModel.ts:diffRange'],
            from: 'full', trace: 'Δ の熱図の matrix はブロックごとに平均したマスだが、両端の数は平均する前の全マスの Δ の valueRange から決める。',
            tests: [
                tt('src/test/stagePanes.test.ts', 'every range is set from the full data\'s lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)'),
                t('python-backend/test_stage_combine.py', 'test_a_median_and_a_difference_carry_their_full_datas_value_range'),
            ],
        },
        {
            id: 'compare-delta.ticks', value: 'ticks', what: 'Δ の軸の目盛り',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:colourEndText`, `${SP}:paintRightAxis`],
            from: 'axis', trace: '範囲から部品が決める。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'compare-delta.axis', value: 'axis', what: 'Δ の軸の名前（「Δ [dB]」）',
            computedIn: [`${SP}:stageAxes`, 'src/webview/runtime/figureModel.ts:stageNames'],
            from: 'words', trace: 'dB の Δ は axisDelta（「差 Δ [dB]」）。量（差）と単位を書く。同じ基準の 2 つのレベルの差なので、差そのものの基準はない（基準は凡例と重ね図の軸）。dB でない量は「Δ 量 [単位]」。',
            tests: [
                t('src/test/axisNames.test.ts', 'every axis a picture is drawn on names its quantity and unit, whatever it measures, with or without a unit, Δ or not (R4)'),
                t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files'),
            ],
            names: { quantity: true, unit: true },
        },
        {
            id: 'compare-delta.no-delta', value: 'label', what: 'Δ が出せない理由（見出しと図）',
            computedIn: ['src/webview/runtime/combineSource.ts:noDeltaNote', 'src/webview/runtime/trackStageModel.ts:combineRequest', 'python-backend/scan_service.py:_stage_result'],
            from: 'input', trace: 'サンプリング周波数・単位・データの大きさの違いを理由として書く。数は出さない。保存の予算を超えた段の値には data キーを付けず（stageDataTooLarge）、結合を頼まず再走査もしないで「大きすぎる」と書く。',
            tests: [
                t('src/test/trackStagePainter.test.ts', 'with no difference, the Δ headline says the same reason as its plot: other rates, other units, too much data'),
                t('python-backend/test_scan_service.py', 'test_a_step_over_the_store_budget_is_not_named_by_a_key_it_was_refused'),
                t('src/test/entryHeldPlot.test.ts', 'a held step whose values the backend refused to keep asks for no combination and scans nothing again'),
            ],
        },
    ],
    knownGaps: {
    },
};
