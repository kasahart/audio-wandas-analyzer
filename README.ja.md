# Audio Wandas Analyzer

[English](https://github.com/kasahart/audio-wandas-analyzer/blob/main/README.md) | **日本語**

VS Code 上で音声ファイルを開き、波形・スペクトログラム・パワースペクトルを並べて比較・解析できる拡張機能です。DSP の重い部分は Python 側の [wandas](https://github.com/kasahart/wandas) ライブラリが担い、UI は VS Code Webview で動きます。

## 主な機能

- **マルチトラック比較** — 複数の音声ファイルを同時に開き、波形 / スペクトログラム / パワースペクトルを並べて比較
- **波形表示** — ズームに応じた高解像度再描画。振幅軸 (±1.0 FS) と時間軸を常時表示
- **スペクトログラム** — 周波数軸 (Hz / kHz) と dB カラーバー付き。STFT パラメータ (FFT 長 / ホップ長 / 窓関数) と表示範囲 (dB 最小・最大、最大周波数) を設定パネルから変更可能
- **カーソル時刻のパワースペクトル** — 全トラック横断のオーバーレイと、トラック行ごとの per-track スペクトル
- **再生 / ループ** — 各トラックを単独再生、ミュート、再生位置をループ範囲に拘束
- **トラックオフセット** — 各トラックを時間軸方向にずらして整列
- **ディレクトリ選択 UI** — フォルダを開くと対応音声ファイルのツリーが表示され、チェックでトラックを追加 / 削除
- **エクスプローラ統合** — 音声ファイルやフォルダの右クリック、サイドバーへのドラッグ＆ドロップで解析開始

対応フォーマット: **WAV / FLAC / OGG / AIFF / AIF / SND**

## 必要な環境

この拡張は Python の `wandas` をバックエンドとして呼び出します。事前に Python 環境の準備が必要です。

### 1. Python 3.11 を用意

```bash
python3 --version   # 3.11 以上を推奨
```

### 2. wandas をインストール

仮想環境推奨:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install wandas numpy soundfile
```

### 3. VS Code に Python のパスを伝える

設定画面で `audioWandasAnalyzer.pythonCommand` を上の仮想環境の Python に変更してください。例: `/path/to/your/.venv/bin/python`。

または、コマンドパレット (`Ctrl+Shift+P` / `Cmd+Shift+P`) から **Audio Analyzer: Select Python Environment** を実行して GUI で選択できます。

## 使い方

### ファイルを開く

| 方法 | 操作 |
|------|------|
| コマンドパレット | **Audio Analyzer: Analyze File or Folder** |
| 右クリックメニュー | エクスプローラ上で音声ファイル / フォルダを右クリック → **Analyze with Audio Analyzer** |
| サイドバー | アクティビティバーの **Audio Analyzer** アイコン → *ファイル・フォルダを選択して解析* |
| ドラッグ＆ドロップ | サイドバーの *Drop audio files or folders here* 行へドロップ |

### ディレクトリを開いた場合

対応ファイルのツリーが表示されます。最初は未選択状態で、チェックを入れたファイルだけが右側のトラック領域に即時追加されます。チェックを外せばそのトラックも即時に消えます。

### 操作

- **ズーム**: ツールバーの `+ / -`、または波形上でスクロール
- **カーソル移動**: 波形 / スペクトログラム上をクリック
- **ループ範囲**: ドラッグして選択 / クリックで解除
- **トラックオフセット**: トラック左側の `▲ / ▼` ボタンで ±0.01 秒ずつ調整、表示をダブルクリックでリセット
- **再生**: トラック行の `▶` ボタン、`■` で停止
- **ミュート**: トラック行の `M` ボタン (パワースペクトルのオーバーレイからも除外される)
- **スペクトログラム設定**: ツールバー右の歯車アイコンから FFT 長・ホップ長・窓関数・表示範囲を変更

### 表示モード切替

トラック単位のツールバーで **波形 / スペクトログラム** を切り替えられます。

## 設定

| 設定キー | 既定値 | 説明 |
|---------|------|------|
| `audioWandasAnalyzer.pythonCommand` | `python3` | バックエンドを起動する Python の実行パス |
| `audioWandasAnalyzer.defaultPeakCount` | `5` | チャンネルごとに表示する周波数ピーク数 (1–20) |
| `audioWandasAnalyzer.debugFilePath` | `media/debug` | **Audio Analyzer: Analyze Debug Path** で開くデフォルトのパス。相対パスはワークスペースルートから解決 |

## トラブルシューティング

- **「Python interpreter was not found」** — 上記の手順で wandas をインストールした Python の絶対パスを `audioWandasAnalyzer.pythonCommand` に設定してください。
- **「analyze failed」のエラー** — VS Code の **Output** パネルで **Audio Wandas Analyzer** チャンネルを確認すると、Python 側のスタックトレースが表示されます。`wandas` / `numpy` / `soundfile` がインストールされているか確認してください。
- **音声ファイルが読み込めない** — 現状は WAV / FLAC / OGG / AIFF のみ対応。MP3 / M4A 等は非対応です。
- **大きなファイルで重い** — 波形はズームに応じてリクエスト範囲だけ高解像度で再取得する仕組みになっており、初回読み込み後はズームしても表示は素早く更新されます。スペクトログラムの FFT 長を小さくすると更新が速くなります。

## ソースコードとライセンス

- リポジトリ: https://github.com/kasahart/audio-wandas-analyzer
- バックエンド: [wandas](https://github.com/kasahart/wandas)
- 開発者向けセットアップとアーキテクチャ詳細は [`AGENTS.md`](https://github.com/kasahart/audio-wandas-analyzer/blob/main/AGENTS.md) を参照してください。
- バグ報告 / 機能要望は [GitHub Issues](https://github.com/kasahart/audio-wandas-analyzer/issues) へお願いします。
