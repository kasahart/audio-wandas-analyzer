# 表示の規則

アナライザーのグラフが守る規則です。新しいグラフや描き方を足すとき、レビューするとき、バグを直すときはこの規則に照らします。規則が決まったら、直す PR でこの文書とテストを一緒に足します。

## 重大度

この規則に照らした問題は、次の 3 つの重さで数えます。

- P1: 画面に出る数（読み値、見出し、軸やカラーバーの端の数、レポートや CSV の数）が全データ（Frame の丸める前の値）から求めた値と違う、または違う点や違う版のデータ（別の解析条件・ファイル・チャンネル・校正）を指す。
- P2: この規則に反する経路に、実際の操作やデータで到達できる。または規則に反する実装でもテストが通る。軸やカラーバーの名前から量の名前か単位が消えるのは P2 です。
- P3: 数・点・データの版・軸の量と単位のどれにも影響しない見た目の問題。

各規則の「テスト」は、その規則を確かめているテストです。`src/test/displayRules.test.ts` が、ここに書いたファイルとテスト名が実在すること、そのテストが飛ばされず（skip や todo でない）、中で何かを確かめていること（assert や expect がある）を確かめます。「未」（まだテストが効いていない画面や種類）の行が 1 つでもあれば、同じテストが失敗します。規則を足すときは、それが効く画面と種類を確かめるテストを一緒に足します。

どのグラフのどの数を、どこで、何から計算し、どのテストが確かめているかは [グラフの数の契約表](plot-contracts.md) にあります。

## R1 計算は全データ、間引きは描くときだけ

差分、群の中央値、最大差、レポートの Δ、入口の保持図の Δ は、Frame の全ビン・全サンプルから計算します。間引くのは計算した結果を描くときだけです。

- テスト: `python-backend/test_stage_combine.py` › test_a_narrow_difference_is_taken_bin_by_bin_and_kept_when_drawn
- 丸めるのは画面とレポートに書く文字だけです。中央値、Δ、その最大の点、重ね順のレベル、読み値の点選び、チャンネルのパワー平均は、Frame の丸める前の値で計算します（`stage_view.floored_db`）。バックエンドが webview に返す線の値・読み値の点（`full_read.py`、`seek` も）・Δ の最大の点も丸めずに送り（`stage_combine._sent`）、webview は最近傍の点選び、無音（−250 dB 以下）の判定、← / → の移動、重ね順を丸める前の値で行い、文字にするときだけ共通の書式（`plotText`）で丸めます。読み値の仕組みには丸める口がありません（`read_line` / `read_cells` は値をそのまま送る）。中央値と Δ は float64 で計算し、float64 のまま持ちます（0.5 と 0.5 + 2⁻²⁴ の中央値は 0.5 + 2⁻²⁵、それに対する 0.5 + 2⁻²⁴ の Δ は 0 ではなく 2⁻²⁵）。無音（−250 dB 以下）は、バックエンドが −300 dB に床付けするレベルとゲインだけのものです。Δ（レベルの Δ でも）や、プレーンな値・コヒーレンス・ケプストラム・相関・ラフネスには無音の床がなく、−260 dB の Δ も読み、← / → で止まり、線に描き、範囲に入れます（`stagePanes.floorless`、`stage_combine.floored`）。色として描くだけで読まれない画像のマスだけは、絵を小さくするために丸めます。丸めると同じになる 2 つの値（−10.004 dB と −9.996 dB）の Δ は 0 ではなく 0.01 です。入口の表・比較台・報告と CSV の Δ（Leq、帯、Δ 最大帯域、ビンごとの差）も、丸めた値どうしを引かず、丸める前の値を引いてから書くときだけ丸めます（`entryTable.levelDelta`）。scan もレベル（Leq、帯、全ビン）、クレストファクタ、ピーク周波数を wandas が測ったまま丸めずに送ります（解析仕様 v6。v5 までは 1e−4 dB に丸めていました）。互いに 1e−4 dB 以内の 3 つのレベルでも、群の中央値と Δ は丸める前の値のもので、0 にはなりません。CSV と画面の文字だけが丸めます。scan の 192 点（`ScanResult.spectrumDb`）は描くためだけの間引いた欄で、型は `Drawn`（`protocol_schema.py` の `x-drawn`）です。コンパイラが計算を拒むので、どの数にも使えません。この欄だけは、数にしない絵として、保存する結果を小さくするため 0.01 dB に丸めます（`analysis_spec.SPECTRUM_DRAWN_DECIMALS`）。間引かないことと精度を保つことは別で、録音のサンプルも、元の形式の値をそのまま保てる型で持ちます（`analysis_engine.source_dtype`：16・24 ビット PCM と 32 ビット浮動小数は float32 で正確に、64 ビット浮動小数・32 ビット PCM・CSV は float64）。STFT は float64 のサンプルから計算して complex128 で持ちます。レーンの読み値がそのマスを読むためです。数を小数の桁に丸める算術（`Math.round(v * 10) / 10` など）は `toFixed` と同じく数を書くものとして、契約表の検査が登録を求めます。
- テスト: `src/test/entryTable.test.ts` › a Δ is taken from the full levels and rounded only as written: −9.996 against −10.004 reads 0.0, never the 0.1 of levels rounded first (R7)
- テスト: `src/test/plotContracts.test.ts` › the detector finds a number written by a primitive, a helper imported under another name, a local alias of one, and rounding to decimals by arithmetic
- テスト: `python-backend/test_stage_combine.py` › test_a_difference_median_level_and_readout_are_taken_before_rounding_only_their_numbers_are_rounded
- テスト: `python-backend/test_stage_combine.py` › test_a_dense_readout_picks_its_points_from_unrounded_levels
- テスト: `python-backend/test_full_read.py` › test_a_read_sends_the_values_unrounded_so_the_webview_picks_tells_silence_and_steps_on_them
- テスト: `src/test/unroundedRead.test.ts` › the backend's read is unrounded end to end: of −10.004 and −9.996 dB the pointer picks the one it is nearest, and −249.999 dB is a point the arrow keys step onto, not silence (R1, R7)
- テスト: `src/test/unroundedRead.test.ts` › a Δ of −260 dB is a Δ, not silence: the backend's difference is read, stepped onto, drawn and ranged at −260 dB (R1, R7)
- テスト: `python-backend/test_stage_combine.py` › test_a_difference_has_no_silent_floor_its_range_and_reads_hold_a_delta_of_minus_260_db
- テスト: `src/test/unroundedRead.test.ts` › a median and a difference are taken in float64 end to end: of 0.5 and 0.5 + 2⁻²⁴ the median reads 0.5 + 2⁻²⁵, and the Δ of 0.5 + 2⁻²⁴ from it 2⁻²⁵, never 0 (R1)
- テスト: `python-backend/test_stage_combine.py` › test_a_median_and_a_difference_are_taken_and_kept_in_float64
- 録音が float32 で読まれていても（16 ビットの WAV など）、比較台が Frame から取る数は、チャンネルをまとめる前に float64（複素数は complex128）に直します。直すのは 1 か所（`stage_view.read_frame` が Frame の配列を取る `_taken`）だけで、平均・パワー平均・中央値などの計算はその後です。`read_frame` は読み取りのすべての配列（値・軸・トリガーのイベントの行、あとから足した欄も）を確かめ、float64 / complex128 でなければその場でエラーにします。ほかの関数（描く関数や `stage_combine.py`）は変換しません。読み取りはもう float64 で、あとで直しても float32 で取ったチャンネルの平均は戻らないからです。float32 のまま平均すると、float32 の 1 段だけ違う 2 つの値の平均がどちらかに丸まります。
- テスト: `python-backend/test_frame_reading.py` › test_every_array_of_a_reading_is_float64_whatever_the_recordings_dtype
- テスト: `python-backend/test_frame_reading.py` › test_a_float32_trigger_events_channel_mean_is_taken_in_float64
- テスト: `python-backend/test_frame_reading.py` › test_read_frame_refuses_a_reading_with_any_array_not_in_float64
- テスト: `src/test/unroundedRead.test.ts` › a dense window read beyond the pick radius of every point reads the real sample under the pointer, which the backend sends (R7)
- テスト: `python-backend/test_full_read.py` › test_a_dense_window_sends_the_point_under_the_pointer_and_names_it
- 設定の初期値にする数も同じです。トリガーを足したときのレベルの初期値は、比較しているチャンネルの、領域の中のピーク（一番大きい |サンプル|）の半分です。このピークは、レーンの読み値と同じ道（`fullRead.ts` の `FullSource.level`、バックエンドは `full_read.read_level` の `peak`）で、元のサンプル全部から読みます（`src/webview/runtime/regionPeak.ts`）。レーンに描く包絡（間引いた最小・最大）からは計算しません。包絡は領域の中の一番大きいサンプルを持っていないことがあるからです。
  - 読んでいる途中（pending）と、読み取りが失敗したとき（failed）は、ピークの数はありません。推し量った値を初期値にしません。そのときに足したトリガーは処理そのものの既定値で始まり、フッターにそう書きます（`stepPeakUnread`）。
  - 答えを覚えておくこと、失敗した読み取りを 5 秒の間を置いて出し直すことは、ほかの読み値と同じ決まり（`fetchedSource`、`answerStore.ts`）に任せます。ここに別のキャッシュや出し直しを足しません。
  - サンプルを読みに行くのは、トリガーを足せるときだけです。＋ のメニューを開いてトリガーが選べるときと、トリガーを足すときに、ステップバーが読みます（`StepBarState.peak` は値ではなく読む関数です）。グラフを描き直すたびには読みません。読むのは比較しているスロットのチャンネルだけで、トラックに並んでいるほかのファイルは読みません。
  - 30 本を超える録音を、頼まれずにまとめて計算しない、というこのプロジェクトの決まりは、ここでも同じです。ピークを出すのに 30 本を超える録音のサンプルが要るときは、1 本も読みません（`regionPeak` の `tooMany`。上限は基準の群を止めるのと同じ定数 `trackStageMode.ts` の `LARGE_BASE` で、別の定数は作りません）。そのときに足したトリガーは処理そのものの既定値で始まり、フッターに「録音が多いのでピークを読んでいない」と書きます（`stepPeakTooMany`）。
- テスト: `src/test/regionPeak.test.ts` › the peak of more recordings than the limit is not read at all: 31 recordings start no read and say so, 30 are read; channels of one recording count once (R1)
- テスト: `src/test/uiSmoke/triggerDefault.spec.ts` › opened from the tracks with 31 recordings and no slot chosen, the comparison is of two of them and only those two are read for a trigger's level: never all 31 (R1)
- テスト: `src/test/uiSmoke/triggerDefault.spec.ts` › a trigger added on a region starts at half the region's true peak, read from every sample by the real backend; added while that read is on its way it keeps its own level and the footer says so (R1)
- テスト: `src/test/uiSmoke/triggerDefault.spec.ts` › with a hundred files open and thirty of them on the tracks, the samples for a trigger's level are asked only when ＋ offers a trigger, and only of the two compared slots (R1)
- テスト: `src/test/stepBar.test.ts` › a trigger added once the tracks' peak is read starts at half of it; added while the peak is pending or its read failed it keeps its own level and the footer says so (R1)
- テスト: `src/test/regionPeak.test.ts` › a region's peak is read from every sample: a region that cuts a drawn bucket reads its own largest sample, which the thinned envelope does not hold (R1)
- テスト: `src/test/regionPeak.test.ts` › while a channel's peak is being read it is pending, and a failed read is failed until the answer store's pause is over: neither carries a number (R1)
- テスト: `python-backend/test_full_read.py` › test_a_regions_peak_is_taken_from_every_sample_of_the_lane_not_from_its_envelope
- テスト: `src/test/stepBarModel.test.ts` › a new trigger starts at half the tracks' peak, to two figures; fix_length at the files' length
- テスト: `src/test/unroundedScan.test.ts` › a scan's levels are sent unrounded and its median and Δ are of them: three levels 3.5e-5 dB apart give run 3 a Δ of 8.7e-6 dB from its group, never 0 (R1)
- テスト: `python-backend/test_scan_service.py` › test_scan_measures_the_analysis_spec_metrics
- テスト: `src/test/comparePanes.test.ts` › a comparison takes no number of the scans' 192 drawn points: its base, Δ and figures are the same whatever they hold (R1)
- テスト: `python-backend/test_calibration_pipeline.py` › test_a_float64_source_keeps_samples_a_float32_step_apart_through_its_samples_stft_and_delta
- テスト: `python-backend/test_calibration_pipeline.py` › test_files_are_cached_in_the_dtype_that_holds_every_sample_of_their_format_exactly
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
- レベルが比べられるかは、単位・基準値・レベル基準の名前の 3 つで決めます。校正状態は含めません（ゲイン補正した FS の録音と補正していない FS の録音はどちらも dBFS なので比べます）。それでも校正状態の違う線が 1 本の軸に載るときは、未校正の線が読み値と凡例に自分で「未校正」と書きます（R4）。webview とバックエンドはこの 1 つの定義を使います（`comparePanes.ts` の `levelIdentityOf`、`python-backend/level_identity.py`）。入口の基準群（`entryBase`）と、表の横のレベルの軸（概観帯の色、分布図の値の軸。`entrySidePlots` の `onLevelAxis`）も同じ定義で分けます。
- テスト: `src/test/levelIdentity.test.ts` › levels compare only in one unit, reference and its label, whatever their calibration status: the webview answers the table the backend answers (R1, R4, A34)
- テスト: `python-backend/test_level_identity.py` › test_levels_compare_in_one_unit_reference_and_label_whatever_their_calibration_status
- テスト: `src/test/entryBase.test.ts` › a base group keeps to the one level identity the backend uses: a gain-corrected FS file and a raw one are both dBFS and are one group (A34, R1)
- 伝達関数の値は、描くペア（ch2 / ch1）の単位の比を基準にしているので、その Δ と中央値はチャンネルのレベルではなくその比の同一性で分けます（同じ単位どうしの利得は Pa の録音でも V の録音でも比べ、Pa/V と V/V は比べません。`stage_combine.py` の `_calibration`）。
- テスト: `python-backend/test_stage_combine.py` › test_a_transfer_functions_difference_is_gated_by_its_pairs_unit_ratio_not_its_channels_level
- webview も同じ定義で分けます。比較台の段の集合（`figureModel.ts` の `pictureSet`）と軸（`byReference`）は、伝達関数の線をペアの単位の比の同一性で、基準スロットに対するクロススペクトルの線をペアの基準（wandas の pair domain。バックエンドが `unit` に書く）で数えて名乗ります（`pictureLevelOf`）。
- ペアの段（伝達関数・クロススペクトル）で、絵がまだ届いていない録音は計算中です。チャンネルのレベルで「別の基準」とは決めません。表の答えが別の基準・別の軸で外した基準群の録音も、ペアの段では問い合わせて、その絵の同一性で数えます（`trackStageMode.ts`）。段の集合の各録音の同一性は、答えの置き場が絵と一緒に持つものです（`stageSource.identity`）。`pictureSet` は自分で作りません。
- 時間軸の線は、始まりと刻みが同じものだけを 1 つの軸として数えます（バックエンドが送る `timeAxis`。`_aligned` と同じ定義）。長さが違うだけなら共通の部分で比べます。チャンネル数の違う録音（全チャンネルをまとめて比べるとき）は、理由を付けて除きます（「チャンネル数の違う n 本は除外」）。値のない答え（イベントのないトリガー、ナイキストを超える帯）は「値のない n 本は除外」と言います。「失敗」とは言いません。
- テスト: `src/test/figureSweep3.test.ts` › a transfer function is of its pair's unit ratio and a cross spectrum of its pair's reference (reference V3, V7, R1)
- テスト: `python-backend/test_stage_view.py` › test_a_cross_spectrum_of_two_units_is_named_by_its_pairs_reference_never_a_channels
- 入口でスロットのキーを押し続けて出す保持図の Δ は、押したときに、その録音と基準の録音の全ビンを取り寄せて計算します。届くまでは何も描かず、題に「計算中」と出します。表の 192 点の Δ は描きません。scan の 192 点（`spectrumDb`、全ビンを対数間隔の点にまとめた `scan_service.log_spectrum`）は描くために間引いた点として扱い（webview では型 `Drawn`、バックエンドでは `drawn_points_contract.json` の decimators）、比較台と報告の中央値・Δ・広がり・重ね順のどれにも使いません（`comparePanes.fileSide`）。全ビンが取れない録音（スキャンがビンを返さないとき）は、1/3 オクターブ帯の Δ を棒で描きます。帯のレベルは、スキャンが全ビンから求めた値です。レポートの図も同じで、全ビンがないときは、重ね図は 1/3 オクターブ帯のレベルを、Δ の図は帯の Δ の段だけを描きます。
- テスト: `src/test/entryHeldPlot.test.ts` › a held slot asks once for every bin of its file and its base, then draws its Δ from them (R1, R3)
- テスト: `src/test/uiSmoke/heldDelta.spec.ts` › a held slot draws its own channel's Δ against its base from every bin the hold asks for (R1, R3, R11)

## R2 線の間引きは区間ごとの最小と最大

点が画面より多い線（波形、スペクトル、ケプストラム、差分）は、区間ごとに最小と最大の点を、それぞれ自分の x の位置に残します。平均したり、最大だけを残したりしません。どの画面でも同じ線になります。

