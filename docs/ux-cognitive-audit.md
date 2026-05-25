# UX認知的負荷監査フレームワーク 開発者ガイド (UX Cognitive Audit Guide)

本プロジェクトには、拡張機能のUI/UX品質（エンドユーザーである開発者の認知的負荷を極限まで下げる設計）を自律的かつ定量的に評価するための「**UX認知的負荷監査フレームワーク**」が導入されています。

本ガイドでは、開発者が迷うことなくこのフレームワークを起動・運用・拡張できるようにその手順と仕組みを解説します。

---

## 1. フレームワークの概要

この評価システムは、テスト用のVS Code（Electron環境）を自動起動し、開発中の拡張機能をインストールした状態でユーザーの基本操作を自動シミュレート（トレース）します。
シミュレーションの各段階においてUIのスクリーンショット（画素データ）を撮影し、エージェント（VLM）がそれを視覚的に分析することで、認知的フリクションやヒューリスティクス違反を検出し、[UX_AUDIT_REPORT.md](../UX_AUDIT_REPORT.md) に改善コード提案と共に出力します。

---

## 2. 起動方法 (How to Run)

監査は、VS Codeのネイティブタスクからトリガーするか、あるいはターミナルから直接スクリプトを実行することで開始できます。

### 方法A: VS Codeのタスクから実行する (推奨)
1. コマンドパレット（`Ctrl+Shift+P` または `Cmd+Shift+P`）を開きます。
2. **「Tasks: Run Task」** (タスク: タスクの実行) を選択します。
3. タスク一覧から **`Run UX Cognitive Audit`** を選択します。
4. ターミナルパネルが開き、コードの自動コンパイル（`npm run compile`）とElectronの自動起動、およびPlaywrightによる自動操作とスクリーンショット撮影が実行されます。

### 方法B: コマンドラインから実行する
ターミナルから直接スクリプトをキックすることも可能です。
```bash
node scripts/ux-cognitive-audit.js
```
*※ Linux上のヘッドレス環境（GUIがないコンテナ環境やCI等）では、システムに `xvfb-run` がインストールされていれば自動的に仮想フレームバッファ経由でヘッドレス起動します。*

---

## 3. 生成される成果物

実行が正常に終了すると、プロジェクト内に以下のファイルが生成・更新されます。

1. **`ux-audit-screenshots/`** (フォルダ)
   シミュレーション中の画面スクリーンショットがPNG形式で保存されます。
   - `01_directory_selection.png`: 初期ファイル選択画面（Welcome View）
   - `02_single_track_results.png`: 実信号 `media/debug.wav` ロード直後の波形表示画面
   - `03_interactive_spectrogram_settings.png`: 波形ズームイン・スペクトログラム切り替えおよび設定を開いた状態
2. **`UX_AUDIT_REPORT.md`** (ファイル)
   撮影されたスクリーンショットに基づき、VLMが発見したUX問題（Heuristics Findings: `UXH-NNN`）、優先度（P0/P1/P2）、および修正のための具体的なCSSやレイアウトコードの提案を出力します。

---

## 4. 内部の仕組み (Internal Architecture)

監査タスク実行時の処理の流れは以下の通りです：

```
[VS Code Native Task] 
    ↓ (trigger)
[scripts/ux-cognitive-audit.js] 
    ↓ (npm run compile)
    ↓ (download & spawn VS Code Electron with --remote-debugging-port=9222)
[src/e2e/runVscodeUXAudit.ts]
    ↓ (loads Extension Tests)
[src/e2e/suite/uxAudit.ts]
    ↓
    ├─► VS Code API: コマンド実行 (analyzeDebugFile) で拡張機能Webviewをアクティブ化
    ├─► Playwright: CDP (Port 9222) 経由でElectronにアタッチ
    └─► Playwright: シミュレーション操作のトレース ＆ スクリーンショット撮影
```

---

## 5. 監査評価チェックリスト (VLM用 Skill 定義)

監査で評価される指標のチェックリストは、以下のSkillファイルに定義されています。
* [.agents/skills/ux-cognitive-auditor/SKILL.md](../.agents/skills/ux-cognitive-auditor/SKILL.md)

主要な評価ポイント：
* **認知的フリクション (Extraneous Cognitive Load)**:
  - 不必要な意思決定や文字入力をユーザーに強要していないか。
  - チャット対話とGUIパネル（ボタン・波形）の連動時に、コンテキストの喪失やモードの混乱（ハイブリッドの罠）が起きていないか。
* **ニールセン/クルーグのヒューリスティクス検証**:
  - システムステータスの視認性（スピナーやローディング表示の適切さ）。
  - 記憶に頼る操作の排除（Recognition over Recall: 空白ボタンやアイコンの欠如がないか）。
  - エラーの防止と分かりやすい解決策の提示。

---

## 6. テストシナリオの拡張方法

新しいユーザーフロー（例: レシピ実行やマルチトラック位置調整など）を視覚監査に追加したい場合は、以下のファイルを編集してテストコードを追加してください。
* **[src/e2e/suite/uxAudit.ts](../src/e2e/suite/uxAudit.ts)**
  `ComparisonPanel.postTestActions()` や Playwright の操作APIを使ってトレースステップを追加し、`page.screenshot()` で新しい画像を出力するようにします。
