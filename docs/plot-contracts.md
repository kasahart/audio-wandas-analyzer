# グラフの数の契約表

グラフに出る数とグラフから書き出す数の一覧です。どのグラフでも、読み値、← / → の行き先、Δ、中央値、見出しや最大、重ねる順、軸の自動の範囲と目盛り、書き出す数、数や統計は全データから求め、間引いた点は描くためだけに使います（[表示の規則](display-rules.md) R1、R2、R6、R7）。この表は、それぞれの数をどこで計算し、何から求め、どのテストが確かめているかを書きます。

この文書は `src/test/plotContracts/`（グラフごとに 1 ファイルの `charts/`）から作ります（手で書き換えません）。表を変えたら `npm run compile && node dist/test/plotContracts/render.js` で書き直します。`src/test/plotContracts.test.ts` は次を確かめます。

- `charts/` のファイルがすべて `index.ts` にあること。表に書いた、グラフを描く関数が実在すること。
- 表に書いたテストが実在し、飛ばされず、何かを確かめていること。表に書いた関数が実在すること。
- webview と shared の中で数を文字にする関数（`toFixed`、`toPrecision`、`toExponential`、`toLocaleString`、小数の桁に丸める算術（10 の累乗を掛けた値の `Math.round`・`trunc`・`floor`・`ceil`）、それをする関数と、`VALUE_HELPERS` の関数を呼ぶもの）が、表のどれかの行か、`VALUE_HELPERS`、`NOT_CHART_VALUES`（理由つき）にあること。これは数を書く関数の一覧を保つための検査で、プロパティに入れてから後で書く文字までは追いません。グラフの数が間引いた点でないことは、次の型が保証します。
- 描くために間引いた点は、図のサービスの絵（`Figure…` の型）だけにあります。webview では型 `FigureDrawn`（`protocol_schema.py` の `x-drawn` から作る）で、計算・比較・文字にすることをコンパイラが拒み、`src/webview/figure/` だけが import できます（ESLint、`src/test/figureImportRules.test.ts`）。webview は測定データを持たず、読み値・見出し・書き出しの数はどれも処理部が全データから答えたものです。処理部では、間引いた点を作るのは `figures/thinning.py`、送るのは `figures/picture.py` だけで、`scripts/check_figure_imports.py` が確かめます。
- 処理部のプロトコル（`protocol_schema.py` から作る `backendProtocolSchema.ts`）の結果の数のフィールドが、すべて表の行か、画面に出ない理由（`schema.ts`）に対応していること。
- 出どころが全データの行は、全データと描いた点が違うデータで確かめるテスト（表の ◆）を挙げること。挙げていない行は穴です。
- 規則が認める例外（`exception`）は、`display-rules.md` のその規則にその文がそのまま書いてあること。
- テストのない行、間引いた点から求める行、軸の名前に量・単位・基準が欠ける行、全データと描いた点を区別するテストのない行は「穴」（gap）で、グラフごとの `knownGaps` と一致し、どの穴もこれらのどれかで止まっていること。穴の数は `GAP_CEILING` 以下で、減らす方向にだけ変えます。

重さ：P1 は間引いた点から求めた数がそのまま出るもの、P2 は確かめていないか近似のもの、P3 は見た目や書き方だけのものです。「作業中」は、その行を変えているほかのブランチです（この表は main の今を書いています）。

## グラフ

| グラフ | 描く・書き出す関数 | 行の数 | 穴 |
| --- | --- | --- | --- |
| トラックの見出しとツールバーの数（カーソルの時刻、ずらし、ピーク、解析窓） (`track-header`) | `webview/runtime/calibrationDecorations.ts:channelMetricSummaryHtml`<br>`webview/runtime/comparisonRuntime.ts:updateCursorDisplay` | 5 | 0 |
| トラックの時間の定規 (`time-ruler`) | `webview/runtime/comparisonRuntime.ts:renderRuler`<br>`webview/runtime/timeRuler.ts:paintTimeRuler` | 2 | 0 |
| トラック表示の PNG 書き出し (`track-png`) | `webview/runtime/exportDownloads.ts:composeTrackCanvases` | 1 | 0 |
| ペアの図の見出し (`pair-view`) | `webview/runtime/pairSpectrumPanel.ts:writeHeader` | 1 | 0 |
| 入口の表（CSV の列、ファイルの情報の列、見出しの数） (`entry-table`) | `webview/runtime/entryTableHtml.ts:datasetRowsHtml` | 2 | 0 |
| レポートのフォルダ（報告.csv・定義.json は言葉だけ。図は比較台の図の書き出し） (`report-files`) | `webview/runtime/compareReport.ts:reportCsv` | 2 | 0 |
| 解析レポート（Markdown） (`analysis-report`) | `shared/report/analysisReport.ts:buildMarkdownReport` | 1 | 0 |

