# Audio Wandas Analyzer Architecture

## 概要

このプロジェクトは、VS Code 拡張機能のフロントエンドと Python 製の解析バックエンドを分離した三層構成です。現在のユーザー導線は次の 2 系統に分かれています。

- 単一ファイル解析: ファイルを 1 件選択して即座に解析し、1 トラック状態の ComparisonPanel で確認する
- 比較ビュー: ディレクトリ選択または複数ファイル再選択のあと、対象を絞り込んで順次解析し、複数トラック状態の ComparisonPanel で比較する

各層の役割:

- Extension Host 層: コマンド登録、設定取得、ファイル選択、Python プロセス起動を担当
- Python Backend 層: 音声解析、数値計算、JSON 形式の結果生成を担当
- Webview UI 層: 比較パネル描画、ズームやホバーなどのインタラクションを担当

設計上の主眼は、VS Code 固有処理と信号処理ロジックを切り離し、UI と解析処理を疎結合に保つことです。

## Desktop / static Web の共通境界

Comparison UI と DSP は同じソースを使う。解析コマンドの型・応答検証は
`src/shared/protocol/backendProtocol.ts`、UI から host への型・入力検証は
`src/shared/protocol/panelMessages.ts` に置く。Worker の正常応答も native IPC と同じ
validator を通す。Web の load/unload/export-plan は Worker 専用であり共通10コマンド（`command_dispatch.COMMANDS`）と混同しない。

- `AnalysisClient` は analyze/detail/slice/range/export/recipe の要求を組み立てる。
  `executeLazyAnalysis` は detail/slice/range の UI 結果へ変換する。host は
  型付き request transport と表示中の calibration/STFT context を提供する。
- `runAnalysisBatch` は逐次処理、`SessionRequests` は世代・request ID・dispose 後の応答排除を担当する。
  Web の clear は世代を進めて再利用し、native Panel dispose は閉鎖する。再生成 Panel は別 session。
- `SourceResults` は結果 collection と owner の参照同一性を管理する。native は借用した directory cache を
  選択解除・detach 時にも保持し、revision 不一致だけを除去する。Web は所有 source の drop/clear 時に
  lease を無効化して Blob を解放する。Worker unload/terminate、許可パス、native 取消は adapter の責務。
- `AnalysisContextPolicy.current/discardStale` は native の校正 store を注入する。
  lazy request の明示 revision（0 を含む）は表示済み context として優先する。analyze は現 store の
  context を使い、一致した stale profile の破棄後だけ1回再試行する。取消 token は初回と再試行で共通。
  Web は policy なしで入力 context を使う。校正 UI/persistence を Web に追加したことにはならない。
  Panel は表示 hook で校正 listener を登録し、prototype や show メソッドを書き換えない。
- `ComparisonSessionController`（`src/shared/session/`）は panel message の解釈を一度だけ持つ。
  設定保存、再解析の start/update/end 包絡と世代ゲート、lazy 結果への変換と公開判定、
  WAV 区間・レポートの書き出し手順、未対応操作の通知経路はここにある。host は
  `ComparisonSessionPorts` で scope（公開可否）、transport、設定ストア、ダイアログ、
  ソース所有を注入する。native `PanelController` と Web `staticHost` は port 実装だけを持ち、
  同期的な port は同一 tick で backend command に到達する。active source が 0 件の再解析は
  設定保存のみで包絡を送らない。
- `OrderedSelection` は順序・重複排除・再追加の規則を担当する。native の tree による
  パス許可検証を UI 側の選択状態で代替しない。
  native host は Webview が名指ししたパスを `PanelSession.allowsFile`（表示中のトラックか、
  フォルダが列挙した・追加したファイルだけを許す）で確かめてから disk や backend に渡す。
  入口表の走査・識別・先頭読み、比較の走査、WAV 書き出しがこれを通る（`panelController.ts`）。
- `exportWavRegions` は区間計画・順序・衝突しない名前を共有する。sink は書込み先と
  失敗方針を提供する。native は個別失敗後も継続し、Web は予算検証後に失敗で中断する。
- spectrogram 設定は `SpectrogramSettingsStore.get/update` を通す。
  workspaceState と localStorage、校正の realpath と永続化、保存ダイアログと Blob/ZIP は adapter に残す。
- Python の `command_dispatch.py` は検証と service 呼出しだけを持つ。
  `backend_server.py` は native 起動・heartbeat・NDJSON、`browser_service.py` は
  virtual source と Web 上限を担当する。Web 配布物には native transport を含めない。

