# Audio Wandas Analyzer

VS Code 拡張として音声ファイルを解析し、TypeScript 製の UI から Python バックエンドを呼び出して結果を表示する最小構成です。

## 構成

- `src/extension.ts`: コマンド登録、ファイル選択、Python 実行
- `src/panels/AnalysisPanel.ts`: Webview の HTML 描画
- `python-backend/main.py`: CLI エントリポイント
- `python-backend/analyzer.py`: `wandas` を使った音声解析本体

## セットアップ

### Dev Container

VS Code の Dev Containers 拡張を使う前提なら、ローカルの Python や Node を直接汚さずに開発できます。

1. Dev Containers 拡張を入れる
2. このフォルダを開く
3. `Dev Containers: Reopen in Container` を実行する
4. 初回起動時に `npm install` とワークスペース内 `.venv` への `python-backend/requirements.txt` 導入が自動実行される

コンテナ内では `.venv/bin/python` が VS Code の既定インタープリタと拡張機能のバックエンド実行コマンドとして設定されます。

### 1. Node.js 依存関係

```bash
npm install
```

### 2. Python 環境

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r python-backend/requirements.txt
```

必要に応じて VS Code 設定 `audioWandasAnalyzer.pythonCommand` を `.venv/bin/python` に変更してください。Dev Container を使う場合は既定値の `python3` のままで動く想定です。

Dev Container を使う場合は、この設定が自動で `.venv/bin/python` に切り替わります。

## 使い方

1. このフォルダを VS Code で開く
2. `npm install`
3. `F5` で Extension Development Host を起動
4. コマンドパレットから `Audio Analyzer: Analyze File` を実行
5. WAV / FLAC / OGG / AIFF などの音声ファイルを選択

デバッグ用の固定ファイルを素早く試す場合は、`audioWandasAnalyzer.debugFilePath` に既定の WAV パスを設定し、コマンドパレットから `Audio Analyzer: Analyze Debug File` を実行します。既定値はワークスペース相対の `media/debug.wav` です。

## 初期実装の内容

- `wandas.read_wav()` による音声読み込み
- 基本メタデータの表示
- チャンネルごとの RMS / peak absolute value の算出
- NumPy ベースの簡易周波数ピーク抽出

## 今後の拡張候補

- `wandas` の `stft()` を使ったスペクトログラム可視化
- 複数ファイル比較
- 解析プリセット切り替え
- 画像や CSV のエクスポート
