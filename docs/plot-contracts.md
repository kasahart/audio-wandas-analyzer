# グラフの数の契約表

グラフに出る数とグラフから書き出す数の一覧です。どのグラフでも、読み値、← / → の行き先、Δ、中央値、見出しや最大、重ねる順、軸の自動の範囲と目盛り、書き出す数、数や統計は全データから求め、間引いた点は描くためだけに使います（[表示の規則](display-rules.md) R1、R2、R6、R7）。この表は、それぞれの数をどこで計算し、何から求め、どのテストが確かめているかを書きます。

この文書は `src/test/plotContracts.ts` から作ります（手で書き換えません）。表を変えたら `npm run compile && node dist/test/plotContracts.js` で書き直します。`src/test/plotContracts.test.ts` は次を確かめます。

- 部品（`paintOverlay`）を呼ぶすべての場所と `plotRegistry.ts` の一覧が、どれかのグラフに入っていること。
- 表に書いたテストが実在し、飛ばされず、何かを確かめていること。表に書いた関数が実在すること。
- webview と shared の中で数を文字にする関数（`toFixed`、`toPrecision`、`toExponential`、`toLocaleString` と、`VALUE_HELPERS` の書き方・範囲・順・統計の関数を呼ぶもの）が、表のどれかの行か、`VALUE_HELPERS`、`NOT_CHART_VALUES`（理由つき）にあること。もう数を書かない関数が残っていても失敗します。
- テストのない行、間引いた点から求める行、軸の名前に量・単位・基準が欠ける行は「穴」（gap）で、`KNOWN_GAPS` と一致すること。穴は減らす方向にだけ変えます。穴の印を消すには、テストを足し、出どころを全データにします。

重さ：P1 は間引いた点から求めた数がそのまま出るもの、P2 は確かめていないか近似のもの、P3 は見た目や書き方だけのものです。「作業中」は、その行を変えているほかのブランチです（この表は main の今を書いています）。

## グラフ

| グラフ | 描く・書き出す関数 | 行の数 | 穴 |
| --- | --- | --- | --- |
| 比較台の重ね図（トリガーのイベント図を含む） (`compare-overlay`) | `webview/runtime/trackStagePainter.ts:paintStageOverlay`<br>`webview/runtime/trackStagePainter.ts:paintNoPicture` | 15 | 5 |
| 比較台の Δ 欄 (`compare-delta`) | `webview/runtime/trackStagePainter.ts:paintStageOverlay` | 9 | 4 |
| 比較台の横並びのレーン (`compare-lanes`) | `webview/runtime/trackStagePainter.ts:paintStageLanes`<br>`webview/runtime/trackStagePainter.ts:paintNoStage` | 6 | 2 |
| トリガーのイベント図の下のレーン (`trigger-lanes`) | `webview/runtime/triggerLanes.ts:paintTriggerLanes` | 6 | 1 |
| トラックの波形レーン (`track-waveform`) | `webview/runtime/comparisonRuntime.ts:drawTrackWaveform` | 6 | 0 |
| トラックのスペクトログラムのレーン (`track-spectrogram`) | `webview/runtime/trackCanvasPainter.ts:paintTrackSpectrogram`<br>`webview/runtime/comparisonRuntime.ts:drawSpectrogram` | 5 | 1 |
| トラックのレーンの軸（振幅・周波数の軸、上の時間の目盛り） (`track-axes`) | `webview/runtime/comparisonRuntime.ts:renderRuler`<br>`webview/runtime/stagePanes.ts:paintSideAxis`<br>`.track-axis-canvas:not(.track-spec-axis)`<br>`.track-spec-axis`<br>`#ruler-canvas` | 2 | 0 |
| トラックの見出しとツールバーの数（カーソルの時刻、ずらし、ピーク、解析窓） (`track-header`) | `webview/runtime/calibrationDecorations.ts:channelMetricSummaryHtml`<br>`webview/runtime/comparisonRuntime.ts:updateCursorDisplay` | 5 | 1 |
| トラック表示の PNG 書き出し (`track-png`) | `webview/runtime/exportDownloads.ts:composeTrackCanvases` | 1 | 0 |
| カーソルスペクトル (`cursor-spectrum`) | `webview/runtime/overlaySpectrumPainter.ts:paintOverlaySpectrum`<br>`webview/runtime/comparisonRuntime.ts:renderOverlaySpectrum` | 6 | 2 |
| カーソルスペクトルの CSV 書き出し (`spectrum-csv`) | `webview/runtime/runtimeExports.ts:buildSpectrumCsv` | 1 | 0 |
| ペアの図（利得・位相・γ²） (`pair-view`) | `webview/runtime/pairSpectrumPanel.ts:render` | 8 | 3 |
| カラーバー（比較台の熱図、スペクトログラムのレーン、入口の概観帯） (`colour-bar`) | `webview/runtime/stagePanes.ts:paintColourBar` | 2 | 0 |
| 入口の保持図（スロットの Δ、手順の有無の Δ、平均スペクトル） (`entry-held`) | `webview/runtime/entryHeldPlot.ts:paintView` | 6 | 2 |
| 入口の概観帯 (`entry-overview`) | `webview/runtime/entryPlots.ts:paintOverview` | 5 | 1 |
| 入口の分布図（群ごとの行と下の値の軸） (`entry-distribution`) | `webview/runtime/entryDistributionPane.ts:paint` | 8 | 1 |
| 入口の表（値の列、Δ、見出しの数、D の差、表の CSV） (`entry-table`) | `webview/runtime/entryTableHtml.ts:datasetRowsHtml`<br>`webview/runtime/entryTable.ts:entryCsv` | 6 | 1 |
| レポートの重ね図（比較 n.png、要約.png の上段） (`report-overlay`) | `webview/runtime/compareReport.ts:paintOverlayFigure` | 5 | 2 |
| レポートの Δ 図（差 n.png、要約.png の下段） (`report-delta`) | `webview/runtime/compareReport.ts:paintDeltaFigure` | 4 | 2 |
| レポートの 要約.png の頭書き・報告.csv・定義.json (`report-files`) | `webview/runtime/compareReport.ts:summaryPng`<br>`webview/runtime/compareReport.ts:reportCsv` | 2 | 0 |
| 解析レポート（Markdown） (`analysis-report`) | `shared/report/analysisReport.ts:buildMarkdownReport` | 1 | 0 |

