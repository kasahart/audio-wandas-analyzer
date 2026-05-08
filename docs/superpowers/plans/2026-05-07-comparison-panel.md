# ComparisonPanel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ディレクトリツリーでチェックボックス複数選択 → Audacity風マルチトラック比較パネルを開く機能を実装する。

**Architecture:** 新規 `ComparisonPanel` クラスを `src/panels/ComparisonPanel.ts` に作成し、`AnalysisResult[]` をHTML注入して表示する。ディレクトリツリー（AnalysisPanel）にチェックボックスと「比較」ボタンを追加し、`compare-files` メッセージで extension.ts へ渡す。extension.ts は逐次解析して ComparisonPanel を開く。

**Tech Stack:** TypeScript, VS Code Extension API, HTML Canvas API (inline WebView script), node:test

---

## ファイル構成

| ファイル | 種別 | 変更内容 |
|---------|------|---------|
| `src/utils/audioTarget.ts` | 修正 | `isCompareFilesMessage` 型ガード追加 |
| `src/test/audioTarget.test.ts` | 修正 | 上記の型ガードテスト追加 |
| `src/panels/AnalysisPanel.ts` | 修正 | ディレクトリツリーにチェックボックス・比較ボタン追加 |
| `src/panels/ComparisonPanel.ts` | 新規 | ComparisonPanel クラス一式 |
| `src/extension.ts` | 修正 | compare-files ハンドラ・ComparisonPanel 起動 |

---

## Task 1: isCompareFilesMessage 型ガード

**Files:**
- Modify: `src/utils/audioTarget.ts`
- Modify: `src/test/audioTarget.test.ts`

- [ ] **Step 1: テストを書く**

`src/test/audioTarget.test.ts` の末尾に追加:

```typescript
test('isCompareFilesMessage validates required shape', () => {
    assert.equal(isCompareFilesMessage({ type: 'compare-files', filePaths: ['/a.wav', '/b.wav'] }), true);
    assert.equal(isCompareFilesMessage({ type: 'compare-files', filePaths: ['/a.wav'] }), false, '1件はNG');
    assert.equal(isCompareFilesMessage({ type: 'compare-files', filePaths: [] }), false, '0件はNG');
    assert.equal(isCompareFilesMessage({ type: 'compare-files', filePaths: ['/a.wav', ''] }), false, '空文字はNG');
    assert.equal(isCompareFilesMessage({ type: 'compare-files' }), false, 'filePaths欠如');
    assert.equal(isCompareFilesMessage({ type: 'analyze-file', filePaths: ['/a.wav', '/b.wav'] }), false, '型違い');
    assert.equal(isCompareFilesMessage(null), false);
});
```

`src/test/audioTarget.test.ts` の import 行を以下に更新:
```typescript
import {
    isAnalyzeFileMessage,
    isSelectTargetMessage,
    isSupportedAudioFile,
    isCompareFilesMessage,
} from '../utils/audioTarget';
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test 2>&1 | grep -A3 "isCompareFilesMessage"
```

Expected: `isCompareFilesMessage is not a function` または `ReferenceError`

- [ ] **Step 3: 実装を追加**

`src/utils/audioTarget.ts` の末尾に追加:

```typescript
export function isCompareFilesMessage(message: unknown): message is { type: 'compare-files'; filePaths: string[] } {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as { type?: unknown; filePaths?: unknown };
    return (
        candidate.type === 'compare-files' &&
        Array.isArray(candidate.filePaths) &&
        candidate.filePaths.length >= 2 &&
        (candidate.filePaths as unknown[]).every((p) => typeof p === 'string' && p.length > 0)
    );
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npm test 2>&1 | grep -E "(pass|fail|isCompareFiles)"
```

Expected: すべて pass

- [ ] **Step 5: コミット**

```bash
git add src/utils/audioTarget.ts src/test/audioTarget.test.ts
git commit -m "feat: add isCompareFilesMessage type guard"
```

---

## Task 2: ディレクトリツリーにチェックボックスと比較ボタンを追加

**Files:**
- Modify: `src/panels/AnalysisPanel.ts`

AnalysisPanel.ts の `renderListScreen()` 関数付近（約930行目）のテーブル行レンダリングと JS イベントハンドラを変更する。変更箇所は3箇所。

- [ ] **Step 1: CSS を追加**

`renderStyles()` の末尾（``;` の直前）に以下を追記:

```css
        .file-select-cb {
            width: 15px;
            height: 15px;
            cursor: pointer;
            accent-color: var(--accent);
        }

        .compare-tray {
            display: none;
            position: sticky;
            bottom: 0;
            background: var(--panel);
            border-top: 1px solid var(--line);
            padding: 12px 16px;
            gap: 12px;
            align-items: center;
        }

        .compare-tray.is-visible {
            display: flex;
        }

        .compare-tray-count {
            color: var(--muted);
            font-size: 13px;
        }
```

- [ ] **Step 2: テーブル行にチェックボックス列を追加**

`renderListScreen()` 内、テーブルヘッダーの `th` を生成している行を探す（約 930 行付近）。
`file-table` の `<tr>` ヘッダー行を以下のように変更（既存の最初の `<th>` の前にチェックボックス用 `<th>` を追加）:

```javascript
// 既存コード（変更前）
'<thead><tr>'
+ '<th>ファイル名</th>'
// ...

// 変更後（先頭に <th> を追加）
'<thead><tr>'
+ '<th style="width:32px"></th>'
+ '<th>ファイル名</th>'
// ...
```

各データ行（`<tr>` 生成部分、約 939 行）の先頭に `<td>` を追加:

```javascript
// 変更前
return '<tr class="table-row..." data-file-path="...">'
    + '<td>...'

// 変更後（<tr> の直後に <td> を追加）
return '<tr class="table-row..." data-file-path="...">'
    + '<td><input type="checkbox" class="file-select-cb" data-file-path="' + escapeHtml(file.filePath) + '"></td>'
    + '<td>...'
