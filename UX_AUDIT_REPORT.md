# UX Cognitive Audit Report (UX認知的負荷監査レポート)

本レポートは、VS Code Electron上で実行された体験シミュレーションのスクリーンショットを元に、Gemini VLM（Vision Mode）が認知的負荷（Extraneous Cognitive Load）およびニールセン/クルーグのヒューリスティクス原則に基づいて実施した自律監査の結果です。

---

## 監査サマリー

* **総評価項目数**: 4件
* **深刻度内訳**:
  - **P0 (即時改善が必要な致命的な問題)**: 1件
  - **P1 (大きな摩擦が生じている問題)**: 3件
  - **P2 (軽微なUI/UX向上提案)**: 0件

---

## 発見された問題詳細 (Audit Findings)

### UXH-001: 選択画面とメインツールバーにおける重複操作子
- **優先度**: P1 (Significant Friction / Decision Fatigue)
- **検出画面**: [01_directory_selection.png](file:///workspaces/audio-wandas-analyzer/ux-audit-screenshots/01_directory_selection.png)
- **問題点**:
  初期のファイル選択パネル（Welcome View）内に `Open File` と `Open another folder` ボタンが存在する一方で、すぐ下のメインツールバーにも `Open File` と `Open Folder` ボタンが並んでいます。この冗長な二重表示は、ユーザーに「どちらを押すべきか」の不必要な判断を強いてしまい、意思決定の疲労（Decision Fatigue）に繋がります。
- **認知的負荷の影響**:
  ハイブリッドなGUI設計の中で、別々の階層に同じ機能のボタンが並んでいると、操作のメンタルモデルが崩れ、操作対象のコンテキスト喪失を招きます。
- **具体的な改善コード/レイアウト提案**:
  選択パネル（Directory Selection）側のボタンを削除し、中央に案内テキスト「下のツールバーから[Open File]または[Open Folder]を選択して解析を開始してください」のみを表示するよう簡素化します。
  
  *該当箇所*: `src/webview/comparisonRenderScript.ts` (DirectorySelectionHeaderのHTML組み立て部分)
  ```diff
  - '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">'
  - + '<span style="font-size:12px;font-weight:700">' + escHtml(STR.selectFilesToAnalyze) + '</span>'
  - + '<button class="tb-btn" data-action="open-file">' + escHtml(STR.btnOpenFile) + '</button>'
  - + '<button class="tb-btn" data-action="open-folder">' + escHtml(STR.btnOpenAnotherFolder) + '</button>'
  - + '</div>'
  + '<div style="margin-bottom:12px;color:var(--muted);font-size:11px;">'
  + + escHtml(STR.selectFilesInstruction) // "Please use the main toolbar below to open files or folders."
  + + '</div>'
  ```

---

### UXH-002: ツールバーの極端な改行と空のズームボタン
- **優先度**: P0 (Critical Blocker / Extraneous Cognitive Load)
- **検出画面**: [02_single_track_results.png](file:///workspaces/audio-wandas-analyzer/ux-audit-screenshots/02_single_track_results.png)
- **問題点**:
  ツールバーのボタンやラベルが多く、横並びにしきれず3行に渡ってバラバラに改行されてしまっており、極めて無秩序で煩雑な見た目になっています。さらに、`Zoom:` の横にある「拡大・縮小」ボタンが単なる空の四角 `[ ]` `[ ]` となっており、アイコンもテキストもないため、機能が自己説明的でなく「Recognition over Recall (記憶に頼らない操作)」に著しく違反しています。
- **認知的負荷の影響**:
  何もない空のボタンがツールバーの中央に並んでいることで、ユーザーは何のためにそのボタンを押すのか分からず、クリックを躊躇するなどの強い認知的フリクションを発生させます。
- **具体的な改善コード/レイアウト提案**:
  1. `#toolbar` の `flex-wrap: wrap` による崩れを防ぐため、ボタン群を論理的グループ（`File`、`View`、`Zoom`、`Export`）として独立した `.tb-group` で囲み、各グループ間にマージンを持たせます。
  2. ズームボタンに `＋` / `－` または SVG アイコン（拡大鏡）を必ず描画します。
  
  *該当箇所*: `src/webview/panels/ComparisonPanel.ts` (CSS)
  ```css
  #toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 12px;
      flex-wrap: wrap;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
  }
  .tb-group {
      display: flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 2px 6px;
      background: var(--surface);
  }
  ```
  *該当箇所*: `src/webview/comparisonRenderScript.ts` (ズームボタン文字設定)
  ```diff
  - + '<button class="tb-btn" data-action="zoom-out" aria-label="' + escHtml(STR.ariaZoomOut) + '">－</button>'
  - + '<button class="tb-btn" data-action="zoom-in" aria-label="' + escHtml(STR.ariaZoomIn) + '">＋</button>'
  + // 空になってしまっている箇所の修復、およびCSSの `::before` 等で文字が潰れていないか確認し、明示的なシンボルフォントやSVGアイコンを挿入する
  ```

---

### UXH-003: ピーク周波数ラベルの重なり（視覚的衝突）
- **優先度**: P1 (Heuristics Violation: Visibility of System Status)
- **検出画面**: [02_single_track_results.png](file:///workspaces/audio-wandas-analyzer/ux-audit-screenshots/02_single_track_results.png)
- **問題点**:
  Waveform や Spectrum チャートの右側で、自動検出されたピーク周波数（`440 Hz`, `1.3 kHz` 等）のテキストラベルが縦方向に密集して重なり合って描画されており、テキストが完全に読めなくなっています。
- **認知的負荷の影響**:
  データ視覚化において、値を示す文字が重複して潰れていると、ユーザーは「数値が何であるか」を読み取るために目を細めたり、コンテキストを疑ったりする必要があり、本来の分析タスク以外の部分で脳の資源を浪費します。
- **具体的な改善コード/レイアウト提案**:
  描画ロジックにおいて、隣接するラベルのY座標の差がフォントサイズ（例: 10px）未満の場合は、描画対象からスキップするか、またはY座標を少し上下にずらす衝突防止アルゴリズムを導入します。

---

### UXH-004: スペクトログラム設定ポップアップの非表示（配置座標計算のレースコンディション）
- **優先度**: P1 (Heuristics Violation: Recognition over Recall / System Status)
- **検出画面**: [03_interactive_spectrogram_settings.png](file:///workspaces/audio-wandas-analyzer/ux-audit-screenshots/03_interactive_spectrogram_settings.png)
- **問題点**:
  ⚙ボタンがクリックされてポップアップの `hidden` が解除されたにもかかわらず、ポップアップが画面上のどこにも表示されていません。
  これは、⚙ボタンの `display: none` から表示への切り替えと、位置計算用の `getBoundingClientRect()` の呼び出しが同じ同期スレッドで連続して行われたため、ブラウザによる再レイアウトの前に座標計算が実行され、結果として `rect.bottom` や `rect.right` が `0` になり、ポップアップが画面左上（`left: 8px, top: 6px`）に描画され、ツールバーの下や別要素の背後に隠れてしまっていることが原因です。
- **認知的負荷の影響**:
  「設定ボタンを押したのに何も反応しない（ように見える）」状況は、システムがフリーズした、または機能が壊れているという誤解を生み、サイレント・フリクション（無言の摩擦）を引き起こします。
- **具体的な改善コード/レイアウト提案**:
  ポップアップ表示ロジックにおいて、`requestAnimationFrame` または `setTimeout` を使用し、ブラウザがボタンの表示レイアウトを計算し終わった次のマクロタスクで位置測定およびポップアップの座標設定を行います。
  
  *該当箇所*: `src/webview/comparisonRenderScript.ts`
  ```diff
  -            function __openSpecPopover() {
  -                const btn = document.querySelector('[data-action="spectrogram-settings"]');
  -                if (!btn || !__specPopover) { return; }
  -                const rect = btn.getBoundingClientRect();
  -                __specPopover.style.top = (rect.bottom + 6) + 'px';
  -                __specPopover.style.left = Math.max(8, rect.right - 280) + 'px';
  -                __specPopover.hidden = false;
  -                __syncSpecFormFromState();
  -            }
  +            function __openSpecPopover() {
  +                const btn = document.querySelector('[data-action="spectrogram-settings"]');
  +                if (!btn || !__specPopover) { return; }
  +                __specPopover.hidden = false; // 先に hidden を解除してレイアウト対象にする
  +                setTimeout(function() {
  +                    const rect = btn.getBoundingClientRect();
  +                    __specPopover.style.top = (rect.bottom + 6) + 'px';
  +                    __specPopover.style.left = Math.max(8, rect.right - 280) + 'px';
  +                    __syncSpecFormFromState();
  +                }, 0);
  +            }
  ```

---

## 結論と次のステップ

1. **ツールバーと空ボタンの修復 (P0)**: ズームボタンが空である問題は、拡張機能の最も基本的なヒューリスティクス違反であるため、速やかに修正を行うべきです。
2. **位置計算レースコンディションの回避 (P1)**: ⚙ボタンとポップアップの座標バグを修正し、いつでも確実に設定が行えるようにします。
3. **ピーク情報の視覚的重なりの排除 (P1)**: チャートの見やすさを確保するため、ラベルの重なり防止ロジックを追加します。
