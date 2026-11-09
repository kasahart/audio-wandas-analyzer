# 表示の規則

アナライザーのグラフが守る規則です。新しいグラフや描き方を足すとき、レビューするとき、バグを直すときはこの規則に照らします。規則が決まったら、直す PR でこの文書とテストを一緒に足します。

## 重大度

この規則に照らした問題は、次の 3 つの重さで数えます。

- P1: 画面に出る数（読み値、見出し、軸やカラーバーの端の数、レポートや CSV の数）が全データ（Frame の丸める前の値）から求めた値と違う、または違う点や違う版のデータ（別の解析条件・ファイル・チャンネル・校正）を指す。
- P2: この規則に反する経路に、実際の操作やデータで到達できる。または規則に反する実装でもテストが通る。軸やカラーバーの名前から量の名前か単位が消えるのは P2 です。
- P3: 数・点・データの版・軸の量と単位のどれにも影響しない見た目の問題。

各規則の「テスト」は、その規則を確かめているテストです。`src/test/displayRules.test.ts` が、ここに書いたファイルとテスト名が実在すること、そのテストが飛ばされず（skip や todo でない）、中で何かを確かめていること（assert や expect がある）を確かめます。「未」は、まだテストが効いていない画面や種類です。「未」が残る規則は同じテストの `PENDING` と一致する必要があります。テストを足して「未」を消したら `PENDING` からも消します。`PENDING` は減らす方向にだけ変え、増やす変更はレビューで止めます。

どのグラフのどの数を、どこで、何から計算し、どのテストが確かめているかは [グラフの数の契約表](plot-contracts.md) にあります。

## R1 計算は全データ、間引きは描くときだけ

差分、群の中央値、最大差、レポートの Δ、入口の保持図の Δ は、Frame の全ビン・全サンプルから計算します。間引くのは計算した結果を描くときだけです。