- Recipe は wandas の `RecipePlan` JSON（`*.recipe.json`）。`src/shared/recipe/` の `RecipeFlow` が一覧・選択・
  チェック中ファイルの入力名への割り当て（Recipe の入力順を初期値とし、入力が複数かファイルが余るときは実行前に確認・変更できる）・実行・表示の手順を持つ。
  native は recipes ディレクトリ、QuickPick、常駐 `AnalysisClient.runRecipe`、ChartSpec Panel を port で渡す。
  Web は build 時の `recipes/manifest.json`、Workflow メニュー下の選択メニュー（同梱 Recipe と手元の `.recipe.json`）、Worker の `run-recipe` command、同一 origin の
  `chartSpecRuntime.js` を読み込む frame を渡す。両 host の `AnalysisClient.runRecipe` は入力名→ファイルの対応、
  入力ごとの校正 context と Recipe の場所を送信し、共通の120秒 timeout・cancel を管理する。native は古い校正を通常解析と同じ規則で
  破棄・再試行する。Python 側の `AnalysisService.run_recipe` は `RecipePlan.from_dict()` で検証し、
  `engine.get_analysis(file, profile)` の校正済み frame を `RecipePlan.apply()` に渡して出力 Frame をグラフにする（伝達関数は位相も出す）。
  cancel・timeout は実行中の backend/Worker を終了する。native の他の pending request は
  再起動後に自動で再送し、Recipe の失敗をパネルの解析エラーにしない。Web は読み込んだ File と表示を保持し、
  次の要求で新しい Worker に再ロードする。
  ChartSpec 文書の CSS と globals は `chartSpecDocument.ts` に置き、renderer は `chartSpecRuntime.ts` の
  `startChartSpecRenderer` を bundle した `dist/webview/chartSpecRuntime.js` を両 host が読み込む。
- 「レシピとして保存」は webview が下のパネルの内容（スペクトルのファイルと帯域、または基準チャンネルと応答チャンネル）を
  `save-recipe` で送り、共通 session controller が STFT 設定を足して `build-recipe` を呼ぶ。Python 側の `recipe_builder.py` は
  表示中のファイルと同じ形の無音 frame で wandas の処理を実行し、`RecipePlan.from_frame()` で Recipe JSON にする。
  native は保存ダイアログ、Web はダウンロードで `<名前>.recipe.json` を渡す。

校正設定 UI、フォルダ選択、codec の Web 対応範囲は増やしていない。
新しい共通処理は両 host が実際に参照する。host 名による分岐で共通ファイルを膨らませない。

### 共有率の測り方と目標

`python3 scripts/audit-runtime-sharing.py --baseline 277bdd7a9a92b63a6e8820368ca29ea3bb44b745 --output test-results/runtime-sharing.json`
で、基準と作業中の全 production source の到達元・ファイル数・非空行数を比較できる。
型 import と build の明示 root を含む source closure であり、全行実行や機能同等性の割合ではない。
HTML/CSS は所在する TS に含め、tests、vendor、生成物、docs、build/dev tools、設定とデータ asset は除外する。
`verify` は shallow checkout でも動く現状監査を実行する。

基準は共有 31 / 全体 61 ファイル (50.82%)、非空行 10,394 / 15,960 (65.13%)。
80% は目標であり達成済みではない。native 専用の Python 環境管理、コマンド登録、Panel、
ファイル権限は adapter として残るため、ファイル数での 80% は同じ分母では保証できない。
行数ベースは Recipe の Web 対応と共通 session controller で 80% 近傍に達する。
独立した adapter を合併して数を減らす、共通 file を細分化する、未使用 import を追加する方法は採らない。
率と併せて、同じコマンド変換・区間計画・選択規則を一度の変更で両版へ反映できるかを評価する。

## 全体構成

```mermaid
flowchart LR
  User[User] --> Command[VS Code Command]
  Command --> Extension[Extension Host\nsrc/extension/index.ts]

  Extension -->|1 file| Single[単一ファイル解析導線]
  Extension -->|directory or 2+ files| Compare[比較ビュー導線]

  Single --> Client[AnalysisClient]
  Compare --> Client
  Client --> Server[PythonBackendServer\nsrc/extension/pythonBackendServer.ts]
  Server -->|stdin NDJSON| Backend[backend_server.py]
  Backend --> Dispatch[command_dispatch.py]
  Dispatch --> Service[AnalysisService\nanalysis_service.py]
  Service --> Engine[AnalysisEngine\nanalysis_engine.py]
  Service --> Analyzer[analyzer.py / decimator.py]
  Backend -->|stdout NDJSON| Server
  Server --> Client
  Extension --> Panel[ComparisonPanel\nsrc/webview/panels/ComparisonPanel.ts]
  Panel --> User
  Panel -->|request-waveform-range| Extension
  Extension --> Client
```

## ユーザーフロー

### 1. 単一ファイル解析

