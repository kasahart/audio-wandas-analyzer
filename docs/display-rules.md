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

差分、群の中央値、最大差は、Frame の全ビン・全サンプルから計算します。間引くのは計算した結果を描くときだけです。

- テスト: `python-backend/test_numpy_reference.py` › test_the_drawn_difference_keeps_the_notch_and_every_bump_at_their_own_bins_depth_and_height
- 丸めるのは画面とレポートに書く文字だけです。中央値、Δ、その最大の点、読み値の点選び、チャンネルのパワー平均は、Frame の丸める前の値で計算します（`stage_view.floored_db`）。読む点を選ぶこと、無音（−250 dB 以下）の判定、← / → の移動は、図のサービスが丸める前の答えで行い（`figures/pick.py`）、読んだ点の値も丸めずに送ります。webview は文字にするときだけ共通の書式（`shell/numberText.ts`）で丸めます。読み値の仕組みには丸める口がありません。中央値と Δ は float64 で計算し、float64 のまま持ちます（0.5 と 0.5 + 2⁻²⁴ の中央値は 0.5 + 2⁻²⁵、それに対する 0.5 + 2⁻²⁴ の Δ は 0 ではなく 2⁻²⁵）。無音（−250 dB 以下）は、バックエンドが −300 dB に床付けするレベルとゲインだけのものです。Δ（レベルの Δ でも）や、プレーンな値・コヒーレンス・ケプストラム・相関・ラフネスには無音の床がなく、−260 dB の Δ も読み、← / → で止まり、線に描き、範囲に入れます（無音の床は `figures/levels.py` の 1 か所で、値は `frames/analysis_spec.py` の `SILENT_DB` です）。色として描くだけで読まれない画像のマスだけは、絵を小さくするために丸めます。丸めると同じになる 2 つの値（−10.004 dB と −9.996 dB）の Δ は 0 ではなく 0.01 です。間引かないことと精度を保つことは別で、録音のサンプルも、元の形式の値をそのまま保てる型で持ちます（`analysis_engine.source_dtype`：16・24 ビット PCM と 32 ビット浮動小数は float32 で正確に、64 ビット浮動小数・32 ビット PCM・CSV は float64）。STFT は float64 のサンプルから計算して complex128 で持ちます。行のスペクトログラムの読み値がそのマスを読むためです。数を小数の桁に丸める算術（`Math.round(v * 10) / 10` など）は `toFixed` と同じく数を書くものとして、契約表の検査が登録を求めます。
- テスト: `src/test/plotContracts.test.ts` › the detector finds a number written by a primitive, a helper imported under another name, a local alias of one, and rounding to decimals by arithmetic
- テスト: `python-backend/test_numpy_reference.py` › test_every_value_of_the_difference_is_the_frames_unrounded_difference_bin_by_bin
- テスト: `python-backend/test_figures_silent.py` › test_a_delta_has_no_floor_its_minus_260_db_is_drawn
- テスト: `python-backend/test_combine_ops.py` › test_a_median_of_float32_recordings_is_taken_in_float64
- テスト: `python-backend/test_combine_ops.py` › test_a_difference_from_that_median_is_not_zero
- 録音が float32 で読まれていても（16 ビットの WAV など）、比較台が Frame から取る数は、チャンネルをまとめる前に float64（複素数は complex128）に直します。直すのは 1 か所（`stage_view.read_frame` が Frame の配列を取る `_taken`）だけで、平均・パワー平均・中央値などの計算はその後です。`read_frame` は読み取りのすべての配列（値・軸・トリガーのイベントの行、あとから足した欄も）を確かめ、float64 / complex128 でなければその場でエラーにします。ほかの関数（描く関数や `stage_combine.py`）は変換しません。読み取りはもう float64 で、あとで直しても float32 で取ったチャンネルの平均は戻らないからです。float32 のまま平均すると、float32 の 1 段だけ違う 2 つの値の平均がどちらかに丸まります。
- テスト: `python-backend/test_frame_reading.py` › test_every_array_of_a_reading_is_float64_whatever_the_recordings_dtype
- テスト: `python-backend/test_frame_reading.py` › test_a_float32_trigger_events_channel_mean_is_taken_in_float64
- テスト: `python-backend/test_frame_reading.py` › test_read_frame_refuses_a_reading_with_any_array_not_in_float64
- 設定の初期値にする数も同じです。トリガーを足したときのレベルの初期値は、比較しているチャンネルの、領域の中のピーク（一番大きい |サンプル|）の半分です。このピークは 1 層目の答えです。バックエンドが、比較している録音とチャンネルの全部について、元のサンプル全部から 1 つの数として出します（`analysis_service.py` の `region_peak`、命令は `region-peak`）。画面は頼んで覚えておくだけで、録音どうしの最大を取ったり計算したりしません（`src/webview/runtime/regionPeak.ts` の `createRegionPeaks`）。行に描く絵（間引いた最小・最大）からは計算しません。絵は領域の中の一番大きいサンプルを持っていないことがあるからです。
  - 読んでいる途中（pending）と、読み取りが失敗したとき（failed）は、ピークの数はありません。推し量った値を初期値にしません。そのときに足したトリガーは処理そのものの既定値で始まり、フッターにそう書きます（`stepPeakUnread`）。
  - 答えを覚えておくこと、失敗した読み取りを 5 秒の間を置いて出し直すことは、ほかの読み値と同じ決まり（`answerStore.ts`）に任せます。ここに別のキャッシュや出し直しを足しません。
  - サンプルを読みに行くのは、トリガーを足せるときだけです。＋ のメニューを開いてトリガーが選べるときと、トリガーを足すときに、ステップバーが読みます（`StepBarState.peak` は値ではなく読む関数です）。グラフを描き直すたびには読みません。読むのは比較しているスロットのチャンネルだけで、トラックに並んでいるほかのファイルは読みません。
  - 30 本を超える録音を、頼まれずにまとめて計算しない、というこのプロジェクトの決まりは、ここでも同じです。ピークを出すのに 30 本を超える録音のサンプルが要るときは、1 本も読みません（`regionPeak.ts` の `tooMany`。上限は基準の群を止めるのと同じ定数 `trackStageMode.ts` の `LARGE_BASE` で、別の定数は作りません）。そのときに足したトリガーは処理そのものの既定値で始まり、フッターに「録音が多いのでピークを読んでいない」と書きます（`stepPeakTooMany`）。
- テスト: `src/test/regionPeak.test.ts` › the peak of more recordings than the limit is not read at all: 31 recordings start no read and say so, 30 are read; channels of one recording count once (R1)
- テスト: `src/test/uiSmoke/triggerDefault.spec.ts` › opened from the tracks with 31 recordings and no slot chosen, the comparison is of two of them and only those two are read for a trigger's level: never all 31 (R1)
- テスト: `src/test/uiSmoke/triggerDefault.spec.ts` › a trigger added on a region starts at half the region's true peak, read from every sample by the real backend; added while that read is on its way it keeps its own level and the footer says so (R1)
- テスト: `src/test/uiSmoke/triggerDefault.spec.ts` › with a hundred files open and thirty of them on the tracks, the samples for a trigger's level are asked only when ＋ offers a trigger, and only of the two compared slots (R1)
- テスト: `src/test/regionPeak.test.ts` › a region's peak is one answer of the backend's: asked once with every compared recording's channels and stretch, its number kept as sent, nothing computed of it here (R1)
- テスト: `src/test/regionPeak.test.ts` › while a region's peak is being read it is pending, and a failed read is failed until the answer store's pause is over: neither carries a number (R1)
- テスト: `src/test/stepBarModel.test.ts` › a new trigger starts at half the tracks' peak, to two figures; fix_length at the files' length
- テスト: `python-backend/test_calibration_pipeline.py` › test_a_float64_source_keeps_samples_a_float32_step_apart_through_its_samples_stft_and_delta
- テスト: `python-backend/test_calibration_pipeline.py` › test_files_are_cached_in_the_dtype_that_holds_every_sample_of_their_format_exactly
- テスト: `python-backend/test_stage_view.py` › test_a_spectrums_channels_are_power_averaged_before_their_level_is_rounded
- テスト: `python-backend/test_numpy_reference.py` › test_a_groups_median_is_taken_bin_by_bin_so_tones_in_other_bins_do_not_make_one
- テスト: `python-backend/test_known_answers.py` › test_the_cursor_spectrum_reads_each_channels_tone_at_its_frequency_and_amplitude
- 時間信号の段（「入力」やフィルタのチップ）は、wandas が返す時間信号のまま比べます。比較台が独自にレベル（ブロックごとの二乗平均）を作ることはしません。その Δ は比較から基準を引いた信号です（ChannelFrame の引き算、群なら基準のサンプルごとの中央値を引く）。全サンプルで引いてから、波形と同じく区間ごとの最小と最大で描きます。長さが違う録音は共通する部分で引き、サンプリング周波数が違う録音と、単位や校正（基準値）が違う録音は Δ を出さず、Δ の図と見出しにその理由を出します。Δ は有効数字 6 桁で返すので、小さい値どうしの差も 0 に丸まりません。レベルで比べたいときは、wandas のレベルの手順（`sound_level`、`rms_trend`）を足します。平均の幅はその手順のパラメータとしてレシピに残ります。
- 時間信号か、指標（ラウドネスなどの時間変化）かは、それを作った操作で決めます。サンプル数では決めません。短い録音も時間信号として波形で描き、長い録音とサンプルごとに比べます。
- 単位や校正（基準値）が違う録音どうしは、どの Frame でも Δ と中央値を出さず、その理由を出します（スペクトル、帯、スペクトログラム、指標も同じです）。
- テスト: `python-backend/test_stage_combine.py` › test_a_short_time_signal_is_a_signal_whatever_its_length
- テスト: `python-backend/test_stage_view.py` › test_a_time_signal_is_its_own_values_never_a_level_the_comparison_makes
- レベルが比べられるかは、単位・基準値・レベル基準の名前の 3 つで決めます。校正状態は含めません（ゲイン補正した FS の録音と補正していない FS の録音はどちらも dBFS なので比べます）。それでも校正状態の違う線が 1 本の軸に載るときは、未校正の線が読み値と凡例に自分で「未校正」と書きます（R4）。webview とバックエンドはこの 1 つの定義を使います（`figureModel.ts` の `levelIdentityOf`、`python-backend/frames/level_identity.py`）。比較台の基準の群も同じ定義で分けます（図のサービスの `python-backend/figures/members.py`）。
- テスト: `src/test/levelIdentity.test.ts` › levels compare only in one unit, reference and its label, whatever their calibration status: the webview answers the table the backend answers (R1, R4, A34)
- テスト: `python-backend/test_level_identity.py` › test_levels_compare_in_one_unit_reference_and_label_whatever_their_calibration_status
- 伝達関数の値は、描くペア（ch2 / ch1）の単位の比を基準にしているので、その Δ と中央値はチャンネルのレベルではなくその比の同一性で分けます（同じ単位どうしの利得は Pa の録音でも V の録音でも比べ、Pa/V と V/V は比べません。`stage_combine.py` の `_calibration`）。
- webview は、図の外に書く言葉のために同じ同一性を名乗ります。伝達関数の線はペアの単位の比の同一性で、基準スロットに対するクロススペクトルの線はペアの基準（wandas の pair domain。バックエンドが `unit` に書く）で名乗ります（`figureModel.ts` の `pictureLevelOf`）。数えるのは図のサービスです（`python-backend/figures/members.py`）。
- ペアの段（伝達関数・クロススペクトル）で、絵がまだ届いていない録音は計算中です。チャンネルのレベルで「別の基準」とは決めません。表の答えが別の基準・別の軸で外した基準群の録音も、ペアの段では問い合わせて、その絵の同一性で数えます（`trackStageMode.ts`）。段の集合の各録音の同一性は、答えの置き場が絵と一緒に持つものです（`stageSource.identity`）。画面は自分で作りません。
- 時間軸の線は、始まりと刻みが同じものだけを 1 つの軸として数えます（図のサービスの `figures/members.py` が、答えの軸で決めます）。長さが違うだけなら共通の部分で比べます。チャンネル数の違う録音（全チャンネルをまとめて比べるとき）は、理由を付けて除きます（「チャンネル数の違う n 本は除外」）。値のない答え（イベントのないトリガー、ナイキストを超える帯）は「値のない n 本は除外」と言います。「失敗」とは言いません。
- テスト: `python-backend/test_stage_view.py` › test_a_cross_spectrum_of_two_units_is_named_by_its_pairs_reference_never_a_channels

## R2 線の間引きは区間ごとの最小と最大

点が画面より多い線（波形、スペクトル、ケプストラム、差分）は、区間ごとに最小と最大の点を、それぞれ自分の x の位置に残します。平均したり、最大だけを残したりしません。どの画面でも同じ線になります。スペクトルなどの線の区間は枠の幅の 1 px ごとです（`figures/thinning.py` の `LINE_BUCKETS_PER_PX`）。時間信号の波形（帯）は 1 px に 2 区間です（同じファイルの `BAND_BUCKETS_PER_PX`）。2 px ごとにすると、点の多いスペクトルのノイズの帯で線の間から背景が見え、すべての点を描いた絵と違って見えるからです。