- テスト: `python-backend/test_stage_combine.py` › test_a_narrow_difference_is_taken_bin_by_bin_and_kept_when_drawn
- 丸めるのは画面とレポートに出す数だけです。中央値、Δ、その最大の点、重ね順のレベル、読み値の点選び、チャンネルのパワー平均は、Frame の丸める前の値で計算し、返す値だけを丸めます（`stage_view.floored_db` で計算し、`rounded_db` と `stage_combine._shown` は出す数だけに使う）。丸めると同じになる 2 つの値（−10.004 dB と −9.996 dB）の Δ は 0 ではなく 0.01 です。
- テスト: `python-backend/test_stage_combine.py` › test_a_difference_median_level_and_readout_are_taken_before_rounding_only_their_numbers_are_rounded
- テスト: `python-backend/test_stage_combine.py` › test_a_dense_readout_picks_its_points_from_unrounded_levels
- テスト: `python-backend/test_stage_view.py` › test_a_spectrums_channels_are_power_averaged_before_their_level_is_rounded
- テスト: `python-backend/test_stage_combine.py` › test_a_groups_median_is_taken_bin_by_bin_before_it_is_drawn
- テスト: `python-backend/test_known_answers.py` › test_the_cursor_spectrums_cut_row_and_every_bin_row_read_the_same_peaks
- 時間信号の段（「入力」やフィルタのチップ）は、wandas が返す時間信号のまま比べます。比較台が独自にレベル（ブロックごとの二乗平均）を作ることはしません。その Δ は比較から基準を引いた信号です（ChannelFrame の引き算、群なら基準のサンプルごとの中央値を引く）。全サンプルで引いてから、波形と同じく区間ごとの最小と最大で描きます。長さが違う録音は共通する部分で引き、サンプリング周波数が違う録音と、単位や校正（基準値）が違う録音は Δ を出さず、Δ の図と見出しにその理由を出します。Δ は有効数字 6 桁で返すので、小さい値どうしの差も 0 に丸まりません。レベルで比べたいときは、wandas のレベルの手順（`sound_level`、`rms_trend`）を足します。平均の幅はその手順のパラメータとしてレシピに残ります。
- テスト: `python-backend/test_stage_combine.py` › test_a_time_signals_difference_is_compare_minus_base_sample_by_sample
- 時間信号か、指標（ラウドネスなどの時間変化）かは、それを作った操作で決めます。サンプル数では決めません。短い録音も時間信号として波形で描き、長い録音とサンプルごとに比べます。
- 単位や校正（基準値）が違う録音どうしは、どの Frame でも Δ と中央値を出さず、その理由を出します（スペクトル、帯、スペクトログラム、指標も同じです）。
- テスト: `python-backend/test_stage_combine.py` › test_a_short_time_signal_is_a_signal_whatever_its_length
- テスト: `python-backend/test_stage_combine.py` › test_values_in_other_units_have_no_difference_whatever_the_frame
- テスト: `python-backend/test_stage_combine.py` › test_a_time_signal_at_another_rate_has_no_sample_difference
- テスト: `python-backend/test_stage_combine.py` › test_time_signals_in_other_units_or_calibrations_have_no_sample_difference
- テスト: `python-backend/test_stage_combine.py` › test_a_small_signal_difference_keeps_its_significant_figures
- テスト: `python-backend/test_stage_combine.py` › test_a_long_signals_difference_needs_no_array_of_times_or_float64_copy
- テスト: `src/test/trackStagePainter.test.ts` › with no difference, the Δ headline says the same reason as its plot: other rates, other units, too much data
- テスト: `python-backend/test_stage_view.py` › test_a_time_signal_is_its_own_values_never_a_level_the_comparison_makes
- テスト: `src/test/combineSource.test.ts` › a Δ that cannot be taken says why: too much data, other sample rates or units, or other axes
- 入口でスロットのキーを押し続けて出す保持図の Δ は、押したときに、その録音と基準の録音の全ビンを取り寄せて計算します。届くまでは何も描かず、題に「計算中」と出します。表の 192 点の Δ は描きません。全ビンが取れない録音（スキャンがビンを返さないとき）は、1/3 オクターブ帯の Δ を棒で描きます。帯のレベルは、スキャンが全ビンから求めた値です。レポートの図も同じで、全ビンがないときは、重ね図は 1/3 オクターブ帯のレベルを、Δ の図は帯の Δ の段だけを描きます。
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
- 時間軸の線（トラックの波形、比較台の波形・時系列・ケプストラム）は、区間の区切りを 1 つの規則（`decimator.bucket_starts`）で決めます。比較台の差分の線（線形の軸）、トリガーのイベント・相関の線、熱図とトラックのスペクトログラムの時間のブロックも同じ区切りです。webview でさらに間引くときも、区間は描く範囲の先頭ではなく決まった位置から始まるので、パンしても線が揺れません。
- テスト: `python-backend/test_decimator.py` › test_every_time_decimation_shares_the_bucket_rule
- テスト: `python-backend/test_decimator.py` › test_a_difference_line_on_a_time_axis_buckets_as_the_lines_it_compares
- テスト: `python-backend/test_decimator.py` › test_a_lanes_spectrogram_columns_share_the_bucket_rule
- テスト: `src/test/waveformRenderer.test.ts` › decimateBuckets: パンしてもバケットの境界は動かない（div の倍数から始まる）
- ペアの図（伝達関数・位相・コヒーレンス）は、バックエンドが全ビンをそれぞれの周波数で返し、図はそれを全部つないで描きます。間を飛ばして拾わないので、狭い共振・ノッチ・コヒーレンスの谷も残り、拡大すると範囲の全ビンが見えます。
- テスト: `python-backend/test_analysis_service.py` › test_pair_spectrum_keeps_every_bin_at_its_own_frequency_so_a_narrow_notch_stays
- 比較台の線は、どの種類も同じ規則です。コヒーレンスはスペクトルと同じく対数の区間ごとの最小と最大のビンを、相関・ケプストラム・時系列（時間信号、wandas のレベルや指標）は区間ごとの最小と最大の点を、それぞれ自分の x に残します（`stage_view._envelope`）。区間の中の 1 点だけを選んだり、決まった周波数に補間したりしません。トリガーのイベントは全イベントで x を共有するので、区間ごとの最小と最大を区間の両端に置きます（`stage_view._shared_envelope`）。正の山と負の谷が同じ区間にあっても両方残ります。
- テスト: `python-backend/test_stage_combine.py` › test_every_line_keeps_a_one_point_dip_and_peak_when_drawn
- テスト: `python-backend/test_stage_view.py` › test_a_long_cross_correlations_peak_is_drawn_at_its_own_lag
- 実際の録音（1 ビン幅の音と、それより大きい音が別の周波数にある 2 本）を、拡張機能と同じバックエンドで解析して比較台に出し、部品が実際に描いた線（`canvasAudit.ts` が記録する線の点）から読みます。全体を間引いて描いても狭い音はその高さのままです。
- テスト: `src/test/uiSmoke/narrowFeatures.spec.ts` › a narrow tone in real recordings is drawn at its full level on the thinned whole spectrum, and zoomed onto it the window is drawn again from every one of its own bins (R2, R3)
- 拡大の途中で間があいて（重いページで）途中の広い範囲を取り寄せていても、その先へ拡大した範囲はそれ自身の密度で取り寄せ直します。広い範囲の細部は、今の範囲を同じ細かさで描けるときだけ使います（`stageDetail.ts`）。
- テスト: `src/test/stageDetail.test.ts` › zoomed in past a range asked for on the way, the window is asked for again at its own density, not drawn from the wider one (R3)
- 比較台の Δ の見出し（差が一番大きい場所と値）は、描いた点ではなく、間引く前の全部の値から探します（`stage_combine.difference_peak`）。熱図でもブロックの平均時刻や帯の中心ではなく、その値の時刻と周波数を書きます。
- テスト: `python-backend/test_stage_combine.py` › test_the_headlines_largest_difference_is_found_among_every_value_at_its_own_place
- テスト: `python-backend/test_stage_combine.py` › test_the_headline_leaves_out_padding_columns_the_zero_quefrency_and_whatever_is_off_screen
- テスト: `src/test/stagePanes.test.ts` › the Δ pane's headline writes the backend's largest difference, found before thinning, never the largest point drawn
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
- 同じ実際の録音で、狭い音の上に拡大すると、図はその範囲のビンを取り寄せ（`detail` 付きの要求）、範囲の中のビンを 1 つ残らず、ビンの間隔（16000/8192 Hz）で描き直します。点の数は範囲のビンの数とほぼ同じで、全体を間引いた線がその範囲に持っていた点の 2 倍より多くなります。一番高い点はその音で、全体のときと同じ高さです。範囲の外のもっと大きい音は図に出ません。差の欄も同じで、差は範囲のビンから取り直します（`detail` 付きの `compare-combine`）。
- テスト: `src/test/uiSmoke/narrowFeatures.spec.ts` › a narrow tone in real recordings is drawn at its full level on the thinned whole spectrum, and zoomed onto it the window is drawn again from every one of its own bins (R2, R3)

