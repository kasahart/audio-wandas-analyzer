# High-contrast & Live Region 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VS Code ハイコントラストテーマ対応と `aria-live` によるスクリーンリーダー通知を追加し、Epic #33 [50] を完了させる。

**Architecture:** `renderComparisonStyles()` に HC CSS ブロックを追加、HTML に `#a11y-announce` 隠し要素を追加、`comparisonRenderScript.ts` の各状態変更関数で `announce()` を呼ぶ。スナップショットに `lastAnnounce` を追加して E2E で検証する。

**Tech Stack:** TypeScript, CSS custom properties, ARIA live regions, node:test, VS Code Webview

---

## ファイル変更一覧

| ファイル | 変更 |
|---------|------|
| `src/shared/i18n/strings.ts` | 7キー追加 |
| `src/webview/panels/ComparisonPanel.ts` | HC CSS、`#a11y-announce` HTML、`lastAnnounce` 型 |
| `src/webview/comparisonRenderScript.ts` | `announce()` ヘルパー、各ハンドラへの呼び出し、`publishTestSnapshot` 拡張 |
| `src/e2e/suite/index.ts` | `lastAnnounce` 型定義 + assert |

---

### Task 1: worktree 作成

**Files:** (なし — git 操作のみ)

- [ ] **Step 1: worktree を作成してチェックアウト**

```bash
git worktree add .worktrees/feat-a11y-hc-live-region -b feat-a11y-hc-live-region
cd .worktrees/feat-a11y-hc-live-region
```

- [ ] **Step 2: 依存関係インストールを確認**

```bash
npm ci --prefer-offline 2>/dev/null || true
npm run compile 2>&1 | tail -5
```

Expected: `Found 0 errors.`

- [ ] **Step 3: コミット（空）— worktree 動作確認**

(次のタスクまで何もコミットしない)

---

### Task 2: i18n キー追加

**Files:**
- Modify: `src/shared/i18n/strings.ts:129-132`（`ariaPickColor` の直後）

- [ ] **Step 1: `UiStrings` インターフェースに7キー追加**

`src/shared/i18n/strings.ts` の `ariaPickColor: string;` の直後に追加:

```typescript
    announceAnalyzing: string;
    announceAnalysisDone: string;
    announceTrackRemoved: string;
    announceMuted: string;
    announceUnmuted: string;
    announceSoloed: string;
    announceUnsoloed: string;
```

- [ ] **Step 2: コンパイルエラーを確認（EN/JA 辞書にまだキーがないためエラーになる）**

```bash
npm run compile 2>&1 | grep "error TS"
```

Expected: `Property 'announceAnalyzing' is missing ...` 等のエラー複数

- [ ] **Step 3: EN 辞書にキー追加**

`ariaPickColor: 'Change track color',` の直後に追加:

```typescript
        announceAnalyzing: 'Analyzing: {msg}',
        announceAnalysisDone: 'Analysis complete: {count} tracks',
        announceTrackRemoved: 'Track {n} removed',
        announceMuted: 'Track {n} muted',
        announceUnmuted: 'Track {n} unmuted',
        announceSoloed: 'Track {n} solo',
        announceUnsoloed: 'Track {n} solo off',
```

- [ ] **Step 4: JA 辞書にキー追加**

`ariaPickColor: 'トラック色を変更',` の直後に追加:

```typescript
        announceAnalyzing: '解析中: {msg}',
        announceAnalysisDone: '解析完了: {count}件',
        announceTrackRemoved: 'トラック{n}を削除',
        announceMuted: 'トラック{n}ミュート',
        announceUnmuted: 'トラック{n}ミュート解除',
        announceSoloed: 'トラック{n}ソロ',
        announceUnsoloed: 'トラック{n}ソロ解除',
```

- [ ] **Step 5: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: `Found 0 errors.`

- [ ] **Step 6: コミット**