1 件の音声ファイルを選択し、その場で解析して表示する最短導線です。内部では `runAnalysis()` を 1 回だけ呼び、返ってきた `AnalysisResult` を `AnalysisResultWithError[]` の 1 要素配列として `ComparisonPanel.show()` に渡します。したがって UI 上は比較パネルでも、実際には単一トラックの詳細閲覧として振る舞います。

### 2. 比較ビュー

複数ファイルを対象に解析して、共通タイムライン上で比較する導線です。開始点は 2 通りあります。

- フォルダを選択し、配下の対応音声ファイル群をツリーから選択して対象を確定する
- フォルダを選択し、配下の対応音声ファイル群をツリーから逐次チェックして比較対象を増減させる
- 単一ファイルを開いたあと、ツールバーから別のファイルまたはフォルダを開いて同じパネルを再利用する

ディレクトリ入力では、まず extension 側が `DirectoryTreeNode[]` を構築し、ComparisonPanel を選択モードで開きます。初期状態ではトラックは空です。Webview から返った選択済みファイル一覧を extension 側で再検証したあとに `runAnalysis()` をファイルごとに繰り返し、成功トラックと失敗トラックを含む `AnalysisResultWithError[]` を同じ選択モード panel に再注入します。これによりツリーを閉じずに、右側の比較トラックだけを即時更新できます。

## コンポーネント責務

### 1. Extension Host

対象: [src/extension/index.ts](../src/extension/index.ts)（`activate` で各部品を組み立てる）、コマンド登録は [src/extension/extensionContributions.ts](../src/extension/extensionContributions.ts)

責務:

- `package.json` の VS Code コマンド（`analyzeFile`、`analyzeThisTarget`、`analyzeDebugFile`、`selectPythonEnvironment`、`runRecipe`、`configureCalibration`）を登録する
- 対象の音声ファイルまたはディレクトリを選択または解決する
- 受け取った対象を単一ファイル解析導線または比較ビュー導線へ振り分ける
- Webview から `select-target`、`analyze-selected-files`、`request-waveform-range` を受け取る
- 設定値 `pythonCommand`、`cacheMemoryMb`、`debugFilePath` を読み込む
- 常駐の `PythonBackendServer` を起動し、`AnalysisClient` 経由で解析要求を送る（詳細は 2 節）
- Python は遅延起動する。ウィンドウを開いただけでは環境確認も backend 起動もせず、コマンド・ウェルカムビュー・
  パネルが必要とした時点で `index.ts` の `preparePython` がインタープリターを決め、依存確認と warmup を行う
- `AnalysisClient` から返った `AnalysisResult` を受け取り、失敗時は `error` 付きの結果へ変換して `AnalysisResultWithError[]` に蓄積する
- ディレクトリ指定時は `ComparisonPanel` を選択モードで開き、チェック変更のたびに同じ panel 内のトラック表示を更新する
- 失敗時は VS Code 通知にエラーを表示する

特徴:

- バックエンドとの境界は `AnalysisClient` に限定されている。request ID で応答を対応付ける NDJSON のやり取りは `PythonBackendServer` が受け持つ
- 解析ロジックを TypeScript 側に持たないため、UI 修正と数値処理修正を独立して進めやすい
- 単一ファイルと複数ファイルの差は主に入力本数だけで、描画面は共通化されている

### 2. PythonBackendServer

対象: [src/extension/pythonBackendServer.ts](../src/extension/pythonBackendServer.ts)

責務:

- `python-backend/backend_server.py` を常駐子プロセスとして起動・管理する
- `AnalysisClient` の要求を request ID 付きの改行区切り JSON で送信し、応答を対応する Promise に返す
- ready、heartbeat、タイムアウト、取消、終了時の pending request を管理する

同じプロセスで初期解析と遅延解析を扱い、`AnalysisEngine` のファイル・STFT キャッシュを再利用する。

### 3. Python Backend Entry Point

対象: [python-backend/backend_server.py](../python-backend/backend_server.py) / [python-backend/command_dispatch.py](../python-backend/command_dispatch.py)

責務:

- stdin の NDJSON リクエストを検証し、`AnalysisService` に渡す
- 共通10コマンド（analyze、range、track-detail、release-track-detail、spectrum-slice、pair-spectrum、export-wav-loop、run-recipe、build-recipe、scan）を dispatch する
- request ID 付きの結果または error を stdout に返す
- 起動通知・heartbeat と stderr の診断を提供する

検証と dispatch は Web の `browser_service.py` からも使う。

### 4. Audio Analyzer

対象: [python-backend/analyzer.py](../python-backend/analyzer.py)

責務:

- `AnalysisEngine` で読み込み・校正された frame から表示用の結果を生成する
- チャンネル向きの正規化
- ピーク値の算出
- 波形エンベロープ生成（`decimator.py` 経由）
- スペクトログラム生成と可視化向けの縮約
- UI が扱いやすい辞書構造への整形

設計上のポイント:

- 大きな音声データをそのまま UI に渡さず、波形は最大 1200 点、時間方向スペクトログラムは最大 720 ビン、周波数方向は最大 192 ビンへ圧縮している
- 数値データを可視化用に事前整形することで、Webview 側は描画ロジックに集中できる
- チャンネルごとに独立した要約を返すため、多チャンネル音声でも同一描画パターンを再利用できる

### 5. Decimator

対象: [python-backend/decimator.py](../python-backend/decimator.py)

責務:

- バケット単位の argmin/argmax で波形エンベロープを生成する
- タイムスタンプをファイル全体に対して正規化した `minT`/`maxT` として返す

設計上のポイント:

- 正規化済みタイムスタンプは Webview 側の `[0, 1]` ファイル座標系に直接マッピングされる

### 6. AnalysisService / AnalysisEngine

対象: [python-backend/analysis_service.py](../python-backend/analysis_service.py) / [python-backend/analysis_engine.py](../python-backend/analysis_engine.py)

責務:

- `AnalysisEngine`: `wandas.read()` で読み込んだ frame と設定別 STFT をメモリ上限付き LRU キャッシュに保持する。ファイル更新時はキャッシュを無効化する
- `AnalysisService`: 初期要約、トラック詳細、カーソルスペクトル、波形範囲、WAV 区間書き出し、Recipe を処理する
- `waveform_range()`: 校正済みのキャッシュ frame を指定範囲で切り出し、`decimator.py` に渡す。同一ファイルを再読み込みしない

### 7. ComparisonPanel

対象: [src/webview/panels/ComparisonPanel.ts](../src/webview/panels/ComparisonPanel.ts)

責務:

- `AnalysisResultWithError[]` を HTML とインラインスクリプトへ埋め込む
- 1 件のときは単一トラック解析ビュー、2 件以上のときは比較ビューとして描画する
- 表示モードは縦積み（stacked）のみ
- 共通タイムルーラー、ズーム、パン、カーソル同期、トラックごとの再生操作を処理する
- ズーム時に `request-waveform-range` を AnalysisClient / PythonBackendServer 経由で送り、高解像度波形をオンデマンドに取得する
- 解析失敗トラックをエラー表示のまま比較対象に残す

設計上のポイント:

- 単一ファイル、ディレクトリ選択、複数ファイル比較のすべてで `ComparisonPanel` に統一されている
- 比較件数に応じてタイトルとレイアウト密度だけが変わり、基本的な描画パイプラインは共通である
- 波形描画の定義元は `src/webview/waveform/waveformRenderer.ts`。ビルドで生成した `dist/webview/comparisonWaveform.js` を Webview が読み込む

### 7.1 入口の表（entry table）

対象: [src/webview/runtime/entryRuntime.ts](../src/webview/runtime/entryRuntime.ts) / [entryTable.ts](../src/webview/runtime/entryTable.ts) / [entryTableHtml.ts](../src/webview/runtime/entryTableHtml.ts) / [src/shared/analysis/entryScan.ts](../src/shared/analysis/entryScan.ts)

フォルダを開くと（VS Code はディレクトリ解析、Web はフォルダ選択）、レーン表示の上に 1 行 1 ファイルの表が開く。Webview は `entry-scan` を 1 回送り、共通 controller の `runEntryScan` が保存済みの条件表を返したあと、1 件ずつ `scan`（固定レシピ `python-backend/recipes/entry-scan.recipe.json`）の結果を `entry-scan-result` で返す。同じファイル（VS Code はパス・size・mtime、Web は内容の sha256）と同じ校正なら保存済みの結果を使う。保存先は VS Code が workspaceState、Web が localStorage で、鍵は `awa.scanIndex.v1` / `awa.conditions.v1`（このフォルダの分だけ残す）。Web は 1 件ずつ load → scan → unload し、走査後に Worker を作り直して選択中のトラックを読み直す。表の数値・条件・Δ・外れ値・CSV は `entryTable.ts` の純関数。条件は諸元表から取る: フォルダ直下（VS Code は 1 つ上も）の CSV/TSV のうち、音源の 50% 以上に対応するものを自動で読み（`src/shared/analysis/entryMetadata.ts`、asd-insight と同じ規則: 区切りはタブとカンマの多い方、音声列 audio_file 等は開いたフォルダ直下からの相対パスで完全一致、ファイル名だけなら候補が 1 つのときだけ、無ければ sample_id 等に拡張子を補う、大小区別、1 音源に複数行なら最初の行、128 列・20 MiB まで）、表を貼る・表にドロップしても同じ規則で読む。サブフォルダの階層も条件列になる。諸元表もサブフォルダも無いときだけファイル名（`_`/`-` 区切りで最後のトークンの前の 2 つ）から取る。走査中は行をファイル（諸元の行）順に固定し、全件そろってから Δ 順に並べ直す。スロットに入れた未走査のファイルは先に走査する。キーは 0（押す: 基準、押さえる: Δ）、1–3（スロット）、Enter（比較台へ）、Esc（ファイルツリーへ）。入口が開いている間、レーン表示のショートカットは働かない。