## R4 両軸に量・単位・基準

どのグラフも、縦軸と横軸に量の名前と単位を書きます。熱図は色の意味もカラーバーに量・単位・両端の値で書きます。カラーバーは比較の熱図もトラックのスペクトログラムも同じ部品（`paintColourBar`）で、図の右上に描きます。カラーバーの名前は省きません。色の目盛りの横に入らないときは、目盛りの上の行に図の幅で書き、それでも入らなければ軸の名前と同じく小さくし、量と単位の 2 行に分け、量を縮めます（`axisTitle.ts` の `fitAxisTitle`）。UI テスト全件で、画面に出ている熱図のカラーバーが色の意味（`data-plot-colour`）を量と単位で描いていなければ、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。dB は wandas のレベル基準（「dB SPL re 20 µPa」など）で書きます。dB でも振幅でも、未校正なら未校正と書きます。重ねた線には凡例を付けます。カーソルスペクトルは軸が低いので、レベルの名前を凡例の頭にも書きます。

軸の名前は「量 [単位]」の形で、単位はいつも最後の角かっこに書きます。単位のない量（コヒーレンス γ²、相関係数、実ケプストラム、波高率、表の行）は「[–]」と書きます。単位がわからない量（単位を書いていない CSV の列、単位のない値）は「[unit unknown]」「[単位不明]」と書きます。CSV の列の名前が「温度 [°C]」「温度 (°C)」のように単位を書いていれば、その単位を軸に書きます。ペアの名前（「· ch2 / ch1」）は量の後、単位の前に書きます。軸の名前は省いてよい文字ではありません。軸に入りきらないときは、文字を小さくし、量と単位の 2 行に分け、それでも入らなければ量を記号（「γ²」）か頭の文字（「Amp…」）に縮めますが、量と単位はどちらも描きます（`src/webview/plot/axisTitle.ts`）。UI テスト全件で、画面に出ているグラフの軸の名前（`data-plot-axes`）に量と単位がなければ、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。値の軸の目盛りの数字は、どの高さのグラフでも重ねません。低いグラフでは目盛りを減らします（切りのよい刻みを粗くするか、細かい刻みを 1 つおきなどに間引く。`valueAxisTicks`、`spacedTicks`）。UI テスト全件で、画面に出ているグラフの 1 本の軸の目盛りの数字が重なって描かれたら、そのテストを失敗にします（同じファイル）。