```

- [ ] **Step 3: 比較トレイ HTML を list スクリーンに追加**

`renderListScreen()` の戻り値の末尾（`</div>` の前）に比較トレイを追加:

```javascript
// renderListScreen() の return 文で、最後の </div> の直前に追記
+ '<div class="compare-tray" id="compare-tray">'
+ '<span class="compare-tray-count" id="compare-tray-count"></span>'
+ '<button type="button" class="primary-button" id="compare-tray-btn">比較パネルで開く</button>'
+ '</div>'
```

- [ ] **Step 4: JS イベントハンドラを追加**

`renderScript()` のイベントリスナー部分（`document.addEventListener('click', ...)` 付近）に以下を追加:

```javascript
// チェックボックスの変化を監視
document.addEventListener('change', function(event) {
    const cb = event.target;
    if (!cb.classList.contains('file-select-cb')) { return; }
    updateCompareTray();
});

function updateCompareTray() {
    const checked = Array.from(document.querySelectorAll('.file-select-cb:checked'));
    const tray = document.getElementById('compare-tray');
    const count = document.getElementById('compare-tray-count');
    if (!tray || !count) { return; }
    if (checked.length >= 2) {
        tray.classList.add('is-visible');
        count.textContent = checked.length + ' 件選択中';
    } else {
        tray.classList.remove('is-visible');
    }
}

document.addEventListener('click', function(event) {
    if (event.target && event.target.id === 'compare-tray-btn') {
        const checked = Array.from(document.querySelectorAll('.file-select-cb:checked'));
        const filePaths = checked.map(function(cb) { return cb.getAttribute('data-file-path'); }).filter(Boolean);
        if (filePaths.length >= 2) {
            vscode.postMessage({ type: 'compare-files', filePaths: filePaths });
        }
    }
});
```

- [ ] **Step 5: コンパイルが通ることを確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: エラーなし（出力なし or `Found 0 errors`）

- [ ] **Step 6: コミット**

```bash
git add src/panels/AnalysisPanel.ts
git commit -m "feat: add multi-select checkboxes and compare tray to directory browser"
```

---

## Task 3: extension.ts に compare-files ハンドラを追加

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: import を更新**

`src/extension.ts` の import 文を以下のように更新（`isCompareFilesMessage` と `ComparisonPanel` を追加）:

```typescript
import {
    isAnalyzeFileMessage,
    isSelectTargetMessage,
    isSupportedAudioFile,
    isCompareFilesMessage,
    type SelectionTargetKind,
} from './utils/audioTarget';
import { ComparisonPanel } from './panels/ComparisonPanel';
```

- [ ] **Step 2: 複数ファイル解析関数を追加**

`runAnalysis` 関数の後に以下を追加:

```typescript
// AnalysisResult にエラー状態を持たせるために拡張した型
interface AnalysisResultOrError extends AnalysisResult {
    error?: string;
}

async function analyzeMultipleFiles(
    context: vscode.ExtensionContext,
    filePaths: string[],
    panel?: vscode.WebviewPanel,
): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Analyzing ${filePaths.length} files with wandas`,
            cancellable: false,
        },
        async (progress) => {
            const results: AnalysisResultOrError[] = [];
            for (let i = 0; i < filePaths.length; i++) {
                progress.report({
                    increment: Math.floor(100 / filePaths.length),
                    message: `(${i + 1}/${filePaths.length}) ${path.basename(filePaths[i])}`,
                });
                try {
                    const result = await runAnalysis(context.extensionPath, vscode.Uri.file(filePaths[i]));
                    results.push(result);
                } catch (err) {
                    // 1件失敗してもパネルは開く。エラー情報をトラックに載せる
                    results.push({
                        filePath: filePaths[i],
                        fileName: path.basename(filePaths[i]),
                        sampleRateHz: 0,
                        durationSeconds: 0,
                        channelCount: 0,
                        sampleCount: 0,
                        channels: [],
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            const comparisonPanel = ComparisonPanel.show(context.extensionUri, results, panel);
            registerPanelMessageHandler(context, comparisonPanel);
        },
    );
}
```

- [ ] **Step 3: registerPanelMessageHandler に compare-files ハンドラを追加**

`registerPanelMessageHandler` 内の `if (isSelectTargetMessage(message))` ブロックの後に追加:

```typescript
if (isCompareFilesMessage(message)) {
    await analyzeMultipleFiles(context, message.filePaths, panel);
    return;
}
```

- [ ] **Step 4: コンパイルが通ることを確認**

```bash
npm run compile 2>&1 | tail -5
```

Expected: エラーなし（`ComparisonPanel` はまだ存在しないのでエラーが出る。Task 4 で解消する）

- [ ] **Step 5: コミット（Task 4 完了後に行う）**

Task 4 が完了してコンパイルが通ったあとにコミットする。

---

## Task 4: ComparisonPanel スケルトン（HTML シェル・空状態）

**Files:**
- Create: `src/panels/ComparisonPanel.ts`

- [ ] **Step 1: ファイルを作成し、基本構造を定義する**

`src/panels/ComparisonPanel.ts` を新規作成:

