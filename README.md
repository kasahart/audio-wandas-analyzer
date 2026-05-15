# Audio Wandas Analyzer

VS Code 拡張として音声ファイルを解析し、TypeScript 製の UI から Python バックエンドを呼び出して結果を表示する最小構成です。

## 構成

- `src/extension/index.ts`: コマンド登録、ファイル選択、Python 実行
- `src/webview/panels/ComparisonPanel.ts`: 単一ファイル表示と比較表示を担う Webview UI
- `src/shared/analysis/analysisTypes.ts`: Extension と Webview 間で共有する解析結果の型
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

### テスト

```bash
npm test
```

VS Code 実環境で debug command から ComparisonPanel が開く最小スモークを回す場合は、次を使います。

```bash
npm run test:e2e:vscode
```

この E2E はワークスペース内の `.venv/bin/python` を使って、`Audio Analyzer: Analyze Debug Path` の経路を実際に起動します。単一ファイル debug path だけでなく、ディレクトリ debug path ではファイル選択画面を経由して比較表示まで確認します。
Linux のヘッドレス環境では、`xvfb-run` が利用可能なら自動で仮想ディスプレイ付きで実行します。

Testing ビューを使う場合は、この拡張を Extension Development Host で起動してから、別ウインドウ側の Testing ビューを開いてください。現状は src/test 配下の *.test.ts を解析し、describe と test をケース単位で一覧表示します。Run は npm run compile の後に node --test を TAP 出力付きで呼び出し、各ケースの結果を Testing ビューへ反映します。Debug は Testing ビューの Debug アクションから実行でき、単一のファイル、suite、test を対象に Node デバッガーを起動します。

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
4. コマンドパレットから `Audio Analyzer: Analyze File or Folder` を実行
5. WAV / FLAC / OGG / AIFF などの音声ファイル、またはそれらを含むディレクトリを選択

解析パネルを開いた後も、画面内の「別の対象を開く: ファイル / ディレクトリ」ボタンから対象を選び直せます。単一ファイル画面からディレクトリブラウザーへ、またはディレクトリブラウザーから別ファイルへ、同じパネルのまま切り替わります。

ディレクトリを選んだ場合は即時解析せず、まず対応済み音声ファイルだけのディレクトリツリーを表示します。初期状態ではどのファイルも未選択で、チェックを入れたファイルだけが右側のトラックへ即時に追加されます。チェックを外すと、そのトラックも即時に外れます。

デバッグ用の固定入力を素早く試す場合は、`audioWandasAnalyzer.debugFilePath` に既定の音声ファイルまたはディレクトリのパスを設定し、コマンドパレットから `Audio Analyzer: Analyze Debug Path` を実行します。既定値はワークスペース相対の `media/debug` です。ディレクトリを指定した場合は、その配下の対応音声ファイルが選択 UI に表示され、チェック操作に応じてトラック表示が即時更新されます。

F5 直後に debug 用ディレクトリを自動で開きたい場合は、[.vscode/launch.json](.vscode/launch.json) の `Run Extension (Open Debug Directory)` を使ってください。この構成では起動時に `audioWandasAnalyzer.debugFilePath` を自動で開きます。ディレクトリ指定ならファイルツリーを表示したまま開始し、どのファイルを出すかはチェック操作で選べます。

## 初期実装の内容

- `wandas.read_wav()` による音声読み込み
- 基本メタデータの表示
- チャンネルごとの RMS / peak absolute value の算出
- NumPy ベースの簡易周波数ピーク抽出
- 単一ファイルまたはディレクトリ単位の入力受付
- ディレクトリ入力時の再帰ツリー表示とファイル選択解析

## 今後の拡張候補

- `wandas` の `stft()` を使ったスペクトログラム可視化
- 複数ファイル比較
- 解析プリセット切り替え
- 画像や CSV のエクスポート