## トラックの見出しとツールバーの数（カーソルの時刻、ずらし、ピーク、解析窓）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 要約の値 | チャンネルのピーク（振幅とレベル） | `webview/runtime/calibrationDecorations.ts:channelMetricSummaryHtml`<br>`webview/runtime/calibrationDecorations.ts:levelText`<br>`webview/runtime/calibrationDecorations.ts:peakText`<br>`services/analyzer.py:analyze_from_frame` | 全データ：バックエンドが全サンプルのピークと wandas のレベルを返し、webview は計算し直さない。 | ◆ `test_analyzer.py` › test_channel_peak_is_every_samples_largest_magnitude<br>`renderScript.integration.test.ts` › renderScript: channel peak metrics use backend-provided levels without recalculating dB<br>`calibrationContracts.test.ts` › calibration row helpers draw badges, peak text and requests |  |
| 要約の値 | チャンネル数とサンプリング周波数（kHz） | `webview/runtime/trackLaneHtml.ts:trackRowHtml` | 利用者の値・メタデータ：ファイルのメタデータ。サンプリング周波数は読み値と同じ frequencyText で書く（48 kHz、44.1 kHz）。 | `trackLaneHtml.test.ts` › a track row writes its sample rate as every plot writes a frequency (plotText.frequencyText) |  |
| 入力・設定の表示 | カーソルの時刻、再生の時刻、ループの範囲 | `webview/runtime/comparisonRuntime.ts:updateCursorDisplay`<br>`webview/runtime/comparisonRuntime.ts:writeSpectrumCursorTime`<br>`webview/runtime/comparisonRuntime.ts:writeCsvWhenAnswered`<br>`webview/runtime/playbackDisplay.ts:update`<br>`webview/runtime/waveformInteraction.ts:loopRegionClockText` | 利用者の値・メタデータ：カーソル・再生・ループの位置（利用者の操作）を m:ss.ss で書く。カーソル位置のスペクトルの CSV は、ファイルの名前に同じ時刻を書く（値はすべて図の処理部の答え）。 | `uiSmoke/toolbar.spec.ts` › the cursor readout is labelled and follows a loop drag to where it was released<br>`playbackDisplay.test.ts` › createPlaybackDisplay shows the prefixed clock time while playing and hides it when stopped<br>`sharedFormat.test.ts` › time and channel labels share one implementation | 例外（R7）：クリックで決めるカーソル（カーソルスペクトルの時刻と解析窓）はこれとは別です。<br> |
| 入力・設定の表示 | トラックのずらし（+0.000s） | `webview/runtime/comparisonRuntime.ts:updateOffsetDisplays` | 利用者の値・メタデータ：利用者が入れたずらし。 | `renderScript.integration.test.ts` › renderScript: Enter commits inline offset edit |  |
| 入力・設定の表示 | 解析窓の時刻の範囲と長さ（ms） | `webview/runtime/comparisonRuntime.ts:analysisWindowCaption` | 描く点が全部（間引かない）：バックエンドがスライスに付けた窓の始まりと終わり（windowStartNorm / EndNorm）。描くために間引いた形はない。 | `uiSmoke/analysisWindow.spec.ts` › analysis window band follows the cursor on the waveform only and the header names it |  |

## トラックの時間の定規

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 目盛り | 時間の目盛り | `webview/runtime/comparisonRuntime.ts:renderRuler`<br>`webview/runtime/timeRuler.ts:timeRulerTicks`<br>`webview/runtime/timeRuler.ts:linearWindowEnds` | 軸の範囲・窓：見えている時間の窓から、図の部品と同じ規則（figure/ticks.ts の alongAxisTicks）で決め、行の幅の上のその時刻の位置に描く。 | `timeRuler.test.ts` › the ruler's ticks are the Figure's time ticks, each at its time's place over the rows' width |  |
| 軸の名前 | 時間の軸の名前（定規の右端） | `webview/runtime/comparisonRuntime.ts:renderRuler`<br>`webview/runtime/timeRuler.ts:paintTimeRuler` | 文字：「時間 [s]」。定規の右端に、どの軸の名前とも同じ合わせ方（fitAxisTitle）で描く。ダブルクリックで時間の範囲を入れる（openTimeRangePopup）。 | `timeRuler.test.ts` › the ruler names its axis at its right end, fitted as every axis name is, and leaves out a number the name would cover |  |

## トラック表示の PNG 書き出し

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 書き出し | PNG に写るレーンの絵と軸の数 | `webview/runtime/exportDownloads.ts:composeTrackCanvases` | 軸の範囲・窓：画面の行の Figure（図のサービスの絵）と時間の目盛りのキャンバスを、ページ上の横の位置のまま写す。行の上に録音とチャンネルの名前を書く。新しく数を作らない（数はそれぞれの行の図のとおり）。 | `exportDownloads.test.ts` › composeTrackCanvases writes a named row's recording and channel on a line above it, and puts the ruler over the rows' plots as the page has it<br>`uiSmoke/laneCulling.spec.ts` › the PNG export draws every lane: it asks for the spectrograms of lanes out of view and is saved once they are answered, saying so when rows could not be drawn |  |

