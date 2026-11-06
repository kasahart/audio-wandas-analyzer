# 表示の規則

アナライザーのグラフが守る規則です。新しいグラフや描き方を足すとき、レビューするとき、バグを直すときはこの規則に照らします。規則が決まったら、直す PR でこの文書とテストを一緒に足します。

各規則の「テスト」は、その規則を確かめているテストです。`src/test/displayRules.test.ts` が、ここに書いたファイルとテスト名が実在するかを確かめます。「未」は、まだテストが効いていない画面や種類です。「未」が残る規則は同じテストの `PENDING` と一致する必要があります。テストを足して「未」を消したら `PENDING` からも消します。`PENDING` は減らす方向にだけ変え、増やす変更はレビューで止めます。

## R1 計算は全データ、間引きは描くときだけ

差分、群の中央値、最大差、レポートの Δ は、Frame の全ビン・全サンプルから計算します。間引くのは計算した結果を描くときだけです。

- テスト: `python-backend/test_stage_combine.py` › test_a_narrow_difference_is_taken_bin_by_bin_and_kept_when_drawn
- テスト: `python-backend/test_stage_combine.py` › test_a_groups_median_is_taken_bin_by_bin_before_it_is_drawn
- テスト: `python-backend/test_known_answers.py` › test_the_cursor_spectrums_cut_row_and_every_bin_row_read_the_same_peaks

## R2 線の間引きは区間ごとの最小と最大

点が画面より多い線（波形、スペクトル、ケプストラム、差分）は、区間ごとに最小と最大の点を、それぞれ自分の x の位置に残します。平均したり、最大だけを残したりしません。どの画面でも同じ線になります。

- テスト: `python-backend/test_stage_view.py` › test_more_bins_than_the_screen_shows_keep_each_buckets_lowest_and_highest_bin_at_every_zoom
- テスト: `python-backend/test_stage_combine.py` › test_a_difference_line_keeps_every_buckets_extremes_at_their_own_places
- テスト: `python-backend/test_analyzer.py` › test_a_cut_row_keeps_each_groups_lowest_and_highest_bin
- テスト: `python-backend/test_known_answers.py` › test_the_cursor_spectrum_reads_each_channels_tone_at_its_frequency_and_amplitude
- テスト: `python-backend/test_known_answers.py` › test_band_levels_read_the_tones_rms_in_the_cursor_spectrum_and_in_compare
- 未: ペア解析（伝達関数・コヒーレンス）の拡大前の線、入口の概観帯

## R3 拡大しても同じ規則で、範囲の中を全解像度で作り直す

拡大やパンでは、見えている範囲のデータを元の解像度から作り直し、R2 と同じ規則で描きます。拡大前の粗い線を引き伸ばしません。

- テスト: `python-backend/test_stage_view.py` › test_a_zoomed_spectrum_is_its_own_bins_in_the_range_on_screen
- テスト: `python-backend/test_stage_view.py` › test_a_zoomed_spectrums_buckets_are_laid_across_the_view_not_its_bins
- テスト: `python-backend/test_known_answers.py` › test_compare_reads_the_tone_at_its_frequency_and_amplitude_before_and_after_a_zoom

## R4 両軸に量・単位・基準

どのグラフも、縦軸と横軸に量の名前と単位を書きます。熱図は色の意味もカラーバーに量・単位・両端の値で書きます。dB は wandas のレベル基準（「dB SPL re 20 µPa」など）で書きます。dB でも振幅でも、未校正なら未校正と書きます。重ねた線には凡例を付けます。カーソルスペクトルは軸が低いので、レベルの名前を凡例の頭にも書きます。

- テスト: `src/test/comparePanes.test.ts` › every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files
- テスト: `src/test/comparePanes.test.ts` › the level axis is named by wandas' level reference, and says uncalibrated from the calibration status, not the unit
- テスト: `src/test/stagePanes.test.ts` › a metric over time names what it measures on its value axis, from its unit
- テスト: `src/test/stagePanes.test.ts` › a heatmap names what its colour measures, with its unit and reference, for its colour bar
- テスト: `src/test/stagePanes.test.ts` › a colour bar stays inside a narrow plot: its name shrinks to the unit, then is left out
- テスト: `python-backend/test_stage_view.py` › test_a_time_signal_names_the_measure_a_step_made_of_it
- テスト: `src/test/uiSmoke/spectrumOctaveBands.spec.ts` › the cursor spectrum names its level axis as Compare does, uncalibrated, and its lines in a legend
- テスト: `src/test/overlaySpectrumPainter.test.ts` › renderSpectrumAxisLegend names every line by its colour, grouped by the side it is read on with two axes

## R5 色は役割を表し、役割のない録音は録音ごとの色

基準は青、比較 1 は黄、比較 2 は紫、比較 3 はマゼンタ、差は緑、手順バーに置いた手順のうち動かないもの（実行して失敗した、サンプルレートや値が合わない、前の手順が動かない）はオレンジです（`src/shared/gui/roleColors.ts`）。役割のない録音は、録音ごとに自分の色（青緑・茶・オリーブ・砂色、役割・差・失敗の色と重ならない）を持ち、比較台でもトラック表示でもカーソルスペクトルとペアスペクトルでも同じ色です。どのピークがどの録音の線かを色でたどれるようにするためです。ほかの録音の役割が変わっても、録音が足されても色は変わりません。役割を付けると役割の色になります。解析窓の帯は灰色です。＋ で選べない操作はオレンジにせず、灰色にして理由を書きます（R8）。