```bash
git add src/shared/i18n/strings.ts
git commit -m "feat(i18n): add live region announce keys for a11y"
```

---

### Task 3: ハイコントラスト CSS

**Files:**
- Modify: `src/webview/panels/ComparisonPanel.ts` — `renderComparisonStyles()` 内

- [ ] **Step 1: HC CSS ブロックを追加**

`renderComparisonStyles()` 内の `body.vscode-light` ブロックの閉じ `}` の直後（`* { box-sizing: border-box; ...` の行の直前）に挿入:

```typescript
        body.vscode-high-contrast,
        body.vscode-high-contrast-light {
            --surface:         var(--vscode-editor-background);
            --panel:           var(--vscode-sideBar-background, var(--vscode-editor-background));
            --line:            var(--vscode-contrastBorder);
            --text:            var(--vscode-editor-foreground);
            --muted:           var(--vscode-descriptionForeground);
            --accent:          var(--vscode-focusBorder);
            --track-bg:        var(--vscode-editor-background);
            --track-header-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
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
        body.vscode-high-contrast .tb-btn,
        body.vscode-high-contrast .track-btn,
        body.vscode-high-contrast .track-offset-step,
        body.vscode-high-contrast-light .tb-btn,
        body.vscode-high-contrast-light .track-btn,
        body.vscode-high-contrast-light .track-offset-step {
            border-color: var(--vscode-contrastBorder) !important;
        }
```

- [ ] **Step 2: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: `Found 0 errors.`

- [ ] **Step 3: コミット**

```bash
git add src/webview/panels/ComparisonPanel.ts
git commit -m "feat(css): high-contrast theme overrides and forced-colors fallback"
```

---

### Task 4: `#a11y-announce` HTML 要素と `announce()` ヘルパー

**Files:**
- Modify: `src/webview/panels/ComparisonPanel.ts` — `renderComparisonHtml()` 内 HTML
- Modify: `src/webview/comparisonRenderScript.ts` — `announce()` 関数追加

- [ ] **Step 1: HTML に `#a11y-announce` 追加**

`renderComparisonHtml()` 内の `<div id="canvas-tooltip"></div>` の直後（`</body>` の直前）に挿入:

```html
    <div id="a11y-announce" aria-live="polite" aria-atomic="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap"></div>
```

つまり:
```typescript
    <div id="canvas-tooltip"></div>
    <div id="a11y-announce" aria-live="polite" aria-atomic="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap"></div>
</body>
```

- [ ] **Step 2: `announce()` ヘルパーを comparisonRenderScript.ts に追加**

`const TRACK_COLORS = [...]` の直後（line 45 付近）に追加:

```typescript
            function announce(msg) {
                var el = document.getElementById('a11y-announce');
                if (!el) { return; }
                // 同一テキストの連続セットはスクリーンリーダーが無視するためクリアしてから設定
                el.textContent = '';
                requestAnimationFrame(function() { el.textContent = msg; });
            }
```

- [ ] **Step 3: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: `Found 0 errors.`

- [ ] **Step 4: コミット**

```bash
git add src/webview/panels/ComparisonPanel.ts src/webview/comparisonRenderScript.ts
git commit -m "feat(a11y): add aria-live announce region and announce() helper"
```

---

### Task 5: 各ハンドラへ `announce()` を追加

**Files:**
- Modify: `src/webview/comparisonRenderScript.ts`

#### toggleMute への追加

- [ ] **Step 1: `toggleMute` に `announce()` を追加**

現在の `toggleMute`:
```typescript
            function toggleMute(idx) {
                if (idx === playbackTrackIndex) { stopPlayback(idx); }
                trackRuntime[idx].hidden = !trackRuntime[idx].hidden;
                const btn = document.querySelector('[data-action="toggle-mute"][data-track-index="' + idx + '"]');
                if (btn) {
                    btn.classList.toggle('is-muted', trackRuntime[idx].hidden);
                    btn.setAttribute('aria-pressed', trackRuntime[idx].hidden ? 'true' : 'false');
                }
                updateVisibility();
                scheduleRender();
                refreshSpectrumViews();
            }
```