## 比較台の重ね図（トリガーのイベント図を含む）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | 線の読み値（位置と値） | `webview/runtime/stagePanes.ts:stageHover`<br>`webview/runtime/stagePanes.ts:lineRead`<br>`webview/runtime/stagePanes.ts:atValue`<br>`webview/runtime/stagePanes.ts:atText`<br>`webview/runtime/stagePanes.ts:timeText`<br>`webview/runtime/trackStagePainter.ts:overlayLayers`<br>`full_read.py:read_line` | 全データ：各層の full は stageReader.of（compare-combine の read）。バックエンドが保持した段の全ビン・全サンプルからマウスのまわりの窓を返す（full_read.py）。描いた間引きの線は読まない。 | `fullRead.test.ts` › every line and image a plot draws says where its full data is read; bars are whole (R7)<br>`stagePanes.test.ts` › the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)<br>`uiSmoke/narrowFeatures.spec.ts` › a hover and the arrow keys on the thinned whole spectrum read its real bins from the backend, one bin per key, each at its exact value (R7)<br>`test_full_read.py` › test_a_recordings_spectrum_is_read_at_its_own_bins_not_its_picture<br>`test_full_read.py` › test_a_signals_samples_are_read_one_by_one |  |
| 読み値 | 熱図（スペクトログラム、ラフネス、ケプストログラム）の読み値 | `webview/runtime/stagePanes.ts:imageHover`<br>`webview/runtime/stagePanes.ts:cellRead`<br>`full_read.py:read_cells` | 全データ：熱図の層の full は stageReader.of の cells。バックエンドが本当のマス（1 フレーム・1 ビン）を返す。描くための平均したマスは読まない。 | `fullRead.test.ts` › a spectrogram is read at its real cells, never the cells averaged to draw it, and stepped a frame at a time (R7)<br>`test_full_read.py` › test_an_images_cells_are_its_own_around_the_place_read |  |
| 読み値 | 1/3 オクターブ帯（棒）の読み値 | `webview/runtime/stagePanes.ts:lineRead`<br>`stage_view.py:_noct_view` | 描く点が全部（間引かない）：帯は間引かない（NOctFrame の全帯）。棒は描いた値がそのまま全部の値で、full がなくても描いた値を読む。 | `fullRead.test.ts` › every line and image a plot draws says where its full data is read; bars are whole (R7)<br>`uiSmoke/trackCompare.spec.ts` › the comparison shows a step's bands as bars, and hides the lanes' own controls |  |
| 読み値 | トリガーのイベントごとの線の読み値（#n @ 時刻） | `webview/runtime/stagePanes.ts:eventLayers`<br>`webview/runtime/stageReader.ts:createStageReader` | 全データ：eventLayers がイベントごとに layer.full.event(id) を付け、stageReader が read に event を入れて頼む。バックエンドはそのイベントの全サンプルを返す。 | なし | **P2** イベントの線の読み値と ← / → がそのイベントの全サンプルから来ることを確かめるテストがない（ジェスチャのテストは数字の出どころを見ない）。 |
| ← / → | ← / → で進む先（次のビン・サンプル・フレーム） | `webview/runtime/stagePanes.ts:stageStep`<br>`webview/runtime/stagePanes.ts:imageStep`<br>`webview/runtime/stagePanes.ts:stageNeighbour`<br>`webview/runtime/fullRead.ts:fetchedSource` | 全データ：full のある層は、読んだ点の先 256 点（STEP_AHEAD）を全データから取り寄せ、次の本当の点を読む。棒は描いた次の値。 | `plotHoverLayer.test.ts` › an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot's left edge (R7)<br>`fullRead.test.ts` › an arrow key crosses silent points past one fetched window to the next point with a value (R7)<br>`uiSmoke/narrowFeatures.spec.ts` › a hover and the arrow keys on the thinned whole spectrum read its real bins from the backend, one bin per key, each at its exact value (R7) | <br>作業中：`claude/contract-step-click` |
| 中央値 | 基準の群の中央値の線（とその読み値） | `stage_combine.py:combine`<br>`webview/runtime/stageReader.ts:createStageReader` | 全データ：バックエンドが群の各録音の全ビン・全サンプルから中央値をとり、そのあとで描くために間引く。読み値は combined(…, 'base') で中央値の全データを読む。 | `test_stage_combine.py` › test_a_groups_median_is_taken_bin_by_bin_before_it_is_drawn<br>`test_full_read.py` › test_a_medians_read_stops_where_its_picture_was_aligned_with_the_compared_one |  |
| 重ねる順 | 重ねる順（静かな線が上） | `webview/runtime/stagePanes.ts:overlayOrder`<br>`webview/runtime/stagePanes.ts:byLevel`<br>`webview/runtime/stagePanes.ts:drawnLevelsText`<br>`webview/runtime/stagePanes.ts:paintPlot`<br>`stage_combine.py:level_bins` | 全データ：各線の levelBins（軸を 256 区間に分けた各区間のパワーと数）をバックエンドが間引く前の全ビン・全サンプルから作り、部品が画面に見えている区間で比べる。 | `stagePanes.test.ts` › every plot draws its overlaid lines loudest first and the quietest last on top, whatever order the caller gives them (R6)<br>`stagePanes.test.ts` › the order comes from every value before thinning, never from the points drawn (R2, R6)<br>`uiSmoke/plotContract.spec.ts` › every ui-smoke test fails on a plot on screen that drew a louder compared line over a quieter one (R6)<br>`test_stage_combine.py` › test_every_compared_level_line_carries_level_bins_whole_zoomed_and_as_a_median<br>`test_stage_combine.py` › test_a_spectrums_level_bins_are_every_bins_power_not_the_drawn_points | <br>作業中：`claude/level-order-exact` |
| 自動の範囲 | 線の値の軸の自動の範囲 | `webview/runtime/stagePanes.ts:stageRange`<br>`webview/runtime/stagePanes.ts:roundEdge`<br>`webview/runtime/trackStagePainter.ts:paintStageOverlay`<br>`webview/plot/waveformLayer.ts:waveformRange` | 間引いた点（区間の最小・最大）：stageRange は粗い絵（coarsePlots：各区間の最小と最大に間引いた線）の値の端から決める。最小・最大は全データと同じだが、時間信号以外では全データから求めていない（時間信号は absolutePeak）。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1 | **P2** 範囲の端を間引いた線から求めている。間引きが端を残すので同じ値のはずだが、範囲が全データの端と一致することを確かめるテストがない。 |
| 自動の範囲 | 熱図の色の自動の範囲（カラーバーの両端の数） | `webview/runtime/stagePanes.ts:stageRange`<br>`webview/runtime/stagePanes.ts:robustEdge`<br>`stage_view.py:_spectrogram_view` | 間引いた点（平均・切り出し）：熱図の matrix は時間のブロックごとにパワー平均したマス（_spectrogram_view、_roughness_view、_cepstrogram_view）。stageRange（ケプストログラムは robustEdge の 99 パーセント点）はその平均したマスから求め、カラーバーの両端に数として出る。 | なし | **P1** カラーバーの両端の数が、描くために平均したマスから来る。短く強いマスは平均で下がり、範囲の外に出る。 |
| 目盛り | 両軸の目盛りの値 | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲（または窓）から部品が決める。データには触れない。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | 両軸の名前（レベル・振幅・周波数・時間・帯・ラグ・ケフレンシー） | `webview/runtime/stagePanes.ts:stageAxes`<br>`webview/runtime/stagePanes.ts:amplitudeAxisTitle`<br>`webview/runtime/comparePanes.ts:paneAxes` | 文字：stageAxes が Frame の種類と単位と校正から名前を作る。dB は wandas のレベル基準で書く。 | `comparePanes.test.ts` › every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files<br>`comparePanes.test.ts` › the level axis is named by wandas' level reference, and says uncalibrated from the calibration status, not the unit<br>`stagePanes.test.ts` › a cross-channel picture names its pair on the value axis: the channel over its reference | <br>作業中：`claude/axis-quantity-unit` |
| 軸の名前 | 単位で名前の決まらない指標の値の軸（「値 [unit]」） | `webview/runtime/stagePanes.ts:stageAxes`<br>`webview/runtime/stagePanes.ts:metricName` | 文字：metricName は sone・acum・asper・dB 以外の単位を「値」とだけ書く。単位がなければ「値」だけになる。 | `stagePanes.test.ts` › a metric over time names what it measures on its value axis, from its unit | **P2** 量の名前がない（「値」）。単位もない指標では量も単位も書かれない。<br>作業中：`claude/axis-quantity-unit` |
| 軸の名前 | ケプストラムの値の軸（「実ケプストラム」） | `webview/runtime/stagePanes.ts:stageAxes` | 文字：axisCepstrum は量だけで単位を書かない（無次元）。 | `stagePanes.test.ts` › a cepstrum is drawn on a quefrency axis, symmetric about zero without its zero-quefrency coefficient | **P3** 無次元の量に単位の表記がない（「[-]」などがない）。 |
| 見出し・最大 | 上の行の注記（トリガーのイベント数、区間） | `webview/runtime/trackStagePainter.ts:stageModeHeadline`<br>`webview/runtime/stagePanes.ts:stageEventCounts` | 全データ：イベント数はバックエンドが切り出した全イベント（view.events）の数。区間は利用者が決めた値。差は書かない。 | `trackStagePainter.test.ts` › the headline names no difference (the row holds the pointer's readout): the steps bypassed and the region; nothing while computing<br>`uiSmoke/trackCompare.spec.ts` › a trigger added from ＋ fires at half the tracks' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events |  |
| 入力・設定の表示 | 区間の印と名札（「区間 a–b s」） | `webview/runtime/trackStageMode.ts:paintNow`<br>`webview/runtime/stagePanes.ts:paintRegion` | 利用者の値・メタデータ：区間のチップで決めた値を書く。 | `uiSmoke/trackCompare.spec.ts` › a region set with its chip compares only that part of the files, shows on the plots, and holding a step shows the comparison without it |  |

## 比較台の Δ 欄

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| Δ | Δ（比較 − 基準）の値そのもの | `stage_combine.py:combine` | 全データ：バックエンドが全ビン・全サンプルで引いてから描くために間引く。単位や校正やサンプリング周波数が違えば出さない。 | `test_stage_combine.py` › test_a_narrow_difference_is_taken_bin_by_bin_and_kept_when_drawn<br>`test_stage_combine.py` › test_a_time_signals_difference_is_compare_minus_base_sample_by_sample<br>`test_stage_combine.py` › test_values_in_other_units_have_no_difference_whatever_the_frame |  |
| 読み値 | Δ の読み値 | `webview/runtime/stagePanes.ts:lineRead`<br>`webview/runtime/stagePanes.ts:cellRead`<br>`webview/runtime/stageReader.ts:createStageReader`<br>`full_read.py:read_line` | 全データ：Δ の層の full は stageReader.combined(base, compare, 'diff')。バックエンドが全データの Δ からマウスのまわりを返す。 | `test_full_read.py` › test_a_difference_is_read_bin_by_bin<br>`fullRead.test.ts` › every line and image a plot draws says where its full data is read; bars are whole (R7) |  |
| ← / → | Δ の ← / → で進む先 | `webview/runtime/stagePanes.ts:stageStep` | 全データ：読み値と同じ全データの Δ の次の点。 | `plotHoverLayer.test.ts` › an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot's left edge (R7)<br>`fullRead.test.ts` › an arrow key crosses silent points past one fetched window to the next point with a value (R7)<br>`test_full_read.py` › test_a_difference_is_read_bin_by_bin | <br>作業中：`claude/contract-step-click` |
| 見出し・最大 | Δ の見出し（差が最大の位置と値） | `webview/runtime/stagePanes.ts:stageHeadline`<br>`webview/runtime/trackStagePainter.ts:paintStageOverlay` | 間引いた点（平均・切り出し）：stageHeadline は描く Δ の絵（plots.diff：間引いた線、熱図はブロックごとに平均したマス）の中で \|Δ\| が最大の点を探す。線は区間の最小・最大を残すので値は同じことが多いが、位置はその区間の点で、熱図では平均した値になる。 | `stagePanes.test.ts` › the Δ pane's headline names where the difference drawn is largest | **P1** 見出しの最大値と位置を描いた（間引いた）Δ から求めている。今のテストは「描いた Δ の最大」を確かめていて、全データの最大とは比べていない。<br>作業中：`claude/maxdelta-full` |
| 自動の範囲 | Δ の軸の自動の範囲（線） | `webview/runtime/stagePanes.ts:stageDiffRange`<br>`webview/runtime/stagePanes.ts:roundEdge` | 間引いた点（区間の最小・最大）：stageDiffRange は粗い Δ の絵（各区間の最小と最大）の端から ± を決める。 | なし | **P2** 範囲を間引いた Δ から求めている。全データの Δ の端と一致することを確かめるテストがない。 |
| 自動の範囲 | Δ の熱図の色の範囲（カラーバーの両端） | `webview/runtime/stagePanes.ts:stageDiffRange` | 間引いた点（平均・切り出し）：Δ の熱図の matrix はブロックごとに平均したマスで、その端を両端の数にする。 | なし | **P1** カラーバーの両端の数を、描くために平均した Δ のマスから求めている。 |
| 目盛り | Δ の軸の目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲から部品が決める。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | Δ の軸の名前（「Δ [dB]」） | `webview/runtime/stagePanes.ts:stageAxes` | 文字：dB の Δ は axisDelta（「Δ [dB]」）。何の Δ か（量）と基準を書かない。dB でない量は「Δ 量 [単位]」。 | `comparePanes.test.ts` › every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files | **P2** 「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。<br>作業中：`claude/axis-quantity-unit` |
| 入力・設定の表示 | Δ が出せない理由（見出しと図） | `webview/runtime/combineSource.ts:noDeltaNote` | 利用者の値・メタデータ：サンプリング周波数・単位・データの大きさの違いを理由として書く。数は出さない。 | `trackStagePainter.test.ts` › with no difference, the Δ headline says the same reason as its plot: other rates, other units, too much data |  |

## 比較台の横並びのレーン

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | 各レーンの読み値 | `webview/runtime/stagePanes.ts:stageHover`<br>`webview/runtime/stagePanes.ts:lineRead`<br>`webview/runtime/stagePanes.ts:cellRead`<br>`webview/runtime/trackStagePainter.ts:paintStageLanes` | 全データ：重ね図と同じ fullOf（stageReader.of）を各レーンの層に付ける。 | `fullRead.test.ts` › every line and image a plot draws says where its full data is read; bars are whole (R7)<br>`stagePanes.test.ts` › the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)<br>`trackStagePainter.test.ts` › side by side, every lane draws its own picture and says it shows the step; the base measured against says so |  |
| ← / → | 各レーンの ← / → | `webview/runtime/stagePanes.ts:stageStep` | 全データ：重ね図と同じ。 | `plotHoverLayer.test.ts` › an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot's left edge (R7)<br>`fullRead.test.ts` › an arrow key crosses silent points past one fetched window to the next point with a value (R7) | <br>作業中：`claude/contract-step-click` |
| 自動の範囲 | レーンが共有する値の軸の範囲（線） | `webview/runtime/stagePanes.ts:stageRange`<br>`webview/runtime/trackStagePainter.ts:paintStageLanes` | 間引いた点（区間の最小・最大）：全レーンの粗い絵（各区間の最小と最大）から 1 つの範囲を決める。 | なし | **P2** 範囲を間引いた線から求めている。全データの端と一致することを確かめるテストがない。 |
| 自動の範囲 | 熱図のレーンの色の範囲（カラーバーの両端） | `webview/runtime/stagePanes.ts:stageRange` | 間引いた点（平均・切り出し）：重ね図の熱図と同じく、ブロックごとに平均したマスから求める。 | なし | **P1** カラーバーの両端の数を、描くために平均したマスから求めている。 |
| 目盛り | 各レーンの目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲から部品が決める。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | 各レーンの両軸の名前 | `webview/runtime/stagePanes.ts:stageAxes` | 文字：重ね図と同じ stageAxes。 | `comparePanes.test.ts` › every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files | <br>作業中：`claude/axis-quantity-unit` |