### 7.2 比較台（comparison bench）

対象: [src/webview/runtime/benchRuntime.ts](../src/webview/runtime/benchRuntime.ts) / [benchPanes.ts](../src/webview/runtime/benchPanes.ts)

入口の表で 1–3 にスロットを入れて Enter を押すと比較台が開く（スロット 1–3 が空なら開かず、フッタに「1–3」を出す）。左にスロットのカード、中央に 基準・比較・差 の 3 段で、どれも scan の `spectrumDb`（192 点、0〜fs/2 の同じ周波数軸）をチャンネル間でパワー平均して描く。基準はスロット 0 のファイル、無ければ比較中のファイルと同条件の点ごとの中央値（入口の表の群と同じ）。差段の見出しは 1/3 oct の Δ の絶対値が大きい 3 帯と Δ Leq で、Leq は 0.1 dB に丸めてから引くので表示上 基準 + Δ = 比較 になる。1–3 は押さえている間だけ比較を入れ替え、短く押すとその比較に切り替える。0 は比較中のファイルを基準にする（もう一度で群に戻す）。Esc で入口に戻り、スロットはそのまま。Enter はスロットのファイルを今までどおり `analyze-selected-files` で開くので、各段の ▶ は既存の再生を使い、Web が Frame を持つのはスロットのファイルだけになる。レーン表示は比較台の裏に残るが、比較台からは行けない（消すのは後の PR）。

### 7.3 散布図・俯瞰帯・区間・差の固定（PR 4）

入口の右に散布図（`entryPlots.ts`）。軸名のプルダウンがそのまま軸の選択で、候補は Leq・主成分 Hz・表の帯域と、諸元の数値列。点の形 = 条件、青 = フォーカス行の基準群、橙の輪 = 外れ値。点を押すとその行にフォーカスする。下に全件の 1/3 oct 俯瞰帯（行 = 表の順、表示中の範囲を枠で囲む）。1–3 は短く押すとスロットへ、押さえるとそのスロットの行（空ならフォーカス行）と基準群の差スペクトルが散布図の下に出て、離して 150 ms で消える（スロットのチップの長押しも同じ）。比較台の左下の区間を変えると、スロットのファイルと各比較の基準群（12 件まで）を `bench-scan` でその区間について scan し直し、終わるまで基準段・差段は灰で「未確定」。13 件以上の群は入口区間の基準を使い、差段の見出しに「基準 = 入口区間」。保存済みの指標は書き換えない。D で比較中の差を固定すると、左列に「Δ · 区間」カードが増え、入口の表では親の行の直下に派生行（親の条件、そのときの基準との Δ）が 1 行入る。派生行は群の件数・中央値・外れ値に入らず、CSV には区間列付きで出る。派生行は PersistedWebviewState（Web は localStorage の viewState）に残る。

### 7.4 手順バー（PR 5）

対象: [src/webview/runtime/stepBar.ts](../src/webview/runtime/stepBar.ts) / [src/shared/recipe/recipeSteps.ts](../src/shared/recipe/recipeSteps.ts)

入口と比較台の上に、scan のレシピをチップで並べる。入口は「entry-scan › … › 指標 v2」、比較台は「entry-scan › … › 区間 › 平均スペクトル」に畳み、「…」で全部を開く。レシピはホストが `entry-conditions` で送る固定レシピ（`recipes/entry-scan.recipe.json`）。⚙ で開くフォームの項目は `STEP_PARAMS`（HPF・LPF・BPF の cutoff と order、welch の n_fft と window）で、wandas 0.9.0 に `default_recipe_registry().describe()` が無いための仮の表（wandas の次のリリースで置き換える）。値は wandas の符号化（float は big-endian IEEE 754 の 16 進）でレシピに書き戻す。標本化周波数に対して無効な値（cutoff ≥ fs/2、2 の冪でない n_fft など）のチップは赤くなり、そのステップを抜いたレシピ（`runnableRecipe`）で入口を最初から scan し直す（保存済みの結果はレシピ鍵が違うので使わない）。編集したレシピは PersistedWebviewState に残り、読めなくなっていたら 1 行の警告を出して標準のレシピに戻す。比較台では区間チップが「≠ 入口」の点線になり、平均スペクトルのチップを押さえている間は、基準がスロット 0 の 1 件のときに限り、レーン表示が持つスペクトログラムで 3 段を描く。