以下に変更:
```typescript
            function toggleMute(idx) {
                if (idx === playbackTrackIndex) { stopPlayback(idx); }
                trackRuntime[idx].hidden = !trackRuntime[idx].hidden;
                var n = displayOrder.indexOf(idx) + 1;
                announce(trackRuntime[idx].hidden
                    ? (STR.announceMuted || 'Track {n} muted').replace('{n}', String(n))
                    : (STR.announceUnmuted || 'Track {n} unmuted').replace('{n}', String(n)));
                const btn = document.querySelector('[data-action="toggle-mute"][data-track-index="' + idx + '"]');
                if (btn) {
                    btn.classList.toggle('is-muted', trackRuntime[idx].hidden);
                    btn.setAttribute('aria-pressed', trackRuntime[idx].hidden ? 'true' : 'false');
                }
                updateVisibility();
                scheduleRender();
                refreshSpectrumViews();
            }
```

#### toggleSolo への追加

- [ ] **Step 2: `toggleSolo` に `announce()` を追加**

現在の `toggleSolo` 冒頭:
```typescript
            function toggleSolo(idx) {
                soloTrackIndex = (soloTrackIndex === idx) ? null : idx;
                // ソロ有効化時、再生中トラックがソロ対象外なら停止
```

以下に変更（`soloTrackIndex =` 代入の直後に追加）:
```typescript
            function toggleSolo(idx) {
                soloTrackIndex = (soloTrackIndex === idx) ? null : idx;
                var n = displayOrder.indexOf(idx) + 1;
                announce(soloTrackIndex === idx
                    ? (STR.announceSoloed || 'Track {n} solo').replace('{n}', String(n))
                    : (STR.announceUnsoloed || 'Track {n} solo off').replace('{n}', String(n)));
                // ソロ有効化時、再生中トラックがソロ対象外なら停止
```

#### removeTrack への追加

- [ ] **Step 3: `removeTrack` に `announce()` を追加**

現在の `removeTrack`:
```typescript
            function removeTrack(idx) {
                if (idx === playbackTrackIndex) { stopPlayback(idx); }
                const row = document.getElementById('track-row-' + idx);
                if (row) { row.remove(); }
                var metricsItem = document.getElementById('metrics-item-' + idx);
                if (metricsItem) { metricsItem.remove(); }
                const audio = getTrackAudio(idx);
                if (audio) { audio.remove(); }
                trackRuntime[idx].hidden = true;
                var pos = displayOrder.indexOf(idx);
                if (pos !== -1) { displayOrder.splice(pos, 1); }
                if (__colorPickTarget === idx) { closeColorPicker(); }
                updateVisibility();
                scheduleRender();
                refreshSpectrumViews();
            }
```

以下に変更（`displayOrder.splice` の前に `n` を取得）:
```typescript
            function removeTrack(idx) {
                if (idx === playbackTrackIndex) { stopPlayback(idx); }
                const row = document.getElementById('track-row-' + idx);
                if (row) { row.remove(); }
                var metricsItem = document.getElementById('metrics-item-' + idx);
                if (metricsItem) { metricsItem.remove(); }
                const audio = getTrackAudio(idx);
                if (audio) { audio.remove(); }
                trackRuntime[idx].hidden = true;
                var n = displayOrder.indexOf(idx) + 1;
                var pos = displayOrder.indexOf(idx);
                if (pos !== -1) { displayOrder.splice(pos, 1); }
                announce((STR.announceTrackRemoved || 'Track {n} removed').replace('{n}', String(n)));
                if (__colorPickTarget === idx) { closeColorPicker(); }
                updateVisibility();
                scheduleRender();
                refreshSpectrumViews();
            }
```