## トリガーのイベント図の下のレーン

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | イベント図の下のレーン（録音の時間信号）の読み値 | `webview/runtime/stagePanes.ts:lineRead`<br>`webview/runtime/triggerLanes.ts:paintTriggerLanes` | 全データ：frame.fullOf（stageReader.of）で録音の全サンプルを読む。 | `uiSmoke/plotContract.spec.ts` › a trigger's events plot and the lanes under it answer the same gestures as every plot (R13)<br>`test_full_read.py` › test_a_signals_samples_are_read_one_by_one |  |
| ← / → | レーンの ← / → | `webview/runtime/stagePanes.ts:stageStep` | 全データ：全サンプルの次の点。 | `plotHoverLayer.test.ts` › an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot's left edge (R7)<br>`fullRead.test.ts` › an arrow key crosses silent points past one fetched window to the next point with a value (R7) | <br>作業中：`claude/contract-step-click` |
| 自動の範囲 | レーンの振幅の範囲（しきい値を含む） | `webview/runtime/triggerLanes.ts:paintTriggerLanes`<br>`webview/runtime/stagePanes.ts:stageRange`<br>`webview/plot/waveformLayer.ts:waveformRange` | 全データ：時間信号は absolutePeak（全サンプルの絶対値の最大）の ±1.05 倍に、しきい値が入るよう広げる。 | なし | **P2** レーンの範囲が全サンプルのピークとしきい値を含むことを確かめるテストがない。 |
| 目盛り | レーンの目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲から部品が決める。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | レーンの両軸の名前 | `webview/runtime/stagePanes.ts:stageAxes`<br>`webview/runtime/stagePanes.ts:amplitudeAxisTitle` | 文字：振幅（単位、未校正）と時間。 | `uiSmoke/plotContract.spec.ts` › a trigger's events plot and the lanes under it answer the same gestures as every plot (R13) |  |
| 数 | 使ったイベントの数と全体の数（角の表示）、しきい値の名札 | `webview/runtime/triggerLanes.ts:paintTriggerLanes` | 全データ：数はバックエンドが切り出した全イベントと除いたものの数。しきい値は利用者の値。 | `uiSmoke/trackCompare.spec.ts` › a trigger added from ＋ fires at half the tracks' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events |  |