### 7.5 報告の出口（PR 6）

対象: [src/webview/runtime/benchReport.ts](../src/webview/runtime/benchReport.ts)

比較台の「報告に」で、`<レシピ名>_<YYYYMMDD-HHMMSS>/` の 1 フォルダに、基準.png、スロットごとの 比較 n.png・差 n.png（1200×360、白地）、報告.csv、`<レシピ名>.recipe.json` を書き出す。報告.csv は 1 行 1 スロットで、列は ファイル・条件（列ごと）・区間・Leq dB(A)・基準 Leq・Δ Leq・帯域1〜3 Hz と Δ1〜3 dB・基準群 n・基準群ファイル（`;` 区切り）・解析仕様版・外れ値（UTF-8 BOM、dB は小数 1 桁、Hz は整数、欠損は空）。.recipe.json は scan のレシピの time_slice に比較台の区間を書き込んだもので、wandas の `RecipePlan.from_dict` でそのまま読める。ファイル名・見出しは UI の言語。Webview が中身を作り、`save-report-folder` でホストに渡す: VS Code は選んだフォルダの下にフォルダを作って書き、Web はフォルダ名の zip を 1 つダウンロードさせる。

### 8. Waveform Renderer

対象: [src/webview/waveform/waveformRenderer.ts](../src/webview/waveform/waveformRenderer.ts) / [scripts/build-webview.js](../scripts/build-webview.js)

責務:

3 層の純粋関数パイプラインで波形を描画する:

1. **CoordTransform** (`makeCoordTransform`): ファイル正規化時刻 `tNorm ∈ [0,1]` をキャンバス X 座標へ変換
2. **Decimation** (`computeViewRange` + `decimateBuckets`): 表示範囲のバケットを選択し argmin/argmax 間引きを行う
3. **Painting** (`paintDecimatedPoints`): Canvas API を呼び出す唯一の層

設計上のポイント:

- Canvas 依存を Painting 層のみに閉じることで、TypeScript 単体テストが Canvas なしで実行できる
- TypeScript ソースを編集し、`npm run compile` で `dist/webview/comparisonWaveform.js` を生成する。生成物は手編集しない

### 9. Range Request Policy

対象: [src/webview/waveform/rangeRequestPolicy.ts](../src/webview/waveform/rangeRequestPolicy.ts)

責務:

- `isCacheSufficient`: 現在のキャッシュデータでズーム表示に十分かを判定する
- `computeReqBounds`: リクエストすべき範囲を計算する

設計上のポイント:

- リクエスト判定ロジックを ComparisonPanel から分離し、単独でテスト可能にしている

### 10. Shared Analysis Types

対象: [src/shared/analysis/analysisTypes.ts](../src/shared/analysis/analysisTypes.ts)

責務:

- `AnalysisResult`、`AnalysisResultWithError`、`DirectoryTreeNode` など、Extension Host と Webview の境界で共有する型を定義する
- Python バックエンドの JSON 契約と TypeScript 側のデータ構造を同期させる

設計上のポイント:

- UI 実装から型定義を分離し、表示層の入れ替えや削除が型契約へ波及しないようにしている
- `src/extension/index.ts` と `src/webview/panels/ComparisonPanel.ts` の両方が同じ型を参照することで、単一ファイル解析と比較ビューのデータモデルを統一している

## 実行シーケンス

### オンデマンド高解像度波形取得（ズーム時）

```mermaid
sequenceDiagram
    participant W as Webview JS
    participant E as Extension Host
    participant WS as AnalysisClient / PythonBackendServer
    participant P as backend_server.py / AnalysisService

    W->>E: postMessage("request-waveform-range", {file, zoomStart, zoomEnd})
    E->>WS: requestRange(file, start, end, points)
    WS->>P: JSON request via stdin
    P->>P: waveform_range() / AnalysisEngine の frame 参照
    P-->>WS: JSON response via stdout
    WS-->>E: resolve promise
    E->>W: postMessage("waveform-range-result", waveformData)
    W->>W: renderWaveformPipeline() で再描画
```

### 単一ファイル解析

```mermaid
sequenceDiagram
    participant U as User
    participant E as Extension Host
    participant P as PythonBackendServer / backend_server.py
    participant A as AnalysisService / AnalysisEngine
    participant C as ComparisonPanel

    U->>E: Analyze File / Analyze Debug Path
    E->>E: 設定読込と対象パス解決
    E->>P: 常駐 backend に analyze リクエスト
    P->>A: analyze(file)
    A-->>P: 解析結果 dict
    P-->>E: request ID 付き NDJSON 応答
    E->>E: JSON.parse / AnalysisResultWithError[] を構築
    E->>C: ComparisonPanel.show([result])
    C-->>U: 1 トラック状態の解析ビューを表示
```

