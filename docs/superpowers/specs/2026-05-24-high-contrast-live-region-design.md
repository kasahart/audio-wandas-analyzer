# High-contrast & スクリーンリーダー対応 (live region) 設計書

**Goal:** VS Code ハイコントラストテーマでの視認性を確保し、スクリーンリーダーが解析状態・トラック操作を `aria-live` 経由で取得できるようにする。Epic #33 [50] を完了させ、イシューをクローズする。

**Architecture:** CSS カスタムプロパティの HC オーバーライドブロックを追加し、既存のテーマ切り替えパターンを踏襲する。live region は単一の `#a11y-announce` 要素に `announce()` ヘルパーで書き込む方式とする。

**Tech Stack:** TypeScript (webview template literal)、CSS custom properties、ARIA live regions、VS Code Webview API

---

## 1. ハイコントラスト CSS

### 対象ファイル
- Modify: `src/webview/panels/ComparisonPanel.ts` — `renderComparisonStyles()` 内

### VS Code HC テーマクラス
VS Code は HC テーマ適用時に `<body>` へ以下のクラスを付与する：
- `vscode-high-contrast` — ダーク HC（Dark High Contrast テーマ）
- `vscode-high-contrast-light` — ライト HC（Light High Contrast テーマ）

### CSS オーバーライド

既存の `body.vscode-dark` / `body.vscode-light` ブロックの直後に追加：

```css
body.vscode-high-contrast,
body.vscode-high-contrast-light {
    --surface:          var(--vscode-editor-background);
    --panel:            var(--vscode-sideBar-background, var(--vscode-editor-background));
    --line:             var(--vscode-contrastBorder);
    --text:             var(--vscode-editor-foreground);
    --muted:            var(--vscode-descriptionForeground);
    --accent:           var(--vscode-focusBorder);
    --track-bg:         var(--vscode-editor-background);
    --track-header-bg:  var(--vscode-sideBar-background, var(--vscode-editor-background));
}

@media (forced-colors: active) {
    :root {
        --line:   ButtonBorder;
        --text:   ButtonText;
        --surface: Canvas;
        --panel:  Canvas;
        --accent: Highlight;
    }
}
```

### ボーダー・アウトライン補強

HC モードでは細い 1px ボーダーが不可視になりやすい。HC クラス下で `.tb-btn`・`.track-btn`・`.track-offset-step` のボーダーを `var(--vscode-contrastBorder)` に強制する：

```css
body.vscode-high-contrast .tb-btn,
body.vscode-high-contrast .track-btn,
body.vscode-high-contrast .track-offset-step,
body.vscode-high-contrast-light .tb-btn,
body.vscode-high-contrast-light .track-btn,
body.vscode-high-contrast-light .track-offset-step {
    border-color: var(--vscode-contrastBorder) !important;
}
```

### フォーカスリング

既存の `:focus-visible { outline: 2px solid var(--vscode-focusBorder, #007fd4) }` は HC でも有効。追加不要。

---

## 2. live region

### 対象ファイル
- Modify: `src/webview/panels/ComparisonPanel.ts` — `renderComparisonHtml()` 内 HTML テンプレート
- Modify: `src/webview/comparisonRenderScript.ts` — `announce()`・各ハンドラ・`publishTestSnapshot`
- Modify: `src/shared/i18n/strings.ts` — 7キー追加
- Modify: `src/e2e/suite/index.ts` — `lastAnnounce` 型定義 + assert

### HTML 追加

`<body>` 直後に隠し通知エリアを1本追加（CSS クラスでなくインラインスタイルで絶対非表示にしスクリーンリーダーには見える）：

```html
<div id="a11y-announce"
     aria-live="polite"
     aria-atomic="true"
     style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap"></div>
```

`aria-live="polite"` — 現在の読み上げが終わってから通知する。割り込みが強すぎる `assertive` は使わない。  
`aria-atomic="true"` — テキスト変更時に要素全体を読み上げる。

### `announce()` ヘルパー