- テスト: `python-backend/test_stage_view.py` › test_more_bins_than_the_screen_shows_keep_each_buckets_lowest_and_highest_bin_at_every_zoom
- テスト: `python-backend/test_stage_combine.py` › test_a_difference_line_keeps_every_buckets_extremes_at_their_own_places
- テスト: `python-backend/test_analyzer.py` › test_a_cut_row_keeps_each_buckets_lowest_and_highest_bin_as_compare_does
- **描いた点の x は、その点が表す元の値の x です。** 間引いて残した点は、元のデータの中の自分の番号（何番目のサンプル・ビン・係数か）から x を求めます。割合（i / N）に幅を掛けて作り直したり、個数から時刻を組み立て直したりしません（4 サンプル・4 Hz の最後の点は 0.75 秒で、0.5625 秒ではありません）。熱図の 1 列は数フレームの平均なので、その列が持つフレームの時刻の平均に置き、列が持つフレームの範囲の外には出ません。
- バックエンドで wandas の Frame を読むのは 1 か所だけです（`stage_view.read_frame`）。Frame の種類ごとに、値（チャンネルをまとめたもの）と軸（x、行の y、信号なら開始時刻とサンプリング周波数）を `FrameReading` として返します。描く絵（`stage_view`）も、拡大した部分も、読み値・中央値・差が使う全データ（`stage_combine.stage_data`、`read_points`）も、この 1 つの読み取りから作ります。番号から x を出すのも 1 か所（`stage_view.reading_axis` と `x_at`）なので、描いた点の x と、そこで読んだ点の x は同じになります。絵の側や `stage_combine` で Frame の `data`・`freqs`・`times` を直接読みません。新しい Frame の種類を足すときは、`python-backend/stage_view.py` の 4 か所と、テストの 2 か所に足します。(1) 読む：`_read_frame`（`read_frame` から呼ばれる）に分岐を足し、Frame の配列はどれも計算の前に `_taken` で取って `FrameReading` を返す。値が `reading_axis` の知らない読み方なら、そこにも足す。(2) 描く：`_stage_view` に分岐を足し、読み取りから絵（`kind`・`x`・`quantity`・`unit`・間引いた点）を作る。間引く関数は `scripts/check_decimation_flow.py` の `SOURCES` と `python-backend/drawn_points_contract.json` の `decimators` の両方に載っているものを使う。(3) 一覧に載せる：`STAGE_FRAME_TYPES`（自分の値を線・棒・熱図に描くものは `CHART_FRAME_TYPES` にも）に足し、`python python-backend/operation_catalog.py --write` で `src/shared/recipe/generated/wandasOperations.ts` を作り直す。熱図に描くものは `src/webview/runtime/trackStageMode.ts` の `IMAGE_FRAMES` にも足す。(4) 図の見本：`python-backend/test_stage_view_kinds.py` の `_kinds` に足して `python python-backend/test_stage_view_kinds.py --write` を実行し、`src/test/fixtures/stageViewKinds.json` を書き直す（UI テストの図の約束と読み値の遷移の単体テストが、ここにあるすべての種類を描く）。(5) x を確かめる：`python-backend/test_drawn_x_is_source_x.py` の `_KINDS` と `_source` に足す。足し忘れると、`test_stage_view.py` › test_every_wandas_frame_is_drawn、`test_drawn_x_is_source_x.py` › test_every_drawn_frame_kind_is_covered、`test_operation_catalog.py` › test_the_generated_typescript_is_current、`src/test/stageViewKinds.test.ts`、`test_frame_reading.py` のどれかが失敗し、足りない手順を名前で言います。手順の詳細は `docs/plot-layers.md`（Adding a new Frame kind）にあります。
- トラックの波形（`decimator.decimated_waveform`）の `minT`・`maxT` はファイル全体の長さ（N / fs）に対する割合です。秒の軸に描く絵はこれを使わず、区間ごとの最小・最大のサンプルの番号（`decimator.bucket_extremes`）と自分の軸から時刻を出します（`stage_view.samples_waveform`）。
- **決めるのは元の軸、描いた点は描くだけ。** 絵はどれも、間引く前・拡大の窓に関係なく、元のデータの軸を `xSource`（熱図は行の `ySource` も）として持ちます：値の数、最初と最後の位置、最初から 2 番目までの間隔です。作るのは 1 か所（`stage_view.source_axis` が `reading_axis` / `x_at` から取る）で、中央値と Δ の絵は、バックエンドが実際にまとめた共通部分（`stage_combine._aligned` が揃えたもの）の軸を持ちます。webview は、全体表示の横軸の範囲（拡大の解除や「0」も、`stagePanes.axisScale`）と、どの絵が同じ軸か（`figureModel.pictureAxis`）を、この元の軸から決めます。描いた `xs` / `ys` の数・最初・最後からは決めません。間引きと拡大で変わるからです。対数軸は、述べた端（スペクトルの `xLimits`、スペクトログラムの行の `yLimits`）がなければ、元の軸の最初の正の位置と 2 番目からの比で端を出します。時間の軸は間隔と開始の番号（`round(first / step)`）が同じなら長さが違っても同じ軸（共通部分で中央値と Δ、R1）、ほかの軸は数・最初・最後（有効数字 9 桁）が同じときだけ同じ軸です。元の軸を持たない絵はどの絵とも同じ軸になりません（`UNKNOWN_AXIS` はどれとも、自分どうしとも一致しない）。わからないことは分ける側に倒し、まとめません。元の軸を持たないのは webview が自分の持つ全データから作った絵（カーソルスペクトルなど）だけで、その範囲はその絵の点から取ります。
- テスト: `python-backend/test_drawn_x_is_source_x.py` › test_a_median_and_a_difference_say_the_source_axis_of_the_common_part_they_were_taken_over
- テスト: `python-backend/test_drawn_x_is_source_x.py` › test_the_source_axis_tells_recordings_apart_that_thin_to_the_same_drawn_points_and_stays_the_same_zoomed
- テスト: `src/test/sourceAxis.test.ts` › the whole view of a thinned line spans its source data's first to last x, not its first and last drawn point (R2)
- テスト: `src/test/sourceAxis.test.ts` › pictures thinned to the same drawn points are on other axes when their source axes differ (R2)
- テスト: `src/test/sourceAxis.test.ts` › one source axis is one axis however it was thinned or zoomed, and a time axis of another length is the same axis (R1, R2)
- テスト: `src/test/sourceAxis.test.ts` › a picture that does not say its source axis is grouped with no other picture, however alike they are (R1, R2)
- テスト: `src/test/sourceAxis.test.ts` › a log axis's whole range is from its source places, or its stated limits, never its drawn points (R2)
- テスト: `src/test/uiSmoke/sourceAxis.spec.ts` › a long recording's spectrogram, thinned to columns, has a whole view from its first STFT frame to its last, not from its first to its last drawn column (R2)
- テスト: `python-backend/test_drawn_x_is_source_x.py` › test_every_drawn_x_is_the_x_of_a_source_value_or_inside_its_bucket
- テスト: `python-backend/test_drawn_x_is_source_x.py` › test_a_picture_that_thins_nothing_has_the_sources_own_xs_first_to_last_and_reads_back_the_same
- テスト: `python-backend/test_drawn_x_is_source_x.py` › test_four_samples_at_4_hz_are_drawn_at_0_to_0_75_s_not_squeezed_into_a_shorter_span
- テスト: `python-backend/test_drawn_x_is_source_x.py` › test_every_line_decimator_gives_source_points_each_value_with_its_own_x
- テスト: `python-backend/test_drawn_x_is_source_x.py` › test_the_lanes_waveform_places_are_sample_over_samples_so_times_the_duration_they_are_the_samples_times
- テスト: `python-backend/test_drawn_x_is_source_x.py` › test_every_drawn_frame_kind_is_covered
- テスト: `python-backend/test_stage_view.py` › test_a_time_signal_carries_its_own_waveform_as_the_lanes_decimate_it
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
- 比較台の線は、どの種類も同じ規則です。コヒーレンスはスペクトルと同じく対数の区間ごとの最小と最大のビンを、相関・ケプストラム・時系列（時間信号、wandas のレベルや指標）は区間ごとの最小と最大の点を、それぞれ自分の x に残します（`stage_view._envelope`）。区間の中の 1 点だけを選んだり、決まった周波数に補間したりしません。トリガーのイベントも、イベントごとに自分の x を持つ 1 本の線で、同じ規則で区間ごとの最小と最大の点をそれぞれ起きた時刻に残します（イベントの平均の線も同じ）。ほかのイベントの x に合わせたり、区間の端に動かしたりしません。正の山と負の谷が同じ区間にあっても両方残ります。
- テスト: `python-backend/test_stage_combine.py` › test_every_line_keeps_a_one_point_dip_and_peak_when_drawn
- テスト: `python-backend/test_stage_combine.py` › test_each_event_of_a_trigger_is_its_own_line_with_its_extremes_at_their_own_times
- テスト: `src/test/stagePanes.test.ts` › each event of a trigger is its own series, drawn at its own times: never at the xs of another event or of their mean (R2)
- テスト: `python-backend/test_stage_view.py` › test_a_long_cross_correlations_peak_is_drawn_at_its_own_lag
- 実際の録音（1 ビン幅の音と、それより大きい音が別の周波数にある 2 本）を、拡張機能と同じバックエンドで解析して比較台に出し、部品が実際に描いた線（`canvasAudit.ts` が記録する線の点）から読みます。全体を間引いて描いても狭い音はその高さのままです。
- テスト: `src/test/uiSmoke/narrowFeatures.spec.ts` › a narrow tone in real recordings is drawn at its full level on the thinned whole spectrum, and zoomed onto it the window is drawn again from every one of its own bins (R2, R3)
- 拡大の途中で間があいて（重いページで）途中の広い範囲を取り寄せていても、その先へ拡大した範囲はそれ自身の密度で取り寄せ直します。広い範囲の細部は、今の範囲を同じ細かさで描けるときだけ使います（`stageDetail.ts`）。
- テスト: `src/test/stageDetail.test.ts` › zoomed in past a range asked for on the way, the window is asked for again at its own density, not drawn from the wider one (R3)
- 比較台の Δ の見出し（差が一番大きい場所と値）は、描いた点ではなく、間引く前の全部の値から探します（`stage_combine.difference_peak`）。熱図でもブロックの平均時刻や帯の中心ではなく、その値の時刻と周波数を書きます。
- テスト: `python-backend/test_stage_combine.py` › test_the_headlines_largest_difference_is_found_among_every_value_at_its_own_place
- テスト: `python-backend/test_stage_combine.py` › test_the_headline_leaves_out_padding_columns_the_zero_quefrency_and_whatever_is_off_screen
- テスト: `src/test/stagePanes.test.ts` › the Δ pane's headline writes the backend's largest difference, found before thinning, never the largest point drawn
- 入口の概観帯（表の行ごとの 1/3 オクターブのレベルの熱図）も、行が画素の行より多いときは、表を行の区間に分けて、区間ごとに帯の最小と最大のレベルを 2 本の行に残します（先の行から来た方が上）。一番大きいものだけを残すと、大きな録音の間の静かな録音が見えなくなるからです。読み値は描いた区間ではなく、マウスの下の表の本当の行を読みます（R7）。
- テスト: `src/test/entrySidePlots.test.ts` › the strip is a heatmap of the table: a row per table row counted down from the top, each bucket's quietest and loudest when they outnumber its lines (R2)
- **線は切り取り、留めない。** 値の線（スペクトル・時系列・差分の線、棒の上の縁、そのまま描く信号の波形）は、どの点も軸の正確な y（`AxisTransform.yOf`）に置き、図の縁や軸の外の決まった所に留めてからつなぎません。線の区間は、図の箱を線の幅だけ広げた箱と交わる所で切ります（`src/webview/plot/lineClip.ts` の `clippedPath`、`clippedSegment`）。切った端は区間の上にあり、その座標は縁に近い方の端から求めるので、遠い端でも精度を失いません。こうすると、拡大して図の中の点から軸の何百万幅も外の点へ向かう区間も、本当の区間のとおりに描かれ、本当の区間が縁を横切る x で図を出ます。図に見える線の形は拡大の度合いで変わりません。点を留めてからつなぐと（以前の線を描く y `paintY` は軸の外 10 幅で留めた）、区間は留めた点へ向かい、見える部分の傾きが拡大で変わります。区間を切るのは 1 つの規則だけで、比較台の線（`stagePanes.strokeStageLine`：線、棒の上の縁、ホバーで太く描き直す線）とそのまま描く信号（`waveformRenderer.paintDecimatedPoints`）の両方がそれで描きます。線が全部図の中にあれば、切らないときと同じ moveTo / lineTo の道筋なので、画素は変わりません。軸の外の水平の線（差の図の 0 の線、トリガーの水準の点線）は図の縁に沿って描かず、描きません。棒の塗りと帯の段の塗りは、図の中の部分だけを塗ります（軸に沿った長方形なので、図の縁で切るのと同じです）。帯の段の縁取りは、図の外の辺を図の切り取りの外に置き、切れた所に辺を描きません。点の印（`yAt`）とマウスの読みの印は R7 のとおり図の縁に留めます。これは線ではなく、読んだ点の位置を示す印です。
- テスト: `src/test/lineClip.test.ts` › a segment from a point on the plot to one far past the value axis is drawn along the true segment and crosses the plot's edge at the true x, at every zoom, from either end (R2)
- テスト: `src/test/lineClip.test.ts` › a signal drawn as itself is cut to its plot by the same rule: on a zoomed amplitude axis its segment crosses the edge at the true x (R2)
- テスト: `src/test/lineClip.test.ts` › a line wholly on the plot is stroked as the same path as without clipping: its points at their exact places, one run (R2)
- テスト: `src/test/lineClip.test.ts` › a bar, the Δ's 0 and a trigger's level past the value axis are not drawn along the plot's edge (R2)
- テスト: `src/test/lineClip.test.ts` › the clip keeps the segment itself: its cut ends on the true segment at the box's edges, none where it misses the box (R2)
- テスト: `src/test/pickScaleBoundary.test.ts` › the value axis maps a value to a y only exactly (yOf) or to a point's mark (yAt), with no y held for painting a line, and outside the painting functions nothing differences two mapped y's to get a scale (R2, R14)
- **区間は線を描く軸の目盛りで作り、ギャップはつながない。** 区間ごとの最小と最大は、その線を描く軸の目盛りの区間で取ります。対数の軸では対数で等しい幅、線形の軸では等しい幅です（バックエンドの線形の区間は線の全部の点を数で等分します。`decimator.bucket_edges`。線形の軸の線は点が等間隔なので、等しい幅になります）。webview の `comparePanes.minMaxLine` は軸の目盛り（`'linear'` か `'log'`）を引数で受け、既定値はありません。呼ぶ側が自分の軸の目盛りを渡します（比較台のスペクトルは対数の軸なので `'log'`、カーソルスペクトルは窓が対数と言わない限り線形の軸なので `'linear'`。`overlaySpectrumPainter.spectrumLayer`）。カーソルスペクトルを表示用にバックエンドが切るときも、その軸の線形の区間です（`analyzer.min_max_spectrum`、`stage_view.min_max_rows` の `log`）。線形の軸を対数の区間で間引くと、高い側の 1 つの区間が何画素にもなり、違う画素にある細いピークが 1 つにまとめられるからです。
- 値が有限でない点（NaN、±∞）は線のギャップで、間引いてもつなぎません。残した 2 点の間に元のデータのギャップがあれば、そのギャップの最初の点も残し、その値を描く配列でも「値なし」として送ります（JSON に NaN はないので、プロトコルの描く配列がもともと持つ「値なし」の null。`protocol_schema._DRAWN_GAPPED`）。`stage_view.min_max_indices`（`_with_breaks`）と `comparePanes.minMaxLine`（`withBreaks`）が同じ規則です。描く関数は null と有限でない値でペンを上げます（`stagePanes.strokeStageLine`、`waveformRenderer.paintDecimatedPoints`。どちらも `lineClip.clippedPath` の `lift`）。信号の波形の包絡線は区間ごとに最小と最大の 2 点の組なので、組の間に切れ目を置けません。バックエンド（`decimator.bucket_extremes`）はギャップを含む区間を 1 つのギャップ（null の組）として送ります。その区間は 1 画素より細く、拡大するとその範囲を細かく取り寄せ直します（R3）。webview はそれを 0 の点に置き換えず（`waveformLayer`）、画面でさらに間引くとき（`waveformRenderer.decimateBuckets`）もギャップの両側を別々に間引いて、間にギャップの組を置きます。線形の区間は全部の点で数えるので、ギャップがあっても後ろの区間は動きません。どの拡大でも、描いた線はギャップで切れています。ピークの絶対値（`absolutePeak`）も値のある点だけから取ります（`decimator.absolute_peak`）。
- テスト: `python-backend/test_stage_view.py` › test_a_line_with_a_stretch_of_no_values_is_drawn_with_a_break_there_at_every_zoom
- テスト: `python-backend/test_stage_view.py` › test_a_thinned_line_keeps_a_break_at_each_gap_in_either_scale_and_buckets_stay_where_they_are
- テスト: `python-backend/test_analyzer.py` › test_a_narrow_high_peak_of_a_cut_row_on_its_linear_axis_is_kept_at_its_own_frequency
- テスト: `src/test/overlaySpectrumPainter.test.ts` › a narrow high peak on the linear frequency axis is drawn at its own pixel: the slice is thinned in equally wide buckets, its axis's scale (R2)
- テスト: `src/test/lineClip.test.ts` › a line with a stretch of no values is drawn with a break there at every zoom, thinned to be drawn or not: never joined across it (R2)
- テスト: `src/test/lineClip.test.ts` › a signal drawn as itself breaks at its gap: a sample with no value is not drawn at 0, nor joined across (R2)

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
- **届いた答えに絵がないとき**も、それが答えです。スペクトログラムのレーンは、チャンネルにスペクトログラムがない間、トラックの詳細を取り寄せます。取り寄せた答えが正しく届き、スペクトログラムが 1 つも入っていなかったら、その鍵での答えは「ない」です（answer store の empty）。レーンは「このチャンネルのスペクトログラムはありません」（`spectrogramNone`）と書き、同じ鍵のまま取り寄せ直しません。同じことを聞けば同じ答えが返るだけで、聞き直すと描くたび（毎フレーム）に要求が出続けます。ほかのチャンネルにだけスペクトログラムが届いた答え（ready）でも、届かなかったチャンネルのレーンは同じく「ありません」と書きます。
  - 鍵は `trackStore.ts` の `trackDetailKey` です。ファイル、その版（sourceVersion）、校正、スペクトログラムの設定の署名（STFT と窓）でできています。取り寄せ直すのは、このどれかが変わったときだけです。時間がたっただけでは聞き直しません。
  - 失敗（failed）は別です。失敗は 5 秒の間を置いて出し直します（`answerStore.ts` の `FAILED_RETRY_MS`）。設定に触れると失敗は手放されてすぐ出し直しますが、届いた答え（empty も）は手放しません（`clearDetailErrors`）。届くまで（pending）は「読み込み中」と書きます。
  - 状態は answer store（`createAnswerStore`）が持ち、レーンでの意味は `trackStore.ts` の `laneDetailState` が 1 か所で決めます（answered / failed / pending / ask）。ほかにキャッシュや出し直しを足しません。
- テスト: `src/test/trackStore.test.ts` › a detail answered without a spectrogram is asked exactly once: the lane says there is none, and asks again only when its key changes (file version, calibration, STFT or window settings); a failure is asked again after the answer store's pause
- テスト: `src/test/trackStore.test.ts` › touching the spectrogram settings lets go a track's detail failure but keeps its empty answer (clearDetailErrors)
- テスト: `src/test/uiSmoke/toolbar.spec.ts` › static page: a detail answered with no spectrogram is asked once, and the lane says there is none
- **失敗した答えを出し直す時刻**は answer store だけが持ちます。読み直したい側は `whenFailureEnds` で知らせを頼み、store が 5 秒の間が終わったその時に、頼んだ全員に 1 回だけ知らせます（同じ答えを待つ読み手が 2 つあっても出し直しは 1 回です）。届くのを待つ側は `whenSettled` で頼みます。答えの出どころ（`answerStore.ts` の作る関数や `fetchedSource`・`fullSource('fetched', …)` を呼ぶファイル）は、タイマー・待つ読み手の一覧・起こす時刻を自分で持ちません。出どころの中で `setTimeout`・`setInterval`・`requestAnimationFrame` などを呼ぶと、名前を変えても呼び先で見つけてテストが失敗します。出どころを分けて時刻を 2 か所に持つと、出し直しの決まりを変えるときに両方を直すことになり、片方だけ古い決まりのまま残るからです。
- テスト: `src/test/answerStore.test.ts` › a failed answer's readers are told exactly when its hold ends, together and once; a dropped one never is (whenFailureEnds)
- テスト: `src/test/fullRead.test.ts` › a failed full read is asked again exactly when the store's hold ends, not earlier and not twice, and a second reader shares the one retry (C2, R7)
- テスト: `src/test/answerStoreBoundary.test.ts` › no answer source schedules with a timer of its own: when a failed answer is asked again is the store's (whenFailureEnds)
- 同じ実際の録音で、狭い音の上に拡大すると、図はその範囲のビンを取り寄せ（`detail` 付きの要求）、範囲の中のビンを 1 つ残らず、ビンの間隔（16000/8192 Hz）で描き直します。点の数は範囲のビンの数とほぼ同じで、全体を間引いた線がその範囲に持っていた点の 2 倍より多くなります。一番高い点はその音で、全体のときと同じ高さです。範囲の外のもっと大きい音は図に出ません。差の欄も同じで、差は範囲のビンから取り直します（`detail` 付きの `compare-combine`）。
- テスト: `src/test/uiSmoke/narrowFeatures.spec.ts` › a narrow tone in real recordings is drawn at its full level on the thinned whole spectrum, and zoomed onto it the window is drawn again from every one of its own bins (R2, R3)

## R4 両軸に量・単位・基準

どのグラフも、縦軸と横軸に量の名前と単位を書きます。熱図は色の意味もカラーバーに量・単位・両端の値で書きます。カラーバーは比較の熱図もトラックのスペクトログラムも同じ部品（`paintColourBar`）で、図の右上に描きます。カラーバーの名前は省きません。色の目盛りの横に入らないときは、目盛りの上の行に図の幅で書き、それでも入らなければ軸の名前と同じく小さくし、量と単位の 2 行に分け、量を縮めます（`axisTitle.ts` の `fitAxisTitle`）。UI テスト全件で、画面に出ている熱図のカラーバーが色の意味（`data-plot-colour`）を量と単位で描いていなければ、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。dB は wandas のレベル基準（「dB SPL re 20 µPa」など）で書きます。dB でも振幅でも、未校正なら未校正と書きます。重ねた線には凡例を付けます。カーソルスペクトルは軸が低いので、レベルの名前を凡例の頭にも書きます。