- テスト: `src/test/comparePanes.test.ts` › every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files
- テスト: `src/test/comparePanes.test.ts` › the level axis is named by wandas' level reference, and says uncalibrated from the calibration status, not the unit
- テスト: `src/test/stagePanes.test.ts` › a metric over time names what it measures on its value axis, from its unit
- テスト: `src/test/stagePanes.test.ts` › a heatmap names what its colour measures, with its unit and reference, for its colour bar
- テスト: `src/test/stagePanes.test.ts` › a colour bar stays inside a narrow plot and never leaves out its name: beside the scale, else above it, shortened only as every axis name is (R4)
- テスト: `src/test/axisNames.test.ts` › every axis-name string, in every language, names its quantity and its unit (R4)
- テスト: `src/test/axisNames.test.ts` › every axis a picture is drawn on names its quantity and unit, whatever it measures, with or without a unit, Δ or not (R4)
- テスト: `src/test/axisNames.test.ts` › a CSV column's value axis names the unit its header gives, and says when it gives none
- テスト: `src/test/axisNames.test.ts` › a name too long for its axis keeps its quantity and its unit: smaller, on two lines, then its quantity shortened
- テスト: `src/test/tickLabels.test.ts` › no two tick labels on a value axis overlap, on a plot of any height: a short plot gets fewer ticks
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

線を重ねるグラフはどれも同じです（比較台、レポートの重ね図、カーソルスペクトル、ペアの図、トリガーのレーンなど）。描く順は呼ぶ側ではなく共通の部品 `paintOverlay`（`src/webview/runtime/stagePanes.ts` の `overlayOrder`）が決めるので、呼ぶ側がどの順で線を渡しても、静かな線が上に来ます。レベルは画面に見えている範囲の値で比べます。比べる値は間引く前の全部の値で、描いた点は使いません（R2）。処理部（または全データを持つ Webview）が、線ごとに軸を 256 の区間に分けて、各区間のパワーと値の数を `levelBins` として付けます。スペクトルは dB 値のパワー平均、波形はサンプルの二乗平均（共通の振幅軸で）です。区間が全部画面の中か外にあるときは `levelBins` だけで決まります。画面の端が値のある区間を切るときは、その区間のどの値が見えているかは `levelBins` ではわからないので、その線の全データ（`full`）から、画面に見えている範囲の値だけを全部使ってパワーを出します。Webview が全データを持つ線はその場で、バックエンドが持つ線（比較台の図・中央値、表示用に切ったカーソルスペクトルなど）は読み値と同じ仕組みで取り寄せます（`fullRead.ts` の `level`、バックエンドは `full_read.py` の `read_level`）。表示用に切ったカーソルスペクトルは、描くために残した点で `levelBins` を作らず、全ビンから測ります。届くまでは `data-plot-order` に「…」と書き、届いたら部品が描き直します。5 秒たっても「…」のままのグラフは UI テストを失敗にします。拡大して 1 サンプルずつになっても、直流の信号でも、正しい大きさになります。dB の線と波形で `levelBins` がないものは、`data-plot-order` に「?」と書き、UI テストを失敗にします。dB でない線（位相、γ²、分布の目盛りの線など）は、レベルのある線の後に、渡された順のまま描きます。比べる線でないもの（点や目盛りのしるし、塗った棒、ヒートマップ、レーンの一部だけを細かく描き直す部分）は、呼ぶ側が置いた位置のままです。右の第 2 のレベル軸の線は、その中で同じ順にします。トリガーのイベントは、その録音の線として一緒に並びます。色は役割の色のままで、順によって変わりません。マウスで強調した線は、この順とは別に、上の層に太く描きます。部品は描いた順の線のレベルを `data-plot-order` に書き、UI テスト全件で、画面に出ているグラフのどれかでレベルが上がる順に描いたら、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。

- テスト: `src/test/stagePanes.test.ts` › every plot draws its overlaid lines loudest first and the quietest last on top, whatever order the caller gives them (R6)
- テスト: `src/test/stagePanes.test.ts` › a picture that is not a compared line keeps the place its caller gave it among the overlay (R6)
- テスト: `src/test/stagePanes.test.ts` › no chart orders its own overlaid lines: the order is the plot component's alone (R6)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a plot on screen that drew a louder compared line over a quieter one (R6)

- テスト: `src/test/stagePanes.test.ts` › overlaid lines are drawn loudest first, the quietest last on top, by their level on screen
- テスト: `src/test/stagePanes.test.ts` › waveforms are ordered by their samples' mean square on the shared amplitude axis, whatever their level reference
- テスト: `src/test/stagePanes.test.ts` › the order comes from every value before thinning, never from the points drawn (R2, R6)
- テスト: `src/test/stagePanes.test.ts` › a level drawn with no levels from its values before thinning is written as unmeasured, for the audit to fail (R6)
- テスト: `src/test/stagePanes.test.ts` › zoomed, lines are ordered by every value on screen: a loud peak just off screen, in a stretch the edge cuts, does not count (R6, R2)
- テスト: `src/test/stagePanes.test.ts` › a line the webview holds every value of is ordered at once by its values on screen, the stretch cut by the edge too (R6)
- テスト: `src/test/overlaySpectrumPainter.test.ts` › the cursor spectrum orders a slice cut for display by every bin on screen, not by the points kept to draw it (R6, R2)
- テスト: `python-backend/test_full_read.py` › test_a_level_read_takes_every_value_inside_its_window_and_none_outside
- テスト: `python-backend/test_stage_combine.py` › test_a_signals_level_bins_are_its_samples_mean_square_whole_and_zoomed
- テスト: `python-backend/test_stage_combine.py` › test_every_compared_level_line_carries_level_bins_whole_zoomed_and_as_a_median