## トラックの波形レーン

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | 波形レーンの読み値（名前・時刻・振幅） | `webview/runtime/trackLaneHover.ts:laneReadoutText`<br>`webview/runtime/stagePanes.ts:lineRead`<br>`webview/runtime/laneReads.ts:createLaneReads`<br>`analysis_service.py:waveform_range` | 全データ：laneReads.waveform がファイルの全サンプルからマウスのまわりを取り寄せる。描いた包絡は読まない。 | `trackLaneHover.test.ts` › the pointer on a track lane reads the file's own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)<br>`fullRead.test.ts` › a dense waveform is read at its real samples: a sample not drawn, and every sample by the arrow keys (R7)<br>`test_full_read.py` › test_a_lane_reads_its_files_own_samples_and_stft_cells |  |
| ← / → | 波形レーンの ← / →（1 サンプルずつ） | `webview/runtime/stagePanes.ts:stageStep` | 全データ：全サンプルの次の点。 | `trackLaneHover.test.ts` › the pointer on a track lane reads the file's own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)<br>`trackPointerEvents.test.ts` › a lane with the keyboard focus keeps ← / → for its time cursor, even with the pointer on it; the pointer on another lane steps that one's readout (R7) | <br>作業中：`claude/contract-step-click` |
| 自動の範囲 | 振幅の軸の範囲 | `webview/runtime/comparisonRuntime.ts:laneAmplitudeAxis`<br>`webview/runtime/comparisonRuntime.ts:amplitudeScaleFor`<br>`webview/runtime/laneAxes.ts:laneAmplitudeRange`<br>`decimator.py:decimated_waveform` | 全データ：absolutePeak（全サンプルの絶対値の最大、間引く前に求める）か、つないだ録音で共有するピークから決める。 | `test_decimator.py` › test_absolute_peak<br>`laneAxes.test.ts` › a waveform lane's amplitude ticks sit where the waveform draws their values, zoomed or not |  |
| 目盛り | 振幅の目盛り | `webview/runtime/laneAxes.ts:laneAmplitudeTicks`<br>`webview/runtime/stagePanes.ts:valueAxisTicks` | 軸の範囲・窓：範囲から、どのグラフとも同じ規則で決める。 | `laneAxes.test.ts` › a waveform lane's amplitude ticks sit where the waveform draws their values, zoomed or not<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | 振幅の軸の名前 | `webview/runtime/stagePanes.ts:amplitudeAxisTitle`<br>`webview/runtime/comparisonRuntime.ts:laneAmplitudeAxis` | 文字：量・単位・校正を比較台の波形と同じく書く。 | `laneAxes.test.ts` › a lane axis names its quantity, unit and calibration as Compare's waveform axis does |  |
| 自動の範囲 | 軸のダブルクリックで開く範囲の欄の値（振幅・スペクトログラムの周波数と色） | `webview/runtime/comparisonRuntime.ts:field` | 軸の範囲・窓：今描いている範囲を有効数字 4 桁で書く。 | `uiSmoke/waveformAmplitudeRange.spec.ts` › double-clicking the waveform amplitude axis sets the vertical range from a popover |  |

## トラックのスペクトログラムのレーン

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | スペクトログラムのレーンの読み値（時刻・周波数・レベル） | `webview/runtime/trackLaneHover.ts:spectrogramReadoutText`<br>`webview/runtime/stagePanes.ts:cellRead`<br>`webview/runtime/laneReads.ts:createLaneReads` | 全データ：laneReads.spectrogram が本当の STFT のマスを取り寄せる。描くための平均したマスは読まない。 | `trackLaneHover.test.ts` › the pointer on a spectrogram lane reads the real STFT cell under it, not the cell averaged to draw it, and ← / → the next frame (R7)<br>`uiSmoke/spectrogramZoom.spec.ts` › a spectrogram lane boxed to a narrow band asks for that band's own bins and draws and reads them, not the whole range's rows stretched (R3) |  |
| ← / → | スペクトログラムの ← / →（次のフレーム） | `webview/runtime/stagePanes.ts:imageStep` | 全データ：本当のマスの次の列。 | `fullRead.test.ts` › a spectrogram is read at its real cells, never the cells averaged to draw it, and stepped a frame at a time (R7) | <br>作業中：`claude/contract-step-click` |
| 自動の範囲 | 色の自動の範囲（カラーバーの両端の数） | `webview/runtime/spectrogramRaster.ts:spectrogramDisplayBounds`<br>`analyzer.py:_build_spectrogram` | 間引いた点（平均・切り出し）：spec.minDb / maxDb は _build_spectrogram が時間と周波数をパワー平均して表示用に縮めたマス（_resample_time_bins、resample_frequency_bins）の最小と最大。niceRange で丸めてカラーバーの両端に出す。 | `uiSmoke/colourRangeRounding.spec.ts` › the auto colour scale opens with round dB ends, and typed ends are kept as typed | **P1** カラーバーの両端の数が、表示用に平均したマスから来る。テストは丸めだけを見ていて、全 STFT の最小・最大と比べていない。 |
| 目盛り | 周波数の目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：周波数の範囲（ナイキストか入れた範囲）から部品が決める。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | 周波数の軸と色の名前 | `webview/runtime/trackCanvasPainter.ts:paintTrackSpectrogram` | 文字：周波数 [Hz]、色はレベルの名前と基準。 | `trackCanvasPainter.test.ts` › a spectrogram lane is drawn by the plot component over its whole width, with the colour bar every coloured picture draws in its top right (R13)<br>`uiSmoke/plotContract.spec.ts` › the track view's waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13) |  |

## トラックのレーンの軸（振幅・周波数の軸、上の時間の目盛り）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 目盛り | 時間の目盛り（上の定規）と横の軸のキャンバスの目盛り | `webview/runtime/comparisonRuntime.ts:renderRuler`<br>`webview/runtime/laneAxes.ts:laneTimeTicks`<br>`webview/runtime/stagePanes.ts:paintSideAxis` | 軸の範囲・窓：見えている時間の窓から、比較台と同じ規則で決める。 | `laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | 時間の軸の名前（定規の右端） | `webview/runtime/comparisonRuntime.ts:renderRuler` | 文字：「時間 [s]」。 | `laneAxes.test.ts` › a lane axis names its quantity, unit and calibration as Compare's waveform axis does |  |