軸の名前は「量 [単位]」の形で、単位はいつも最後の角かっこに書きます。単位のない量（コヒーレンス γ²、相関係数、実ケプストラム、波高率、表の行）は「[–]」と書きます。単位がわからない量（単位を書いていない CSV の列、単位のない値）は「[unit unknown]」「[単位不明]」と書きます。CSV の列の名前が「温度 [°C]」「温度 (°C)」のように単位を書いていれば、その単位を軸に書きます。量の名前は「値」にしません。ただ 1 つの例外は、手順のあとの量も単位もバックエンドが分からないと送った時間信号（`measure: "unknown"`）で、量も単位も名乗らず「値 [単位不明]」「Value [unit unknown]」と書きます（「振幅」とは書きません）。ラウドネス・シャープネス・ラフネスは単位から（Bark 帯ごとのラフネス `roughness_dw_spec` は総ラフネスと分けて「比ラフネス [asper/Bark]」）、時間信号から手順が作った量は手順から（実効値・時間重み付き実効値・パワー、ほかの累乗は「振幅の p 乗」「Amplitude^p」、手順が何もしていなければ信号の単位の振幅）、dB の時間変化（`sound_level`・`rms_trend` の dB）は何のレベルか（「時間重み付き実効値 未校正 [dBFS]」、手順がわからなければ「レベル」）で書き、dB の値を「振幅」とは書きません。ペアの名前（「· ch2 / ch1」）は量の後、単位の前に書きます。軸の名前は省いてよい文字ではありません。軸に入りきらないときは、文字を小さくし、量と単位の 2 行に分け、それでも入らなければ量を記号（「γ²」）か頭の文字（「Amp…」）に縮めますが、量と単位はどちらも描きます（`src/webview/plot/axisTitle.ts`）。UI テスト全件で、画面に出ているグラフの軸の名前（`data-plot-axes`）に量と単位がなければ、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。属性に書いた名前が、グラフか軸のキャンバスに文字として描かれていなくても失敗にします。確かめるのは描いた文字です。グラフの外のキャンバスに描いた名前は、共通の部品がそのグラフに id で結んだキャンバス（`data-plot-named-by`：値の軸のキャンバス、レーンが共有する時間の目盛り、積んだ図の一番下の図）か、グラフが名前の置き場として指す要素（`data-plot-names`）にあるときだけ数えます。結んでいない別のキャンバスに同じ文字があっても、そのグラフの名前にはなりません（`plotContract.spec.ts` › every ui-smoke test fails on a plot whose axis name is drawn only on a canvas it is not bound to: a name is never borrowed (R4)）。値の軸の目盛りの数字は、どの高さのグラフでも重ねません。低いグラフでは目盛りを減らします（切りのよい刻みを粗くするか、細かい刻みを 1 つおきなどに間引く。`valueAxisTicks`、`spacedTicks`）。UI テスト全件で、画面に出ているグラフの 1 本の軸の目盛りの数字が重なって描かれたら、そのテストを失敗にします（同じファイル）。横軸の目盛りの数字も、どの幅のグラフでも重ねません（対数の周波数軸の狭い図で、前の数字に触れる数字は省き、目盛りの線は残します）。目盛りの負の数は、縦軸も横軸も、しきい値の文字も「−」で書きます。縦軸の数字は、ガターの軸の名前に重ねません。長い数字（「−0.0010」、入口の概観帯の行の番号）は、名前の右に入るように全部を小さく書きます。軸の名前は、量を落として単位だけにする gui-core の `fittedAxisTitle`（`drawValueAxis`）では書きません。