- テスト: `python-backend/test_figures_thinning.py` › test_more_bins_than_the_screen_shows_keep_each_buckets_lowest_and_highest_bin_at_every_zoom
- テスト: `python-backend/test_figures_thinning.py` › test_a_spectrums_buckets_keep_the_recorded_bins
- **描いた点の x は、その点が表す元の値の x です。** 間引いて残した点は、答えの中の自分の番号（何番目のサンプル・ビン・係数か）の x に置きます。割合（i / N）に幅を掛けて作り直したり、個数から時刻を組み立て直したりしません（4 サンプル・4 Hz の最後の点は 0.75 秒で、0.5625 秒ではありません）。熱図の 1 マスは、まとめた列と行の中の 1 つの値（レベルなら一番大きい値）で、マスの縁はまとめた列と行そのものの縁です（`python-backend/figures/thinning.py` の `drawn_image`、`cell_edges`）。
- バックエンドで wandas の Frame を読むのは 1 か所だけです（`python-backend/frames/stage_view.py` の `read_frame`）。Frame の種類ごとに、値（チャンネルをまとめたもの）と軸（各値の x、行の y、信号なら開始時刻とサンプリング周波数）を `FrameReading` として返します。走査はこの読み取りを全解像度のまま取り置き（`services/stage_combine.py` の `stage_data`）、画面には段の説明だけを返します（`stage_view.describe`：Frame、図の種類、軸、量と単位。点は 1 つも入りません）。図のサービスは取り置いた読み取りを答えとして受け取り（`transport/figure_answers.py`）、描く点、範囲、読み値、中央値と Δ をすべてそこから作ります。読み取りが各値の x を持つので、描いた点の x と、そこで読んだ点の x は同じです。比較台と図のサービスのほかの場所で Frame の `data`・`freqs`・`times` を直接読みません（比較台の外で自分の Frame を読むサービスは `scripts/check_figure_imports.py` の `FRAME_READERS` に理由とともに載り、ほかの場所で読むと verify が失敗します。規則 R）。新しい Frame の種類を足す手順は `docs/plot-layers.md`（Adding a new Frame kind）にあります。足し忘れると、`test_stage_view.py` › test_every_wandas_frame_is_drawn、`test_operation_catalog.py` › test_the_generated_typescript_is_current、`src/test/stageViewKinds.test.ts`、`test_frame_reading.py` のどれかが失敗し、足りない手順を名前で言います。
- 時間信号の線は、区間ごとの最小と最大のサンプルの番号を取り（`figures/thinning.py` の `band_extremes`）、そのサンプル自身の時刻（開始時刻 + 番号 / サンプリング周波数）に置きます（`drawn_band`）。ファイルの長さに対する割合から時刻を作りません。
- **決めるのは答えの軸、描いた点は描くだけ。** 全体表示の横軸の範囲（拡大の解除や「0」も）は、図のサービスが答えの軸から決めます（`figures/ranges.py`。答えは軸の端を持ちます：スペクトルは 20 Hz からナイキスト周波数、ほかの線は最初の点から最後の点、熱図は最初の列から最後の列の時刻。`transport/figure_answers.py`）。描いた点の数・最初・最後からは決めません。間引きと拡大で変わるからです。どの録音が同じ軸かも答えの軸で決めます（`figure_answers.axis_key`、`figures/members.py`）。時間の軸は最初の点と間隔が同じなら長さが違っても同じ軸（共通の部分で中央値と Δ、R1）、ほかの軸は種類・目盛り・量・単位と、点の数・最初・最後（有効数字 9 桁）が同じときだけ同じ軸です。同じ軸でない録音は、理由（別の軸）を付けて外します。わからないことは分ける側に倒し、まとめません。
- テスト: `python-backend/test_figures_signal.py` › test_the_band_is_the_recorded_one_each_extreme_at_its_own_samples_time
- テスト: `src/test/uiSmoke/sourceAxis.spec.ts` › a long recording's spectrogram, thinned to columns, has a whole view from its first STFT frame to its last, not from its first to its last drawn column (R2)
- テスト: `python-backend/test_figures_signal.py` › test_zoomed_to_fewer_samples_than_two_a_bucket_every_sample_is_drawn_as_itself
- テスト: `python-backend/test_figures_heatmap.py` › test_a_blocks_level_is_the_loudest_of_its_cells_not_their_mean
- テスト: `python-backend/test_figures_signal.py` › test_the_confirmed_range_is_the_signals_whole_length_and_the_largest_magnitude_of_every_sample
- スペクトルの間引きは 1 つの関数（`figures/thinning.py` の `drawn_line`）だけで行います。比較台の線も、カーソルスペクトルも、ペアの図もこれで描きます。webview は間引きません。
- テスト: `python-backend/test_known_answers.py` › test_the_cursor_spectrum_reads_each_channels_tone_at_its_frequency_and_amplitude
- テスト: `python-backend/test_known_answers.py` › test_band_levels_read_the_tones_rms_in_the_cursor_spectrum_and_in_compare
- 時間軸の線（トラックの波形、比較台の波形・時系列・ケプストラム）と、熱図とトラックのスペクトログラムの時間のブロックは、区間の区切りを 1 つの規則で決めます。画面の範囲にある点を、数で等分します（`thinning.py` の `_bucket_edges`）。
- テスト: `python-backend/test_figures_signal.py` › test_the_buckets_are_the_recorded_ones
- テスト: `python-backend/test_figures_heatmap.py` › test_the_column_blocks_are_the_recorded_ones_at_two_pixels_each
- ペアの図（伝達関数・位相・コヒーレンス）は、バックエンドが全ビンをそれぞれの周波数で返し、図はそれを全部つないで描きます。間を飛ばして拾わないので、狭い共振・ノッチ・コヒーレンスの谷も残り、拡大すると範囲の全ビンが見えます。
- テスト: `python-backend/test_analysis_service.py` › test_pair_spectrum_keeps_every_bin_at_its_own_frequency_so_a_narrow_notch_stays
- 比較台の線は、どの種類も同じ規則です。コヒーレンスはスペクトルと同じく対数の区間ごとの最小と最大のビンを、相関・ケプストラム・時系列（時間信号、wandas のレベルや指標）は区間ごとの最小と最大の点を、それぞれ自分の x に残します（`figures/thinning.py` の `drawn_line`）。区間の中の 1 点だけを選んだり、決まった周波数に補間したりしません。トリガーのイベントも、イベントごとに自分の x を持つ 1 本の線で、同じ規則で区間ごとの最小と最大の点をそれぞれ起きた時刻に残します（イベントの平均の線も同じ）。ほかのイベントの x に合わせたり、区間の端に動かしたりしません。正の山と負の谷が同じ区間にあっても両方残ります。
- テスト: `python-backend/test_figures_thinning.py` › test_a_long_cross_correlations_peak_is_drawn_at_its_own_lag
- 実際の録音（1 ビン幅の音と、それより大きい音が別の周波数にある 2 本）を、拡張機能と同じバックエンドで解析して比較台に出し、Figure が描いた線（Figure が言う描いた点、`__figureInspect`）から読みます。全体を間引いて描いても狭い音はその高さのままです。
- テスト: `src/test/uiSmoke/figureOverlay.spec.ts` › a narrow tone is drawn at its full level on the thinned whole spectrum, and zoomed onto it the window is drawn from every one of its own bins (R2, R3)
- 比較台の Δ の見出し（差が一番大きい場所と値）は、描いた点ではなく、間引く前の全部の値から探します（図のサービスの計算オ、`python-backend/figures/headline.py`）。熱図でもブロックの平均時刻や帯の中心ではなく、その値の時刻と周波数を書きます。
- テスト: `python-backend/test_numpy_reference.py` › test_the_difference_headline_is_the_notch_at_its_bin_with_its_unrounded_depth
- テスト: `python-backend/test_figures_service.py` › test_the_headline_is_the_point_a_read_of_it_gives_in_the_reads_own_form
- **線は切り取り、留めない。** 値の線（スペクトル・時系列・差分の線、棒の上の縁、信号の波形）は、どの点も軸の正確な位置に置き、図の縁や軸の外の決まった所に留めてからつなぎません。図の外へ出る区間は、図の箱で切り取ります（`src/webview/figure/figure.ts` がキャンバスの切り取りの中で線を描きます）。こうすると、拡大して図の中の点から軸のずっと外の点へ向かう区間も、本当の区間のとおりに描かれ、本当の区間が縁を横切る所で図を出ます。図に見える線の形は拡大の度合いで変わりません。図のサービスは、範囲のすぐ外の点を両側に 1 点ずつ残して送るので、線は図の縁まで届きます（`figures/thinning.py` の `drawn_line`）。読んだ点の印は R7 のとおり図の縁に留めます。これは線ではなく、読んだ点の位置を示す印です。
- **区間は線を描く軸の目盛りで作り、ギャップはつながない。** 区間ごとの最小と最大は、その線を描く軸の目盛りの区間で取ります。対数の軸では対数で等しい幅、線形の軸では点を数で等分します（`figures/thinning.py` の `_min_max_indices`。線形の軸の線は点が等間隔なので、等しい幅になります）。どの図も図のサービスが間引き、答えが言う軸の目盛り（線形か対数）の区間で取ります。線形の軸を対数の区間で間引くと、高い側の 1 つの区間が何画素にもなり、違う画素にある細いピークが 1 つにまとめられるからです。
- 値が有限でない点（NaN、±∞）と、レベルの線の無音の床以下の点は線のギャップで、間引いてもつなぎません。残した 2 点の間に元のデータのギャップがあれば、そのギャップも「値なし」として送ります（JSON に NaN はないので null）。図のサービスの `figures/thinning.py`（`drawn_line` の `_with_breaks`）がこの規則です。Figure は null でペンを上げます。信号の波形は区間ごとの最小と最大の組で、ギャップを含む区間は 1 つのギャップとして送ります（`thinning.py` の `band_extremes`）。その区間は 1 画素より細く、拡大するとその範囲を細かく作り直します（R3）。どの拡大でも、描いた線はギャップで切れています。チャンネルのピーク（`peakAbsolute`）も値のある点だけから取ります（`services/analyzer.py` の `absolute_peak`）。
- テスト: `python-backend/test_figures_thinning.py` › test_a_line_with_a_stretch_of_no_values_is_drawn_with_a_break_there_at_every_zoom
- テスト: `python-backend/test_figures_thinning.py` › test_a_thinned_line_keeps_a_break_at_each_gap_in_either_scale_and_buckets_stay_where_they_are

## R3 拡大しても同じ規則で、範囲の中を全解像度で作り直す

拡大やパンでは、見えている範囲のデータを元の解像度から作り直し、R2 と同じ規則で描きます。拡大前の粗い線を引き伸ばしません。

- テスト: `python-backend/test_figures_thinning.py` › test_a_zoomed_spectrum_is_its_own_bins_in_the_range_on_screen
- テスト: `python-backend/test_figures_thinning.py` › test_a_zoomed_spectrums_buckets_are_laid_across_the_view_not_its_bins
- テスト: `python-backend/test_known_answers.py` › test_compare_keeps_the_tone_at_its_frequency_and_amplitude
- テスト: `src/test/uiSmoke/trackRowFigures.spec.ts` › with the automatic STFT, a row zoomed past the whole file's columns asks for the window on screen and draws that window's own frames (R3)
- テスト: `src/test/uiSmoke/trackRowFigures.spec.ts` › with STFT settings given, a zoomed row draws the frames of the whole file's STFT that are there, with nothing more asked (R3)
- テスト: `src/test/spectrogramZoom.test.ts` › zoomed past the whole file columns, the lane asks for a window around the view that brings every frame it can show
- スペクトログラムのレーンは、周波数方向に狭い帯へ拡大したときも同じです。全体の行（最大 192 行）では足りなくなると、その帯の FFT のビンを取り直して描き、読み値もその行から読みます。行を引き伸ばしません。
- テスト: `src/test/uiSmoke/trackRowFigures.spec.ts` › a row boxed to a narrow band draws that band's own bins from the answers kept, with nothing more asked (R3)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the lanes under a trigger zoom on their own (the recording's time, not the trigger's) and draw the signal at full resolution once zoomed
- **届いた答えに絵がないとき**も、それが答えです。Tracks の行は、録音の答え（サンプルとスペクトログラムのレベルの鍵）を取り寄せます。答えが正しく届き、描けるチャンネルが 1 つも入っていなかったら、その鍵での答えは「ない」です（answer store の empty）。行は「このチャンネルのスペクトログラムはありません」（`spectrogramNone`）と書き、同じ鍵のまま取り寄せ直しません。同じことを聞けば同じ答えが返るだけで、聞き直すと描くたびに要求が出続けます。
  - 鍵は、ファイル、その版（sourceVersion）、校正、スペクトログラムの設定の署名（STFT と窓）でできています（`answerStore.ts` の `answerKey`）。取り寄せ直すのは、このどれかが変わったときだけです。時間がたっただけでは聞き直しません。
  - 失敗（failed）は別です。失敗は 5 秒の間を置いて出し直します（`answerStore.ts` の `FAILED_RETRY_MS`）。設定に触れると失敗は手放されてすぐ出し直しますが、届いた答え（empty も）は手放しません。届くまで（pending）は「読み込み中」と書きます。
  - 状態は answer store（`answerStore.ts` の `createAnswerStore`）だけが持ちます（answered / failed / pending）。ほかにキャッシュや出し直しを足しません。