## トラックの見出しとツールバーの数（カーソルの時刻、ずらし、ピーク、解析窓）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 要約の値 | チャンネルのピーク（振幅とレベル） | `webview/runtime/calibrationDecorations.ts:channelMetricSummaryHtml`<br>`webview/runtime/calibrationDecorations.ts:levelText`<br>`webview/runtime/calibrationDecorations.ts:peakText`<br>`analyzer.py:analyze_from_frame` | 全データ：バックエンドが全サンプルのピークと wandas のレベルを返し、webview は計算し直さない。 | `renderScript.integration.test.ts` › renderScript: channel peak metrics use backend-provided levels without recalculating dB<br>`calibrationContracts.test.ts` › calibration row helpers draw badges, peak text, requests and the overlay guard |  |
| 要約の値 | チャンネル数とサンプリング周波数（kHz） | `webview/runtime/trackLaneHtml.ts:trackRowHtml` | 利用者の値・メタデータ：ファイルのメタデータ。 | なし | **P3** 「48.0kHz」の書き方が読み値の決まり（plotText.ts）と違い、確かめるテストもない。 |
| 入力・設定の表示 | カーソルの時刻、再生の時刻、ループの範囲 | `webview/runtime/comparisonRuntime.ts:updateCursorDisplay`<br>`webview/runtime/comparisonRuntime.ts:refreshSpectrumViews`<br>`webview/runtime/playbackDisplay.ts:update`<br>`webview/runtime/waveformInteraction.ts:loopRegionClockText` | 利用者の値・メタデータ：カーソル・再生・ループの位置（利用者の操作）を m:ss.ss で書く。 | `uiSmoke/toolbar.spec.ts` › the cursor readout is labelled and follows a loop drag to where it was released<br>`playbackDisplay.test.ts` › createPlaybackDisplay shows the prefixed clock time while playing and hides it when stopped<br>`sharedFormat.test.ts` › time and channel labels share one implementation |  |
| 入力・設定の表示 | トラックのずらし（+0.000s） | `webview/runtime/comparisonRuntime.ts:updateOffsetDisplays` | 利用者の値・メタデータ：利用者が入れたずらし。 | `renderScript.integration.test.ts` › renderScript: Enter commits inline offset edit |  |
| 入力・設定の表示 | 解析窓の時刻の範囲と長さ（ms） | `webview/runtime/comparisonRuntime.ts:analysisWindowCaption` | 全データ：バックエンドがスライスに付けた窓の始まりと終わり（windowStartNorm / EndNorm）。 | `uiSmoke/analysisWindow.spec.ts` › analysis window band follows the cursor on the waveform only and the header names it |  |

## トラック表示の PNG 書き出し

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 書き出し | PNG に写るレーンの絵と軸の数 | `webview/runtime/exportDownloads.ts:composeTrackCanvases` | 軸の範囲・窓：画面のレーンと軸のキャンバスを写す。新しく数を作らない（数はそれぞれのレーンの行のとおり）。 | `uiSmoke/laneCulling.spec.ts` › the PNG export draws every lane: it asks for the spectrograms of lanes out of view and is saved once they are answered |  |

## カーソルスペクトル

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | 読み値（周波数・レベル） | `webview/runtime/spectrumRuntime.ts:spectrumReadoutValues`<br>`webview/runtime/spectrumRuntime.ts:spectrumReadoutText`<br>`webview/runtime/overlaySpectrumPainter.ts:readout`<br>`webview/runtime/overlaySpectrumPainter.ts:spectrumLayer`<br>`webview/runtime/comparisonRuntime.ts:renderOverlaySpectrum`<br>`webview/runtime/laneReads.ts:createLaneReads` | 全データ：表示用に切ったスライスは laneReads.slice で全ビンの行を読み直し、全ビンの行はその場で読む（localLine）。帯は全帯。 | `overlaySpectrumPainter.test.ts` › a slice too dense to draw whole is read at its real bins: a bin thinned out of the line, and every bin by the arrow keys (R7)<br>`fullRead.test.ts` › a cursor spectrum read at its real bins writes its frequency to the digits those bins need, not the drawn points' (R7)<br>`test_known_answers.py` › test_the_cursor_spectrums_cut_row_and_every_bin_row_read_the_same_peaks |  |
| ← / → | ← / → で進む先（次のビン） | `webview/runtime/stagePanes.ts:stageStep` | 全データ：全ビンの行の次のビン。 | `overlaySpectrumPainter.test.ts` › an arrow key reads the next bin the cursor spectrum drew, from the one the pointer read (R7)<br>`overlaySpectrumPainter.test.ts` › a slice too dense to draw whole is read at its real bins: a bin thinned out of the line, and every bin by the arrow keys (R7) | <br>作業中：`claude/contract-step-click` |
| 重ねる順 | 重ねる順（静かな線が上） | `webview/runtime/overlaySpectrumPainter.ts:spectrumLayer`<br>`webview/runtime/stagePanes.ts:levelBinsOf`<br>`webview/runtime/stagePanes.ts:overlayOrder` | 間引いた点（平均・切り出し）：spectrumLayer は手元の xs / values から levelBins を作る。表示用に切ったスライス（frequenciesHz があるもの：バックエンドが各区間の最小・最大のビンだけを残した行）では、それは描く点で、全ビンのパワーではない。 | `stagePanes.test.ts` › a cursor spectrum on a linear axis counts its 0 Hz bin in its level (R6) | **P1** 表示用に切ったスライスの順を、間引いた点のパワーで決めている（全ビンのパワーではない）。<br>作業中：`claude/level-order-exact` |
| 自動の範囲 | レベルの軸の自動の範囲（左右の軸） | `webview/runtime/spectrumRuntime.ts:spectrumSeriesRange`<br>`webview/runtime/spectrumRuntime.ts:overlayLevelAxes`<br>`webview/runtime/comparisonRuntime.ts:applySpectrumDisplaySettings`<br>`analysis_service.py:spectrum_slice` | 間引いた点（区間の最小・最大）：slice.minDb / maxDb はバックエンドが min_max_spectrum で切った行（各区間の最小・最大のビン）の最小と最大。端は全ビンと同じ。niceRange で丸める。 | `renderScript.integration.test.ts` › renderScript: lazy spectrum slices apply display range settings | **P2** 範囲を切った行から求めている。全ビンの最小・最大と一致することを確かめるテストがない。 |
| 目盛り | 周波数とレベルの目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲から部品が決める。 | `overlaySpectrumPainter.test.ts` › zoomed between two log ticks, the frequency axis still labels where it is |  |
| 軸の名前 | 周波数とレベルの軸の名前、凡例の頭のレベルの名前 | `webview/runtime/overlaySpectrumPainter.ts:paintOverlaySpectrum`<br>`webview/runtime/overlaySpectrumPainter.ts:renderSpectrumAxisLegend` | 文字：レベルは比較台と同じ名前（基準・未校正）、周波数 [Hz]。 | `uiSmoke/spectrumOctaveBands.spec.ts` › the cursor spectrum names its level axis as Compare does, uncalibrated, and its lines in a legend<br>`overlaySpectrumPainter.test.ts` › paintOverlaySpectrum names the frequency axis at the right end of its ticks, as the comparison does |  |

## カーソルスペクトルの CSV 書き出し

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 書き出し | CSV の周波数とレベル | `webview/runtime/runtimeExports.ts:buildSpectrumCsv`<br>`webview/runtime/comparisonRuntime.ts:writeCsvWhenDetailed` | 全データ：トラックの中では、バックエンドの全ビンの行だけを書く。表示用に切った行は待つか、書かずにそう言う。 | `renderScript.integration.test.ts` › renderScript: export-csv replaces a cursor spectrum cut for display with every FFT bin<br>`runtimeExports.test.ts` › spectrum CSV writes every FFT bin of a whole row at fs / n_fft spacing |  |