- テスト: `src/test/uiSmoke/stageReturn.spec.ts` › in Compare, colour is the role's: a recording without one has its own colour, its name in the legend; the headline names the difference
- テスト: `src/test/uiSmoke/roleChips.spec.ts` › in the track view, each recording without a role has its own colour on its lane and its chip, as in Compare; a role gives it the role's colour
- テスト: `src/test/renderScript.integration.test.ts` › directory selection mode keeps an existing track and its own colour when a new earlier tree item appears
- テスト: `src/test/canvasOverlays.test.ts` › drawAnalysisWindowBand is a neutral grey, not a role's or the failure's hue, on a dark and a light lane (R5)
- 未: 差の緑、失敗のオレンジ

## R6 比較は重ね描き、静かなものが上

比較台は dB の差ではなく重ね描きです。実線で、塗りつぶしません。レベルの大きいものから描き、静かなものが最後に上に来ます。

- テスト: `src/test/stagePanes.test.ts` › overlaid lines are drawn loudest first, the quietest last on top, by their level on screen
- テスト: `src/test/stagePanes.test.ts` › waveforms are ordered by their envelope on the shared amplitude axis, whatever their level reference

## R7 ポインタの動きはどのグラフでも同じ

カーソル、最寄りの線の強調、読み値、拡大の操作は、どのグラフでも同じ部品で同じように動きます。マウスは、どの線の点でも、縦横の距離でマウスに一番近い点（半径 20 px 以内）を読みます。細いピークの少し横に置いても、頂上の近くなら頂上を読みます。半径の中に点がなければ、マウスの真下の周波数（時刻）で高さが一番近い線を読みます。矢印キーの移動は、1 ビンずつ動いた先を読みます。カーソルスペクトルとペアの図は、読んだ点の周波数でたがいのカーソルを合わせます。トラック表示の波形のレーンも同じで、マウスの下のレーンだけが点を読み（時刻は目盛りと同じ全体の時間軸）、ほかのレーンはその時刻に線を引きます。クリックで決めるカーソル（カーソルスペクトルの時刻と解析窓）はこれとは別です。

- テスト: `src/test/pairSpectrum.test.ts` › the pointer picks the line nearest it and reads that lane only
- テスト: `src/test/stagePanes.test.ts` › the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)
- テスト: `src/test/overlaySpectrumPainter.test.ts` › the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)
- テスト: `src/test/pairSpectrum.test.ts` › the pointer reads the pair point nearest it within a few pixels, and names that point's frequency (R7)
- テスト: `src/test/trackLaneHover.test.ts` › the pointer on a track lane reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)
- テスト: `src/test/uiSmoke/trackLaneHover.spec.ts` › the pointer on a track's waveform reads the point nearest it as every plot of lines does: name, time and amplitude, gone off the lane (R7)
- 未: Frame の全種類に対する同じ操作の確認

## R8 ＋ で選べる操作は結果を描く

＋ に出る操作は、選ぶと必ず結果のグラフが出ます。その録音で動かない、または意味のある結果にならない操作は、灰色にして理由を書きます。置いたあとに動かなくなった手順や、実行して失敗した手順は、オレンジで印を付けて理由を書きます。実行して失敗したときは wandas の理由です（R5）。

- テスト: `src/test/uiSmoke/trackStage.spec.ts` › a step that cannot run on these recordings says why: ＋ greys a 48 kHz-only step out, and a step failing on a file is marked with wandas' reason on the plot
- テスト: `python-backend/test_operation_catalog.py` › test_no_step_offered_on_a_recording_draws_a_flat_picture
- テスト: `python-backend/test_operation_catalog.py` › test_after_a_metric_the_steps_that_fail_on_its_series_are_refused
- テスト: `python-backend/test_operation_catalog.py` › test_the_step_bars_metric_rates_are_the_ones_wandas_gives
- テスト: `src/test/recipeSteps.test.ts` › after a metric, a filter or an FFT is judged at the metric's series rate and length, not the recording's

## R9 自動の範囲は切りのよい値

カラースケールや dB 軸を自動で決めるときは、端を切りのよい値に広げます。手で入れた値はそのままです。

- テスト: `src/test/uiSmoke/colourRangeRounding.spec.ts` › the auto colour scale opens with round dB ends, and typed ends are kept as typed

## R10 レイアウトが変わったら描き直す

パネルの大きさが変わったら、グラフをその大きさで描き直します。引き伸ばしたまま残しません。グラフはほかのグラフやレーンに重なりません。トリガーの重ね描きはトラックの上に自分の高さを保ち、トラックはその下でスクロールします。

- テスト: `src/test/uiSmoke/visibility.spec.ts` › track canvas width follows layout changes without a window resize event
- テスト: `src/test/uiSmoke/trackCompare.spec.ts` › a trigger added from ＋ fires at half the tracks' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events

## R11 凡例が名指すチャンネルを描く

多チャンネルの録音は、凡例が名指すチャンネルとして、入力を含むすべての段で描きます。チャンネルを平均した線を、一つのチャンネルの名前で描きません。役割のない録音は、表でその録音の最初の行のチャンネルとして描きます。手順の図は録音ごとに一つなので、ほかのチャンネルのレーンは空のまま残さず、隠します。

- テスト: `python-backend/test_scan_service.py` › test_the_input_is_drawn_as_the_channel_the_chain_picks_not_the_channels_mean
- テスト: `src/test/entryBase.test.ts` › a channel row is compared as its channel; recordings without it are left out and said
- テスト: `src/test/uiSmoke/trackStage.spec.ts` › a two-channel recording is one lane in the steps view: its second channel is left out, not drawn empty