```js
function announce(msg) {
    var el = document.getElementById('a11y-announce');
    if (!el) { return; }
    // 同一文字列を連続で設定すると読まれないブラウザがあるため一度クリアする
    el.textContent = '';
    requestAnimationFrame(function() { el.textContent = msg; });
}
```

### 通知タイミング

| 呼び出し箇所 | メッセージキー | 例（JA） |
|-------------|--------------|---------|
| `__setReanalyzeBusy(true, msg)` | `announceAnalyzing` | "解析中: {msg}" |
| `analysis-update` 完了 | `announceAnalysisDone` | "解析完了: {count}件" |
| `removeTrack(idx)` | `announceTrackRemoved` | "トラック{n}を削除" |
| `toggleMute(idx)` — on | `announceMuted` | "トラック{n}ミュート" |
| `toggleMute(idx)` — off | `announceUnmuted` | "トラック{n}ミュート解除" |
| `toggleSolo(idx)` — on | `announceSoloed` | "トラック{n}ソロ" |
| `toggleSolo(idx)` — off | `announceUnsoloed` | "トラック{n}ソロ解除" |

`{n}` は 1-origin の表示番号（`displayOrder.indexOf(idx) + 1`）。

---

## 3. i18n キー

`src/shared/i18n/strings.ts` に追加する7キー：

| キー | EN | JA |
|------|----|----|
| `announceAnalyzing` | `'Analyzing: {msg}'` | `'解析中: {msg}'` |
| `announceAnalysisDone` | `'Analysis complete: {count} tracks'` | `'解析完了: {count}件'` |
| `announceTrackRemoved` | `'Track {n} removed'` | `'トラック{n}を削除'` |
| `announceMuted` | `'Track {n} muted'` | `'トラック{n}ミュート'` |
| `announceUnmuted` | `'Track {n} unmuted'` | `'トラック{n}ミュート解除'` |
| `announceSoloed` | `'Track {n} solo'` | `'トラック{n}ソロ'` |
| `announceUnsoloed` | `'Track {n} solo off'` | `'トラック{n}ソロ解除'` |

プレースホルダー置換は `STR.announceAnalyzing.replace('{msg}', msg)` パターンで行う（既存 `reanalyzingFiles` と同じ方式）。

---

## 4. テスト

### ユニットテスト（node:test）
`announce()` は DOM 操作のため webview テンプレート内に閉じており、直接ユニットテストは困難。スナップショットベースのアプローチを取る。

### スナップショット拡張

`publishTestSnapshot` の `renderedUi` に `lastAnnounce: string` を追加：

```js
lastAnnounce: document.getElementById('a11y-announce')
              ? document.getElementById('a11y-announce').textContent || ''
              : ''
```

`ComparisonPanelRenderedUi` インターフェース（`ComparisonPanel.ts`）と E2E インラインタイプ（`index.ts`）にも `lastAnnounce: string` を追加。

### E2E アサーション（`src/e2e/suite/index.ts`）

初期状態：
```ts
assert.strictEqual(snapshot.renderedUi.lastAnnounce, '', 'Initial announce should be empty');
```

---

## 5. ファイル変更一覧

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `src/webview/panels/ComparisonPanel.ts` | Modify | HC CSS ブロック追加、`#a11y-announce` HTML 追加、`ComparisonPanelRenderedUi.lastAnnounce` 追加 |
| `src/webview/comparisonRenderScript.ts` | Modify | `announce()` ヘルパー追加、各ハンドラに `announce()` 呼び出し追加、`publishTestSnapshot` 拡張 |
| `src/shared/i18n/strings.ts` | Modify | 7キー追加 |
| `src/e2e/suite/index.ts` | Modify | `lastAnnounce: string` 型追加、初期値 assert 追加 |

---

## 6. 完了条件

- `npm run verify` が通る
- `body.vscode-high-contrast` 下で `--line` が `var(--vscode-contrastBorder)` に解決される
- `removeTrack` / `toggleMute` / `toggleSolo` 呼び出し後に `#a11y-announce` の `textContent` が期待文字列になる
- Epic #33 の全項目チェック完了 → イシュー #33 クローズ