## R7 ポインタの動きはどのグラフでも同じ

カーソル、最寄りの線の強調、読み値、拡大の操作は、どのグラフでも同じ部品で同じように動きます。マウスは、どの線の点でも、縦横の距離でマウスに一番近い点（半径 20 px 以内）を読みます。細いピークの少し横に置いても、頂上の近くなら頂上を読みます。半径の中に点がなければ、マウスの真下の周波数（時刻）で高さが一番近い線を読みます。← / → は、マウスの下（またはキーボードで選んだグラフ）で読んでいる線の、間引く前のデータの次の点（ビン、帯、サンプル、熱図やスペクトログラムの次のフレーム）を、マウスをその点に置いたときと同じに読みます。1 ピクセルに何点重なっていても、どの拡大でも 1 点ずつ進みます。どのグラフでも同じ部品（`plotHoverLayer.ts` の `stepFrom`、キーは `trackPointerEvents.ts`）が受けます。ただし、キーボードのフォーカスがあるレーン（クリックしてカーソルを置いたレーン）では、マウスがそのレーンに乗っていても、← / → はこれまでどおりカーソルを動かします。読み値を動かすのは、フォーカスしたレーン以外のレーンと、レーンでないグラフです。カーソルスペクトルとペアの図は、読んだ点の周波数でたがいのカーソルを合わせます。トラック表示の波形のレーンも同じで、マウスの下のレーンだけが点を読み（時刻は目盛りと同じ全体の時間軸）、ほかのレーンはその時刻に線を引きます。スペクトログラムのレーンは、ほかの色の図と同じく、マウスの下のマスの時刻・周波数・レベルを読みます。クリックで決めるカーソル（カーソルスペクトルの時刻と解析窓）はこれとは別です。

読み値の数字は、どのグラフでも間引く前のデータから読みます。間引いたデータは線や絵を描くためだけに使います（R1、R2）。マウスが読む点も ← / → が進む先も、描いた点ではなく全解像度の点です。間引いて線から消えた点も、マウスに一番近ければその点の値を読みます。熱図とスペクトログラムは、画面のために平均したマスではなく、本当のマス（1 フレーム・1 ビン）の値を読みます。描く層は、それぞれ全データをどこから読むかを部品に宣言します（`fullRead.ts` の `StageLayer.full`）。描いた点がそのまま全部の点であるもの（棒、帯、ペアの図の全ビン、分布のビン）は 'drawn'、webview が全データを持つもの（カーソルスペクトルの全ビンの行、入口の概観の表）はその場で読み、バックエンドが持つもの（比較台の図・中央値・差、トラックのサンプルと STFT のマス、表示用に切ったカーソルスペクトル）は、マウスのまわりの窓だけを 1 つの仕組み（`fetchedSource`、バックエンドは `full_read.py`）で取り寄せます。取り寄せた窓は覚えておき、同時に送る要求は 1 つ、その間に動いたぶんは最後の 1 つだけを次に送ります。← / → の次の点はその窓の先 256 点まで一緒に来るので、キーごとに要求は出ません。窓が画面の幅より密なときは、画素の列ごとの最小・最大と、マウスの高さに一番近い点（どれも本当の点）だけを返します。届くまでは、カーソルだけを出し、読み値は空にします。全データの宣言がない層を描いたグラフは、部品がその印を付け（`data-plot-full`）、UI テスト全件がそれで失敗します（`canvasAudit.ts`）。