### 比較ビュー

```mermaid
sequenceDiagram
    participant U as User
    participant E as Extension Host
    participant C as ComparisonPanel
    participant P as PythonBackendServer / backend_server.py
    participant A as AnalysisService / AnalysisEngine

    U->>E: フォルダを開く、または既存パネルで再度開く
    E->>C: ディレクトリツリーを選択モードで表示
    C->>E: analyze-selected-files
    loop selected filePaths
        E->>P: 常駐 backend に analyze リクエスト
        P->>A: analyze(file)
        A-->>P: 解析結果 dict
        P-->>E: request ID 付き NDJSON 応答
        E->>E: JSON.parse / AnalysisResultWithError[] へ追加
    end
    E->>C: ComparisonPanel.updateDirectoryResults(results, panel, selectedFilePaths)
    C-->>U: ツリーを残したまま比較トラックを更新
```

## データフロー

### 入力

- ユーザーが選択した音声ファイルパス、またはディレクトリ選択 UI で確定した音声ファイルパス群、または `debugFilePath`
- VS Code 設定値

### 中間データ

- Python 側で `wandas` が返す音声信号オブジェクト
- NumPy 配列に変換したチャンネル別サンプル列
- 集約済みの波形エンベロープと正規化済みスペクトログラム

### 出力

Python 側の正常系レスポンスは `AnalysisResult` として解釈し、Extension Host 側では失敗時の `error` を含めて `AnalysisResultWithError[]` に正規化して扱います。

正常系の `AnalysisResult` は概ね以下の構造です。

```ts
interface AnalysisResult {
  filePath: string;
  fileName: string;
  sampleRateHz: number;
  durationSeconds: number;
  channelCount: number;
  sampleCount: number;
  channels: ChannelSummary[];
}
```

各 `ChannelSummary` は以下を保持します。

- ラベル
- Peak absolute value
- 波形エンベロープ
- 遅延解析で取得したスペクトログラム（未取得時は `null`）

この構造により、バックエンドと UI の依存関係は明確で、互いの内部実装を知らなくても境界契約だけで接続できます。

失敗を含む UI 側の結果モデルは以下です。

```ts
interface AnalysisResultWithError extends AnalysisResult {
  error?: string;
}
```

この形により、比較対象の一部だけが解析失敗しても、パネル全体は閉じずに他トラックを表示し続けられます。

## ディレクトリ構成

```text
src/
  extension/
    bootstrap.ts            package.json の main。index.ts を読み込む
    index.ts                activate: 各部品の組み立て
    extensionContributions.ts コマンド・エクスプローラーメニュー・Welcome ビューの登録
    analysisOrchestrator.ts 解析要求の発行と進捗表示
    panelController.ts      ComparisonPanel の表示・ディレクトリ選択・結果の再注入
    panelSession.ts         パネルと Webview の間のポートと選択状態
    targetDiscovery.ts      対象ファイル／ディレクトリの選択とツリー構築
    exportFlows.ts          WAV / PNG / CSV の書き出し
    recipeFlow.ts           Recipe の実行
    calibrationStore.ts     校正プロファイルの保存と変更通知
    calibrationPanelRuntime.ts 校正パネル（configureCalibration）
    folderStore.ts          フォルダ単位のスキャン索引・セッションの保存
    pythonEnvironment.ts    Python 実行環境の検出と依存パッケージの確認
    pythonBackendServer.ts  解析要求用の永続 Python 子プロセス
    backendIpc.ts           NDJSON IPC の要求管理と診断
    analysisRequestError.ts 解析要求の失敗の型
  shared/
    analysis/
      analysisTypes.ts      共有型定義
    utils/
      audioTarget.ts        Webview メッセージ判定・音声拡張子判定
      directorySelection.ts ディレクトリ選択の純粋関数
      startupDebug.ts       起動時デバッグ挙動の判定
      webviewEscaping.ts    Webview 埋め込み文字列のエスケープ
  webview/
    panels/
      ComparisonPanel.ts    単一ファイル表示と比較表示の Webview UI
    waveform/
      waveformRenderer.ts   波形描画パイプライン（Canvas 非依存・TypeScript）
      rangeRequestPolicy.ts 波形レンジ取得ポリシー
  test/
    *.test.ts               node:test の単体テスト（npm run verify）
    uiSmoke/                Playwright Chromium のスモークテスト（npm run test:ui）
    fixtures/, helpers/     テスト用データと共通ヘルパー
  e2e/
    suite/index.ts          VS Code E2E スモークテスト
python-backend/
  backend_server.py         常駐 NDJSON サーバー
  command_dispatch.py       共通10コマンドの入力検証と dispatch
  analysis_service.py       解析コマンドの実装
  scan_service.py           scan: 1 ファイルの区間から解析仕様の指標を取る（入口の表の 1 行）
  analysis_spec.py          解析仕様（版付きの固定値。版は scan の条件 ID に入る）
  analysis_engine.py        音声 frame と STFT のキャッシュ
  analyzer.py               frame から表示用結果を生成
  decimator.py              バケット argmin/argmax 波形エンベロープ生成
dist/webview/               compile による生成物
  comparisonWaveform.js     waveformRenderer.ts の Webview バンドル
  comparisonRuntime.js      比較ビューの runtime バンドル
  chartSpecRuntime.js       Recipe ChartSpec renderer のバンドル
media/
  debug/
    sine-440.wav            デバッグ用の単一音声ファイル
    (複数 wav)              マルチトラックテスト用
docs/
  architecture.md           本資料
  developer-guide(.ja).md   開発手順
```