#### __setReanalyzeBusy への追加

- [ ] **Step 4: `__setReanalyzeBusy` に `announce()` を追加**

現在の `__setReanalyzeBusy`:
```typescript
            function __setReanalyzeBusy(busy, msg) {
                const overlay = document.getElementById('reanalyze-overlay');
                if (!overlay) { return; }
                if (busy) {
                    document.getElementById('reanalyze-overlay-msg').textContent = msg || STR.reanalyzingDefault;
                    overlay.style.display = 'flex';
                } else {
                    overlay.style.display = 'none';
                }
                const applyBtn = document.getElementById('spec-apply');
                if (applyBtn) { applyBtn.disabled = !!busy; }
            }
```

以下に変更:
```typescript
            function __setReanalyzeBusy(busy, msg) {
                const overlay = document.getElementById('reanalyze-overlay');
                if (!overlay) { return; }
                if (busy) {
                    document.getElementById('reanalyze-overlay-msg').textContent = msg || STR.reanalyzingDefault;
                    overlay.style.display = 'flex';
                    announce((STR.announceAnalyzing || 'Analyzing: {msg}').replace('{msg}', msg || STR.reanalyzingDefault || ''));
                } else {
                    overlay.style.display = 'none';
                }
                const applyBtn = document.getElementById('spec-apply');
                if (applyBtn) { applyBtn.disabled = !!busy; }
            }
```

#### analysis-update への追加

- [ ] **Step 5: `analysis-update` ハンドラに `announce()` を追加**

現在:
```typescript
                if (msg.type === 'analysis-update' && Array.isArray(msg.results)) {
                    __setReanalyzeBusy(false);
                    state.results = msg.results.map(function(r, i) {
                        const old = state.results[i];
                        return Object.assign({}, r, { audioSource: old ? old.audioSource : '' });
                    });
                    displayOrder = state.results.map(function(_, i) { return i; });
                    scheduleRender();
                    refreshSpectrumViews();
                    requestAnimationFrame(function() { publishTestSnapshot(); });
                    return;
                }
```

以下に変更（`displayOrder =` の直後に追加）:
```typescript
                if (msg.type === 'analysis-update' && Array.isArray(msg.results)) {
                    __setReanalyzeBusy(false);
                    state.results = msg.results.map(function(r, i) {
                        const old = state.results[i];
                        return Object.assign({}, r, { audioSource: old ? old.audioSource : '' });
                    });
                    displayOrder = state.results.map(function(_, i) { return i; });
                    announce((STR.announceAnalysisDone || 'Analysis complete: {count} tracks').replace('{count}', String(state.results.length)));
                    scheduleRender();
                    refreshSpectrumViews();
                    requestAnimationFrame(function() { publishTestSnapshot(); });
                    return;
                }
```

- [ ] **Step 6: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: `Found 0 errors.`

- [ ] **Step 7: コミット**

```bash
git add src/webview/comparisonRenderScript.ts
git commit -m "feat(a11y): wire announce() to mute/solo/remove/analyze handlers"
```

---

### Task 6: スナップショット・E2E テスト更新

**Files:**
- Modify: `src/webview/panels/ComparisonPanel.ts` — `ComparisonPanelRenderedUi` インターフェース
- Modify: `src/webview/comparisonRenderScript.ts` — `publishTestSnapshot`
- Modify: `src/e2e/suite/index.ts` — 型定義 + assert

- [ ] **Step 1: `ComparisonPanelRenderedUi` に `lastAnnounce` を追加（コンパイルエラー確認）**

`src/webview/panels/ComparisonPanel.ts` の `displayOrder: number[];` の直後に追加:

```typescript
    lastAnnounce: string;
```

```bash
npm run compile 2>&1 | grep "error TS"
```

Expected: `publishTestSnapshot` 等で `lastAnnounce` が渡されていないエラー

- [ ] **Step 2: `publishTestSnapshot` に `lastAnnounce` を追加**

