# Audio Wandas Analyzer Architecture

## 概要

このプロジェクトは、VS Code 拡張機能のフロントエンドと Python 製の解析バックエンドを分離した三層構成です。現在のユーザー導線は次の 2 系統に分かれています。

- 単一ファイル解析: ファイルを 1 件選択して即座に解析し、1 トラック状態の ComparisonPanel で確認する
- 比較ビュー: 複数ファイルを対象に順次解析し、複数トラック状態の ComparisonPanel で比較する

- Extension Host 層: コマンド登録、設定取得、ファイル選択、Python プロセス起動を担当
- Python Backend 層: 音声解析、数値計算、JSON 形式の結果生成を担当
- Webview UI 層: 比較パネル描画、ズームやホバーなどのインタラクションを担当

設計上の主眼は、VS Code 固有処理と信号処理ロジックを切り離し、UI と解析処理を疎結合に保つことです。

## 全体構成

```mermaid
flowchart LR
  User[User] --> Command[VS Code Command]
  Command --> Extension[Extension Host\nsrc/extension.ts]

  Extension -->|1 file| Single[単一ファイル解析導線]
  Extension -->|2+ files| Compare[比較ビュー導線]

  Single -->|spawn python| BackendCLI[Python CLI\npython-backend/main.py]
  Compare -->|spawn python per file| BackendCLI
  BackendCLI --> Analyzer[Audio Analyzer\npython-backend/analyzer.py]
  Analyzer -->|JSON stdout| Extension
  Extension --> Panel[ComparisonPanel\nsrc/panels/ComparisonPanel.ts]
  Panel --> User
```

## ユーザーフロー

### 1. 単一ファイル解析

1 件の音声ファイルを選択し、その場で解析して表示する最短導線です。内部では `runAnalysis()` を 1 回だけ呼び、返ってきた `AnalysisResult` を `AnalysisResultWithError[]` の 1 要素配列として `ComparisonPanel.show()` に渡します。したがって UI 上は比較パネルでも、実際には単一トラックの詳細閲覧として振る舞います。

### 2. 比較ビュー

複数ファイルを対象に解析して、共通タイムライン上で比較する導線です。開始点は 2 通りあります。

- フォルダを選択し、配下の対応音声ファイル群を一括対象にする
- 単一ファイルを開いたあと、ツールバーから別のファイルまたはフォルダを開いて同じパネルを再利用する

内部では `runAnalysis()` をファイルごとに繰り返し、成功トラックと失敗トラックを含む `AnalysisResultWithError[]` を `ComparisonPanel.show()` に渡します。比較対象が 2 件以上のとき、ComparisonPanel はオフセット調整、ズーム同期、再生操作を伴う比較ビューとして動作します。

## コンポーネント責務

### 1. Extension Host

対象: [src/extension.ts](/workspaces/audio-wandas-analyzer/src/extension.ts)

責務:

- VS Code コマンド `audioWandasAnalyzer.analyzeFile` と `audioWandasAnalyzer.analyzeDebugFile` を登録する
- 対象の音声ファイルまたはディレクトリを選択または解決する
- 受け取った対象を単一ファイル解析導線または比較ビュー導線へ振り分ける
- Webview から `select-target` と `request-waveform-range` を受け取る
- 設定値 `pythonCommand`、`defaultPeakCount`、`debugFilePath` を読み込む
- Python バックエンドを子プロセスとして起動する
- 標準出力の JSON を `AnalysisResult` として解釈し、失敗時は `error` 付きの結果へ変換して `AnalysisResultWithError[]` に蓄積する
- 成功時は `ComparisonPanel` を開き、失敗時は VS Code 通知にエラーを表示する

特徴:

- バックエンドとの境界はプロセス実行と JSON 入出力だけに限定されている
- 解析ロジックを TypeScript 側に持たないため、UI 修正と数値処理修正を独立して進めやすい
- 単一ファイルと複数ファイルの差は主に入力本数だけで、描画面は共通化されている

### 2. Python CLI Entry Point

対象: [python-backend/main.py](/workspaces/audio-wandas-analyzer/python-backend/main.py)

責務:

- コマンドライン引数 `--file` と `--peaks` を受け取る
- `analyze_audio` を呼び出す
- 解析結果を JSON として標準出力に書き出す
- 例外発生時は標準エラー出力にメッセージを出し、非ゼロ終了コードで終了する

特徴:

- CLI を薄く保つことで、解析本体のテストや再利用をしやすくしている
- VS Code 拡張以外の呼び出し元を将来的に追加する場合も、この境界を流用しやすい

### 3. Audio Analyzer

対象: [python-backend/analyzer.py](/workspaces/audio-wandas-analyzer/python-backend/analyzer.py)

責務:

- `wandas.read_wav()` による音声データ読み込み
- チャンネル向きの正規化
- RMS、ピーク値、優勢周波数の算出
- 波形エンベロープ生成
- スペクトログラム生成と可視化向けの縮約
- UI が扱いやすい辞書構造への整形

設計上のポイント:

- 大きな音声データをそのまま UI に渡さず、波形は最大 1200 点、時間方向スペクトログラムは最大 720 ビン、周波数方向は最大 192 ビンへ圧縮している
- 数値データを可視化用に事前整形することで、Webview 側は描画ロジックに集中できる
- チャンネルごとに独立した要約を返すため、多チャンネル音声でも同一描画パターンを再利用できる

### 4. ComparisonPanel

対象: [src/panels/ComparisonPanel.ts](/workspaces/audio-wandas-analyzer/src/panels/ComparisonPanel.ts)

責務:

- `AnalysisResultWithError[]` を HTML とインラインスクリプトへ埋め込む
- 1 件のときは単一トラック解析ビュー、2 件以上のときは比較ビューとして描画する
- 共通タイムルーラー、ズーム、パン、カーソル同期、トラックごとの再生操作を処理する
- オンデマンド波形取得のために `request-waveform-range` メッセージを送る
- 解析失敗トラックをエラー表示のまま比較対象に残す

設計上のポイント:

- 現在の主表示経路は単一ファイルでも複数ファイルでも `ComparisonPanel` に統一されている
- 比較件数に応じてタイトルとレイアウト密度だけが変わり、基本的な描画パイプラインは共通である
- 波形描画ロジックは [media/comparisonWaveform.js](/workspaces/audio-wandas-analyzer/media/comparisonWaveform.js) と協調している

### 5. Shared Analysis Types

対象: [src/panels/analysisTypes.ts](/workspaces/audio-wandas-analyzer/src/panels/analysisTypes.ts)

責務:

- `AnalysisResult`、`AnalysisResultWithError`、`DirectoryTreeNode` など、Extension Host と Webview の境界で共有する型を定義する
- Python バックエンドの JSON 契約と TypeScript 側のデータ構造を同期させる

設計上のポイント:

- UI 実装から型定義を分離し、表示層の入れ替えや削除が型契約へ波及しないようにしている
- `extension.ts` と `ComparisonPanel.ts` の両方が同じ型を参照することで、単一ファイル解析と比較ビューのデータモデルを統一している

## 実行シーケンス

### 単一ファイル解析

```mermaid
sequenceDiagram
    participant U as User
    participant E as Extension Host
    participant P as Python CLI
    participant A as Analyzer
    participant C as ComparisonPanel

    U->>E: Analyze File / Analyze Debug Path
    E->>E: 設定読込と対象パス解決
    E->>P: 子プロセス起動
    P->>A: analyze_audio(file, peak_count)
    A-->>P: 解析結果 dict
    P-->>E: stdout に JSON 出力
    E->>E: JSON.parse / AnalysisResultWithError[] を構築
    E->>C: ComparisonPanel.show([result])
    C-->>U: 1 トラック状態の解析ビューを表示
```

### 比較ビュー

```mermaid
sequenceDiagram
    participant U as User
  participant V as VS Code
    participant E as Extension Host
    participant P as Python CLI
    participant A as Analyzer
  U->>V: フォルダを開く、または既存パネルで再度開く
  V->>E: analyzeFile command / select-target message
    loop filePaths
        E->>P: 子プロセス起動
        P->>A: analyze_audio(file, peak_count)
        A-->>P: 解析結果 dict
        P-->>E: stdout に JSON 出力
        E->>E: JSON.parse / AnalysisResultWithError[] へ追加
    end
    E->>C: ComparisonPanel.show(results, existingPanel)
    C-->>U: 複数トラック比較ビューを表示
```

## データフロー

### 入力

- ユーザーが選択した音声ファイルパスまたはディレクトリパス、または `debugFilePath`
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
- RMS
- Peak absolute value
- 優勢周波数の配列
- 波形エンベロープ
- スペクトログラム

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
  extension.ts              VS Code 拡張のエントリポイント
  panels/
    ComparisonPanel.ts      単一ファイル表示と比較表示の Webview UI
    analysisTypes.ts        共有型定義
python-backend/
  main.py                   Python CLI エントリポイント
  analyzer.py               音声解析ロジック
media/
  debug.wav                 デバッグ用の既定音声ファイル
docs/
  architecture.md           本資料
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
- `audioWandasAnalyzer.defaultPeakCount`: チャンネルごとの優勢周波数件数
- `audioWandasAnalyzer.debugFilePath`: デバッグ用音声ファイルまたはディレクトリのパス

この構成により、実行環境の違いは主に Python コマンド解決へ閉じ込められます。

## 例外処理方針

- Python 側で例外が起きた場合は CLI が標準エラー出力へメッセージを書き、終了コード 1 を返す
- TypeScript 側は終了コードと標準エラー出力を見て失敗扱いにする
- JSON 解析失敗も Extension Host で検出し、ユーザーへ通知する

この方針により、UI 層に Python 例外の詳細を持ち込まず、障害点を Extension Host で集約できる設計になっています。

## 拡張ポイント

将来的な拡張は主に次の 3 箇所に集約できます。

1. Python 側の解析項目追加
   `analyzer.py` の戻り値へ新しいメトリクスを追加し、`AnalysisResult` に追従させる
2. Webview の可視化追加
  既存のチャンネルループに新しいセクションを加えるだけで、マルチトラック比較レイアウトを維持したまま拡張しやすい
3. コマンド追加
  `extension.ts` で別の入力導線やバッチ解析導線を定義できる。現状でも単一ファイルとディレクトリの両方を受け付ける

## 現状の制約

- Webview は解析結果を一括注入する方式なので、超大規模データを段階読み込みする構成ではない
- バックエンド呼び出しは同期的な単発プロセス実行であり、継続的なストリーミング解析には未対応
- 入力フォーマットの取り扱いは現状 `wandas.read_wav()` に依存しているため、README 上の拡張子一覧と実際のデコード対応範囲は Python ライブラリ側の能力に左右される

## 開発時の判断基準

- VS Code API に触れる変更は Extension Host に閉じ込める
- 数値処理や信号処理は Python 側へ寄せる
- UI 用のデータ圧縮はバックエンドで済ませ、Webview には描画に必要な粒度だけ渡す
- TypeScript と Python の境界変更時は、`AnalysisResult` と JSON 出力の整合性を最優先で確認する