## 依存関係

### TypeScript / VS Code 側

- VS Code Extension API
- Node.js `child_process`
- Node.js `path`

### Python 側

- `wandas`: 音声読み込み、FFT、STFT などの信号処理
- `numpy`: チャンネル整形、可視化向け集約、データ圧縮

## 設定と実行境界

プロジェクト設定の主要な境界は以下です。

- `audioWandasAnalyzer.pythonCommand`: Python 実行コマンド
- `audioWandasAnalyzer.cacheMemoryMb`: 常駐 Python バックエンドの音声キャッシュ上限
- `audioWandasAnalyzer.debugFilePath`: デバッグ用音声ファイルまたはディレクトリのパス

この構成により、実行環境の違いは主に Python コマンド解決へ閉じ込められます。

## 例外処理方針

- リクエスト処理中の Python 例外は request ID 付きの error 応答として返す
- TypeScript 側は error 応答、起動失敗、タイムアウト、プロセス終了を対応する要求の失敗として扱う
- JSON 解析失敗も Extension Host で検出し、ユーザーへ通知する

この方針により、UI 層に Python 例外の詳細を持ち込まず、障害点を Extension Host で集約できる設計になっています。

## 拡張ポイント

将来的な拡張は主に次の 3 箇所に集約できます。

1. Python 側の解析項目追加
   `analyzer.py` の戻り値へ新しいメトリクスを追加し、`AnalysisResult` に追従させる
2. Webview の可視化追加
  既存のチャンネルループに新しいセクションを加えるだけで、マルチトラック比較レイアウトを維持したまま拡張しやすい
3. コマンド追加
   `src/extension/index.ts` で別の入力導線やバッチ解析導線を定義できる。現状でも単一ファイルとディレクトリの両方を受け付ける

## 現状の制約

- Webview は解析結果を一括注入する方式なので、超大規模データを段階読み込みする構成ではない
- 常駐 backend は要求ごとに処理し、継続的なストリーミング解析には未対応
- 入力フォーマットの取り扱いは現状 `wandas.read()` に依存しているため、README 上の拡張子一覧と実際のデコード対応範囲は Python ライブラリ側の能力に左右される

## 開発時の判断基準

- VS Code API に触れる変更は Extension Host に閉じ込める
- 数値処理や信号処理は Python 側へ寄せる
- UI 用のデータ圧縮はバックエンドで済ませ、Webview には描画に必要な粒度だけ渡す
- TypeScript と Python の境界変更時は、`AnalysisResult` と JSON 出力の整合性を最優先で確認する

## Shared spectrogram GUI kernel (stage one)

The canonical source and synchronization tool live in
[kasahart/wandas-gui](https://github.com/kasahart/wandas-gui).
`src/shared/gui-core` is a commit/hash-pinned MIT source snapshot with LICENSE and
NOTICE. `scripts/sync-gui-core.mjs` is also pinned to that repository; compile
checks source, attribution and tool hashes without contacting the network.
Update the clean canonical checkout, commit it, then run:

```sh
node scripts/sync-gui-core.mjs --from <wandas-gui checkout> --into src/shared/gui-core
npm run verify
```

Insight uses the same source and tool in its own snapshot destination. The
consumer-local package manifest is a source-entry shim, not the upstream build
manifest. Runtime dependencies remain zero. `spectrogramRaster.ts` retains
Analyzer's track mapping, calibrated units/references and legacy interval policy.
The kernel reuses ImageData's buffer; axes, cursor, cache, IPC and DSP stay here.
Physical STFT/group axes and boundary corrections remain separate product work.
