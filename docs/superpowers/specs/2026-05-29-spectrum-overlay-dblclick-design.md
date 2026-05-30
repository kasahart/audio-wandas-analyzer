# パワースペクトル overlay の dblclick 操作 — 設計

## 背景・問題

ComparisonPanel の「カーソル時刻のパワースペクトル（全トラック重ね合わせ）」パネル
（`#spectrum-overlay-canvas`、`spectrumSectionTitle`）には、ダブルクリック操作が
**一切登録されていない**。ズーム/レンジ操作は `spec-zoom-in/out/reset` ボタンのみ。

ユーザーは ChartSpecPanel heatmap と同じ感覚で「軸を dblclick → レンジ調整」「グラフを
dblclick → ズームリセット」を期待するが、`#spectrum-overlay-canvas` は dblclick ハンドラを
持つ `#tracks-wrapper` の**外（兄弟要素）**にあり、何も起きない。

PR #104（heatmap Y/X 軸 dblclick + `track-axis-canvas` ズームリセット）はこのパネルを
対象にしていなかった。本作業はその**サーフェスのギャップ**を埋める。

## スコープ

- 対象: `#spectrum-overlay-canvas`（overlay）**のみ**
- 非対象: per-track spectrum（`track-spectrum-canvas`）、ChartSpecPanel（既に実装済み）

## 既存の状態モデル（再利用）

`comparisonRenderScript.ts` に既存:

- `specFreqStart` / `specFreqEnd`: 0..1 正規化周波数（X 軸レンジ）
- `specDbMin` / `specDbMax`: `null`=自動 / number=上書き（Y 軸 dB レンジ）
- `specZoomReset()`: 上記4つを初期化し `refreshSpectrumViews()` を呼ぶ
- `renderOverlaySpectrum()`: overlay 描画。plot 余白 `padL=36, padR=8, padT=8, padB=18`、
  canvas 幅 = `wrap.clientWidth`、高さ `H=140`。X 軸=周波数（下）、Y 軸=dB（左）。

## 設計

### 1. ゾーン判定（dblclick）

`#spectrum-overlay-canvas` に `dblclick` リスナーを一度だけ付与（canvas は再生成されず
再利用されるためリスナーは保持される）。client 座標→canvas 座標は ChartSpec の
`toCanvasCoords` と同じ `getBoundingClientRect` スケール補正で算出（実ランタイムの
スケール差に対応 — issue #101 の教訓）。

| ゾーン | 条件 | 動作 |
|---|---|---|
| Y 軸（dB） | `cx < padL` | dB レンジ popover を開く |
| X 軸（周波数） | `cx ∈ [padL, W-padR]` かつ `cy > H-padB` | 周波数(Hz) レンジ popover を開く |
| プロット内部 | `cx ∈ [padL, W-padR]` かつ `cy ∈ [padT, H-padB]` | `specZoomReset()` |

スペクトルデータが無い（slices 空 → 軸未確定）場合は何もしない。

### 2. popover（`#spectrum-range-popover` 新設）

既存 `#spec-settings-popover` と同じ作法（`hidden` + `position:absolute` + z-index +
パネル配色）。構成:

- min / max の数値入力
- 軸に応じてラベル・単位を切替（X 軸=「周波数 (Hz)」、Y 軸=「レベル (dB)」）
- ボタン: Apply / Auto / Cancel
- 開く際、現在値をプリフィル（freq は Hz、dB は現在の表示値）

動作:

- **Apply**: `min < max` を検証。
  - 周波数: `specFreqStart = clamp(min/maxF, 0, 1)`, `specFreqEnd = clamp(max/maxF, 0, 1)`
  - dB: `specDbMin = min`, `specDbMax = max`
  - `refreshSpectrumViews()` → 閉じる
  - `min >= max` は popover 内にエラー表示し開いたまま（ChartSpec 同様）
- **Auto**: override 解除（freq → `0`/`1`、dB → `null`/`null`）→ refresh → 閉じる
- **Cancel / Esc / 外側クリック**: 変更せず閉じる

### 3. state 追加

`renderOverlaySpectrum()` で算出済みの `maxF`（最大周波数 Hz）を `_lastSpectrumMaxF` に
保持。周波数 popover の Hz↔正規化変換とプリフィルに使用。

## テスト（実ブラウザ必須 — issue #101 の教訓）

1. **jsdom 統合テスト**（`renderScript.integration.test.ts`）
   - Y 軸 dblclick → popover 表示、単位 dB
   - X 軸 dblclick → popover 表示、単位 Hz
   - Apply → snapshot で `specDbMin/Max` あるいは `specFreqStart/End` が変化
   - プロット内部 dblclick → `specZoomReset`（`specFreqStart=0, specFreqEnd=1,
     specDbMin=null, specDbMax=null`）
   - `min >= max` → エラー表示、popover は開いたまま

2. **Playwright 実ブラウザ smoke**（新規・必須、`src/test/uiSmoke/`）
   - `buildUiSmokeHtml`（ComparisonPanel は Chromium で描画可）で overlay の各ゾーンを
     実 dblclick し、popover が実際に表示されること / 内部 dblclick でズームリセット
     されることを実 DOM で検証 ← jsdom では捕捉できない配線・座標を確認

## エッジケース

- スペクトルデータ無し: dblclick 無反応
- 周波数レンジは 0..1 にクランプ
- `min >= max`: エラー表示、適用しない

## 影響ファイル

| ファイル | 変更 |
|---|---|
| `src/webview/comparisonRenderScript.ts` | popover HTML、dblclick ハンドラ、openSpectrumRangePopup、`_lastSpectrumMaxF` 保持 |
| `src/shared/i18n/strings.ts` | popover ラベル/ボタン文字列（en/ja） |
| `src/test/renderScript.integration.test.ts` | jsdom 統合テスト |
| `src/test/uiSmoke/*.spec.ts` | Playwright 実ブラウザ smoke |