- テスト: `src/test/uiSmoke/toolbar.spec.ts` › static page: a row's answers that came with nothing to draw are asked once, and the row says so
- **失敗した答えを出し直す時刻**は answer store だけが持ちます。読み直したい側は `whenFailureEnds` で知らせを頼み、store が 5 秒の間が終わったその時に、頼んだ全員に 1 回だけ知らせます（同じ答えを待つ読み手が 2 つあっても出し直しは 1 回です）。届くのを待つ側は `whenSettled` で頼みます。答えの出どころ（`answerStore.ts` の作る関数や `fetchedSource`・`fullSource('fetched', …)` を呼ぶファイル）は、タイマー・待つ読み手の一覧・起こす時刻を自分で持ちません。出どころの中で `setTimeout`・`setInterval`・`requestAnimationFrame` などを呼ぶと、名前を変えても呼び先で見つけてテストが失敗します。出どころを分けて時刻を 2 か所に持つと、出し直しの決まりを変えるときに両方を直すことになり、片方だけ古い決まりのまま残るからです。
- テスト: `src/test/answerStore.test.ts` › a failed answer's readers are told exactly when its hold ends, together and once; a dropped one never is (whenFailureEnds)
- テスト: `src/test/answerStoreBoundary.test.ts` › no answer source schedules with a timer of its own: when a failed answer is asked again is the store's (whenFailureEnds)
- Tracks の行の答え（波形とスペクトログラム）と、カーソルスペクトルの答えも、失敗したら同じ決まりで出し直します。どちらも `answerStore.ts` の `createFailureHold` を使い、5 秒の間は同じ条件（同じ解析、設定、ファイルの版。カーソルスペクトルは同じカーソルも）では頼まず、5 秒たつと store が画面を起こして頼み直します。行も実行部も、自分の秒数やタイマーを持ちません。キーで点を進める読み（図の `figure-read`）は別です。失敗しても後から自分では出し直しません（誰も押していないのに点が動くため）。読んでいた点は残り、次のキーはそこから進みます。
- テスト: `src/test/trackRows.test.ts` › a failed asking says why, is not asked again at once, and is asked again after the answer store's pause, which wakes the screen
- テスト: `src/test/uiSmoke/laneCulling.spec.ts` › a cursor spectrum the host failed is not asked again on every frame
- テスト: `src/test/uiSmoke/readoutTransitions.spec.ts` › the browser table holds a row for each chart the readout runs on, by its full name, and each real path R7 names
- **再生中のカーソルスペクトル**は、1 枚の絵の線がすべて同じ時刻のものです。答えは録音 1 つずつ順に頼むので、頼むたびにその時のカーソルで頼むと、録音の数だけ違う時刻の線が 1 枚に並びます。そこで、時刻を 1 つ決めて全録音をその時刻で頼み、全部届くまで前の絵を残し、届いたら 1 回で描き替えます（`comparisonRuntime.ts` の `playbackSpectrumRound`）。次の時刻は、前の時刻の答えが出そろってから決めます（答えが来ない録音があれば 2 秒で次へ進みます）。
- テスト: `src/test/uiSmoke/analysisWindow.spec.ts` › while playing, every picture of the cursor spectrum has the lines of every recording at one time
- **届くまでの代わりの絵は描きません。** 新しい絵が届くまで、図は前の本当の絵をそのまま出しておき、その間は読み値を出しません（`figure.ts` の `keepWhileWaiting`。再生中のカーソルスペクトルは、前の時刻の本当の線を残します）。粗い絵から作った代わりの線は描きません。Tracks の行のスペクトログラムは、ファイル全体のレベルを描いた本当の絵のうち一番広いものを下に残します（`figure.ts` の `imageUnder`）。横に大きく動かして今の絵の外へ出たところや、拡大用の細かいレベルが届いていないところには、それが粗く見えます。これも描くだけで、読み値には使いません。Tracks の行の波形も同じで、録音全体を描いた本当の線のうち一番広いものを残し、今の線が図の端まで届いていないところにだけ描きます（`figure.ts` の `lineUnder`）。行は 1 枚ずつ順に絵を頼むので、行が多いと速いスクロールでは絵が届くまで時間がかかります。その間、波形が空になる代わりに録音全体の粗い波形が見えます。
- テスト: `src/test/figureBandLane.test.ts` › a line's widest picture is kept under it and drawn where the line drawn now does not reach: of its answer alone
- **録音のないところは塗りません。** スペクトログラムの段で値のない色（一番低い色）を塗るのは、録音の始まりから終わりまでだけです。録音の終わりより後ろを塗ると、無音が続いているように読めるからです（`figure.ts` の `groundOf`）。
- テスト: `src/test/figureImageLane.test.ts` › past its whole axis across (a recording's end) an image lane paints nothing: the colour of no value is the recording's alone
- **Tracks の行には、時間の目盛りの位置に薄い縦線を引きます。** 行は自分の時間軸の目盛りを持たないので、画面の上の時間の目盛り（`timeRuler.ts`）の位置を画面から受け取り、波形とスペクトログラムの両方に同じ位置で引きます（`figure.ts` の `acrossGrid`）。時刻を行の上から下へたどって読むためです。
- **線の段の横軸の目盛りの縦線は、線の上に引きます。** 波形のように段を塗りつぶす線の下に引くと隠れて、時刻を上から下へたどれないからです（前の図も線の上に引いていました）。色は暗い灰色で、データの線と見間違えません。値の軸の横線は線の下のままです（`figure.ts` の `ACROSS_GRID_COLOUR`）。テスト: `src/test/uiSmoke/trackRowFigures.spec.ts` › a row on the Figure path draws its waveform and spectrogram from the answers the backend keeps
- テスト: `src/test/figureImageLane.test.ts` › the screen's own ticks across are drawn down an image lane too, where the screen says they are (acrossGrid)
- 同じ実際の録音で、狭い音の上に拡大すると、比較台のスペクトルの重ね図とその Δ の段は、範囲のビンを取り寄せません。図のサービス（`python-backend/figures/`）がすべてのビンを持っていて、指定範囲の中を、枠の幅の 1 px ごとの区画の最小と最大で描き直します（`figures/thinning.py`）。全体を間引いた線がその範囲に持っていた点の 2 倍より多くなり、一番高い点はその音で、全体のときと同じ高さです。範囲のビンが区画より少なくなるまで拡大すると、範囲の中のビンを 1 つ残らず、ビンの間隔（16000/8192 Hz）で描きます。範囲の外のもっと大きい音は図に出ません。差の段も同じ答え（すべてのビンの Δ）から描きます。
- テスト: `src/test/uiSmoke/figureOverlay.spec.ts` › a narrow tone is drawn at its full level on the thinned whole spectrum, and zoomed onto it the window is drawn from every one of its own bins (R2, R3)

## R4 両軸に量・単位・基準

どのグラフも、縦軸と横軸に量の名前と単位を書きます。熱図は色の意味もカラーバーに量・単位・両端の値で書きます。カラーバーは、Tracks の行のスペクトログラムでも比較台の熱図でも Figure が描きます（Tracks の行では行の右）。カラーバーの名前は省きません。色の目盛りの横に入らないときは、目盛りの上の行に図の幅で書き、それでも入らなければ軸の名前と同じく小さくし、量と単位の 2 行に分け、量を縮めます（`axisTitle.ts` の `fitAxisTitle`）。カラーバーが色の意味を量と単位で書くことは、Figure のテストが確かめます（`src/test/figureImageLane.test.ts`）。dB は wandas のレベル基準（「dB SPL re 20 µPa」など）で書きます。dB でも振幅でも、未校正なら未校正と書きます。重ねた線には凡例を付けます。カーソルスペクトルは軸が低いので、レベルの名前を凡例の頭にも書きます。

**比較台の図（仕様 2）。** 1 つの段の値の軸は 1 つの単位・基準だけです。合わせる先は比較 1 の録音で、単位・基準が違う録音は載せず、中央値と Δ からも外し、外した本数と理由を基準の見出しに書きます（図のサービスの計算ア、`python-backend/figures/members.py`。Webview は数えず、返った件数と理由を書くだけです）。右の第 2 の軸は出しません。校正済みと未校正は同じ軸に載り、軸の名前は、その軸の線に校正済みが 1 本でもあれば校正済みの言葉で書き、そのとき未校正の線は凡例と読み値に自分で未校正と書きます（校正の言葉も計算アが返します）。
- テスト: `src/test/compareOverlayFigure.test.ts` › the calibration words and the Δ headline are the picture's: an uncalibrated line on an axis named calibrated says so, and the headline is in the readout's form

軸の名前は「量 [単位]」の形で、単位はいつも最後の角かっこに書きます。単位のない量（コヒーレンス γ²、相関係数、実ケプストラム、波高率、表の行）は「[–]」と書きます。単位がわからない量（単位を書いていない CSV の列、単位のない値）は「[unit unknown]」「[単位不明]」と書きます。CSV の列の名前が「温度 [°C]」「温度 (°C)」のように単位を書いていれば、その単位を軸に書きます。量の名前は「値」にしません。ただ 1 つの例外は、手順のあとの量も単位もバックエンドが分からないと送った時間信号（`measure: "unknown"`）で、量も単位も名乗らず「値 [単位不明]」「Value [unit unknown]」と書きます（「振幅」とは書きません）。ラウドネス・シャープネス・ラフネスは単位から（Bark 帯ごとのラフネス `roughness_dw_spec` は総ラフネスと分けて「比ラフネス [asper/Bark]」）、時間信号から手順が作った量は手順から（実効値・時間重み付き実効値・パワー。ほかの累乗は wandas がレベルを決めないので「値 [単位不明]」。手順が何もしていなければ信号の単位の振幅）、dB の時間変化（`sound_level`・`rms_trend` の dB）は何のレベルか（「時間重み付き実効値 未校正 [dBFS]」、手順がわからなければ「レベル」）で書き、dB の値を「振幅」とは書きません。ペアの名前（「· ch2 / ch1」）は量の後、単位の前に書きます。軸の名前は省いてよい文字ではありません。軸に入りきらないときは、文字を小さくし、量と単位の 2 行に分け、それでも入らなければ量を記号（「γ²」）か頭の文字（「Amp…」）に縮めますが、量と単位はどちらも描きます（`src/webview/figure/axisTitle.ts`）。Figure は絵の量・単位・基準から軸の名前を作ります（`src/webview/figure/axisNames.ts`）。どの軸の名前も量と単位を持つことは単体テストが確かめ（`src/test/axisNames.test.ts`、`src/test/figureLineAxisNames.test.ts`）、実ブラウザの契約テストは、どの図のどの段でも両軸の名前が単位の角かっこで終わることを確かめます（`src/test/uiSmoke/plotContract.spec.ts` の `expectFigureContract`）。値の軸の目盛りの数字は、どの高さのグラフでも重ねません。低いグラフでは目盛りを減らします（切りのよい刻みを粗くするか、細かい刻みを 1 つおきなどに間引く。`src/webview/figure/ticks.ts` の `valueAxisTicks`）。どの高さでも数字が重ならないことは `src/test/figureTicks.test.ts` が確かめます。横軸の目盛りの数字も、どの幅のグラフでも重ねません（対数の周波数軸の狭い図で、前の数字に触れる数字は省き、目盛りの線は残します）。目盛りの負の数は、縦軸も横軸も、しきい値の文字も「−」で書きます。縦軸の数字は、ガターの軸の名前に重ねません。長い数字（「−0.0010」）は、名前の右に入るように全部を小さく書きます。軸の名前は、量を落として単位だけにする gui-core の `fittedAxisTitle`（`drawValueAxis`）では書きません。

- 1 つの軸に載る線は、R1 のレベルの同一性（単位・基準値・レベル基準の名前）が同じ録音のものだけです。重ねた線を軸に分けるのはこの同一性で、軸の名前の文字ではありません（図のサービスの `figures/members.py`）。同一性の違う録音は、段を分けるか外します。1 本の軸に校正状態の違う線が載るとき、軸の名前は量・単位・基準で書き、未校正はその軸の線がすべて未校正のときだけ書きます。未校正の線は、凡例と読み値に自分で「未校正」と書きます（`src/webview/figure/axisNames.ts`）。
- どの図（比較台の重ね図、録音ごとの段、トリガーのイベントとその下の段、Tracks の行、カーソルスペクトル、ペアの図）も、1 つの段の値の軸は 1 つの単位・基準だけです。右の 2 本目の軸は出しません。単位・基準が違う録音は段を分けるか外し、外した本数と理由を書きます（図のサービスの計算ア）。カーソルスペクトルは、軸は線がすべて未校正のときだけ未校正と書き、校正状態が混ざる軸では未校正の線が凡例と読み値に自分で書きます。
- テスト: `src/test/figureModel.test.ts` › every place that groups lines onto a level axis, range or colour scale goes through figureModel (A43, A49, R1, R4)
- テスト: `src/test/figureModel.test.ts` › outside figureModel.ts nothing builds an axis name, calls an axis builder, keys by level identity, applies a range rule, counts files for n or defaults a reference, but the exact list; figureModel.ts only its own definitions (docs/plot-layers.md)
- 図の軸の名前は Figure が絵の量・単位・基準から書き（`src/webview/figure/axisNames.ts`）、範囲は図のサービスが決めます（`python-backend/figures/ranges.py`）。図が数える録音（中央値の n、除いた数と理由）は、図のサービスが決めます（`python-backend/figures/members.py`）。図と同じレベルの同一性と軸で答えが出た録音だけを数え、計算中・前の手順や版や校正の答え（灰色で見せても数えない）・失敗・別の基準・別の軸の録音は理由とともに除きます。同一性は、比較している録音の答えから決めます。比較している録音がまだ計算中か古ければ同一性はなく、どの録音も数えません（`no-identity`）。「最初に答えの出た録音」で決めることはしません。画面は、絵が言う集まりを 1 つの形（`src/webview/runtime/figureModel.ts` の `FigureSet`。作るのは `countedSet` だけ）にして、見出しの n と除いた理由を書きます（`setCountText`・`setExclusionText` は `FigureSet` しか受け取りません。ほかの経路で数えると `figureSetOnly.test.ts` が失敗します）。未校正の言葉と CSV の列の題も同じファイルが決めます。比較台の基準群を各波形で描くときは、未校正の線だけがその言葉を持ちます。入口は録音の一覧で、解析の値を持たず、自分では何も数えません（`entryNoAnalysis.test.ts`。諸元表の数値列の分布は、図のサービスが数えて描く Figure です）。
- どの値も、自分の行の基準と校正状態を名乗ります。比較台の凡例と報告.csv の「表示中の値」は、その行の録音の答えの基準で書き、報告.csv の列の見出しは基準を名乗りません。入口の表で、フォルダの基準と違う行と stale の行の値は、その行の基準を値の横に書きます。CSV の絶対レベルの列は「dB(A)」と書かず（「Leq A特性」）、隣の列がその行の基準を書きます。まだ何も読んでいないとき、レベルの名前は基準を名乗らず（「dBFS」と仮定しない）、線のない軸は「[単位不明]」と書きます。中央値の線（基準群・チャンネルを合わせた線）は、そのすべての録音が校正済みのときだけ校正済みです。画面と報告は同じ定義（`medianInputOf`）を使います。手で入れたスペクトログラムの色の範囲は、入れた行と同じ同一性の行だけに効き、ほかの基準の行は自分の自動の範囲のままです。
- 集合の抜けも閉じます。チャンネルで分けた群はそのチャンネルの中央値、空の基準は n=0 と除いた理由を書き（n=1 にしない）、時間軸は長さが違っても同じ軸、比較の絵が計算中か失敗なら同一性はなしです。比べるチャンネルのない群の録音も、集合が理由（`no-channel`）とともに除きます。除いた録音と理由は見出しに書きます。
- テスト: `src/test/axisNames.test.ts` › no absolute level falls back to a bare "dB" unit anywhere in src (a default, ?? / || / ternary, or return): it names its reference, or says full scale (R4, R7, A50)
- テスト: `src/test/axisNames.test.ts` › every axis-name string, in every language, names its quantity and its unit (R4)
- テスト: `src/test/axisNames.test.ts` › no plot names an axis through gui-core's drawValueAxis or fittedAxisTitle, which keep only the unit when the name is long: every name is fitted by axisTitle.ts, quantity and unit (R4)
- テスト: `src/test/figureTicks.test.ts` › a value axis writes no two tick labels over each other, however short the plot: fewer ticks on a short one, each still at its own value (R4)
- どの UI テストでも、Figure が実際に書いた目盛りの数字のインクが重なると落ちます（`src/test/uiSmoke/canvasAudit.ts` の `__tickAudit`。1 回の描画の中で、数字だけの目盛りの文字の外接する四角どうしが重なれば報告する。単位や文字の付いた目盛りは見ない）。
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on two tick labels a Figure writes over each other, and on none that only stand close (R4)
- テスト: `src/test/axisNames.test.ts` › a CSV column's value axis names the unit its header gives, and says when it gives none
- テスト: `src/test/axisNames.test.ts` › a name too long for its axis keeps its quantity and its unit: smaller, on two lines, then its quantity shortened
- テスト: `python-backend/test_stage_view.py` › test_a_time_signal_names_the_measure_a_step_made_of_it
- 処理のあとの信号の値の単位は、wandas がチャンネルに付けた単位をそのまま使います（`stage_view.py` の `channel_unit`、段の説明の `unit`）。wandas 0.13.2 から、wandas が操作のたびに単位を決めます。累乗は単位を累乗し（`power(2)` は `Pa^2`）、2 つの信号の積は単位の積、指標は自分の単位（`sone`、`acum`、`asper`）、dB のレベルは wandas の言葉（`dB SPL re 2e-05 Pa`）です。アプリは操作の履歴をたどって単位を直しません。wandas が単位を名乗れないときは `''` で、軸は単位を名乗りません。
- 量（`measure`）は、wandas のレベルの種類（`ChannelCalibration.level`）と、測った手順から決めます（`stage_view.py` の `measure_of`）。種類が `power`（振幅の 2 乗、振幅どうしの積など）なら `power`（「パワー」）、`none`（wandas がレベルを決めない量。振幅の 3 乗など）なら `unknown`（「値 [単位不明]」）、rms_trend・sound_level のあとは `rms`・`timeWeightedRms` です。指標は単位で名前が決まります。振幅を 2 以外に累乗した量（「振幅の 3 乗」）は、wandas がレベルを決めないので、名乗りません。名前の文字は Python では作りません。`measure` と `measureExponent` を webview の `src/webview/figure/axisNames.ts` が `strings.ts` の `axisRaised`・`axisQuantityUnknown` で言葉にします。webview は単位の文字列を書き換えません。軸名も読み値も、送られた単位をそのまま書きます。`figureModel.test.ts` の構造検査は、式のすぐ後ろに累乗の記号（上付き数字、`^`）を書き足すコードを、構文木でどこでも見つけて失敗します。
- テスト: `python-backend/test_stage_view.py` › test_the_unit_of_a_signal_after_operations_is_wandas_own
- テスト: `src/test/figureModel.test.ts` › the structural check fails on each injected bug: every violation of class sweep 1 (reference, aggregation) and the first ones (an axis name, pending in n, two identities on one axis, a CSV header without its reference)
- テスト: `src/test/uiSmoke/spectrumOctaveBands.spec.ts` › the cursor spectrum names its level axis as Compare does, uncalibrated, and its lines in a legend
- Tracks の行の軸（振幅、スペクトログラムの周波数、時間）も、ほかの図と同じ部品（Figure）が、同じ目盛りの決め方・数字の書き方・文字・軸の名前で描きます。振幅の目盛りは、波形がその値を描く高さに置きます。
- 伝達関数は、2 つのチャンネルの単位が同じなら利得（「利得 [dB]」）、違えば単位の比を基準にした伝達レベル（「伝達レベル [dB re 2e-05 Pa/V]」）で描きます。比較台の段もペアの図と同じ決め方です（`stage_view.py` の `_transfer_rows`）。
- ペアの値は、両側が校正済みのときだけ校正済みです。1 つの録音の 2 チャンネルなら両方のチャンネル、基準スロットに対するペアなら録音と基準スロットの側で決めます。片方でも未校正なら、軸は「利得 未校正 [dB]」のように書きます（比較台の段もペアの図も同じ。`figureModel.ts` の `pairCalibration`、ペアの図はバックエンドの `calibrationStatus`）。ファイルから取り出した 1 チャンネルは、そのチャンネル自身の校正状態を名乗ります（`channelCalibration`）。入力がまだないとき、軸は「[単位不明]」と書きます。dBFS や FS を仮定しません。
- テスト: `python-backend/test_stage_view.py` › test_a_transfer_function_of_two_units_is_drawn_as_its_transfer_level_named_by_its_reference
- 右の 2 本目のレベル軸の数字も、軸の名前に重ねません。入らなければ全部を小さく書きます。時間軸の帯の名前も、ほかの軸の名前と同じく `fitAxisTitle` で合わせます。
- 軸名はキャンバスの中に書きます。どのグラフでも、狭くても低くても、軸名の文字がキャンバスの外に出ることはありません。保証するのは共通の部品です。軸に沿う向きは `fitAxisTitle`（`src/webview/figure/axisTitle.ts`）が、渡された長さより長い名前を返しません（小さく → 2 行 → 量を縮める、それでも入らなければ入るまで小さく。量と単位はどちらも落としません。フォントは切り上げません）。軸を横切る向きも、2 行になっても行がキャンバスの端とグラフの間に入るように、Figure が名前の中心を内側へ寄せます。グラフごとに直さず、共通の部品を直します。ブラウザの検査（`canvasAudit.ts` の `__titleAudit`）は、どのテストでも、グラフとその軸のキャンバスに書いた軸名（単位の角かっこで見分けます）の文字の箱が、そのキャンバスの中にあることを書いた時点で確かめます。新しい画面を足したら、`plotContract.spec.ts` の `NAME_SCREENS` に足して、狭い・低い大きさでも確かめます。
- テスト: `src/test/axisNames.test.ts` › a fitted axis name is never longer than the room it was given, at any size and on one line or two; and the font is never rounded up (R4)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on an axis name drawn outside the Figure's canvas, each line of a name on two lines too (R4)

## R5 色は役割を表し、役割のない録音は録音ごとの色

基準は青、比較 1 は黄、比較 2 は紫、比較 3 はマゼンタ、差は緑、手順バーに置いた手順のうち動かないもの（実行して失敗した、サンプルレートや値が合わない、前の手順が動かない）と、入口の表で読めない録音や CSV の行と合わない録音の理由はオレンジです（`src/shared/gui/roleColors.ts`）。役割のない録音は、録音ごとに自分の色（青緑・茶・オリーブ・砂色、役割・差・失敗の色と重ならない）を持ち、比較台でもトラック表示でもカーソルスペクトルとペアスペクトルでも同じ色です。どのピークがどの録音の線かを色でたどれるようにするためです。ほかの録音の役割が変わっても、録音が足されても色は変わりません。役割を付けると役割の色になります。解析窓の帯は灰色です。＋ で選べない操作はオレンジにせず、灰色にして理由を書きます（R8）。

- テスト: `src/test/uiSmoke/stageReturn.spec.ts` › in Compare, colour is the role's: a recording without one has its own colour, its name in the legend
- テスト: `src/test/uiSmoke/roleChips.spec.ts` › in the track view, each recording without a role has its own colour on its lane and its chip, as in Compare; a role gives it the role's colour
- テスト: `src/test/renderScript.integration.test.ts` › directory selection mode keeps an existing track and its own colour when a new earlier tree item appears
- テスト: `src/test/canvasOverlays.test.ts` › drawAnalysisWindowBand is a neutral grey, not a role's or the failure's hue, on a dark and a light lane (R5)
- テスト: `src/test/entrySlots.test.ts` › a recording beside the table is drawn in its role's colour, else its track's own, else the first own colour (R5)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the comparison draws its difference in the difference's green and its recordings in their roles' colours, neither in the other's nor the failure's orange (R5)
- テスト: `src/test/uiSmoke/trackStage.spec.ts` › a step that cannot run on these recordings says why: ＋ greys a 48 kHz-only step out, and a step failing on a file is marked with wandas' reason on the plot
- テスト: `src/test/uiSmoke/entry.spec.ts` › a picked CSV attaches its attributes by asd-insight's rules and lists what did not match with why (I5)

## R6 比較は重ね描き、線の順は決まった順

比較は dB の差ではなく重ね描きです。実線で、塗りつぶしません。線を描く順は、図の指定に書いた決まった順です。画面に見えているレベルでは並べ替えません（どの線が上かが拡大のたびに変わらないようにするためです）。

**比較台の重ね図。** 描く順は図の宣言に書いた順に固定です（`src/webview/charts/compareOverlay.ts`）：役割のない録音、基準（1 本の録音か群の中央値）、比較 1、比較 2、3。後に描いた線が上で、ポインターで読んだ線だけを最後に描きます。レベルでは並べ直しません。同じ距離の点を読むときは、宣言の先の線を取ります（`python-backend/figures/pick.py`）。帯域、時間信号、トリガーのイベントの線も同じ宣言の順です。
- テスト: `src/test/compareOverlayFigure.test.ts` › the overlay's spec declares its lines in the order they are drawn: no role, the base, compare 1, 2, then the Δ lane of compare 1 − the base (仕様 1)
- テスト: `src/test/uiSmoke/figureOverlay.spec.ts` › the spectrum overlay is one Figure on the new path: the old overlay and Δ canvases are not shown, its lines are in the declared order and the roles' colours
  - このテストは、Figure が言う順（`inspect()`）だけでなく、キャンバスに実際に線を引いた順（基準、比較 1）も確かめます。

線を重ねる図（比較台の重ね図、カーソルスペクトル、ペアの図）は、どれも図のサービスの絵を Figure が描きます。線を描く順は図の指定の順（Tracks では行の順）で、レベルでは並べ替えません。色は役割の色のままで、順によって変わりません。マウスで強調した線は、この順とは別に、上の層に太く描きます。



## R7 ポインタの動きはどのグラフでも同じ

カーソル、最寄りの線の強調、読み値、拡大の操作は、どのグラフでも同じ部品で同じように動きます。マウスは、どの線の点でも、縦横の距離でマウスに一番近い点（半径 20 px 以内）を読みます。細いピークの少し横に置いても、頂上の近くなら頂上を読みます。半径の中に点がなければ、マウスの真下の周波数（時刻）で高さが一番近い線を読みます。← / → は、マウスの下（またはキーボードで選んだグラフ）で読んでいる線の、間引く前のデータの次の点（ビン、帯、サンプル、熱図やスペクトログラムの次のフレーム）を、マウスをその点に置いたときと同じに読みます。1 ピクセルに何点重なっていても、どの拡大でも 1 点ずつ進みます。どのグラフでも同じ部品（Figure、`src/webview/figure/figure.ts`）が受け、次の点は図のサービスが答えます（`figures/pick.py` の `StepAsk`）。ただし、キーボードのフォーカスがあるレーン（クリックしてカーソルを置いたレーン）では、マウスがそのレーンに乗っていても、← / → は再生の時刻カーソルを動かします。これは読み取りではなく再生の操作（聞く位置を動かすこと）だからです（下の「キーボードのフォーカスの例外」）。キーで読み値を 1 点ずつ進めるのは、マウスの下のグラフ（どのグラフでも）で押す ← / → と、フォーカスできるレーンでないグラフ（今はカーソルスペクトルと 2 本を比べる図。どちらも図の部品が描き、Tab で選べます）にフォーカスがあるときの ← / → です。フォーカスしたレーン以外のレーンも、マウスの下なら ← / → で読み値を動かします。カーソルスペクトルとペアの図は、読んだ点の周波数でたがいのカーソルを合わせます。トラック表示の波形のレーンも同じで、マウスの下のレーンだけが点を読み（時刻は目盛りと同じ全体の時間軸）、ほかのレーンはその時刻に線を引きます。スペクトログラムのレーンは、ほかの色の図と同じく、マウスの下のマスの時刻・周波数・レベルを読みます。クリックで決めるカーソル（カーソルスペクトルの時刻と解析窓）はこれとは別です。ただし、クリックがカーソルを置く時刻は、マウスの画素の時刻ではなく、押したときにレーンの読み値が読んだ点の時刻です。読み値が何も読まないとき（解析のあとでファイルが変わったレーンなど）は、マウスの時刻です（R13 の「クリックは、読み値が読んでいる点に効きます」）。

**読んだ点には十字の線を引きます。** 読んだ点を通って、段の上から下まで縦の破線を、左から右まで横の破線を引きます（横の線は読んだ線の色）。点だけでは、横軸と縦軸のどこにあるかを目で追えないからです。線の図でも、色の図（スペクトログラム、熱図）でも同じです。棒の図（分布）は、棒そのものが位置を示すので引きません（`src/webview/figure/figure.ts` の `mark.cross`）。

- テスト: `src/test/figureComponent.test.ts`（読み値の記録の各場面）、`src/test/figureImageLane.test.ts`、`src/test/figureBinsLane.test.ts`

**比較台のスペクトルの重ね図（第 1 節の帰結と仕様 4）。** 読む点は図のサービスが選びます（半径 20 px の規則は同じ、`python-backend/figures/pick.py`）。読み値はポインターが動くたびに 1 往復し、届くまでは前の読み値と印を出したままにします。図が描き直されるとき（指定範囲、大きさ、図の宣言、答えの版が変わったとき）は、新しい絵が届くまで読み値と印を消し、読む要求も送らず、その間のキーも点を動かしません。届いたら、キーで選んでいた点をその名前で読み直し、なければポインターの位置で読みます。読み値を待っている間に図が描き直されるか取り除かれたら、そのクリックは実行しません。Web 版では、長い計算（走査、手順の再計算、書き出し）の最中は読み値を「計算中」と出し、点を指すクリックも実行せず、終わったらポインターの位置で読み直します（`src/webview/answers/longComputations.ts`）。VS Code 版はこれまでどおりです。
- テスト: `src/test/uiSmoke/figureOverlay.spec.ts` › a hover reads a real bin at its exact value, the mark on it, and the arrow keys step one bin per key (R7)
- テスト: `src/test/compareOverlayFigure.test.ts` › a scan and a recipe analysed again are long computations, each until its answer or a newer one of its kind (spec 4)

- **キーボードのフォーカスの例外（← / →）。** ← / → が読み値を動かす決まりの例外は 1 つだけです。トラック表示のレーンにキーボードのフォーカスがあるとき（クリックしてカーソルを置いた、Tab で選んだ）は、マウスがそのレーンに乗っていても、← / → は再生の時刻カーソルを動かします。1 回で今の拡大の窓の 1 画素ぶん、Shift を押すと 0.1 秒です（`shortcuts.ts` の `keydownIntent` と `arrowCursorStep`）。理由：これは読み取りではなく再生の操作です。レーンにフォーカスを置くのは、聞く位置を決めるためです。その場で ← / → で聞く位置を細かく動かすのは聞き比べの基本の操作で、フォーカスしたレーンのキーが読み値に取られると、その操作がなくなります。読み値をキーで進めたいときは、グラフにマウスを乗せるか、カーソルスペクトルにフォーカスを置いて ← / → を押します。フォーカスのないレーン、ほかのレーン、レーンでないグラフでは、← / → はいつもどおり読み値を動かします。
- この例外を作るのは、図の部品の 1 つの口だけです（`figure.ts` の `pressFocuses`。トラックの行の図だけがこれを指定し、押すとその行のキャンバスにフォーカスが移り、フォーカスがある間は ← / → を読み値に回しません）。ほかのグラフに同じ例外を足すときは、この段落と下のテストを一緒に変えます。グラフごとにキーを横取りして作りません。
- テスト: `src/test/shortcuts.test.ts` › keydownIntent moves the time cursor with arrows only while a track canvas has focus (R7)
- テスト: `src/test/shortcuts.test.ts` › R7 states the keyboard-focus exception these tests hold, with its reason (transport, not reading) and where keys read instead
- テスト: `src/test/shortcuts.test.ts` › arrowCursorStep moves one pixel of the zoomed view, or 0.1 s with Shift (R7)
- テスト: `src/test/figureComponent.test.ts` › a Figure that takes the focus at a press leaves ← → to the screen while its canvas has the focus; without the focus they step its readout (R7)

読み値の数字は、どのグラフでも間引く前のデータから読みます。間引いたデータは線や絵を描くためだけに使います（R1、R2）。どの図（比較台のすべての図、入口の分布図、Tracks の行、カーソルスペクトル、ペアの図。一覧は `docs/figure-list.md`）も、図のサービス（`python-backend/figures/`）が全解像度の答えから読む点を選び（`figures/pick.py`）、Figure（`src/webview/figure/`）がそれを書きます。webview は点の一覧を持たず、点を選びません。マウスが読む点も ← / → が進む先も、描いた点ではなく全解像度の点です。間引いて線から消えた点も、マウスに一番近ければその点の値を読みます。熱図とスペクトログラムは、画面のために平均したマスではなく、本当のマス（1 フレーム・1 ビン）の値を読みます（`pick.py` の `pick_cell`）。Tracks の行の波形は、サンプルを 1 つずつ読みます（`pick_sample`）。読みはポインターが動くたびに 1 往復し、Figure はポインターの位置と画面の縮尺を送り、返ってきた 1 点だけを書きます。← / → は読んでいる点の名前から、押した回数ぶん先の値のある点を 1 回の往復で聞きます。値のない点（無音）がどれだけ続いても 1 回で越えます。縦軸を拡大して軸の外に出た点も、← / → は止まらずに 1 点ずつ進み、図の上下の端で読みます（マウスがどの点を読むかは、下の表の決まりです）。新しい絵が届くまでは読み値を出しません。届く前のクリック（トリガーのイベントの線を外す・戻す）は捨てず、届いてから決めます（その間に次の押下やダブルクリックがあれば、そちらが代わります。`src/webview/figure/pendingClick.ts`）。

読み値は、どのグラフでもグラフに重ねず、グラフの外の決まった行に出します。重ねると、読みたい線のまわりが隠れるからです。読み値は、グラフのすぐ上の行に出します。比較の図は操作ボタンの行、その下の差の欄は差の見出しの行、トリガーのイベントの図の下に並ぶレーンはそのすぐ上の読み値だけの行、カーソルスペクトルとペアの図はそれぞれの見出しの行、見出しの行がない Tracks の行はツールバーの行です。どの図も Figure（`src/webview/figure/`）が図のサービスの読み値を書きます。この行は空のときも場所を取っておくので、マウスを乗せてもグラフは動きません。比較の図のこの行には、差が最大の点（見出し）は出しません。数字はマウスの読み値だけにして、どの数字が何かを迷わないようにします。Δ を押して開く差の欄は別で、その見出しには差が最大の点（差が出せないときはその理由）を出します。差の欄は差そのものを見る場所だからです。名前が長いときは名前の側を省略し、時刻（周波数）と値は省略しません。行の幅が足りないときは、読み値はボタンの下の段に移ります（グラフの上のままです）。値が行や画面の端からはみ出すことはありません。この決まりは UI テスト全件で確かめます。どのテストでも、読み値がグラフに重なって表示されたり、値が行や画面の端で切れたりしたら、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。

読み値と見出しの数字は、どのグラフでも同じ書き方です（`src/webview/shell/numberText.ts`）。周波数は 1 kHz 未満は Hz（整数でないときは小数 1 桁）、1 kHz 以上は kHz で 1 Hz まで（「1.016 kHz」「3.15 kHz」）書きます。ビンの間隔が 1 Hz より細かいときは、その間隔を見分けられる桁まで書く（0.73 Hz 間隔なら「1.0027 kHz」）ので、隣のビンが同じ数字になりません。レベルは 0.1 dB まで単位付き（単位はそのレベルの軸やカラーバーと同じ基準の「dBFS」「dB SPL re 20 µPa」で、素の「dB」は差だけ）、時刻は秒で、少なくとも 10 ms まで、点の間隔が細かいときはその間隔を見分けられる桁まで書きます（48 kHz で 256 ずつの熱図の列、5.3 ms 間隔なら「1.008 s」「1.013 s」）。ほかの値は大きさによらず有効数字 3 桁です（「12.3」「1230」、100 万以上と 0.001 未満は指数）。桁の決め方は 1 つで、隣の点（サンプル・ビン・フレーム・ラグ）や隣の目盛りと同じ数にならない桁まで書きます（`numberText.ts` の `spacingDecimals`）。波形の時刻はサンプルの間隔から、ケフレンシーとラグも点の間隔から、軸の目盛りは隣の目盛りとの間隔から（対数の周波数軸を狭く拡大したら窓の中の切りのよい値に目盛りを置き、「1.002k」のようにその位置の値を書く。1 kHz をまたぐ 10 倍未満の窓は全部 k で書き、「1000」と「1k」を混ぜない）、値の軸の目盛りは指数で書くときも隣の目盛りを見分けられる有効数字まで（0.0897 の付近を数百万分の 1 に拡大しても「8.96728e−2」「8.96730e−2」）、軸の範囲の入力欄は範囲の幅の 1/1000 まで、CSV とレポートの領域の始めと終わりは区間の表記と同じく 10 ms まで、短い区間では長さの 1/10 を見分けられる桁まで書きます。桁の上限（時刻・周波数の目盛りは 9 桁）より細かい窓では、同じ数の目盛りを 2 つ書かず 1 つにまとめます。軸の種類と拡大の段階を格子で総当たりして、隣の目盛りや隣の点が同じ数にならないことを単体テストで確かめます（`src/test/plotText.test.ts`）。ラグ・ケフレンシー・Bark・符号付きの差も同じファイルの書き方で、ラグとケフレンシーは軸の名前と同じ秒で書きます（「+0.00125 s」「0.0125 s」。軸が [s] なのに読み値を ms で書かない）。入口の分布図の読み値も表の列の書き方ではなくこの決まりで書きます（ピーク周波数は「3.15 kHz」）。分布図のビンの範囲と読み値は、ビンの幅を見分けられる桁まで書くので、隣のビンが同じ数字になりません。負の数はハイフンではなく本物のマイナス記号（−）で書きます。マイナス記号を手で付けるコード（ハイフンの置き換えや、`'−'` だけの文字列で符号を選ぶもの）は lint で止めます（`scripts/lint-webview-patterns.js`）。Markdown のレポートと、それが比較台と共有する書式（`src/shared/report/`、`src/shared/utils/format.ts`）も同じで、数を文字にするときは `numberText.ts`（`levelText`、`withMinus`）を通し（「−1.8 dBFS」）、通さずに `toFixed` などで書く行は同じ lint で止めます。

セル（熱図の列と行）と棒の区切りは、どのグラフでも 1 つの規則（`figures/thinning.py` の `cell_edges`）で決め、描く絵、マウスが読むセル、← / → の先が同じ区切りを使います。対数軸では隣り合う 2 点の幾何平均（√(f1·f2)：100 Hz と 125 Hz の境は 112.50 Hz ではなく 111.80 Hz）、線形軸では中点です。帯の間隔が一定でなくても、棒は自分のセルの幅に描きます（`thinning.py` の `drawn_bars`）。

単位は読み値と見出しから落としません（数を書くのは `src/webview/shell/numberText.ts`）。dB でない熱図（ラフネスの asper/Bark など）の値も、dB でない量の Δ（「+0.300 Pa」）も、その単位で書きます。

縦軸を拡大して線の一部が画面の外に出ているときに、マウスがどの点を読むかは、どの種類の線（波形、スペクトル、レベルの時間変化、Δ の線）でも次の 1 つの決まりです。決まりを置く場所は 1 か所で、図のサービスの `figures/pick.py` です。

| 読む点 | いつ読むか | どの点か | 値が軸の外の点 |
|---|---|---|---|
| 一番近い点 | 半径 20 px の中に点があるとき | 値が画面に見えている点（`shown` の範囲の中）のうち、画面の上の距離でマウスに一番近い点 | 候補にしません。描かれていない点を「近い」として選ばないためです |
| マウスの下の点 | 半径の中に点がないとき | ピックの窓とその外の 1 点ずつの中で、横軸の上でマウスの位置に一番近い、値のある点。値がいくつでも同じです。その中に値のある点がなければ、下の「値のない区間」の決まりです | その点を読みます。印は図の上下の端に置き、読み値には本当の値を書きます（← / → で進んだときと同じ） |

- 「一番近い点」を画面の中の点に限るのは、軸の外の点を候補にすると、画面の中の本当の最寄りの点を読み落とすからです（`pick.py` の `_near`）。
- 「マウスの下の点」を値で絞らないのは、絞ると、マウスの真下の点の代わりに横にずれた別の点を読むからです（`pick.py` の `_under`）。
- この決まりを変えるときは、まず下のピックの表の行を足すか変え、`figures/pick.py` を変えて、表のテストと下の線のテストを通してください。線の種類ごとの分岐は足しません。

マウスが読む点と ← / → が進む先の決まりの定義は、1 つの表 `python-backend/tests/fixtures/pick_cases.json` です。上の表と文はその説明で、食い違うときは表が正しく、説明を直します。表の 1 行は、線の点（x と値。値のない点は null・NaN・±∞）、値の線か無音の床のあるレベルか（`plain`）、表示（横軸の範囲と線形・対数、値の範囲、図の枠の画素）、マウスの位置（枠の左上からの画素）か読んでいる点の番号（`from`）、読み方（`nearest`：半径の中の一番近い点、`under`：マウスの下の点、`click`：そこでのクリックが効く点、つまり読み値が読む点、`step+` / `step-`：→ / ←）と、読む点の番号（なければ null。値のない区間の上で「ここに値はありません」と答えるときは `empty` も）です。図のサービスが、表の全行をテストで通します（`python-backend/test_figures_pick.py`）。点を選ぶのは図のサービスだけなので、webview の側に同じ表を通す実装はありません。表には、同じ距離の 2 点（データの順で先の点）、同じ x で値の違う点（← / → は `from` から隣の点へ）、拡大した値の軸の外の点、±0.001 と ±10⁶ の値の範囲、対数の横軸、値のない点と無音の床、窓より長い・短い値のない区間、線の両端を入れています。表の 1 行は 1 本の線なので、棒のビンの境や概観帯の行の境は表せません。それはブラウザの契約（`plotContract.spec.ts`）と各図のテスト（R13 の「クリックは、読み値が読んでいる点に効きます」）が確かめます。

- 決まりどおりにまだ動かない行は、`today` に今の答えと、それを変える作業を書きます。その行は今の答えを確かめ、決まりどおりに直るとテストが失敗して `today` を消すよう求めます。今はありません。
- 値が有限でない点（NaN、±∞）は値のない点です。マウスの下でも ← / → の先でも読みません（`pick.py` の `_readable`）。
- **値のない区間（ギャップ）の決まり。** 値のない点（有限でない値、レベルの線では無音の床も）が続く所は線のギャップです。(1) マウスは、これまでどおりピックの半径の中の一番近い点、なければピックの窓（とその外の 1 点ずつ）の中のマウスの下の値のある点を読みます。窓より短いギャップは、その上にマウスがあっても飛び越えて、窓の中の値のある点を読みます。(2) マウスの下がギャップの中で、窓の中に値のある点が 1 つもないときは「ここに値はありません」という答えです。点は読まず、点の印（太い線、値の線）も出さず、カーソルだけを出し、読み値の行には言葉で書きます（`strings.plotNoValue`「— ここに値はありません」）。読み値の行が空なのは、絵がまだ届いていないときだけです。空の行とこの答えを取り違えないためです。線の最初の点より左、最後の点より右はギャップではなく、線の外です（読み値は出しません）。図のサービスが見分けて `no-value` と答え（`pick.py`）、Figure が書きます。(3) ← / → は値のある点から値のある点へ進み、ギャップは長さによらず 1 回で越えます。値のない点には止まりません（`pick.py` の `_step`）。(4) 描いた線はギャップで切れます（R2）。表の行は、窓より長いギャップの上（`empty`）、窓より短いギャップの上、窓より長いギャップを越える → と ← です。
- マウスの下の点は、ピックの窓（左右 20 px）と、その外の 1 点ずつから探します（`pick.py` の `_under`）。線の最初の点より左、最後の点より右に半画素より外では、マウスの下の点はありません。
- UI テストの ← / → の確かめ（`src/test/uiSmoke/plotContract.spec.ts` の `expectFigureContract`）は、→ で読んだ点の番号が 1 つ進み、← で元の点に戻ることを、Figure が言う読み値（`__figureInspect`）で確かめます。次の点がどれかという決まり（値のない点と無音の床を飛ばす、同じ x の隣の点、熱図の次の列）は、図のサービスのテストが、答えの分かっているデータで確かめます（`python-backend/test_figures_pick.py`、事例は `python-backend/tests/fixtures/pick_cases.json`）。実装に期待を聞くと、実装のデータが間違っていても一致してしまうからです。分布図は、テストが数を知っている分布を開き、← / → で棒（数のあるビン）と録音（下の目盛り）を端から端まで 1 回に 1 つずつ進み、棒ごとに中心・範囲・数を、同じ値の録音は 1 回ずつデータの順（値、次にキー）で読むことを、拡大の前と後で確かめます。
- テスト: `python-backend/test_figures_pick.py` › test_every_pick_case_is_read_by_the_figure_service_as_the_table_says
- テスト: `python-backend/test_figures_pick.py` › test_a_read_returns_its_one_point_and_a_step_moves_a_signed_count_of_points_with_a_value_inside_the_range
- テスト: `python-backend/test_figures_distribution.py` › test_a_zoom_keeps_the_bins_and_reads_only_what_is_on_screen
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)

