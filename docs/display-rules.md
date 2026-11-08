# 表示の規則

アナライザーのグラフが守る規則です。新しいグラフや描き方を足すとき、レビューするとき、バグを直すときはこの規則に照らします。規則が決まったら、直す PR でこの文書とテストを一緒に足します。

各規則の「テスト」は、その規則を確かめているテストです。`src/test/displayRules.test.ts` が、ここに書いたファイルとテスト名が実在するかを確かめます。「未」は、まだテストが効いていない画面や種類です。「未」が残る規則は同じテストの `PENDING` と一致する必要があります。テストを足して「未」を消したら `PENDING` からも消します。`PENDING` は減らす方向にだけ変え、増やす変更はレビューで止めます。

## R1 計算は全データ、間引きは描くときだけ

差分、群の中央値、最大差、レポートの Δ、入口の保持図の Δ は、Frame の全ビン・全サンプルから計算します。間引くのは計算した結果を描くときだけです。

- テスト: `python-backend/test_stage_combine.py` › test_a_narrow_difference_is_taken_bin_by_bin_and_kept_when_drawn
- テスト: `python-backend/test_stage_combine.py` › test_a_groups_median_is_taken_bin_by_bin_before_it_is_drawn
- テスト: `python-backend/test_known_answers.py` › test_the_cursor_spectrums_cut_row_and_every_bin_row_read_the_same_peaks
- 入口でスロットのキーを押し続けて出す保持図の Δ は、押したときに、その録音と基準の録音の全ビンを取り寄せて計算します。届くまでは表の 192 点の Δ を描き、題に「計算中」と出します。
- テスト: `src/test/entryHeldPlot.test.ts` › a held slot asks once for every bin of its file and its base, then draws its Δ from them (R1, R3)
- テスト: `src/test/uiSmoke/heldDelta.spec.ts` › a held slot draws its own channel's Δ against its base from every bin the hold asks for (R1, R3, R11)

## R2 線の間引きは区間ごとの最小と最大

点が画面より多い線（波形、スペクトル、ケプストラム、差分）は、区間ごとに最小と最大の点を、それぞれ自分の x の位置に残します。平均したり、最大だけを残したりしません。どの画面でも同じ線になります。

