# ComparisonPanel 設計仕様書

作成日: 2026-05-07

## 概要

ComparisonPanel は、単一ファイル解析と複数ファイル比較の両方を担う VS Code Webview パネルです。表示層は `src/panels/ComparisonPanel.ts` に集約され、共有契約は `src/panels/analysisTypes.ts` に切り出されています。

対象ユーザーは評価試験・音響解析担当者であり、1 件の測定結果を素早く確認する場合も、複数条件の差分を短時間で比較する場合も、同じ画面モデルで扱えることを主目的とします。

---

## スコープ

この仕様書が対象とするのは以下です。

- `ComparisonPanel` を中心にした単一ファイル解析ビューと比較ビュー
- `extension.ts` による単一ファイル・ディレクトリ入力・Webview メッセージの統合ルーティング
- `analysisTypes.ts` を介した共有データ契約
- `request-waveform-range` による高解像度波形のオンデマンド取得

この仕様書の対象外は以下です。

- Python 側の信号処理アルゴリズム詳細
- 将来のソロ再生、追加ダイアログ、編集系 UI

---

## アーキテクチャ

### 主要ファイル

```text
src/extension.ts               入力解決、Python 実行、Webview メッセージ処理
src/panels/ComparisonPanel.ts  単一ファイル表示と比較表示の Webview UI
src/panels/analysisTypes.ts    AnalysisResult / AnalysisResultWithError / DirectoryTreeNode
src/waveformServer.ts          request-waveform-range の中継
media/comparisonWaveform.js    波形描画パイプライン
```

### データフロー

```text
ユーザーがファイルまたはフォルダを選択
  → extension.ts が対象パスを解決
  → 各ファイルを runAnalysis() で逐次解析
  → AnalysisResultWithError[] を生成
  → ComparisonPanel.show(extensionUri, results, panel)
  → Webview が全データを描画
  → 必要に応じて request-waveform-range を送信
  → extension.ts / WaveformServer が高解像度波形を返す
```

### エントリポイント

```ts
export class ComparisonPanel {
    public static show(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[],
        existingPanel?: vscode.WebviewPanel,
    ): vscode.WebviewPanel
}
```

`AnalysisResultWithError` は `src/panels/analysisTypes.ts` で定義され、解析成功トラックと解析失敗トラックを同じ配列で扱います。

---

## UI レイアウト

### 全体構成

```text
┌─────────────────────────────────────────────────────────────┐
│ ツールバー: [Open file] [Open folder] [Waveform/Spectrogram] │
│             [Stack/Overlay] [Zoom -/+] [Cursor]              │
├──────────────┬──────────────────────────────────────────────┤
│ 余白         │ タイムルーラー                               │
├──────────────┼──────────────────────────────────────────────┤
│ トラックヘッダ│ メイントラックキャンバス                     │
│ ・ファイル名  │ ・共有時間軸                                │
│ ・RMS / rate │ ・ズーム / パン / カーソル同期              │
│ ・M / ▶ / ■ / ✕ │ ・縦積み / オーバーレイ切替             │
│ ・オフセット │ ・オフセット付き描画                        │
│ ・オフセット │                                              │
├──────────────┼──────────────────────────────────────────────┤
│ （繰り返し）  │ （繰り返し）                                │
└─────────────────────────────────────────────────────────────┘
```

### 表示モード

| モード | 目的 |
|------|------|
| 単一トラック | 1 ファイルの解析結果を集中して確認する |
| 縦積み比較 | 複数トラックを上下に分けて比較する |
| オーバーレイ比較 | オフセット調整しながら波形差を重ねて比較する |

### トラックヘッダー要素

| 要素 | 動作 |
|------|------|
| ファイル名 | 省略表示、ホバーで識別しやすくする |
| RMS・チャンネル数・サンプルレート | 読み取り専用メタ情報 |
| `M` | そのトラックの描画を非表示化する |
| `▶` / `■` | そのトラックの再生 / 停止 |
| `✕` | 比較対象からトラックを除外する |
| オフセット値 | 秒単位で表示し、入力・微調整・リセットできる |

---

## インタラクション

### 共有カーソル

- 波形上のマウス移動で全トラックに同じ時刻のカーソルを表示する
- クリックでカーソル固定、再クリックで解除する
- ツールバーに現在時刻を表示する

### ズームとパン

| 操作 | 動作 |
|------|------|
| ツールバー `－` / `＋` | 全トラックの時間軸を同時に拡縮する |
| `Ctrl` + ホイール | 全トラック同時ズーム |
| `Shift` + ホイール | 全トラック同時パン |

### オフセット調整

- 各トラックは独立した時間オフセットを持つ
- オーバーレイモードでは近い波形をヒットテストしてドラッグ対象を決める
- 縦積みモードでは行ごとに直接ドラッグできる
- オフセットは入力欄・ステップボタン・ダブルクリックリセットでも調整できる

### 再生操作

- 各トラックは独立した audio 要素を持つ
- 再生中はそのトラックの現在時刻が共通カーソルへ反映される
- 他トラックの再生開始時は既存再生を停止して切り替える

### 高解像度波形取得

- 初期表示は概要データを使う
- 強いズーム時に `request-waveform-range` を送る
- Extension Host は `WaveformServer` を介して Python 側から範囲波形を受け取り、該当トラックだけ更新する

---

## 状態設計

### 通常状態

- 1 件なら単一トラック解析ビューとして表示する
- 2 件以上なら比較ビューとして表示する
- 表示モード、ズーム範囲、オフセット値、再生状態を Webview 側状態として保持する

### 空状態

- 全トラックを除外した場合は追加導線を表示する
- `Open file` または `Open folder` ボタンから再度対象を選べる

### 解析失敗状態

- 失敗したファイルもトラックとして残す
- 該当行にエラー内容を表示し、他トラックの描画は継続する
- 結果配列は `AnalysisResultWithError[]` で統一する

---

## メッセージ契約

### Webview → Extension

| type | 用途 |
|------|------|
| `select-target` | ファイルまたはフォルダの再選択 |
| `request-waveform-range` | 高解像度波形の範囲取得 |

### Extension → Webview

| type | 用途 |
|------|------|
| `waveform-range-result` | 範囲波形の結果返却 |

---

## 制約・スコープ外

- 追加ダイアログの専用画面は未実装
- 超大規模データの段階読み込みではなく、初期表示は要約データ前提
