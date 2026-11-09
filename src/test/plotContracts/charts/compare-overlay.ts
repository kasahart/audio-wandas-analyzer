import { SP, t, tt, type ChartContract } from '../model';

/** 比較台の重ね図（トリガーのイベント図を含む） */
export const compareOverlay: ChartContract = {
    chart: {
        id: 'compare-overlay', name: '比較台の重ね図（トリガーのイベント図を含む）',
        paintedBy: ['src/webview/runtime/trackStagePainter.ts:paintStageOverlay', 'src/webview/runtime/trackStagePainter.ts:paintNoPicture'],
        requires: ['readout', 'step', 'order', 'range', 'ticks', 'axis', 'median'],
    },
    rows: [
        {
            id: 'compare-overlay.readout', value: 'readout', what: '線の読み値（位置と値）',
            computedIn: [`${SP}:stageHover`, `${SP}:lineRead`, `${SP}:atValue`, `${SP}:atText`, `${SP}:timeText`, 'src/webview/runtime/trackStagePainter.ts:overlayLayers', 'python-backend/full_read.py:read_line'],
            from: 'full', trace: '各層の full は stageReader.of（compare-combine の read）。バックエンドが保持した段の全ビン・全サンプルからマウスのまわりの窓を返す（full_read.py）。描いた間引きの線は読まない。',
            tests: [
                t('src/test/fullRead.test.ts', 'every layer a plot draws is given its full data, held or fetched: one given none is marked and reads no number, bars too (R7)'),
                t('src/test/stagePanes.test.ts', 'a level is read in its axis\'s own unit and reference, on the main axis, the right-hand one and a colour bar: never a bare dB beside "dBFS" (R4, R7)'),
                t('src/test/fullRead.test.ts', 'a picture\'s full data is held or fetched, never its drawn points: a band table without a key reads its every band at once, a line without one has none (R7)'),
                t('src/test/stagePanes.test.ts', 'the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)'),
                tt('src/test/uiSmoke/narrowFeatures.spec.ts', 'a hover and the arrow keys on the thinned whole spectrum read its real bins from the backend, one bin per key, each at its exact value (R7)'),
                tt('python-backend/test_full_read.py', 'test_a_recordings_spectrum_is_read_at_its_own_bins_not_its_picture'),
                tt('python-backend/test_full_read.py', 'test_a_signals_samples_are_read_one_by_one'),
            ],
        },
        {
            id: 'compare-overlay.readout-image', value: 'readout', what: '熱図（スペクトログラム、ラフネス、ケプストログラム）の読み値',
            computedIn: [`${SP}:imageHover`, `${SP}:cellRead`, 'python-backend/full_read.py:read_cells'],
            from: 'full', trace: '熱図の層の full は stageReader.of の cells。バックエンドが本当のマス（1 フレーム・1 ビン）を返す。描くための平均したマスは読まない。',
            tests: [
                tt('src/test/fullRead.test.ts', 'a spectrogram is read at its real cells, never the cells averaged to draw it, and stepped a frame at a time (R7)'),
                t('python-backend/test_full_read.py', 'test_an_images_cells_are_its_own_around_the_place_read'),
            ],
        },
        {
            id: 'compare-overlay.readout-dense', value: 'readout', what: '画面の幅より密な窓での最寄りの点（読み値の点の選び方）',
            computedIn: ['python-backend/full_read.py:read_line', 'python-backend/full_read.py:_nearest_on_screen', `${SP}:fullLineNear`, 'src/webview/runtime/fullRead.ts:fetchedSource', `${SP}:stageHover`],
            from: 'full', trace: '窓の点が多すぎると、バックエンドは画素の列ごとに最小・最大とマウスの高さに一番近い点に加えて、Webview が送るマウスの位置と画面の縮尺（fullLineNear の at と pixels）から、画面の上の本当の距離でマウスに一番近い点を全点から探して返す（_nearest_on_screen）。部品はその中から画面の距離で一番近い点を読むので、総当たりと同じ点になる。その答えは同じ位置・高さ・縮尺の読みにだけ使う。',
            tests: [
                tt('python-backend/test_full_read.py', 'test_a_dense_window_gives_each_pixel_columns_real_extremes_and_the_point_nearest_the_pointer'),
                tt('python-backend/test_full_read.py', 'test_a_dense_window_sends_the_point_nearest_the_pointer_on_screen_as_brute_force_finds_it'),
                tt('src/test/fullRead.test.ts', 'a window too dense to send whole is read where the pointer is: the point nearest it on screen, by its true distance, as brute force finds it; elsewhere, or at another level, its readout is empty until that place\'s points come; zoomed in further it is asked anew (R7)'),
            ],
        },
        {
            id: 'compare-overlay.pending', value: 'pending', what: '取り寄せた点が届くまでの読み値',
            computedIn: ['src/webview/runtime/fullRead.ts:fetchedSource', `${SP}:stageHover`, 'src/webview/runtime/trackStageGestures.ts:attachStageGestures'],
            from: 'full', trace: '何も届いていなければカーソルだけを出し読み値は空（pendingRead）。密な窓を別の高さで読むときも、前の高さで届いた点は読まず、その高さの点が届くまで空（fetchedSource の answer は自分の点か、同じ高さで同じ細かさの窓だけを答える）。届く前のトリガーのイベントのクリックは、届いてから決める（trackStageGestures の tap）。',
            tests: [
                tt('src/test/fullRead.test.ts', 'a window too dense to send whole is read where the pointer is: the point nearest it on screen, by its true distance, as brute force finds it; elsewhere, or at another level, its readout is empty until that place\'s points come; zoomed in further it is asked anew (R7)'),
                t('src/test/trackStageGestures.test.ts', 'a click on a trigger\'s event line while its full data is on its way is decided once it is in, never dropped; a double-click meanwhile still takes it back (R7)'),
            ],
        },
        {
            id: 'compare-overlay.readout-bands', value: 'readout', what: '1/3 オクターブ帯（棒）の読み値',
            computedIn: [`${SP}:lineRead`, 'python-backend/stage_view.py:_noct_view', 'src/webview/runtime/fullRead.ts:wholeBars', 'src/webview/runtime/stageReader.ts:createStageReader'],
            from: 'whole', trace: '帯は間引かない（NOctFrame の全帯）。バックエンドが全データの鍵を付けない帯の表は、stageReader が wholeBars で全帯を InlineFullSource にして読む。全データのない層は読み値を出さない（NO_FULL_DATA）。',
            tests: [
                t('src/test/fullRead.test.ts', 'every layer a plot draws is given its full data, held or fetched: one given none is marked and reads no number, bars too (R7)'),
                t('src/test/uiSmoke/trackCompare.spec.ts', 'the comparison shows a step\'s bands as bars, and hides the lanes\' own controls'),
            ],
        },
        {
            id: 'compare-overlay.readout-events', value: 'readout', what: 'トリガーのイベントごとの線の読み値（#n @ 時刻）',
            computedIn: [`${SP}:eventLayers`, 'src/webview/runtime/stageReader.ts:createStageReader'],
            from: 'full', trace: 'eventLayers がイベントごとに layer.full.event(id) を付け、stageReader が read に event を入れて頼む。バックエンドはそのイベントの全サンプルを返す。',
            tests: [
                tt('src/test/stageEventReads.test.ts', 'a trigger\'s event lines are each read at that event\'s every sample, never the points thinned to draw it, and ← / → step its samples (R7)'),
            ],
        },
        {
            id: 'compare-overlay.step', value: 'step', what: '← / → で進む先（次のビン・サンプル・フレーム）',
            computedIn: [`${SP}:stageStep`, `${SP}:imageStep`, 'src/webview/runtime/fullRead.ts:fetchedSource', 'src/webview/runtime/fullRead.ts:seekIn', 'python-backend/full_read.py:_seek_line'],
            from: 'full', trace: 'full のある層は、読んだ点から ← / → の向きに次の値のある点を 1 回の要求で探させ（seek）、その先 256 点（STEP_AHEAD）と一緒に全データから受け取り、次の本当の点を読む。無音がどれだけ長くても要求は 1 つ。棒も帯もその全帯（InlineFullSource）の次の値。',
            tests: [
                t('src/test/plotHoverLayer.test.ts', 'an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot\'s left edge (R7)'),
                t('src/test/fullRead.test.ts', 'an arrow key crosses silent points past one fetched window to the next point with a value (R7)'),
                t('src/test/fullRead.test.ts', 'an arrow key crosses a silence of any length in one read the backend answers, and the keys after it ask for nothing more: never a request per window, never one asked again (R7)'),
                t('src/test/stagePanes.test.ts', 'zoomed in on a signal\'s level axis, the arrow keys still step one sample at a time: a sample past the axis is read at its edge, never a stop (R7)'),
                tt('python-backend/test_full_read.py', 'test_an_arrow_keys_seek_crosses_a_silence_of_any_length_to_the_next_value_as_brute_force_finds_it'),
                tt('src/test/uiSmoke/narrowFeatures.spec.ts', 'a hover and the arrow keys on the thinned whole spectrum read its real bins from the backend, one bin per key, each at its exact value (R7)'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)'),
            ],
        },
        {
            id: 'compare-overlay.median', value: 'median', what: '基準の群の中央値の線（とその読み値）',
            computedIn: ['python-backend/stage_combine.py:combine', 'src/webview/runtime/stageReader.ts:createStageReader'],
            from: 'full', trace: 'バックエンドが群の各録音の全ビン・全サンプルから中央値をとり、そのあとで描くために間引く。読み値は combined(…, \'base\') で中央値の全データを読む。',
            tests: [
                tt('python-backend/test_stage_combine.py', 'test_a_groups_median_is_taken_bin_by_bin_before_it_is_drawn'),
                t('python-backend/test_full_read.py', 'test_a_medians_read_stops_where_its_picture_was_aligned_with_the_compared_one'),
            ],
        },
        {
            id: 'compare-overlay.order', value: 'order', what: '重ねる順（静かな線が上）',
            computedIn: [`${SP}:overlayOrder`, `${SP}:byLevel`, `${SP}:screenLevels`, `${SP}:drawnLevelsText`, `${SP}:paintPlot`, 'python-backend/stage_combine.py:level_bins', 'python-backend/full_read.py:read_level'],
            from: 'full', trace: '各線の levelBins（軸を 256 区間に分けた各区間のパワーと数）をバックエンドが間引く前の全データから作る。画面の端が値のある区間を切るときは、その線の全データから画面に見えている範囲の値を全部使って測る（Webview が持つ線はその場で、バックエンドが持つ線は full の level で read_level に頼む）。',
            tests: [
                t('src/test/stagePanes.test.ts', 'every plot draws its overlaid lines loudest first and the quietest last on top, whatever order the caller gives them (R6)'),
                tt('src/test/stagePanes.test.ts', 'the order comes from every value before thinning, never from the points drawn (R2, R6)'),
                t('src/test/uiSmoke/plotContract.spec.ts', 'every ui-smoke test fails on a plot on screen that drew a louder compared line over a quieter one (R6)'),
                t('python-backend/test_stage_combine.py', 'test_every_compared_level_line_carries_level_bins_whole_zoomed_and_as_a_median'),
                tt('python-backend/test_stage_combine.py', 'test_a_spectrums_level_bins_are_every_bins_power_not_the_drawn_points'),
                tt('src/test/stagePanes.test.ts', 'zoomed, lines are ordered by every value on screen: a loud peak just off screen, in a stretch the edge cuts, does not count (R6, R2)'),
                tt('src/test/stagePanes.test.ts', 'a line the webview holds every value of is ordered at once by its values on screen, the stretch cut by the edge too (R6)'),
                tt('python-backend/test_full_read.py', 'test_a_level_read_takes_every_value_inside_its_window_and_none_outside'),
            ],
        },
        {
            id: 'compare-overlay.order-pending', value: 'pending', what: '取り寄せたレベルが届くまでの重ねる順（data-plot-order の「…」）',
            computedIn: [`${SP}:screenLevels`, `${SP}:settledOrder`, `${SP}:drawnLevelsText`, `${SP}:paintOverlay`],
            from: 'full', trace: '端で切れた区間のレベルを取り寄せている間は、一部から推し量った順では描かない。そのグラフで最後に全部の値で決めた順を保ち（settledOrder、まだなければ渡された順）、data-plot-order に「…」と書く。全部届いたら部品が描き直す。UI テストは 5 秒たっても「…」のグラフを失敗にする。',
            tests: [
                tt('src/test/stagePanes.test.ts', 'while a line\'s level on screen is on its way, the plot keeps the order it last judged on every value: never one guessed from part of it (R6)'),
                tt('src/test/stagePanes.test.ts', 'zoomed, lines are ordered by every value on screen: a loud peak just off screen, in a stretch the edge cuts, does not count (R6, R2)'),
            ],
        },
        {
            id: 'compare-overlay.range', value: 'range', what: '線の値の軸の自動の範囲',
            computedIn: [`${SP}:stageRange`, `${SP}:roundEdge`, 'src/webview/runtime/trackStagePainter.ts:paintStageOverlay', 'src/webview/runtime/trackStagePainter.ts:byReference', 'src/webview/plot/waveformLayer.ts:waveformRange', 'python-backend/stage_combine.py:value_range', 'src/webview/runtime/figureModel.ts:dataRange', 'src/webview/runtime/figureModel.ts:levelAxes'],
            from: 'full', trace: 'バックエンドが全データ（StageData：間引く前の全点・全マス）の最小と最大を valueRange として絵に付け（value_range。無音の −300 dB の床は除く）、stageRange はその端から決める。時間信号は absolutePeak の ±1.05 倍を切りのよい端に広げる（waveformRange、R9）。webview が全部を持つ絵（帯の表・レベルの線）は描く値が全部。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                tt('src/test/stagePanes.test.ts', 'every range is set from the full data\'s lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)'),
                tt('python-backend/test_stage_view.py', 'test_every_pictures_value_range_is_its_full_datas_not_the_points_or_cells_drawn'),
            ],
        },
        {
            id: 'compare-overlay.range-image', value: 'range', what: '熱図の色の自動の範囲（カラーバーの両端の数）',
            computedIn: [`${SP}:stageRange`, `${SP}:points`, `${SP}:robustEdge`, 'python-backend/stage_view.py:_spectrogram_view', 'python-backend/stage_combine.py:value_range', 'src/webview/runtime/figureModel.ts:dataRange'],
            from: 'full', trace: '熱図の matrix は時間のブロックごとに平均したマスだが、色の範囲はバックエンドが平均する前の全マスから求めた valueRange（ケプストログラムは全係数の絶対値の 99 パーセント点 robust）から決める。dB の熱図は上を全データの最大、下を max(全データの最小, 上 − 100 dB) にする（heatmapDbRange、R9）。',
            tests: [
                tt('src/test/stagePanes.test.ts', 'every range is set from the full data\'s lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)'),
                tt('python-backend/test_stage_view.py', 'test_every_pictures_value_range_is_its_full_datas_not_the_points_or_cells_drawn'),
                tt('python-backend/test_stage_view.py', 'test_a_cepstrograms_colour_edge_is_its_full_coefficients_99th_percentile'),
                t('src/test/stagePanes.test.ts', 'a heatmap\'s colours reach no more than 100 dB under its loudest value: digital silence (−240 dB) does not set the bottom (R9)'),
            ],
        },
        {
            id: 'compare-overlay.ticks', value: 'ticks', what: '両軸の目盛りの値',
            computedIn: [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickTexts`, `${SP}:colourEndText`, `${SP}:paintRightAxis`, `${SP}:at`],
            from: 'axis', trace: '範囲（または窓）から部品が決める。データには触れない。',
            tests: [
                t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
                t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
            ],
        },
        {
            id: 'compare-overlay.axis', value: 'axis', what: '両軸の名前（レベル・振幅・周波数・時間・帯・ラグ・ケフレンシー）',
            computedIn: [`${SP}:stageAxes`, `${SP}:amplitudeAxisTitle`, 'src/webview/runtime/comparePanes.ts:paneAxes', 'src/webview/runtime/figureModel.ts:stageNames', 'src/webview/runtime/figureModel.ts:paneNames'],
            from: 'words', trace: 'stageAxes が Frame の種類と単位と校正から名前を作る。dB は wandas のレベル基準で書く。',
            tests: [
                t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files'),
                t('src/test/comparePanes.test.ts', 'the level axis is named by wandas\' level reference, and says uncalibrated from the calibration status, not the unit'),
                t('src/test/stagePanes.test.ts', 'a cross-channel picture names its pair on the value axis: the channel over its reference, before the unit'),
            ],
            names: { quantity: true, unit: true, reference: true },
        },
        {
            id: 'compare-overlay.axis-identity', value: 'axis', what: '重ねた線をどの値の軸に載せるか（左・右・重ねない）と、その軸の名前の校正の語',
            computedIn: ['src/webview/runtime/trackStagePainter.ts:byReference', 'src/webview/runtime/figureModel.ts:levelAxes', 'src/webview/runtime/figureModel.ts:axisInputOf', 'src/webview/runtime/figureModel.ts:byLevelKey', 'src/webview/runtime/figureModel.ts:calibrationWordsBy', 'src/webview/runtime/figureModel.ts:calibrationWords', 'src/webview/runtime/comparePanes.ts:levelIdentityOf', 'src/webview/runtime/figureModel.ts:legendWords'],
            from: 'words', trace: '線は録音のレベルの同一性（levelIdentityOf）で軸に分ける。軸の名前の文字では分けない。同一性が 3 つ以上なら重ねない。軸の名前は、その軸の線に校正済みが 1 本でもあればその録音の入力で書き、全部が未校正のときだけ未校正と書く。校正状態が混ざる軸では、未校正の線が凡例と読み値に自分で未校正と書く（calibrationWords）。',
            tests: [
                t('src/test/trackStagePainter.test.ts', 'overlaid, lines share an axis by their level identity, not their axis name: a gain-corrected FS file and a raw one are one axis, and only the raw one says uncalibrated (R1, R4)'),
                t('src/test/trackStagePainter.test.ts', 'overlaid, each line is on the axis of its own recording\'s reference: one shared, two split left and right as the cursor spectrum does, more not overlaid (A22, C1)'),
            ],
            exception: { rule: 'R4', quote: '軸の名前は量・単位・基準で書き、未校正はその軸の線がすべて未校正のときだけ書きます。' },
            names: { quantity: true, unit: true, reference: true },
        },
        {
            id: 'compare-overlay.axis-metric', value: 'axis', what: '指標・手順が作った量・dB の時間変化の値の軸',
            computedIn: [`${SP}:stageAxes`, `${SP}:metricName`, `${SP}:timeLevelTitle`, `${SP}:amplitudeAxisTitle`, 'python-backend/stage_view.py:signal_measure', 'src/webview/runtime/figureModel.ts:stageNames'],
            from: 'words', trace: '単位で決まる指標（sone・acum・asper）はその名前、手順の量（view.measure）は実効値・時間重み付き実効値・パワー、ほかは信号の単位の振幅（amplitudeAxisTitle）。dB の時間変化は何のレベルか（timeLevelTitle、measure はバックエンドが dB でも送る）をファイルの基準で書く。「値」とは書かない。',
            tests: [
                t('src/test/axisNames.test.ts', 'every axis a picture is drawn on names its quantity and unit, whatever it measures, with or without a unit, Δ or not (R4)'),
                t('src/test/stagePanes.test.ts', 'a metric or level over time names what it measures on its value axis, never a bare value or an amplitude in dB (R4)'),
                tt('python-backend/test_stage_view.py', 'test_a_time_signal_names_the_measure_a_step_made_of_it'),
            ],
            names: { quantity: true, unit: true },
        },
        {
            id: 'compare-overlay.axis-cepstrum', value: 'axis', what: 'ケプストラムの値の軸（「実ケプストラム」）',
            computedIn: [`${SP}:stageAxes`, 'src/webview/runtime/figureModel.ts:stageNames'],
            from: 'words', trace: 'axisCepstrum は「実ケプストラム [–]」：無次元の量を [–] と書く（R4）。',
            tests: [
                t('src/test/axisNames.test.ts', 'every axis-name string, in every language, names its quantity and its unit (R4)'),
                t('src/test/stagePanes.test.ts', 'a cepstrum is drawn on a quefrency axis, symmetric about zero without its zero-quefrency coefficient'),
            ],
            names: { quantity: true, unit: true },
        },
        {
            id: 'compare-overlay.headline', value: 'headline', what: '上の行の注記（トリガーのイベント数、区間）',
            computedIn: ['src/webview/runtime/trackStagePainter.ts:stageModeHeadline', `${SP}:stageEventCounts`],
            from: 'whole', trace: 'イベント数はバックエンドが切り出した全イベント（view.events は全部を運ぶ）の数。区間は利用者が決めた値。差は書かない。',
            tests: [
                t('src/test/trackStagePainter.test.ts', 'the headline names no difference (the row holds the pointer\'s readout): the steps bypassed and the region; nothing while computing'),
                t('src/test/uiSmoke/trackCompare.spec.ts', 'a trigger added from ＋ fires at half the tracks\' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events'),
            ],
        },
        {
            id: 'compare-overlay.region', value: 'label', what: '区間の印と名札（「区間 a–b s」）',
            computedIn: ['src/webview/runtime/trackStageMode.ts:paintNow', `${SP}:paintRegion`],
            from: 'input', trace: '区間のチップで決めた値を書く。',
            tests: [
                t('src/test/uiSmoke/trackCompare.spec.ts', 'a region set with its chip compares only that part of the files, shows on the plots, and holding a step shows the comparison without it'),
            ],
        },
        {
            id: 'compare-overlay.detail-key', value: 'identity', what: '拡大の細部の要求のキー（どの窓の細部か）',
            computedIn: ['src/webview/runtime/stageDetail.ts:detailSpecKey', 'src/webview/runtime/stageSource.ts:stageCacheKey'],
            from: 'axis', trace: 'キーは要求として送る窓の両端の数そのもの（丸めない）と点の数。取得の結果は、そのキーと送った StageDetail そのもので保つので、違うサンプル・ビンを求める 2 つの窓が同じ細部を使うことはない。',
            tests: [
                t('src/test/stageDetail.test.ts', "a detail's key is the range asked for exactly as it is sent: two deep windows a few samples apart never share one"),
                t('src/test/stageDetail.test.ts', "pictures are cached under the range sent, so a spec whose key matches another's never takes its detail"),
            ],
        },
    ],
    knownGaps: {},
};
