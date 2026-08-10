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
pip install "wandas[psychoacoustic]>=0.7.1,<0.8.0" "numpy>=2.0.2" "scipy>=1.13" "soundfile>=0.12"
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
| `audioWandasAnalyzer.defaultPeakCount` | `5` | チャンネルごとに表示する主要周波数ピーク数。1 から 20 まで |
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