`src/webview/comparisonRenderScript.ts` の `displayOrder: displayOrder.slice(),` の直後に追加:

```typescript
                        displayOrder: displayOrder.slice(),
                        lastAnnounce: (function() {
                            var el = document.getElementById('a11y-announce');
                            return el ? (el.textContent || '') : '';
                        })(),
```

- [ ] **Step 3: E2E インライン型に `lastAnnounce` を追加**

`src/e2e/suite/index.ts` の `displayOrder: number[];` の直後に追加:

```typescript
        lastAnnounce: string;
```

- [ ] **Step 4: コンパイル確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: `Found 0 errors.`

- [ ] **Step 5: E2E アサーションを追加**

`src/e2e/suite/index.ts` の `displayOrder` を assert している行の直後に追加:

```typescript
                assert.strictEqual(
                    snapshot.renderedUi.lastAnnounce,
                    '',
                    'Initial lastAnnounce should be empty'
                );
```

- [ ] **Step 6: verify 実行**

```bash
npm run verify 2>&1 | tail -20
```

Expected:
```
# pass 213+
verify: OK
44 passed
```

- [ ] **Step 7: コミット**

```bash
git add src/webview/panels/ComparisonPanel.ts src/webview/comparisonRenderScript.ts src/e2e/suite/index.ts
git commit -m "test: add lastAnnounce to publishTestSnapshot and E2E assertion"
```

---

### Task 7: 最終確認・PR 作成

**Files:** (なし — git 操作のみ)

- [ ] **Step 1: 最終 verify**

```bash
npm run verify 2>&1 | tail -10
```

Expected: `verify: OK`

- [ ] **Step 2: ブランチをプッシュ**

```bash
git push -u origin feat-a11y-hc-live-region
```

- [ ] **Step 3: PR 作成**

```bash
gh pr create \
  --title "feat(a11y): high-contrast theme support and aria-live track notifications ([50])" \
  --body "## Summary

Implements [50] from Epic #33 — VS Code high-contrast theme support and screen reader live region notifications.

### High-contrast CSS
- Adds \`body.vscode-high-contrast\` / \`body.vscode-high-contrast-light\` CSS blocks
- Maps custom properties to VS Code HC tokens (\`--vscode-contrastBorder\`, \`--vscode-editor-background\`, etc.)
- Adds \`@media (forced-colors: active)\` fallback for non-VS Code HC environments
- Forces \`border-color: var(--vscode-contrastBorder)\` on all buttons in HC mode

### Screen reader live regions
- Adds hidden \`#a11y-announce\` element with \`aria-live=\"polite\"\` and \`aria-atomic=\"true\"\`
- \`announce()\` helper clears then sets textContent via \`requestAnimationFrame\` to guarantee re-read
- Announces on: analysis start/progress, analysis complete, track mute/unmute, track solo/unsolo, track remove
- 7 new i18n keys in EN + JA

### Tests
- \`lastAnnounce\` field added to \`publishTestSnapshot\` and \`ComparisonPanelRenderedUi\`
- E2E asserts initial \`lastAnnounce === ''\'

Closes #50 (Epic #33 [50])

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
  --base main
```

- [ ] **Step 4: Epic #33 を更新してクローズ**

PR マージ後:
```bash
gh issue edit 33 --repo kasahart/audio-wandas-analyzer \
  --body "## 概要
WCAG AA 程度を満たす状態を目指す。

## 傘下の改善案

- [x] [15] Tab/Shift+Tab フォーカス遷移 + ARIA 強化 (#61)
- [x] [13] \`?\` Help オーバーレイ (#42)
- [x] [50] High-contrast & スクリーンリーダー対応 (live region) (#65)"

gh issue close 33 --repo kasahart/audio-wandas-analyzer \
  --comment "[50] ハイコントラスト対応・live region を実装 (#65)。Epic 全項目完了。"
```