- テスト: `python-backend/test_stage_view.py` › test_more_bins_than_the_screen_shows_keep_each_buckets_lowest_and_highest_bin_at_every_zoom
- テスト: `python-backend/test_stage_combine.py` › test_a_difference_line_keeps_every_buckets_extremes_at_their_own_places
- テスト: `python-backend/test_analyzer.py` › test_a_cut_row_keeps_each_buckets_lowest_and_highest_bin_as_compare_does
- スペクトルの間引きは 1 つの関数（`stage_view.min_max_indices`）だけで行い、カーソルスペクトルもこれを使います。webview 側（`comparePanes.minMaxLine`）は同じ事例集で縛ります。
- テスト: `python-backend/test_stage_view.py` › test_spectrum_decimation_matches_the_shared_cases_the_webview_is_held_to
- テスト: `src/test/comparePanes.test.ts` › the webview thins a spectrum exactly as the backend does: the shared cases both test suites check (#683)
- テスト: `python-backend/test_known_answers.py` › test_the_cursor_spectrum_reads_each_channels_tone_at_its_frequency_and_amplitude
- テスト: `python-backend/test_known_answers.py` › test_band_levels_read_the_tones_rms_in_the_cursor_spectrum_and_in_compare
- 時間軸の線（トラックの波形、比較台の波形・レベルの時系列・ケプストラム）は、区間の区切りを 1 つの規則（`decimator.bucket_starts`）で決めます。比較台の差分の線（線形の軸）、トリガーのイベントやケプストラム・相関のピーク、熱図とトラックのスペクトログラムの時間のブロックも同じ区切りです。webview でさらに間引くときも、区間は描く範囲の先頭ではなく決まった位置から始まるので、パンしても線が揺れません。
- テスト: `python-backend/test_decimator.py` › test_every_time_decimation_shares_the_bucket_rule
- テスト: `python-backend/test_decimator.py` › test_a_difference_line_on_a_time_axis_buckets_as_the_lines_it_compares
- テスト: `python-backend/test_decimator.py` › test_a_lanes_spectrogram_columns_share_the_bucket_rule
- テスト: `src/test/waveformRenderer.test.ts` › decimateBuckets: パンしてもバケットの境界は動かない（div の倍数から始まる）
- ペアの図（伝達関数・位相・コヒーレンス）は、バックエンドが全ビンをそれぞれの周波数で返し、図がそれを区間ごとの最小と最大に間引いて描きます。間を飛ばして拾わないので、狭い共振・ノッチ・コヒーレンスの谷も残り、拡大すると範囲の全ビンが見えます。
- テスト: `python-backend/test_analysis_service.py` › test_pair_spectrum_keeps_every_bin_at_its_own_frequency_so_a_narrow_notch_stays
- 未: 入口の概観帯

## R3 拡大しても同じ規則で、範囲の中を全解像度で作り直す

拡大やパンでは、見えている範囲のデータを元の解像度から作り直し、R2 と同じ規則で描きます。拡大前の粗い線を引き伸ばしません。

- テスト: `python-backend/test_stage_view.py` › test_a_zoomed_spectrum_is_its_own_bins_in_the_range_on_screen
- テスト: `python-backend/test_stage_view.py` › test_a_zoomed_spectrums_buckets_are_laid_across_the_view_not_its_bins
- テスト: `python-backend/test_known_answers.py` › test_compare_reads_the_tone_at_its_frequency_and_amplitude_before_and_after_a_zoom
- テスト: `src/test/comparePanes.test.ts` › the held Δ zoomed in is drawn again from every bin between its ends, not the whole Δ decimated and stretched (R1, R3)
- テスト: `src/test/uiSmoke/spectrumDock.spec.ts` › the cursor spectrum zoomed in asks for its slices at full resolution, so the range on screen is drawn again from every bin (R3)
- テスト: `src/test/overlaySpectrumPainter.test.ts` › a full-resolution slice is thinned only to be drawn: every bin in a narrow zoomed range is kept, a bucket per two pixels across a wide one (R2, R3)
- テスト: `python-backend/test_analyzer.py` › test_zoomed_track_detail_draws_the_window_from_every_frame_in_it
- テスト: `python-backend/test_analyzer.py` › test_with_automatic_settings_a_zoom_window_gets_its_own_hop_and_its_columns
- テスト: `python-backend/test_analyzer.py` › test_a_zoom_window_costs_its_own_frames_and_samples_not_the_whole_files
- テスト: `src/test/uiSmoke/spectrogramZoom.spec.ts` › a zoomed spectrogram lane asks for its window again and draws it from that window's frames, not the whole file's stretched (R3)
- テスト: `src/test/spectrogramZoom.test.ts` › zoomed past the whole file columns, the lane asks for a window around the view that brings every frame it can show
- スペクトログラムのレーンは、周波数方向に狭い帯へ拡大したときも同じです。全体の行（最大 192 行）では足りなくなると、その帯の FFT のビンを取り直して描き、読み値もその行から読みます。行を引き伸ばしません。
- テスト: `python-backend/test_analyzer.py` › test_a_band_zoomed_track_detail_draws_the_band_from_its_own_fft_bins
- テスト: `src/test/spectrogramZoom.test.ts` › up the frequency axis: the whole range's rows serve a wide band; a narrow one asks for its own bins, a little wider than shown (R3)
- テスト: `src/test/uiSmoke/spectrogramZoom.spec.ts` › a spectrogram lane boxed to a narrow band asks for that band's own bins and draws and reads them, not the whole range's rows stretched (R3)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the lanes under a trigger zoom on their own (the recording's time, not the trigger's) and draw the signal at full resolution once zoomed

## R4 両軸に量・単位・基準

どのグラフも、縦軸と横軸に量の名前と単位を書きます。熱図は色の意味もカラーバーに量・単位・両端の値で書きます。カラーバーは比較の熱図もトラックのスペクトログラムも同じ部品（`paintColourBar`）で、図の右上に描きます。dB は wandas のレベル基準（「dB SPL re 20 µPa」など）で書きます。dB でも振幅でも、未校正なら未校正と書きます。重ねた線には凡例を付けます。カーソルスペクトルは軸が低いので、レベルの名前を凡例の頭にも書きます。

- テスト: `src/test/comparePanes.test.ts` › every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files
- テスト: `src/test/comparePanes.test.ts` › the level axis is named by wandas' level reference, and says uncalibrated from the calibration status, not the unit
- テスト: `src/test/stagePanes.test.ts` › a metric over time names what it measures on its value axis, from its unit
- テスト: `src/test/stagePanes.test.ts` › a heatmap names what its colour measures, with its unit and reference, for its colour bar
- テスト: `src/test/stagePanes.test.ts` › a colour bar stays inside a narrow plot: its name shrinks to the unit, then is left out
- テスト: `python-backend/test_stage_view.py` › test_a_time_signal_names_the_measure_a_step_made_of_it
- テスト: `src/test/uiSmoke/spectrumOctaveBands.spec.ts` › the cursor spectrum names its level axis as Compare does, uncalibrated, and its lines in a legend
- テスト: `src/test/overlaySpectrumPainter.test.ts` › renderSpectrumAxisLegend names every line by its colour, grouped by the side it is read on with two axes
- トラックのレーンの軸（振幅、スペクトログラムの周波数、上の時間の目盛り）も、比較のグラフと同じ目盛りの決め方・数字の書き方・文字・軸の名前で描きます（`laneAxes.ts`）。振幅の目盛りは、波形がその値を描く高さに置きます。
- テスト: `src/test/laneAxes.test.ts` › a waveform lane's amplitude ticks sit where the waveform draws their values, zoomed or not
- テスト: `src/test/laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses
- テスト: `src/test/laneAxes.test.ts` › a lane axis names its quantity, unit and calibration as Compare's waveform axis does

## R5 色は役割を表し、役割のない録音は録音ごとの色

基準は青、比較 1 は黄、比較 2 は紫、比較 3 はマゼンタ、差は緑、手順バーに置いた手順のうち動かないもの（実行して失敗した、サンプルレートや値が合わない、前の手順が動かない）はオレンジです（`src/shared/gui/roleColors.ts`）。役割のない録音は、録音ごとに自分の色（青緑・茶・オリーブ・砂色、役割・差・失敗の色と重ならない）を持ち、比較台でもトラック表示でもカーソルスペクトルとペアスペクトルでも、入口の保持図でも同じ色です。どのピークがどの録音の線かを色でたどれるようにするためです。ほかの録音の役割が変わっても、録音が足されても色は変わりません。役割を付けると役割の色になります。解析窓の帯は灰色です。＋ で選べない操作はオレンジにせず、灰色にして理由を書きます（R8）。

- テスト: `src/test/uiSmoke/stageReturn.spec.ts` › in Compare, colour is the role's: a recording without one has its own colour, its name in the legend
- テスト: `src/test/uiSmoke/roleChips.spec.ts` › in the track view, each recording without a role has its own colour on its lane and its chip, as in Compare; a role gives it the role's colour
- テスト: `src/test/renderScript.integration.test.ts` › directory selection mode keeps an existing track and its own colour when a new earlier tree item appears
- テスト: `src/test/canvasOverlays.test.ts` › drawAnalysisWindowBand is a neutral grey, not a role's or the failure's hue, on a dark and a light lane (R5)
- テスト: `src/test/entrySlots.test.ts` › a recording beside the table is drawn in its role's colour, else its track's own, else the first own colour (R5)
- テスト: `src/test/entryHeldPlot.test.ts` › a held step draws its row in the colour the row is drawn in elsewhere (its role's, else its own), not always slot 1's yellow (R5)
- 未: 差の緑、失敗のオレンジ

## R6 比較は重ね描き、静かなものが上

比較台は dB の差ではなく重ね描きです。実線で、塗りつぶしません。レベルの大きいものから描き、静かなものが最後に上に来ます。

- テスト: `src/test/stagePanes.test.ts` › overlaid lines are drawn loudest first, the quietest last on top, by their level on screen
- テスト: `src/test/stagePanes.test.ts` › waveforms are ordered by their envelope on the shared amplitude axis, whatever their level reference

## R7 ポインタの動きはどのグラフでも同じ

カーソル、最寄りの線の強調、読み値、拡大の操作は、どのグラフでも同じ部品で同じように動きます。マウスは、どの線の点でも、縦横の距離でマウスに一番近い点（半径 20 px 以内）を読みます。細いピークの少し横に置いても、頂上の近くなら頂上を読みます。半径の中に点がなければ、マウスの真下の周波数（時刻）で高さが一番近い線を読みます。矢印キーの移動は、1 ビンずつ動いた先を読みます。カーソルスペクトルとペアの図は、読んだ点の周波数でたがいのカーソルを合わせます。トラック表示の波形のレーンも同じで、マウスの下のレーンだけが点を読み（時刻は目盛りと同じ全体の時間軸）、ほかのレーンはその時刻に線を引きます。スペクトログラムのレーンは、ほかの色の図と同じく、マウスの下のマスの時刻・周波数・レベルを読みます。クリックで決めるカーソル（カーソルスペクトルの時刻と解析窓）はこれとは別です。

読み値は、どのグラフでもグラフに重ねず、グラフの外の決まった行に出します。重ねると、読みたい線のまわりが隠れるからです。読み値は、グラフのすぐ上の行に出します。比較の図は操作ボタンの行、その下の差の欄は差の見出しの行、トリガーのイベントの図の下に並ぶレーンはそのすぐ上の読み値だけの行、入口の保持図はその題の行、カーソルスペクトルとペアの図はそれぞれの見出しの行、見出しの行がないトラックのレーンはツールバーの行です。比較の図・差の欄・トリガーの下のレーン・入口の保持図・ペアの図は、マークも読み値も共通の部品（`plotHoverLayer.ts`）で描き、トラックのレーンは共通部品 `showPlotReadout` で書きます（カーソルスペクトルはまだ専用の関数で書いています）。この行は空のときも場所を取っておくので、マウスを乗せてもグラフは動きません。比較の図のこの行には、差が最大の点（見出し）は出しません。数字はマウスの読み値だけにして、どの数字が何かを迷わないようにします。Δ を押して開く差の欄は別で、その見出しには差が最大の点（差が出せないときはその理由）を出します。差の欄は差そのものを見る場所だからです。名前が長いときは名前の側を省略し、時刻（周波数）と値は省略しません。行の幅が足りないときは、読み値はボタンの下の段に移ります（グラフの上のままです）。値が行や画面の端からはみ出すことはありません。この決まりは UI テスト全件で確かめます。どのテストでも、読み値がグラフに重なって表示されたり、値が行や画面の端で切れたりしたら、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。

読み値と見出しの数字は、どのグラフでも同じ書き方です（`src/webview/plot/plotText.ts`）。周波数は 1 kHz 未満は Hz（整数でないときは小数 1 桁）、1 kHz 以上は kHz で 1 Hz まで（「1.016 kHz」「3.15 kHz」）書きます。ビンの間隔が 1 Hz より細かいときは、その間隔を見分けられる桁まで書く（0.73 Hz 間隔なら「1.0027 kHz」）ので、隣のビンが同じ数字になりません。レベルは 0.1 dB まで単位付き、時刻は秒、ほかの値は有効数字 3 桁です。負の数はハイフンではなく本物のマイナス記号（−）で書きます。マイナス記号を手で付けるコードは lint で止めます（`scripts/lint-webview-patterns.js`）。

- テスト: `src/test/plotText.test.ts` › a frequency reads in Hz below 1 kHz and in kHz to the hertz from there, so neighbouring bins never read the same (R7)
- テスト: `src/test/plotText.test.ts` › a frequency read among points finer than 1 Hz apart gets the digits that tell neighbouring bins apart (R7)
- テスト: `src/test/plotText.test.ts` › a level reads to a tenth of a decibel in its unit, a time in seconds, other values to three figures (R7)
- テスト: `src/test/plotText.test.ts` › a negative number is written with a true minus sign, its exponent too, never a hyphen (R7)
- テスト: `src/test/plotText.test.ts` › the same frequency and level read the same on the comparison, the cursor spectrum and a spectrogram lane (R7)
- テスト: `src/test/pairSpectrum.test.ts` › the plot under the pointer reads its nearest line in the row above, in its unit, and the others follow its frequency (R7, R8)
- テスト: `src/test/stagePanes.test.ts` › the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)
- テスト: `src/test/overlaySpectrumPainter.test.ts` › the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)
- テスト: `src/test/trackLaneHover.test.ts` › the pointer on a track lane reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)
- テスト: `src/test/trackLaneHover.test.ts` › the pointer on a spectrogram lane reads the cell under it: its frequency bin and level, with the time, in the toolbar (R7)
- テスト: `src/test/uiSmoke/trackLaneHover.spec.ts` › the pointer on a track's waveform reads the point nearest it as every plot of lines does: name, time and amplitude in the toolbar, gone off the lane (R7)
- テスト: `src/test/uiSmoke/trackLaneHover.spec.ts` › every ui-smoke test fails on a hover readout shown over a plot, whichever plot and readout it is (R7)
- テスト: `src/test/uiSmoke/trackLaneHover.spec.ts` › the lane readout keeps its room in the toolbar, so a hover never wraps it and moves the lanes; short of room, the name is cut, never the values
- テスト: `src/test/uiSmoke/trackCompare.spec.ts` › the comparison's step bar grows the chain with ＋, offers only what takes the Frame there, and the plot answers the lanes' gestures
- テスト: `src/test/trackStagePainter.test.ts` › the headline names no difference (the row holds the pointer's readout): the steps bypassed and the region; nothing while computing
- テスト: `src/test/uiSmoke/trackCompare.spec.ts` › the readout row above the comparison keeps the values whole at any width, with the base group's button in it, and a hover never moves the plots
- 未: Frame の全種類に対する同じ操作の確認

## R8 ＋ で選べる操作は結果を描く

＋ に出る操作は、選ぶと必ず結果のグラフが出ます。その録音で動かない、または意味のある結果にならない操作は、灰色にして理由を書きます。置いたあとに動かなくなった手順や、実行して失敗した手順は、オレンジで印を付けて理由を書きます。実行して失敗したときは wandas の理由です（R5）。

- テスト: `src/test/uiSmoke/trackStage.spec.ts` › a step that cannot run on these recordings says why: ＋ greys a 48 kHz-only step out, and a step failing on a file is marked with wandas' reason on the plot
- テスト: `python-backend/test_operation_catalog.py` › test_no_step_offered_on_a_recording_draws_a_flat_picture
- テスト: `python-backend/test_operation_catalog.py` › test_after_a_metric_the_steps_that_fail_on_its_series_are_refused
- テスト: `python-backend/test_operation_catalog.py` › test_the_step_bars_metric_rates_are_the_ones_wandas_gives
- テスト: `src/test/recipeSteps.test.ts` › after a metric, a filter or an FFT is judged at the metric's series rate and length, not the recording's

## R9 自動の範囲は切りのよい値

カラースケールや dB 軸を自動で決めるときは、端を切りのよい値に広げます。dB でない量（ラフネス、ケプストラム、係数など）の色と値の範囲も、入口の分布図の値軸も同じです。手で入れた値はそのままです。

- テスト: `src/test/uiSmoke/colourRangeRounding.spec.ts` › the auto colour scale opens with round dB ends, and typed ends are kept as typed
- テスト: `src/test/stagePanes.test.ts` › a colour or value range not in dB is widened to round ends, as a dB range is
- テスト: `src/test/distribution.test.ts` › the distribution's value axis opens at round ends, as every automatic range does (R9)

## R10 レイアウトが変わったら描き直す

パネルの大きさが変わったら、グラフをその大きさで描き直します。引き伸ばしたまま残しません。グラフはほかのグラフやレーンに重なりません。トリガーの重ね描きはトラックの上に自分の高さを保ち、トラックはその下でスクロールします。

- テスト: `src/test/uiSmoke/visibility.spec.ts` › track canvas width follows layout changes without a window resize event
- テスト: `src/test/uiSmoke/trackCompare.spec.ts` › a trigger added from ＋ fires at half the tracks' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events

## R11 凡例が名指すチャンネルを描く

多チャンネルの録音は、凡例が名指すチャンネルとして、入力を含むすべての段で描きます。チャンネルを平均した線を、一つのチャンネルの名前で描きません。役割のない録音は、表でその録音の最初の行のチャンネルとして描きます。手順の図は録音ごとに一つなので、ほかのチャンネルのレーンは空のまま残さず、隠します。

- テスト: `python-backend/test_scan_service.py` › test_the_input_is_drawn_as_the_channel_the_chain_picks_not_the_channels_mean
- テスト: `src/test/entryBase.test.ts` › a channel row is compared as its channel; recordings without it are left out and said
- テスト: `src/test/uiSmoke/trackStage.spec.ts` › a two-channel recording is one lane in the steps view: its second channel is left out, not drawn empty
- テスト: `src/test/uiSmoke/heldDelta.spec.ts` › a held slot draws its own channel's Δ against its base from every bin the hold asks for (R1, R3, R11)

## R12 チップの設定は wandas の引数どおり

手順の ⚙ は、＋ に出るすべての操作について、wandas が describe() で示す引数を、その型（整数・小数・真偽・文字・選択肢）と None をとるかどうかのとおりに出します。置いたばかりの手順は wandas の既定値で動き、触らずに適用しても Recipe は変わりません。どの欄のどの値も Recipe に書かれ、同じ値として読み戻されます。None をとる引数は None にできます（アプリが値を持つ理由のあるものはテストに理由と一緒に書きます）。Enter で適用するのは入力欄の上だけで、ボタンや「その他」の上ではそのボタンの動きです。選択肢のどれを選んでも結果が描かれ、dB の時系列はレベルとして描かれます。

- テスト: `src/test/stepParamsContract.test.ts` › the contract reaches every kind of field wandas describes
- テスト: `src/test/stepParamsContract.test.ts` › an untouched form changes nothing: Apply writes the Recipe as it was
- テスト: `src/test/stepParamsContract.test.ts` › every value a field can hold reaches the Recipe and comes back as that value
- テスト: `src/test/stepParamsContract.test.ts` › a parameter that takes None can be set to None from its field
- テスト: `src/test/stepParamsContract.test.ts` › Enter applies a form only from one of its fields; on a button or a disclosure it does what that control does
- テスト: `python-backend/test_operation_catalog.py` › test_every_choice_a_field_offers_runs_and_a_level_it_gives_is_drawn_as_a_level
- テスト: `python-backend/test_operation_catalog.py` › test_every_operation_runs_with_the_values_its_form_shows_written_into_the_recipe

## R13 グラフは 1 つの部品で描く

どのグラフも、共通の描画部品（`paintOverlay`、stagePanes.ts）で描きます。軸、層、マウス、拡大、読み値の行、空のときの表示は部品が持ち、各グラフはデータと層の種類と軸の名前を渡すだけです。部品で描いたキャンバスには印（`data-plot`）が付きます。UI テスト全件で、画面に出ている印のないキャンバスがあればそのテストを失敗にします。まだ部品に移っていないグラフは `src/test/uiSmoke/plotRegistry.ts` に理由と一緒に並べ、移したら外します。印のあるグラフには、どれにも同じ操作を加えて確かめます。マウスを乗せると読み値がすぐ上の行に出てグラフは動かない、Ctrl+ホイールで拡大してダブルクリックで戻る、軸のダブルクリックで範囲の入力が開く、両軸に名前がある、の 4 つです。ドラッグはどのグラフでも矩形ズームです（トラックのレーンと入口の分布図も同じ）。レーンのループは Alt+ドラッグ、時間ずらしは Shift+ドラッグで、矩形ズームのモード切り替えはありません。入口の分布図は群ごとの行を部品で描き、値の軸を下の帯に共有します。値の範囲選びは Alt+ドラッグです。ペアの図のように 1 本の周波数軸に縦に積んだ図（`data-plot-stack`）は、積んだ図の上の 1 行を読み値の行として共有します。トラック表示のレーンも 1 本の時間軸に積んだ図で、上のツールバーの行を共有します。レーンの値の軸はレーンの横の別のキャンバスにあり、レーンはそのキャンバスを `data-plot-axis` で指します（軸のダブルクリックはそこで確かめます）。まだ満たさないものは理由と一緒にテストの一覧に置きます。満たすようになったら一覧から外さないとテストが失敗するので、一覧は減る一方です。

- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a plot on screen that the plot component did not draw, unless plotRegistry.ts lists it (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the cursor spectrum answers the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › a trigger's events plot and the lanes under it answer the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the entry's held plot answers the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the pair view's gain, phase and γ² plots answer the same gestures as every plot (R13)
- テスト: `src/test/trackCanvasPainter.test.ts` › a spectrogram lane is drawn by the plot component over its whole width, with the colour bar every coloured picture draws in its top right (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the entry's overview strip answers the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the entry's distribution answers the same gestures as every plot: each group's row, on the value axis below them (R13)
- テスト: `src/test/uiSmoke/allButtons.spec.ts` › a drag on a spectrogram lane zooms into its time and frequencies; a double-click shows the whole again (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the track view's waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13)
