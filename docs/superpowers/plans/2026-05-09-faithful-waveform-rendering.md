# Faithful Waveform Rendering 実装計画

**Goal:** 波形表示をデータに忠実にしつつ、ComparisonPanel のズーム・パン・オフセット操作で十分に軽い描画を維持する。

**Architecture:** Python 側は `decimator.py` を使って各バケットの min/max 値と実ファイル基準の `minT/maxT` を返す。TypeScript / Webview 側は `waveformRenderer.ts` と `media/comparisonWaveform.js` で同じ描画アルゴリズムを共有し、ComparisonPanel は offscreen Canvas と rAF バッチングで再描画回数を抑える。

**Tech Stack:** Python 3.11, numpy, TypeScript, node:test, Canvas 2D API

---

## 現行ファイル構成

| ファイル | 役割 |
|---------|------|
| `python-backend/decimator.py` | バケット単位の min/max と `minT/maxT` を返す |
| `python-backend/analyzer.py` | 全体解析の波形要約を作る |
| `python-backend/range_analyzer.py` | 範囲解析を返す |
| `python-backend/waveform_server.py` | 範囲波形リクエストを常駐処理する |
| `src/panels/waveformRenderer.ts` | 描画計算の純粋関数群 |
| `media/comparisonWaveform.js` | Webview から呼ぶ描画実装 |
| `src/panels/ComparisonPanel.ts` | rAF バッチング、ズーム、カーソル、範囲取得の統合 UI |
| `src/test/waveformRenderer.test.ts` | 座標変換とデシメーションの回帰テスト |

---

## 実装ステップ

### Step 1: Python 側でピーク位置を保持する

目的:

- バケット内の極値を値だけでなく時刻位置つきで返す
- 範囲取得時も full-file 基準の正規化時刻を保つ

実装ポイント:

- `decimated_waveform()` は `min` / `max` / `minT` / `maxT` / `samples` / `absolutePeak` を返す
- `start_sample` と `total_samples` を受け取り、範囲要求でも絶対位置を失わない

完了条件:

- `python-backend/test_decimator.py` が通る
- `analyzer.py` と `range_analyzer.py` が同じデシメータを使う

### Step 2: 描画計算を純粋関数へ寄せる

目的:

- Canvas API 非依存の計算部分をテスト可能にする
- Webview と TypeScript テストで同じロジックを追えるようにする

実装ポイント:

- `makeCoordTransform()` がグローバル時間軸とオフセットを処理する
- `computeViewRange()` が表示対象バケット範囲を決める
- `decimateBuckets()` が描画点列を生成する
- `paintDecimatedPoints()` だけが Canvas API を触る

完了条件:

- `src/test/waveformRenderer.test.ts` が通る
- `media/comparisonWaveform.js` と `waveformRenderer.ts` の整合が取れている

### Step 3: ComparisonPanel で再描画を束ねる

目的:

- ホイール、ドラッグ、リサイズ時の再描画を安定させる
- 不要な再ラスタライズを減らす

実装ポイント:

- `renderAll()` の直呼びを避け、`scheduleRender()` に寄せる
- offscreen Canvas に波形本体を焼き、前景ではカーソルなどを合成する
- リサイズ時は dirty 状態だけ更新し、必要トラックだけ再描画する

完了条件:

- ComparisonPanel のズームとパンがガタつかない
- リサイズ回帰テストが通る

### Step 4: 高解像度範囲要求をズームに接続する

目的:

- 初期表示は軽量、拡大時は精度優先に切り替える

実装ポイント:

- `rangeRequestPolicy.ts` がキャッシュ十分性と要求範囲を決める
- `request-waveform-range` / `waveform-range-result` で必要トラックだけ更新する
- 取得失敗時は overview データへフォールバックする

完了条件:

- 強ズーム時に高解像度データへ差し替わる
- キャッシュが十分なら不要要求を出さない

### Step 5: 回帰テストで固定する

確認項目:

- `python-backend/test_decimator.py` が通る
- `src/test/waveformRenderer.test.ts` が通る
- `src/test/renderScript.integration.test.ts` が通る
- `npm test` が緑になる

---

## 現行設計の要点

- 表示 UI は `ComparisonPanel.ts` に集約されている
- 波形レンダリングは 3 層構造で、計算と描画を分離している
- Python の `minT/maxT` は full-file 基準なので、オフセットやグローバルタイムラインでも位置合わせを保てる
- 比較ビューと単一ファイル表示は同じ描画パイプラインを共有する