## ペアの図（利得・位相・γ²）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | 利得・位相・γ² の読み値 | `webview/runtime/pairSpectrum.ts:pairLanes`<br>`webview/runtime/stagePanes.ts:lineRead`<br>`analysis_service.py:pair_spectrum` | 描く点が全部（間引かない）：バックエンドが全ビンをそれぞれの周波数で返し、図はその全部をつなぐ（full: 'drawn'）。 | `pairSpectrum.test.ts` › the plot under the pointer reads its nearest line in the row above, in its unit, and the others follow its frequency (R7, R8)<br>`test_analysis_service.py` › test_pair_spectrum_keeps_every_bin_at_its_own_frequency_so_a_narrow_notch_stays |  |
| ← / → | ← / → で進む先 | `webview/runtime/stagePanes.ts:stageStep`<br>`webview/runtime/stagePanes.ts:stageNeighbour` | 描く点が全部（間引かない）：描いた次のビン（全ビン）。 | `uiSmoke/plotContract.spec.ts` › the pair view's gain, phase and γ² plots answer the same gestures as every plot (R13) | <br>作業中：`claude/contract-step-click` |
| 重ねる順 | 利得の線の重ねる順 | `webview/runtime/pairSpectrum.ts:lines`<br>`webview/runtime/stagePanes.ts:levelBinsOf` | 全データ：利得の levelBins を見えている周波数の全ビンから作る。 | なし | **P2** ペアの利得の levelBins が全ビンから作られ、静かな応答が上に来ることを確かめるテストがない（部品の一般のテストだけ）。 |
| 自動の範囲 | 利得の軸の自動の範囲 | `webview/runtime/pairSpectrum.ts:gainRange` | 全データ：見えている周波数の全ビンの利得の最小・最大の中心から ±（幅の 1.1 倍の半分、少なくとも 3 dB）。端を切りのよい値に広げない。 | なし | **P2** 範囲を確かめるテストがなく、R9（自動の範囲は切りのよい値）を守っていない。 |
| 目盛り | 目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲から部品が決める（位相は ±180°、γ² は 0〜1）。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | 周波数・利得・位相の軸の名前 | `webview/runtime/pairSpectrum.ts:pairLanes` | 文字：利得はバックエンドの axisLabel、位相 [°]、周波数 [Hz]。 | `pairSpectrum.test.ts` › the pair view is three plots on one frequency axis, each named with its quantity and unit, drawing ok responses only |  |
| 軸の名前 | コヒーレンスの軸の名前（「γ²」） | `webview/runtime/pairSpectrum.ts:pairLanes` | 文字：pairCoherenceLabel は記号だけで、量の名前と単位（無次元）を書かない。 | `pairSpectrum.test.ts` › the pair view is three plots on one frequency axis, each named with its quantity and unit, drawing ok responses only | **P3** 記号「γ²」だけで、量（コヒーレンス）の名前と無次元の表記がない。 |
| 要約の値 | 見出し（H1・平均回数・時間の範囲） | `webview/runtime/pairSpectrum.ts:pairHeader`<br>`webview/runtime/pairSpectrum.ts:formatSeconds` | 全データ：バックエンドが返した各応答の平均回数（最少）と範囲。 | `pairSpectrum.test.ts` › the header shows the fewest averages and the whole averaged range, warning below 8 |  |

## カラーバー（比較台の熱図、スペクトログラムのレーン、入口の概観帯）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 目盛り | カラーバーの両端の数の書き方 | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:endText`<br>`webview/runtime/stagePanes.ts:levelTick` | 軸の範囲・窓：呼ぶ側の範囲の両端を書く（範囲の出どころは各熱図の range の行）。 | `stagePanes.test.ts` › a colour or value range not in dB is widened to round ends, as a dB range is |  |
| 軸の名前 | カラーバーの名前（量・単位・基準） | `webview/runtime/stagePanes.ts:paintColourBar`<br>`webview/runtime/stagePanes.ts:stageAxes` | 文字：熱図の色が表す量・単位・基準。狭いと単位だけにし、それも入らなければ書かない。 | `stagePanes.test.ts` › a heatmap names what its colour measures, with its unit and reference, for its colour bar<br>`stagePanes.test.ts` › a colour bar stays inside a narrow plot: its name shrinks to the unit, then is left out |  |

## 入口の保持図（スロットの Δ、手順の有無の Δ、平均スペクトル）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | 保持図の読み値 | `webview/runtime/stagePanes.ts:lineRead`<br>`webview/runtime/entryHeldPlot.ts:paintStep`<br>`webview/runtime/entryHeldPlot.ts:paintDelta` | 全データ：手順の絵は reader.of、手順の有無の Δ は reader.combined、スロットの Δ は全ビンの Δ を localLine で読む。全ビンがないときの帯の Δ は棒（全帯）。 | `uiSmoke/heldDelta.spec.ts` › a held slot draws its own channel's Δ against its base from every bin the hold asks for (R1, R3, R11)<br>`uiSmoke/plotContract.spec.ts` › the entry's held plot answers the same gestures as every plot (R13) |  |
| ← / → | 保持図の ← / → | `webview/runtime/stagePanes.ts:stageStep` | 全データ：読み値と同じ全データの次の点。 | `uiSmoke/plotContract.spec.ts` › the entry's held plot answers the same gestures as every plot (R13) | <br>作業中：`claude/contract-step-click` |
| Δ | スロットの Δ（全ビン）と手順の有無の Δ | `webview/runtime/comparePanes.ts:binsOf`<br>`webview/runtime/comparePanes.ts:fileSide`<br>`webview/runtime/comparePanes.ts:deltaViews`<br>`webview/runtime/combineSource.ts:createCombineSource` | 全データ：スロットは押したときに録音と基準の全ビンを取り寄せ、ビンごとに引く（0.01 dB に丸める）。手順の有無はバックエンドが全データで引く。 | `entryHeldPlot.test.ts` › a held slot asks once for every bin of its file and its base, then draws its Δ from them (R1, R3)<br>`comparePanes.test.ts` › the held Δ zoomed in is drawn again from every bin between its ends, not the whole Δ decimated and stretched (R1, R3)<br>`comparePanes.test.ts` › the median and Δ are taken bin by bin from every bin, and only drawing decimates them |  |
| 自動の範囲 | 保持図の値の軸の範囲 | `webview/runtime/entryHeldPlot.ts:paintStep`<br>`webview/runtime/entryHeldPlot.ts:paintDelta`<br>`webview/runtime/stagePanes.ts:stageRange`<br>`webview/runtime/stagePanes.ts:stageDiffRange` | 間引いた点（区間の最小・最大）：手順の絵は粗い絵（stageRange）、スロットの Δ は binsView で間引いた Δ（stageDiffRange）、手順の有無の Δ は全体の Δ の絵から決める。どれも各区間の最小・最大を残した点。 | なし | **P2** 範囲を間引いた点から求めている。全データの端と一致することを確かめるテストがない。 |
| 目盛り | 保持図の目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲から部品が決める。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | 保持図の軸の名前（Δ は「Δ [dB]」） | `webview/runtime/stagePanes.ts:stageAxes` | 文字：比較台と同じ stageAxes。Δ は何の差かと基準を書かない。 | `uiSmoke/plotContract.spec.ts` › the entry's held plot answers the same gestures as every plot (R13) | **P2** 「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。<br>作業中：`claude/axis-quantity-unit` |

## 入口の概観帯

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | 概観帯の読み値（録音・帯・レベル） | `webview/runtime/entryPlots.ts:overviewCells`<br>`webview/runtime/stagePanes.ts:cellRead` | 全データ：描く絵は行が多いと画素の行ごとに一番大きい帯のレベルにするが、読み値は表の本当の行（overviewCells）を読む。 | `uiSmoke/entry.spec.ts` › the overview strip has a row per channel, as the table does: its readout names the channel of a recording of several<br>`uiSmoke/plotContract.spec.ts` › the entry's overview strip answers the same gestures as every plot (R13) |  |
| ← / → | 概観帯の ← / →（次の帯） | `webview/runtime/stagePanes.ts:imageStep` | 全データ：表の本当の行の次の帯。 | `uiSmoke/plotContract.spec.ts` › the entry's overview strip answers the same gestures as every plot (R13) | <br>作業中：`claude/contract-step-click` |
| 自動の範囲 | 色の範囲（カラーバーの両端） | `webview/runtime/entryPlots.ts:overviewPicture` | 全データ：表のすべての行のすべての帯のレベルの最小と最大を 1 dB に切り下げ・切り上げる（niceRange ではない）。 | なし | **P2** 範囲を確かめるテストがない。端の丸めも R9 の切りのよい値（niceRange）ではない。 |
| 目盛り | 帯と行の目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：行は表の上からの番号（yTickText）。 | `entrySidePlots.test.ts` › the strip is a heatmap of the table: a row per table row counted down from the top, the loudest per line when they outnumber its lines |  |
| 軸の名前 | 帯・行・色の名前 | `webview/runtime/entryPlots.ts:paintOverview` | 文字：帯域中心 [Hz]、行（表の順）、色はレベルと共有の基準。 | `entrySidePlots.test.ts` › the overview colour scale and the dataset table name the recordings' shared level reference, plain dB once they differ |  |