## ペアの図の見出し

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 要約の値 | 見出し（H1・平均回数・時間の範囲） | `webview/runtime/pairSpectrum.ts:pairHeader`<br>`webview/shell/numberText.ts:secondsSpanText` | 描く点が全部（間引かない）：バックエンドが返した各応答の平均回数（最少）と範囲。（描くために間引いた形はない） | `pairSpectrum.test.ts` › the header shows the fewest averages and the whole averaged range, warning below 8 |  |

## 入口の表（CSV の列、ファイルの情報の列、見出しの数）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 要約の値 | 表の値の列（CSV の数の列）と、ファイルの情報の列（長さ、標本化周波数、校正） | `webview/runtime/entryTableHtml.ts:formatValue`<br>`webview/runtime/entryTableHtml.ts:datasetRowsHtml`<br>`webview/runtime/entryTableHtml.ts:infoCell`<br>`webview/runtime/entryRuntime.ts:rowInfo`<br>`webview/runtime/entryRuntime.ts:formatColumn` | 利用者の値・メタデータ：利用者が選んだ CSV のセルと、ファイルのヘッダが言う長さ・標本化周波数・ホストが言う校正。読むだけで、計算しない（解析の値の列は無い）。 | `datasetTable.test.ts` › rows are a recording and its channel; CSV attributes and the file's own information follow every channel<br>`keptRows.test.ts` › a file's information that arrives goes into the cells that were drawn while its header was not read: no row or cell is drawn anew (#781)<br>`entryNoAnalysis.test.ts` › putting recordings in starts no analysis: the entry sends the host only its open, its header reads and its session, never a scan |  |
| 数 | 見出し・フィルタ・チェックの一覧の数、分布図で範囲を選んだあとの行の数の知らせ | `webview/runtime/entryRuntime.ts:pickValueRange`<br>`webview/runtime/entryTableHtml.ts:datasetHeadHtml`<br>`webview/runtime/entryTableHtml.ts:trackHeadHtml`<br>`webview/runtime/entryTableHtml.ts:filterChipsHtml`<br>`webview/runtime/entryTableHtml.ts:checkListHtml`<br>`webview/runtime/entryTableHtml.ts:say` | 描く点が全部（間引かない）：表のすべての行を数える。（描くのは画面に入る行だけだが、数は描かない行も含む） | `uiSmoke/entry.spec.ts` › a folder of 1000 recordings draws only the rows on screen, but its head and its filter lists count every row, not the rows drawn |  |

## レポートのフォルダ（報告.csv・定義.json は言葉だけ。図は比較台の図の書き出し）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 書き出し | 報告.csv（録音、条件、区間、基準の録音、チャンネル、表に出している値、メモ、基準の定義） | `webview/runtime/compareReport.ts:reportCsv`<br>`webview/runtime/entryBase.ts:regionCells` | 利用者の値・メタデータ：入口の表の言葉（録音の名前、CSV のセル、メモ、基準の定義）と利用者の区間。区間は秒で、端が同じ字にならない桁まで書く。解析の値は書かない。 | `benchReport.test.ts` › 報告.csv has one row per compared slot, in words only: the recording, its conditions, the region, its base and its memo<br>`benchReport.test.ts` › with no figure on show a report is of words only: its files are 報告.csv, the Recipe and 定義.json<br>`entryBase.test.ts` › a region is written as two cells in seconds, finer where its ends would read alike; the whole file as two empty cells |  |
| 書き出し | 図.png と 図.csv（比較台に出ている図。線の段のすべての答え）と、定義.json のデータの id | `webview/runtime/compareReport.ts:reportFiles`<br>`figures/service.py:export` | 全データ：図のサービスが、画面の絵と同じデータの id の答えから、間引かない表を返す。PNG は同じ図の宣言を決まった大きさで描いたもの。webview は受け取った字とバイトをファイルにするだけ。 | `benchReport.test.ts` › the figure on show goes into the report as it was handed over: its PNG, the table of its lines, and its data id in 定義.json<br>`benchReport.test.ts` › the module that writes a report makes no number: it reaches no answer, no figure and no canvas<br>◆ `test_figures_service.py` › test_export_has_the_draws_data_id_and_every_point_unthinned_and_refuses_another_id |  |

## 解析レポート（Markdown）

| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |
| --- | --- | --- | --- | --- | --- |
| 書き出し | Markdown のレポートの数（長さ、ピーク、レベル） | `shared/report/analysisReport.ts:buildMarkdownReport`<br>`shared/report/analysisReport.ts:formatReportDb`<br>`shared/report/analysisReport.ts:reportLevel` | 全データ：バックエンドの全サンプルのピークとレベル、ファイルの長さ。 | ◆ `analysisReport.test.ts` › the markdown report writes every sample's peak and level and the file's own length, never the envelope thinned to draw it<br>`analysisReport.test.ts` › markdown report is a pure function of tracks, loop region and time<br>`renderScript.integration.test.ts` › renderScript: multichannel report lists peak metrics for every channel |  |

## 穴の一覧

### P1（0、上限 0）


### P2（0、上限 0）


### P3（0、上限 0）