- テスト: `src/test/comparePanes.test.ts` › every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files
- テスト: `src/test/comparePanes.test.ts` › the level axis is named by wandas' level reference, and says uncalibrated from the calibration status, not the unit
- 1 つの軸に載る線は、R1 のレベルの同一性（単位・基準値・レベル基準の名前）が同じ録音のものだけです。並べた表示のレーンも、範囲を共有するのは同じ基準のレーンどうしだけです。重ねた線を軸に分けるのはこの同一性で、軸の名前の文字ではありません（`figureModel.ts` の `levelAxes`。画面は `trackStagePainter.ts` の `byReference`、報告の図は `compareReport.ts` の `reportLevelAxes` がこれを使います）。同一性が 3 つ以上なら重ねません。1 本の軸に校正状態の違う線が載るとき、軸の名前は量・単位・基準で書き、未校正はその軸の線がすべて未校正のときだけ書きます。未校正の線は、凡例と読み値に自分で「未校正」と書きます（`figureModel.ts` の `calibrationWords`）。
- テスト: `src/test/trackStagePainter.test.ts` › overlaid, lines share an axis by their level identity, not their axis name: a gain-corrected FS file and a raw one are one axis, and only the raw one says uncalibrated (R1, R4)
- 左右 2 本のレベル軸の名前は、それぞれの軸に載った線だけから決めます（その軸の最初の線の絵の量と単位、その軸の線の入力の基準。`figureModel.ts` の `stageLevelAxes`）。最初に届いた絵や、もう一方の軸の線から名前を付けることはしません（FS の波形・イベントと Pa の波形・イベントを左右に分けたとき、両方が先に届いた方の単位で名乗る誤りを防ぎます）。届く順が逆でも名前は同じです。線のまだない軸（計算中、基準が 3 つ以上）は、基準を名乗らない待ちの名前（「[単位不明]」）で、もう一方の軸の名前は借りません。待ちの名前は横軸と量だけをその段の絵から取り、単位は誰の絵からも取りません（`figureModel.ts` の `pendingStageNames`）。並べた表示のレーンも同じで、レーンの軸は自分の録音の絵だけから名乗ります。自分の絵がまだ届いていないレーンは待ちの名前で、届いたら自分の名前になります。先に届いた別の録音の絵の単位を借りることはしません（`figureModel.ts` の `laneNames`）。重ね図の軸やレーンの名前を `trackStagePainter.ts` が自分で作ると（`stageNames` を呼ぶ、`levelAxes` に名前を渡す）、`figureModel.test.ts` の構造検査（`axis-namer`）が失敗します。1 枚の絵だけを描く図（Δ、入口の図）が自分の絵を名乗る場所だけが、その検査の `ALLOWED` に理由付きで載ります。レーンの左の余白（`PANE_LEFT`）は名前によらず一定なので、待ちの名前から自分の名前に変わっても幅は動きません。
- テスト: `src/test/trackStagePainter.test.ts` › overlaid with two level axes, each axis is named by its own lines, whichever picture arrived first; an axis with no line of its own is never named by the other's (R4, A43)
- テスト: `src/test/trackStagePainter.test.ts` › side by side, a lane is named by its own picture alone: one still pending has the pending name, never the first picture's unit, then its own (R4)
- トリガーのイベントの重ね図も同じで、イベントは録音の線として同一性で軸に分けます。トリガーの下のレーンも、範囲を共有するのは同じ同一性のレーンどうしだけです（`triggerLanes.ts`）。右の 2 本目の軸は、縦の拡大で左の軸と同じ割合だけ狭めます。カーソルスペクトルも、軸は線がすべて未校正のときだけ未校正と書き、校正状態が混ざる軸では未校正の線が凡例と読み値に自分で書きます（`spectrumRuntime.ts` の `withCalibrationWords`）。
- テスト: `src/test/trackStagePainter.test.ts` › overlaid, a trigger's events are split by level identity as any line, and a vertical zoom narrows the right-hand axis as the left (A43, A45, R13)
- テスト: `src/test/triggerLanes.test.ts` › trigger lanes of another level identity never share a range: a lane in Pa is not on a full-scale lane's scale (A43, R1, R4)
- テスト: `src/test/overlaySpectrumPainter.test.ts` › on one level axis mixing calibration statuses, each uncalibrated line says so in its legend and readout; on its own the axis says it (A49, R1, R4)
- テスト: `src/test/figureModel.test.ts` › every place that groups lines onto a level axis, range or colour scale goes through figureModel (A43, A49, R1, R4)
- 軸の名前・範囲・レベルの同一性・未校正の言葉と、図と CSV が数えるファイル（中央値・Δ・n・CSV の基準群 n とファイル）は、図の層（`src/webview/runtime/figureModel.ts`）だけが決めます。画面の重ね図・Δ・トリガー・カーソルスペクトル・ペア表示・入口の図・報告の図と CSV は、どれもここから受け取ります。`paintOverlay` と CSV の書き手は、この層が作った名前・範囲・列（`FigureNames`・`FigureRange`・`FigureTitle`・`FigureColumns`）しか受け取りません。数えるのは図と同じレベルの同一性と軸で答えが出た録音だけで、計算中・前の手順や版や校正の答え（stale、灰色で見せても数えない）・失敗・空・別の基準・別の周波数軸の録音は理由とともに除きます（`figureUsed`。必ず図の同一性を渡します）。分布の線・比較・entry-table.csv・報告.csv・報告の図・見出しの n と基準のファイルは、どれも同じ一つの集合（`FigureSet`）です（入口の基準は `entryBase.ts` の `resolve`、比較台の重ね図は `pictureSet`）。集合は図ごとに一度だけ作り、その同一性は比較している録音の答え（fresh で ready のもの）から決めます。比較している録音がまだ計算中か stale なら同一性はなく、どの録音も数えません（`no-identity`）。「最初に答えの出た録音」や比較録音のレベルの仮定（`?? like`）で決めることはしません。何も比較していないときは、フォルダの一つの基準（`folderReference`: fresh な答えでいちばん多い基準、同数なら表で先のもの）です。この選び方は、見出し・概観帯・分布・表で共有する一つです。中央値・見出しの n と除いた理由・基準のレベル基準の欄（`setMedian`・`setCountText`・`setExclusionText`・`baseLevelOf`）は `FigureSet` しか受け取りません。ほかの経路で数えると `figureSetOnly.test.ts` が失敗します。entry-table.csv には基準群から除いた録音とその理由の列（「基準群から除外」）があり、stale の行は数を書かずに状態の列で「前の手順」と書きます。固定した Δ の行が ≠（前の手順・版・校正の答えで固定したもの）になったときも同じで、その行は数を一つも書きません。Δ・基準群の n・除いた録音の欄は空で、状態の列は「≠」です（ファイルの行の「前の手順」ではありません）。表でも ≠ と出して値を見せず、どの中央値と n にも数えません（`entryTable.withDerived` が行に stale を付け、`entryCsv` がそれを見ます）。CSV のレベルの列（帯の列も）には、いつもその行のレベル基準の列が隣に付きます。入口の分布図の読み値は、レベルを単位と基準を付けて書きます（「−32.1 dBFS」）。概観帯のセルと分布の点の読み値は、校正状態の混ざる軸では未校正の録音だけが自分で「未校正」と書きます。比較台の基準群を各波形で描くときも、未校正の線だけがその言葉を持ちます。
- テスト: `src/test/figureModel.test.ts` › outside figureModel.ts nothing builds an axis name, calls an axis builder, keys by level identity, applies a range rule, counts files for n or defaults a reference, but the exact list; figureModel.ts only its own definitions (docs/plot-layers.md)
- テスト: `src/test/figureModel.test.ts` › every figure and every file written of a base group with another reference's, pending, failed and stale recordings: one set everywhere, one identity per axis, each row its own reference (R1, R4, C5)
- テスト: `src/test/entryTable.test.ts` › a fixed difference made stale by a recipe change shows ≠ and writes no Δ, no base n and no left-out files (R4)
- どの値も、自分の行の基準と校正状態を名乗ります。比較台の凡例と報告.csv の「表示中の値」は、その行の録音の答えの基準で書き（`ownLevelName`）、報告.csv の列の見出しは基準を名乗りません（`unreferencedName`）。入口の表で、フォルダの基準と違う行と stale の行の値は、その行の基準を値の横に書きます（`ownReferenceMark`）。CSV の絶対レベルの列は「dB(A)」と書かず（「Leq A特性」）、隣の列がその行の基準を書きます。まだ何も読んでいないとき、レベルの名前は基準を名乗らず（「dBFS」と仮定しない）、線のない軸は「[単位不明]」と書きます。中央値の線（基準群・チャンネルを合わせた線）は、そのすべての録音が校正済みのときだけ校正済みです。画面と報告は同じ定義（`medianInputOf`）を使います。手で入れたスペクトログラムの色の範囲は、入れたレーンの同一性のものだけで、ほかの基準のレーンは自分の自動の範囲のままです（`spectrogramDisplayBounds` の `levels`）。図の名前（`FigureNames`）は、この層が作った題（`FigureTitle`・`PlainTitle`）からしか作れません。よそで書いた「レベル [dB]」は `plainNames` の型が受け取りません。
- テスト: `src/test/figureSweep3.test.ts` › every value names its own row's reference and calibration, never the folder's (reference V1, V2, V6, V9)
- テスト: `src/test/figureSweep3.test.ts` › a median line of mixed calibration is uncalibrated on the screen and in the report alike (reference V4)
- テスト: `src/test/figureSweep3.test.ts` › a typed colour range stays with the level identity it was typed for (reference V5)
- テスト: `src/test/figureSweep3.test.ts` › only names made in the layer can be wrapped: a bare level name written elsewhere is refused by the type (reference: plainNames)
- 集合の抜けも閉じます。チャンネルで分けた群はそのチャンネルの中央値、固定した Δ の測り直しは行のチャンネルのまま、空の基準は n=0 と除いた理由を書き（n=1 にしない）、時間軸は長さが違っても同じ軸、比較の絵が計算中か失敗なら同一性はなし、スロット 0 のばらつきの集合は基準の集合から（ほかの比較スロットを入れない）。比べるチャンネルのない群の録音も、集合が理由（`no-channel`）とともに除きます。除いた録音と理由は、見出し・CSV・報告・定義.json・分布の見出し（`entryBase.folderSet`）のどれにも書きます。
- テスト: `src/test/figureSweep3.test.ts` › a step picture set has no identity while the compared picture is pending or failed, and a time axis ±1 sample is one axis (aggregation V5, V6)
- テスト: `src/test/figureSweep3.test.ts` › a channel-split group is measured as its channel, a member without it is left out with why, and a waveform heading counts the same set (aggregation V4, V7)
- テスト: `src/test/figureSweep3.test.ts` › slot 0's spread is of the base set: the other compared slots are not its peers (aggregation V12)
- テスト: `src/test/figureSweep3.test.ts` › a fixed Δ measured again keeps its channel, and an empty base writes n 0 with what it left out (aggregation V1, V8)
- テスト: `src/test/figureSweep3.test.ts` › the folder's set lists every recording a level figure left out, with why (aggregation V11)
- テスト: `src/test/entryDistributionPane.test.ts` › a level's heading counts its set and says what it left out, with why (aggregation V11)
- テスト: `src/test/axisNames.test.ts` › no absolute level falls back to a bare "dB" unit anywhere in src (a default, ?? / || / ternary, or return): it names its reference, or says full scale (R4, R7, A50)
- テスト: `src/test/trackStagePainter.test.ts` › side by side, lanes share a range only with the lanes in their own reference: a dB SPL lane is never on a dBFS lane's scale (A32, C1)
- テスト: `src/test/stagePanes.test.ts` › a metric or level over time names what it measures on its value axis, never a bare value or an amplitude in dB (R4)
- テスト: `src/test/stagePanes.test.ts` › a heatmap names what its colour measures, with its unit and reference, for its colour bar
- テスト: `src/test/stagePanes.test.ts` › a colour bar stays inside a narrow plot and never leaves out its name: beside the scale, else above it, shortened only as every axis name is (R4)
- テスト: `src/test/axisNames.test.ts` › every axis-name string, in every language, names its quantity and its unit (R4)
- テスト: `src/test/axisNames.test.ts` › every axis a picture is drawn on names its quantity and unit, whatever it measures, with or without a unit, Δ or not (R4)
- テスト: `src/test/stagePanes.test.ts` › every number along a horizontal axis writes a negative with a true minus (a lag, the time from a trigger), as the value axis does (R4)
- テスト: `src/test/stagePanes.test.ts` › no two numbers along a horizontal axis touch, a log frequency axis on a narrow plot too: one that would is left out (R4)
- テスト: `src/test/stagePanes.test.ts` › a value axis's numbers never cover its name in the gutter: a long one is written smaller to keep clear of it (R4)
- テスト: `src/test/entrySidePlots.test.ts` › the strip's row numbers stay clear of its axis name, a table of a thousand rows too (R4)
- テスト: `src/test/axisNames.test.ts` › no plot names an axis through gui-core's drawValueAxis or fittedAxisTitle, which keep only the unit when the name is long: every name is fitted by axisTitle.ts, quantity and unit (R4)
- テスト: `src/test/pairSpectrum.test.ts` › the gain plot names its axis in the UI's language, never the backend's English: a gain in dB, else the transfer level re the units' ratio (R4)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a plot on screen whose axis name is in its attributes but not drawn: what is checked is what is drawn (R4)
- テスト: `src/test/axisNames.test.ts` › a CSV column's value axis names the unit its header gives, and says when it gives none
- テスト: `src/test/axisNames.test.ts` › a name too long for its axis keeps its quantity and its unit: smaller, on two lines, then its quantity shortened
- テスト: `src/test/tickLabels.test.ts` › no two tick labels on a value axis overlap, on a plot of any height: a short plot gets fewer ticks
- テスト: `python-backend/test_stage_view.py` › test_a_time_signal_names_the_measure_a_step_made_of_it
- 処理のあとの信号の値の単位は、バックエンドが 1 か所（`stage_view.py` の `signal_unit`、`signal_measure` の隣）で決めて `view.unit`（波形は `waveform.unit`）で送ります。チャンネルの単位から操作の履歴を順にたどります。rms_trend・sound_level（dB でないもの）、フィルタ、切り出しなどは単位を変えません（`UNIT_KEEPING_OPERATIONS`）。`power(p)` は単位を p 乗します（`Pa²`、`Pa³`、`Pa^0.5`。p = 1 はそのまま）。連鎖は順に合成します。wandas が自分で単位を付ける操作（dB のレベル、校正、積分）はその単位を使いますが、その前に累乗があれば wandas の単位は値の単位ではないので、単位を名乗りません。単位への効き方が分からない操作（normalize、2 つの信号の積など）のあとは単位 `''`、`measure: "unknown"` で送り、軸は「値 [単位不明]」と書きます。間違った単位は書きません。wandas は power のあとも入力の単位（`Pa`）を返すので、この計算が要ります。wandas が累乗の単位を返すようになったら、その操作の計算を消して wandas の単位を使います。
- 量（`measure` と `measureExponent`）も、単位と同じ 1 回のたどり（`stage_view.py` の `_walk`）で決めます。単位が分かって量が分からない、またはその逆の名前は作りません。量は振幅から始めます。rms_trend・sound_level は、それまでが何であってもその量にします（パワーの実効値は実効値で、単位はパワーの `Pa²`）。`power(p)`（`** p` も）は量も p 乗します。振幅の 2 乗は `power`（「パワー」）、ほかは `measure` に元の量、`measureExponent` に p を送り、軸は「振幅の 3 乗 [Pa³]」「Amplitude^3 [Pa³]」「実効値の 2 乗 [Pa²]」と書きます（p は単位と同じく `:g` の数字）。累乗が打ち消し合えば（power(2) のあと power(0.5)）振幅に戻ります。単位を変えない操作（フィルタ、リサンプリング、切り出し、数を掛ける・足すゲインとオフセット、校正）は量も変えません。積分は新しい信号なので振幅に戻ります。指標（ラウドネスなど）は単位で名前が決まる新しい信号で、そのあとの累乗は振幅の累乗と同じに扱います（ラウドネスの 2 乗は「パワー [sone²]」）。単位をたどれない連鎖では量も分からないので、`measure: "unknown"` を送ります。名前の文字は Python では作りません。`measure` と `measureExponent` を webview の `stagePanes.ts` の `amplitudeAxisTitle`（figureModel の `amplitudeTitle` と `stageNames` から呼ぶ）が `strings.ts` の `axisRaised`・`axisQuantityUnknown` で言葉にします。webview は単位の文字列を書き換えません（`²` を足さない）。軸名も読み値も、送られた単位をそのまま書きます。`figureModel.test.ts` の構造検査は、式のすぐ後ろに累乗の記号（上付き数字、`^`）を書き足すコードを、構文木でどこでも見つけて失敗します。
- テスト: `python-backend/test_stage_view.py` › test_the_unit_of_a_signal_after_operations_is_walked_through_its_history
- テスト: `python-backend/test_stage_view.py` › test_wandas_keeps_the_input_unit_on_a_power_so_the_backend_walks_it
- テスト: `src/test/axisNames.test.ts` › the axis name and the readout of a signal after operations carry the same unit, the one the backend sent, and none where it sent none (R4, R7)
- テスト: `src/test/axisNames.test.ts` › a signal after operations is named by the quantity and the unit the backend sent: a power by its exponent, an unknown chain as a value of unknown unit, never an amplitude it is not (R4)
- テスト: `src/test/figureModel.test.ts` › the structural check fails on each injected bug: every violation of class sweep 1 (reference, aggregation) and the first ones (an axis name, pending in n, two identities on one axis, a CSV header without its reference)
- テスト: `src/test/uiSmoke/spectrumOctaveBands.spec.ts` › the cursor spectrum names its level axis as Compare does, uncalibrated, and its lines in a legend
- テスト: `src/test/overlaySpectrumPainter.test.ts` › renderSpectrumAxisLegend names every line by its colour, grouped by the side it is read on with two axes
- トラックのレーンの軸（振幅、スペクトログラムの周波数、上の時間の目盛り）も、比較のグラフと同じ目盛りの決め方・数字の書き方・文字・軸の名前で描きます（`laneAxes.ts`）。振幅の目盛りは、波形がその値を描く高さに置きます。
- テスト: `src/test/laneAxes.test.ts` › a waveform lane's amplitude ticks sit where the waveform draws their values, zoomed or not
- テスト: `src/test/laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses
- テスト: `src/test/laneAxes.test.ts` › a lane axis names its quantity, unit and calibration as Compare's waveform axis does
- 伝達関数は、2 つのチャンネルの単位が同じなら利得（「利得 [dB]」）、違えば単位の比を基準にした伝達レベル（「伝達レベル [dB re 2e-05 Pa/V]」）で描きます。比較台の段もペアの図と同じ決め方です（`stage_view.py` の `_transfer_rows`）。
- ペアの値は、両側が校正済みのときだけ校正済みです。1 つの録音の 2 チャンネルなら両方のチャンネル、基準スロットに対するペアなら録音と基準スロットの側で決めます。片方でも未校正なら、軸は「利得 未校正 [dB]」のように書きます（比較台の段もペアの図も同じ。`figureModel.ts` の `pairCalibration`、ペアの図はバックエンドの `calibrationStatus`）。ファイルから取り出した 1 チャンネルは、そのチャンネル自身の校正状態を名乗ります（`channelCalibration`）。入力がまだないとき、軸は「[単位不明]」と書きます。dBFS や FS を仮定しません。
- テスト: `python-backend/test_stage_view.py` › test_a_transfer_function_of_two_units_is_drawn_as_its_transfer_level_named_by_its_reference
- テスト: `src/test/stagePanes.test.ts` › a cross-channel picture names its pair on the value axis: the channel over its reference, before the unit
- 右の 2 本目のレベル軸の数字も、軸の名前に重ねません。入らなければ全部を小さく書きます。時間軸の帯の名前も、ほかの軸の名前と同じく `fitAxisTitle` で合わせます。
- テスト: `src/test/stagePanes.test.ts` › the right-hand level axis writes its numbers clear of its name, all smaller where the widest would reach it, as the left axis does (A36, R4)
- テスト: `src/test/stagePanes.test.ts` › a time axis strip fits its name as every axis name is: smaller, its quantity shortened, never cut off the strip (A36, R4)
- 軸名はキャンバスの中に書きます。どのグラフでも、狭くても低くても、軸名の文字がキャンバスの外に出ることはありません。保証するのは共通の部品です。軸に沿う向きは `fitAxisTitle`（`src/webview/plot/axisTitle.ts`）が、渡された長さより長い名前を返しません（小さく → 2 行 → 量を縮める、それでも入らなければ入るまで小さく。量と単位はどちらも落としません。フォントは切り上げません）。軸を横切る向きは `paintValueTitle`（`stagePanes.ts`）が、2 行になっても行がキャンバスの端とグラフの間に入るように、名前の中心を内側へ寄せます。グラフごとに直さず、この 2 つを直します。ブラウザの検査（`canvasAudit.ts` の `__titleAudit`）は、どのテストでも、グラフとその軸のキャンバスに書いた軸名（単位の角かっこで見分けます）の文字の箱が、そのキャンバスの中にあることを書いた時点で確かめます。新しい画面を足したら、`plotContract.spec.ts` の `NAME_SCREENS` に足して、狭い・低い大きさでも確かめます。
- テスト: `src/test/axisNames.test.ts` › a fitted axis name is never longer than the room it was given, at any size and on one line or two; and the font is never rounded up (R4)
- テスト: `src/test/laneAxes.test.ts` › a value axis's name stays inside its canvas across the gutter too, on one line and on two, at every height (R4)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on an axis name drawn outside its canvas, on a plot or a plot's axis canvas (R4)
- レポートの図の題と凡例は、キャンバスの幅からはみ出しません。題は真ん中を「…」で縮め、凡例は 1 行に入らなければ各項目に行を等分し、名前を真ん中で縮めます。
- テスト: `src/test/stagePanes.test.ts` › a report figure's title and legend never run past the canvas: the title cut in the middle, each legend name cut to its share of the row (A37, R4)

## R5 色は役割を表し、役割のない録音は録音ごとの色

基準は青、比較 1 は黄、比較 2 は紫、比較 3 はマゼンタ、差は緑、手順バーに置いた手順のうち動かないもの（実行して失敗した、サンプルレートや値が合わない、前の手順が動かない）と、入口の表で読めない録音や CSV の行と合わない録音の理由はオレンジです（`src/shared/gui/roleColors.ts`）。役割のない録音は、録音ごとに自分の色（青緑・茶・オリーブ・砂色、役割・差・失敗の色と重ならない）を持ち、比較台でもトラック表示でもカーソルスペクトルとペアスペクトルでも、入口の保持図でも同じ色です。どのピークがどの録音の線かを色でたどれるようにするためです。ほかの録音の役割が変わっても、録音が足されても色は変わりません。役割を付けると役割の色になります。解析窓の帯は灰色です。＋ で選べない操作はオレンジにせず、灰色にして理由を書きます（R8）。

- テスト: `src/test/uiSmoke/stageReturn.spec.ts` › in Compare, colour is the role's: a recording without one has its own colour, its name in the legend
- テスト: `src/test/uiSmoke/roleChips.spec.ts` › in the track view, each recording without a role has its own colour on its lane and its chip, as in Compare; a role gives it the role's colour
- テスト: `src/test/renderScript.integration.test.ts` › directory selection mode keeps an existing track and its own colour when a new earlier tree item appears
- テスト: `src/test/canvasOverlays.test.ts` › drawAnalysisWindowBand is a neutral grey, not a role's or the failure's hue, on a dark and a light lane (R5)
- テスト: `src/test/entrySlots.test.ts` › a recording beside the table is drawn in its role's colour, else its track's own, else the first own colour (R5)
- テスト: `src/test/entryHeldPlot.test.ts` › a held step draws its row in the colour the row is drawn in elsewhere (its role's, else its own), not always slot 1's yellow (R5)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the comparison draws its difference in the difference's green and its recordings in their roles' colours, neither in the other's nor the failure's orange (R5)
- テスト: `src/test/uiSmoke/trackStage.spec.ts` › a step that cannot run on these recordings says why: ＋ greys a 48 kHz-only step out, and a step failing on a file is marked with wandas' reason on the plot
- テスト: `src/test/uiSmoke/entry.spec.ts` › a picked CSV attaches its attributes by asd-insight's rules and lists what did not match with why (I5)

## R6 比較は重ね描き、静かなものが上

比較台は dB の差ではなく重ね描きです。実線で、塗りつぶしません。レベルの大きいものから描き、静かなものが最後に上に来ます。

線を重ねるグラフはどれも同じです（比較台、レポートの重ね図、カーソルスペクトル、ペアの図、トリガーのレーンなど）。描く順は呼ぶ側ではなく共通の部品 `paintOverlay`（`src/webview/runtime/stagePanes.ts` の `overlayOrder`）が決めるので、呼ぶ側がどの順で線を渡しても、静かな線が上に来ます。レベルは画面に見えている範囲の値で比べます。比べる値は間引く前の全部の値で、描いた点は使いません（R2）。処理部（または全データを持つ Webview）が、線ごとに軸を 256 の区間に分けて、各区間のパワーと値の数を `levelBins` として付けます。スペクトルは dB 値のパワー平均、波形はサンプルの二乗平均（共通の振幅軸で）です。区間が全部画面の中か外にあるときは `levelBins` だけで決まります。画面の端が値のある区間を切るときは、その区間のどの値が見えているかは `levelBins` ではわからないので、その線の全データ（`full`）から、画面に見えている範囲の値だけを全部使ってパワーを出します。Webview が全データを持つ線はその場で、バックエンドが持つ線（比較台の図・中央値、表示用に切ったカーソルスペクトルなど）は読み値と同じ仕組みで取り寄せます（`fullRead.ts` の `level`、バックエンドは `full_read.py` の `read_level`）。表示用に切ったカーソルスペクトルは、描くために残した点で `levelBins` を作らず、全ビンから測ります。届くまでは、一部の値から推し量った順では描きません。そのグラフで最後に全部の値で決めた順を保ち（まだ決めたことがなければ渡された順）、`data-plot-order` に「…」と書き、全部届いたら部品が全部の値の順で描き直します。レベルの読み取りが失敗したときも同じで、順は決まっていないままにします。推し量った値（`levelBins` からの見積もり）で順を決めず、最後に全部の値で決めた順（なければ渡された順）を保ち、`data-plot-order` に「!」と書きます（`stagePanes.ts` の `ScreenLevel` の `failed`）。失敗した読み取りは、ほかの答えと同じ決まり（`answerStore.ts` の `FAILED_RETRY_MS`、5 秒の間を置く）で出し直し、届いたら描き直します。出し直しのコードをグラフの側に足しません。5 秒たっても「…」や「!」のままのグラフは UI テストを失敗にします。拡大して 1 サンプルずつになっても、直流の信号でも、正しい大きさになります。dB の線と波形で `levelBins` がないものは、`data-plot-order` に「?」と書き、UI テストを失敗にします。dB でない線（位相、γ²、分布の目盛りの線など）は、レベルのある線の後に、渡された順のまま描きます。比べる線でないもの（点や目盛りのしるし、塗った棒、ヒートマップ、レーンの一部だけを細かく描き直す部分）は、呼ぶ側が置いた位置のままです。右の第 2 のレベル軸の線は、その中で同じ順にします。トリガーのイベントは、その録音の線として一緒に並びます。色は役割の色のままで、順によって変わりません。マウスで強調した線は、この順とは別に、上の層に太く描きます。部品は描いた順の線のレベルを `data-plot-order` に書き、UI テスト全件で、画面に出ているグラフのどれかでレベルが上がる順に描いたら、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。
- トリガーのイベントも、波形と同じく全イベントの全サンプルの二乗平均で並べます（`stage_combine.py` の `_event_level_bins`）。測れないイベントの線は「?」と書き、UI テストの監査で失敗にします。
- テスト: `python-backend/test_stage_combine.py` › test_a_triggers_events_carry_their_samples_power_so_a_quiet_recordings_events_are_drawn_over_a_loud_ones
- テスト: `src/test/stagePanes.test.ts` › a trigger's events overlaid are ordered by their samples' power: without it they are written unmeasured, which the audit of every plot fails (A44, R6)
- レベルが何の量か（サンプルの二乗平均か、dB 値のパワー平均か）は、処理部が `levelBins.of`（`'square'` か `'dbPower'`）で言います。決めるのは levelBins を作るただ一か所（`stage_combine.py` の `level_bins`。Webview が全データを持つ線は `stagePanes.ts` の `levelBinsOf` で `'dbPower'`）で、読んだデータの種類から決めます。Webview は図にどの項目があるか（`waveform` があるかなど）から推し量らず、`levelBins.of` をそのまま使います。全体表示でも拡大でも同じ量です。画面の端が区間を切るときの全データの読み取りも、同じ `of` の量を頼みます（`square` なら `level: 'square'`）。トリガーのイベントのその読み取りは、全イベントの全サンプルの二乗平均で、イベントの平均の線からは測りません（`stage_combine.py` の `read_points`）。量が拡大で変わると、静かなものが上の順が拡大するだけで入れ替わります。
- テスト: `src/test/stagePanes.test.ts` › a trigger's events are ordered by one level, whole and zoomed: the quantity their levelBins say (`of`), every event's samples on screen (R6)
- テスト: `python-backend/test_stage_combine.py` › test_a_triggers_events_level_is_one_quantity_whole_and_zoomed_every_events_mean_square
- 線を重ねる順は、その線が見せている値から決めます。中央値の線の順は中央値から決めます。グループの中央値（と差）は、録音を組み合わせた 1 本の線で、自分のイベントを持ちません。組み合わせた図を作るのは `stage_combine.py` の `combined_picture` だけで、そこで最初の録音のイベント（`rows`、`event_ids`）を捨てます。そのため中央値のレベルは、全体でも拡大でも（`level_bins`、画面の端が区間を切るときの `read_points`）、中央値の線の間引く前の値の二乗平均で、どの録音がグループの最初に来ても同じです（値の範囲 `value_range` も中央値の値から取ります）。最初の録音のイベントから測ると、同じグループ・同じ中央値の線なのに、録音を並べた順で重ねる順が変わります（例：A のイベントが +10 と −10、B が 1 なら中央値の線は 0.5 でレベルは 0.25 ですが、A のイベントから測ると 100 になります）。録音ごとのトリガーのイベントは、これまでどおり全イベントの全サンプルの二乗平均です。
- テスト: `python-backend/test_stage_combine.py` › test_a_group_medians_level_is_the_mean_square_of_the_median_line_whichever_recording_is_first

- テスト: `src/test/stagePanes.test.ts` › every plot draws its overlaid lines loudest first and the quietest last on top, whatever order the caller gives them (R6)
- テスト: `src/test/stagePanes.test.ts` › while a line's level on screen is on its way, the plot keeps the order it last judged on every value: never one guessed from part of it (R6)
- テスト: `src/test/stagePanes.test.ts` › a level read that failed leaves the order unsettled and written "!": never the order of the estimate, and it is asked again after the answer store's pause (R6)
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

カーソル、最寄りの線の強調、読み値、拡大の操作は、どのグラフでも同じ部品で同じように動きます。マウスは、どの線の点でも、縦横の距離でマウスに一番近い点（半径 20 px 以内）を読みます。細いピークの少し横に置いても、頂上の近くなら頂上を読みます。半径の中に点がなければ、マウスの真下の周波数（時刻）で高さが一番近い線を読みます。← / → は、マウスの下（またはキーボードで選んだグラフ）で読んでいる線の、間引く前のデータの次の点（ビン、帯、サンプル、熱図やスペクトログラムの次のフレーム）を、マウスをその点に置いたときと同じに読みます。1 ピクセルに何点重なっていても、どの拡大でも 1 点ずつ進みます。どのグラフでも同じ部品（`plotHoverLayer.ts` の `stepFrom`、キーは `trackPointerEvents.ts`）が受けます。ただし、キーボードのフォーカスがあるレーン（クリックしてカーソルを置いたレーン）では、マウスがそのレーンに乗っていても、← / → はこれまでどおりカーソルを動かします（下の「キーボードのフォーカスの例外」）。読み値を動かすのは、フォーカスしたレーン以外のレーンと、レーンでないグラフです。カーソルスペクトルとペアの図は、読んだ点の周波数でたがいのカーソルを合わせます。トラック表示の波形のレーンも同じで、マウスの下のレーンだけが点を読み（時刻は目盛りと同じ全体の時間軸）、ほかのレーンはその時刻に線を引きます。スペクトログラムのレーンは、ほかの色の図と同じく、マウスの下のマスの時刻・周波数・レベルを読みます。クリックで決めるカーソル（カーソルスペクトルの時刻と解析窓）はこれとは別です。ただし、クリックがカーソルを置く時刻は、マウスの画素の時刻ではなく、押したときにレーンの読み値が読んだ点の時刻です。読み値が何も読まないとき（解析のあとでファイルが変わったレーンなど）は、マウスの時刻です（R13 の「クリックは、読み値が読んでいる点に効きます」）。

- **キーボードのフォーカスの例外（← / →）。** ← / → が読み値を動かす決まりの例外は 1 つだけです。トラック表示のレーンにキーボードのフォーカスがあるとき（クリックしてカーソルを置いた、Tab で選んだ）は、マウスがそのレーンに乗っていても、← / → は再生の時刻カーソルを動かします。1 回で今の拡大の窓の 1 画素ぶん、Shift を押すと 0.1 秒です（`shortcuts.ts` の `keydownIntent` と `arrowCursorStep`）。理由：レーンにフォーカスを置くのは、聞く位置を決めるためです。その場で ← / → で聞く位置を細かく動かすのは聞き比べの基本の操作で、フォーカスしたレーンのキーが読み値に取られると、その操作がなくなります。フォーカスのないレーン、ほかのレーン、レーンでないグラフでは、← / → はいつもどおり読み値を動かします。
- この例外を作るのは、共通の部品の 1 つの口だけです（`plotInteraction.ts` の `focusKeepsArrows`。`trackPointerEvents.ts` は、フォーカスのあるレーンへのキーを読み値に回しません）。ほかのグラフに同じ例外を足すときは、この段落と下のテストを一緒に変えます。グラフごとにキーを横取りして作りません。
- テスト: `src/test/shortcuts.test.ts` › keydownIntent moves the time cursor with arrows only while a track canvas has focus (R7)
- テスト: `src/test/shortcuts.test.ts` › arrowCursorStep moves one pixel of the zoomed view, or 0.1 s with Shift (R7)
- テスト: `src/test/plotInteraction.test.ts` › a plot that keeps the arrows for itself while focused does not step its readout from them; another plot does

読み値の数字は、どのグラフでも間引く前のデータから読みます。間引いたデータは線や絵を描くためだけに使います（R1、R2）。マウスが読む点も ← / → が進む先も、描いた点ではなく全解像度の点です。間引いて線から消えた点も、マウスに一番近ければその点の値を読みます。熱図とスペクトログラムは、画面のために平均したマスではなく、本当のマス（1 フレーム・1 ビン）の値を読みます。描く層は、どれも全データの出どころを必ず持ちます（`fullRead.ts` の `StageLayer.full`、型で必須）。出どころは 2 種類だけです。webview が全部の値を持つもの（`InlineFullSource`：棒と帯の全帯、ペアの図の全ビン、分布のビン・点、カーソルスペクトルの全ビンの行、入口の概観の表）はその場で読み、バックエンドが持つもの（`FetchedFullSource`：比較台の図・中央値・差、トラックのサンプルと STFT のマス、表示用に切ったカーソルスペクトル）は、マウスのまわりの窓だけを 1 つの仕組み（`fetchedSource`、バックエンドは `full_read.py`）で取り寄せます。読み値も ← / → も、棒でも、描いた点からは読みません。取り寄せた窓は覚えておき、同時に送る要求は 1 つ、その間に動いたぶんは最後の 1 つだけを次に送ります。← / → の次の点はその窓の先 256 点まで一緒に来るので、キーごとに要求は出ません。値のない点（無音）がどれだけ続いても、← / → は 1 回の要求でバックエンドに次の値のある点を探させ（`seek`、`full_read.py` の `_seek_line`）、その先の点と一緒に受け取ります。窓ごとの要求も、同じ要求の出し直しもしません。縦軸を拡大して軸の外に出た点も、← / → は止まらずに 1 点ずつ進み、図の上下の端で読みます（マウスがどの点を読むかは、下の表の決まりです）。窓が画面の幅より密なときは、画素の列ごとの最小・最大とマウスの高さに一番近い点に加えて、画面の上の本当の距離でマウスに一番近い点と、横軸の上でマウスの真下に一番近い値のある点（`under`。どの点もピックの半径の外にあるときに読む点）（どれも本当の点）だけを返します。そのため Webview はマウスの位置と画面の縮尺（横軸の単位あたり・値の単位あたりの画素。値の縮尺は軸の正確な `pixelsPerUnit` で、描くために留めた y の差ではありません。R14）を送り、その位置の答えだけをその位置で読みます。別の軸で読む出どころ（トラックのレーンはファイルの 0〜1 で読む、`mappedSource`）にも、その位置と縮尺をその軸に直して送ります。届くまでは、カーソルだけを出し、読み値は空にします。密な窓を別の高さで読むときも、前の高さで届いた点は読まず、その高さの点が届くまで空にします。届く前のクリック（トリガーのイベントの線を外す・戻す）は捨てず、届いてから決めます（その間に次の押下やダブルクリックがあれば、そちらが代わります）。全データを渡せない層（`NO_FULL_DATA`）は読み値を出さず、そのグラフに部品が印を付け（`data-plot-full`）、UI テスト全件がそれで失敗します（`canvasAudit.ts`）。

読み値は、どのグラフでもグラフに重ねず、グラフの外の決まった行に出します。重ねると、読みたい線のまわりが隠れるからです。読み値は、グラフのすぐ上の行に出します。比較の図は操作ボタンの行、その下の差の欄は差の見出しの行、トリガーのイベントの図の下に並ぶレーンはそのすぐ上の読み値だけの行、入口の保持図はその題の行、カーソルスペクトルとペアの図はそれぞれの見出しの行、見出しの行がないトラックのレーンはツールバーの行です。比較の図・差の欄・トリガーの下のレーン・入口の保持図・カーソルスペクトル・ペアの図は、マークも読み値も共通の部品（`plotHoverLayer.ts`）で描き、トラックのレーンは共通部品 `showPlotReadout` で書きます。左右に 2 本のレベル軸がある図（カーソルスペクトル）では、部品が両方の軸の線から一番近い点を読み（半径 20 px 以内の点が先で、拡大で図の外に出た線が図の端に寄せた位置で勝つことはありません）、レベルの線は読んだ軸の側までだけ引きます。この行は空のときも場所を取っておくので、マウスを乗せてもグラフは動きません。比較の図のこの行には、差が最大の点（見出し）は出しません。数字はマウスの読み値だけにして、どの数字が何かを迷わないようにします。Δ を押して開く差の欄は別で、その見出しには差が最大の点（差が出せないときはその理由）を出します。差の欄は差そのものを見る場所だからです。名前が長いときは名前の側を省略し、時刻（周波数）と値は省略しません。行の幅が足りないときは、読み値はボタンの下の段に移ります（グラフの上のままです）。値が行や画面の端からはみ出すことはありません。この決まりは UI テスト全件で確かめます。どのテストでも、読み値がグラフに重なって表示されたり、値が行や画面の端で切れたりしたら、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。

読み値と見出しの数字は、どのグラフでも同じ書き方です（`src/webview/plot/plotText.ts`）。周波数は 1 kHz 未満は Hz（整数でないときは小数 1 桁）、1 kHz 以上は kHz で 1 Hz まで（「1.016 kHz」「3.15 kHz」）書きます。ビンの間隔が 1 Hz より細かいときは、その間隔を見分けられる桁まで書く（0.73 Hz 間隔なら「1.0027 kHz」）ので、隣のビンが同じ数字になりません。レベルは 0.1 dB まで単位付き（単位はそのレベルの軸やカラーバーと同じ基準の「dBFS」「dB SPL re 20 µPa」で、素の「dB」は差だけ）、時刻は秒で、少なくとも 10 ms まで、点の間隔が細かいときはその間隔を見分けられる桁まで書きます（48 kHz で 256 ずつの熱図の列、5.3 ms 間隔なら「1.008 s」「1.013 s」）。ほかの値は大きさによらず有効数字 3 桁です（「12.3」「1230」、100 万以上と 0.001 未満は指数）。桁の決め方は 1 つで、隣の点（サンプル・ビン・フレーム・ラグ）や隣の目盛りと同じ数にならない桁まで書きます（`plotText.ts` の `spacingDecimals`）。波形の時刻はサンプルの間隔から、ケフレンシーとラグも点の間隔から、軸の目盛りは隣の目盛りとの間隔から（対数の周波数軸を狭く拡大したら窓の中の切りのよい値に目盛りを置き、「1.002k」のようにその位置の値を書く。1 kHz をまたぐ 10 倍未満の窓は全部 k で書き、「1000」と「1k」を混ぜない）、値の軸の目盛りは指数で書くときも隣の目盛りを見分けられる有効数字まで（0.0897 の付近を数百万分の 1 に拡大しても「8.96728e−2」「8.96730e−2」）、軸の範囲の入力欄は範囲の幅の 1/1000 まで、CSV とレポートの領域の始めと終わりは区間の表記と同じく 10 ms まで、短い区間では長さの 1/10 を見分けられる桁まで書きます。桁の上限（時刻・周波数の目盛りは 9 桁）より細かい窓では、同じ数の目盛りを 2 つ書かず 1 つにまとめます。軸の種類と拡大の段階を格子で総当たりして、隣の目盛りや隣の点が同じ数にならないことを単体テストで確かめます（`src/test/plotText.test.ts`）。UI テスト全件で、1 本の軸に同じ数の目盛りが 2 つ描かれたら、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。ラグ・ケフレンシー・Bark・符号付きの差も同じファイルの書き方で、ラグとケフレンシーは軸の名前と同じ秒で書きます（「+0.00125 s」「0.0125 s」。軸が [s] なのに読み値を ms で書かない）。入口の分布図の読み値も表の列の書き方ではなくこの決まりで書きます（ピーク周波数は「3.15 kHz」）。分布図のビンの範囲と読み値は、ビンの幅を見分けられる桁まで書くので、隣のビンが同じ数字になりません。負の数はハイフンではなく本物のマイナス記号（−）で書きます。マイナス記号を手で付けるコード（ハイフンの置き換えや、`'−'` だけの文字列で符号を選ぶもの）は lint で止めます（`scripts/lint-webview-patterns.js`）。Markdown のレポートと、それが比較台と共有する書式（`src/shared/report/`、`src/shared/utils/format.ts`）も同じで、数を文字にするときは `plotText.ts`（`levelText`、`withMinus`）を通し（「−1.8 dBFS」）、通さずに `toFixed` などで書く行は同じ lint で止めます。

セル（熱図の列と行）と棒の区切りは、どのグラフでも 1 つの規則（`fullRead.cellEdges`）で決め、描く絵、マウスが読むセル、← / → の先が同じ区切りを使います。対数軸では隣り合う 2 点の幾何平均（√(f1·f2)：100 Hz と 125 Hz の境は 112.50 Hz ではなく 111.80 Hz）、線形軸では中点です。帯の間隔が一定でなくても、棒は自分のセルの幅に描きます（`stagePanes.barEdges`）。

単位は読み値と見出しから落としません（`stagePanes.valueText`）。dB でない熱図（ラフネスの asper/Bark など）の値も、dB でない量の Δ（「+0.300 Pa」）も、その単位で書きます。

縦軸を拡大して線の一部が画面の外に出ているときに、マウスがどの点を読むかは、どの種類の線（波形、スペクトル、レベルの時間変化、Δ の線）でも次の 1 つの決まりです。決まりを置く場所は 1 か所で、Webview は `stagePanes.ts` の `fullLineNear`、バックエンドは `full_read.py` です。

| 読む点 | いつ読むか | どの点か | 値が軸の外の点 |
|---|---|---|---|
| 一番近い点 | 半径 20 px の中に点があるとき | 値が画面に見えている点（`shown` の範囲の中）のうち、画面の上の距離でマウスに一番近い点 | 候補にしません。描かれていない点を「近い」として選ばないためです |
| マウスの下の点 | 半径の中に点がないとき | ピックの窓とその外の 1 点ずつの中で、横軸の上でマウスの位置に一番近い、値のある点。値がいくつでも同じです。その中に値のある点がなければ、下の「値のない区間」の決まりです | その点を読みます。印は図の上下の端に置き、読み値には本当の値を書きます（← / → で進んだときと同じ） |

- 「一番近い点」を画面の中の点に限るのは、軸の外の点を候補にしてから Webview で捨てると、画面の中の本当の最寄りの点を読み落とすからです。密な窓では、バックエンドが `shown` の中から選びます（`full_read._nearest_on_screen`、`_on_screen`）。
- 「マウスの下の点」を値で絞らないのは、絞ると、マウスの真下の点の代わりに横にずれた別の点を読むからです。密な窓では、バックエンドが値で絞らずに選びます（`full_read._nearest_along`、答えの `under`）。
- この決まりを変えるときは、まず下のピックの表の行を足すか変え、`fullLineNear`（← / → は `stageStep`）と `full_read.py` を一緒に変え、表の両方のテストと下の 4 種類の線のテストを通してください。線の種類ごとの分岐は足しません。

マウスが読む点と ← / → が進む先の決まりの定義は、1 つの表 `python-backend/tests/fixtures/pick_cases.json` です。上の表と文はその説明で、食い違うときは表が正しく、説明を直します。表の 1 行は、線の点（x と値。値のない点は null・NaN・±∞）、値の線か無音の床のあるレベルか（`plain`）、表示（横軸の範囲と線形・対数、値の範囲、図の枠の画素）、マウスの位置（枠の左上からの画素）か読んでいる点の番号（`from`）、読み方（`nearest`：半径の中の一番近い点、`under`：マウスの下の点、`click`：そこでのクリックが効く点、つまり読み値が読む点（`plotHoverLayer.clicked` を通して）、`step+` / `step-`：→ / ←）と、読む点の番号（なければ null。値のない区間の上で「ここに値はありません」と答えるときは `empty` も）です。Webview（`stagePanes.stageHover` と `stageStep`、`paintOverlay` で描いた図と全部の値を持つ線で）とバックエンド（`full_read.pointer_picks` の `_nearest_on_screen` と `_nearest_along`、← / → は `_seek_line`）が、同じ表の全行をテストで通します。表には、同じ距離の 2 点（データの順で先の点）、同じ x で値の違う点（← / → は `from` から隣の点へ）、拡大した値の軸の外の点、±0.001 と ±10⁶ の値の範囲、対数の横軸、値のない点と無音の床、窓より長い・短い値のない区間、線の両端を入れています。クリック（`click`）の行は、同じ高さで 4 px 離れた 2 点の 2 点目の上、そのまんなか、同じ x の重なった点、半径の中に点のない 2 点のあいだ、値のない区間、線の外です。表の 1 行は 1 本の線なので、棒のビンの境や概観帯の行の境は表せません。それはブラウザの契約（`plotContract.spec.ts` の `CLICK_CASES`）と各図のテスト（R13 の「クリックは、読み値が読んでいる点に効きます」）が確かめます。

- 片方で表せない行は、行の `not_on` にその側と理由（表の `cannot` の名前）を書きます。黙って飛ばしません。どちらのテストも、表せない行の一覧を確かめます。今は、バックエンドで表せない 10 行です（`click` の 6 行は、バックエンドがクリックを読まないため：`no-click`）。ピックの半径（20 px）は Webview だけが持ちます（バックエンドは画面の上で一番近い点を距離によらず送り、Webview が半径で選ぶ）。バックエンドの seek は `from` を持たず x だけで進みます（バックエンドの線は x が重ならない。重なる線は Webview が全部の値を持って番号で進む）。バックエンドの seek は表示を知りません（図の横の端で止まるのは Webview）。
- 決まりどおりにまだ動かない行は、`today` に今の答えと、それを変える作業を書きます。その行は今の答えを確かめ、決まりどおりに直るとテストが失敗して `today` を消すよう求めます。今はありません。
- 値が有限でない点（NaN、±∞）は値のない点です。マウスの下でも ← / → の先でも読みません（`stagePanes.fullPoint`、`fullRead.readableValue`、`full_read._readable`）。
- **値のない区間（ギャップ）の決まり。** 値のない点（有限でない値、レベルの線では無音の床も）が続く所は線のギャップです。(1) マウスは、これまでどおりピックの半径の中の一番近い点、なければピックの窓（とその外の 1 点ずつ）の中のマウスの下の値のある点を読みます。窓より短いギャップは、その上にマウスがあっても飛び越えて、窓の中の値のある点を読みます。(2) マウスの下がギャップの中で、窓の中に値のある点が 1 つもないときは「ここに値はありません」という答えです。点は読まず、点の印（太い線、値の線）も出さず、カーソルだけを出し、読み値の行には言葉で書きます（`strings.plotNoValue`「— ここに値はありません」）。読み値の行が空なのは、全データがまだ届いていない（`pending`）ときだけです。空の行とこの答えを取り違えないためです。線の最初の点より左、最後の点より右はギャップではなく、線の外です（読み値は出しません）。Webview は `stagePanes.fullLineNear` がこれを見分けて `stageHover` が `empty` の答えを返し、`plotHoverLayer` が書きます。バックエンドは窓の中に値のある点がないとき `under` を送りません（`full_read._nearest_along`）。(3) ← / → は値のある点から値のある点へ進み、ギャップは長さによらず 1 回で越えます。値のない点には止まりません（`seek`、`full_read._seek_line`）。(4) 描いた線はギャップで切れます（R2）。表の行は、窓より長いギャップの上（`empty`）、窓より短いギャップの上、窓より長いギャップを越える → と ← です。
- テスト: `src/test/plotHoverLayer.test.ts` › over a gap of the line with no value in reach the readout says "no value here", told apart from a read still on its way, which is blank (R7)
- マウスの下の点は、ピックの窓と、その外の 1 点ずつ（`beyond`）から探します。Webview は送られた点から、バックエンドも同じ範囲から探します（`full_read.pointer_picks`）。線の最初の点より左、最後の点より右に半画素より外では、マウスの下の点はありません。
- UI テストの ← / → の確かめ（`src/test/uiSmoke/plotContract.spec.ts` の contract の `step` と `zoom keys`）は、次の点を、グラフ自身の全データ（`StageLayer.full`）からではなく、テストが自分で送った・作ったデータから、この表の step の決まりで求めます（`src/test/uiSmoke/knownData.ts`：比較の図はテストが送った絵（録音の線とレーンはその録音の最新の絵、基準群の中央値はテストが置いた群の全部の録音の値から点ごとの中央値、Δ は比較の録音の値からその中央値を引いたもの。最初の録音で群を代表させません。中央値の読める点は最初の録音の読める点と違うからです）、レーンはテストが送った解析結果や作ったページの状態、カーソルスペクトルとペアの図は stand-in が送ったビンとその値（レーンのスペクトログラムのカーソルの列、スタブの値。stand-in が送ったものを記録し、線の名前のファイルとチャンネルで探す）、入口の保持図は渡したビンから求めた Δ の値（保持した行のチャンネルから基準の録音の中央値を引く）、概観は 1/3 オクターブの中心周波数、分布図はビンと数を決めて作った分布（`KNOWN_DISTRIBUTION`：値の軸の端・ビンの中心と範囲・ビンごとの数・同じ値の録音を、図の実装のビン分けを通さずに手で求めた表。ほかのテストの入口の画面に出る分布図は、開いたスキャンの各チャンネルの Leq から、下の目盛りはその値の順に、棒は描いたビンの中心の間隔で切った 48 のビンにテストが自分で数えて求める（`scannedDistribution`）））。同じ x の隣の点があれば、番号か identity でその点を確かめます。実装に期待を聞くと、実装のデータが間違っていても一致してしまうからです。テストがデータを知らないグラフは `NO_KNOWN_DATA` に理由と一緒に書き、そのグラフは一方向に進んで戻ることだけを確かめます。今はありません（一覧は減るだけです）。「進んだ」だけを確かめると、2 点ずつ進む層や点を 1 つ落とす層も通ってしまうからです。書かれていないグラフをデータなしで確かめると、そのテストが失敗します。分布図は、テストが数を知っている分布を開き、← / → で棒（数のあるビン）と録音（下の目盛り）を端から端まで 1 回に 1 つずつ進み、棒ごとに中心・範囲・数を、同じ値の録音は 1 回ずつデータの順（値、次にキー）で読むことを、拡大の前と後で確かめます。
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the distribution's ← / → pass every bar and every recording of a known distribution once, in order, shown whole: each bar's centre, range and count (R7)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the distribution's ← / → pass every bar and every recording of a known distribution once, in order, zoomed in: each bar's centre, range and count (R7)
- テスト: `src/test/pickCases.test.ts` › every pick case of the table is read by the webview as the table says: nearest, under, a click, ← and → (R7)
- テスト: `src/test/pickCases.test.ts` › the pick cases the webview cannot express are listed with why (R7)
- テスト: `src/test/knownData.test.ts` › the base group's median is stepped on its own readable points, not on its first recording's: of A −300, −300, 0 dB and B 0, 0, 0 dB the median −150 dB is a point (R7)
- テスト: `src/test/knownData.test.ts` › a Δ is the compared recording minus the base group's median, none where any member has none, and a line naming a recording or in its lane is its own (R7)
- テスト: `src/test/knownData.test.ts` › a spectrum's bins are stepped on the values the stand-in served the line read: a level line skips a −260 dB bin and a gap, a plain one steps onto −260 dB (R7)
- テスト: `src/test/knownData.test.ts` › a held Δ is the held row's bins minus the median of its base's, none where any has none (R1, R7)
- テスト: `python-backend/test_pick_cases.py` › test_every_pick_case_of_the_table_is_read_by_the_backend_as_the_table_says
- テスト: `python-backend/test_pick_cases.py` › test_the_cases_the_backend_cannot_express_are_listed_with_why
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)


読み値の時刻・周波数の桁は、元のデータの刻み（その点と、元のデータで隣の点との間隔）から決めます。刻みは、全データの出どころが点ごとに答えに付けて送ります（`StagePoints.steps`。バックエンドは `full_read.source_steps`、Webview が全部の値を持つ線は `fullRead.sourceSteps`、別の軸で読む出どころは `mappedSource` がその軸に直します）。Webview は、送られてきた点どうしの間隔から桁を作りません。密な窓では画素の列ごとに数点しか送られず、その間隔は元の刻みよりずっと粗いので、隣のサンプルと同じ数字になるからです。答えに刻みがない点（1 点しかない線など）は、刻みなしとして書きます。熱図とスペクトログラムのマスは、いつも元のデータの隣り合う列と行をそのまま送るので、その間隔が元の刻みです。

- テスト: `src/test/plotText.test.ts` › every tick and readout takes its digits from the spacing of its neighbours: no two read the same, none reads a value it is not at (C3)
- テスト: `src/test/cellEdges.test.ts` › a heatmap on a log x axis draws and reads its columns by the geometric edges: 112 Hz is the 125 Hz column, drawn and read alike (R7)
- テスト: `src/test/cellEdges.test.ts` › bars on a log axis span their cells by the same geometric edges, however unevenly the bands are spaced (R7)
- テスト: `src/test/cellEdges.test.ts` › a readout and a headline keep the unit of a non-dB heatmap and of a non-dB Δ (R4, R7)
- テスト: `src/test/unroundedRead.test.ts` › on a value axis zoomed in, a dense window reads the nearest sample on screen, never one past the axis left out after (R7)
- テスト: `src/test/unroundedRead.test.ts` › on a value axis zoomed in, with no sample near the pointer the dense window reads the sample under it though it is past the axis: its true value, at the plot's edge (R7)
- テスト: `src/test/pointerRule.test.ts` › on a waveform, a spectrum, a level trend and a Δ line alike, with the value axis zoomed the pointer picks its nearest point among those on screen, and with none near reads the point under it whatever its value, at the plot's edge (R7)
- テスト: `src/test/pointerRule.test.ts` › on a waveform, a spectrum, a level trend and a Δ line too dense to send whole, the point the backend names as under the pointer is read though its value is past the axis, and the picked one never is (R7)
- テスト: `src/test/pointerRule.test.ts` › a dense window's readout takes its digits from the source data's own step, which the answer carries, never from the gap between the points sent (R7)
- テスト: `src/test/pointerRule.test.ts` › every source says each point's step in its whole data: a line the webview holds, a seek in it, and a source read on another axis (R7)
- テスト: `python-backend/test_full_read.py` › test_every_line_answer_sends_each_points_step_in_the_source_data_not_the_gap_between_the_points_sent
- テスト: `python-backend/test_full_read.py` › test_a_dense_window_names_the_point_under_the_pointer_whatever_its_value_and_the_nearest_among_those_on_screen
- テスト: `src/test/stagePanes.test.ts` › a time is written to the digits that tell it from the next point: frames 5.3 ms apart never read the same (R7)
- テスト: `src/test/plotText.test.ts` › a frequency reads in Hz below 1 kHz and in kHz to the hertz from there, so neighbouring bins never read the same (R7)
- テスト: `src/test/plotText.test.ts` › a frequency read among points finer than 1 Hz apart gets the digits that tell neighbouring bins apart (R7)
- テスト: `src/test/plotText.test.ts` › a level reads to a tenth of a decibel in its unit, a time in seconds, other values to three figures (R7)
- テスト: `src/test/stagePanes.test.ts` › a level is read in its axis's own unit and reference, on the main axis, the right-hand one and a colour bar: never a bare dB beside "dBFS" (R4, R7)
- テスト: `src/test/plotText.test.ts` › a negative number is written with a true minus sign, its exponent too, never a hyphen (R7)
- テスト: `src/test/plotText.test.ts` › every value has three significant figures however large: no false tenth and no exponent below a million (R7)
- テスト: `src/test/plotText.test.ts` › a lag, a quefrency, Bark and a signed number read the same on every plot (R7)
- テスト: `src/test/plotText.test.ts` › a quefrency and a lag read in the unit their axis is named in: seconds, as the axis says [s] (A36, R4, R7)
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
- テスト: `src/test/trackPointerEvents.test.ts` › ← / → step the readout of the plot under the pointer, or of a focused one; off every plot they go on (R7)

読み値の状態遷移は、どのグラフでも 1 つの状態機械（`plotHoverLayer.ts`）が決めます。トラックのレーン（波形もスペクトログラムも）も同じ部品で読み、進み、待ちます（レーンだけの読み値の状態は持ちません）。全データが手元にある・取り寄せ中・取り寄せに失敗した・点がない、の 4 つの状態で、次のように動きます。取り寄せ中と失敗のあいだは、カーソルだけを出して読み値は空にし、ほかの線（別の録音）を代わりに読みません。失敗は待つ時間（`FAILED_RETRY_MS`）が過ぎると、マウスを動かさなくても読み直します。取り寄せ中や失敗のあいだに押した ← / → は捨てず、点が届いてから、そこで読む点から押した回数だけ進みます（その前にマウスが動けば捨てます）。← / → がデータの端・拡大した窓の端で進めないときも、キーはそのグラフのもので、別の面（フォーカスしたレーンの時刻カーソルなど）へは流れません。値が「値」（波形、指標の時系列、その Δ）の線は −250 以下も値として 1 点ずつ進み、→ と ← は同じ点を通ります。同じ値の点（分布図で値が同じ録音など、横の位置が同じ点）も、← / → は 1 点ずつ、どの点も 1 回だけ通ります。順番は値の順、同じ値の中では決まった順（分布図は録音のキーの順）で、→ と ← で同じです。横の位置だけで「次」を決めると同じ位置の点を全部飛ばすので、webview が全部の点を持つ線（`FullPoints.offset` で点に番号がある線）は、点の番号で次を決めます（`fullRead.ts` の `LineQuery.from`、`stagePanes.ts` の `stepStart`）。バックエンドから取り寄せる線（時刻・周波数）は横の位置が重ならないので、位置で決めます。同じ位置に点が重なる新しい線を足すときは、点を決まった順に並べ、全部の点を持つ出どころ（`localLine`）で渡します。選んだ点は、それが何であるかで覚えます。← / → で選んだ点を再描画のあとも読み続けるとき、点は線が渡す変わらない名前で探し直します（`StageLayer.identity`：分布図の点とラグは録音のキー）。配列の位置や横の位置では探しません。再描画のあとは、同じ位置が別の録音になっていることがあるからです（順番が変わった、録音が減った・増えた、同じ値の録音がある）。その名前が新しい絵にもうなければ、選んだ点を捨てて、いつもの規則どおりマウスの下を読みます。点が「もの」（録音など）である線は必ず `identity` を渡します。点が軸の上の場所（ビン、サンプル、フレーム）である線は渡さず、横の位置（熱図は行も）で探し直します。配列の位置は、1 回の描画の中で次の点を決めるときだけ使います（`stagePanes.ts` の `identifiedPlace`、`stageReadAgain`、`stageStep`）。選択は見た目だけを変えます。範囲を選んでも（分布図の Alt+ドラッグやビンのクリック）、← / → が通る点は変わりません。描いてある録音と棒を、範囲の中も外も、どれも 1 回ずつ、範囲を選んでいないときと同じ順番で通ります。← / → が進むのは 1 本の層（`StageLayer`）の全データの中だけなので、一部の点の状態（範囲の中、強調など）を別の層に分けると、キーが境をまたげず、点を飛ばします。だから、状態は同じ層の上で見た目として描きます。点の色は `StageLayer.colorAt`、棒のうち状態にある分は `StageLayer.share` です（分布図は `entryDistribution.ts` の `distributionRows`。範囲を選んだときの棒の読み値は「範囲の中の数 / ビンの数」）。層の全データ（`full`）は、いつもその線の全部の点を持ちます。画面に重ねるだけのもの（選んだ範囲の帯、ループの区間、拡大の枠）は層ではないので、キーには関係しません。新しい選択や強調を足すときも、点を別の層に分けません。レベルの床（−300 dB）は 1 回で越えます。無音の床があるのはレベルとゲインの線だけで、Δ には床がありません（`stagePanes.floorless`）。ブラウザの共通テスト（`plotContract.spec.ts` の `nextPoint`）は、次の点の期待値をキーと同じ規則（次の読める点までのシーク、床はレベルとゲインだけ）で求めます。規則を変えるときは `stageStep` と `nextPoint` を一緒に変えます。再描画・大きさの変更・＋ / − / 0 のあとも、← / → で選んだ点を読み続けますが、その点が窓の外に出たら選んだ点を捨て、マウスの下を読みます。描いた枠の外の点を読むことはありません。スクロールでグラフがマウスの下から動いたときも、マウスの下を読み直します。矩形ズーム・Alt+ドラッグ・Shift+ドラッグの間は読み値を消し、離したらその位置で読みます。離した知らせが届かないドラッグ（ページの外でボタンを離した、ウィンドウがフォーカスを失った・隠れた、ポインタが取り消された）は、その場で何もせずに終わらせます（`trackPointerEvents.ts` が `pointercancel`・`lostpointercapture`・ウィンドウの `blur`・`visibilitychange`・ボタンを押していない `mousemove` を聞き、`plotInteraction.ts` の `abandon` が終わらせます）。拡大もクリックもせず、押した側（レーンのループや移動のドラッグ）には終わったことを伝えます。終わらせないと、「ドラッグ中」のままになって、どのグラフも読み値を出さず、キーも受け取らなくなるからです。新しい終わり方を見つけたら、`abandon` を呼ぶ知らせを `trackPointerEvents.ts` に足し、下のテストの一覧（`LOST_RELEASES`）に足します。フォーカスが外れて消えるのはフォーカスで出した読み値だけで、マウスの下のグラフの読み値は残ります。段のジェスチャ（矩形ズーム、Ctrl+ホイール、軸のダブルクリック）は、描いた枠の余白（右の 2 本目のレベル軸も含む）で位置を決め、右の軸の上は軸として答えます。データの届く前のイベント線のクリックは、クリックしたときの絵で決めます。
- テスト: `src/test/readoutTransitions.test.ts` › every chart reads through the one readout: outside plotHoverLayer no runtime code reads or steps a point itself (the lanes keep no readout of their own); a trigger's event click is decided on the clicked plot only (R7)
- テスト: `src/test/readoutTransitions.test.ts` › the transitions table runs every Frame kind on every chart in every state of its full data, and every line through a silence (R7)
- テスト: `src/test/stagePanes.test.ts` › ← / → visit every point sharing one x exactly once, in one order both ways: recordings of the same value on the distribution's dots and rug (R7)
- テスト: `src/test/stagePanes.test.ts` › a recording stepped to stays that recording after a redraw that reorders, removes or inserts recordings of the same value; gone, it is let go (R7)
- テスト: `src/test/stagePanes.test.ts` › with a range picked on the distribution ← / → still visit every recording and every bar once, in and out of the range, in the order they have with none picked (R7)
- テスト: `src/test/plotInteraction.test.ts` › a drag whose release never reaches the page ends there with nothing done: every plot reads and takes keys again, and no box is zoomed into (R7)
- テスト: `src/test/plotInteraction.test.ts` › a lost release tells the press's owner it ended: an Alt+drag is ended where it last was, and a plain press is told it is no click (R7)
- テスト: `src/test/plotHoverLayer.test.ts` › an arrow key pressed while the readout waits for its points is taken once they are in: the point it steps to, never lost and never an empty readout; two keys, two points (A42, R7)
- テスト: `src/test/trackPointerEvents.test.ts` › an arrow over a plot that cannot step (nothing read, an end, the edge of the window) is the plot's all the same: it never goes on to another surface's cursor (R7)
- テスト: `src/test/trackPointerEvents.test.ts` › the focus leaving a plot takes away only a readout the focus gave: the pointer on another plot of the surface keeps its readout (R7)
- テスト: `src/test/plotInteraction.test.ts` › a drag under way reads nothing, and let go (a box zoom, Alt+drag, Shift+drag) the readout is the pointer's where it was let go, never where it was pressed (R7)
- テスト: `src/test/fullRead.test.ts` › a read the backend failed is no line read: the readout reads nothing, never the line beside it, and is read again once the failure's pause is over (R7, C2)
- テスト: `src/test/fullRead.test.ts` › a seek on plain values (a signal, a metric over time) reads −250 and below as values, one point at a time, and → and ← agree; a level crosses its floor in one (R7)
- テスト: `python-backend/test_full_read.py` › test_a_seek_on_plain_values_reads_every_value_below_minus_250_and_left_and_right_agree
- テスト: `python-backend/test_full_read.py` › test_the_point_nearest_the_pointer_on_screen_is_a_value_below_minus_250_on_plain_values_only
- テスト: `src/test/trackStageGestures.test.ts` › the steps' gestures place the pointer on the plot as it was drawn: with a second level axis on the right its margin is the drawn one, and over that axis is an axis (R13)
- テスト: `src/test/trackStageGestures.test.ts` › a click on an event line waiting for its data is decided on the plot it was clicked on: a zoom by the wheel meanwhile does not move it onto another line or none (R7)
- テスト: `src/test/entryDistributionPane.test.ts` › the readout off a bar says where on the value axis the pointer is, and keeps saying it after a redraw; a scroll under a still pointer reads the row now under it (R7)
- テスト: `src/test/trackPointerEvents.test.ts` › a lane with the keyboard focus keeps ← / → for its time cursor, even with the pointer on it; the pointer on another lane steps that one's readout (R7)
- テスト: `src/test/overlaySpectrumPainter.test.ts` › an arrow key reads the next bin the cursor spectrum drew, from the one the pointer read (R7)
- テスト: `src/test/trackLaneHover.test.ts` › the pointer on a track lane reads the file's own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)
- テスト: `src/test/trackLaneHover.test.ts` › the pointer on a spectrogram lane reads the real STFT cell under it, not the cell averaged to draw it, and ← / → the next frame (R7)
- テスト: `src/test/fullRead.test.ts` › a dense waveform is read at its real samples: a sample not drawn, and every sample by the arrow keys (R7)
- テスト: `src/test/fullRead.test.ts` › a window read is asked for once and kept: the pointer moving inside it asks for nothing more (R7)
- テスト: `src/test/fullRead.test.ts` › a level asked for while a read is on its way is never dropped for a newer read: the pointer's latest goes next, then the latest level (R6, R7)
- テスト: `src/test/fullRead.test.ts` › a spectrogram is read at its real cells, never the cells averaged to draw it, and stepped a frame at a time (R7)
- テスト: `src/test/fullRead.test.ts` › every layer a plot draws is given its full data, held or fetched: one given none is marked and reads no number, bars too (R7)
- テスト: `src/test/fullRead.test.ts` › a picture's full data is fetched by its key, never its drawn points: a band table is read as a line is, and without a key neither has any (R7)
- テスト: `src/test/fullRead.test.ts` › a window too dense to send whole is read where the pointer is: the point nearest it on screen, by its true distance, as brute force finds it; elsewhere, or at another level, its readout is empty until that place's points come; zoomed in further it is asked anew (R7)
- テスト: `python-backend/test_full_read.py` › test_a_dense_window_sends_the_point_nearest_the_pointer_on_screen_as_brute_force_finds_it
- テスト: `src/test/fullRead.test.ts` › a source read on another axis gets the pointer's place and the screen's scale on its own axis, so a dense window there is read nearest the pointer (R7)
- テスト: `src/test/fullRead.test.ts` › an arrow key crosses a silence of any length in one read the backend answers, and the keys after it ask for nothing more: never a request per window, never one asked again (R7)
- テスト: `python-backend/test_full_read.py` › test_an_arrow_keys_seek_crosses_a_silence_of_any_length_to_the_next_value_as_brute_force_finds_it
- テスト: `src/test/trackStageGestures.test.ts` › a click on a trigger's event line while its full data is on its way is decided once it is in, never dropped; a double-click meanwhile still takes it back (R7)
- テスト: `src/test/stagePanes.test.ts` › a signal is read at its sample nearest the pointer within a few pixels, never at a point of the envelope drawn (R7)
- テスト: `src/test/stagePanes.test.ts` › zoomed in on a signal's level axis, the arrow keys still step one sample at a time: a sample past the axis is read at its edge, never a stop (R7)
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
- テスト: `src/test/stageViewKinds.test.ts` › every Frame kind a step from ＋ can give that the app draws has its backend picture in the fixture the plot contract is run on (R7)
- テスト: `python-backend/test_stage_view_kinds.py` › test_the_frame_kinds_fixture_is_what_the_backend_draws_now
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › a ${kind} reached from ＋ answers the same gestures as every plot, overlaid, as its Δ and in lanes (R7)


全データの集まり（線の全部の値、マスの全部の行、全データから計算した 1 つの数）は、作る関数だけが作ります（a whole collection is made only by its producers。`src/shared/provenance.ts` の `WholeLine`・`WholeCells`・`Derived`）。読み値・← / →・重ね順・CSV が全データとして読むのはこれだけです。各値が全データでも、集まりが全部であるとは限らないからです（`filter` や 1 つおきに取った配列は、値はどれも本物でも、間引いた線と同じです）。

- 線（`WholeLine`）を作るのは、スキーマが `x-whole` と分類した backend の配列（`wholeAnswers.ts`）と、ほかの `WholeLine` を値ごとに写す `computedLine(from, (value, index) => …)` だけです。写した線は `from` とちょうど同じ長さです。長さや値の配列を渡す口はありません。ほかの線をいっしょに使うとき（2 本の Δ、録音の中央値）は、写す関数の中で同じ `index` を読みます。
- マス（`WholeCells`）も同じです。作るのは `x-whole` の配列の配列と、行と列を保つ `computedCells` だけで、`localCells` は `WholeCells` しか受けません。行ごとに全データでも、行を間引いた `WholeLine[]` は受けません。
- 1 つの数（`Derived`）は `computedWhole([a, b], (a, b) => …)` だけが作ります。計算する関数には値そのものが渡され、その答えが数になります。
- 写す関数・計算する関数は、呼ぶところに書き、渡された値を使います。関数を外から渡すことと、値を使わずに定数や別の配列から作ることは、`provenanceBoundary.test.ts` が規則 `computed-unused` として拒みます。
- 描く点（`x-drawn`）の配列を「たまたま全部だから」と全データにする口はありません。カーソルスペクトルは、backend が行を表示用に切らなかったときだけ、全ビン（帯）を `x-whole` の `bins` として送り（`analysis_service.spectrum_slice`）、読み値と CSV はそれだけを読みます（`wholeAnswers.everyBin`）。比較台の棒（帯の表）は、ほかの絵と同じく段の鍵（`data`）で全データを取り寄せて読みます（`stageReader`）。鍵のない絵は全データがなく、読み値を出しません。
- この規則のテストが失敗したら、型か口を広げて通すのではなく、上の作る関数のどれかで全データを作ってください。何をすればよいかは `docs/plot-contracts-guide.md`（"Adding a number a user reads"）にあります。
- テスト: `src/test/provenanceBoundary.test.ts` › a whole line, whole cells and a computed whole number are made only by their producers: a thinned, filtered or handed-in line, rows not known to be every row, and a number beside its values do not compile (R7)
- テスト: `src/test/provenanceBoundary.test.ts` › a whole result computed with a function that is not written at the call, or that ignores the values it is handed, is refused by the scan (R7)
- テスト: `src/test/guideExamples.test.ts` › every code block of the plot contracts guide compiles against the code as it is, and each line it says the compiler refuses is refused
- テスト: `src/test/overlaySpectrumPainter.test.ts` › a cursor slice is read from its every bin as the backend sends it (bins, x-whole), never from its drawn values; one without bins has nothing to read (R7)
- テスト: `python-backend/test_analysis_service.py` › test_a_cursor_slice_sends_its_every_bin_as_bins_only_when_its_row_is_not_cut
- テスト: `src/test/fullRead.test.ts` › a picture's full data is fetched by its key, never its drawn points: a band table is read as a line is, and without a key neither has any (R7)

表示（窓・帯・設定）が変わらない間は、マウスを動かしても、取り寄せたものの中にいるかぎりバックエンドには何も頼みません。読み値はその場で読み、空になりません。スペクトログラムのマスは、マウスのまわりの列と上下 16 行をまとめて取り寄せ（`fullRead.ts` の `HOVER_CELLS`、バックエンドは `full_read.read_cells` の `rows`）、取り寄せたマスがマウスの位置に答えるかどうかは、行の中心ではなく、マウスのあるセル（描く絵・読み値と同じ区切りの `cellIndex`）が、上下にも取り寄せた行があるセルかどうかで決めます。帯で拡大したレーンは、軸の両端が範囲の入力欄の数（R9）なので、マウスの周波数がビンの中心からわずかにずれます。行の中心で比べると、そのずれだけで取り寄せた端の行を「外」と見て、同じマスを何度も頼み、そのたびに読み値が空になるからです。帯の絵（帯のビン）は帯を決めたときに 1 回だけ頼み、マウスの動きでは頼み直しません。テストの代わりのバックエンドも、`rows` をバックエンドと同じに受けます（2 行しか返さないと、本物では起きない頼み直しをテストが作るからです）。
- テスト: `src/test/fullRead.test.ts` › a spectrogram's hover asks the backend once for a block around the pointer: moving across frames and bins reads what came (R7)
- テスト: `src/test/fullRead.test.ts` › a pointer moving inside the cells a spectrogram's hover kept asks the host nothing new, a hair off a row's centre and in the outer half of the next-to-last kept row too (R7)
- テスト: `src/test/uiSmoke/spectrogramZoom.spec.ts` › a spectrogram lane boxed to a narrow band asks for that band's own bins and draws and reads them, not the whole range's rows stretched (R3)

## R8 ＋ で選べる操作は結果を描く

＋ に出る操作は、選ぶと必ず結果のグラフが出ます。その録音で動かない、または意味のある結果にならない操作は、灰色にして理由を書きます。置いたあとに動かなくなった手順や、実行して失敗した手順は、オレンジで印を付けて理由を書きます。実行して失敗したときは wandas の理由です（R5）。

- テスト: `src/test/uiSmoke/trackStage.spec.ts` › a step that cannot run on these recordings says why: ＋ greys a 48 kHz-only step out, and a step failing on a file is marked with wandas' reason on the plot
- テスト: `python-backend/test_operation_catalog.py` › test_no_step_offered_on_a_recording_draws_a_flat_picture
- テスト: `python-backend/test_operation_catalog.py` › test_after_a_metric_the_steps_that_fail_on_its_series_are_refused
- テスト: `python-backend/test_operation_catalog.py` › test_the_step_bars_metric_rates_are_the_ones_wandas_gives
- テスト: `src/test/recipeSteps.test.ts` › after a metric, a filter or an FFT is judged at the metric's series rate and length, not the recording's

## R9 自動の範囲は切りのよい値

カラースケールや dB 軸を自動で決めるときは、端を切りのよい値に広げます。dB でない量（ラフネス、ケプストラム、係数など）の色と値の範囲も、入口の分布図の値軸も同じです。手で入れた値はそのままです。

自動の範囲の端は、描くために間引いた点や平均したマスではなく、全データ（間引く前のすべての点・すべてのマス）の最小と最大から決めます。dB の熱図（トラックのスペクトログラム、比較の熱図、入口の一覧の帯）の自動の色の範囲は、丸めたあとの幅が 100 dB を超えません。上は全データの最大を切りのよい刻みへ上に丸めた値、下は全データの最小を同じ刻みへ下に丸めた値ですが、丸めた上の端から 100 dB より下にはしません（`ticks.heatmapDbRange`）。−240〜−0.4 dB は −100〜0 dB で、−105〜0 dB ではありません。デジタル無音（−240 dB や −300 dB）があっても、下の端はそこまで下がりません。上を先に丸めてから 100 dB で止めるのは、丸める前に 100 dB で止めると、丸めで両端が広がって 100 dB を超える（−100.4〜−0.4 が −105〜0）からです。dB の線の軸も同じく、上を全データの最大、下を max(全データの最小, 上 − 100 dB) として、両端をそれぞれ外へ切りのよい刻みに丸めます（刻みの上にある端はそのまま）。刻みは 5・10・20・25 dB のうち 6 目盛り以下になる一番細かいもので、両端の余りは 1 刻みまでです。ただし幅は 100 dB を超えません。丸めた上の端から下へちょうど 100 dB で止めます（−149.5〜−9.5 dB は −100〜0 dB、−100〜0 dB はそのまま）。100 dB の中の全データの値が軸の外に出ることはなく、余白で図の半分を使うこともありません（−49.5〜−9.5 dB は −50〜0 dB）。
- テスト: `src/test/stagePanes.test.ts` › a dB line's automatic range encloses every value of its full data down to 100 dB under its loudest, rounded out to round steps with at most a step of slack on each side (R9)
- 右の第 2 のレベル軸（カーソルスペクトル）は、自分の範囲の切りのよい目盛りを、その値の位置に書きます。左の軸の目盛りの位置に右の範囲の値を丸めて書くと、数がその位置の値と違うからです。
- テスト: `src/test/stagePanes.test.ts` › the right-hand level axis writes its own round ticks, each at the place of its own value, never the left axis's places relabelled (R4, R9)
- 目盛りの数はどれも、その数を絵が描く位置に書きます。熱図の行の軸、番号で数える行の軸（入口の概観帯）でも、どの拡大でも同じです（R14「目盛りは、その数を絵が描く位置に置きます」）。

- テスト: `src/test/stagePanes.test.ts` › every range is set from the full data's lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)
- テスト: `src/test/stagePanes.test.ts` › a heatmap's colours reach no more than 100 dB under its loudest value: digital silence (−240 dB) does not set the bottom (R9)
- テスト: `src/test/spectrogramDisplayBounds.test.ts` › a heatmap's auto colour range spans at most 100 dB after rounding: the top rounded up to a tick, the bottom on a tick no more than 100 dB under it (R9)
- テスト: `src/test/entrySidePlots.test.ts` › the strip's colours reach no more than 100 dB under its loudest level: a digitally silent recording (−300 dB) does not set the bottom (R9)
- テスト: `src/test/comparePanes.test.ts` › a spectrum drawn from its bins carries every bin's lowest and highest value in its span as its range, the silent floor left out (R1)
- テスト: `python-backend/test_stage_view.py` › test_every_pictures_value_range_is_its_full_datas_not_the_points_or_cells_drawn
- テスト: `python-backend/test_stage_view.py` › test_a_cepstrograms_colour_edge_is_its_full_coefficients_99th_percentile
- テスト: `python-backend/test_stage_combine.py` › test_a_median_and_a_difference_carry_their_full_datas_value_range

- テスト: `src/test/uiSmoke/colourRangeRounding.spec.ts` › the auto colour scale opens with round dB ends, and typed ends are kept as typed
- テスト: `src/test/stagePanes.test.ts` › a colour or value range not in dB is widened to round ends, as a dB range is
- テスト: `src/test/distribution.test.ts` › the distribution's value axis opens at round ends, as every automatic range does (R9)

カラーバーの両端の数は、そのカラースケールそのものです。書いた数を読み戻した値（本物のマイナス「−」をハイフンに戻して読む）が、色を塗った端と同じ数です。画面でも、書き出す図でも同じです。

- 自動の範囲は、範囲を作る 1 か所（`figureModel.colourScale`）で、カラーバーが書く桁まで外へ広げます。桁は幅で決めます（幅 8 以上は整数、それより狭ければ幅の 1/8 を見分けられる桁、最低 1 桁。`plotText.colourDecimals`）。下の端は `floorTo`、上の端は `ceilTo` で広げます。どちらも 10 進の文字で計算するので、すでにその桁で書ける数は動きません（小数 1 桁の −23.5 は −23.5 のまま）。符号つきの絵（差、ケプストラム）は 0 を中心にして、絶対値の最大を同じく外へ広げます。
- マスの色、カラーバーの帯、両端の数、レーンの範囲の入力欄は、このスケールだけから描いて書きます（`StagePlot.colourScale`）。1000000.5〜1000020.5 の自動の範囲は 1000000〜1000021 で塗り、そう書きます。1000000.5 から塗って「1000001」と書くことはしません。書く関数（`stagePanes.colourEndText`）は書くだけで、数を丸めません。
- 手で入れた端（⚙ の設定、範囲の入力欄）は、入れたとおりの数で塗ります。書くときは、その数に読み戻せる一番短い書き方にします（「1000000.5」）。どちらの端を手で入れたかは範囲が持ちます（`FigureRange.typed`、`figureModel.typedColourRange`）。
- 範囲の入力欄はどれも、軸を描いた端をそのまま書きます。書く関数は 1 つ（`plotText.exactFieldText`：読み戻すとその数になる一番短い書き方）です。入力欄は数を入れる所なので、長いことを理由に丸めません。波形の振幅、スペクトログラムの周波数（箱で拡大したときも）と色、レーンの時間、カーソルスペクトルの周波数・dB・右の第 2 のレベル軸、ペアの図、比較台、入口の図と分布図の、横の軸も縦の軸も同じです（`StagePlot.valueRange`・`xRange`・`rowRange`、`rangePopover.openAxisPart` の `shown`、`SpectrumView.dbRangeFields`・`frequencyRangeFieldsHz`、`figureModel.laneAmplitudeRange`）。
- 書く数が長くなるのは、範囲そのものが計算のかけら（拡大の窓の割合×幅、振幅の割合×ピーク、右の軸が左の軸に合わせて作る範囲、自動の範囲）のときです。そのときは文字ではなく範囲を、作る場所で入力欄の桁にします（`figureModel.fieldWindow`・`windowEnds`・`laneAmplitudeRange`）。自動の振幅の範囲は、入力欄が書く桁まで外へ広げます（ピーク 0.73 なら ±0.830。0.8295454… から描いて「0.8295」と書くことはしません）。拡大した窓の端は、入力欄が書く桁（窓の幅の 1/1000、最低 0.001。`plotText.fieldDecimals`）に丸めてから描きます。グラフの横軸と熱図の行（`stagePanes.windowed`、レーンの時間の目盛りも `stagePanes.linearWindowEnds`）、カーソルスペクトルとペアの図の周波数（`spectrumRuntime.frequencyWindowHz`）、ボタンでの dB の拡大（`spectrumRuntime.spectrumDbRangeAfterZoom`）、スペクトログラムの箱の拡大（`windowEnds`）がそうです。そのため、拡大した窓に手で入れた数も、その桁までで描いて書きます。窓の幅の 1/1000 より細かい桁は丸めます。それでも、書いた数と描いた数は同じです。
- 右の第 2 のレベル軸（カーソルスペクトル）は、左の軸の拡大と同じ部分を自分の全体の範囲から取り、入力欄の桁で作ります（`spectrumRuntime.secondaryDbWindow`）。右の軸に入れた範囲は、右の軸がちょうど入れた数で描かれる左の軸の範囲にします（`spectrumRuntime.rightAxisLeftRange`：入力欄の桁から 1 桁ずつ増やして、一番短い数）。
- 入力欄をそのまま適用すると、範囲は変わりません。端ごとに、入れた数が欄に書いた数と同じなら（`value === shown`、文字でなく数で比べる）、その端の設定（自動、拡大の窓、ナイキストに合わせた上の端）をそのまま残します。
- 範囲の入力欄に数を書くコードは、`exactFieldText` 以外で書かず、そこへ届く数を `figureModel` の外で丸めません（`toFixed`・`toPrecision`・`toExponential`・`Math.round` など）。`src/test/rangeFieldBoundary.test.ts` が型と記号で確かめます。描いた端は `paintOverlay` が `data-plot-ends` に記録し、テストは欄の数をそれと比べます。
- UI テストではすべての回で、画面に出ている熱図を確かめます。カラーバーの両端の数が、色を塗ったスケール（`data-plot-colour-scale`）と違うと、そのテストは失敗します（`src/test/uiSmoke/canvasAudit.ts`）。
- テスト: `src/test/colourScale.test.ts` › a colour bar's end numbers are its colour scale: each, read back, is the end the colours are painted from, auto or typed, on the screen and in a report (R9)
- テスト: `src/test/colourScale.test.ts` › every place that makes a colour range gives a scale whose ends are written exactly: the comparison's images, their differences, the entry strip and the spectrogram lanes (R9)
- テスト: `src/test/colourScale.test.ts` › floorTo and ceilTo leave a number already written with that many decimals as it is, and otherwise step out to the next one (R9)
- テスト: `src/test/colourScale.test.ts` › a value axis's range fields are the ends it is painted with, zoomed or typed: each, read back, is the end drawn (R9)
- テスト: `src/test/spectrumView.test.ts` › SpectrumView popover fields prefer overrides and fall back to the painted range, exactly as painted (R9)
- テスト: `src/test/stagePanes.test.ts` › a colour bar's ends are written as the range they end, never rounded off a typed range: −23.5 reads −23.5, and no −0 (A31, C5)
- テスト: `src/test/uiSmoke/colourRangeRounding.spec.ts` › a typed colour range is painted, written on the colour bar and offered again exactly as typed: 999990 to 1000000.5 reads 1000000.5, never 1000001 (R9)
- テスト: `src/test/rangeFieldBoundary.test.ts` › every range box writes the ends it is painted with by exactFieldText, and nothing on their way there rounds them outside figureModel (R9)
- テスト: `src/test/rangeFieldBoundary.test.ts` › the range field scan finds a rounded end: in the field, in a helper, through a local, a destructured const, a spread, another plotText writer, and in openAxisPart's shown ends (R9)
- テスト: `src/test/rangeFieldEnds.test.ts` › every lane range box writes the ends its axis is painted with, and applied unchanged paints the same range: amplitude, spectrogram band (box-zoomed too) and the lanes' time (R9)
- テスト: `src/test/rangeFieldEnds.test.ts` › the cursor spectrum's range boxes write the ends it is painted with, and applied unchanged paint the same: frequency, level and the right-hand level axis (R9)
- テスト: `src/test/rangeFieldEnds.test.ts` › a range made for a range box is at the numbers it writes: an amplitude typed through any peak, a zoom window, the right-hand level axis typed (R9)
- テスト: `src/test/rangeFieldEnds.test.ts` › a plot's range boxes write the ends its axes are painted with, across and up, zoomed or not: a time axis, a log frequency axis, a heatmap's rows; applied unchanged, the same (R9)

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

どのグラフも、共通の描画部品（`paintOverlay`、stagePanes.ts）で描きます。軸、層、マウス、拡大、読み値の行、空のときの表示は部品が持ち、各グラフはデータと層の種類と軸の名前を渡すだけです。部品で描いたキャンバスには印（`data-plot`）が付きます。UI テスト全件で、画面に出ている印のないキャンバスがあればそのテストを失敗にします。まだ部品に移っていないグラフは `src/test/uiSmoke/plotRegistry.ts` に理由と一緒に並べ、移したら外します。印のあるグラフには、どれにも同じ操作を加えて確かめます。マウスを乗せると読み値がすぐ上の行に出てグラフは動かない、← / → で読み値が 1 点ずつ動く（グラフが読む全解像度のデータ（`plotHoverLayer.ts` の `notePlotRead` がグラフに残す読んだ点の層）の次の点にちょうど進み、2 点飛ばない）、Ctrl+ホイールで拡大してダブルクリックで戻る、マウスを乗せて + / − でそのグラフの横軸が真ん中を中心に拡大・縮小し 0 で全体に戻る、値の軸の上の Ctrl+ホイールで横軸が真ん中を中心に拡大する（軸の上にはグラフの点がないので、どのグラフも、トラックのレーンと色の帯も同じ）、ドラッグの矩形ズーム（下の軸の種類のとおり）、縦軸と横軸のダブルクリックでその軸の範囲の入力が開く、両軸に名前がある、の 8 つです。グラフの上にないときの + / − / 0 は、その画面の共有の窓（レーンの時間、比較の窓）に効きます。拡大と戻すは、属性だけでなく、描かれた絵が描き直されて変わったことで確かめます。場面ごとに、画面に出ている印のあるグラフを全部数え上げ、名前を挙げた検査のほかのものにも同じ検査をします（同じ種類のレーンは 1 本で代表します）。検査しないグラフは理由と一緒に `UNCHECKED` に置き、一覧は減る一方です。部品の外の描画は、別のキャンバスから `drawImage` で写したものも失敗にします。ドラッグはどのグラフでも矩形ズームで、囲んだ範囲に横軸と縦軸を合わせます（トラックのレーンも同じ）。入口の分布図の縦軸は群ごとの件数の軸で、どの範囲の値を見ていても 0 からその群の一番多いビンの上まで、いつもすべての件数を表示する軸と決めています。件数が軸の外に出ないためです。分布図の矩形ズームは値の軸（横軸）に効き、件数の軸はいつも全体のままです。これは拡大を省いたのではなく軸の性質で、共通の部品が軸の種類として持ちます（`plotInteraction.ts` の `VerticalAxis`、分布図は `'all-counts'`、ほかのグラフは `'zoom'`）。部品はグラフにその種類を書き（`data-plot-y-axis`）、矩形ズームの検査は、`'zoom'` のグラフでは両方の軸が囲んだ範囲に合ったこと、`'all-counts'` のグラフでは横軸が合って縦軸が全体のままで、その縦軸の名前が件数であることを確かめます。レーンのループは Alt+ドラッグ、時間ずらしは Shift+ドラッグで、矩形ズームのモード切り替えはありません。入口の分布図は群ごとの行を部品で描き、値の軸を下の帯に共有します。値の範囲選びは Alt+ドラッグで、矩形ズームと同じ共通の部品（`plotInteraction.ts`）が修飾キーで振り分けます。グラフのマウスとキーの扱いは、共通の部品のほかには書きません。トラック表示（時間軸）のレーンも、ドラッグ（矩形ズーム、Alt+ドラッグのループ、Shift+ドラッグの時間ずらし）、ホイール、軸のダブルクリックを共通の部品で受け、全レーンで 1 つの時間の窓を共有します。グラフが新しい操作を要るときは、部品にどのグラフでも使えるオプションとして足します。グラフのクリック（入口の概観の行選び、分布図のビン選び、トリガーのイベント線の除外）も、動かずに離した押下として部品の `tap` で受けます。部品の外でマウス、ポインタ、ホイール、クリック、ダブルクリック、キーを受けるモジュールは、グラフでないもの（境目のドラッグ、ポップオーバー、ボタンなど）に限り、受けるイベントごとに理由と一緒に `src/test/plotGestures.test.ts` の一覧に置きます。部品の下の低レベルのリスナー（`trackPointerEvents.ts`）を付けるのは `plotInteraction.ts` だけです。ペアの図のように 1 本の周波数軸に縦に積んだ図（`data-plot-stack`）は、積んだ図の上の 1 行を読み値の行として共有します。トラック表示のレーンも 1 本の時間軸に積んだ図で、上のツールバーの行を共有します。レーンの値の軸はレーンの横の別のキャンバスにあり、レーンはそのキャンバスを `data-plot-axis` で指します（軸のダブルクリックはそこで確かめます）。レーンの下の時間の目盛り（`#ruler-canvas`）も部品の `paintTimeAxis` で描き、部品はレーンを描くときにそれを `data-plot-x-axis` と `data-plot-named-by` に書き（`paintOverlay` の `xAxisCanvas`）、ダブルクリックで時間の範囲の入力が開きます。まだ満たさないものは理由と一緒にテストの一覧に置きます。満たすようになったら一覧から外さないとテストが失敗するので、一覧は減る一方です。

- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a plot on screen that the plot component did not draw, unless plotRegistry.ts lists it (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a picture copied into a plot from another canvas by anything but the plot component (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the cursor spectrum answers the same gestures as every plot (R13)
- 右に 2 本目のレベル軸を描く図では、その軸も左の軸と同じく Ctrl+ホイールとダブルクリックに答えます。契約テストは図のすべての値の軸を押します。
- **クリックはすぐに動きます。ダブルクリックは拡大を戻すだけです。** 動かずに離した押下はクリックで、離したときにすぐ動きます（その押下のときの絵で決めます）。ダブルクリックかどうかはブラウザが OS の設定の間隔で決め（2 回目の押下の `detail` が 2、そのあと `dblclick`）、部品は自分で時間を測りません（待つタイマーはありません）。ダブルクリックの 2 回目の押下はクリックではなく、1 回目のクリックがしたことを取り消します（あいだにほかの押下がなかったとき）。そのうえでダブルクリックが拡大を戻します（軸の上では範囲の入力を開きます）。1 回目のクリックで画面が動いて（ビンを選ぶと表が絞られる）2 回目の押下がグラフの外に落ちても、それはそのグラフのダブルクリックです（`trackPointerEvents.ts` が文書で 2 回目の押下を聞き、`plotInteraction.ts` の `secondPress` が取り消して、そのグラフの拡大を戻します）。だから、ダブルクリックは、どれほどゆっくりでも OS の間隔の中なら、選んだもの（概観の行、分布図のビンと点の行、レーンの時刻カーソルとループ、外したイベントの線）を押す前のままにし、拡大を戻すだけです。OS の間隔より遅い 2 回目の押下は、2 回目のクリックです。クリックをする側（`plotInteraction.ts` の `tap`）は、したことを取り消す関数を返します（表の選択と並びとスクロール：`entryRuntime.ts` の `tableNow`、時刻カーソルとループ：`endLaneDrag`、イベントの線：`stepBar.ts` の `edit` が返す取り消し。↶ の履歴にも残しません）。データを待っているクリックは、2 回目の押下が来ればまだ何もしていないので、何もせずに終わります。新しいクリックの操作を足すときも、取り消しを一緒に返します。ブラウザでは、`src/test/uiSmoke/readoutTransitions.spec.ts` の表の行（レーン、分布図の点、トリガーのイベントの線のダブルクリック）が、本物のダブルクリックで選択が残らないことを確かめます。理由：前は、クリックがダブルクリックを待って決まった 300 ms あとに動きました。それより遅いダブルクリック（OS にとってはダブルクリック）では先にクリックが動き、ダブルクリックでは残らない選択が残りました。どのクリックも遅れて感じました。
- **クリックは、読み値が読んでいる点に効きます。** クリックで何かを選ぶ・外す・戻す・移るグラフ（分布図の点・ラグ・スロットの目盛りの行と棒のビン、概観帯の行、トリガーのイベントの線、波形とスペクトログラムのレーンの時刻カーソル）は、どれも、押したときにその場所で読み値が読んでいる点（同じ読み方、同じ点、同じもの：録音のキー、行、イベント、サンプルの時刻）に効きます。クリックが自分で当たり判定をすることはありません（自分の半径も、自分の許しもありません）。読み値が何も読まない所（「値なし」、点がない、読み値のない図）では、クリックは何もしません。ただし、波形とスペクトログラムのレーンのクリックは、点への操作ではなく時刻へのシークです。何も読まないときは何も言っていないので、マウスの時刻へシークしても、クリックが読み値と食い違うことはありません。だからレーンでは、読み値が何も読まないとき（読み値のないレーン：解析のあとでファイルが変わった、「値なし」、点がない、読み値がレーンにない、読みが失敗した）はマウスの時刻（押したときの画素の時刻）へ、読み値が点を読んでいるときはその点の時刻へシークし、読みが取り寄せ中のときは、ほかのグラフと同じく読みが届いてから決めます（`plotHoverLayer.ts` の `clickOnRead` の `unread`、`trackLaneHover.ts` の `laneClickNorm`）。ほかのグラフのクリックは、何も読まない所では何もしません。読み値が点のない場所を言葉で言う図（分布図の「値の軸のどこか」）では、その言葉の値（同じ関数 `valueAt`）のビンを選びます。押してから離すまでのあいだ（ドラッグの閾値の中で動いても）、読み値は押した所のままです（`plotInteraction.ts` の `press` が押した所で読み、`hover` は押しているあいだ読みません）。だから、クリックが効くのは押したときの読み値です。部品が 1 つの口を持ちます（`plotHoverLayer.ts` の `clicked` と `clickOnRead`。全データがまだ届いていない読みは、押したときの図と場所で読み値と同じ読み方で読み、届いてから決めます）。各グラフの `tap` は `clickOnRead` を通して、渡された読みに効くだけです。契約表では、クリックのあるグラフに `click` の行があり（`src/test/plotContracts/charts`）、`src/test/plotContracts.test.ts` が、`attachPlotInteraction` に渡す `tap` が `clickOnRead` を通ること、その `tap` が `click` の行にあることを確かめます。ブラウザでは、`plotContract.spec.ts` がその行ごとに、読み値が読む点、近い 2 点のまんなか（同じ距離・重なった点）、読むものが変わる境（ビンや行の境）、点のない所でクリックし、読み値が読んだものとクリックが効いたものが同じことを確かめます。理由：前は、分布図のクリックは 5 px 以内の最初の点（`dotAt`）を、概観帯は行の高さから行を、イベントの線は線から 6 px の許しを、レーンは画素の時刻を、それぞれ自分で求めていました。同じ高さの点が 4 px 離れていると、B の上で読み値は B を読むのにクリックは A に効き、見ている録音と選ぶ録音が違いました（P1）。一度はレーンも何も読まないときに何もしないことにしましたが、読み値のないレーン（ファイルが変わった）のクリックでカーソルが動かなくなり、シークができなくなりました。シークは時刻への操作なので、何も読まないときはマウスの時刻へ動かします（ブラウザでは `readoutTransitions.spec.ts` の「a click on a lane that reads nothing」の行、ノードでは `trackLaneHover.test.ts`）。新しくクリックの操作を足すときは、`clickOnRead` を通し、契約表に `click` の行を足し、`plotContract.spec.ts` の `CLICK_CASES` に場合を足します。
- テスト: `src/test/plotContracts.test.ts` › every plot's click is a click row of the table and acts on the point its readout reads, through clickOnRead, never a hit test of its own (R7, R13)
- テスト: `src/test/plotContracts.test.ts` › the click scan finds a plot's own hit test: a tap that does not act through clickOnRead
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot with a click acts on the point its readout reads at the press: the same pick and identity at ties, overlapping points, bin edges and gaps, never a hit test of its own (R7, R13)
- テスト: `src/test/plotInteraction.test.ts` › a press is read where it is pressed and holds that read until it is let go: a move within the drag threshold reads nothing new, so a click acts on what the readout read at the press (R7, R13)
- テスト: `src/test/entryDistributionPane.test.ts` › a click on a row acts on what its readout reads at the press, never on a hit test of its own: on a dot beside another of its height, that dot's row; half way between, the first; off any point, the bin of the value the readout says; a double click's second press puts the table back (R7, R13)
- テスト: `src/test/entrySidePlots.test.ts` › a click on the strip acts on the row whose cell its readout reads at the press, at once: on each row's cell and at the edge between two, that row; on a cell with no level (the readout's "no value"), none; a double click's second press goes back, a drag picks none; the gestures add a zoom box and a range popover (R7, R13)
- テスト: `src/test/trackStageGestures.test.ts` › a click on the events plot acts on the event line its readout reads at the press, never on a tolerance of its own: the nearest within the pick radius, the one nearest in height out of it, a tie the first, none past the lines' ends (R7, R13)
- テスト: `src/test/trackStageGestures.test.ts` › a click on the events plot leaves out the line its readout reads in the full data, not the line the drawn points would put nearest (R7, R13)
- テスト: `src/test/trackLaneHover.test.ts` › a click on a track lane moves the cursor to the sample its readout reads, not to a point of the envelope drawn nor the pixel's own time (R7, R13)
- テスト: `src/test/trackLaneHover.test.ts` › a click on a spectrogram lane moves the cursor to the frame of the cell its readout reads, not the column averaged to draw it (R7, R13)
- テスト: `src/test/pickCases.test.ts` › every pick case of the table is read by the webview as the table says: nearest, under, a click, ← and → (R7)
- **ドラッグの間、窓はドラッグのものです。** 矩形ズーム、Alt+ドラッグ、Shift+ドラッグの間は（どの面のドラッグでも）、ホイール（Ctrl+ホイール、Shift+ホイール、横のスワイプ）も + / − / 0 も ← / → も、どのグラフの窓も読み値も変えません。描いている矩形を、描きはじめた窓の上に置くためです。離せば、どれもまた効きます。決まりを置く場所は 1 か所です（`plotInteraction.ts` の `dragUnderWay`。ホイールはすべて `wheelAt` を通ります）。新しいホイールやキーの操作を足すときも、ここを通します。
- テスト: `src/test/plotInteraction.test.ts` › a double click resets the zoom only, however slow: the selection is as before it; a second click beyond the browser's double-click interval is a second click (R13)
- テスト: `src/test/plotInteraction.test.ts` › one arbitration of a click for every plot: a click acts at once, the second press of a double click takes it back, and the next press anywhere (a drag, another plot's click) takes the place of a click still waiting for its data (R13)
- テスト: `src/test/plotGestures.test.ts` › every plot that acts on a press that stayed put (plotInteraction's tap) acts at once, and a double click's second press takes it back, with no timer of its own or of the shared gestures: one arbitration for all (R13)
- テスト: `src/test/trackStageGestures.test.ts` › a click on a trigger's event line (the plot gestures' tap: a press that stays put) leaves it out at once (plotInteraction arbitrates); a double click's second press puts it back, a drag leaves none out (R13)
- テスト: `src/test/stepHistory.test.ts` › an edit retracted is as if never made: ↶ does not go back to it and ↷ keeps what it had before it (R13: a double click takes back its first press)
- テスト: `src/test/plotInteraction.test.ts` › a drag under way owns the view: a wheel during it (Ctrl+wheel, Shift+wheel, a sideways swipe, on its plot or another surface's) changes no window; let go, the wheel works again (R13)
- テスト: `src/test/plotInteraction.test.ts` › during a drag on one surface the keys over another plot step and zoom nothing; let go there, it reads where it was let go without a move (R7)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the cursor spectrum with two level references answers the axis gestures on its right-hand axis as on its left (A48, R13)
- テスト: `src/test/spectrumOverlayInteraction.test.ts` › with a right-hand level axis drawn, its margin is a level axis too: it answers the axis gestures as the left one (A48, R13)
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
- テスト: `src/test/plotInteraction.test.ts` › + / − zoom the horizontal axis of the plot under the pointer around its middle and 0 shows it whole; the window it set is named on the plot (R13)
- テスト: `src/test/plotInteraction.test.ts` › Ctrl+wheel over an axis zooms the horizontal axis around its middle; over the plot, around the pointer (R13)
- **UI テストが画面を読むのは、ページが答え終わってから（`settled()`）です。** 固定の時間は待ちません。`settled()`（`src/test/uiSmoke/canvasAudit.ts`）は 1 つの仕組み（`installSettleTracker`）で、ページがまだ答えていないものを全部数えます。頼んだアニメーションのフレーム、1 秒以下のタイマー、fetch とファイルの読み出し、ホストに頼んで答えの来ていない要求、そしてページが自分に送ってまだ届いていないメッセージ（`window.postMessage`）です。これが 2 フレーム続けて 0 のときに、待ち終わります。メッセージを数えるのは、ui-smoke の代わりのホストが答えをタイマーから `postMessage` で送るからです（`buildHtml.ts`：読み値の読み出し、`compare-combine`、スペクトルの切り口）。`postMessage` は送ったタスクのあとの別のタスクで届き、そのあいだにフレームが進みます。タイマーは動いた時点で数えなくなるので、メッセージを数えないと、答えがまだ届いていないのにページが静かに見え、テストは答えの前の画面（全データ待ちの空の読み値、R7）を読んで、正しい動きを失敗にしていました。負荷の高いマシンほど起き、線の多いグラフ（トリガーのイベントを重ねた図：線ごとに読み出しを頼む）ほど起きました。ページが待つものを新しく足すとき（Worker、MessageChannel など）は、テストごとに待つのではなく、この仕組みに数えさせます。
- テスト: `src/test/uiSmoke/hostAnswer.spec.ts` › settled() waits for a message the page posts to itself until the page has read it: a stand-in host's answer from a timer
- テスト: `src/test/uiSmoke/hostAnswer.spec.ts` › settled() counts a host request as answered only once the page has read the answer, not when it is sent
- テスト: `src/test/uiSmokeWaits.test.ts` › ui-smoke tests wait for the page, not for a fixed time, but where the time is what they test

## R14 線は自分の軸の変換で描き、読み、印を付ける

値の軸が 2 本ある図（左と右で基準が違う重ね図）では、線は図の層（`figureModel.ts` の `FigureModel` の axes、`levelAxes`）が割り当てた軸に載ります。その線を描くこと、マウスが点を選ぶこと、読んだ点の印を付けること、値の軸の箱の拡大は、どれもその線の軸の変換で行います。図全体の変換や 1 本目（左）の軸の変換は使いません。左が ±1 FS、右が ±100 Pa のとき、右の 50 Pa は右の軸の上半分のまん中に描かれ、そこにマウスを置くとその 50 Pa を読み、印もそこに付きます。左の変換で描くと、線は画面の外に出て、マウスは描かれていない線を読みます。

- 軸の値と画素の変換を作るのは 1 か所（`stagePanes.ts` の `axisTransform`）だけです。軸の範囲から、値の正確な y（`yOf`、どこにも留めない）、値の単位あたりの正確な画素（`pixelsPerUnit`、箱の高さ ÷ 範囲の幅）、点の印の y（`yAt`、画面の中に留める）、y の値（`levelOf`）、見えている値（`valueRange`）、そのまま描く信号の波形（`paintSignal`）を作ります。左の軸も右の軸もこれで作り、右の軸の線を読む `StagePlot`（`plot.secondary`）の `signal`、`yOf`、`pixelsPerUnit` も右の軸のものです。左のものを右に写しません。
- 決めるための縮尺は正確に。線を描く y も正確な `yOf` で、図の外に出る線は留めずに切ります（R2「線は切り取り、留めない」）。留める y は点の印の `yAt`（画面の中に留める）だけです。留めた y は値の本当の位置ではないので、2 つの差は縮尺になりません。以前の線を描く y（`paintY`、軸の外 10 幅で留める）では、±0.001 を 100 px に描く軸で `paintY(1) − paintY(0)` は 1,050 px でしたが、軸の縮尺は 1 単位 50,000 px です。この差を縮尺としてバックエンドに送ると、密な窓（`full_read._nearest_on_screen`）は高さをほとんど無視して横に近い点を選び、画面の上で本当に一番近い点を返さず、読み値は別の（本当の）点を読みます。そのため、マウスが点を選ぶこと（`fullLineNear`）、`full_read.py` に送る縮尺（`pixels`）、点が図の中にあるかの判定、読んだ点の印の位置は、どれも `yOf` と `pixelsPerUnit` を使います。どのコードも 2 つの y の差から縮尺を作りません（描く関数（名前が `paint`・`stroke` で始まる関数）が描くものの大きさを y の差で決めるのは別です）。値の軸の箱の拡大は軸の割合で決めるので（次の項）、y の差を使いません。手で作るテストの `StagePlot` も `yOf` と `pixelsPerUnit` を必ず持ちます（型で必須、`src/test/helpers/figure.ts` の `Y`）。
- この決まりは型と記号で確かめます（名前の綴りではなく、`StagePlot` と `AxisTransform` のメンバーとして）。この 2 つの型に、知られていない値から画素への写像（型が `(value: number) => number` のメンバーで、`yAt`・`yOf`・`levelOf`・`xAt`・`xOf` のどれでもないもの。線を描くために留める y を足すと、これに当たります）があるか、描く関数の外で y の写像（`yAt`・`yOf`・`levelOf`、またはそれから作ったローカルの const）の呼び出し 2 つを引き算すると、テストが失敗します。新しい写像が留める y でないなら、`src/test/pickScaleBoundary.test.ts` の `MAPPINGS`（y）か `X_MAPPINGS`（横軸）に足し、その決まりをここに書きます。横軸の縮尺（`fullLineNear` が送る `pixels` の 1 つ目）は `xAt` の差から作りますが、`xAt` はどこにも留めない写像なので、その差は正確な縮尺です。
- 値の軸の箱の拡大は、軸の割合（0〜1）で窓を決め、左右の軸を同じ割合だけ狭めます（`narrowedRange`）。画素から値に直すときも、その軸の範囲を使います。
- 変換を足すとき、また変えるときは `axisTransform` を変え、軸ごとに別の写し方を足しません。UI テストの表（`src/test/uiSmoke/readoutTransitions.spec.ts`）の「steps overlay with two level axes (a signal on its right-hand axis)」の行（マウス、→、クリック）が、右の軸の信号を、描かれた画素の上で読むことを確かめます。
- **目盛りは、その数を絵が描く位置に置きます。** 値の軸と熱図の行の軸の目盛りは、絵を描くのと同じ変換（線の値の軸は `axisTransform`、右の第 2 のレベル軸はその軸の `axisTransform`、熱図の行は行のマスを置く行の軸）で位置を決めます（`stagePanes.placedTicks`）。値 v と書いた目盛りは、どの拡大でも、その軸が v を描く位置にあります。目盛りの位置を別の式で求めたり、位置を決めてから文字だけを別の数に書き換えたり（丸める、絶対値を取る、同じ文字の目盛りを間引いて残りに書く）しません。文字は、その位置の値をその軸の書き方で書いたものだけです。
- 番号で数える行の軸（入口の概観帯の表の行）は、目盛りを行として選びます。行 n の中心（`rowNumberTicks`、`entryPlots.OVERVIEW_ROWS`：表の上から 1 で始まる番号）に n と書き、刻みは行の整数倍（1、2、5、10、20、25… 行）です。行の間の切りのよい位置に行の番号を書きません。以前の概観帯は、行の軸の切りのよい位置（120 px に −11〜−10 を出すと −10.8、−10.6、−10.4…）にその値の丸めた絶対値を書き、同じ文字の 2 つ目以降を消していたので、「10」が −10.4 にあり、番号が別の行を指していました。行の中心を置く式は 1 か所（`entryPlots.rowCentre`）で、絵の行、読み値のマス、クリックの行、目盛りが同じものを使います。表の見えている行の枠と注目の行の印も、描いた行の軸（`StagePlot.image.placeOf`）の位置に置き、窓から別の式で求めません。
- UI テストではすべての回で、画面に出ているグラフの縦の軸（左、右の第 2 の軸、レーンの横の軸のキャンバス）の数を読み（本物のマイナス、「k」は 1000）、その軸がその数を描く位置（`paintOverlay` が描いた変換からキャンバスに残す `__plotTickPlaces`）と比べます。半画素より離れていると、そのテストは失敗します（`src/test/uiSmoke/canvasAudit.ts` の `tickPlaces`）。グラフの契約（`src/test/uiSmoke/plotContract.spec.ts` の 'tick places'）は、それを全体・矩形ズーム・縦の軸に入れた狭い範囲（見えている幅の 1.7 %。100 行の表では行を半分で切る窓）の 3 つの縦の拡大で確かめ、縦の軸に数を書かないグラフは理由とともに `NO_VERTICAL_TICKS` に書きます。画面に出ないレポートの図は `src/test/helpers/tickPlaces.ts` で同じことを確かめます。契約表の目盛りの行があるグラフはどれも、その行にこれらのテスト（`plotContracts/model.ts` の `TICK_PLACES`）のどれかを書きます（`src/test/plotContracts.test.ts`）。目盛りを足す・変えるときは `placedTicks` を通し、行の番号は `rowNumberTicks` で選びます。
- テスト: `src/test/entrySidePlots.test.ts` › the strip's row ticks are at the rows they number, at every zoom: a tick labelled n is where table row n's cells are painted, a window cutting a row in half too (R9, R14)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the entry's overview strip answers the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)
- テスト: `src/test/benchReport.test.ts` › a report figure writes each tick of its level axes, the right-hand one too, and of its Δ axis where that axis paints its number (R9, R14)
- テスト: `src/test/plotContracts.test.ts` › every chart with a level, value or row axis names in its ticks row a test that holds each tick label at the place its axis paints that number, at several vertical zooms (R9, R14)
- テスト: `src/test/plotText.test.ts` › every tick and readout takes its digits from the spacing of its neighbours: no two read the same, none reads a value it is not at (C3)
- テスト: `src/test/axisTransform.test.ts` › a waveform and a level line on the right-hand axis are painted, picked and marked with that axis's transform, never the left one's (R14)
- テスト: `src/test/pickScale.test.ts` › on a value axis of ±0.001 over 100 px the scale a plot sends for a dense window is the axis's exact 50,000 px per unit, never 1,050 from the held painting y: on the left axis, the right-hand one and a log frequency axis (R14)
- テスト: `src/test/pickScale.test.ts` › a dense line whose nearest point differs between the held scale and the exact one: the backend keeps the exact-scale point and the readout picks it, on the left axis, the right-hand one and a log frequency axis (R7, R14)
- テスト: `src/test/pickScaleBoundary.test.ts` › the value axis maps a value to a y only exactly (yOf) or to a point's mark (yAt), with no y held for painting a line, and outside the painting functions nothing differences two mapped y's to get a scale (R2, R14)
- テスト: `src/test/pickScaleBoundary.test.ts` › the pick scale scan finds a held painting y added to StagePlot or AxisTransform and a scale made by differencing mapped y's (direct, through a local, through a ?? alias) (R2, R14)
- テスト: `src/test/uiSmoke/readoutTransitions.spec.ts` › the browser table holds a row for each chart the readout runs on, by its full name, and each real path R7 names
- テスト: `src/test/trackStagePainter.test.ts` › overlaid, a trigger's events are split by level identity as any line, and a vertical zoom narrows the right-hand axis as the left (A43, A45, R13)

## R15 解析条件が同じかは、解析したサンプルの範囲で決める

2 つのスキャンが同じ解析条件か（`conditionId` が等しいか）は、ファイルの版、チャンネル、校正、単位と基準、Recipe、そして実際に解析したサンプルの範囲で決めます。範囲は、領域の秒をファイルのレートで時間の切り出し（`wandas.frame.time_slice`）がサンプルに直した整数の始まりと終わり（`scan_service.analysed_samples`、端の保護 `EDGE_GUARD_S` をかけた後）です。領域の表示用の名前（バックエンドの `region_label`、小数 3 桁。Webview の `regionLabel`、小数 2 桁）は読むためだけのもので、同一性には使いません。以前の ID は `region_label` を使っていたので、48 kHz で 14 サンプル離れた 0.5001 s と 0.5004 s の始まりが同じ条件になっていました（#768）。

- Recipe のハッシュは領域を切り出しに入れる前に取るので、それだけでは領域を区別しません。ID はそのハッシュと解析したサンプルの範囲を合わせて作ります（`scan_service.condition_id`）。秒の書き方が違っても同じサンプルを解析する領域（保護の中の始まり、ファイル全体と 0〜終わり）は同じ条件です。
- Webview で「同じ条件か」を決めるのは 1 か所です。`comparePanes.sameCondition` は `conditionId` に加えて、各スキャンが返す頼んだ領域（`input.region`、秒を送ったとおりに）を `entryTable.regionKey` で比べます。`regionKey` が違う 2 つの領域は同じ条件になりません。同じ `regionKey` のスキャンは、バックエンドの ID が同じなら同じ条件です。範囲の決め方を Webview にもう 1 つ書きません。
- ID の形が変わったので、保存したスキャン結果の索引は `awa.scanIndex.v3` になりました（`entryScan.ENTRY_SCAN_INDEX_KEY`）。古い索引は読まず、ファイルは一度スキャンし直します。保存したセッションの固定した差（D）は、固定したときの古い ID と今の ID が違うので ≠ と出て、測り直せます。
- テスト: `python-backend/test_scan_service.py` › test_condition_id_tells_regions_under_a_millisecond_apart
- テスト: `python-backend/test_scan_service.py` › test_condition_id_is_the_same_for_the_same_analysed_samples
- テスト: `python-backend/test_scan_service.py` › test_analysed_samples_are_the_samples_the_time_slice_keeps
- テスト: `src/test/comparePanes.test.ts` › sameCondition and regionKey agree on every pair of regions: regions under 1 ms apart are two conditions, one region is one (#768, R15)