読み値は、どのグラフでもグラフに重ねず、グラフの外の決まった行に出します。重ねると、読みたい線のまわりが隠れるからです。読み値は、グラフのすぐ上の行に出します。比較の図は操作ボタンの行、その下の差の欄は差の見出しの行、トリガーのイベントの図の下に並ぶレーンはそのすぐ上の読み値だけの行、入口の保持図はその題の行、カーソルスペクトルとペアの図はそれぞれの見出しの行、見出しの行がないトラックのレーンはツールバーの行です。比較の図・差の欄・トリガーの下のレーン・入口の保持図・カーソルスペクトル・ペアの図は、マークも読み値も共通の部品（`plotHoverLayer.ts`）で描き、トラックのレーンは共通部品 `showPlotReadout` で書きます。左右に 2 本のレベル軸がある図（カーソルスペクトル）では、部品が両方の軸の線から一番近い点を読み（半径 20 px 以内の点が先で、拡大で図の外に出た線が図の端に寄せた位置で勝つことはありません）、レベルの線は読んだ軸の側までだけ引きます。この行は空のときも場所を取っておくので、マウスを乗せてもグラフは動きません。比較の図のこの行には、差が最大の点（見出し）は出しません。数字はマウスの読み値だけにして、どの数字が何かを迷わないようにします。Δ を押して開く差の欄は別で、その見出しには差が最大の点（差が出せないときはその理由）を出します。差の欄は差そのものを見る場所だからです。名前が長いときは名前の側を省略し、時刻（周波数）と値は省略しません。行の幅が足りないときは、読み値はボタンの下の段に移ります（グラフの上のままです）。値が行や画面の端からはみ出すことはありません。この決まりは UI テスト全件で確かめます。どのテストでも、読み値がグラフに重なって表示されたり、値が行や画面の端で切れたりしたら、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。

読み値と見出しの数字は、どのグラフでも同じ書き方です（`src/webview/plot/plotText.ts`）。周波数は 1 kHz 未満は Hz（整数でないときは小数 1 桁）、1 kHz 以上は kHz で 1 Hz まで（「1.016 kHz」「3.15 kHz」）書きます。ビンの間隔が 1 Hz より細かいときは、その間隔を見分けられる桁まで書く（0.73 Hz 間隔なら「1.0027 kHz」）ので、隣のビンが同じ数字になりません。レベルは 0.1 dB まで単位付き、時刻は秒、ほかの値は大きさによらず有効数字 3 桁です（「12.3」「1230」、100 万以上と 0.001 未満は指数）。ラグ・ケフレンシー・Bark・符号付きの差も同じファイルの書き方で、入口の分布図の読み値も表の列の書き方ではなくこの決まりで書きます（ピーク周波数は「3.15 kHz」）。分布図のビンの範囲と読み値は、ビンの幅を見分けられる桁まで書くので、隣のビンが同じ数字になりません。負の数はハイフンではなく本物のマイナス記号（−）で書きます。マイナス記号を手で付けるコード（ハイフンの置き換えや、`'−'` だけの文字列で符号を選ぶもの）は lint で止めます（`scripts/lint-webview-patterns.js`）。Markdown のレポートと、それが比較台と共有する書式（`src/shared/report/`、`src/shared/utils/format.ts`）も同じで、数を文字にするときは `plotText.ts`（`levelText`、`withMinus`）を通し（「−1.8 dBFS」）、通さずに `toFixed` などで書く行は同じ lint で止めます。