```typescript
import * as path from 'path';
import * as vscode from 'vscode';
import { serializeForScript } from '../utils/webviewEscaping';
import type { AnalysisResult } from './AnalysisPanel';

interface ComparisonState {
    results: AnalysisResult[];
    referenceIndex: number;
}

export class ComparisonPanel {
    public static show(
        extensionUri: vscode.Uri,
        results: AnalysisResult[],
        existingPanel?: vscode.WebviewPanel,
    ): vscode.WebviewPanel {
        const title = `比較: ${results.map((r) => r.fileName).join(', ')}`;

        const panel = existingPanel ?? vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.comparison',
            title,
            vscode.ViewColumn.Beside,
            { enableScripts: true },
        );

        panel.title = title;
        panel.webview.options = { enableScripts: true };
        panel.reveal(vscode.ViewColumn.Beside, true);

        const state: ComparisonState = { results, referenceIndex: 0 };
        panel.webview.html = ComparisonPanel.renderHtml(panel.webview, state);
        return panel;
    }

    private static renderHtml(webview: vscode.Webview, state: ComparisonState): string {
        const nonce = Date.now().toString();
        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>比較パネル</title>
    <style>${ComparisonPanel.renderStyles()}</style>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}">
        const __APP_STATE__ = ${serializeForScript(state)};
        ${ComparisonPanel.renderScript()}
    </script>
</body>
</html>`;
    }

    private static renderStyles(): string {
        return `
        :root {
            color-scheme: light dark;
            --font-ui: "Aptos", "Segoe UI", sans-serif;
            --font-mono: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
            --surface: #fbfbf8;
            --panel: #ffffff;
            --line: #d4d1c7;
            --text: #161616;
            --muted: #5e5a53;
            --accent: #0f7b6c;
        }
        body.vscode-dark, body[data-theme-kind="dark"] {
            --surface: #1e1e1e;
            --panel: #252526;
            --line: #3c3c3c;
            --text: #cccccc;
            --muted: #888888;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--surface); color: var(--text); font-family: var(--font-ui); overflow: hidden; height: 100vh; display: flex; flex-direction: column; }

        /* ── Toolbar ── */
        #toolbar {
            display: flex; align-items: center; gap: 8px; padding: 4px 10px;
            background: var(--panel); border-bottom: 1px solid var(--line);
            flex-shrink: 0; flex-wrap: wrap;
        }
        .tb-label { font-size: 11px; color: var(--muted); }
        .tb-btn {
            font-size: 11px; padding: 2px 8px; border-radius: 3px;
            border: 1px solid var(--line); background: var(--surface);
            color: var(--text); cursor: pointer;
        }
        .tb-btn.is-active { background: var(--accent); color: #fff; border-color: var(--accent); }
        .tb-btn:disabled { opacity: 0.4; cursor: default; }
        .tb-sep { width: 1px; height: 16px; background: var(--line); margin: 0 2px; }
        #cursor-display { font-size: 11px; font-family: var(--font-mono); color: var(--muted); min-width: 80px; }

        /* ── Track layout ── */
        #tracks-wrapper { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
        #ruler-row { display: flex; border-bottom: 1px solid var(--line); flex-shrink: 0; }
        #ruler-spacer { width: 130px; flex-shrink: 0; border-right: 1px solid var(--line); }
        #ruler-canvas { flex: 1; height: 20px; display: block; }

        .track-row { display: flex; border-bottom: 1px solid var(--line); flex-shrink: 0; }
        .track-header {
            width: 130px; flex-shrink: 0; border-right: 1px solid var(--line);
            padding: 5px 6px; display: flex; flex-direction: column; gap: 2px; font-size: 9px;
        }
        .track-role { color: var(--muted); }
        .track-name { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 600; }
        .track-meta { color: var(--muted); }
        .track-btns { display: flex; gap: 3px; margin-top: 2px; align-items: center; }
        .track-btn {
            font-size: 9px; padding: 1px 4px; border-radius: 2px;
            border: 1px solid var(--line); background: var(--surface);
            color: var(--muted); cursor: pointer;
        }
        .track-btn.is-muted { background: #555; color: #fff; }
        .track-ref-badge {
            font-size: 8px; padding: 1px 4px; border-radius: 2px;
            margin-left: auto;
        }
        .track-offset { display: flex; align-items: center; gap: 2px; margin-top: 3px; }
        .track-offset-val {
            font-size: 9px; font-family: var(--font-mono);
            background: var(--surface); border: 1px solid var(--line);
            border-radius: 2px; padding: 1px 3px; width: 56px; text-align: right;
            cursor: text;
        }
        .track-offset-step { font-size: 9px; padding: 1px 3px; border-radius: 2px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); cursor: pointer; }
        .track-canvas-wrap { flex: 1; position: relative; overflow: hidden; }
        .track-canvas { display: block; width: 100%; height: 80px; cursor: crosshair; }

        /* ── Overlay mode ── */
        #overlay-wrap { flex: 1; display: none; flex-direction: column; }
        #overlay-wrap.is-visible { display: flex; }
        #overlay-legend { display: flex; gap: 12px; padding: 4px 10px; font-size: 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
        .overlay-legend-item { display: flex; align-items: center; gap: 4px; }
        .overlay-swatch { width: 12px; height: 2px; border-radius: 1px; }
        #overlay-canvas-wrap { flex: 1; position: relative; overflow: hidden; }
        #overlay-canvas { display: block; width: 100%; cursor: crosshair; }

        /* ── Metrics bar ── */
        #metrics-bar {
            display: flex; gap: 16px; padding: 5px 10px; font-size: 10px;
            border-top: 1px solid var(--line); background: var(--panel); flex-shrink: 0; flex-wrap: wrap;
        }
        .metrics-item { display: flex; align-items: center; gap: 4px; }
        .metrics-swatch { width: 8px; height: 8px; border-radius: 50%; }

        /* ── Empty state ── */
        #empty-state {
            display: none; flex: 1; align-items: center; justify-content: center;
            flex-direction: column; gap: 12px; color: var(--muted); font-size: 14px;
        }
        #empty-state.is-visible { display: flex; }
        `;
    }

    private static renderScript(): string {
        return `
        (function() {
            const vscode = acquireVsCodeApi();
            const state = __APP_STATE__;

            const TRACK_COLORS = ['#4ec994','#ff8c4a','#4a9eff','#e8637a','#c084fc'];

            function hexToRgba(hex, alpha) {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
            }

            // ── Runtime state ──
            let viewMode = 'stacked';     // 'stacked' | 'overlay'
            let contentType = 'waveform'; // 'waveform' | 'spectrogram'
            let zoomStart = 0;
            let zoomEnd = 1;
            let cursorNorm = null;        // null = free, number = fixed
            let referenceIndex = state.referenceIndex;
            let dragState = null;         // { trackIndex, startX, startOffsetSeconds }
            let hoverTrackIndex = -1;     // overlay hit-test highlight

            const trackRuntime = state.results.map(function() {
                return { offsetSeconds: 0, hidden: false };
            });

            // ── Build DOM ──
            const app = document.getElementById('app');
            app.innerHTML = buildLayout();
            attachEvents();
            renderAll();

            function buildLayout() {
                const tracks = state.results.map(function(result, i) {
                    return buildTrackRow(result, i);
                }).join('');
                const metrics = state.results.map(function(result, i) {
                    const ch = result.channels[0];
                    const rmsDb = ch ? (20 * Math.log10(Math.max(ch.rms, 1e-9))).toFixed(1) + ' dBFS' : '—';
                    const peakDb = ch ? (20 * Math.log10(Math.max(ch.peakAbsolute, 1e-9))).toFixed(1) + ' dBFS' : '—';
                    const domHz = ch && ch.dominantFrequencies && ch.dominantFrequencies[0]
                        ? Math.round(ch.dominantFrequencies[0].frequencyHz) + ' Hz' : '—';
                    return '<div class="metrics-item"><div class="metrics-swatch" style="background:' + TRACK_COLORS[i % TRACK_COLORS.length] + '"></div>'
                        + '<span>' + escHtml(result.fileName) + ': RMS ' + rmsDb + ' / Peak ' + peakDb + ' / ' + domHz + '</span></div>';
                }).join('');

                return '<div id="toolbar">' + buildToolbar() + '</div>'
                    + '<div id="tracks-wrapper">'
                    + '  <div id="ruler-row"><div id="ruler-spacer"></div><canvas id="ruler-canvas"></canvas></div>'
                    + '  <div id="stacked-wrap">' + tracks + '</div>'
                    + '  <div id="overlay-wrap">'
                    + '    <div id="overlay-legend"></div>'
                    + '    <div id="overlay-canvas-wrap"><canvas id="overlay-canvas"></canvas></div>'
                    + '  </div>'
                    + '  <div id="empty-state"><p>すべてのトラックが除外されています</p></div>'
                    + '</div>'
                    + '<div id="metrics-bar">' + metrics + '</div>';
            }

            function buildToolbar() {
                return '<span style="font-weight:700;font-size:12px;color:var(--accent)">⚡ 比較</span>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">表示:</span>'
                    + '<button class="tb-btn is-active" data-action="view-stacked">縦積み</button>'
                    + '<button class="tb-btn" data-action="view-overlay">オーバーレイ</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">トラック:</span>'
                    + '<button class="tb-btn is-active" data-action="content-waveform">波形</button>'
                    + '<button class="tb-btn" data-action="content-spectrogram">スペクトログラム</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">ズーム:</span>'
                    + '<button class="tb-btn" data-action="zoom-out">－</button>'
                    + '<button class="tb-btn" data-action="zoom-in">＋</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span id="cursor-display">—</span>';
            }

            function buildTrackRow(result, i) {
                const color = TRACK_COLORS[i % TRACK_COLORS.length];
                const isRef = i === referenceIndex;
                const refBadge = isRef
                    ? '<span class="track-ref-badge" style="background:' + color + ';color:#000">基準</span>'
                    : '<button class="track-btn" data-action="set-ref" data-track-index="' + i + '" title="基準にする">基準に</button>';
                return '<div class="track-row" id="track-row-' + i + '" data-track-index="' + i + '">'
                    + '<div class="track-header">'
                    + '  <div class="track-role">' + (isRef ? '📌 基準' : '比較') + '</div>'
                    + '  <div class="track-name" title="' + escHtml(result.filePath) + '">' + escHtml(result.fileName) + '</div>'
                    + '  <div class="track-meta">Ch: ' + result.channelCount + ' &nbsp;' + (result.sampleRateHz / 1000).toFixed(1) + 'kHz</div>'
                    + '  <div class="track-btns">'
                    + '    <button class="track-btn" data-action="toggle-mute" data-track-index="' + i + '">M</button>'
                    + '    <button class="track-btn" style="opacity:0.3" disabled title="将来対応">S</button>'
                    + '    <button class="track-btn" data-action="remove-track" data-track-index="' + i + '">✕</button>'
                    + '    ' + refBadge
                    + '  </div>'
                    + '  <div class="track-offset">'
                    + '    <span class="track-offset-val" id="offset-val-' + i + '" data-track-index="' + i + '" title="ダブルクリックでリセット">+0.000s</span>'
                    + '    <button class="track-offset-step" data-action="offset-up" data-track-index="' + i + '">▲</button>'
                    + '    <button class="track-offset-step" data-action="offset-down" data-track-index="' + i + '">▼</button>'
                    + '  </div>'
                    + '</div>'
                    + '<div class="track-canvas-wrap" id="track-canvas-wrap-' + i + '">'
                    + '  <canvas class="track-canvas" id="track-canvas-' + i + '" data-track-index="' + i + '"></canvas>'
                    + '</div>'
                    + '</div>';
            }

            function escHtml(str) {
                return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            }

            // ── Rendering ──
            function renderAll() {
                resizeAllCanvases();
                renderRuler();
                if (viewMode === 'stacked') {
                    renderStackedTracks();
                } else {
                    renderOverlay();
                }
                updateVisibility();
                updateOffsetDisplays();
            }

            function resizeAllCanvases() {
                state.results.forEach(function(_, i) {
                    const canvas = document.getElementById('track-canvas-' + i);
                    if (!canvas) { return; }
                    const wrap = document.getElementById('track-canvas-wrap-' + i);
                    if (wrap) {
                        canvas.width = wrap.clientWidth || 800;
                        canvas.height = 80;
                    }
                });
                const overlayCanvas = document.getElementById('overlay-canvas');
                if (overlayCanvas) {
                    const wrap = document.getElementById('overlay-canvas-wrap');
                    if (wrap) {
                        overlayCanvas.width = wrap.clientWidth || 800;
                        overlayCanvas.height = 160;
                    }
                }
                const rulerCanvas = document.getElementById('ruler-canvas');
                if (rulerCanvas) {
                    const row = document.getElementById('ruler-row');
                    if (row) { rulerCanvas.width = row.clientWidth - 130; }
                    rulerCanvas.height = 20;
                }
            }

            function renderRuler() {
                const canvas = document.getElementById('ruler-canvas');
                if (!canvas) { return; }
                const ctx = canvas.getContext('2d');
                const W = canvas.width;
                const H = canvas.height;
                ctx.clearRect(0, 0, W, H);
                const maxDur = Math.max.apply(null, state.results.map(function(r) { return r.durationSeconds; }));
                const visStart = zoomStart * maxDur;
                const visEnd = zoomEnd * maxDur;
                const visDur = visEnd - visStart;
                ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
                ctx.font = '9px monospace';
                ctx.textAlign = 'left';
                const step = niceTimeStep(visDur);
                let t = Math.ceil(visStart / step) * step;
                while (t <= visEnd) {
                    const x = (t - visStart) / visDur * W;
                    ctx.fillText(formatTime(t), x + 2, H - 4);
                    t += step;
                }
            }

            function niceTimeStep(dur) {
                const steps = [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30];
                for (let i = 0; i < steps.length; i++) {
                    if (dur / steps[i] <= 8) { return steps[i]; }
                }
                return 60;
            }

            function formatTime(seconds) {
                const m = Math.floor(seconds / 60);
                const s = (seconds % 60).toFixed(2);
                return m + ':' + (s < 10 ? '0' : '') + s;
            }

            function renderStackedTracks() {
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden) { return; }
                    // エラートラックはキャンバスにエラーメッセージを描画
                    if (result.error) {
                        const canvas = document.getElementById('track-canvas-' + i);
                        if (canvas) {
                            const ctx = canvas.getContext('2d');
                            ctx.clearRect(0, 0, canvas.width, canvas.height);
                            ctx.fillStyle = '#e8637a';
                            ctx.font = '11px sans-serif';
                            ctx.fillText('解析失敗: ' + result.error, 8, canvas.height / 2 + 4);
                        }
                        return;
                    }
                    const canvas = document.getElementById('track-canvas-' + i);
                    if (!canvas) { return; }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    const isHighlighted = false;
                    if (contentType === 'waveform') {
                        drawWaveform(canvas, result, trackRuntime[i].offsetSeconds, color, isHighlighted);
                    } else {
                        drawSpectrogram(canvas, result, trackRuntime[i].offsetSeconds);
                    }
                });
            }

            function drawWaveform(canvas, result, offsetSeconds, color, isHighlighted) {
                const ctx = canvas.getContext('2d');
                const W = canvas.width;
                const H = canvas.height;
                ctx.clearRect(0, 0, W, H);

                const ch = result.channels[0];
                if (!ch || !ch.waveform) { return; }
                const env = ch.waveform;
                const peak = env.absolutePeak || 1;
                const n = env.max.length;
                const dur = result.durationSeconds;

                ctx.lineWidth = isHighlighted ? 2.5 : 1.5;
                ctx.strokeStyle = color;
                ctx.fillStyle = hexToRgba(color, 0.2);

                // Build fill path: top edge then bottom edge reversed
                ctx.beginPath();
                let started = false;
                for (let px = 0; px < W; px++) {
                    const tNorm = zoomStart + (px / W) * (zoomEnd - zoomStart);
                    const tAdj = tNorm - offsetSeconds / dur;
                    const idx = Math.floor(tAdj * n);
                    if (idx < 0 || idx >= n) { continue; }
                    const y = H / 2 - (env.max[idx] / peak) * (H * 0.44);
                    if (!started) { ctx.moveTo(px, y); started = true; } else { ctx.lineTo(px, y); }
                }
                for (let px = W - 1; px >= 0; px--) {
                    const tNorm = zoomStart + (px / W) * (zoomEnd - zoomStart);
                    const tAdj = tNorm - offsetSeconds / dur;
                    const idx = Math.floor(tAdj * n);
                    if (idx < 0 || idx >= n) { continue; }
                    const y = H / 2 - (env.min[idx] / peak) * (H * 0.44);
                    ctx.lineTo(px, y);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                drawCursorOnCanvas(ctx, W, H);
            }

            function drawSpectrogram(canvas, result, offsetSeconds) {
                const ctx = canvas.getContext('2d');
                const W = canvas.width;
                const H = canvas.height;
                ctx.clearRect(0, 0, W, H);

                const ch = result.channels[0];
                if (!ch || !ch.spectrogram) { return; }
                const spec = ch.spectrogram;
                const tBins = spec.timeBins;
                const fBins = spec.frequencyBins;
                const dur = result.durationSeconds;

                const imageData = ctx.createImageData(W, H);
                const data = imageData.data;

                for (let px = 0; px < W; px++) {
                    const tNorm = zoomStart + (px / W) * (zoomEnd - zoomStart);
                    const tAdj = tNorm - offsetSeconds / dur;
                    const tIdx = Math.floor(tAdj * tBins);
                    if (tIdx < 0 || tIdx >= tBins) { continue; }

                    for (let py = 0; py < H; py++) {
                        const fIdx = Math.floor((1 - py / H) * fBins);
                        if (fIdx < 0 || fIdx >= fBins) { continue; }
                        const val = (spec.values[tIdx] && spec.values[tIdx][fIdx] !== undefined)
                            ? spec.values[tIdx][fIdx] : spec.minDb;
                        const norm = Math.max(0, Math.min(1, (val - spec.minDb) / (spec.maxDb - spec.minDb)));
                        const off = (py * W + px) * 4;
                        const rgb = dbToRgb(norm);
                        data[off] = rgb[0]; data[off + 1] = rgb[1]; data[off + 2] = rgb[2]; data[off + 3] = 255;
                    }
                }
                ctx.putImageData(imageData, 0, 0);
                drawCursorOnCanvas(ctx, W, H);
            }

            function dbToRgb(norm) {
                // viridis-like: dark purple → teal → yellow
                if (norm < 0.25) { const t = norm / 0.25; return [Math.floor(68 + t * (59 - 68)), Math.floor(1 + t * (82 - 1)), Math.floor(84 + t * (139 - 84))]; }
                if (norm < 0.5)  { const t = (norm - 0.25) / 0.25; return [Math.floor(59 + t * (33 - 59)), Math.floor(82 + t * (145 - 82)), Math.floor(139 + t * (140 - 139))]; }
                if (norm < 0.75) { const t = (norm - 0.5) / 0.25; return [Math.floor(33 + t * (94 - 33)), Math.floor(145 + t * (201 - 145)), Math.floor(140 + t * (98 - 140))]; }
                const t = (norm - 0.75) / 0.25; return [Math.floor(94 + t * (253 - 94)), Math.floor(201 + t * (231 - 201)), Math.floor(98 + t * (37 - 98))];
            }

            function drawCursorOnCanvas(ctx, W, H) {
                if (cursorNorm === null) { return; }
                const x = (cursorNorm - zoomStart) / (zoomEnd - zoomStart) * W;
                if (x < 0 || x > W) { return; }
                ctx.save();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.globalAlpha = 0.7;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, H);
                ctx.stroke();
                ctx.restore();
            }

            function renderOverlay() {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas) { return; }
                const ctx = canvas.getContext('2d');
                const W = canvas.width;
                const H = canvas.height;
                ctx.clearRect(0, 0, W, H);

                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden) { return; }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    const isHl = (i === hoverTrackIndex);
                    ctx.save();
                    ctx.globalAlpha = isHl ? 1.0 : (i === referenceIndex ? 0.9 : 0.7);
                    drawWaveformOnCtx(ctx, W, H, result, trackRuntime[i].offsetSeconds, color, isHl);
                    ctx.restore();
                });

                // Draw cursor
                if (cursorNorm !== null) {
                    const x = (cursorNorm - zoomStart) / (zoomEnd - zoomStart) * W;
                    ctx.save();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.globalAlpha = 0.7;
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
                    ctx.restore();
                }

                updateOverlayLegend();
            }

            function drawWaveformOnCtx(ctx, W, H, result, offsetSeconds, color, isHighlighted) {
                const ch = result.channels[0];
                if (!ch || !ch.waveform) { return; }
                const env = ch.waveform;
                const peak = env.absolutePeak || 1;
                const n = env.max.length;
                const dur = result.durationSeconds;

                ctx.lineWidth = isHighlighted ? 2.5 : 1.5;
                ctx.strokeStyle = color;
                ctx.beginPath();
                let started = false;
                for (let px = 0; px < W; px++) {
                    const tNorm = zoomStart + (px / W) * (zoomEnd - zoomStart);
                    const tAdj = tNorm - offsetSeconds / dur;
                    const idx = Math.floor(tAdj * n);
                    if (idx < 0 || idx >= n) { continue; }
                    const y = H / 2 - (env.max[idx] / peak) * (H * 0.44);
                    if (!started) { ctx.moveTo(px, y); started = true; } else { ctx.lineTo(px, y); }
                }
                ctx.stroke();
            }

            function updateOverlayLegend() {
                const legend = document.getElementById('overlay-legend');
                if (!legend) { return; }
                legend.innerHTML = state.results.filter(function(_, i) { return !trackRuntime[i].hidden; }).map(function(result, i) {
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    return '<div class="overlay-legend-item"><div class="overlay-swatch" style="background:' + color + '"></div>'
                        + '<span>' + escHtml(result.fileName) + (i === referenceIndex ? ' 📌' : '') + '</span></div>';
                }).join('');
            }

            function updateVisibility() {
                const visibleCount = trackRuntime.filter(function(t) { return !t.hidden; }).length;
                const activeRows = state.results.filter(function(_, i) {
                    return document.getElementById('track-row-' + i) !== null;
                });
                const removedCount = state.results.length - document.querySelectorAll('.track-row').length;

                const emptyState = document.getElementById('empty-state');
                if (emptyState) {
                    const showing = document.querySelectorAll('.track-row').length === 0;
                    emptyState.classList.toggle('is-visible', showing);
                }

                document.querySelectorAll('.track-row').forEach(function(row) {
                    const idx = parseInt(row.getAttribute('data-track-index'), 10);
                    row.style.display = trackRuntime[idx] && trackRuntime[idx].hidden ? 'none' : 'flex';
                });
            }

            function updateOffsetDisplays() {
                state.results.forEach(function(_, i) {
                    const el = document.getElementById('offset-val-' + i);
                    if (!el) { return; }
                    const off = trackRuntime[i].offsetSeconds;
                    el.textContent = (off >= 0 ? '+' : '') + off.toFixed(3) + 's';
                });
            }

            // ── Events ──
            function attachEvents() {
                // Toolbar buttons
                document.getElementById('toolbar').addEventListener('click', function(e) {
                    const action = e.target.getAttribute('data-action');
                    if (!action) { return; }
                    handleToolbarAction(action, e.target);
                });

                // Track buttons
                document.getElementById('tracks-wrapper').addEventListener('click', function(e) {
                    const action = e.target.getAttribute('data-action');
                    const idx = parseInt(e.target.getAttribute('data-track-index'), 10);
                    if (action === 'toggle-mute' && !isNaN(idx)) { toggleMute(idx); }
                    if (action === 'remove-track' && !isNaN(idx)) { removeTrack(idx); }
                    if (action === 'set-ref' && !isNaN(idx)) { setReference(idx); }
                    if (action === 'offset-up' && !isNaN(idx)) { adjustOffset(idx, 0.01); }
                    if (action === 'offset-down' && !isNaN(idx)) { adjustOffset(idx, -0.01); }
                });

                // Offset field double-click to reset
                document.getElementById('tracks-wrapper').addEventListener('dblclick', function(e) {
                    if (e.target.classList.contains('track-offset-val')) {
                        const idx = parseInt(e.target.getAttribute('data-track-index'), 10);
                        if (!isNaN(idx)) { trackRuntime[idx].offsetSeconds = 0; updateOffsetDisplays(); renderAll(); }
                    }
                });

                // Stacked track canvas mouse events
                document.getElementById('tracks-wrapper').addEventListener('mousemove', function(e) {
                    handleCanvasMouseMove(e);
                });
                document.getElementById('tracks-wrapper').addEventListener('mousedown', function(e) {
                    handleCanvasMouseDown(e);
                });
                document.addEventListener('mousemove', function(e) { handleDocMouseMove(e); });
                document.addEventListener('mouseup', function(e) { handleDocMouseUp(e); });

                // Overlay canvas mouse events
                const overlayCanvas = document.getElementById('overlay-canvas');
                if (overlayCanvas) {
                    overlayCanvas.addEventListener('mousemove', function(e) { handleOverlayMouseMove(e); });
                    overlayCanvas.addEventListener('mousedown', function(e) { handleOverlayMouseDown(e); });
                    overlayCanvas.addEventListener('click', function(e) { handleOverlayClick(e); });
                }

                // Wheel events (zoom + pan)
                document.getElementById('tracks-wrapper').addEventListener('wheel', function(e) {
                    e.preventDefault();
                    if (e.ctrlKey) { handleZoomWheel(e); }
                    else if (e.shiftKey) { handlePanWheel(e); }
                }, { passive: false });

                window.addEventListener('resize', function() { renderAll(); });
            }

            function handleToolbarAction(action, btn) {
                if (action === 'view-stacked') {
                    viewMode = 'stacked';
                    document.querySelector('[data-action="view-stacked"]').classList.add('is-active');
                    document.querySelector('[data-action="view-overlay"]').classList.remove('is-active');
                    document.getElementById('stacked-wrap').style.display = '';
                    document.getElementById('overlay-wrap').classList.remove('is-visible');
                    renderAll();
                }
                if (action === 'view-overlay') {
                    viewMode = 'overlay';
                    document.querySelector('[data-action="view-stacked"]').classList.remove('is-active');
                    document.querySelector('[data-action="view-overlay"]').classList.add('is-active');
                    document.getElementById('stacked-wrap').style.display = 'none';
                    document.getElementById('overlay-wrap').classList.add('is-visible');
                    renderAll();
                }
                if (action === 'content-waveform') {
                    contentType = 'waveform';
                    document.querySelector('[data-action="content-waveform"]').classList.add('is-active');
                    document.querySelector('[data-action="content-spectrogram"]').classList.remove('is-active');
                    renderAll();
                }
                if (action === 'content-spectrogram') {
                    contentType = 'spectrogram';
                    document.querySelector('[data-action="content-waveform"]').classList.remove('is-active');
                    document.querySelector('[data-action="content-spectrogram"]').classList.add('is-active');
                    renderAll();
                }
                if (action === 'zoom-in') { zoomIn(); }
                if (action === 'zoom-out') { zoomOut(); }
            }

            function zoomIn() {
                const center = (zoomStart + zoomEnd) / 2;
                const half = (zoomEnd - zoomStart) / 2 * 0.7;
                zoomStart = Math.max(0, center - half);
                zoomEnd = Math.min(1, center + half);
                renderAll();
            }

            function zoomOut() {
                const center = (zoomStart + zoomEnd) / 2;
                const half = (zoomEnd - zoomStart) / 2 * (1 / 0.7);
                zoomStart = Math.max(0, center - half);
                zoomEnd = Math.min(1, center + half);
                renderAll();
            }

            function handleZoomWheel(e) {
                const delta = e.deltaY > 0 ? 1.15 : 0.85;
                const center = (zoomStart + zoomEnd) / 2;
                const half = (zoomEnd - zoomStart) / 2 * delta;
                zoomStart = Math.max(0, center - half);
                zoomEnd = Math.min(1, center + half);
                renderAll();
            }

            function handlePanWheel(e) {
                const shift = (zoomEnd - zoomStart) * 0.1 * (e.deltaY > 0 ? 1 : -1);
                if (zoomStart + shift < 0) { zoomEnd -= zoomStart; zoomStart = 0; }
                else if (zoomEnd + shift > 1) { zoomStart += 1 - zoomEnd; zoomEnd = 1; }
                else { zoomStart += shift; zoomEnd += shift; }
                renderAll();
            }

            // ── Cursor (stacked) ──
            function handleCanvasMouseMove(e) {
                const canvas = e.target;
                if (!canvas.classList.contains('track-canvas')) { return; }
                if (dragState) { return; } // handled by doc mousemove
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                if (cursorNorm === null) {
                    // free-floating, no fixed cursor yet: just show time
                    updateCursorDisplay(norm);
                    // redraw all to show sync cursor line
                    renderWithCursorAt(norm);
                }
            }

            function handleCanvasMouseDown(e) {
                const canvas = e.target;
                if (!canvas.classList.contains('track-canvas')) { return; }
                const idx = parseInt(canvas.getAttribute('data-track-index'), 10);
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                // Fix/unfix cursor on click (no drag yet)
                if (e.button === 0) {
                    // Start drag for time offset
                    dragState = {
                        trackIndex: idx,
                        startClientX: e.clientX,
                        startOffset: trackRuntime[idx].offsetSeconds,
                        canvasWidth: canvas.width,
                        isDrag: false,
                    };
                }
            }

            function handleDocMouseMove(e) {
                if (!dragState) { return; }
                const dx = e.clientX - dragState.startClientX;
                if (Math.abs(dx) > 3) { dragState.isDrag = true; }
                if (!dragState.isDrag) { return; }
                const maxDur = Math.max.apply(null, state.results.map(function(r) { return r.durationSeconds; }));
                const secsPerPx = (zoomEnd - zoomStart) * maxDur / dragState.canvasWidth;
                trackRuntime[dragState.trackIndex].offsetSeconds = dragState.startOffset - dx * secsPerPx;
                updateOffsetDisplays();
                renderAll();
            }

            function handleDocMouseUp(e) {
                if (dragState && !dragState.isDrag) {
                    // It was a click, not a drag: toggle cursor fix
                    const canvasId = viewMode === 'overlay' ? 'overlay-canvas' : 'track-canvas-' + dragState.trackIndex;
                    const canvas = document.getElementById(canvasId);
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                        cursorNorm = (cursorNorm !== null) ? null : norm;
                        renderAll();
                    }
                }
                dragState = null;
            }

            function renderWithCursorAt(norm) {
                // Redraw all tracks with temporary cursor at norm
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden) { return; }
                    const canvas = document.getElementById('track-canvas-' + i);
                    if (!canvas) { return; }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    if (contentType === 'waveform') {
                        const savedCursor = cursorNorm;
                        cursorNorm = norm;
                        drawWaveform(canvas, result, trackRuntime[i].offsetSeconds, color, false);
                        cursorNorm = savedCursor;
                    }
                });
                updateCursorDisplay(norm);
            }

            function updateCursorDisplay(norm) {
                const maxDur = Math.max.apply(null, state.results.map(function(r) { return r.durationSeconds; }));
                const t = norm * maxDur;
                const el = document.getElementById('cursor-display');
                if (el) { el.textContent = formatTime(t); }
            }

            // ── Cursor / drag (overlay) ──
            function hitTestOverlay(canvas, clientX, clientY) {
                const rect = canvas.getBoundingClientRect();
                const mouseX = clientX - rect.left;
                const mouseY = clientY - rect.top;
                const W = canvas.width;
                const H = canvas.height;
                let minDist = Infinity;
                let nearest = -1;
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden) { return; }
                    const ch = result.channels[0];
                    if (!ch || !ch.waveform) { return; }
                    const env = ch.waveform;
                    const peak = env.absolutePeak || 1;
                    const n = env.max.length;
                    const dur = result.durationSeconds;
                    const tNorm = zoomStart + (mouseX / W) * (zoomEnd - zoomStart);
                    const tAdj = tNorm - trackRuntime[i].offsetSeconds / dur;
                    const idx = Math.floor(tAdj * n);
                    if (idx < 0 || idx >= n) { return; }
                    const waveY = H / 2 - (env.max[idx] / peak) * (H * 0.44);
                    const dist = Math.abs(mouseY - waveY);
                    if (dist < minDist) { minDist = dist; nearest = i; }
                });
                return minDist <= 20 ? nearest : -1;
            }

            function handleOverlayMouseMove(e) {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas) { return; }
                if (dragState) { return; }
                const newHover = hitTestOverlay(canvas, e.clientX, e.clientY);
                if (newHover !== hoverTrackIndex) {
                    hoverTrackIndex = newHover;
                    canvas.style.cursor = newHover >= 0 ? 'ew-resize' : 'crosshair';
                    renderOverlay();
                }
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                updateCursorDisplay(norm);
            }

            function handleOverlayMouseDown(e) {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas) { return; }
                const idx = hitTestOverlay(canvas, e.clientX, e.clientY);
                if (idx >= 0) {
                    dragState = {
                        trackIndex: idx,
                        startClientX: e.clientX,
                        startOffset: trackRuntime[idx].offsetSeconds,
                        canvasWidth: canvas.width,
                        isDrag: false,
                    };
                }
            }

            function handleOverlayClick(e) {
                if (dragState && !dragState.isDrag) {
                    // toggle cursor fix
                    const canvas = document.getElementById('overlay-canvas');
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                        cursorNorm = (cursorNorm !== null) ? null : norm;
                        renderAll();
                    }
                }
            }

            // ── Track controls ──
            function toggleMute(idx) {
                trackRuntime[idx].hidden = !trackRuntime[idx].hidden;
                const btn = document.querySelector('[data-action="toggle-mute"][data-track-index="' + idx + '"]');
                if (btn) { btn.classList.toggle('is-muted', trackRuntime[idx].hidden); }
                updateVisibility();
                renderAll();
            }

            function removeTrack(idx) {
                const row = document.getElementById('track-row-' + idx);
                if (row) { row.remove(); }
                // If reference was removed, reassign to first remaining
                if (referenceIndex === idx) {
                    const remaining = Array.from(document.querySelectorAll('.track-row'))
                        .map(function(r) { return parseInt(r.getAttribute('data-track-index'), 10); })
                        .filter(function(i) { return !isNaN(i); });
                    if (remaining.length > 0) { setReference(remaining[0]); }
                }
                updateVisibility();
                renderAll();
            }

            function setReference(idx) {
                referenceIndex = idx;
                // Update all headers
                document.querySelectorAll('.track-row').forEach(function(row) {
                    const i = parseInt(row.getAttribute('data-track-index'), 10);
                    const roleEl = row.querySelector('.track-role');
                    if (roleEl) { roleEl.textContent = i === idx ? '📌 基準' : '比較'; }
                    const badge = row.querySelector('.track-ref-badge');
                    const setRefBtn = row.querySelector('[data-action="set-ref"]');
                    if (i === idx) {
                        if (setRefBtn) {
                            const color = TRACK_COLORS[i % TRACK_COLORS.length];
                            setRefBtn.outerHTML = '<span class="track-ref-badge" style="background:' + color + ';color:#000">基準</span>';
                        }
                    } else {
                        if (badge) {
                            badge.outerHTML = '<button class="track-btn" data-action="set-ref" data-track-index="' + i + '" title="基準にする">基準に</button>';
                        }
                    }
                });
                renderAll();
            }

            function adjustOffset(idx, deltaSeconds) {
                trackRuntime[idx].offsetSeconds += deltaSeconds;
                updateOffsetDisplays();
                renderAll();
            }
        })();
        `;
    }
}
```

- [ ] **Step 2: コンパイルが通ることを確認**

```bash
npm run compile 2>&1 | tail -10
```

Expected: エラーなし

- [ ] **Step 3: Task 3 のコミットをまとめて行う**

```bash
git add src/panels/ComparisonPanel.ts src/extension.ts
git commit -m "feat: add ComparisonPanel and compare-files handler in extension"
```

---

## Task 5: 動作確認とデバッグ

**Files:**
- `media/debug/` 以下の WAV ファイルを使用

- [ ] **Step 1: 拡張機能をビルドして起動する**

VS Code のデバッグパネルで `Run Extension`（`F5`）を押す。または:

```bash
npm run compile
```

- [ ] **Step 2: ディレクトリブラウザを開く**

コマンドパレット（`Ctrl+Shift+P`）から `Audio: Analyze Debug Audio` を実行。`media/debug/` ディレクトリが開くはず。

- [ ] **Step 3: 複数ファイルをチェックして比較を開く**

ディレクトリブラウザの各ファイル行にチェックボックスが表示されていることを確認。2 件以上チェックすると「比較パネルで開く」ボタンが現れることを確認。ボタンをクリックして `ComparisonPanel` が開くことを確認。

- [ ] **Step 4: 各機能を確認**

| 確認項目 | 操作 | 期待動作 |
|---------|------|---------|
| 縦積み表示 | パネル初期表示 | 全ファイルの波形が縦に並ぶ |
| オーバーレイ切替 | ツールバー「オーバーレイ」 | 全波形が1キャンバスに重なる |
| スペクトログラム切替 | ツールバー「スペクトログラム」 | スペクトログラムが表示される |
| Ctrl+ホイール | キャンバス上で Ctrl+wheel | ズームイン/アウト |
| Shift+ホイール | キャンバス上で Shift+wheel | 横スクロール |
| 時間オフセット | ▲▼ ボタン | 波形が左右にずれる |
| オフセットリセット | オフセット値フィールドをダブルクリック | 0.000s に戻る |
| オーバーレイドラッグ | オーバーレイモードで波形近くをドラッグ | つかんだ波形だけ動く |
| M ボタン | M を押す | そのトラックが非表示になる |
| ✕ ボタン | ✕ を押す | そのトラック行が消える |
| 基準変更 | 「基準に」ボタン | 📌 が移動する |

- [ ] **Step 5: 問題があれば修正してコミット**

```bash
git add src/panels/ComparisonPanel.ts
git commit -m "fix: resolve comparison panel rendering issues"
```

---

## 完了条件

- [ ] `npm test` がすべて pass する
- [ ] `npm run compile` がエラーなし
- [ ] ディレクトリブラウザでチェックボックス + 比較ボタンが動作する
- [ ] ComparisonPanel が縦積み・オーバーレイ両モードで波形を表示する
- [ ] Ctrl+ホイールでズーム、Shift+ホイールでパンが動作する
- [ ] 時間オフセット（ドラッグ・数値入力・リセット）が動作する
- [ ] M ボタン・✕ ボタン・基準切替が動作する
- [ ] オーバーレイモードで波形ヒットテストによるドラッグが動作する