## 入口の分布図（群ごとの行と下の値の軸）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 読み値 | 分布図の読み値（ビンの範囲と数、点の録音と値、スロット、基準の中央値） | `webview/runtime/entryDistribution.ts:distributionRows`<br>`webview/runtime/entryTableHtml.ts:plotValueText`<br>`webview/runtime/entryRuntime.ts:format` | 描く点が全部（間引かない）：ビン・点・目盛りのしるしは間引かず全部描く（full: 'drawn'）。値は表の値（スキャンの全データの値）。 | `plotText.test.ts` › the distribution reads a value as a plot does, not as the table column writes it (R7)<br>`plotText.test.ts` › neighbouring distribution bins never read the same: the bins' width adds the digits it needs (R7)<br>`entryDistributionPane.test.ts` › each group is a row of the plot component: its dots, its slots and the base on it |  |
| ← / → | 分布図の ← / → | `webview/runtime/stagePanes.ts:stageStep` | 描く点が全部（間引かない）：描いた次のビン・点。 | `uiSmoke/plotContract.spec.ts` › the entry's distribution answers the same gestures as every plot: each group's row, on the value axis below them (R13) | <br>作業中：`claude/contract-step-click` |
| 数 | ビンの数、群の数、「最大 n」、選んだ行の数 | `webview/runtime/entryDistribution.ts:distributionRows`<br>`shared/dataset/distribution.ts:binCounts`<br>`webview/runtime/entryDistributionPane.ts:paint`<br>`webview/runtime/entryRuntime.ts:pick` | 全データ：群のすべての行を数える。 | `distribution.test.ts` › bins line up across groups; the range marks what it takes<br>`distribution.test.ts` › a CSV value counts each recording once per group; a computed one counts channels and says how many are not computed |  |
| 中央値 | 基準の群の中央値の線 | `webview/runtime/entryDistribution.ts:distributionRows`<br>`shared/dataset/distribution.ts:median` | 全データ：群のすべての値の中央値。 | `distribution.test.ts` › groups sort by number when numeric, as text otherwise, the blank last; the median of an even count is the mean of the middle two |  |
| 自動の範囲 | 値の軸の範囲 | `shared/dataset/distribution.ts:distribution` | 全データ：すべての値の端を niceRange で広げる。 | `distribution.test.ts` › the distribution's value axis opens at round ends, as every automatic range does (R9)<br>`distribution.test.ts` › a range far narrower than its values keeps ends that hold every value, never rounded inward past them (R9) |  |
| 目盛り | 値の軸の目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲から部品が決める。 | `distribution.test.ts` › ticks fall on round values without floating-point drift |  |
| 軸の名前 | 値の軸と縦の名前 | `webview/runtime/entryDistributionPane.ts:paint` | 文字：値の名前（「Leq A特性 [基準]」など）と「縦：{単位}数（群ごと）」。 | `uiSmoke/plotContract.spec.ts` › the entry's distribution answers the same gestures as every plot: each group's row, on the value axis below them (R13) |  |
| 軸の名前 | CSV の列の値の軸（「{列}（CSV の列）」） | `webview/runtime/entryDistributionPane.ts:paint` | 文字：CSV の列は単位がわからず、列の名前だけを書く。 | なし | **P3** CSV の列の値の軸に単位がない（列の名前に単位がなければ量だけ）。 |

## 入口の表（値の列、Δ、見出しの数、D の差、表の CSV）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 要約の値 | 表の値の列（Leq、ピーク周波数、波高率、帯）と凡例の値 | `webview/runtime/entryTableHtml.ts:formatValue`<br>`webview/runtime/entryTableHtml.ts:datasetRowsHtml`<br>`webview/runtime/entryRuntime.ts:formatColumn`<br>`webview/runtime/entryTable.ts:fileValues`<br>`webview/runtime/entryTable.ts:bandLevels`<br>`scan_service.py:measure` | 全データ：スキャンが Frame の全サンプル・全ビンから求めた値（ピークは Welch の全ビン、帯は noct_spectrum）。チャンネルはパワー平均。 | `test_scan_service.py` › test_scan_measures_the_analysis_spec_metrics<br>`entryTable.test.ts` › unreadable files and files of another shape show no numbers |  |
| Δ | 表の Δ（条件の他のファイルの中央値に対して）と最大の帯 | `webview/runtime/entryTable.ts:buildEntryModel`<br>`webview/runtime/entryTable.ts:maxBandDelta`<br>`webview/runtime/entryTable.ts:mostTellingBand` | 全データ：スキャンの全データの値と、その中央値。 | `entryTable.test.ts` › rows get Δ from the median of their condition's other files, never an outlier mark<br>`entryTable.test.ts` › on the scanned entry100 fixture the three resonances stand 10 dB above their groups at 3.15 kHz, one ✕ and one ≠ |  |
| Δ | D で固定した差（行の下の「└ Δ」） | `webview/runtime/entryRuntime.ts:derivedItems` | 全データ：固定したスキャンの Leq・帯（全データ）とその基準の差。 | `entryTable.test.ts` › a derived row sits under its parent with the parent's condition and Δ against its own base, and counts toward no group |  |
| 数 | 見出し・フィルタ・チェックの一覧の数 | `webview/runtime/entryTableHtml.ts:datasetHeadHtml`<br>`webview/runtime/entryTableHtml.ts:trackHeadHtml`<br>`webview/runtime/entryTableHtml.ts:filterChipsHtml`<br>`webview/runtime/entryTableHtml.ts:checkListHtml`<br>`webview/runtime/entryTableHtml.ts:say` | 全データ：表のすべての行を数える。 | なし | **P2** 見出しやフィルタの数がすべての行を数えていることを確かめるテストがない。 |
| 入力・設定の表示 | 比べられない理由（≠ の kHz など）と区間の名札 | `webview/runtime/entryTable.ts:mismatchLabel`<br>`webview/runtime/entryTable.ts:regionLabel` | 利用者の値・メタデータ：ファイルのメタデータと利用者の区間。 | `entryTable.test.ts` › on the scanned entry100 fixture the three resonances stand 10 dB above their groups at 3.15 kHz, one ✕ and one ≠ |  |
| 書き出し | 表の CSV | `webview/runtime/entryTable.ts:entryCsv`<br>`webview/runtime/entryTable.ts:csvCell`<br>`webview/runtime/entryTable.ts:dB`<br>`webview/runtime/entryTable.ts:regionCells` | 全データ：表と同じ全データの値を決まった桁で書く。 | `entryTable.test.ts` › the CSV has the agreed columns, a BOM, and the same bytes every time |  |

## レポートの重ね図（比較 n.png、要約.png の上段）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 見出し・最大 | 図の題（見出しの帯と Leq の両方のレベル） | `webview/runtime/comparePanes.ts:levelsHeadline`<br>`webview/runtime/comparePanes.ts:pair`<br>`webview/runtime/comparePanes.ts:buildCompareModel`<br>`webview/runtime/comparePanes.ts:medianSide`<br>`webview/runtime/comparePanes.ts:spreadOf`<br>`webview/runtime/compareReport.ts:reportFiles` | 全データ：帯と Leq はスキャンの全データの値（群は帯ごとの中央値）。 | `comparePanes.test.ts` › the headline gives both levels, and a band far below the loudest does not head it however large its Δ<br>`comparePanes.test.ts` › a tone that leaks into the neighbouring bands heads the list alone: only peaks of \|Δ\| across bands count |  |
| 重ねる順 | 基準と比較の重ねる順 | `webview/runtime/comparePanes.ts:binsView`<br>`webview/runtime/comparePanes.ts:sideView` | 全データ：binsView は全ビンから levelBins を作り、描く線だけを間引く。帯は全帯。 | なし | **P2** レポートの図の順が全ビンのパワーで決まることを確かめるテストがない。 |
| 自動の範囲 | レベルの軸の範囲 | `webview/runtime/compareReport.ts:paintOverlayFigure`<br>`webview/runtime/stagePanes.ts:stageRange` | 間引いた点（区間の最小・最大）：binsView で 640 区間の最小・最大に間引いた線から stageRange で決める。 | なし | **P2** 範囲を間引いた線から求めている。全ビンの端と一致することを確かめるテストがない。 |
| 目盛り | 目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲から部品が決める。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | 軸の名前 | `webview/runtime/comparePanes.ts:paneAxes` | 文字：レベル（基準・未校正）と周波数。 | `comparePanes.test.ts` › every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files |  |