読み値の時刻・周波数の桁は、元のデータの刻み（その点と、元のデータで隣の点との間隔）から決めます。刻みは、図のサービスが読んだ点に付けて送ります（`pick.py` の `data_step`）。Webview は、描いた点どうしの間隔から桁を作りません。描いた点の間隔は元の刻みよりずっと粗いので、隣のサンプルと同じ数字になるからです。答えに刻みがない点（1 点しかない線など）は、刻みなしとして書きます。

- テスト: `src/test/plotText.test.ts` › a frequency reads in Hz below 1 kHz and in kHz to the hertz from there, so neighbouring bins never read the same (R7)
- テスト: `src/test/plotText.test.ts` › a frequency read among points finer than 1 Hz apart gets the digits that tell neighbouring bins apart (R7)
- テスト: `src/test/plotText.test.ts` › a level reads to a tenth of a decibel in its unit, a time in seconds, other values to three figures (R7)
- テスト: `src/test/plotText.test.ts` › every value has three significant figures however large: no false tenth and no exponent below a million (R7)
- テスト: `src/test/plotText.test.ts` › a quefrency and a lag read in the unit their axis is named in: seconds, as the axis says [s] (A36, R4, R7)
- テスト: `src/test/tableValueText.test.ts` › a very small table value is written with its exponent, to the digits that tell values a bin apart
- テスト: `src/test/plotText.test.ts` › the lint stops a minus sign picked by hand, as a lone string or a replaced hyphen (R7)
- テスト: `src/test/plotText.test.ts` › the lint stops a number the report writes without plotText's minus: "-1.8 dBFS" (R7)
- テスト: `src/test/trackPointerEvents.test.ts` › ← / → step the readout of the plot under the pointer, or of a focused one; off every plot they go on (R7)