- テスト: `src/test/plotText.test.ts` › a frequency reads in Hz below 1 kHz and in kHz to the hertz from there, so neighbouring bins never read the same (R7)
- テスト: `src/test/plotText.test.ts` › a frequency read among points finer than 1 Hz apart gets the digits that tell neighbouring bins apart (R7)
- テスト: `src/test/plotText.test.ts` › a level reads to a tenth of a decibel in its unit, a time in seconds, other values to three figures (R7)
- テスト: `src/test/plotText.test.ts` › a negative number is written with a true minus sign, its exponent too, never a hyphen (R7)
- テスト: `src/test/plotText.test.ts` › every value has three significant figures however large: no false tenth and no exponent below a million (R7)
- テスト: `src/test/plotText.test.ts` › a lag, a quefrency, Bark and a signed number read the same on every plot (R7)
- テスト: `src/test/plotText.test.ts` › the distribution reads a value as a plot does, not as the table column writes it (R7)
- テスト: `src/test/plotText.test.ts` › neighbouring distribution bins never read the same: the bins' width adds the digits it needs (R7)
- テスト: `src/test/plotText.test.ts` › the lint stops a minus sign picked by hand, as a lone string or a replaced hyphen (R7)
- テスト: `src/test/plotText.test.ts` › the lint stops a number the report writes without plotText's minus: "-1.8 dBFS" (R7)
- テスト: `src/test/plotText.test.ts` › the same frequency and level read the same on the comparison, the cursor spectrum and a spectrogram lane (R7)
- テスト: `src/test/pairSpectrum.test.ts` › the plot under the pointer reads its nearest line in the row above, in its unit, and the others follow its frequency (R7, R8)
- テスト: `src/test/stagePanes.test.ts` › the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)
- テスト: `src/test/overlaySpectrumPainter.test.ts` › the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)
- テスト: `src/test/plotHoverLayer.test.ts` › an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot's left edge (R7)
- テスト: `src/test/plotHoverLayer.test.ts` › an arrow key steps to a point above or below the level axis as the pointer reads it there, held at the plot's edge (R7)
- テスト: `src/test/plotHoverLayer.test.ts` › with two level axes a point is read on either, and the level guide runs only to the axis it is read on
- テスト: `src/test/plotHoverLayer.test.ts` › with two level axes a line a level zoom clips off the plot is not read over a point on it within the pick radius
- テスト: `src/test/trackPointerEvents.test.ts` › ← / → step the readout of the plot under the pointer, or of a focused one, and go on when it reads nothing (R7)
- テスト: `src/test/trackPointerEvents.test.ts` › a lane with the keyboard focus keeps ← / → for its time cursor, even with the pointer on it; the pointer on another lane steps that one's readout (R7)
- テスト: `src/test/overlaySpectrumPainter.test.ts` › an arrow key reads the next bin the cursor spectrum drew, from the one the pointer read (R7)
- テスト: `src/test/trackLaneHover.test.ts` › the pointer on a track lane reads the file's own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)
- テスト: `src/test/trackLaneHover.test.ts` › the pointer on a spectrogram lane reads the real STFT cell under it, not the cell averaged to draw it, and ← / → the next frame (R7)
- テスト: `src/test/fullRead.test.ts` › a dense waveform is read at its real samples: a sample not drawn, and every sample by the arrow keys (R7)
- テスト: `src/test/fullRead.test.ts` › a window read is asked for once and kept: the pointer moving inside it asks for nothing more (R7)
- テスト: `src/test/fullRead.test.ts` › a level asked for while a read is on its way is never dropped for a newer read: the pointer's latest goes next, then the latest level (R6, R7)
- テスト: `src/test/fullRead.test.ts` › a spectrogram is read at its real cells, never the cells averaged to draw it, and stepped a frame at a time (R7)
- テスト: `src/test/fullRead.test.ts` › every line and image a plot draws says where its full data is read; bars are whole (R7)
- テスト: `src/test/overlaySpectrumPainter.test.ts` › a slice too dense to draw whole is read at its real bins: a bin thinned out of the line, and every bin by the arrow keys (R7)
- テスト: `python-backend/test_full_read.py` › test_a_window_with_few_points_is_read_whole_with_points_past_each_end
- テスト: `python-backend/test_full_read.py` › test_a_dense_window_gives_each_pixel_columns_real_extremes_and_the_point_nearest_the_pointer
- テスト: `python-backend/test_full_read.py` › test_an_images_cells_are_its_own_around_the_place_read
- テスト: `python-backend/test_full_read.py` › test_a_recordings_spectrum_is_read_at_its_own_bins_not_its_picture
- テスト: `python-backend/test_full_read.py` › test_a_difference_is_read_bin_by_bin
- テスト: `python-backend/test_full_read.py` › test_a_signals_samples_are_read_one_by_one
- テスト: `python-backend/test_full_read.py` › test_a_lane_reads_its_files_own_samples_and_stft_cells
- テスト: `src/test/uiSmoke/narrowFeatures.spec.ts` › a hover and the arrow keys on the thinned whole spectrum read its real bins from the backend, one bin per key, each at its exact value (R7)
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