## レポートの Δ 図（差 n.png、要約.png の下段）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 見出し・最大 | 図の題（見出しの帯の Δ と Leq の Δ） | `webview/runtime/comparePanes.ts:diffHeadline`<br>`webview/runtime/comparePanes.ts:buildCompareModel`<br>`webview/runtime/compareReport.ts:reportFiles` | 全データ：帯の Δ = round(比較, 0.1) − round(基準, 0.1)、スキャンの全データの帯から。 | `comparePanes.test.ts` › a tone that leaks into the neighbouring bands heads the list alone: only peaks of \|Δ\| across bands count<br>`comparePanes.test.ts` › against one base file, a band within the chance spread of its condition is not headline material |  |
| 自動の範囲 | Δ の軸の範囲 | `webview/runtime/compareReport.ts:deltaFigure`<br>`webview/runtime/stagePanes.ts:stageDiffRange` | 間引いた点（区間の最小・最大）：全ビンの Δ を binsView で間引いた線と帯の Δ から決める。帯だけのときは全帯。 | `comparePanes.test.ts` › the report's Δ figure without bins draws the 1/3-octave Δ, its range holding every band (R1) | **P2** 全ビンがあるときの範囲を間引いた線から求めている。テストは帯だけの場合しか見ていない。 |
| 目盛り | 目盛り | `webview/runtime/stagePanes.ts:paintPlot`<br>`webview/runtime/stagePanes.ts:valueAxisTicks`<br>`webview/runtime/stagePanes.ts:valueTickTexts`<br>`webview/runtime/stagePanes.ts:alongAxisTicks`<br>`webview/runtime/stagePanes.ts:rowAxisTicks`<br>`webview/runtime/stagePanes.ts:tickText`<br>`webview/runtime/stagePanes.ts:levelTick`<br>`webview/runtime/stagePanes.ts:paintRightAxis` | 軸の範囲・窓：範囲から部品が決める。 | `stagePanes.test.ts` › levels share a range of four round steps; coherence keeps 0 to 1<br>`laneAxes.test.ts` › the lanes take the ticks and their text from the rules every plot uses |  |
| 軸の名前 | Δ の軸の名前（「Δ [dB]」） | `webview/runtime/comparePanes.ts:paneAxes` | 文字：paneAxes の delta は「Δ [dB]」。 | `comparePanes.test.ts` › every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files | **P2** 「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。<br>作業中：`claude/axis-quantity-unit` |

## レポートの 要約.png の頭書き・報告.csv・定義.json

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 書き出し | 報告.csv（最大の帯、Leq、基準の Leq、帯ごとの Δ、群の数、D の行） | `webview/runtime/compareReport.ts:reportCsv`<br>`webview/runtime/compareReport.ts:maxBandCells`<br>`webview/runtime/compareReport.ts:dB`<br>`webview/runtime/compareReport.ts:bandLevel` | 全データ：スキャンの全データの帯と Leq（群は中央値）、dB は 0.1 まで。 | `benchReport.test.ts` › 報告.csv has one row per slot in the agreed columns: dB to one decimal, Hz whole, missing values empty<br>`benchReport.test.ts` › the report says what the comparison was taken from: the value, the filters, each base with its channel, the memo, and the D rows |  |
| 入力・設定の表示 | 要約.png の頭書きと図の題の区間 | `webview/runtime/compareReport.ts:summaryPng`<br>`webview/runtime/compareReport.ts:regionText` | 利用者の値・メタデータ：利用者の区間（測った区間はファイルの端の 0.15 s を除く）。 | `benchReport.test.ts` › the report Recipe carries the region as its time slice and still loads in wandas |  |

## 解析レポート（Markdown）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 書き出し | Markdown のレポートの数（長さ、ピーク、レベル） | `shared/report/analysisReport.ts:buildMarkdownReport`<br>`shared/report/analysisReport.ts:formatReportDb`<br>`shared/report/analysisReport.ts:reportLevel` | 全データ：バックエンドの全サンプルのピークとレベル、ファイルの長さ。 | `analysisReport.test.ts` › markdown report is a pure function of tracks, loop region and time<br>`renderScript.integration.test.ts` › renderScript: multichannel report lists peak metrics for every channel |  |

## 穴の一覧

### P1（6）

- `compare-overlay.range-image`：カラーバーの両端の数が、描くために平均したマスから来る。短く強いマスは平均で下がり、範囲の外に出る。
- `compare-delta.headline`：見出しの最大値と位置を描いた（間引いた）Δ から求めている。今のテストは「描いた Δ の最大」を確かめていて、全データの最大とは比べていない。（作業中：`claude/maxdelta-full`）
- `compare-delta.range-image`：カラーバーの両端の数を、描くために平均した Δ のマスから求めている。
- `compare-lanes.range-image`：カラーバーの両端の数を、描くために平均したマスから求めている。
- `track-spectrogram.range`：カラーバーの両端の数が、表示用に平均したマスから来る。テストは丸めだけを見ていて、全 STFT の最小・最大と比べていない。
- `cursor-spectrum.order`：表示用に切ったスライスの順を、間引いた点のパワーで決めている（全ビンのパワーではない）。（作業中：`claude/level-order-exact`）

### P2（18）

- `compare-overlay.readout-events`：イベントの線の読み値と ← / → がそのイベントの全サンプルから来ることを確かめるテストがない（ジェスチャのテストは数字の出どころを見ない）。
- `compare-overlay.range`：範囲の端を間引いた線から求めている。間引きが端を残すので同じ値のはずだが、範囲が全データの端と一致することを確かめるテストがない。
- `compare-overlay.axis-metric`：量の名前がない（「値」）。単位もない指標では量も単位も書かれない。（作業中：`claude/axis-quantity-unit`）
- `compare-delta.range`：範囲を間引いた Δ から求めている。全データの Δ の端と一致することを確かめるテストがない。
- `compare-delta.axis`：「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。（作業中：`claude/axis-quantity-unit`）
- `compare-lanes.range`：範囲を間引いた線から求めている。全データの端と一致することを確かめるテストがない。
- `trigger-lanes.range`：レーンの範囲が全サンプルのピークとしきい値を含むことを確かめるテストがない。
- `cursor-spectrum.range`：範囲を切った行から求めている。全ビンの最小・最大と一致することを確かめるテストがない。
- `pair-view.order`：ペアの利得の levelBins が全ビンから作られ、静かな応答が上に来ることを確かめるテストがない（部品の一般のテストだけ）。
- `pair-view.range`：範囲を確かめるテストがなく、R9（自動の範囲は切りのよい値）を守っていない。
- `entry-held.range`：範囲を間引いた点から求めている。全データの端と一致することを確かめるテストがない。
- `entry-held.axis`：「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。（作業中：`claude/axis-quantity-unit`）
- `entry-overview.range`：範囲を確かめるテストがない。端の丸めも R9 の切りのよい値（niceRange）ではない。
- `entry-table.count`：見出しやフィルタの数がすべての行を数えていることを確かめるテストがない。
- `report-overlay.order`：レポートの図の順が全ビンのパワーで決まることを確かめるテストがない。
- `report-overlay.range`：範囲を間引いた線から求めている。全ビンの端と一致することを確かめるテストがない。
- `report-delta.range`：全ビンがあるときの範囲を間引いた線から求めている。テストは帯だけの場合しか見ていない。
- `report-delta.axis`：「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。（作業中：`claude/axis-quantity-unit`）

### P3（4）

- `compare-overlay.axis-cepstrum`：無次元の量に単位の表記がない（「[-]」などがない）。
- `track-header.meta`：「48.0kHz」の書き方が読み値の決まり（plotText.ts）と違い、確かめるテストもない。
- `pair-view.axis-coherence`：記号「γ²」だけで、量（コヒーレンス）の名前と無次元の表記がない。
- `entry-distribution.axis-csv`：CSV の列の値の軸に単位がない（列の名前に単位がなければ量だけ）。