読み値の状態遷移は、どのグラフでも 1 つの部品（Figure、`src/webview/figure/figure.ts`）が決めます。Tracks の行（波形もスペクトログラムも）も同じ部品で読み、進み、待ちます。決まりは次のとおりです。(1) 図の指定、指定した範囲、大きさ、答えの版が変わるたびに新しい絵を頼み、届くまでは何も読まず、読んだ点の印も出しません。範囲や大きさだけが変わったときは、届くまで前の絵の点を新しい範囲に描いておきます。(2) 読み値は、今の絵への一番新しい読みの返事です。← / → のあとで届いた古いマウスの返事は使いません。(3) 選んだ点は 1 つのもの（段、線、録音のキー、答えの版、番号）で、別の絵・別の録音・古くなった答えの点は出さず、それに効くこともしません。(4) webview は点の一覧を持ちません。← / → は図のサービスへの読みで、返事を待つ間に押したキーは数として足し、届いたら 1 回で進みます。(5) 描き直しのあと、← / → で選んでいた点は名前で読み直し、なければマウスの下を読みます。その点が窓の外に出たら選んだ点を捨てます。描いた枠の外の点を読むことはありません。(6) ← / → がデータの端・拡大した窓の端で進めないときも、キーはそのグラフのもので、別の面へは流れません。(7) 値が「値」（波形、指標の時系列、その Δ）の線は −250 以下も値として 1 点ずつ進み、→ と ← は同じ点を通ります。無音の床があるのはレベルとゲインの線だけです（`figures/levels.py`）。(8) 同じ値の点（分布図で値が同じ録音など）も、← / → は 1 点ずつ、どの点も 1 回だけ、決まった順（値の順、同じ値の中では録音のキーの順）で通ります。(9) 選択は見た目だけを変えます。範囲を選んでも、← / → が通る点は変わりません。(10) 矩形ズーム・Alt+ドラッグ・Shift+ドラッグの間は読み値を消し、離したらその位置で読みます。離した知らせが届かないドラッグ（ページの外でボタンを離した、ウィンドウがフォーカスを失った・隠れた、ポインタが取り消された）は、その場で何もせずに終わらせます。終わらせないと「ドラッグ中」のままになって、どのグラフも読み値を出さず、キーも受け取らなくなるからです。押下の調停はページに 1 つです（`src/webview/figure/pressArbiter.ts`）。
- テスト: `python-backend/test_figures_distribution.py` › test_the_arrow_keys_pass_rows_of_one_value_one_by_one_and_a_row_is_named_by_its_key
- テスト: `src/test/figureBinsLane.test.ts` › a row read is no longer shown once the picture has another row there
- テスト: `src/test/uiSmoke/readoutTransitions.spec.ts` › the browser table holds a row for each chart the readout runs on, by its full name, and each real path R7 names
- テスト: `src/test/plotInteraction.test.ts` › a drag whose release never reaches the page ends there with nothing done: every plot reads and takes keys again, and no box is zoomed into (R7)
- テスト: `src/test/plotInteraction.test.ts` › a lost release tells the press's owner it ended: an Alt+drag is ended where it last was, and a plain press is told it is no click (R7)
- テスト: `src/test/trackPointerEvents.test.ts` › an arrow over a plot that cannot step (nothing read, an end, the edge of the window) is the plot's all the same: it never goes on to another surface's cursor (R7)
- テスト: `src/test/trackPointerEvents.test.ts` › the focus leaving a plot takes away only a readout the focus gave: the pointer on another plot of the surface keeps its readout (R7)
- テスト: `src/test/plotInteraction.test.ts` › a drag under way reads nothing, and let go (a box zoom, Alt+drag, Shift+drag) the readout is the pointer's where it was let go, never where it was pressed (R7)
- テスト: `src/test/figureBinsLane.test.ts` › a bar reads its group, its bin's ends and its count; a click on it tells the screen that bin's range
- テスト: `src/test/trackPointerEvents.test.ts` › a lane with the keyboard focus keeps ← / → for its time cursor, even with the pointer on it; the pointer on another lane steps that one's readout (R7)
- テスト: `src/test/uiSmoke/figureOverlay.spec.ts` › a hover reads a real bin at its exact value, the mark on it, and the arrow keys step one bin per key (R7)
- テスト: `src/test/uiSmoke/trackLaneHover.spec.ts` › the pointer on a track's waveform reads the point nearest it as every plot of lines does: name, time and amplitude in the toolbar, gone off the lane (R7)
- テスト: `src/test/uiSmoke/trackLaneHover.spec.ts` › every ui-smoke test fails on a hover readout shown over a plot, whichever plot and readout it is (R7)
- テスト: `src/test/uiSmoke/trackLaneHover.spec.ts` › the lane readout keeps its room in the toolbar, so a hover never wraps it and moves the lanes; short of room, the name is cut, never the values
- テスト: `src/test/uiSmoke/trackCompare.spec.ts` › the comparison's step bar grows the chain with ＋, offers only what takes the Frame there, and the plot answers the lanes' gestures
- テスト: `src/test/trackStagePainter.test.ts` › the headline names no difference (the row holds the pointer's readout): the steps bypassed and the region; nothing while computing
- テスト: `src/test/uiSmoke/trackCompare.spec.ts` › the readout row above the comparison keeps the values whole at any width, with the base group's button in it, and a hover never moves the plots
- テスト: `src/test/stageViewKinds.test.ts` › every Frame kind a step from ＋ can give that the app draws has its backend picture in the fixture the plot contract is run on (R7)
- テスト: `python-backend/test_stage_view_kinds.py` › test_the_frame_kinds_fixture_is_what_the_backend_says_now
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › a ${kind} reached from ＋ answers the same gestures as every plot, overlaid, as its Δ and in lanes (R7)

Webview は全データの集まり（線の全部の値、マスの全部の行）を持ちません。読み値・← / →・CSV の数は、図のサービスが処理部に取り置いた答えから作ります。描く点は型 `FigureDrawn` で、受け取れるのは `src/webview/figure/` だけです。数として計算することも文字にすることもできません（ESLint の `no-restricted-imports`、`docs/plot-layers.md` の Layer 4）。Webview がそのほかに受け取る数は、バックエンドが 1 つの数として答えたものだけです（領域のピーク：`src/webview/runtime/regionPeak.ts`、`AnalysisService.region_peak`）。

- 描く点（`x-drawn`）の配列を「たまたま全部だから」と全データにする口はありません。カーソルスペクトルと 2 本を比べる図は、値を webview に送りません。全ビン（帯）の線は処理部が鍵つきで取り置き（`tracks_answers.py`）、読み値と CSV は図のサービスがその線から作ります。比較台の棒（帯の表）は、ほかの絵と同じく段の鍵（`data`）で全データを取り寄せて読みます。鍵のない絵は全データがなく、読み値を出しません。
- この規則のテストが失敗したら、型か口を広げて通すのではなく、上の作る関数のどれかで全データを作ってください。何をすればよいかは `docs/plot-contracts-guide.md`（"Adding a number a user reads"）にあります。
- テスト: `src/test/guideExamples.test.ts` › every code block of the plot contracts guide compiles against the code as it is, and each line it says the compiler refuses is refused
- テスト: `python-backend/test_tracks_answers.py` › test_the_two_commands_answer_keys_and_no_value

- テスト: `src/test/uiSmoke/trackRowFigures.spec.ts` › a row boxed to a narrow band draws that band's own bins from the answers kept, with nothing more asked (R3)

## R8 ＋ で選べる操作は結果を描く

＋ に出る操作は、選ぶと必ず結果のグラフが出ます。その録音で動かない、または意味のある結果にならない操作は、灰色にして理由を書きます。置いたあとに動かなくなった手順や、実行して失敗した手順は、オレンジで印を付けて理由を書きます。実行して失敗したときは wandas の理由です（R5）。

- テスト: `src/test/uiSmoke/trackStage.spec.ts` › a step that cannot run on these recordings says why: ＋ greys a 48 kHz-only step out, and a step failing on a file is marked with wandas' reason on the plot
- テスト: `python-backend/test_operation_catalog.py` › test_no_step_offered_on_a_recording_draws_a_flat_picture
- テスト: `python-backend/test_operation_catalog.py` › test_after_a_metric_the_steps_that_fail_on_its_series_are_refused
- テスト: `python-backend/test_operation_catalog.py` › test_the_step_bars_metric_rates_are_the_ones_wandas_gives
- テスト: `src/test/recipeSteps.test.ts` › after a metric, a filter or an FFT is judged at the metric's series rate and length, not the recording's

## R9 自動の範囲は切りのよい値

カラースケールや dB 軸を自動で決めるときは、端を切りのよい値に広げます。dB でない量（ラフネス、ケプストラム、係数など）の色と値の範囲も、入口の分布図の値軸も同じです。手で入れた値はそのままです。

**比較台のスペクトルの重ね図。** 自動の端は図のサービスが決めます（`python-backend/figures/ranges.py`）。範囲の入力欄やズームで指定した端は、Webview がこれまでの規則（`fieldWindow`、`src/webview/figure/fieldWindow.ts`）で作り、図のサービスはそれを丸め直さずにそのまま使います。123.456789 Hz と打てば、確定範囲は 123.457 Hz です。
- テスト: `src/test/uiSmoke/figureOverlay.spec.ts` › a range typed in the axis's popover is the confirmed range today's rule makes, taken by the figure service as given (R9)

自動の範囲の端は、描くために間引いた点や平均したマスではなく、全データ（間引く前のすべての点・すべてのマス）の最小と最大から決めます。dB の熱図（トラックのスペクトログラム、比較の熱図、入口の一覧の帯）の自動の色の範囲は、丸めたあとの幅が 100 dB を超えません。上は全データの最大を切りのよい刻みへ上に丸めた値、下は全データの最小を同じ刻みへ下に丸めた値ですが、丸めた上の端から 100 dB より下にはしません（`python-backend/figures/ranges.py` の `colour_range`）。−240〜−0.4 dB は −100〜0 dB で、−105〜0 dB ではありません。デジタル無音（−240 dB や −300 dB）があっても、下の端はそこまで下がりません。上を先に丸めてから 100 dB で止めるのは、丸める前に 100 dB で止めると、丸めで両端が広がって 100 dB を超える（−100.4〜−0.4 が −105〜0）からです。dB の線の軸も同じく、上を全データの最大、下を max(全データの最小, 上 − 100 dB) として、両端をそれぞれ外へ切りのよい刻みに丸めます（刻みの上にある端はそのまま）。刻みは 5・10・20・25 dB のうち 6 目盛り以下になる一番細かいもので、両端の余りは 1 刻みまでです。ただし幅は 100 dB を超えません。丸めた上の端から下へちょうど 100 dB で止めます（−149.5〜−9.5 dB は −100〜0 dB、−100〜0 dB はそのまま）。100 dB の中の全データの値が軸の外に出ることはなく、余白で図の半分を使うこともありません（−49.5〜−9.5 dB は −50〜0 dB）。
- 目盛りの数はどれも、その数を絵が描く位置に書きます。熱図の行の軸でも、どの拡大でも同じです（R14「目盛りは、その数を絵が描く位置に置きます」）。

- テスト: `python-backend/test_figures_heatmap.py` › test_the_brightest_drawn_cell_is_the_answers_highest_level_on_screen
- テスト: `python-backend/test_figures_images.py` › test_a_colour_range_is_decided_by_what_the_cells_measure

- テスト: `src/test/uiSmoke/colourRangeRounding.spec.ts` › the auto colour scale opens with round dB ends, and typed ends are kept as typed
- テスト: `python-backend/test_figures_distribution.py` › test_the_axis_the_rows_the_counts_and_the_placement_are_the_old_pictures

カラーバーの両端の数は、そのカラースケールそのものです。書いた数を読み戻した値（本物のマイナス「−」をハイフンに戻して読む）が、色を塗った端と同じ数です。画面でも、書き出す図でも同じです。

- 自動の色の範囲は、図のサービスが 1 か所で決めます（`figures/ranges.py` の `image_colour`、dB は `colour_range`）。dB の絵は、上の端を答えの一番高い値から切りのよい目盛りへ切り上げ、下の端は切り下げます（幅は丸めたあとで最大 100 dB）。符号つきの絵（ケプストラム）は 0 を中心にして、絶対値を同じく外へ広げます。ほかの値（ラフネス）は、値の幅の 5 % の余白を足して切りのよい端にします。
- マスの色、カラーバーの帯、両端の数、範囲の入力欄は、絵が確定したこの範囲だけから描いて書きます（`src/webview/figure/imageLane.ts`）。塗る範囲と書く数が食い違うことはありません。書く関数は書くだけで、数を丸め直しません。
- 手で入れた端（⚙ の設定、範囲の入力欄）は、入れたとおりの数で塗ります（図のサービスは指定された端を丸め直しません）。書くときは、その数に読み戻せる一番短い書き方にします（「1000000.5」）。
- 範囲の入力欄はどれも、軸を描いた端をそのまま書きます。書く関数は 1 つ（`src/webview/shell/numberText.ts` の `exactFieldText`：読み戻すとその数になる一番短い書き方）です。入力欄は数を入れる所なので、長いことを理由に丸めません。波形の振幅、スペクトログラムの周波数（箱で拡大したときも）と色、行の時間、カーソルスペクトルの周波数・dB、ペアの図、比較台、入口の図と分布図の、横の軸も縦の軸も同じです（開くのは `shell/rangePopover.ts` の `openAxisPart`、入れた数を窓にするのは `figure/fieldWindow.ts`）。
- 書く数が長くなるのは、範囲そのものが計算のかけら（拡大の窓の割合×幅、振幅の割合×ピーク、自動の範囲）のときです。そのときは文字ではなく範囲を、作る場所で入力欄の桁にします（`src/webview/figure/fieldWindow.ts` の `fieldWindow`、`figureModel.ts` の `laneAmplitudeRange`）。自動の振幅の範囲は、入力欄が書く桁まで外へ広げます（ピーク 0.73 なら ±0.830。0.8295454… から描いて「0.8295」と書くことはしません）。拡大した窓の端は、入力欄が書く桁（窓の幅の 1/1000、最低 0.001）に丸めてから描きます。どの図も Figure（`src/webview/figure/`）が描き、範囲の欄には絵（図のサービスの返事）の端をそのまま書きます。そのため、拡大した窓に手で入れた数も、その桁までで描いて書きます。窓の幅の 1/1000 より細かい桁は丸めます。それでも、書いた数と描いた数は同じです。
- 入力欄をそのまま適用すると、範囲は変わりません。端ごとに、入れた数が欄に書いた数と同じなら（`value === shown`、文字でなく数で比べる）、その端の設定（自動、拡大の窓、ナイキストに合わせた上の端）をそのまま残します。
- 範囲の入力欄に数を書くコードは、`exactFieldText` 以外で書かず、そこへ届く数を `figureModel` の外で丸めません（`toFixed`・`toPrecision`・`toExponential`・`Math.round` など）。`src/test/rangeFieldBoundary.test.ts` が型と記号で確かめます。描いた端は Figure の検査用の読み出し（`__figureInspect` の `range`）にあり、テストは欄の数をそれと比べます。
- 熱図の色の範囲は図のサービスが決め、Figure は絵の 1 つの範囲（`range.colour`）から熱図とカラーバーの両方を塗ります。カラーバーだけが別の範囲になる道はありません。入れた範囲がそのまま塗られることは下のテストが確かめます。
- テスト: `src/test/uiSmoke/colourRangeRounding.spec.ts` › a typed colour range is painted and offered again exactly as typed: −87.25 to −20.125 dB, neither end rounded off (R9)
- テスト: `src/test/rangeFieldBoundary.test.ts` › every range box writes the ends it is painted with by exactFieldText, and nothing on their way there rounds them outside figureModel (R9)
- テスト: `src/test/rangeFieldBoundary.test.ts` › the range field scan finds a rounded end: in the field, in a helper, through a local, a destructured const, a spread, another plotText writer, and in openAxisPart's shown ends (R9)
- テスト: `src/test/uiSmoke/waveformAmplitudeRange.spec.ts` › double-clicking the waveform amplitude axis sets the vertical range from a popover

## R10 レイアウトが変わったら描き直す

パネルの大きさが変わったら、グラフをその大きさで描き直します。引き伸ばしたまま残しません。グラフはほかのグラフやレーンに重なりません。トリガーの重ね描きはトラックの上に自分の高さを保ち、トラックはその下でスクロールします。

- テスト: `src/test/uiSmoke/visibility.spec.ts` › a row's Figure follows layout changes without a window resize event
- テスト: `src/test/uiSmoke/trackCompare.spec.ts` › a trigger added from ＋ fires at half the tracks' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events

録音の情報（ヘッダから読む長さ・サンプルレート・校正）が届いても、入口の表の行は動きません（#781）。フォルダを読み込む間、ポインタの下の行が別の行に変わらないようにするためです。行の高さは中身によらず一つ（`ENTRY_ROW_HEIGHT`、行のボタンもこれより低い）で、見えている行だけを描く計算も同じ数を使います。列の幅は列の定義（`col`）が決め、値の文字では変わりません。見出しは広げた表で最初から `ENTRY_HEAD_LINES` 行の高さです。列の名前はこの行数に収まる幅にし、収まらない名前は切ってヒントで全体を見せます。トラックの横で表の上にたたんだ分布も、情報が届く前から同じ高さです（選択欄は選択肢によらない幅、件数とヘッダの読み取りの進みはそれぞれ 1 行、群の帯はプールの群の数で決まる高さ）。表は行を書き直さず、まだ描いている行とそのセルをそのまま使って中身だけを替えます（`keptRows.writeKeptRows`）。値はそのセルの文字として届きます。残したボタンのヒントが変わったときは、ポインタがその上にあればフッタも新しいヒントにします（`HINT_CHANGED_EVENT`。書き直していたときは新しい要素への mouseover がこれをしていました）。▾ とその場所は ▾ の字と余白の幅だけを取ります。固定の幅にすると、字の広いフォントで「ch」が 2 行に折れます。

- テスト: `src/test/uiSmoke/entry.spec.ts` › a row's ✎ under a resting pointer: the footer says its new hint, the memo, once it is written; the button is the same one (#781)
- テスト: `src/test/keptRows.test.ts` › a file's information that arrives goes into the cells that were drawn while its header was not read: no row or cell is drawn anew (#781)

## R11 凡例が名指すチャンネルを描く

多チャンネルの録音は、凡例が名指すチャンネルとして、入力を含むすべての段で描きます。チャンネルを平均した線を、一つのチャンネルの名前で描きません。役割のない録音は、表でその録音の最初の行のチャンネルとして描きます。手順の図は録音ごとに一つなので、ほかのチャンネルのレーンは空のまま残さず、隠します。

- テスト: `python-backend/test_scan_service.py` › test_the_input_is_the_channel_the_chain_picks_not_the_channels_mean
- テスト: `src/test/uiSmoke/trackStage.spec.ts` › a two-channel recording is one lane in the steps view: its second channel is left out, not drawn empty

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

どのグラフも、共通の部品（Figure、`src/webview/figure/figure.ts`）で描きます。軸、層、マウス、拡大、読み値の行、空のときの表示は部品が持ち、各グラフはデータと層の種類と軸の名前を渡すだけです。Figure のキャンバスには印（`data-figure`）が付きます。UI テスト全件で、画面に出ているキャンバスが Figure のものでも、画面が自分で描く軸のキャンバス（Tracks の時間の目盛り、`data-plot-axis-canvas`）でも、図の上に重ねる印の層（`src/test/uiSmoke/plotRegistry.ts` の一覧）でもなければ、そのテストを失敗にします（`src/test/uiSmoke/canvasAudit.ts`）。SVG で描いた図も失敗にします。Figure の図には、どれにも同じ操作を加えて確かめます（`plotContract.spec.ts` の `expectFigureContract`）。マウスを乗せると読み値がすぐ上の行に出てグラフは動かない、← / → で読み値が 1 点ずつ動く（読んだ点の番号がちょうど 1 つ進み、戻る）、Ctrl+ホイールで拡大してダブルクリックで戻る、マウスを乗せて + / − でそのグラフの横軸が真ん中を中心に拡大・縮小し 0 で全体に戻る、値の軸の上の Ctrl+ホイールで横軸が真ん中を中心に拡大する（軸の上にはグラフの点がないので、どのグラフも、トラックのレーンと色の帯も同じ）、ドラッグの矩形ズーム（下の軸の種類のとおり）、縦軸と横軸のダブルクリックでその軸の範囲の入力が開く、両軸に名前がある、の 8 つです。グラフの上にないときの + / − / 0 は、その画面の共有の窓（レーンの時間、比較の窓）に効きます。拡大と戻すは、Figure が言う画面の範囲（`__figureInspect` の `part`）で確かめます。軸のキャンバスに、その描き手のほかが描いたもの（別のキャンバスから `drawImage` で写したものも）は失敗にします。ドラッグはどのグラフでも矩形ズームで、囲んだ範囲に横軸と縦軸を合わせます（トラックのレーンも同じ）。入口の分布図の縦軸は群ごとの件数の軸で、どの範囲の値を見ていても 0 からその群の一番多いビンの上まで、いつもすべての件数を表示する軸と決めています。件数が軸の外に出ないためです。分布図の矩形ズームは値の軸（横軸）に効き、件数の軸はいつも全体のままです。これは拡大を省いたのではなく軸の性質で、共通の部品が軸の種類として持ちます（`plotInteraction.ts` の `VerticalAxis`、分布図は `'all-counts'`、ほかのグラフは `'zoom'`）。レーンのループは Alt+ドラッグ、時間ずらしは Shift+ドラッグで、矩形ズームのモード切り替えはありません。入口の分布図は群ごとの行を部品で描き、値の軸を下の帯に共有します。値の範囲選びは Alt+ドラッグで、矩形ズームと同じ共通の部品（`plotInteraction.ts`）が修飾キーで振り分けます。グラフのマウスとキーの扱いは、共通の部品のほかには書きません。トラック表示（時間軸）のレーンも、ドラッグ（矩形ズーム、Alt+ドラッグのループ、Shift+ドラッグの時間ずらし）、ホイール、軸のダブルクリックを共通の部品で受け、全レーンで 1 つの時間の窓を共有します。グラフが新しい操作を要るときは、部品にどのグラフでも使えるオプションとして足します。グラフのクリック（入口の概観の行選び、分布図のビン選び、トリガーのイベント線の除外）も、動かずに離した押下として部品の `tap` で受けます。部品の外でマウス、ポインタ、ホイール、クリック、ダブルクリック、キーを受けるモジュールは、グラフでないもの（境目のドラッグ、ポップオーバー、ボタンなど）に限り、受けるイベントごとに理由と一緒に `src/test/plotGestures.test.ts` の一覧に置きます。部品の下の低レベルのリスナー（`trackPointerEvents.ts`）を付けるのは `plotInteraction.ts` だけです。ペアの図のように 1 本の周波数軸に縦に積んだ段は、段の上の 1 行を読み値の行として共有します。トラック表示の行も 1 本の時間軸に積んだ図で、上のツールバーの行を共有します。Tracks の行の上の時間の目盛り（`#ruler-canvas`）は、行の Figure と同じ目盛りの決まりで別のキャンバスに描き（`src/webview/runtime/timeRuler.ts` の `paintTimeRuler`）、ダブルクリックで時間の範囲の入力が開きます。

押下の調停はページに 1 つ（`src/webview/figure/pressArbiter.ts`）で、2 度押しは 1 度目のクリックを取り消し、ズームを戻すだけです。どの図がどの宣言で描かれるかは `docs/figure-list.md` にあります。
- テスト: `src/test/uiSmoke/figureOverlay.spec.ts` › a double click on the overlay resets its zoom only: its first press acts on nothing, and the zoom is undone (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)

- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a picture copied onto an axis canvas by anything but its painter (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a canvas on screen that is not a Figure's, an axis canvas or a listed layer (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)
- **色の帯（熱図とスペクトログラムのカラーバー）は値の軸です。** 色の帯は Figure が描きます（`src/webview/figure/imageLane.ts` の `paintColourBar`、帯の場所は `colourBarBox`）。帯の上では、ほかの値の軸と同じく、Ctrl+ホイールは横軸を真ん中を中心に拡大し（マウスの位置ではなく）、押してドラッグしても矩形ズームは始まらず、読み値はマスを読みません。+ / − / 0 はそのグラフの横軸に効きます。ダブルクリックは、色の範囲を入力できる図（Tracks の行のスペクトログラム）では、その範囲の入力を、帯が書いている端の数のとおりに開きます。色がデータに従う図（比較の熱図）では拡大を戻し、範囲の入力は開きません。比較の熱図に色の範囲の入力は足しません。
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)
- **クリックはすぐに動きます。ダブルクリックは拡大を戻すだけです。** 動かずに離した押下はクリックで、離したときにすぐ動きます（その押下のときの絵で決めます）。ダブルクリックかどうかはブラウザが OS の設定の間隔で決め（2 回目の押下の `detail` が 2、そのあと `dblclick`）、部品は自分で時間を測りません（待つタイマーはありません）。ダブルクリックの 2 回目の押下はクリックではなく、1 回目のクリックがしたことを取り消します（あいだにほかの押下がなかったとき）。そのうえでダブルクリックが拡大を戻します（軸の上では範囲の入力を開きます）。1 回目のクリックで画面が動いて（ビンを選ぶと表が絞られる）2 回目の押下がグラフの外に落ちても、それはそのグラフのダブルクリックです（`trackPointerEvents.ts` が文書で 2 回目の押下を聞き、`plotInteraction.ts` の `secondPress` が取り消して、そのグラフの拡大を戻します）。だから、ダブルクリックは、どれほどゆっくりでも OS の間隔の中なら、選んだもの（概観の行、分布図のビンと点の行、レーンの時刻カーソルとループ、外したイベントの線）を押す前のままにし、拡大を戻すだけです。OS の間隔より遅い 2 回目の押下は、2 回目のクリックです。クリックをする側（`plotInteraction.ts` の `tap`）は、したことを取り消す関数を返します（表の選択と並びとスクロール：`entryRuntime.ts` の `tableNow`、時刻カーソルとループ：`src/webview/screens/trackRowsScreen.ts` の `deps.seek`・`deps.loop` が返す取り消し、イベントの線：`stepBar.ts` の `edit` が返す取り消し。↶ の履歴にも残しません）。データを待っているクリックは、2 回目の押下が来ればまだ何もしていないので、何もせずに終わります。新しいクリックの操作を足すときも、取り消しを一緒に返します。ブラウザでは、`src/test/uiSmoke/readoutTransitions.spec.ts` の表の行（レーン、分布図の点、トリガーのイベントの線のダブルクリック）が、本物のダブルクリックで選択が残らないことを確かめます。理由：前は、クリックがダブルクリックを待って決まった 300 ms あとに動きました。それより遅いダブルクリック（OS にとってはダブルクリック）では先にクリックが動き、ダブルクリックでは残らない選択が残りました。どのクリックも遅れて感じました。
- **クリックは、読み値が読んでいる点に効きます。** クリックで何かを選ぶ・外す・戻す・移るグラフは、どれも、押したときにその場所で読み値が読んでいる点（同じ読み方、同じ点、同じもの：録音のキー、行、イベント、サンプルの時刻）に効きます。クリックが自分で当たり判定をすることはありません（自分の半径も、自分の許しもありません）。読み値が何も読まない所（「値なし」、点がない）では、クリックは何もしません。ただし、Tracks の行のクリックは、点への操作ではなく時刻へのシークです。読み値が点を読んでいるときはその点の時刻へ、何も読まないときはマウスの時刻へシークします。読みがまだ届いていないときは、ほかのグラフと同じく届いてから決めます（`src/webview/figure/pendingClick.ts` の `waitingClick`）。押してから離すまでのあいだ（ドラッグの閾値の中で動いても）、読み値は押した所のままです。だから、クリックが効くのは押したときの読み値です。
- テスト: `src/test/plotInteraction.test.ts` › a press is read where it is pressed and holds that read until it is let go: a move within the drag threshold reads nothing new, so a click acts on what the readout read at the press (R7, R13)
- テスト: `src/test/figureBinsLane.test.ts` › where no point is read, a click tells the screen the bin the service said is under the pointer; with none said, nothing
- **ドラッグの間、窓はドラッグのものです。** 矩形ズーム、Alt+ドラッグ、Shift+ドラッグの間は（どの面のドラッグでも）、ホイール（Ctrl+ホイール、Shift+ホイール、横のスワイプ）も + / − / 0 も ← / → も、どのグラフの窓も読み値も変えません。描いている矩形を、描きはじめた窓の上に置くためです。離せば、どれもまた効きます。決まりを置く場所は 1 か所です（`plotInteraction.ts` の `dragUnderWay`。ホイールはすべて `wheelAt` を通ります）。新しいホイールやキーの操作を足すときも、ここを通します。
- テスト: `src/test/plotInteraction.test.ts` › a double click resets the zoom only, however slow: the selection is as before it; a second click beyond the browser's double-click interval is a second click (R13)
- テスト: `src/test/plotInteraction.test.ts` › one arbitration of a click for every plot: a click acts at once, the second press of a double click takes it back, and the next press anywhere (a drag, another plot's click) takes the place of a click still waiting for its data (R13)
- テスト: `src/test/plotGestures.test.ts` › every plot that acts on a press that stayed put (plotInteraction's tap) acts at once, and a double click's second press takes it back, with no timer of its own or of the shared gestures: one arbitration for all (R13)
- テスト: `src/test/stepHistory.test.ts` › an edit retracted is as if never made: ↶ does not go back to it and ↷ keeps what it had before it (R13: a double click takes back its first press)
- レーンのオフセットの表示（`offsetInlineEditor.ts`）も同じ決まりです。クリックすると入力欄がすぐに開きます。ダブルクリックの 2 回目の押下は、その開いたことを取り消し（入力欄は閉じ、何も確定しません）、オフセットを 0 に戻します。ダブルクリックかどうかはブラウザが決めるので、ゆっくりしたダブルクリックでも 0 に戻ります。待つタイマーはありません。
- テスト: `src/test/offsetInlineEditor.test.ts` › a click on the offset opens its editor at once, with no wait, and reports the edit (R13)
- テスト: `src/test/offsetInlineEditor.test.ts` › a double click on the offset resets it to 0 and leaves no editor, however slow: the browser decides it is one (R13)
- テスト: `src/test/offsetInlineEditor.test.ts` › a double click on the offset resets it whether its second press lands on the editor or beside it (R13)
- テスト: `src/test/offsetInlineEditor.test.ts` › the offset editor waits on no timer of its own: a click opens it, the browser tells a double click (R13)
- テスト: `src/test/plotInteraction.test.ts` › a drag under way owns the view: a wheel during it (Ctrl+wheel, Shift+wheel, a sideways swipe, on its plot or another surface's) changes no window; let go, the wheel works again (R13)
- テスト: `src/test/plotInteraction.test.ts` › during a drag on one surface the keys over another plot step and zoom nothing; let go there, it reads where it was let go without a move (R7)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › a trigger's events plot and the lanes under it answer the same gestures as every plot (R13)
- テスト: `src/test/uiSmoke/figureDistributionKind.spec.ts` › a table column's distribution is the Figure's, in the distribution's box: its groups, counts, reads and picks are the figure service's
- テスト: `src/test/uiSmoke/allButtons.spec.ts` › a drag on a row's spectrogram zooms into its time and frequencies; a double-click shows the whole again (R13)
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › the track view's waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13)
- テスト: `src/test/plotGestures.test.ts` › no webview module listens for pointer or key events of a plot outside the shared plot gestures, except those listed with why (R7, R13)
- テスト: `src/test/plotGestures.test.ts` › every plot's gestures are built on plotInteraction.ts: the shared listeners are called from nowhere else, the plots' ← / → context added nowhere else (R7, R13)
- テスト: `src/test/plotInteraction.test.ts` › on a plot whose vertical axis shows all counts, a box zooms its value axis and every count stays on screen (R13)
- テスト: `src/test/uiSmoke/figureDistributionKind.spec.ts` › a table column's distribution is the Figure's, in the distribution's box: its groups, counts, reads and picks are the figure service's
- テスト: `src/test/plotInteraction.test.ts` › + / − zoom the horizontal axis of the plot under the pointer around its middle and 0 shows it whole; the window it set is named on the plot (R13)
- テスト: `src/test/plotInteraction.test.ts` › Ctrl+wheel over an axis zooms the horizontal axis around its middle; over the plot, around the pointer (R13)
- **UI テストが画面を読むのは、ページが答え終わってから（`settled()`）です。** 固定の時間は待ちません。`settled()`（`src/test/uiSmoke/canvasAudit.ts`）は 1 つの仕組み（`installSettleTracker`）で、ページがまだ答えていないものを全部数えます。頼んだアニメーションのフレーム、1 秒以下のタイマー、fetch とファイルの読み出し、ホストに頼んで答えの来ていない要求、そしてページが自分に送ってまだ届いていないメッセージ（`window.postMessage`）です。これが 2 フレーム続けて 0 のときに、待ち終わります。メッセージを数えるのは、ui-smoke の代わりのホストが答えをタイマーから `postMessage` で送るからです（`buildHtml.ts`：領域のピーク、スペクトルの切り口、図の要求）。`postMessage` は送ったタスクのあとの別のタスクで届き、そのあいだにフレームが進みます。タイマーは動いた時点で数えなくなるので、メッセージを数えないと、答えがまだ届いていないのにページが静かに見え、テストは答えの前の画面（全データ待ちの空の読み値、R7）を読んで、正しい動きを失敗にしていました。負荷の高いマシンほど起き、線の多いグラフ（トリガーのイベントを重ねた図：線ごとに読み出しを頼む）ほど起きました。ページが待つものを新しく足すとき（Worker、MessageChannel など）は、テストごとに待つのではなく、この仕組みに数えさせます。
- テスト: `src/test/uiSmoke/hostAnswer.spec.ts` › settled() waits for a message the page posts to itself until the page has read it: a stand-in host's answer from a timer
- テスト: `src/test/uiSmoke/hostAnswer.spec.ts` › settled() counts a host request as answered only once the page has read the answer, not when it is sent
- テスト: `src/test/uiSmokeWaits.test.ts` › ui-smoke tests wait for the page, not for a fixed time, but where the time is what they test

## R14 線は自分の軸の変換で描き、読み、印を付ける

どの段も、値の軸は 1 本です（R4。単位や基準が違う録音は段を分けます）。線を描くこと、読んだ点の印を付けること、値の軸の箱の拡大、目盛りを置くことは、どれもその段の軸の 1 つの変換で行います。

- 軸の値と画素の変換を作るのは 1 か所（`src/webview/figure/axisScale.ts` の `axisScale`・`windowedScale`・`valueScale`）だけです。線を描く位置は正確な位置で、図の外に出る線は留めずに切ります（R2「線は切り取り、留めない」）。留めるのは読んだ点の印だけです（画面の中に留める）。
- マウスが点を選ぶのは図のサービスです（R7）。Figure は、ポインターの位置と軸の単位あたりの正確な画素（軸の範囲と箱の大きさから）を送ります。描くために留めた位置の差から縮尺を作りません。留めた位置は値の本当の位置ではないので、その差は縮尺にならず、画面の上で本当に一番近い点を選べなくなるからです。
- 値の軸の箱の拡大は、軸の割合（0〜1）で窓を決めます。画素から値に直すときも、その軸の範囲を使います。
- **目盛りは、その数を絵が描く位置に置きます。** 値の軸と熱図の行の軸の目盛りは、絵を描くのと同じ変換で位置を決めます（`src/webview/figure/ticks.ts` の `valueAxisTicks`・`alongAxisTicks`）。値 v と書いた目盛りは、どの拡大でも、その軸が v を描く位置にあります。目盛りの位置を別の式で求めたり、位置を決めてから文字だけを別の数に書き換えたり（丸める、絶対値を取る、同じ文字の目盛りを間引いて残りに書く）しません。文字は、その位置の値をその軸の書き方で書いたものだけです。
- 契約表の目盛りの行があるグラフはどれも、その行に目盛りの位置を確かめるテスト（`plotContracts/model.ts` の `TICK_PLACES`）のどれかを書きます（`src/test/plotContracts.test.ts`）。
- テスト: `src/test/uiSmoke/plotContract.spec.ts` › every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)
- テスト: `src/test/plotContracts.test.ts` › every chart with a level, value or row axis names in its ticks row a test that holds each tick label at the place its axis paints that number, at several vertical zooms (R9, R14)
- テスト: `src/test/uiSmoke/readoutTransitions.spec.ts` › the browser table holds a row for each chart the readout runs on, by its full name, and each real path R7 names

## R15 解析条件が同じかは、頼んだ領域そのもので決める

比較台が手順の絵を頼むときのキーは、Recipe、手順、そして送る領域の秒をそのまま持ちます（`compareBasics.regionKey`、`trackStageModel.stageSpec`）。秒が少しでも違う 2 つの領域は別の頼みで、同じ答えを使い回しません。領域の表示用の名前（Webview の `regionLabel`、小数 2 桁）は読むためだけのもので、同一性には使いません。以前は小数 3 桁の名前で条件を決めていたので、48 kHz で 14 サンプル離れた 0.5001 s と 0.5004 s の始まりが同じ条件になっていました（#768）。

- バックエンドは、スキャンの結果に、頼まれた領域の秒をそのまま返します（`ScanInput.region`）。手順の値を持つキー（`StageView.data`）は、読んだファイルの版、Recipe、領域、チャンネル、校正、手順から作るので、領域が違えば別の値です（`scan_service.py`）。
- バックエンドが解析条件の ID（`conditionId`）を作っていたのは、入口の決まった解析（Leq など）の結果を見分けるためでした。その解析をなくしたので、ID もありません。ファイルが変わったかは、スキャンが返すファイルの版（`ScanInput.id`）で見分けます（`stageSource.stageBasis`）。
- テスト: `src/test/trackStageModel.test.ts` › every scan's key holds its region exactly as it is sent: a region imported from a selection and one typed to 0.01 s never share a cache
- テスト: `python-backend/test_scan_service.py` › test_scan_repeats_exactly_and_names_the_region_asked_for
- テスト: `src/test/answerFreshness.test.ts` › a rescan that failed is not the version the pictures were taken of; one still running keeps it

## R16 自動の縦の範囲は、時間のスクロールや拡大で動かない

時間信号の段（トラックの波形、比較台の波形と Δ、トリガーのイベントの段）の自動の縦の範囲は、録音の全サンプルのうち一番大きい振幅から決めます（± その値に少し余白を足し、切りのよい端へ広げる。R9）。画面に見えている部分のサンプルからは決めません。横にスクロールしたり時間を拡大したりしても、縦の範囲は変わりません。変えるのは、縦の範囲を指定したとき（範囲の入力欄、縦も囲む箱の拡大）だけで、指定しなかった端は全体の値のままです。

- 見えている部分から決めると、静かな所へスクロールしただけで縦が何十倍にも伸び、小さな音が大きく見えます。波形の大きさを見比べられなくなります。前の実装も、録音全体のピーク（`absolutePeak`）で決めていました（`waveformLayer.ts` の `waveformRange`、`figureModel.ts` の `laneAmplitudeRange`）。
- 決めるのは図のサービスの 1 か所です（`python-backend/figures/ranges.py` の `whole_band`）。全体の範囲は答えごとに 1 回だけ作って覚え（`figures/service.py` の `_whole_bands`）、スクロールのたびには全サンプルを見直しません。`band_range` は、指定された端だけをそのまま使い、残りの端はこの全体の範囲から取ります。トリガーのレベルの線は全体の範囲に入ります。スケール連動のときは、連動するすべての録音の全サンプルで決めます（`shared_amplitude`）。
- スペクトルなどの線の段の縦の範囲も、画面の横の範囲ではなく軸の全体の値で決めます（`ranges.py` の `confirmed_range`）。Tracks の行のスペクトログラムの色の範囲は、録音全体のレベルで決めます。
- テスト: `python-backend/test_tracks_scroll_range.py` › test_scrolling_or_zooming_the_time_keeps_the_rows_range_up
- テスト: `python-backend/test_tracks_scroll_range.py` › test_a_range_specified_up_is_still_the_requests_while_scrolled
- テスト: `python-backend/test_figures_signal.py` › test_the_confirmed_range_is_the_signals_whole_length_and_the_largest_magnitude_of_every_sample
- テスト: `src/test/uiSmoke/trackRowFigures.spec.ts` › a row zoomed or scrolled onto its quiet half keeps the waveform's range up: the whole recording's (R16)

## R17 Alt+ドラッグのループは、ドラッグの間から見せる

トラックの行で Alt+ドラッグすると、動かしはじめた時点からループ区間の枠が出て、ポインタに合わせて伸び縮みします。矩形ズームの青い枠は出しません。離したところでループ区間が決まります。ループの端を押してドラッグしたときは、その端だけが動き、もう一方の端は動きません。押した場所の近くで離した（何も選ばなかった）とき、離した知らせが届かなかったとき、ドラッグ中にその行が画面から外れて図がなくなったときは、押す前のループに戻します。

- 離すまで矩形ズームの枠に見えると、ループを作っているのか拡大しているのか分からず、区間も離すまで分かりません。前の実装も、ドラッグの間からループ区間を描いていました（`comparisonRuntime.ts` の `moveLaneDrag`）。
- 図の部品（`src/webview/figure/figure.ts`）は、画面が `ranging` を聞いているときだけ、ドラッグの間の区間を知らせて矩形を描きません。聞いていない図（入口の分布図の値の範囲選び）は、今までどおり離したときの `range` だけです。どのループにするかは画面（`src/webview/screens/trackRowsScreen.ts`）が、押したときのループから毎回決めます（`loopDrag.ts` の `loopAfterDrag`）。
- テスト: `src/test/uiSmoke/trackRowFigures.spec.ts` › Alt+drag on a row shows the loop while it is dragged, never a zoom box; dragging an end moves that end; let go where pressed puts the loop back (R17)
- テスト: `src/test/figureComponent.test.ts` › an Alt+drag where the screen listens to ranging is told at every move with no box, and ends in a range, or in null when it picks nothing, its release is lost or its Figure goes (R17)
