# 図の一覧

どの図を、どのファイルが宣言し、どの画面が載せるかの一覧です。設計は [figure-design.md](figure-design.md)、図の種類を足す手順は [figure-kinds-guide.md](figure-kinds-guide.md) にあります。

- **図の経路**：図の宣言（`src/webview/charts/`）を図のサービス（`python-backend/figures/`）へ渡し、返った 1 枚の絵を Figure（`src/webview/figure/`）が描きます。数の答えは wandas と図のサービスが持ち、画面は絵のほかに答えを持ちません。画面に出る図は、すべてこの経路です。
- 図の契約は、図のサービスと Figure のテスト（`python-backend/test_figures_*.py`、`test_figure_*_cases.py`、`src/test/figureComponent.test.ts`、`src/test/uiSmoke/figure*.spec.ts`、`trackRowFigures.spec.ts`）と [display-rules.md](display-rules.md) が持ちます。契約表（`src/test/plotContracts/charts/`、[plot-contracts.md](plot-contracts.md)）に残るのは、図でないもの（下の表）だけです。

## 図

| 図 | 宣言 | 画面 |
|---|---|---|
| スペクトルの線の重ね図と Δ の段 | `charts/compareOverlay.ts` | `screens/compareOverlay.ts` |
| 時間変化の指標、dB の時系列、ケプストラム、相互相関、2 チャンネルの組の図の重ね図と Δ | 同上（`lines` の段） | 同上 |
| 時間信号（音そのもの）の重ね図と Δ | 同上（`band` の段、信号の答え） | 同上 |
| 帯域（1/N オクターブ）の重ね図と Δ | 同上（`lines` の段。点を棒として描く） | 同上 |
| 熱図（スペクトログラム、粗さ、ケプストログラム）の録音ごとの段。Δ の段は無い（古い比較台でも出なかった） | 同上（`image` の段） | 同上 |
| トリガーのイベントの重ね図 | 同上（イベントの線） | 同上 |
| トリガーの下の段（録音ごとの波形とイベントの印） | `charts/triggerLanes.ts` | `screens/triggerLanes.ts` |
| 線の図を録音ごとの段で見せる表示（One lane per track）、基準スロットとの対、手順を押している間の図 | `charts/compareOverlay.ts`（`apart`） | `screens/compareOverlay.ts` |
| 入口の分布図（表の CSV の数の列を、群ごとの段に数える） | `screens/distributionFigure.ts`（`bins` の段） | 同じファイル |
| Tracks のカーソルスペクトル（カーソルの時刻のスペクトル。単位や基準が違う録音は段を分ける）とその CSV | `charts/cursorSpectrum.ts` | `screens/tracksFigure.ts` |
| Tracks のペアの図（基準のチャンネルから各チャンネルへの利得、位相、コヒーレンスの 3 段）。CSV の書き出しは無い（Tracks の CSV はカーソルスペクトルのもの） | `charts/pairSpectrum.ts` | `screens/tracksFigure.ts` |
| Tracks の録音の行（チャンネルごとに波形とスペクトログラム、カラーバー。1 チャンネルが 1 つの Figure） | `charts/trackRow.ts` | `screens/trackRowFigure.ts`、`trackRows.ts`、`trackRowsScreen.ts` |

## 書き出すファイル

| もの | 作るところ | 契約表 |
|---|---|---|
| 報告のフォルダ。報告.csv と 定義.json は言葉だけ。図.png と 図.csv は、比較台に出ている図を図のサービスが書き出したもので、定義.json にデータの id を書く。トリガーの下の段の図は入らない | `runtime/compareReport.ts`、`runtime/trackStageMode.ts` の `report` | `report-files` |
| Tracks の PNG。表示中のすべての行の Figure を、描き終わるのを待って写し、時間の目盛りの下に並べて 1 枚にする。行の上に録音とチャンネルの名前を書く | `exportDownloads.ts` の `composeTrackCanvases` | `track-png` |

## 図ではないが、契約表に行があるもの

| もの | ところ | 契約表 |
|---|---|---|
| 入口の表（ファイル、ch、長さ、fs、校正、群、CSV の列）。解析の値の列は無い | `entryRuntime.ts`、`entryTableHtml.ts` | `entry-table` |
| ペアの図の見出し（H1、平均回数、時間の範囲）。図そのものは図の経路 | `pairSpectrumPanel.ts` の `writeHeader` | `pair-view` |
| Tracks の行の見出しとツールバーの数（ピーク、カーソルの時刻、解析窓） | `calibrationDecorations.ts`、`comparisonRuntime.ts` | `track-header` |
| Tracks の行の上の時間の目盛り。行の Figure と同じ目盛りの決まりで、別のキャンバスに描く | `runtime/timeRuler.ts` | `time-ruler` |
