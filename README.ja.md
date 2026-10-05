# Audio Wandas Analyzer

[English](https://github.com/kasahart/audio-wandas-analyzer/blob/main/README.md) | **日本語**

VS Code を、そのまま音声確認の作業台に。Audio Wandas Analyzer は、音声ファイルを開き、複数テイクを同じタイムラインで比較し、波形の細部、スペクトログラム、カーソル位置のパワースペクトルを確認しながら、必要な証跡をその場で出力できる拡張機能です。

## スクリーンショット

![Audio Wandas Analyzer のスクリーンショット](https://raw.githubusercontent.com/kasahart/audio-wandas-analyzer/main/media/readme-audio-wandas-analyzer.png)

![Audio Wandas Analyzer のスペクトログラム表示スクリーンショット](https://raw.githubusercontent.com/kasahart/audio-wandas-analyzer/main/media/readme-audio-wandas-analyzer_stft.png)

## なぜ便利か

音声比較では、DAW、ノートブック、ファイルブラウザ、プロット用スクリプトを行き来しがちです。この拡張は、その確認ループを VS Code の中にまとめます。

- 複数の録音や生成結果を並べ、タイミング差をすぐ確認
- ファイルを読み直さずに、波形、スペクトログラム、パワースペクトルを行き来
- ズーム中の範囲だけを高解像度で再取得して、細部を軽快に確認
- 再生、ミュート、ループ、トラックの時間オフセット調整を同じ画面で操作
- 画像、CSV スペクトル、ループ音声、Markdown 向けレポートを出力
- [wandas](https://github.com/kasahart/wandas) の同梱 / カスタムレシピでさらに深い解析を実行

対応フォーマット: **WAV / FLAC / OGG / AIFF / AIF / SND**

UI は VS Code の表示言語に追従します。`ja*` では日本語、それ以外では英語で表示されます。

## こんな用途に

- モデル出力、録音テイク、レンダー、処理前後の音声比較
- ノイズ、周波数バランス、トランジェント、無音、クリッピング、位置ずれの確認
- フォルダ内の音声アセットを、エディタから離れずにレビュー
- Issue、レポート、Notebook、Pull Request に貼るための画像や数値データ作成

## クイックスタート

### 1. Python 3.11 以上を用意

```bash
python3 --version
```

### 2. Python の音声解析依存関係をインストール

仮想環境の利用をおすすめします。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install "wandas[psychoacoustic]>=0.7.2,<0.8.0" "numpy>=2.0.2" "scipy>=1.13" "soundfile>=0.12"
```

### 3. VS Code で Python 環境を選択

コマンドパレットから次を実行します。

```text
Audio Analyzer: Select Python Environment
```

作成した仮想環境フォルダを選んでください。例: `/path/to/your/.venv`。設定 `audioWandasAnalyzer.pythonCommand` に手動で指定することもできます。仮想環境フォルダと Python 実行ファイルのどちらも利用できます。

## 音声を開く

| 方法 | 操作 |
| --- | --- |
| コマンドパレット | **Audio Analyzer: Analyze File or Folder** を実行 |
| エクスプローラの右クリック | 音声ファイルまたはフォルダを右クリックし、**Analyze with Audio Analyzer** を選択 |
| アクティビティバー | **Audio Analyzer** ビューを開き、ファイルまたはフォルダを選択 |
| ドラッグ＆ドロップ | Audio Analyzer サイドバーへ音声ファイルまたはフォルダをドロップ |

フォルダを開くと、対応音声ファイルがツリー表示されます。チェックを入れると比較パネルに追加され、チェックを外すとそのトラックが削除されます。

## パネルでの操作

- **比較:** 複数トラックを共通タイムラインに並べ、行ごとに波形 / スペクトログラムを切り替え
- **ズーム:** ツールバーの `+ / - / 0`、キーボードショートカット、またはプロット上のホイール操作
- **確認:** 波形、スペクトログラム、スペクトル上をクリックしてカーソルを動かし、スペクトルを更新
- **ループ:** 波形上をドラッグしてループ範囲を作成し、クリックで解除
- **再生:** トラックごとの再生ボタンを使用。`M` でミュート
- **位置合わせ:** `▲ / ▼` でトラックの時間オフセットを調整。値をダブルクリックするとリセット
- **スペクトログラム調整:** 歯車ポップオーバーから FFT 長、ホップ長、窓関数、dB 範囲、最大周波数を変更
- **ヘルプ:** パネル内で `?` を押すとキーボードショートカットを表示

## エクスポートとレシピ

比較ツールバーから、解析結果をそのまま外部作業へ渡せます。

| 操作 | 出力 |
| --- | --- |
| **PNG 出力** | 表示中のトラック画像 |
| **CSV 出力** | 現在のカーソル位置のスペクトルデータ |
| **WAV 出力** | 選択したループ範囲の音声 |
| **レポート出力** | Markdown / Notebook 向け解析レポート |
| **レシピ実行** | wandas レシピの結果を VS Code 内に表示 |

## 設定

| 設定キー | 既定値 | 説明 |
| --- | --- | --- |
| `audioWandasAnalyzer.pythonCommand` | `python3` | バックエンドに使う Python 環境フォルダまたは実行ファイル |
| `audioWandasAnalyzer.cacheMemoryMb` | `1024` | 常駐 Python 波形バックエンドが使う音声キャッシュの上限 MB |
| `audioWandasAnalyzer.debugFilePath` | `media/debug` | **Audio Analyzer: Analyze Debug Path** で開く既定パス |

## トラブルシューティング

- **Python interpreter was not found:** `wandas` を入れた仮想環境を選択するか、`audioWandasAnalyzer.pythonCommand` を更新してください。
- **解析に失敗する:** **Output: Audio Wandas Analyzer** を開き、Python 側のエラーを確認してください。選択中の環境に `wandas`、`numpy`、`soundfile` が入っているか確認します。
- **ファイルが読み込めない:** 拡張子が WAV、FLAC、OGG、AIFF、AIF、SND のいずれかか確認してください。MP3 / M4A はまだ非対応です。
- **大きなファイルが重い:** 波形は表示中のズーム範囲だけを取得します。スペクトログラムが重い場合は FFT 長やホップ長を小さくしてください。

## リンク

- リポジトリ: https://github.com/kasahart/audio-wandas-analyzer
- バックエンドライブラリ: [wandas](https://github.com/kasahart/wandas)
- 開発者ガイド: [docs/developer-guide.ja.md](https://github.com/kasahart/audio-wandas-analyzer/blob/main/docs/developer-guide.ja.md)
- バグ報告 / 機能要望: [GitHub Issues](https://github.com/kasahart/audio-wandas-analyzer/issues)


### 静的Web試作（Wandas 0.8.1）

`npm run prepare:browser` → `npm run build:browser` で `browser-dist/` を生成します。`python3 -m http.server 8080 --directory browser-dist` など静的HTTPで確認できます。解析サーバーは不要です。相対URLなのでGitHub Pagesのproject subpathで配布可能ですが、公開手順は下記GitHub Pages workflowを参照してください。

既存Comparison UIとPython AnalysisServiceを再利用し、ブラウザではPyodide Worker＋bytes/source-id adapterでWAVを解析します。音声は送信されません。1秒・2.5秒ステレオ固定fixtureのnative/Pyodide数値比較（331,560点）は、runtime準備後に `AWA_VERIFY_BROWSER=1 npm run verify` で実行します。

試作上限: RIFF WAV 16 MiB・30秒・1–2ch・1–96kHz・32サンプル以上。複数選択・追加・削除に対応し、最大8トラック、入力合計64 MiB・展開音声合計64 MiBを保持します。共通UIのカーソル・オフセット・表示・再生停止・ミュート・区間選択を使用し、複数区間WAVはZIPで出力します。書き出しは各音声の長さとオフセットを反映します。取消で共有Workerを終了・全Blobを解放します。無効な追加は既存トラックを保持し、Worker障害時は全トラックを解放して再読込できます。STFTは半窓以上の音声長が必要で、512 MiB推定上限を超える設定を拒否します。詳細キャッシュは128 MiB、区間出力合計は32 MiBに制限します（ブラウザの実メモリ上限を保証するものではありません）。区間出力は原音PCM16 WAV、再生はユーザー操作時のみです。Recipe・mosqito・WDF/h5py・全codec・directory scan・校正設定・vscode.devは未対応です。desktop VSCodeの既存機能は保持します。WAV命名・重複連番・レポート生成・保存設定の検証は共通化し、Webもブラウザ言語に応じた英日表示、STFT／表示設定と波形／STFTモードの復元、Markdown／Notebookダウンロードに対応します。音声・元パスは永続保存しません。Notebookはレポート記載の音声ファイル別名を参照するため、音声のコピーを対応する名前で配置してください。詳細とASD Insightとの最小UI共有案はREADME.mdの対応節を参照してください。

`npm run verify:e2e` は実VSCode Webviewから短いステレオWAVのSTFT・cursor・区間保存を検証します。保存先選択のみ一時folderへ注入し、実Python backendとVSCodeファイル書込みを通したPCM16出力が原音区間と完全一致することを確認します。OS picker自体の操作は対象外、出力は自動削除され、再生操作は行いません。

追加監査ではproject subpath、FFT/hop設定変更、実時刻cursor、画面選択区間のWAV原音一致、取消・反復切替・旧Blob解放、不正/過大/過長WAV、runtime初期化失敗・Worker障害後の復旧を確認します。静的host専用subscriptionでwindow messageの混入を防ぎ、VSCodeの既存message transportは保持します。390px Chromiumタッチ相当では読込・cursor tap・STFT・取消を確認しますが、タッチdrag区間選択は未対応で軸表示も窮屈です。実機mobile/Safari・長時間メモリ負荷・OS picker・音声再生は未検証です。

GitHub Pagesは `.github/workflows/pages.yml` で公開します。PRで静的artifactをbuild・hash検証し、mainのCI成功後にそのcommitを配信します。公開対象は `browser-dist/` のみ（固定公開runtime・noticesを含む）。追加secretや入力音声の公開はありません。