どのグラフも、共通の描画部品（`paintOverlay`、stagePanes.ts）で描きます。軸、層、マウス、拡大、読み値の行、空のときの表示は部品が持ち、各グラフはデータと層の種類と軸の名前を渡すだけです。部品で描いたキャンバスには印（`data-plot`）が付きます。UI テスト全件で、画面に出ている印のないキャンバスがあればそのテストを失敗にします。まだ部品に移っていないグラフは `src/test/uiSmoke/plotRegistry.ts` に理由と一緒に並べ、移したら外します。印のあるグラフには、どれにも同じ操作を加えて確かめます。マウスを乗せると読み値がすぐ上の行に出てグラフは動かない、← / → で読み値が 1 点ずつ動く（グラフが読む全解像度のデータ（`plotHoverLayer.ts` の `notePlotRead` がグラフに残す読んだ点の層）の次の点にちょうど進み、2 点飛ばない）、Ctrl+ホイールで拡大してダブルクリックで戻る、ドラッグの矩形ズーム（下の軸の種類のとおり）、軸のダブルクリックで範囲の入力が開く、両軸に名前がある、の 6 つです。拡大と戻すは、属性だけでなく、描かれた絵が描き直されて変わったことで確かめます。場面ごとに、画面に出ている印のあるグラフを全部数え上げ、名前を挙げた検査のほかのものにも同じ検査をします（同じ種類のレーンは 1 本で代表します）。検査しないグラフは理由と一緒に `UNCHECKED` に置き、一覧は減る一方です。部品の外の描画は、別のキャンバスから `drawImage` で写したものも失敗にします。ドラッグはどのグラフでも矩形ズームで、囲んだ範囲に横軸と縦軸を合わせます（トラックのレーンも同じ）。入口の分布図の縦軸は群ごとの件数の軸で、どの範囲の値を見ていても 0 からその群の一番多いビンの上まで、いつもすべての件数を表示する軸と決めています。件数が軸の外に出ないためです。分布図の矩形ズームは値の軸（横軸）に効き、件数の軸はいつも全体のままです。これは拡大を省いたのではなく軸の性質で、共通の部品が軸の種類として持ちます（`plotInteraction.ts` の `VerticalAxis`、分布図は `'all-counts'`、ほかのグラフは `'zoom'`）。部品はグラフにその種類を書き（`data-plot-y-axis`）、矩形ズームの検査は、`'zoom'` のグラフでは両方の軸が囲んだ範囲に合ったこと、`'all-counts'` のグラフでは横軸が合って縦軸が全体のままで、その縦軸の名前が件数であることを確かめます。レーンのループは Alt+ドラッグ、時間ずらしは Shift+ドラッグで、矩形ズームのモード切り替えはありません。入口の分布図は群ごとの行を部品で描き、値の軸を下の帯に共有します。値の範囲選びは Alt+ドラッグで、矩形ズームと同じ共通の部品（`plotInteraction.ts`）が修飾キーで振り分けます。グラフのマウスとキーの扱いは、共通の部品のほかには書きません。トラック表示（時間軸）のレーンも、ドラッグ（矩形ズーム、Alt+ドラッグのループ、Shift+ドラッグの時間ずらし）、ホイール、軸のダブルクリックを共通の部品で受け、全レーンで 1 つの時間の窓を共有します。グラフが新しい操作を要るときは、部品にどのグラフでも使えるオプションとして足します。グラフのクリック（入口の概観の行選び、分布図のビン選び、トリガーのイベント線の除外）も、動かずに離した押下として部品の `tap` で受けます。部品の外でマウス、ポインタ、ホイール、クリック、ダブルクリック、キーを受けるモジュールは、グラフでないもの（境目のドラッグ、ポップオーバー、ボタンなど）に限り、受けるイベントごとに理由と一緒に `src/test/plotGestures.test.ts` の一覧に置きます。部品の下の低レベルのリスナー（`trackPointerEvents.ts`）を付けるのは `plotInteraction.ts` だけです。ペアの図のように 1 本の周波数軸に縦に積んだ図（`data-plot-stack`）は、積んだ図の上の 1 行を読み値の行として共有します。トラック表示のレーンも 1 本の時間軸に積んだ図で、上のツールバーの行を共有します。レーンの値の軸はレーンの横の別のキャンバスにあり、レーンはそのキャンバスを `data-plot-axis` で指します（軸のダブルクリックはそこで確かめます）。まだ満たさないものは理由と一緒にテストの一覧に置きます。満たすようになったら一覧から外さないとテストが失敗するので、一覧は減る一方です。

- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a plot on screen that the plot component did not draw, unless plotRegistry.ts lists it (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a picture copied into a plot from another canvas by anything but the plot component (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the cursor spectrum answers the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › a trigger's events plot and the lanes under it answer the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the entry's held plot answers the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the pair view's gain, phase and γ² plots answer the same gestures as every plot (R13)
- テスト: `src/test/trackCanvasPainter.test.ts` › a spectrogram lane is drawn by the plot component over its whole width, with the colour bar every coloured picture draws in its top right (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the entry's overview strip answers the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the entry's distribution answers the same gestures as every plot: each group's row, on the value axis below them (R13)
- テスト: `src/test/uiSmoke/allButtons.spec.ts` › a drag on a spectrogram lane zooms into its time and frequencies; a double-click shows the whole again (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the track view's waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13)
- テスト: `src/test/plotGestures.test.ts` › no webview module listens for pointer or key events of a plot outside the shared plot gestures, except those listed with why (R7, R13)
- テスト: `src/test/plotGestures.test.ts` › every plot's gestures are built on plotInteraction.ts: the shared listeners are called from nowhere else, the plots' ← / → context added nowhere else (R7, R13)
- テスト: `src/test/plotInteraction.test.ts` › on a plot whose vertical axis shows all counts, a box zooms its value axis and every count stays on screen (R13)
- テスト: `src/test/entryDistributionPane.test.ts` › Alt+drag on a row picks a range, as Alt+drag is on every plot (plotInteraction.ts); a plain drag is the plot's box zoom, not a pick
